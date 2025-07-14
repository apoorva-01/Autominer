// Load environment variables from .env file
require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const axios = require('axios');
const { google } = require('googleapis');

// IMPORTANT: This module prioritizes using user tokens (user scope) over bot tokens (bot scope)
// for all Slack API calls. User tokens provide better access to private channels, DMs,
// and may have more permissions in public channels.

const prisma = new PrismaClient();

// Initialize Google APIs
let drive, docs;

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
  // OAuth 2.0 Authentication (preferred method)
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  drive = google.drive({ version: 'v3', auth: oauth2Client });
  docs = google.docs({ version: 'v1', auth: oauth2Client });
  console.log('📋 Google APIs initialized with OAuth 2.0');
} else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
  // Service Account Authentication (fallback - has storage limitations)
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/documents'
    ]
  });
  
  drive = google.drive({ version: 'v3', auth });
  docs = google.docs({ version: 'v1', auth });
  console.log('⚠️ Google APIs initialized with Service Account (storage limitations apply)');
} else {
  console.warn('⚠️ Google APIs not configured - Google Docs integration will be disabled');
}

// Google Drive folder cache to avoid repeated API calls
const folderCache = new Map();

// Helper function to set up Google Drive folders
async function setupGoogleDriveFolders(year, userInfo) {
  const cacheKey = `folders-${year}-${userInfo?.userId || 'default'}`;
  
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  try {
    console.log(`🗂️ Setting up Google Drive folder structure for ${year} - User: ${userInfo?.teamName || 'Unknown'}`);
    
    let rootFolderId;
    
    // Check if specific folder ID is provided, otherwise find by name
    const specificFolderId = process.env.GOOGLE_ROOT_FOLDER_ID || '1z-L2x2iAuCRyDu-M9Oee7oJw_FsMhmqY';
    const rootFolderName = process.env.GOOGLE_ROOT_FOLDER_NAME || 'Slack Automation Discovery';
    
    if (specificFolderId && specificFolderId !== 'auto') {
      // Use specific folder ID
      rootFolderId = specificFolderId;
      console.log(`📁 Using specified root folder ID: ${rootFolderId}`);
      
      // Verify folder exists and is accessible
      try {
        const folderInfo = await drive.files.get({
          fileId: rootFolderId,
          fields: 'id, name'
        });
        console.log(`📁 Verified folder: ${folderInfo.data.name}`);
      } catch (verifyError) {
        console.warn(`⚠️ Cannot access specified folder ${rootFolderId}, falling back to search`);
        rootFolderId = await findOrCreateFolder(rootFolderName, 'root');
      }
    } else {
      // Find or create root folder by name
      rootFolderId = await findOrCreateFolder(rootFolderName, 'root');
    }
    
    // Find or create year folder within the root folder
    let yearFolderId = await findOrCreateFolder(year.toString(), rootFolderId);
    
    // Create user-specific folder structure
    let userFolderId = yearFolderId;
    let dmFolderId = yearFolderId;
    let channelFolderId = yearFolderId;
    
    // If user info is provided, create user-specific folders
    if (userInfo && userInfo.teamName) {
      // Create team folder
      userFolderId = await findOrCreateFolder(userInfo.teamName, yearFolderId);
      
      // Create DM and channel folders
      dmFolderId = await findOrCreateFolder('DMs', userFolderId);
      channelFolderId = await findOrCreateFolder('Channels', userFolderId);
    } else {
      // Create generic DM and channel folders
      dmFolderId = await findOrCreateFolder('DMs', yearFolderId);
      channelFolderId = await findOrCreateFolder('Channels', yearFolderId);
    }
    
    const folders = {
      rootFolderId,
      yearFolderId,
      userFolderId,
      dmFolderId,
      channelFolderId
    };
    
    folderCache.set(cacheKey, folders);
    return folders;
  } catch (error) {
    console.error('Error setting up Google Drive folders:', error);
    return {
      rootFolderId: 'root',
      yearFolderId: 'root',
      userFolderId: 'root',
      dmFolderId: 'root',
      channelFolderId: 'root'
    };
  }
}

// Helper function to find or create a folder
async function findOrCreateFolder(folderName, parentFolderId) {
  try {
    // Check if folder exists
    const response = await drive.files.list({
      q: `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });
    
    if (response.data.files && response.data.files.length > 0) {
      console.log(`📁 Found existing folder: ${folderName} (${response.data.files[0].id})`);
      return response.data.files[0].id;
    }
    
    // Create folder if it doesn't exist
    console.log(`📁 Creating new folder: ${folderName} in parent ${parentFolderId}`);
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    };
    
    const folder = await drive.files.create({
      resource: fileMetadata,
      fields: 'id'
    });
    
    console.log(`📁 Created folder: ${folderName} (${folder.data.id})`);
    return folder.data.id;
  } catch (error) {
    console.error(`Error finding/creating folder ${folderName}:`, error);
    return parentFolderId; // Fall back to parent folder
  }
}

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
      'im.history': 0
    };
    
    // Method-specific rate limits (in ms)
    this.methodRateLimits = {
      // Tier 3 rate limits - more restrictive
      'conversations.history': 1000, // 1 second between calls
      'channels.history': 1000,
      'groups.history': 1000,
      'im.history': 1000,
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
        'im.history': nonMarketplaceLimit
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

const slackRateLimiter = new SlackRateLimiter();

// Process history export job - NO LIMITS, fetch all messages
async function processHistoryExportJob(connection, job) {
  try {
    // Update job status to running
    await prisma.slackScrapingJob.update({
      where: { id: job.id },
      data: {
        status: 'running',
        startedAt: new Date()
      }
    });

    console.log(`📚 Starting FULL history export for ${job.channelId} (type: ${job.channelType}) - NO LIMITS`);
    
    // Verify token scopes before starting - prioritize user token
    const tokenToUse = connection.userToken || connection.accessToken;
    const tokenVerification = await verifyTokenScopes(tokenToUse, job.channelId);
    
    if (!tokenVerification.ok) {
      const errorMsg = `Token verification failed: ${tokenVerification.errorMessage}`;
      console.error(`❌ History export error for job ${job.id}: ${errorMsg}`);
      
      await prisma.slackScrapingJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errorMessage: errorMsg,
          completedAt: new Date()
        }
      });
      
      throw new Error(errorMsg);
    }
    
    console.log(`✅ Token verification successful for channel ${job.channelId}`);
    
    let hasMore = true;
    let cursor = null;
    let totalMessages = 0;
    let allMessages = []; // Collect all messages for Google Docs
    
    // Determine appropriate batch size based on app status
    // For non-Marketplace apps after May 2025, limit will be capped at 15
    console.log('!!!!!!!!!!!!!!!!!!!!!SLACK_APP_IS_MARKETPLACE:', process.env.SLACK_APP_IS_MARKETPLACE);
    const isMarketplaceApp = process.env.SLACK_APP_IS_MARKETPLACE === 'true';
    const batchSize = isMarketplaceApp ? 1000 : 
                     (new Date() > new Date('2025-05-29')) ? 15 : 200;
    
    console.log(`📊 Using batch size of ${batchSize} messages per request (${isMarketplaceApp ? 'Marketplace app' : 'Non-Marketplace app'})`);
    
    let actualChannelId = job.channelId;
    let channelInfo = null;
    
    // History export tracking metrics
    let totalFetchAttempts = 0;
    let failedMessages = 0;
    let threadMessagesFetched = 0;
    let docsCreated = 0;
    
    // Track rate limiting
    let rateLimitHits = 0;
    let totalDelayTime = 0;
    const startTime = Date.now();

    // For DMs, use existing channel ID directly
    if (job.channelType === 'dm') {
      console.log(`📱 Processing DM history export: Using existing channel ${job.channelId}`);
      
      try {
        // Get DM info for channel naming
        const dmInfoRequestFn = async () => {
          return await axios.get('https://slack.com/api/conversations.info', {
            headers: {
              'Authorization': `Bearer ${connection.userToken}`,
              'Content-Type': 'application/json'
            },
            params: {
              channel: job.channelId
            }
          });
        };

        const dmInfoResponse = await slackRateLimiter.makeRequest(dmInfoRequestFn, `fetch DM info for ${job.channelId}`);

        if (dmInfoResponse.data.ok && dmInfoResponse.data.channel.user) {
          const userId = dmInfoResponse.data.channel.user;
          console.log(`📱 Found user ID for DM: ${userId}`);
          
          // Use cached user data for naming
          const usersMap = await getUsersMap(connection.userToken, connection.slackTeamId);
          const user = usersMap.get(userId);
          
          // Get current user's name
          let currentUserName = 'User';
          if (connection.slackUserName) {
            currentUserName = connection.slackUserName;
          } else {
            // Try to get current user from the connection info
            try {
              const authTest = await axios.get('https://slack.com/api/auth.test', {
                headers: {
                  'Authorization': `Bearer ${connection.userToken || connection.accessToken}`,
                  'Content-Type': 'application/json'
                }
              });
              
              if (authTest.data.ok && authTest.data.user) {
                currentUserName = authTest.data.user;
              }
            } catch (error) {
              console.warn(`⚠️ Could not get current user name: ${error.message}`);
            }
          }
          
          if (user && !user.deleted && !user.is_bot) {
            const userName = user.display_name || user.real_name || user.name;
            channelInfo = { name: `${currentUserName} ↔ ${userName}`, isPrivate: true };
          } else {
            channelInfo = { name: `${currentUserName} ↔ ${userId}`, isPrivate: true };
          }
          
          actualChannelId = job.channelId;
          console.log(`📱 Using existing DM channel: ${actualChannelId}`);
        } else {
          throw new Error(`Failed to get DM info: ${dmInfoResponse.data.error}`);
        }
      } catch (dmError) {
        console.error(`DM setup failed for ${job.channelId}:`, dmError.message);
        throw new Error(`Cannot access DM channel: ${dmError.message}`);
      }
    } else {
      // For regular channels, get channel info normally
      channelInfo = await getChannelInfo(connection.accessToken, job.channelId);
    }

    // Update job with channel name if we found it
    if (channelInfo) {
      await prisma.slackScrapingJob.update({
        where: { id: job.id },
        data: { channelName: channelInfo.name }
      });
    }

    // --- YEAR-WISE EXPORT LOGIC START ---
    const years = await getChannelYearRange(connection.userToken || connection.accessToken, actualChannelId, connection.userToken);
    if (!years.length) throw new Error('Could not determine year range for channel');
    totalMessages = 0;
    docsCreated = 0;
    allDocInfos = [];
    for (const year of years) {
      let yearStart = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
      let yearEnd = Math.floor(new Date(`${year + 1}-01-01T00:00:00Z`).getTime() / 1000) - 1;
      let hasMore = true;
      let cursor = null;
      let yearMessages = [];
      while (hasMore) {
        const messagesResponse = await fetchChannelMessages(
          connection.accessToken,
          actualChannelId,
          cursor,
          batchSize,
          connection.userToken,
          yearStart,
          yearEnd
        );
        if (!messagesResponse.ok) throw new Error(messagesResponse.errorMessage || 'Slack API error');
        const messages = messagesResponse.messages || [];
        for (const message of messages) {
          if (message.text) yearMessages.push(message);
          await saveMessageToDatabase(connection.id, actualChannelId, channelInfo?.name, message);
        }
        totalMessages += messages.length;
        hasMore = messagesResponse.has_more;
        cursor = messagesResponse.response_metadata?.next_cursor;
      }
      // Filter messages to only include those from the current year
      yearMessages = yearMessages.filter(msg => {
        const ts = parseFloat(msg.ts);
        return ts >= yearStart && ts <= yearEnd;
      });

      // --- FETCH THREAD REPLIES AND FLATTEN ---
      let threadReplyCount = 0;
      let messagesWithThreads = 0;
      // We will build a new array with threads flattened
      let flattenedMessages = [];
      for (let i = 0; i < yearMessages.length; i++) {
        const msg = yearMessages[i];
        flattenedMessages.push(msg);
        if (msg.thread_ts && msg.thread_ts === msg.ts) {
          // This is a thread parent
          messagesWithThreads++;
          const replies = await fetchThreadReplies(
            connection.accessToken,
            actualChannelId,
            msg.thread_ts,
            connection.userToken
          );
          if (replies && replies.length > 0) {
            threadReplyCount += replies.length;
            for (const reply of replies) {
              flattenedMessages.push(reply);
              await saveMessageToDatabase(connection.id, actualChannelId, channelInfo?.name, reply);
            }
            console.log(`[THREAD] Parent ts ${msg.ts}: fetched ${replies.length} replies`);
          }
        }
      }
      if (messagesWithThreads > 0) {
        console.log(`[THREAD] Year ${year}: ${messagesWithThreads} thread parents, ${threadReplyCount} replies fetched`);
      }
      yearMessages = flattenedMessages;
      // --- END THREAD REPLIES ---

      // --- DEBUG LOGGING: Check year assignment ---
      const sampleMessages = yearMessages.slice(0, 5).map(msg => {
        const ts = parseFloat(msg.ts);
        const msgYear = new Date(ts * 1000).getFullYear();
        return { ts: msg.ts, year: msgYear, text: msg.text?.slice(0, 40) };
      });
      console.log(`[DEBUG] Year ${year}: ${yearMessages.length} messages. Sample:`, sampleMessages);
      // Warn if any message is not in the current year
      yearMessages.forEach(msg => {
        const ts = parseFloat(msg.ts);
        const msgYear = new Date(ts * 1000).getFullYear();
        if (msgYear !== year) {
          console.warn(`[WARNING] Message with ts ${msg.ts} (year ${msgYear}) assigned to year ${year}. Text: ${msg.text?.slice(0, 40)}`);
        }
      });
      // --- END DEBUG LOGGING ---

      // Save to Google Docs for this year
      if (yearMessages.length > 0) {
        let messageType = job.channelType || 'channel';
        if (actualChannelId.startsWith('D')) messageType = 'dm';
        else if (actualChannelId.startsWith('G')) messageType = 'group';
        const docInfos = await saveMessagesToGoogleDocs(
          connection.id,
          actualChannelId,
          channelInfo?.name || 'Unknown Channel',
          yearMessages,
          messageType,
          connection,
          year // pass year for naming
        );
        if (docInfos && docInfos.length > 0) {
          docsCreated += docInfos.length;
          allDocInfos.push(...docInfos);
          // Save all doc infos in DB
          for (const docInfo of docInfos) {
            await prisma.slackChannelSelection.upsert({
              where: {
                slackConnectionId_channelId: {
                  slackConnectionId: connection.id,
                  channelId: actualChannelId
                }
              },
              update: {
                googleDocId: docInfo.docId,
                googleDocUrl: docInfo.url,
                channelType: messageType
              },
              create: {
                channelId: actualChannelId,
                googleDocId: docInfo.docId,
                googleDocUrl: docInfo.url,
                channelType: messageType,
                slackConnection: { connect: { id: connection.id } },
                user: { connect: { id: connection.userId } }
              }
            });
          }
        }
      }
    }
    // --- YEAR-WISE EXPORT LOGIC END ---

    // Log allMessages length at the end of each batch
    // console.log(`[DEBUG] allMessages length at end of batch ${totalFetchAttempts}: ${allMessages.length}`);

    // Save any remaining messages to Google Docs
    let googleDocResults = null;
    if (allMessages.length > 0) {
      try {
        // console.log(`[DEBUG] Calling saveMessagesToGoogleDocs for FINAL save with ${allMessages.length} messages...`);
        let messageType = job.channelType || 'channel';
        if (actualChannelId.startsWith('D')) {
          messageType = 'dm';
        } else if (actualChannelId.startsWith('G')) {
          messageType = 'group';
        }
        googleDocResults = await saveMessagesToGoogleDocs(
          connection.id,
          actualChannelId,
          channelInfo?.name || 'Unknown Channel',
          allMessages,
          messageType,
          connection
        );
        
        if (googleDocResults && googleDocResults.length > 0) {
          for (const docInfo of googleDocResults) {
            docsCreated++;
            console.log(`✅ History export: Final Google Doc created: ${docInfo.url}`);
            await prisma.slackChannelSelection.update({
              where: {
                slackConnectionId_channelId: {
                  slackConnectionId: connection.id,
                  channelId: actualChannelId
                }
              },
              data: {
                googleDocId: docInfo.docId,
                googleDocUrl: docInfo.url
              }
            });
          }
        }
      } catch (error) {
        console.error('History export: Final Google Docs save failed:', error);
      }
    }

    // Log allMessages length before final save
    console.log(`[DEBUG] allMessages length before FINAL save: ${allMessages.length}`);

    // Calculate final metrics
    const endTime = Date.now();
    const totalTimeMinutes = (endTime - startTime) / 60000;
    const finalMessagesPerMinute = totalTimeMinutes > 0 ? Math.round(totalMessages / totalTimeMinutes) : 0;

    // Job completed successfully
    await prisma.slackScrapingJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        progress: 100,
        messagesScraped: totalMessages,
        completedAt: new Date(),
        notes: `Year-wise export. ${docsCreated} Google Docs created.`
      }
    });

    console.log(`✅ History export completed for ${job.id}: ${totalMessages} messages total, ${docsCreated} Google Docs created`);
    console.log(`⏱️ Export took ${totalTimeMinutes.toFixed(2)} minutes (${finalMessagesPerMinute} msgs/min)`);
    console.log(`📊 Rate limiting: ${rateLimitHits} hits, ${(totalDelayTime / 1000).toFixed(2)}s total delay`);

    return {
      totalMessages,
      docsCreated,
      allDocInfos
    };

  } catch (error) {
    console.error(`❌ History export error for job ${job.id}:`, error);
    
    // Mark job as failed
    await prisma.slackScrapingJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        errorMessage: error.message,
        completedAt: new Date()
      }
    });
    
    console.error(`❌ History export job ${job.id} failed: ${error.message}`);
    throw error;
  }
}

// Helper functions (simplified versions)
async function getChannelInfo(accessToken, channelId) {
  console.log(`🔍 Getting info for channel ${channelId}...`);
  
  // Method 1: conversations.info (standard)
  try {
    const response = await slackRateLimiter.makeRequest(async () => {
      return await axios.get('https://slack.com/api/conversations.info', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: { channel: channelId }
      });
    }, `conversations.info for ${channelId}`);
    
    if (response.data.ok) {
      console.log(`✅ conversations.info: SUCCESS for ${channelId}`);
      return {
        name: response.data.channel.name,
        isPrivate: response.data.channel.is_private,
        isMember: response.data.channel.is_member
      };
    } else {
      console.log(`❌ conversations.info: ${response.data.error} for ${channelId}`);
    }
  } catch (error) {
    console.log(`❌ conversations.info error: ${error.message} for ${channelId}`);
  }
  
  // Method 2: Try channels.info (for public channels)
  if (channelId.startsWith('C')) {
    console.log(`🔄 Trying channels.info as fallback for ${channelId}...`);
    try {
      const channelsResponse = await slackRateLimiter.makeRequest(async () => {
        return await axios.get('https://slack.com/api/channels.info', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          params: { channel: channelId }
        });
      }, `channels.info for ${channelId}`);
      
      if (channelsResponse.data.ok) {
        console.log(`✅ channels.info: SUCCESS for ${channelId}`);
        return {
          name: channelsResponse.data.channel.name,
          isPrivate: false, // Public channel
          isMember: channelsResponse.data.channel.is_member
        };
      } else {
        console.log(`❌ channels.info: ${channelsResponse.data.error} for ${channelId}`);
      }
    } catch (error) {
      console.log(`❌ channels.info error: ${error.message} for ${channelId}`);
    }
  }
  
  // Method 3: Try groups.info (for private channels)
  if (channelId.startsWith('G')) {
    console.log(`🔄 Trying groups.info as fallback for ${channelId}...`);
    try {
      const groupsResponse = await slackRateLimiter.makeRequest(async () => {
        return await axios.get('https://slack.com/api/groups.info', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          params: { channel: channelId }
        });
      }, `groups.info for ${channelId}`);
      
      if (groupsResponse.data.ok) {
        console.log(`✅ groups.info: SUCCESS for ${channelId}`);
        return {
          name: groupsResponse.data.group.name,
          isPrivate: true, // Private channel
          isMember: groupsResponse.data.group.is_member
        };
      } else {
        console.log(`❌ groups.info: ${groupsResponse.data.error} for ${channelId}`);
      }
    } catch (error) {
      console.log(`❌ groups.info error: ${error.message} for ${channelId}`);
    }
  }
  
  console.log(`❌ Could not get info for channel ${channelId} using any method`);
  return null;
}

// Helper function to verify token scopes
async function verifyTokenScopes(token, channelId) {
  try {
    // First, check the token's identity
    const authTestFn = async () => {
      return await axios.get('https://slack.com/api/auth.test', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
    };

    console.log(`🔍 Verifying token identity for channel ${channelId}...`);
    const authResponse = await slackRateLimiter.makeRequest(authTestFn, 'verify token identity');
    
    if (!authResponse.data.ok) {
      return {
        ok: false,
        error: authResponse.data.error,
        errorMessage: `Token verification failed: ${authResponse.data.error}`
      };
    }
    
    console.log(`✅ Token identity verified: ${authResponse.data.user} (${authResponse.data.user_id}) on team ${authResponse.data.team} (${authResponse.data.team_id})`);
    
    // Next, check token scopes
    const scopesRequestFn = async () => {
      return await axios.get('https://slack.com/api/apps.auth.test', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
    };
    
    try {
      console.log(`🔍 Checking token scopes...`);
      const scopesResponse = await slackRateLimiter.makeRequest(scopesRequestFn, 'check token scopes');
      
      if (scopesResponse.data.ok) {
        const scopes = scopesResponse.data.scopes || [];
        console.log(`📋 Token has the following scopes: ${scopes.join(', ')}`);
        
        // Determine required scope based on channel type
        let requiredScope = 'channels:history';
        if (channelId.startsWith('G')) {
          requiredScope = 'groups:history';
        } else if (channelId.startsWith('D')) {
          requiredScope = 'im:history';
        }
        
        // Check if the required scope is present
        const hasRequiredScope = scopes.includes(requiredScope);
        console.log(`🔐 Required scope for channel ${channelId}: ${requiredScope} - Present: ${hasRequiredScope}`);
        
        if (!hasRequiredScope) {
          return {
            ok: false,
            error: 'missing_scope',
            errorMessage: `Token is missing required scope: ${requiredScope}. Current scopes: ${scopes.join(', ')}`,
            requiredScope,
            currentScopes: scopes
          };
        }
        
        return {
          ok: true,
          tokenInfo: authResponse.data,
          requiredScope,
          scopes
        };
      } else {
        console.log(`⚠️ Could not verify token scopes: ${scopesResponse.data.error}`);
      }
    } catch (scopesError) {
      console.log(`⚠️ Error checking token scopes: ${scopesError.message}`);
    }
    
    // If we couldn't check scopes directly, try a test request to the channel
    console.log(`🔍 Performing test request to channel ${channelId}...`);
    
    // Determine which API to use based on channel type
    let testEndpoint = 'conversations.history';
    
    const testRequestFn = async () => {
      return await axios.get(`https://slack.com/api/${testEndpoint}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        params: {
          channel: channelId,
          limit: 1
        }
      });
    };
    
    const testResponse = await slackRateLimiter.makeRequest(testRequestFn, `test request to ${channelId}`);
    
    if (testResponse.data.ok) {
      console.log(`✅ Test request successful for channel ${channelId}`);
      
      // Determine required scope based on channel type
      let requiredScope = 'channels:history';
      if (channelId.startsWith('G')) {
        requiredScope = 'groups:history';
      } else if (channelId.startsWith('D')) {
        requiredScope = 'im:history';
      }
      
      return {
        ok: true,
        tokenInfo: authResponse.data,
        requiredScope
      };
    } else {
      const error = testResponse.data.error;
      console.log(`❌ Test request failed: ${error}`);
      
      if (error === 'missing_scope') {
        // Extract the required scope from the error message if available
        const errorDetail = testResponse.data.needed || '';
        const requiredScope = errorDetail || (
          channelId.startsWith('C') ? 'channels:history' : 
          channelId.startsWith('G') ? 'groups:history' : 
          channelId.startsWith('D') ? 'im:history' : 'channels:history'
        );
        
        return {
          ok: false,
          error: 'missing_scope',
          errorMessage: `Token is missing required scope: ${requiredScope}. Error: ${testResponse.data.error}`,
          requiredScope
        };
      } else if (error === 'not_in_channel') {
        return {
          ok: false,
          error: 'not_in_channel',
          errorMessage: `Token user is not in channel ${channelId}. Please invite the user to this channel.`
        };
      } else if (error === 'channel_not_found') {
        return {
          ok: false,
          error: 'channel_not_found',
          errorMessage: `Channel ${channelId} not found or token doesn't have access.`
        };
      }
      
      return {
        ok: false,
        error: error,
        errorMessage: `Test request failed: ${error}`
      };
    }
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      errorMessage: `Token verification failed: ${error.message}`
    };
  }
}

async function getUsersMap(userToken, teamId) {
  const usersMap = new Map();
  
  try {
    const requestFn = async () => {
      return await axios.get('https://slack.com/api/users.list', {
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      });
    };

    const response = await slackRateLimiter.makeRequest(requestFn, 'fetch users list');
    
    if (response.data.ok) {
      response.data.members.forEach(user => {
        usersMap.set(user.id, user);
      });
    }
  } catch (error) {
    console.error('Error fetching users:', error.message);
  }
  
  return usersMap;
}

async function fetchChannelMessages(accessToken, channelId, cursor = null, limit = 100, userToken = null, oldest = null, latest = null) {
  // Determine which token to use based on channel type and available tokens
  let token = accessToken; // Default to bot token
  let tokenType = 'Bot Token';
  
  // ALWAYS use user token if available, regardless of channel type
  if (userToken) {
    token = userToken;
    tokenType = 'User Token';
    console.log(`🔄 Using User Token for ${channelId} (preferred over bot token)`);
  } else {
    console.log(`⚠️ No User Token available, falling back to Bot Token for ${channelId}`);
  }

  // For DMs, use a smaller batch size to avoid rate limits
  if (channelId.startsWith('D')) {
    const originalLimit = limit;
    limit = Math.min(limit, 50); // Cap at 50 for DMs
    if (originalLimit !== limit) {
      console.log(`⚠️ Reducing batch size for DM from ${originalLimit} to ${limit} to avoid rate limits`);
    }
  }
  
  // Try multiple API methods for better success rate
  console.log(`🔄 Fetching messages from ${channelId} using ${tokenType}...`);
  
  // Method 1: conversations.history (standard)
  try {
    // Note: As of May 29, 2025 for non-Marketplace apps, this method will be 
    // rate limited to 1 request per minute with max limit of 15 objects
    const params = {
      channel: channelId,
      // limit: limit,
      limit: 1000,
      oldest: oldest ? oldest.toString() : "0",
      latest: latest ? latest.toString() : "0",
      // Optional parameters that could be used:
      // oldest: timestamp - start of time range
      // latest: timestamp - end of time range
      // inclusive: boolean - include messages with timestamps matching oldest/latest
      // include_all_metadata: boolean - include all metadata about messages
    };
    
    if (cursor) {
      params.cursor = cursor;
    }
    
    const response = await slackRateLimiter.makeRequest(async () => {
      return await axios.get('https://slack.com/api/conversations.history', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        params
      });
    }, `conversations.history for ${channelId}`);
    
    if (response.data.ok) {
      console.log(`✅ conversations.history: SUCCESS for ${channelId}`);
      
      // Add debug info about what Slack actually returned
      console.log(`📊 Slack response details: Requested ${limit} messages, got ${response.data.messages.length}`);
      console.log(`📊 Response has_more: ${response.data.has_more}, is_limited: ${response.data.is_limited || false}`);
      
      // Check if there are any rate limit headers
      const rateHeaders = {};
      if (response.headers) {
        ['x-rate-limit-limit', 'x-rate-limit-remaining', 'x-rate-limit-reset', 'retry-after'].forEach(header => {
          if (response.headers[header]) {
            rateHeaders[header] = response.headers[header];
          }
        });
        
        if (Object.keys(rateHeaders).length > 0) {
          console.log(`📊 Rate limit headers:`, rateHeaders);
        }
      }
      
      return {
        ok: true,
        messages: response.data.messages,
        has_more: response.data.has_more,
        response_metadata: response.data.response_metadata
      };
    } else {
      console.log(`❌ conversations.history: ${response.data.error} for ${channelId}`);
      
      // If first attempt with user token fails, try bot token as fallback for public channels
      if (tokenType === 'User Token' && response.data.error && accessToken && token !== accessToken && channelId.startsWith('C')) {
        console.log(`⚠️ User Token failed with error: ${response.data.error}. Trying Bot Token as fallback...`);
        
        // Try again with bot token
        const fallbackResponse = await slackRateLimiter.makeRequest(async () => {
          return await axios.get('https://slack.com/api/conversations.history', {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            params
          });
        }, `fallback conversations.history for ${channelId}`);
        
        if (fallbackResponse.data.ok) {
          console.log(`✅ Bot Token fallback successful for ${channelId}`);
          return {
            ok: true,
            messages: fallbackResponse.data.messages,
            has_more: fallbackResponse.data.has_more,
            response_metadata: fallbackResponse.data.response_metadata
          };
        }
        
        console.log(`❌ Bot Token fallback also failed: ${fallbackResponse.data.error} for ${channelId}`);
      }
      
      // Method 2: Try channels.history (for public channels)
      if (channelId.startsWith('C')) {
        console.log(`🔄 Trying channels.history as fallback for ${channelId}...`);
        try {
          const channelsResponse = await slackRateLimiter.makeRequest(async () => {
            return await axios.get('https://slack.com/api/channels.history', {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              params
            });
          }, `channels.history for ${channelId}`);
          
          if (channelsResponse.data.ok) {
            console.log(`✅ channels.history: SUCCESS for ${channelId}`);
            return {
              ok: true,
              messages: channelsResponse.data.messages,
              has_more: channelsResponse.data.has_more,
              response_metadata: channelsResponse.data.response_metadata
            };
          } else {
            console.log(`❌ channels.history: ${channelsResponse.data.error} for ${channelId}`);
          }
        } catch (error) {
          console.log(`❌ channels.history error: ${error.message} for ${channelId}`);
        }
      }
      
      // Method 3: Try groups.history (for private channels)
      if (channelId.startsWith('G')) {
        console.log(`🔄 Trying groups.history as fallback for ${channelId}...`);
        try {
          const groupsResponse = await slackRateLimiter.makeRequest(async () => {
            return await axios.get('https://slack.com/api/groups.history', {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              params
            });
          }, `groups.history for ${channelId}`);
          
          if (groupsResponse.data.ok) {
            console.log(`✅ groups.history: SUCCESS for ${channelId}`);
            return {
              ok: true,
              messages: groupsResponse.data.messages,
              has_more: groupsResponse.data.has_more,
              response_metadata: groupsResponse.data.response_metadata
            };
          } else {
            console.log(`❌ groups.history: ${groupsResponse.data.error} for ${channelId}`);
          }
        } catch (error) {
          console.log(`❌ groups.history error: ${error.message} for ${channelId}`);
        }
      }
      
      // Method 4: Try im.history (for DMs)
      if (channelId.startsWith('D')) {
        console.log(`🔄 Trying im.history as fallback for ${channelId}...`);
        try {
          const imResponse = await slackRateLimiter.makeRequest(async () => {
            return await axios.get('https://slack.com/api/im.history', {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              params
            });
          }, `im.history for ${channelId}`);
          
          if (imResponse.data.ok) {
            console.log(`✅ im.history: SUCCESS for ${channelId}`);
            return {
              ok: true,
              messages: imResponse.data.messages,
              has_more: imResponse.data.has_more,
              response_metadata: imResponse.data.response_metadata
            };
          } else {
            console.log(`❌ im.history: ${imResponse.data.error} for ${channelId}`);
          }
        } catch (error) {
          console.log(`❌ im.history error: ${error.message} for ${channelId}`);
        }
      }
      
      // Handle specific error cases if all methods failed
      const error = response.data.error;
      if (error === 'not_in_channel') {
        console.log(`⚠️ ${tokenType} not in channel ${channelId}. This channel requires the user or bot to be a member.`);
        return {
          ok: false,
          error: 'not_in_channel',
          errorMessage: `${tokenType} needs to be invited to channel ${channelId}. Please invite the user or bot to this channel in Slack.`
        };
      } else if (error === 'channel_not_found') {
        console.log(`⚠️ Channel ${channelId} not found or token doesn't have access.`);
        return {
          ok: false,
          error: 'channel_not_found',
          errorMessage: `Channel ${channelId} not found or token doesn't have access.`
        };
      } else if (error === 'missing_scope') {
        const requiredScopes = channelId.startsWith('C') ? 'channels:history' : 
                             channelId.startsWith('G') ? 'groups:history' : 
                             channelId.startsWith('D') ? 'im:history' : 'channels:history';
        
        console.log(`⚠️ Missing required scope for channel ${channelId}. Required scope: ${requiredScopes}`);
        
        // Provide detailed error message with token type
        return {
          ok: false,
          error: 'missing_scope',
          errorMessage: `${tokenType} is missing required scope for channel ${channelId}. Please ensure the ${tokenType === 'Bot Token' ? 'Slack app' : 'user'} has the '${requiredScopes}' scope. For private channels and DMs, user token with appropriate scopes may be required.`
        };
      }
      
      return {
        ok: false,
        error: error,
        errorMessage: `Slack API error: ${error}`
      };
    }
  } catch (error) {
    console.error(`❌ Error fetching messages for ${channelId}:`, error.message);
    return {
      ok: false,
      error: 'api_error',
      errorMessage: `API Error: ${error.message}`
    };
  }
}

async function fetchThreadReplies(accessToken, channelId, threadTs, userToken = null) {
  // Determine which token to use based on channel type and available tokens
  let token = accessToken; // Default to bot token
  let tokenType = 'Bot Token';
  
  // ALWAYS use user token if available, regardless of channel type
  if (userToken) {
    token = userToken;
    tokenType = 'User Token';
    console.log(`🔄 Using User Token for thread ${threadTs} in ${channelId} (preferred over bot token)`);
  } else {
    console.log(`⚠️ No User Token available, falling back to Bot Token for thread ${threadTs} in ${channelId}`);
  }

  console.log(`🧵 Fetching thread replies for ${threadTs} in ${channelId} using ${tokenType}...`);
  
  // Method 1: conversations.replies (standard)
  try {
    const response = await slackRateLimiter.makeRequest(async () => {
      return await axios.get('https://slack.com/api/conversations.replies', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        params: {
          channel: channelId,
          ts: threadTs
        }
      });
    }, `conversations.replies for ${threadTs}`);
    
    if (response.data.ok) {
      console.log(`✅ conversations.replies: SUCCESS for thread ${threadTs} (${response.data.messages.length - 1} replies)`);
      return response.data.messages.slice(1); // Skip the first message (parent)
    } else {
      console.log(`❌ conversations.replies: ${response.data.error} for thread ${threadTs}`);
      
      // If first attempt with user token fails, try bot token as fallback for public channels
      if (tokenType === 'User Token' && response.data.error && accessToken && token !== accessToken && channelId.startsWith('C')) {
        console.log(`⚠️ User Token failed with error: ${response.data.error}. Trying Bot Token as fallback...`);
        
        const fallbackResponse = await slackRateLimiter.makeRequest(async () => {
          return await axios.get('https://slack.com/api/conversations.replies', {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            params: {
              channel: channelId,
              ts: threadTs
            }
          });
        }, `fallback conversations.replies for ${threadTs}`);
        
        if (fallbackResponse.data.ok) {
          console.log(`✅ Bot Token fallback successful for thread ${threadTs}`);
          return fallbackResponse.data.messages.slice(1); // Skip the first message (parent)
        }
        
        console.log(`❌ Bot Token fallback also failed: ${fallbackResponse.data.error} for thread ${threadTs}`);
      }
    }
  } catch (error) {
    console.error(`❌ Error fetching thread replies for ${threadTs}:`, error.message);
  }
  
  // Return empty array if all methods failed
  console.log(`⚠️ Could not fetch thread replies for ${threadTs}, returning empty array`);
  return [];
}

async function saveMessageToDatabase(connectionId, channelId, channelName, message) {
  try {
    let finalChannelName = channelName;
    if (!finalChannelName || finalChannelName === 'Unknown') {
      const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
      if (connection) {
        const channelInfo = await getChannelInfo(connection.accessToken, channelId);
        if (channelInfo && channelInfo.name) {
          finalChannelName = channelInfo.name;
        } else {
          finalChannelName = 'Unknown';
        }
      } else {
        finalChannelName = 'Unknown';
      }
    }
    await prisma.slackConversation.upsert({
      where: {
        slackConnectionId_messageTs: {
          slackConnectionId: connectionId,
          messageTs: message.ts
        }
      },
      update: {
        messageText: message.text || ''
      },
      create: {
        slackConnectionId: connectionId,
        messageTs: message.ts,
        channelId: channelId,
        channelName: finalChannelName,
        userId: message.user || '',
        userName: '', // Will be populated later if needed
        messageText: message.text || '',
        messageType: channelId.startsWith('D') ? 'dm' : 'channel',
        participants: [],
        tags: [],
        slackSentAt: message.ts ? new Date(parseFloat(message.ts) * 1000) : undefined
      }
    });
  } catch (error) {
    console.error('Error saving message to database:', error);
  }
}

async function saveMessagesToGoogleDocs(connectionId, channelId, channelName, messages, messageType, connection, year) {
  console.log(`[DEBUG] saveMessagesToGoogleDocs called for channel: ${channelName}, messages: ${messages ? messages.length : 0}, type: ${messageType}`);
  try {
    if (!messages || messages.length === 0) {
      console.log(`[DEBUG] No messages to save to Google Docs for ${channelName}`);
      return null;
    }

    // Check if Google APIs are configured
    if (!drive || !docs) {
      console.warn(`[DEBUG] Google APIs not configured - skipping Google Docs save for ${channelName}`);
      return null;
    }

    // Get connection info for user context
    const userInfo = connection ? {
      userId: connection.slackUserId,
      teamName: connection.slackTeamName
    } : null;

    // Setup folder structure with user-specific folders using the year argument
    const folders = await setupGoogleDriveFolders(year, userInfo);
    console.log(`[DEBUG] Folders resolved:`, folders);

    // Determine target folder based on message type
    const targetFolderId = messageType === 'dm' ? folders.dmFolderId : folders.channelFolderId;
    console.log(`[DEBUG] Target folder ID: ${targetFolderId}`);

    // Extract user names for DM naming
    let userNames = [];
    if (messageType === 'dm') {
      // Try to extract user names from messages
      const uniqueUsers = new Set();
      messages.forEach(msg => {
        if (msg.user_profile?.display_name) {
          uniqueUsers.add(msg.user_profile.display_name);
        } else if (msg.user_profile?.real_name) {
          uniqueUsers.add(msg.user_profile.real_name);
        } else if (msg.username) {
          uniqueUsers.add(msg.username);
        }
      });
      userNames = Array.from(uniqueUsers).slice(0, 2); // Take first 2 users
      console.log(`[DEBUG] DM userNames:`, userNames);
    }

    // Generate document name using the year argument
    let documentName = year ? `${year}-` : '';
    if (messageType === 'dm' && userNames.length > 0) {
      // For DMs, use the format: [ProfileName] ↔ [OtherName]
      let currentUserName = 'User';
      if (connection && connection.slackUserName) {
        currentUserName = connection.slackUserName;
      } else if (userInfo && userInfo.userName) {
        currentUserName = userInfo.userName;
      }
      const otherUserName = userNames.filter(name => name !== currentUserName)[0] || userNames[0];
      documentName += `${currentUserName} ↔ ${otherUserName}`;
      console.log(`[DEBUG] DM documentName: ${documentName}`);
    } else {
      documentName += `${channelName}`;
      console.log(`[DEBUG] Channel documentName: ${documentName}`);
    }

    // Check for existing document
    const searchResponse = await drive.files.list({
      q: `name='${documentName}_Part1' and mimeType='application/vnd.google-apps.document' and '${targetFolderId}' in parents and trashed=false`,
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime desc'
    });
    let docId = null;
    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      docId = searchResponse.data.files[0].id;
      console.log(`[DEBUG] Found existing document for ${documentName}_Part1: ${docId}`);
    }

    // Get users map for resolving user IDs to names
    const usersMap = await getUsersMap(connection.userToken || connection.accessToken, connection.slackTeamId);
    console.log(`[DEBUG] usersMap size: ${usersMap.size}`);

    // Group messages by user for DMs
    let formattedContent = '';
    if (messageType === 'dm' || messageType === 'channel' || messageType === 'group') {
      // Interleaved: latest on top, oldest on bottom
      for (const msg of messages.slice().reverse()) {
        let username = 'Unknown User';
        if (msg.user_profile?.display_name || msg.user_profile?.real_name) {
          username = msg.user_profile?.display_name || msg.user_profile?.real_name;
        } else if (msg.username) {
          username = msg.username;
        } else if (msg.user && usersMap.has(msg.user)) {
          const userInfo = usersMap.get(msg.user);
          username = userInfo.display_name || userInfo.real_name || userInfo.name || msg.user;
        } else if (msg.user) {
          username = msg.user;
        }
        const date = new Date(parseFloat(msg.ts) * 1000);
        const cleanText = replaceSlackMentions(msg.text, usersMap);
        formattedContent += `[${date.toLocaleString()}] ${username}: ${cleanText}\n\n`;
      }
      console.log(`[DEBUG] formattedContent length: ${formattedContent.length}`);
    }

    // Check if content is too large and needs to be split into multiple documents
    const maxDocumentSize = 800 * 1024; // 800KB per document (safer limit)
    const contentBytes = new TextEncoder().encode(formattedContent).length;
    console.log(`[DEBUG] contentBytes: ${contentBytes}`);
    if (contentBytes > maxDocumentSize) {
      console.log(`[DEBUG] Content too large, calling createMultipleDocuments`);
      const docs = await createMultipleDocuments(documentName, formattedContent, targetFolderId, messageType);
      return docs; // Always return array
    }

    // Create or update document
    if (!docId) {
      console.log(`[DEBUG] Creating new Google Doc: ${documentName}_Part1`);
      const createResponse = await drive.files.create({
        requestBody: {
          name: `${documentName}_Part1`,
          mimeType: 'application/vnd.google-apps.document',
          parents: [targetFolderId]
        },
        fields: 'id'
      });
      docId = createResponse.data.id;
      console.log(`[DEBUG] Created document: ${documentName}_Part1 (${docId})`);
    }

    // Format header
    const currentDate = new Date().toISOString();
    const headerText = `${documentName}\nExport Date: ${currentDate}\nType: ${messageType === 'dm' ? 'Direct Message' : 'Channel'}\nTotal Messages: ${messages.length}\n============================================================\n\n`;
    // Add content to document
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: headerText + formattedContent
            }
          }
        ]
      }
    });
    const docUrl = `https://docs.google.com/document/d/${docId}`;
    console.log(`[DEBUG] Document ready: ${docUrl}`);
    return [{
      docId,
      title: `${documentName}_Part1`,
      url: docUrl,
      messageCount: messages.length
    }];
  } catch (error) {
    console.error(`[DEBUG] Error creating/updating Google Doc for ${channelName}:`, error);
    return null;
  }
}

// Helper function to create multiple documents for large content
async function createMultipleDocuments(documentName, formattedContent, targetFolderId, messageType) {
  try {
    const maxDocumentSize = 800 * 1024; // 800KB per document
    const currentDate = new Date().toISOString();
    // Create header content
    const headerContent = `${documentName}\nExport Date: ${currentDate}\nType: ${messageType === 'dm' ? 'Direct Message' : 'Channel'}\n============================================================\n\n`;
    // Split content into parts
    const contentParts = [];
    let remainingContent = formattedContent;
    while (new TextEncoder().encode(remainingContent).length > maxDocumentSize) {
      // Find a split point
      let splitIndex = Math.floor(remainingContent.length * maxDocumentSize / new TextEncoder().encode(remainingContent).length);
      splitIndex = remainingContent.lastIndexOf('\n', splitIndex);
      if (splitIndex <= 0) splitIndex = Math.floor(remainingContent.length / 2);
      contentParts.push(remainingContent.slice(0, splitIndex));
      remainingContent = remainingContent.slice(splitIndex);
    }
    contentParts.push(remainingContent);
    const documents = [];
    for (let i = 0; i < contentParts.length; i++) {
      const docTitle = `${documentName}_Part${i+1}`;
      // Always create in the correct folder
      const createResponse = await drive.files.create({
        requestBody: {
          name: docTitle,
          mimeType: 'application/vnd.google-apps.document',
          parents: [targetFolderId]
        },
        fields: 'id'
      });
      const docId = createResponse.data.id;
      // Add content
      await docs.documents.batchUpdate({
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
      });
      documents.push({
        docId,
        title: docTitle,
        url: `https://docs.google.com/document/d/${docId}`
      });
    }
    console.log(`✅ Created ${documents.length} documents for "${documentName}"`);
    return documents.length > 0 ? documents : [];
  } catch (error) {
    console.error(`❌ Error creating multiple documents:`, error);
    return null;
  }
}

// Process pending history export jobs
async function processPendingHistoryExportJobs() {
  try {
    console.log('🔄 Processing pending history export jobs...');
    
    // Get all pending history export jobs
    const pendingJobs = await prisma.slackScrapingJob.findMany({
      where: { 
        status: 'pending',
        jobType: 'history_export'
      },
      include: {
        slackConnection: true
      },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`📊 Found ${pendingJobs.length} pending history export jobs`);

    if (pendingJobs.length === 0) {
      console.log('✅ No pending history export jobs to process');
      return;
    }

    // Before processing jobs, check token validity for all connections
    console.log(`🔑 Checking token validity for all connections...`);
    for (const job of pendingJobs) {
      const connection = job.slackConnection;
      if (!connection) {
        console.error(`❌ No Slack connection found for job ${job.id}`);
        continue;
      }

      // Check if tokens are valid
      await checkTokenValidity(connection, job);
    }

    // Process jobs in parallel with concurrency limit
    const concurrencyLimit = 2; // Conservative limit for history export
    const jobBatches = [];
    
    for (let i = 0; i < pendingJobs.length; i += concurrencyLimit) {
      jobBatches.push(pendingJobs.slice(i, i + concurrencyLimit));
    }

    console.log(`🔄 Processing ${pendingJobs.length} history export jobs in ${jobBatches.length} batches of ${concurrencyLimit}`);

    // Track job results
    const jobResults = {
      completed: 0,
      failed: 0,
      totalMessages: 0,
      errors: []
    };

    for (let batchIndex = 0; batchIndex < jobBatches.length; batchIndex++) {
      const batch = jobBatches[batchIndex];
      console.log(`📦 Processing history export batch ${batchIndex + 1}/${jobBatches.length} with ${batch.length} jobs`);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (job) => {
        try {
          console.log(`🚀 Starting history export job ${job.id}: ${job.channelType} ${job.channelId}`);
          const result = await processHistoryExportJob(job.slackConnection, job);
          
          // Update job results
          jobResults.completed++;
          if (result && result.totalMessages) {
            jobResults.totalMessages += result.totalMessages;
          }
          
          return result;
        } catch (error) {
          console.error(error);
          jobResults.failed++;
          jobResults.errors.push({
            jobId: job.id,
            channelId: job.channelId,
            error: error.message
          });
        }
      });

      // Wait for current batch to complete before starting next batch
      await Promise.all(batchPromises);
      
      // Longer delay between batches for history export to be more conservative
      if (batchIndex < jobBatches.length - 1) {
        console.log(`⏳ History export batch ${batchIndex + 1} complete, waiting 1000ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Print job results summary
    console.log(`✅ History export jobs completed: ${jobResults.completed}/${pendingJobs.length}`);
    console.log(`❌ History export jobs failed: ${jobResults.failed}/${pendingJobs.length}`);
    console.log(`📊 Total messages processed: ${jobResults.totalMessages}`);
    
    if (jobResults.errors.length > 0) {
      console.log(`⚠️ Errors summary:`);
      jobResults.errors.forEach(err => {
        console.log(`  - Job ${err.jobId} (channel ${err.channelId}): ${err.error}`);
      });
      
      // If all jobs failed with missing scope errors, provide guidance
      const allMissingScope = jobResults.errors.every(err => err.error.includes('Missing required scope'));
      if (allMissingScope) {
        console.log(`
🔑 All jobs failed due to missing scopes. Please check your Slack app configuration:
1. Go to https://api.slack.com/apps and select your app
2. Navigate to "OAuth & Permissions"
3. Ensure your app has these scopes: channels:history, groups:history, im:history
4. Reinstall the app to your workspace to apply the new scopes
5. Update the tokens in your database`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error processing pending history export jobs:', error);
  }
}

// Helper function to check token validity
async function checkTokenValidity(connection, job) {
  console.log(`🔑 Checking token validity for job ${job.id} (channel ${job.channelId})...`);
  
  // Check if we have both bot token and user token
  const hasBotToken = !!connection.accessToken;
  const hasUserToken = !!connection.userToken;
  
  console.log(`📋 Available tokens: Bot token: ${hasBotToken ? 'Yes' : 'No'}, User token: ${hasUserToken ? 'Yes' : 'No'}`);
  
  // Always try user token first if available (PREFERRED)
  if (hasUserToken) {
    console.log(`🔍 Checking user token validity (PREFERRED)...`);
    try {
      const userTokenCheck = await axios.get('https://slack.com/api/auth.test', {
        headers: {
          'Authorization': `Bearer ${connection.userToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (userTokenCheck.data.ok) {
        console.log(`✅ User token is valid: ${userTokenCheck.data.user} (${userTokenCheck.data.user_id})`);
        
        // Check if token has the required scope
        try {
          const scopesCheck = await axios.get('https://slack.com/api/apps.auth.test', {
            headers: {
              'Authorization': `Bearer ${connection.userToken}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (scopesCheck.data.ok) {
            const scopes = scopesCheck.data.scopes || [];
            console.log(`📋 User token has the following scopes: ${scopes.join(', ')}`);
            
            // Check for required scope based on channel type
            let requiredScope = 'channels:history';
            if (job.channelId.startsWith('G')) {
              requiredScope = 'groups:history';
            } else if (job.channelId.startsWith('D')) {
              requiredScope = 'im:history';
            }
            
            const hasRequiredScope = scopes.includes(requiredScope);
            console.log(`🔐 Required scope for channel ${job.channelId}: ${requiredScope} - Present: ${hasRequiredScope}`);
            
            if (!hasRequiredScope) {
              console.warn(`⚠️ User token is missing required scope: ${requiredScope}`);
              
              // Update job with warning
              await prisma.slackScrapingJob.update({
                where: { id: job.id },
                data: {
                  notes: `Warning: User token is missing required scope: ${requiredScope}. Available scopes: ${scopes.join(', ')}`
                }
              });
            }
          }
        } catch (scopesError) {
          console.warn(`⚠️ Could not check user token scopes: ${scopesError.message}`);
        }
        
        // Check if user is in the channel
        try {
          const channelCheck = await axios.get('https://slack.com/api/conversations.info', {
            headers: {
              'Authorization': `Bearer ${connection.userToken}`,
              'Content-Type': 'application/json'
            },
            params: {
              channel: job.channelId
            }
          });
          
          if (channelCheck.data.ok) {
            console.log(`✅ Channel ${job.channelId} exists and is accessible`);
            
            // For public channels, check if user is a member
            if (job.channelId.startsWith('C')) {
              const isMember = channelCheck.data.channel.is_member;
              console.log(`👤 User is ${isMember ? '' : 'not '}a member of channel ${job.channelId}`);
              
              if (!isMember) {
                console.warn(`⚠️ User is not a member of channel ${job.channelId}. This may cause issues.`);
                
                // Update job with warning
                await prisma.slackScrapingJob.update({
                  where: { id: job.id },
                  data: {
                    notes: `Warning: User is not a member of channel ${job.channelId}. Please invite the user to this channel.`
                  }
                });
              }
            }
          } else {
            console.warn(`⚠️ Could not access channel ${job.channelId}: ${channelCheck.data.error}`);
            
            // Update job with warning
            await prisma.slackScrapingJob.update({
              where: { id: job.id },
              data: {
                notes: `Warning: Could not access channel ${job.channelId}: ${channelCheck.data.error}`
              }
            });
          }
        } catch (channelError) {
          console.warn(`⚠️ Error checking channel access: ${channelError.message}`);
        }
      } else {
        console.warn(`⚠️ User token is invalid: ${userTokenCheck.data.error}`);
        
        // Update job with warning
        await prisma.slackScrapingJob.update({
          where: { id: job.id },
          data: {
            notes: `Warning: User token is invalid: ${userTokenCheck.data.error}`
          }
        });
      }
    } catch (error) {
      console.warn(`⚠️ Error checking user token: ${error.message}`);
    }
  }
  
  // Check bot token
  if (hasBotToken) {
    console.log(`🔍 Checking bot token validity...`);
    try {
      const botTokenCheck = await axios.get('https://slack.com/api/auth.test', {
        headers: {
          'Authorization': `Bearer ${connection.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (botTokenCheck.data.ok) {
        console.log(`✅ Bot token is valid: ${botTokenCheck.data.bot_id || 'Unknown bot'}`);
        
        // Check if bot is in the channel
        try {
          const channelCheck = await axios.get('https://slack.com/api/conversations.info', {
            headers: {
              'Authorization': `Bearer ${connection.accessToken}`,
              'Content-Type': 'application/json'
            },
            params: {
              channel: job.channelId
            }
          });
          
          if (channelCheck.data.ok) {
            console.log(`✅ Channel ${job.channelId} exists and is accessible to bot`);
            
            // For public channels, check if bot is a member
            if (job.channelId.startsWith('C') && channelCheck.data.channel.is_member !== undefined) {
              const isMember = channelCheck.data.channel.is_member;
              console.log(`🤖 Bot is ${isMember ? '' : 'not '}a member of channel ${job.channelId}`);
              
              if (!isMember) {
                console.warn(`⚠️ Bot is not a member of channel ${job.channelId}. This may cause issues.`);
                
                // Update job with warning
                await prisma.slackScrapingJob.update({
                  where: { id: job.id },
                  data: {
                    notes: `Warning: Bot is not a member of channel ${job.channelId}. Please invite the bot to this channel.`
                  }
                });
              }
            }
          } else {
            console.warn(`⚠️ Bot could not access channel ${job.channelId}: ${channelCheck.data.error}`);
            
            // Update job with warning
            await prisma.slackScrapingJob.update({
              where: { id: job.id },
              data: {
                notes: `Warning: Bot could not access channel ${job.channelId}: ${channelCheck.data.error}`
              }
            });
          }
        } catch (channelError) {
          console.warn(`⚠️ Error checking bot channel access: ${channelError.message}`);
        }
      } else {
        console.warn(`⚠️ Bot token is invalid: ${botTokenCheck.data.error}`);
        
        // Update job with warning
        await prisma.slackScrapingJob.update({
          where: { id: job.id },
          data: {
            notes: `Warning: Bot token is invalid: ${botTokenCheck.data.error}`
          }
        });
      }
    } catch (error) {
      console.warn(`⚠️ Error checking bot token: ${error.message}`);
    }
  }
}

// Schedule the history export job processor
function startHistoryExportProcessor() {
  console.log('📅 Starting history export job processor...');
  
  // Run every 5 minutes to check for pending jobs
  cron.schedule('*/5 * * * *', () => {
    console.log('🔄 Running history export job processor...');
    processPendingHistoryExportJobs();
  });
  
  // For development, also run immediately
  if (process.env.NODE_ENV === 'development') {
    console.log('🔧 Development mode: Running history export processor immediately');
    processPendingHistoryExportJobs();
  }
}

module.exports = {
  startHistoryExportProcessor,
  processPendingHistoryExportJobs,
  processHistoryExportJob,
  testSlackConnection // Export the test function for use in other modules
};

// Add a function to test a Slack connection
async function testSlackConnection(connectionId) {
  try {
    console.log(`🔍 Testing Slack connection ${connectionId}...`);
    
    // Get the connection from the database
    const connection = await prisma.slackConnection.findUnique({
      where: { id: connectionId }
    });
    
    if (!connection) {
      return {
        success: false,
        error: `Connection ${connectionId} not found`
      };
    }
    
    const results = {
      botToken: { valid: false, scopes: [], error: null },
      userToken: { valid: false, scopes: [], error: null },
      channels: []
    };
    
    // Test bot token
    if (connection.accessToken) {
      try {
        const botTest = await axios.get('https://slack.com/api/auth.test', {
          headers: {
            'Authorization': `Bearer ${connection.accessToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (botTest.data.ok) {
          results.botToken.valid = true;
          results.botToken.info = botTest.data;
          
          // Check bot scopes
          try {
            const botScopes = await axios.get('https://slack.com/api/apps.auth.test', {
              headers: {
                'Authorization': `Bearer ${connection.accessToken}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (botScopes.data.ok) {
              results.botToken.scopes = botScopes.data.scopes || [];
            }
          } catch (scopeError) {
            results.botToken.error = `Could not check bot scopes: ${scopeError.message}`;
          }
        } else {
          results.botToken.error = botTest.data.error;
        }
      } catch (error) {
        results.botToken.error = error.message;
      }
    }
    
    // Test user token
    if (connection.userToken) {
      try {
        const userTest = await axios.get('https://slack.com/api/auth.test', {
          headers: {
            'Authorization': `Bearer ${connection.userToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (userTest.data.ok) {
          results.userToken.valid = true;
          results.userToken.info = userTest.data;
          
          // Check user scopes
          try {
            const userScopes = await axios.get('https://slack.com/api/apps.auth.test', {
              headers: {
                'Authorization': `Bearer ${connection.userToken}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (userScopes.data.ok) {
              results.userToken.scopes = userScopes.data.scopes || [];
              
              // Check if user has the required scopes
              const hasChannelsHistory = results.userToken.scopes.includes('channels:history');
              const hasGroupsHistory = results.userToken.scopes.includes('groups:history');
              const hasImHistory = results.userToken.scopes.includes('im:history');
              
              results.userToken.hasRequiredScopes = {
                channelsHistory: hasChannelsHistory,
                groupsHistory: hasGroupsHistory,
                imHistory: hasImHistory,
                allRequired: hasChannelsHistory && hasGroupsHistory && hasImHistory
              };
            }
          } catch (scopeError) {
            results.userToken.error = `Could not check user scopes: ${scopeError.message}`;
          }
          
          // Test listing channels
          try {
            const channelsResponse = await axios.get('https://slack.com/api/conversations.list', {
              headers: {
                'Authorization': `Bearer ${connection.userToken}`,
                'Content-Type': 'application/json'
              },
              params: {
                limit: 10,
                types: 'public_channel,private_channel'
              }
            });
            
            if (channelsResponse.data.ok) {
              // Test a sample of channels
              const sampleChannels = channelsResponse.data.channels.slice(0, 3);
              
              for (const channel of sampleChannels) {
                const channelTest = {
                  id: channel.id,
                  name: channel.name,
                  isPrivate: channel.is_private,
                  isMember: channel.is_member,
                  accessTest: { success: false, error: null }
                };
                
                // Test access to channel history
                try {
                  const historyResponse = await axios.get('https://slack.com/api/conversations.history', {
                    headers: {
                      'Authorization': `Bearer ${connection.userToken}`,
                      'Content-Type': 'application/json'
                    },
                    params: {
                      channel: channel.id,
                      limit: 1
                    }
                  });
                  
                  channelTest.accessTest.success = historyResponse.data.ok;
                  if (!historyResponse.data.ok) {
                    channelTest.accessTest.error = historyResponse.data.error;
                  }
                } catch (historyError) {
                  channelTest.accessTest.error = historyError.message;
                }
                
                results.channels.push(channelTest);
              }
            }
          } catch (channelsError) {
            results.channels = { error: channelsError.message };
          }
        } else {
          results.userToken.error = userTest.data.error;
        }
      } catch (error) {
        results.userToken.error = error.message;
      }
    }
    
    return {
      success: true,
      results
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
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

// Utility: Get year range for a channel/DM
async function getChannelYearRange(accessToken, channelId, userToken = null) {
  let token = userToken || accessToken;
  let oldestTs = null;
  let latestTs = null;
  try {
    // Get latest message (most recent)
    let resp = await axios.get('https://slack.com/api/conversations.history', {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { channel: channelId, limit: 1 }
    });
    if (resp.data.ok && resp.data.messages.length > 0) {
      latestTs = parseFloat(resp.data.messages[0].ts);
    }

    // Paginate to get the oldest message
    let hasMore = true;
    let cursor = null;
    let lastTs = null;
    while (hasMore) {
      const params = { channel: channelId, limit: 1000 };
      if (cursor) params.cursor = cursor;
      const pageResp = await axios.get('https://slack.com/api/conversations.history', {
        headers: { 'Authorization': `Bearer ${token}` },
        params
      });
      if (pageResp.data.ok && pageResp.data.messages.length > 0) {
        lastTs = parseFloat(pageResp.data.messages[pageResp.data.messages.length - 1].ts);
      }
      hasMore = pageResp.data.has_more;
      cursor = pageResp.data.response_metadata && pageResp.data.response_metadata.next_cursor;
    }
    oldestTs = lastTs;
  } catch (e) {
    console.warn('Could not determine year range:', e.message);
  }
  if (!oldestTs || !latestTs) return [];
  const oldestYear = new Date(oldestTs * 1000).getFullYear();
  const latestYear = new Date(latestTs * 1000).getFullYear();
  const years = [];
  for (let y = oldestYear; y <= latestYear; y++) years.push(y);
  return years;
}