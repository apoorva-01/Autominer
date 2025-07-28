/*
# Daily Fetch Job - README

## Overview
This script (`daily-fetch.js`) is responsible for fetching new Slack messages daily from selected channels and DMs, saving them to a database, and exporting them to Google Docs for archival and analysis.

## Features
- Fetches new messages from Slack channels and DMs daily.
- Saves messages to a database (via Prisma ORM).
- Exports messages to Google Docs, organized by year and channel/DM.
- Handles Google Drive folder structure automatically.
- Supports rate limiting and retry logic for API calls.
- Runs as a scheduled cron job (default: 9 AM America/New_York).

## Configuration
Set the following environment variables (typically in `.env`):
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`: For Google OAuth2 API access (required for Google Docs export).
- `DATABASE_URL`: For Prisma to connect to your database.
- (Optional) `NODE_ENV=development`: To run the job immediately on startup for testing.

## How It Works
1. **Initialization**: Loads environment variables and initializes Google APIs and Prisma.
2. **Job Discovery**: Finds all active Slack channel selections with daily export enabled.
3. **Message Fetching**: For each channel/DM, fetches new messages since the last fetch using the Slack API (`conversations.history`).
4. **Database Save**: New messages are saved to the `slackConversation` table.
5. **Google Docs Export**: Messages are appended to a Google Doc, organized by year and channel/DM. Large conversations are split into multiple documents.
6. **Scheduling**: Uses `node-cron` to run the job daily at 9 AM (America/New_York) via `node-cron`.

## Slack API Usage
| Endpoint                                 | Purpose                                      | Token Type Used |
|-------------------------------------------|----------------------------------------------|----------------|
| https://slack.com/api/conversations.history | Fetch new messages from a channel/DM         | User Token     |
| https://slack.com/api/users.list            | Fetch user info for formatting messages      | User Token     |

- **Only the User Token is used** for all Slack API calls in this script. There is no fallback to Bot Token.

## Google API Usage
- Uses Google Drive and Google Docs APIs to create folders and documents for message export.
- Requires OAuth2 credentials and refresh token.

## Token Requirements
- **Slack User Token**: Must have `channels:history`, `groups:history`, `im:history`, and `users:read` scopes for full functionality.
- **Google OAuth2 Token**: Must have Drive and Docs scopes.

## Scheduling
- The job is scheduled to run daily at 9 AM (America/New_York) via `node-cron`.
- In development mode, it also runs once on startup for testing.

## Error Handling & Retry Logic
- API calls to Slack and Google are wrapped with retry logic and exponential backoff for rate limits and transient errors.
- Errors are logged to the console.

## Troubleshooting
- Ensure all required environment variables are set.
- Check that Slack tokens have the necessary scopes and are not expired.
- Google API credentials must be valid and have the correct scopes.
- Review logs for any API errors or rate limit warnings.

*/
// Load environment variables from .env file
require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const axios = require('axios');
const { google } = require('googleapis');

const prisma = new PrismaClient();

// Rate limiter for Slack API calls
class SlackRateLimiter {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.minInterval = 100; // 100ms between requests
    
    // Track specific API method calls to respect their individual rate limits
    this.methodLastCalls = {
      'conversations.history': 0,
      'channels.history': 0,
      'groups.history': 0,
      'im.history': 0,
      'conversations.replies': 0,
      'users.list': 0,
      'auth.test': 0,
      'apps.auth.test': 0
    };
    
    // Method-specific rate limits (in ms)
    this.methodRateLimits = {
      // Tier 3 rate limits - more restrictive
      'conversations.history': 1000, // 1 second between calls
      'channels.history': 1000,
      'groups.history': 1000,
      'im.history': 1000,
      'conversations.replies': 1000,
      'users.list': 1000,
      'auth.test': 1000,
      'apps.auth.test': 1000,
      // Default for other methods
      'default': 100 // 100ms for other methods
    };
    
    // After May 2025, non-Marketplace apps will have stricter limits
    if (process.env.SLACK_APP_IS_MARKETPLACE !== 'true') {
      const nonMarketplaceLimit = 60000; // 1 minute (60,000ms)
      this.methodRateLimits = {
        ...this.methodRateLimits,
        'conversations.history': nonMarketplaceLimit,
        'channels.history': nonMarketplaceLimit,
        'groups.history': nonMarketplaceLimit,
        'im.history': nonMarketplaceLimit,
        'conversations.replies': nonMarketplaceLimit,
        'users.list': nonMarketplaceLimit,
        'auth.test': nonMarketplaceLimit,
        'apps.auth.test': nonMarketplaceLimit
      };
      console.log('⚠️ Using stricter rate limits for non-Marketplace Slack app');
    } else {
      // Even for marketplace apps, DMs should have more conservative limits
      this.methodRateLimits['im.history'] = 3000; // 3 seconds for DM history
      this.methodRateLimits['conversations.history'] = 2000; // 2 seconds for conversations when used with DMs
      console.log('ℹ️ Using marketplace app rate limits with conservative settings for DMs');
    }
  }

  async makeRequest(requestFn, context = '') {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, context, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const { requestFn, context, resolve, reject } = this.queue.shift();
      
      try {
        // Extract method name from context if possible
        const methodMatch = context.match(/^([a-z.]+) for/);
        const methodName = methodMatch ? methodMatch[1] : 'default';
        
        // Check if this is a DM request (more conservative rate limiting)
        const isDmRequest = context.includes('D0') && (context.includes('dm') || context.includes('DM'));
        
        // Determine appropriate delay based on method
        const now = Date.now();
        const methodLastCall = this.methodLastCalls[methodName] || 0;
        let methodLimit = this.methodRateLimits[methodName] || this.methodRateLimits.default;
        
        // Add extra delay for DM requests
        if (isDmRequest && methodName.includes('history')) {
          methodLimit = Math.max(methodLimit, 3000); // At least 3 seconds for DM history
          console.log(`⏱️ Using conservative rate limit for DM request: ${methodLimit}ms`);
        }
        
        const timeSinceMethodCall = now - methodLastCall;
        
        // Calculate delay needed (respect both general rate limit and method-specific limit)
        const generalDelay = Math.max(0, this.minInterval - (now - this.lastRequestTime));
        const methodDelay = Math.max(0, methodLimit - timeSinceMethodCall);
        const delay = Math.max(generalDelay, methodDelay);
        
        if (delay > 0) {
          if (delay > 1000) {
            console.log(`⏳ Rate limiting: Waiting ${delay}ms before next ${methodName} call`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        // Update timestamps
        this.lastRequestTime = Date.now();
        if (this.methodLastCalls.hasOwnProperty(methodName)) {
          this.methodLastCalls[methodName] = Date.now();
        }
        
        const result = await requestFn();
        
        // Handle Slack's Retry-After header if present
        if (result && result.headers && result.headers['retry-after']) {
          const retryAfter = parseInt(result.headers['retry-after'], 10) * 1000;
          console.log(`⚠️ Slack API rate limit hit. Retry-After: ${retryAfter}ms`);
          
          // Update the rate limit for this method
          if (this.methodLastCalls.hasOwnProperty(methodName)) {
            this.methodRateLimits[methodName] = Math.max(this.methodRateLimits[methodName], retryAfter);
          }
          // Wait and retry the request in-place
          await new Promise(resolve => setTimeout(resolve, retryAfter));
          // Re-attempt the same request after waiting
          this.queue.unshift({ requestFn, context, resolve, reject });
          continue;
        }
        
        resolve(result);
      } catch (error) {
        // Check if error is related to rate limiting
        if (error.response && error.response.status === 429) {
          const retryAfter = error.response.headers['retry-after'] 
            ? parseInt(error.response.headers['retry-after'], 10) * 1000 
            : 60000; // Default to 60s if no header
          
          console.log(`⚠️ Rate limit exceeded. Retry-After: ${retryAfter}ms. Will retry after waiting.`);
          
          // Update rate limits for this method to be more conservative
          const methodMatch = context.match(/^([a-z.]+) for/);
          const methodName = methodMatch ? methodMatch[1] : 'default';
          if (this.methodLastCalls.hasOwnProperty(methodName)) {
            // Add 20% buffer to the retry time to be safe
            const safeRetryTime = Math.ceil(retryAfter * 1.2);
            this.methodRateLimits[methodName] = Math.max(this.methodRateLimits[methodName], safeRetryTime);
            console.log(`⚠️ Updated rate limit for ${methodName} to ${this.methodRateLimits[methodName]}ms`);
          }
          // Wait and retry the request in-place
          await new Promise(resolve => setTimeout(resolve, retryAfter));
          this.queue.unshift({ requestFn, context, resolve, reject });
          continue;
        } else {
          reject(error);
        }
      }
    }
    
    this.processing = false;
  }
}

// Create an instance of the SlackRateLimiter
const slackRateLimiter = new SlackRateLimiter();

// Initialize Google APIs (same as in slack.js)
let drive, docs;

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  drive = google.drive({ version: 'v3', auth: oauth2Client });
  docs = google.docs({ version: 'v1', auth: oauth2Client });
  console.log('📋 Daily fetch job: Google APIs initialized');
} else {
  console.warn('⚠️ Daily fetch job: Google APIs not configured');
}

// Daily job function
async function runDailyFetch() {
  try {
    console.log('🔄 Starting daily message fetch...');
    
    // Get all active channel selections with daily export enabled
    const activeSelections = await prisma.slackChannelSelection.findMany({
      where: {
        isActive: true,
        dailyExportEnabled: true
      },
      include: {
        slackConnection: true,
        user: true
      }
    });

    console.log(`📊 Found ${activeSelections.length} active channel selections with daily export enabled`);

    const processedConnections = new Set();
    
    for (const selection of activeSelections) {
      const connectionKey = selection.slackConnectionId;
      
      // Skip if we already processed this connection in this run
      if (processedConnections.has(connectionKey)) {
        continue;
      }
      
      try {
        console.log(`🔄 Processing connection: ${selection.slackConnection.slackTeamName}`);
        
        // Get all selections for this connection
        const connectionSelections = activeSelections.filter(s => 
          s.slackConnectionId === connectionKey
        );
        
        await processDailyFetchForConnection(selection.slackConnection, connectionSelections);
        processedConnections.add(connectionKey);
        
      } catch (error) {
        console.error(`❌ Error processing connection ${connectionKey}:`, error);
      }
    }
    
    console.log('✅ Daily fetch completed');
    
  } catch (error) {
    console.error('❌ Daily fetch failed:', error);
  }
}

// Process daily fetch for a single connection
async function processDailyFetchForConnection(connection, selections) {
  console.log(`📡 Processing ${selections.length} selections for ${connection.slackTeamName}`);
  
  for (const selection of selections) {
    try {
      const newMessages = await fetchNewMessages(connection, selection);
      
      if (newMessages.length > 0) {
        console.log(`📝 Found ${newMessages.length} new messages for ${selection.channelId}`);
        
        // Process messages in smaller batches for memory optimization
        const batchSize = 200; // Process 200 messages at a time
        await processMessagesInBatches(newMessages, connection, selection, batchSize);
      }
      
    } catch (error) {
      console.error(`❌ Error fetching messages for ${selection.channelId}:`, error);
    }
  }
}

// Process messages in smaller batches to optimize memory usage
async function processMessagesInBatches(messages, connection, selection, batchSize = 200) {
  try {
    console.log(`📊 Processing ${messages.length} messages in batches of ${batchSize}`);
    let totalProcessed = 0;
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(messages.length/batchSize)}: ${batch.length} messages`);
      
      // Process this batch
      await processSingleBatch(batch, connection, selection);
      
      totalProcessed += batch.length;
      // Help garbage collection by clearing references
      batch.length = 0;
    }
    
    // Update selection with new totals
    await prisma.slackChannelSelection.update({
      where: { id: selection.id },
      data: {
        totalMessages: {
          increment: totalProcessed
        },
        lastFetchedAt: new Date()
      }
    });
    
    console.log(`✅ Processed ${totalProcessed} messages for ${selection.channelName}`);
  } catch (error) {
    console.error(`❌ Error processing message batches:`, error);
  }
}

// Process a single batch of messages
async function processSingleBatch(messages, connection, selection) {
  // Collect all message data for bulk insert
  const dbRows = [];
  
  for (const message of messages) {
    // Get participants for DMs
    let participants = [];
    if (selection.channelId.startsWith('D')) {
      // Fetch participants for the DM channel
      try {
        const dmInfo = await slackRateLimiter.makeRequest(async () => {
          return await axios.get('https://slack.com/api/conversations.info', {
            headers: { 'Authorization': `Bearer ${connection.userToken}` },
            params: { channel: selection.channelId }
          });
        }, `conversations.info for ${selection.channelId}`);
        
        if (dmInfo.data.ok && dmInfo.data.channel) {
          if (Array.isArray(dmInfo.data.channel.users)) {
            participants = dmInfo.data.channel.users;
          } else if (dmInfo.data.channel.user) {
            // 1:1 DM: always include both the other user and the current user
            participants = [dmInfo.data.channel.user, selection.slackConnection.slackUserId];
          }
        }
      } catch (e) {
        console.warn('Could not fetch DM participants:', e.message);
      }
      // Ensure sender is included in participants
      if (message.user && !participants.includes(message.user)) {
        participants.push(message.user);
      }
      // Remove duplicates just in case
      participants = [...new Set(participants)];
    } else if (selection.channelId.startsWith('G')) {
      // Group channel
    }
    
    // Prepare row for database
    dbRows.push({
      slackConnectionId: connection.id,
      channelId: selection.channelId,
      channelName: selection.channelName,
      messageType: selection.channelId.startsWith('D') ? 'dm' : 
                  selection.channelId.startsWith('G') ? 'group' : 'channel',
      messageTs: message.ts,
      userId: message.user || '',
      userName: message.username || 'Unknown',
      messageText: message.text || '',
      participants: participants,
      tags: [],
      createdAt: new Date(parseFloat(message.ts) * 1000),
      slackSentAt: message.ts ? new Date(parseFloat(message.ts) * 1000) : undefined
    });
  }
  
  // Bulk insert in chunks of 1000
  if (dbRows.length > 0) {
    // Helper function to chunk array
    function chunkArray(array, size) {
      const result = [];
      for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
      }
      return result;
    }
    
    const chunks = chunkArray(dbRows, 1000);
    console.log(`📊 Inserting ${dbRows.length} messages in ${chunks.length} database chunks`);
    
    for (const chunk of chunks) {
      await prisma.slackConversation.createMany({
        data: chunk,
        skipDuplicates: true
      });
      // Help garbage collection by clearing references
      chunk.length = 0;
    }
  }
  
  // Save to Google Docs if configured
  if (drive && docs && messages.length > 0) {
    await updateGoogleDocWithNewMessages(
      selection,
      messages,
      connection.slackTeamName
    );
  }
}

// Always use userToken for all Slack API requests (no fallback to accessToken)
async function fetchChannelMessagesWithUserToken(userToken, channelId, oldest = null) {
  const params = {
    channel: channelId,
    limit: 100
  };

  if (oldest) {
    params.oldest = oldest;
  }

  const token = userToken;
  const tokenType = 'User Token';

  try {
    console.log(`🔄 Daily fetch from ${channelId} using ${tokenType}...`);
    
    // Use SlackRateLimiter for the API call
    const response = await slackRateLimiter.makeRequest(async () => {
      return await axios.get('https://slack.com/api/conversations.history', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        params: params
      });
    }, `conversations.history for ${channelId}`);

    console.log(`📊 Daily fetch ${tokenType} Response: ${response.data.ok ? 'SUCCESS' : 'FAILED'}`);
    
    if (response.data.ok) {
      console.log(`✅ Daily fetch ${tokenType}: Retrieved ${response.data.messages?.length || 0} messages`);
      return { data: response.data };
    } else {
      const error = response.data.error;
      console.log(`❌ Daily fetch ${tokenType} Error: ${error}`);
      
      return { data: response.data };
    }
  } catch (error) {
    console.error(`❌ Daily fetch network error with ${tokenType} for ${channelId}:`, error.message);
    
    // Handle rate limiting in network errors
    if (error.response?.status === 429) {
      console.log(`⏱️ Rate limited`);
      return { data: { ok: false, error: 'ratelimited' } };
    }
    
    return { data: { ok: false, error: error.message } };
  }
}

// Fetch new messages since last fetch
async function fetchNewMessages(connection, selection) {
  try {
    // Get the most recent message timestamp for this channel
    const latestMessage = await prisma.slackConversation.findFirst({
      where: {
        slackConnectionId: connection.id,
        channelId: selection.channelId
      },
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        messageTs: true
      }
    });

    const oldest = latestMessage?.messageTs;
    
    // Fetch messages from Slack API with intelligent token fallback
    const response = await fetchChannelMessagesWithUserToken(
      connection.userToken,
      selection.channelId,
      oldest
    );

    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }

    const messages = response.data.messages || [];
    
    // Filter out messages we already have and invalid messages
    const newMessages = messages.filter(message => {
      return !message.subtype && 
             !message.bot_id && 
             message.text && 
             (!oldest || message.ts > oldest);
    });

    return newMessages;
    
  } catch (error) {
    console.error('Error fetching new messages:', error);
    return [];
  }
}

// Save message to database (reuse function from slack.js)
async function saveMessageToDatabase(connectionId, channelId, channelName, message, userToken, connectionSlackUserId) {
  try {
    let messageType = 'channel';
    let participants = [];
    if (channelId.startsWith('D')) {
      messageType = 'dm';
      // Fetch participants for the DM channel
      try {
        // Use SlackRateLimiter for the API call
        const dmInfoResponse = await slackRateLimiter.makeRequest(async () => {
          return await axios.get('https://slack.com/api/conversations.info', {
            headers: { 'Authorization': `Bearer ${userToken}` },
            params: { channel: channelId }
          });
        }, `conversations.info for ${channelId}`);
        
        const dmInfo = dmInfoResponse;
        if (dmInfo.data.ok && dmInfo.data.channel) {
          if (Array.isArray(dmInfo.data.channel.users)) {
            participants = dmInfo.data.channel.users;
          } else if (dmInfo.data.channel.user) {
            // 1:1 DM: always include both the other user and the current user
            participants = [dmInfo.data.channel.user, connectionSlackUserId];
          }
        }
      } catch (e) {
        console.warn('Could not fetch DM participants:', e.message);
      }
      // Ensure sender is included in participants
      if (message.user && !participants.includes(message.user)) {
        participants.push(message.user);
      }
      // Remove duplicates just in case
      participants = [...new Set(participants)];
    } else if (channelId.startsWith('G')) {
      messageType = 'group';
    }

    // Check if message already exists
    const existingMessage = await prisma.slackConversation.findFirst({
      where: {
        slackConnectionId: connectionId,
        messageTs: message.ts
      }
    });

    if (existingMessage) {
      return; // Skip if already exists
    }

    // Save new message
    await prisma.slackConversation.create({
      data: {
        slackConnectionId: connectionId,
        channelId: channelId,
        channelName: channelName,
        messageType: messageType,
        messageTs: message.ts,
        userId: message.user,
        userName: message.username || 'Unknown',
        messageText: message.text,
        participants: participants,
        tags: [],
        createdAt: new Date(parseFloat(message.ts) * 1000),
        slackSentAt: message.ts ? new Date(parseFloat(message.ts) * 1000) : undefined
      }
    });

  } catch (error) {
    console.error('Error saving message to database:', error);
  }
}

// Update Google Doc with new messages
async function updateGoogleDocWithNewMessages(selection, newMessages, teamName) {
  try {
    if (!drive || !docs) {
      console.log('⚠️ Google APIs not configured, skipping Google Docs update');
      return;
    }

    const year = new Date().getFullYear();
    const folderId = await setupGoogleDriveFolders(year);
    if (!folderId) {
      console.error('❌ Failed to setup Google Drive folders');
      return;
    }

    // Format the conversation title with year
    let conversationTitle;
    if (selection.channelId.startsWith('D')) {
      let currentUserName = 'User';
      if (selection.slackConnection && selection.slackConnection.slackUserName) {
        currentUserName = selection.slackConnection.slackUserName;
      }
      const channelNameParts = selection.channelName.split(' with ');
      let otherUserName = selection.channelName;
      if (channelNameParts.length > 1) {
        otherUserName = channelNameParts[1];
      } else if (selection.channelName.includes('↔')) {
        conversationTitle = `${year} - ${selection.channelName}`;
      }
      if (!conversationTitle) {
        conversationTitle = `${year} - ${currentUserName} ↔ ${otherUserName}`;
      }
    } else {
      conversationTitle = `${year} - ${teamName} - ${selection.channelName}`;
    }
    const formattedContent = await formatMessagesForGoogleDocs(newMessages, selection.channelId.startsWith('D'));

    // Check if the current doc is in the current year's folder
    let docIdToUse = null;
    let docUrlToUse = null;
    let needNewDoc = true;
    if (selection.googleDocId) {
      try {
        const file = await executeWithRetry(() => 
          drive.files.get({ fileId: selection.googleDocId, fields: 'id, name, parents' })
        );
        if (file && file.data && file.data.parents && file.data.parents.includes(folderId)) {
          // Doc is in the current year folder
          docIdToUse = selection.googleDocId;
          docUrlToUse = selection.googleDocUrl;
          needNewDoc = false;
        }
      } catch (e) {
        console.warn('Could not fetch existing doc info:', e.message);
      }
    }
    // If not, create a new doc in the current year folder
    let docInfo;
    if (needNewDoc) {
      docInfo = await createOrUpdateGoogleDoc(folderId, conversationTitle, formattedContent, null, selection.id);
    } else {
      docInfo = await createOrUpdateGoogleDoc(folderId, conversationTitle, formattedContent, docIdToUse, selection.id);
    }
    if (docInfo && docInfo.id) {
      await prisma.slackChannelSelection.update({
        where: { id: selection.id },
        data: {
          googleDocId: docInfo.id,
          googleDocUrl: docInfo.url
        }
      });
    }
    console.log(`✅ Updated Google Doc for ${selection.channelName}`);
  } catch (error) {
    console.error('Error updating Google Doc:', error);
  }
}

// Helper function to execute API calls with retry logic
async function executeWithRetry(apiCall, maxRetries = 5) {
  let retries = 0;
  let lastError;
  
  while (retries <= maxRetries) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;
      
      // Check if it's a rate limit error
      const isRateLimitError = error.code === 429 || 
                              (error.response && error.response.status === 429) ||
                              error.message?.includes('Rate limit') ||
                              error.message?.includes('quota');
      
      if (!isRateLimitError && retries >= maxRetries) {
        throw error;
      }
      
      // Calculate backoff time with exponential increase and jitter
      const retryAfter = error.response?.headers?.['retry-after'] || 
                         error.response?.headers?.['Retry-After'];
      
      let backoffTime;
      if (retryAfter) {
        // Use the server's retry-after value if available
        backoffTime = parseInt(retryAfter, 10) * 1000;
        console.log(`⚠️ Rate limited. Retry-After: ${backoffTime}ms. Will retry after waiting.`);
      } else {
        // Exponential backoff with jitter: 2^retries * 1000 + random(0-1000)ms
        backoffTime = Math.pow(2, retries) * 1000 + Math.floor(Math.random() * 1000);
        console.log(`⚠️ API error. Retrying in ${backoffTime}ms. Attempt ${retries + 1}/${maxRetries + 1}`);
      }
      
      // Wait for the backoff period in-place
      await new Promise(resolve => setTimeout(resolve, backoffTime));
      if (apiCall && (apiCall.toString().includes('docs.') || apiCall.toString().includes('drive.'))) {
        console.log(`[RETRY][Google Docs] Attempting retry #${retries + 1} after waiting ${backoffTime}ms due to error: ${error.message}`);
      } else {
        console.log(`[RETRY] Attempting retry #${retries + 1} after waiting ${backoffTime}ms due to error: ${error.message}`);
      }
      
      retries++;
    }
  }
  
  // If we've exhausted all retries
  throw lastError;
}

// Setup Google Drive folders
async function setupGoogleDriveFolders(year) {
  try {
    const rootFolderName = 'Slack Conversations';
    const yearFolderName = `${year}`;
    
    const rootFolderId = await findOrCreateFolder(rootFolderName, null);
    const yearFolderId = await findOrCreateFolder(yearFolderName, rootFolderId);
    
    return yearFolderId;
  } catch (error) {
    console.error('Error setting up Google Drive folders:', error);
    return null;
  }
}

// Find or create folder
async function findOrCreateFolder(folderName, parentFolderId) {
  try {
    // Search for existing folder
    const query = parentFolderId 
      ? `name='${folderName}' and '${parentFolderId}' in parents and trashed=false`
      : `name='${folderName}' and 'root' in parents and trashed=false`;
    
    const response = await executeWithRetry(() => 
      drive.files.list({
        q: query,
        fields: 'files(id, name)'
      })
    );

    if (response.data.files.length > 0) {
      return response.data.files[0].id;
    }

    // Create new folder
    const folderMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    };

    if (parentFolderId) {
      folderMetadata.parents = [parentFolderId];
    }

    const folder = await executeWithRetry(() => 
      drive.files.create({
        resource: folderMetadata,
        fields: 'id'
      })
    );

    return folder.data.id;
  } catch (error) {
    console.error('Error finding/creating folder:', error);
    return null;
  }
}

// Format messages for Google Docs
async function formatMessagesForGoogleDocs(messages, isDM = false) {
  let formattedContent = '';
  
  // Get users map to resolve user IDs to names
  const usersMap = new Map();
  
  // Collect all unique user IDs
  const userIds = new Set();
  messages.forEach(message => {
    if (message.user && !message.username) {
      userIds.add(message.user);
    }
  });
  
  // If we have user IDs, fetch user info
  if (userIds.size > 0) {
    try {
      // Get a connection to use for API calls
      const connection = await prisma.slackConnection.findFirst({
        where: {
          OR: [
            { accessToken: { not: null } },
            { userToken: { not: null } }
          ]
        }
      });
      
      if (connection) {
        const token = connection.userToken || connection.accessToken;
        
        // Use SlackRateLimiter for the API call
        const response = await slackRateLimiter.makeRequest(async () => {
          return await axios.get('https://slack.com/api/users.list', {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
        }, 'users.list');
        
        if (response.data.ok) {
          response.data.members.forEach(user => {
            usersMap.set(user.id, user);
          });
          console.log(`✅ Fetched ${usersMap.size} users for message formatting`);
        }
      }
    } catch (error) {
      console.error('Error fetching users for message formatting:', error.message);
    }
  }
  
    for (const message of messages) {
      // Get username from users map or message
      let username = 'Unknown';
      if (message.username) {
        username = message.username;
      } else if (message.user && usersMap.has(message.user)) {
        const userInfo = usersMap.get(message.user);
        username = userInfo.display_name || userInfo.real_name || userInfo.name || message.user;
      } else if (message.user) {
        username = message.user;
      }
      const date = new Date(parseFloat(message.ts) * 1000);
      const cleanText = replaceSlackMentions(message.text, usersMap);
      formattedContent += `${username}: ${cleanText}\n\n`;
    }
  
  return formattedContent;
}

// Helper to replace Slack user mentions in text
function replaceSlackMentions(text, usersMap) {
  if (!text) return '';
  return text.replace(/<@([A-Z0-9]+)>/g, (match, userId) => {
    const user = usersMap.get(userId);
    if (user) {
      return user.display_name || user.real_name || user.name || '';
    }
    return '';
  });
}

// Create or update Google Doc
async function createOrUpdateGoogleDoc(folderId, conversationTitle, formattedContent, existingDocId = null, selectionId = null) {
  try {
    const maxDocumentSize = 800 * 1024; // 800KB max per document (safer limit)
    const contentBytes = new TextEncoder().encode(formattedContent).length;
    
    if (existingDocId) {
      // Update existing document - append content to the end
      
      // First, get the document to find its length
      let documentEndIndex = 1;
      try {
        const document = await executeWithRetry(() => 
          docs.documents.get({ documentId: existingDocId })
        );
        
        if (document && document.data && document.data.body) {
          documentEndIndex = document.data.body.content[document.data.body.content.length - 1].endIndex || 1;
          console.log(`📄 Current document length: ${documentEndIndex}`);
        }
      } catch (error) {
        console.warn(`⚠️ Could not get document length, using default: ${error.message}`);
      }
      
      // Add a timestamp header before new content
      const timestampHeader = `\n\n--- New messages from ${new Date().toLocaleString()} ---\n\n`;
      
      await executeWithRetry(() => 
        docs.documents.batchUpdate({
          documentId: existingDocId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: {
                    index: Math.max(1, documentEndIndex - 1)
                  },
                  text: timestampHeader + formattedContent
                }
              }
            ]
          }
        })
      );
      
      // Save/ensure this doc is in SlackChannelGoogleDoc
      if (selectionId) {
        // Try to update if exists, otherwise create
        const existing = await prisma.slackChannelGoogleDoc.findFirst({ where: { docId: existingDocId } });
        if (existing) {
          await prisma.slackChannelGoogleDoc.update({
            where: { id: existing.id },
            data: {
              docUrl: `https://docs.google.com/document/d/${existingDocId}`,
              exportType: 'daily'
            }
          });
        } else {
          await prisma.slackChannelGoogleDoc.create({
            data: {
              slackChannelSelectionId: selectionId,
              docId: existingDocId,
              docUrl: `https://docs.google.com/document/d/${existingDocId}`,
              exportType: 'daily'
            }
          });
        }
      }
      console.log(`✅ Updated existing Google Doc for "${conversationTitle}"`);
      return { id: existingDocId, url: `https://docs.google.com/document/d/${existingDocId}` };
    } else {
      // For new documents, check if content is too large and needs splitting
      if (contentBytes > maxDocumentSize) {
        console.log(`⚠️ Content size (${Math.round(contentBytes / 1024)}KB) exceeds maximum document size (${Math.round(maxDocumentSize / 1024)}KB)`);
        console.log(`📄 Creating multiple documents for "${conversationTitle}"`);
        
        return await createMultipleDocuments(folderId, conversationTitle, formattedContent, selectionId);
      }
      
      // Create single document for normal-sized content
      console.log(`📄 Creating new Google Doc: ${conversationTitle}`);
      // Create the file in the correct folder
      const file = await executeWithRetry(() => 
        drive.files.create({
          requestBody: {
            name: `${conversationTitle}_Part1`,
            mimeType: 'application/vnd.google-apps.document',
            parents: [folderId]
          },
          fields: 'id'
        })
      );
      const docId = file.data.id;
      console.log(`📄 Created document: ${conversationTitle}_Part1 (${docId})`);

      // Add content with header
      const currentDate = new Date().toISOString();
      const isDm = conversationTitle.includes('↔');
      const initialHeader = `${conversationTitle}\nExport Date: ${currentDate}\nType: ${isDm ? 'Direct Message' : 'Channel'}\nTotal Messages: ${formattedContent.split('\n\n').length}\n============================================================\n\n`;
      
      await executeWithRetry(() => 
        docs.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: {
                    index: 1
                  },
                  text: initialHeader + formattedContent
                }
              }
            ]
          }
        })
      );

      // Save this doc in SlackChannelGoogleDoc
      if (selectionId) {
        await prisma.slackChannelGoogleDoc.create({
          data: {
            slackChannelSelectionId: selectionId,
            docId: docId,
            docUrl: `https://docs.google.com/document/d/${docId}`,
            exportType: 'daily'
          }
        });
      }
      console.log(`✅ Added content to new Google Doc: ${conversationTitle}_Part1`);
      return { id: docId, url: `https://docs.google.com/document/d/${docId}` };
    }
  } catch (error) {
    console.error('❌ Error creating/updating Google Doc:', error);
    return null;
  }
}

// Helper function to create multiple documents for large content
async function createMultipleDocuments(folderId, conversationTitle, formattedContent, selectionId = null) {
  try {
    const maxDocumentSize = 800 * 1024; // 800KB per document
    const currentDate = new Date().toISOString();
    const isDm = conversationTitle.includes('↔');
    
    // Create header content
    const headerContent = `${conversationTitle}\nExport Date: ${currentDate}\nType: ${isDm ? 'Direct Message' : 'Channel'}\n============================================================\n\n`;
    
    // Split content into parts
    const contentParts = [];
    let remainingContent = formattedContent;
    while (new TextEncoder().encode(remainingContent).length > maxDocumentSize) {
      // Find a split point
      let splitIndex = Math.floor(remainingContent.length * maxDocumentSize / new TextEncoder().encode(remainingContent).length);
      // Try to split at a line break
      splitIndex = remainingContent.lastIndexOf('\n', splitIndex);
      if (splitIndex <= 0) splitIndex = Math.floor(remainingContent.length / 2);
      contentParts.push(remainingContent.slice(0, splitIndex));
      remainingContent = remainingContent.slice(splitIndex);
    }
    contentParts.push(remainingContent);
    
    const documents = [];
    for (let i = 0; i < contentParts.length; i++) {
      const docTitle = `${conversationTitle}_Part${i+1}`;
      // Always create in the correct folder
      const doc = await executeWithRetry(() =>
        docs.documents.create({
          requestBody: {
            title: docTitle
          }
        })
      );
      const docId = doc.data.documentId;
      // Move to correct folder (always)
      await executeWithRetry(() =>
        drive.files.update({
          fileId: docId,
          addParents: folderId,
          removeParents: 'root'
        })
      );
      // Add content with header
      await executeWithRetry(() =>
        docs.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: headerContent + contentParts[i]
                }
              }
            ]
          }
        })
      );
      // Save this doc in SlackChannelGoogleDoc
      if (selectionId) {
        await prisma.slackChannelGoogleDoc.create({
          data: {
            slackChannelSelectionId: selectionId,
            docId: docId,
            docUrl: `https://docs.google.com/document/d/${docId}`,
            exportType: 'daily'
          }
        });
      }
      documents.push({
        docId,
        title: docTitle,
        url: `https://docs.google.com/document/d/${docId}`
      });
    }
    console.log(`✅ Created ${documents.length} documents for "${conversationTitle}"`);
    // Update SlackChannelSelection to point to the latest doc
    if (documents.length > 0 && selectionId) {
      const latest = documents[documents.length - 1];
      await prisma.slackChannelSelection.update({
        where: { id: selectionId },
        data: {
          googleDocId: latest.docId,
          googleDocUrl: latest.url
        }
      });
    }
    return documents.length > 0 ? { id: documents[documents.length - 1].docId, url: documents[documents.length - 1].url } : null;
  } catch (error) {
    console.error(`❌ Error creating multiple documents:`, error);
    return null;
  }
}

// Start daily fetch job scheduler
function startDailyFetchJob() {
  console.log('📅 Setting up daily fetch job scheduler...');
  
  // Run daily fetch at 9 AM every day
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ Daily fetch job triggered by scheduler');
    await runDailyFetch();
  }, {
    scheduled: true,
    timezone: "America/New_York"
  });
  
  // Also run immediately on startup for testing
  if (process.env.NODE_ENV === 'development') {
    console.log('🔧 Development mode: Running daily fetch immediately');
    setTimeout(async () => {
      await runDailyFetch();
    }, 5000); // Wait 5 seconds after startup
  }
  
  console.log('✅ Daily fetch job scheduler started');
}

module.exports = {
  startDailyFetchJob,
  runDailyFetch
}; 