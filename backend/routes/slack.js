const express = require('express');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');

const router = express.Router();
const prisma = new PrismaClient();

// Global rate limiter for Slack API calls
class SlackRateLimiter {
  constructor() {
    this.requestQueue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.minDelay = 500; // Reduced from 2000ms to 500ms (much faster)
    this.rateLimitResetTime = 0;
    this.maxRetries = 3;
    this.concurrentRequests = 0;
    this.maxConcurrent = 3; // Allow 3 concurrent requests
    this.fastMode = process.env.SLACK_FAST_MODE === 'true'; // Enable ultra-fast mode
    
    if (this.fastMode) {
      this.minDelay = 100; // Ultra-fast mode: only 100ms between requests
      this.maxConcurrent = 5; // Allow 5 concurrent requests in fast mode
      console.log('🚀 Slack API Fast Mode enabled - aggressive rate limiting');
    }
  }

  async makeRequest(requestFn, context = '') {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ requestFn, context, resolve, reject, retries: 0 });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.requestQueue.length === 0) {
      return;
    }

    this.processing = true;

    // Process multiple requests concurrently
    const processBatch = async () => {
      const batchSize = Math.min(this.maxConcurrent, this.requestQueue.length);
      const batch = this.requestQueue.splice(0, batchSize);
      
      const promises = batch.map(async ({ requestFn, context, resolve, reject, retries }) => {
        try {
          // Check if we need to wait for rate limit reset
          const now = Date.now();
          if (this.rateLimitResetTime > now) {
            const waitTime = this.rateLimitResetTime - now;
            console.log(`⏱️ Rate limit active, waiting ${Math.ceil(waitTime / 1000)}s before next request`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }

          // Ensure minimum delay between requests (reduced significantly)
          const timeSinceLastRequest = now - this.lastRequestTime;
          if (timeSinceLastRequest < this.minDelay) {
            const waitTime = this.minDelay - timeSinceLastRequest;
            console.log(`⏳ Rate limiting: waiting ${waitTime}ms before ${context}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }

          this.lastRequestTime = Date.now();
          const result = await requestFn();

          // Handle rate limit headers if present
          if (result.headers) {
            const rateLimitRemaining = result.headers['x-rate-limit-remaining'];
            const rateLimitReset = result.headers['x-rate-limit-reset'];
            
            if (rateLimitRemaining !== undefined && parseInt(rateLimitRemaining) < 5) {
              // Few requests remaining, increase delay moderately
              this.minDelay = Math.min(3000, this.minDelay * 1.5); // Reduced from 8000 to 3000
              console.log(`📊 Rate limit warning: ${rateLimitRemaining} requests remaining. Increasing delay to ${this.minDelay}ms`);
            }
            
            if (rateLimitReset) {
              this.rateLimitResetTime = parseInt(rateLimitReset) * 1000;
            }
          }

          // Success - reduce delay more aggressively
          const oldDelay = this.minDelay;
          this.minDelay = Math.max(200, this.minDelay * 0.9); // Reduced from 3000 to 200ms minimum
          if (oldDelay !== this.minDelay && Math.abs(oldDelay - this.minDelay) > 50) {
            console.log(`📈 Rate limit improved: delay reduced from ${oldDelay}ms to ${this.minDelay}ms`);
          }
          resolve(result);

        } catch (error) {
          if (error.response?.status === 429 && retries < this.maxRetries) {
            // Rate limited - implement moderate backoff
            const backoffTime = Math.min(30000, 2000 * Math.pow(1.5, retries)); // Reduced from 120000 to 30000, start at 2s
            console.log(`⏱️ Rate limited (429), retrying in ${backoffTime / 1000}s (attempt ${retries + 1}/${this.maxRetries})`);
            
            // Update rate limit reset time from headers
            if (error.response.headers['retry-after']) {
              const retryAfter = parseInt(error.response.headers['retry-after']) * 1000;
              this.rateLimitResetTime = Date.now() + retryAfter;
            } else {
              this.rateLimitResetTime = Date.now() + backoffTime;
            }

            // Increase base delay moderately for future requests
            this.minDelay = Math.min(5000, this.minDelay * 1.8); // Reduced from 15000 to 5000
            console.log(`📉 Rate limit hit: increasing base delay to ${this.minDelay}ms`);
            
            // Re-queue with increased retry count
            this.requestQueue.unshift({ requestFn, context, resolve, reject, retries: retries + 1 });
            
            // Wait before processing next request
            await new Promise(resolve => setTimeout(resolve, backoffTime));
            
          } else {
            // Non-rate-limit error or max retries exceeded
            console.error(`❌ Request failed after ${retries} retries: ${error.message}`);
            reject(error);
          }
        }
      });

      await Promise.all(promises);
    };

    // Process batches until queue is empty
    while (this.requestQueue.length > 0) {
      await processBatch();
    }

    this.processing = false;
  }
}

// Global rate limiter instance
const slackRateLimiter = new SlackRateLimiter();

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

// User data cache to avoid repeated API calls
const userDataCache = new Map();

// Google Docs Integration Functions
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
    
    if (userInfo && userInfo.teamName) {
      // Create user folder based on team name
      const userFolderName = `${userInfo.teamName}`;
      userFolderId = await findOrCreateFolder(userFolderName, yearFolderId);
      
      // Create DM and Channel subfolders
      dmFolderId = await findOrCreateFolder('DM', userFolderId);
      channelFolderId = await findOrCreateFolder('Channel', userFolderId);
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
    throw error;
  }
}

async function findOrCreateFolder(folderName, parentFolderId) {
  try {
    // Search for existing folder
    const searchResponse = await drive.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
      fields: 'files(id, name)'
    });
    
    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      console.log(`📁 Found existing folder: ${folderName}`);
      return searchResponse.data.files[0].id;
    }
    
    // Create new folder
    const createResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      },
      fields: 'id'
    });
    
    console.log(`📁 Created new folder: ${folderName} (${createResponse.data.id})`);
    return createResponse.data.id;
    
  } catch (error) {
    console.error(`Error with folder ${folderName}:`, error);
    throw error;
  }
}

async function formatMessagesForGoogleDocs(messages, conversationTitle, conversationType) {
  if (!messages || messages.length === 0) {
    return {
      title: conversationTitle,
      content: `No messages found for this conversation.`
    };
  }

  // Group messages by date
  const messagesByDate = new Map();
  
  messages.forEach(message => {
    const date = new Date(message.ts * 1000);
    const dateKey = date.toLocaleDateString('en-US', { 
      year: 'numeric', month: 'long', day: 'numeric' 
    });
    
    if (!messagesByDate.has(dateKey)) {
      messagesByDate.set(dateKey, []);
    }
    
    // Extract clean user name (priority: display_name > real_name > name > short user ID)
    let userName = 'Unknown User';
    
    if (message.user_profile) {
      userName = message.user_profile.display_name || 
                message.user_profile.real_name || 
                message.user_profile.name;
    }
    
    // If no profile name and we have user ID, create a short identifier
    if (!userName && message.user) {
      userName = `User_${message.user.substring(0, 8)}`;
    }
    
    messagesByDate.get(dateKey).push({
      userName: userName,
      text: message.text || '[No text content]',
      timestamp: message.ts,
      time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Sort dates (most recent first)
  const sortedDates = Array.from(messagesByDate.keys()).sort((a, b) => {
    return new Date(b) - new Date(a);
  });

  // Build formatted content
  const requests = [];
  let currentIndex = 1; // Start after title

  // Add title
  requests.push({
    insertText: {
      location: { index: currentIndex },
      text: `${conversationTitle}\n\n`
    }
  });
  currentIndex += conversationTitle.length + 2;

  // Add conversation type
  requests.push({
    insertText: {
      location: { index: currentIndex },
      text: `Type: ${conversationType}\n`
    }
  });
  currentIndex += `Type: ${conversationType}\n`.length;

  // Add export date
  const exportDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', month: 'long', day: 'numeric' 
  });
  requests.push({
    insertText: {
      location: { index: currentIndex },
      text: `Exported: ${exportDate}\n\n`
    }
  });
  currentIndex += `Exported: ${exportDate}\n\n`.length;

  // Add messages by date
  sortedDates.forEach((dateKey, dateIndex) => {
    // Add date header
    requests.push({
      insertText: {
        location: { index: currentIndex },
        text: `${dateKey}\n`
      }
    });
    
    // Make date bold
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: currentIndex,
          endIndex: currentIndex + dateKey.length
        },
        textStyle: { bold: true },
        fields: 'bold'
      }
    });
    
    currentIndex += dateKey.length + 1;
    
    // Add separator
    requests.push({
      insertText: {
        location: { index: currentIndex },
        text: '=' + '='.repeat(50) + '\n\n'
      }
    });
    currentIndex += 52;
    
    // Add messages for this date
    const dayMessages = messagesByDate.get(dateKey);
    dayMessages.sort((a, b) => b.timestamp - a.timestamp); // Most recent first
    
    dayMessages.forEach((msg, msgIndex) => {
      // Simplified format: just name: message (no time)
      const messageText = `${msg.userName}: ${msg.text}\n`;
      
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: messageText
        }
      });
      
      currentIndex += messageText.length;
    });
    
    if (dateIndex < sortedDates.length - 1) {
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: '\n\n'
        }
      });
      currentIndex += 2;
    }
  });

  return {
    title: conversationTitle,
    requests: requests,
    messageCount: messages.length,
    dateCount: sortedDates.length
  };
}

async function createOrUpdateGoogleDoc(folderId, conversationTitle, formattedContent, existingDocId = null) {
  try {
    let docId = existingDocId;
    
    // Create new document if none exists
    if (!docId) {
      console.log(`📄 Creating new Google Doc: ${conversationTitle}`);
      
      // Step 1: Create Google Doc file using Drive API (correct approach)
      const createResponse = await drive.files.create({
        requestBody: {
          name: conversationTitle,
          mimeType: 'application/vnd.google-apps.document',
          parents: [folderId] // Create directly in the target folder
        },
        fields: 'id'
      });
      
      docId = createResponse.data.id;
      console.log(`📄 Created document: ${conversationTitle} (${docId})`);
    } else {
      console.log(`📄 Updating existing Google Doc: ${conversationTitle} (${docId})`);
    }
    
    // Add content to document
    if (formattedContent.requests && formattedContent.requests.length > 0) {
      // Process requests in batches to avoid API limits
      const batchSize = 50;
      const requests = formattedContent.requests;
      
      for (let i = 0; i < requests.length; i += batchSize) {
        const batch = requests.slice(i, i + batchSize);
        
        await docs.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: batch
          }
        });
        
        // Rate limiting
        if (i + batchSize < requests.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    const docUrl = `https://docs.google.com/document/d/${docId}`;
    console.log(`✅ Document ready: ${docUrl}`);
    
    return {
      docId,
      title: conversationTitle,
      url: docUrl,
      messageCount: formattedContent.messageCount,
      dateCount: formattedContent.dateCount
    };
    
  } catch (error) {
    console.error(`Error creating/updating Google Doc for ${conversationTitle}:`, error);
    throw error;
  }
}

// Generate proper document name based on channel type and user requirements
function generateDocumentName(channelName, messageType, userNames = [], partNumber = 1) {
  if (messageType === 'channel') {
    // For channels: #department-heads_Part1, #department-heads_Part2, etc.
    const cleanChannelName = channelName.replace(/^#/, ''); // Remove # if present
    return `#${cleanChannelName}_Part${partNumber}`;
  } else if (messageType === 'dm') {
    // For DMs: Username_Dmwith personname--Chirag ↔ Moemen_Part1
    if (userNames.length >= 2) {
      const [user1, user2] = userNames;
      return `${user1} ↔ ${user2}_Part${partNumber}`;
    } else {
      // Fallback if user names aren't available
      const cleanChannelName = channelName.replace(/^DM with /, '');
      return `DM_${cleanChannelName}_Part${partNumber}`;
    }
  } else {
    // Default fallback
    return `${channelName}_Part${partNumber}`;
  }
}

async function saveMessagesToGoogleDocs(connectionId, channelId, channelName, messages, messageType, connection) {
  try {
    if (!messages || messages.length === 0) {
      console.log(`No messages to save to Google Docs for ${channelName}`);
      return null;
    }

    // Check if Google APIs are configured
    if (!drive || !docs) {
      console.warn(`Google APIs not configured - skipping Google Docs save for ${channelName}`);
      return null;
    }

    // Get connection info for user context
    const userInfo = connection ? {
      userId: connection.slackUserId,
      teamName: connection.slackTeamName
    } : null;

    // Determine year from most recent message
    const mostRecentMessage = messages.reduce((latest, msg) => {
      return msg.ts > latest.ts ? msg : latest;
    });
    
    const year = new Date(mostRecentMessage.ts * 1000).getFullYear();
    
    // Setup folder structure with user-specific folders
    const folders = await setupGoogleDriveFolders(year, userInfo);
    
    // Determine target folder based on message type
    const targetFolderId = messageType === 'dm' ? folders.dmFolderId : folders.channelFolderId;
    
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
        }
      });
      userNames = Array.from(uniqueUsers).slice(0, 2); // Take first 2 users
    }
    
    // Split messages into chunks if needed (max 2000 messages per document)
    const maxMessagesPerDoc = 2000;
    const messageBatches = [];
    for (let i = 0; i < messages.length; i += maxMessagesPerDoc) {
      messageBatches.push(messages.slice(i, i + maxMessagesPerDoc));
    }
    
    const createdDocs = [];
    
    for (let batchIndex = 0; batchIndex < messageBatches.length; batchIndex++) {
      const batch = messageBatches[batchIndex];
      const partNumber = batchIndex + 1;
      
      // Generate document name based on new naming convention
      const documentName = generateDocumentName(channelName, messageType, userNames, partNumber);
      
      // Format messages for Google Docs
      const formattedContent = await formatMessagesForGoogleDocs(
        batch, 
        documentName, 
        messageType
      );
      
      // Check for existing document
      const searchResponse = await drive.files.list({
        q: `name='${documentName}' and mimeType='application/vnd.google-apps.document' and '${targetFolderId}' in parents and trashed=false`,
        fields: 'files(id, name, createdTime)',
        orderBy: 'createdTime desc'
      });
      
      let existingDocId = null;
      if (searchResponse.data.files && searchResponse.data.files.length > 0) {
        existingDocId = searchResponse.data.files[0].id;
        console.log(`Found existing document for ${documentName}: ${existingDocId}`);
      }
      
      // Create or update document
      const doc = await createOrUpdateGoogleDoc(
        targetFolderId,
        documentName,
        formattedContent,
        existingDocId
      );
      
      createdDocs.push(doc);
    }
    
    // Return the first document or a summary if multiple documents were created
    if (createdDocs.length === 1) {
      return createdDocs[0];
    } else {
      return {
        title: `${channelName} (${createdDocs.length} parts)`,
        documents: createdDocs,
        totalMessageCount: messages.length,
        parts: createdDocs.length
      };
    }
    
  } catch (error) {
    console.error(`Error saving messages to Google Docs for ${channelName}:`, error);
    return null;
  }
}

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Middleware to verify admin role
const requireAdmin = (req, res, next) => {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Add after the authenticateToken middleware
const processedCodes = new Set();

// Rate limiter status endpoint for debugging
router.get('/rate-limiter/status', authenticateToken, (req, res) => {
  res.json({
    queueLength: slackRateLimiter.requestQueue.length,
    processing: slackRateLimiter.processing,
    currentDelay: slackRateLimiter.minDelay,
    rateLimitActive: slackRateLimiter.rateLimitResetTime > Date.now(),
    rateLimitResetIn: Math.max(0, slackRateLimiter.rateLimitResetTime - Date.now()),
    lastRequestTime: slackRateLimiter.lastRequestTime,
    timeSinceLastRequest: Date.now() - slackRateLimiter.lastRequestTime
  });
});

// Initiate Slack OAuth flow
router.get('/auth', authenticateToken, (req, res) => {
  const botScopes = [
    'channels:history',
    'groups:history',
    'im:history',
    'mpim:history',
    'channels:read',
    'groups:read',
    'im:read',
    'mpim:read',
    'users:read',
    'team:read'
  ].join(',');
  
  const userScopes = [
    'channels:read',
    'groups:read',
    'im:read',
    'mpim:read',
    'users:read'
  ].join(',');

  const authUrl = `https://slack.com/oauth/v2/authorize?` +
    `client_id=${process.env.SLACK_CLIENT_ID}&` +
    `scope=${botScopes}&` +
    `user_scope=${userScopes}&` +
    `redirect_uri=${encodeURIComponent(process.env.SLACK_REDIRECT_URI)}&` +
    `state=${req.userId}`;

  console.log('Generated auth URL:', {
    clientId: process.env.SLACK_CLIENT_ID,
    redirectUri: process.env.SLACK_REDIRECT_URI,
    state: req.userId,
    botScopes: botScopes,
    userScopes: userScopes
  });

  res.json({ authUrl });
});

// Server-side OAuth callback handler (this is where Slack redirects)
router.get('/oauth-callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    
    if (error) {
      console.error('Slack OAuth error:', error);
      return res.redirect(`${process.env.FRONTEND_URL}/slack-connect?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      console.error('Missing code or state in OAuth callback');
      return res.redirect(`${process.env.FRONTEND_URL}/slack-connect?error=missing_parameters`);
    }

    // Check if code has already been processed
    if (processedCodes.has(code)) {
      console.error('Code already processed:', code.substring(0, 20) + '...');
      return res.redirect(`${process.env.FRONTEND_URL}/slack-connect?error=code_already_used`);
    }

    // Mark code as processed
    processedCodes.add(code);
    
    // Auto-cleanup processed codes after 10 minutes
    setTimeout(() => {
      processedCodes.delete(code);
    }, 10 * 60 * 1000);

    const result = await processSlackOAuthCode(code, state);
    
    if (result.success) {
      res.redirect(`${process.env.FRONTEND_URL}/slack-connect?success=true&team=${encodeURIComponent(result.team.name)}`);
    } else {
      res.redirect(`${process.env.FRONTEND_URL}/slack-connect?error=${encodeURIComponent(result.error)}`);
    }
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/slack-connect?error=internal_error`);
  }
});

// Process Slack OAuth code (extracted into separate function)
async function processSlackOAuthCode(code, state) {
  try {
    const userId = state;

    console.log('Processing Slack OAuth code:', {
      code: code ? `${code.substring(0, 20)}...` : 'missing',
      state: state ? `${state.substring(0, 20)}...` : 'missing',
      userId: userId
    });

    console.log('Environment variables check:', {
      SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
      SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET ? 'present' : 'missing',
      SLACK_REDIRECT_URI: process.env.SLACK_REDIRECT_URI,
      NODE_ENV: process.env.NODE_ENV
    });

    // Exchange code for access token
    const tokenRequest = {
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: process.env.SLACK_REDIRECT_URI
    };

    console.log('Token exchange request:', {
      ...tokenRequest,
      client_secret: 'hidden',
      code: `${code.substring(0, 20)}...`
    });

    const tokenResponse = await axios.post('https://slack.com/api/oauth.v2.access', tokenRequest, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('Slack token response:', {
      ok: tokenResponse.data.ok,
      error: tokenResponse.data.error,
      warning: tokenResponse.data.warning,
      response_metadata: tokenResponse.data.response_metadata,
      has_access_token: !!tokenResponse.data.access_token,
      has_user_token: !!tokenResponse.data.authed_user?.access_token,
      access_token_type: tokenResponse.data.access_token?.substring(0, 5),
      user_token_type: tokenResponse.data.authed_user?.access_token?.substring(0, 5),
      access_token_full: tokenResponse.data.access_token,
      user_token_full: tokenResponse.data.authed_user?.access_token,
      scope: tokenResponse.data.scope,
      authed_user: tokenResponse.data.authed_user
    });

    if (!tokenResponse.data.ok) {
      console.error('Slack OAuth error:', tokenResponse.data.error);
      console.error('Full Slack response:', tokenResponse.data);
      return {
        success: false,
        error: tokenResponse.data.error || 'token_exchange_failed'
      };
    }

    const { access_token, team, authed_user } = tokenResponse.data;
    
    // Store both tokens - use bot token for history, user token for user operations
    const botToken = access_token;
    const userToken = authed_user?.access_token;
    
          console.log('Token selection:', {
        bot_token: botToken ? `${botToken.substring(0, 10)}...` : 'none',
        user_token: userToken ? `${userToken.substring(0, 10)}...` : 'none',
        using_token: botToken ? `${botToken.substring(0, 10)}...` : 'none'
      });

    // Check if connection already exists
    const existingConnection = await prisma.slackConnection.findFirst({
      where: {
        userId,
        slackTeamId: team.id
      }
    });

    if (existingConnection) {
      // Update existing connection
      console.log('Updating existing connection with both tokens:', {
        connectionId: existingConnection.id,
        oldBotTokenType: existingConnection.accessToken?.substring(0, 5),
        newBotTokenType: botToken?.substring(0, 5),
        newUserTokenType: userToken?.substring(0, 5),
        hasBothTokens: !!botToken && !!userToken
      });
      
      await prisma.slackConnection.update({
        where: { id: existingConnection.id },
        data: {
          accessToken: botToken, // Store bot token for history access
          userToken: userToken,  // Store user token for listing channels/DMs
          scopes: tokenResponse.data.scope.split(','),
          isActive: true,
          updatedAt: new Date()
        }
      });
      
      // Verify both tokens were stored correctly
      const updatedConnection = await prisma.slackConnection.findFirst({
        where: { id: existingConnection.id }
      });
      console.log('Tokens after update:', {
        storedBotTokenType: updatedConnection.accessToken?.substring(0, 5),
        storedUserTokenType: updatedConnection.userToken?.substring(0, 5),
        botTokenMatches: updatedConnection.accessToken === botToken,
        userTokenMatches: updatedConnection.userToken === userToken
      });
    } else {
      // Create new connection
      console.log('Creating new connection with both tokens:', {
        botTokenType: botToken?.substring(0, 5),
        userTokenType: userToken?.substring(0, 5),
        hasBothTokens: !!botToken && !!userToken
      });
      
      const newConnection = await prisma.slackConnection.create({
        data: {
          userId,
          slackUserId: authed_user.id,
          slackTeamId: team.id,
          slackTeamName: team.name,
          accessToken: botToken, // Store bot token for history access
          userToken: userToken,  // Store user token for listing channels/DMs
          scopes: tokenResponse.data.scope.split(','),
          isActive: true
        }
      });
      
      console.log('New connection created:', {
        id: newConnection.id,
        storedBotTokenType: newConnection.accessToken?.substring(0, 5),
        storedUserTokenType: newConnection.userToken?.substring(0, 5)
      });
    }

    // Set up Pipedream workflow for this connection
    await setupPipedreamWorkflow(userId, team.id, botToken);

    return {
      success: true,
      team: { id: team.id, name: team.name }
    };
  } catch (error) {
    console.error('Process OAuth code error:', error);
    if (error.response) {
      console.error('Error response data:', error.response.data);
      console.error('Error response status:', error.response.status);
    }
    return {
      success: false,
      error: 'processing_failed'
    };
  }
}

// Handle Slack OAuth callback (keep for backward compatibility)
router.post('/callback', async (req, res) => {
  try {
    const { code, state } = req.body;
    
    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state' });
    }

    // Check if code has already been processed
    if (processedCodes.has(code)) {
      return res.status(400).json({ error: 'Code already processed' });
    }

    // Mark code as processed
    processedCodes.add(code);
    
    // Auto-cleanup processed codes after 10 minutes
    setTimeout(() => {
      processedCodes.delete(code);
    }, 10 * 60 * 1000);

    const result = await processSlackOAuthCode(code, state);
    
    if (result.success) {
      res.json({ 
        message: 'Slack connection established successfully',
        team: result.team
      });
    } else {
      res.status(400).json({ 
        error: 'Failed to exchange code for token',
        slackError: result.error
      });
    }
  } catch (error) {
    console.error('Slack callback error:', error);
    res.status(500).json({ error: 'Failed to process Slack callback' });
  }
});

// Get user's Slack connections
router.get('/connections', authenticateToken, async (req, res) => {
  try {
    const connections = await prisma.slackConnection.findMany({
      where: { userId: req.userId },
      select: {
        id: true,
        slackTeamId: true,
        slackTeamName: true,
        isActive: true,
        createdAt: true,
        scopes: true
      }
    });

    res.json({ connections });
  } catch (error) {
    console.error('Get connections error:', error);
    res.status(500).json({ error: 'Failed to retrieve connections' });
  }
});

// Admin: Get all users and their connections
router.get('/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        slackConnections: {
          select: {
            id: true,
            slackTeamId: true,
            slackTeamName: true,
            isActive: true,
            createdAt: true,
            scopes: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({ users });
  } catch (error) {
    console.error('Get admin users error:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// Admin: Get all connections across all users
router.get('/admin/connections', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const connections = await prisma.slackConnection.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({ connections });
  } catch (error) {
    console.error('Get admin connections error:', error);
    res.status(500).json({ error: 'Failed to retrieve connections' });
  }
});

// Admin: Get specific user's channels/DMs
router.get('/admin/users/:userId/connections/:connectionId/channels', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId, connectionId } = req.params;
    
    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const channels = await getSlackChannels(connection.userToken, connection.slackTeamId);
    const dms = await getSlackDMs(connection.userToken, connection.slackTeamId);

    res.json({ 
      channels: channels || [],
      dms: dms || [],
      totalCount: (channels?.length || 0) + (dms?.length || 0)
    });
  } catch (error) {
    console.error('Get admin user channels error:', error);
    res.status(500).json({ error: 'Failed to retrieve channels' });
  }
});

// Admin: Get system stats
router.get('/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const totalUsers = await prisma.user.count();
    const totalConnections = await prisma.slackConnection.count();
    const activeConnections = await prisma.slackConnection.count({
      where: { isActive: true }
    });
    const totalTasks = await prisma.automationTask.count();
    const completedTasks = await prisma.automationTask.count({
      where: { status: 'implemented' }
    });
    
    // Get total messages fetched across all workspaces
    const totalMessages = await prisma.slackConversation.count();
    
    // Get messages fetched in the last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const messagesLast24h = await prisma.slackConversation.count({
      where: {
        createdAt: {
          gte: twentyFourHoursAgo
        }
      }
    });

    res.json({
      totalUsers,
      totalConnections,
      activeConnections,
      totalTasks,
      completedTasks,
      totalMessages,
      messagesLast24h
    });
  } catch (error) {
    console.error('Get admin stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// Admin: Get all users' channel selections
router.get('/admin/all-channel-selections', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const allSelections = await prisma.slackChannelSelection.findMany({
      where: {
        isActive: true
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        slackConnection: {
          select: {
            id: true,
            slackTeamName: true,
            slackTeamId: true
          }
        }
      },
      orderBy: [
        { user: { name: 'asc' } },
        { slackConnection: { slackTeamName: 'asc' } },
        { channelName: 'asc' }
      ]
    });

    // For each selection, fetch the latest related job and add its status
    const selectionsWithStatus = await Promise.all(
      allSelections.map(async (selection) => {
        const latestJob = await prisma.slackScrapingJob.findFirst({
          where: {
            slackConnectionId: selection.slackConnectionId,
            channelId: selection.channelId
          },
          orderBy: { updatedAt: 'desc' }
        });
        return {
          ...selection,
          status: latestJob?.status || 'not_started',
          jobProgress: latestJob?.progress || 0,
          jobMessagesScraped: latestJob?.messagesScraped || 0,
          jobCompletedAt: latestJob?.completedAt || null,
          jobErrorMessage: latestJob?.errorMessage || null
        };
      })
    );

    // Group selections by user and connection
    const groupedSelections = selectionsWithStatus.reduce((acc, selection) => {
      const userId = selection.user.id;
      const connectionId = selection.slackConnection.id;
      if (!acc[userId]) {
        acc[userId] = {
          user: selection.user,
          connections: {}
        };
      }
      if (!acc[userId].connections[connectionId]) {
        acc[userId].connections[connectionId] = {
          connection: selection.slackConnection,
          selections: []
        };
      }
      acc[userId].connections[connectionId].selections.push(selection);
      return acc;
    }, {});

    res.json({
      selections: selectionsWithStatus,
      groupedSelections: Object.values(groupedSelections)
    });
  } catch (error) {
    console.error('Get admin all channel selections error:', error);
    res.status(500).json({ error: 'Failed to retrieve channel selections' });
  }
});

// Admin: Export history for specific channel/DM
router.post('/admin/export-channel-history', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { connectionId, channelId, channelName, channelType, userId } = req.body;

    // Verify the channel selection exists and belongs to the specified user
    const selection = await prisma.slackChannelSelection.findFirst({
      where: {
        slackConnectionId: connectionId,
        channelId: channelId,
        userId: userId,
        isActive: true
      },
      include: {
        slackConnection: true
      }
    });

    if (!selection) {
      return res.status(404).json({ error: 'Channel selection not found' });
    }

    // Check if a job is already in progress for this channel
    const existingJob = await prisma.slackScrapingJob.findFirst({
      where: {
        slackConnectionId: connectionId,
        channelId: channelId,
        status: { in: ['pending', 'running'] }
      }
    });
    if (existingJob) {
      return res.status(400).json({ error: 'A history export job is already in progress for this channel.' });
    }

    // Create a scraping job for this specific channel
    const job = await prisma.slackScrapingJob.create({
      data: {
        slackConnectionId: connectionId,
        channelId: channelId,
        channelName: channelName || channelId,
        channelType: channelType,
        jobType: 'history_export',
        status: 'pending',
      }
    });

    res.json({
      message: 'History export job created and queued for processing',
      jobId: job.id,
      channelName: channelName || channelId
    });
  } catch (error) {
    console.error('Admin export channel history error:', error);
    res.status(500).json({ error: 'Failed to start history export' });
  }
});

// Admin: Toggle daily export for specific channel/DM
router.post('/admin/toggle-channel-daily-export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { connectionId, channelId, enabled, userId } = req.body;

    // Verify the channel selection exists and belongs to the specified user
    const selection = await prisma.slackChannelSelection.findFirst({
      where: {
        slackConnectionId: connectionId,
        channelId: channelId,
        userId: userId,
        isActive: true
      }
    });

    if (!selection) {
      return res.status(404).json({ error: 'Channel selection not found' });
    }

    // Update the daily export setting
    await prisma.slackChannelSelection.update({
      where: { id: selection.id },
      data: { dailyExportEnabled: enabled }
    });

    res.json({
      message: `Daily export ${enabled ? 'enabled' : 'disabled'} for channel`,
      channelId: channelId,
      dailyExportEnabled: enabled
    });
  } catch (error) {
    console.error('Admin toggle channel daily export error:', error);
    res.status(500).json({ error: 'Failed to toggle daily export' });
  }
});

// Disconnect Slack connection
router.delete('/connections/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Revoke Slack token
    await axios.post('https://slack.com/api/auth.revoke', {
      token: connection.accessToken
    });

    // Delete connection
    await prisma.slackConnection.delete({
      where: { id: connectionId }
    });

    res.json({ message: 'Connection disconnected successfully' });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// Get conversation stats for a connection
router.get('/connections/:connectionId/stats', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const stats = await prisma.slackConversation.groupBy({
      by: ['messageType'],
      where: { slackConnectionId: connectionId },
      _count: { id: true }
    });

    const totalMessages = await prisma.slackConversation.count({
      where: { slackConnectionId: connectionId }
    });

    const lastMessage = await prisma.slackConversation.findFirst({
      where: { slackConnectionId: connectionId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    });

    res.json({
      totalMessages,
      messageTypes: stats,
      lastMessageAt: lastMessage?.createdAt
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// Get channels and DMs for a connection
router.get('/connections/:connectionId/channels', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    console.log('Fetching channels for connection:', connectionId);

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      console.log('Connection not found:', connectionId);
      return res.status(404).json({ error: 'Connection not found' });
    }

    console.log('Found connection:', {
      id: connection.id,
      teamName: connection.slackTeamName,
      isActive: connection.isActive,
      hasToken: !!connection.accessToken,
      scopes: connection.scopes,
      tokenType: connection.accessToken?.substring(0, 5),
      tokenLength: connection.accessToken?.length,
      tokenPreview: connection.accessToken ? `${connection.accessToken.substring(0, 15)}...` : 'none',
      fullTokenForDebug: connection.accessToken // TEMPORARY: Show full token for debugging
    });

    const channels = await getSlackChannels(connection.userToken, connection.slackTeamId);
    const dms = await getSlackDMs(connection.userToken, connection.slackTeamId);

    console.log('Final result:', {
      channels: channels?.length || 0,
      dms: dms?.length || 0,
      totalCount: (channels?.length || 0) + (dms?.length || 0)
    });

    res.json({ 
      channels: channels || [],
      dms: dms || [],
      totalCount: (channels?.length || 0) + (dms?.length || 0)
    });
  } catch (error) {
    console.error('Get channels error:', error);
    res.status(500).json({ error: 'Failed to retrieve channels' });
  }
});

// Save channel selections (new workflow)
router.post('/connections/:connectionId/save-channels', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { selectedChannels = [], selectedDMs = [] } = req.body;

    console.log('Saving channel selections for connection:', connectionId);
    console.log('Selected channels:', selectedChannels.length);
    console.log('Selected DMs:', selectedDMs.length);

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Remove existing selections for this connection
    await prisma.slackChannelSelection.deleteMany({
      where: {
        slackConnectionId: connectionId,
        userId: req.userId
      }
    });

    // Fetch all channels and DMs for name lookup
    const channelsList = await getSlackChannels(connection.userToken, connection.slackTeamId);
    const dmsList = await getSlackDMs(connection.userToken, connection.slackTeamId);
    const channelMap = new Map(channelsList.map(ch => [ch.id, ch.name]));
    const dmMap = new Map(dmsList.map(dm => [dm.id, dm.name]));

    const allSelections = [
      ...selectedChannels.map(channelId => ({ channelId, channelType: 'channel', channelName: channelMap.get(channelId) || channelId })),
      ...selectedDMs.map(dmId => ({ channelId: dmId, channelType: 'dm', channelName: dmMap.get(dmId) || dmId }))
    ];

    // Create new selections
    const newSelections = [];
    for (const { channelId, channelType, channelName } of allSelections) {
      const selection = await prisma.slackChannelSelection.create({
        data: {
          userId: req.userId,
          slackConnectionId: connectionId,
          channelId,
          channelName,
          channelType,
          isActive: true,
          dailyExportEnabled: false // Default to false, user will toggle manually
        }
      });
      newSelections.push(selection);
    }

    res.json({ 
      message: 'Channel selections saved successfully',
      selectionsCreated: newSelections.length,
      totalSelected: selectedChannels.length + selectedDMs.length
    });
  } catch (error) {
    console.error('Save channel selections error:', error);
    res.status(500).json({ error: 'Failed to save channel selections' });
  }
});

// Get saved channel selections
router.get('/connections/:connectionId/saved-channels', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const selections = await prisma.slackChannelSelection.findMany({
      where: {
        slackConnectionId: connectionId,
        userId: req.userId,
        isActive: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const channels = selections.filter(s => s.channelType === 'channel').map(s => s.channelId);
    const dms = selections.filter(s => s.channelType === 'dm').map(s => s.channelId);

    res.json({
      selectedChannels: channels,
      selectedDMs: dms,
      totalSelected: selections.length,
      selections: selections // Include full details for progress tracking
    });
  } catch (error) {
    console.error('Get saved channels error:', error);
    res.status(500).json({ error: 'Failed to retrieve saved channels' });
  }
});

// Get channel fetching progress
router.get('/connections/:connectionId/progress', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Get selections with their scraping jobs
    const selections = await prisma.slackChannelSelection.findMany({
      where: {
        slackConnectionId: connectionId,
        userId: req.userId,
        isActive: true
      }
    });

    // Get scraping jobs for these selections
    const jobs = await prisma.slackScrapingJob.findMany({
      where: {
        slackConnectionId: connectionId,
        channelId: { in: selections.map(s => s.channelId) }
      },
      orderBy: { updatedAt: 'desc' }
    });

    // Calculate progress for each selection
    const progressData = selections.map(selection => {
      const relatedJobs = jobs.filter(job => job.channelId === selection.channelId);
      const latestJob = relatedJobs[0];

      return {
        ...selection,
        status: latestJob?.status || 'not_started',
        progress: latestJob?.progress || 0,
        messagesScraped: latestJob?.messagesScraped || 0,
        lastFetchedAt: latestJob?.completedAt || selection.lastFetchedAt,
        errorMessage: latestJob?.errorMessage
      };
    });

    // Break down selections by type
    const channelSelections = selections.filter(s => s.channelType === 'channel');
    const dmSelections = selections.filter(s => s.channelType === 'dm');
    
    const overallStats = {
      totalSelections: selections.length,
      channelCount: channelSelections.length,
      dmCount: dmSelections.length,
      completed: progressData.filter(p => p.status === 'completed').length,
      inProgress: progressData.filter(p => p.status === 'running').length,
      pending: progressData.filter(p => p.status === 'pending' || p.status === 'not_started').length,
      failed: progressData.filter(p => p.status === 'failed').length,
      totalMessages: progressData.reduce((sum, p) => sum + (p.messagesScraped || 0), 0),
      dailyExportEnabled: selections.some(s => s.dailyExportEnabled) // Check if any selection has daily export enabled
    };

    res.json({
      progress: progressData,
      stats: overallStats,
      isActive: overallStats.inProgress > 0 || overallStats.pending > 0
    });
  } catch (error) {
    console.error('Get progress error:', error);
    res.status(500).json({ error: 'Failed to retrieve progress' });
  }
});

// Manual history export - fetch all history for configured channels/DMs
router.post('/connections/:connectionId/export-history', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    console.log('Starting manual history export for connection:', connectionId);

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Get all active channel selections for this connection
    const selections = await prisma.slackChannelSelection.findMany({
      where: {
        slackConnectionId: connectionId,
        userId: req.userId,
        isActive: true
      }
    });

    if (selections.length === 0) {
      return res.status(400).json({ error: 'No channels or DMs configured. Please configure channels first.' });
    }

    console.log(`Found ${selections.length} active selections for history export`);

    // Create scraping jobs for all selections
    const scrapingJobs = [];
    
    for (const selection of selections) {
      try {
        // Check if there's already a running job for this channel
        const existingJob = await prisma.slackScrapingJob.findFirst({
          where: {
            slackConnectionId: connectionId,
            channelId: selection.channelId,
            status: { in: ['pending', 'running'] }
          }
        });

        if (existingJob) {
          console.log(`Skipping ${selection.channelId} - job already in progress`);
          continue;
        }

        // Create new history export job
        const job = await prisma.slackScrapingJob.create({
          data: {
            slackConnectionId: connectionId,
            channelId: selection.channelId,
            channelName: selection.channelName,
            channelType: selection.channelType,
            status: 'pending'
          }
        });
        
        scrapingJobs.push(job);
        console.log(`Created history export job for ${selection.channelType} ${selection.channelId}`);
        
      } catch (error) {
        console.error(`Failed to create job for ${selection.channelId}:`, error);
      }
    }

    res.json({ 
      message: 'History export jobs created and queued for processing',
      jobsCreated: scrapingJobs.length,
      totalSelections: selections.length,
      selectionsProcessed: scrapingJobs.length
    });
  } catch (error) {
    console.error('Start history export error:', error);
    res.status(500).json({ error: 'Failed to start history export' });
  }
});

// Toggle daily export for channel/DM selections
router.post('/connections/:connectionId/toggle-daily-export', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { channelId, enabled } = req.body;

    console.log(`Toggling daily export for channel ${channelId}: ${enabled}`);

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    let whereClause = {
      slackConnectionId: connectionId,
      userId: req.userId,
      isActive: true
    };

    // If channelId is 'all', update all channels for this connection
    if (channelId !== 'all') {
      whereClause.channelId = channelId;
    }

    // Update the daily export setting for the specific channel or all channels
    const updatedSelection = await prisma.slackChannelSelection.updateMany({
      where: whereClause,
      data: {
        dailyExportEnabled: enabled
      }
    });

    if (updatedSelection.count === 0) {
      return res.status(404).json({ error: 'Channel selection not found' });
    }

    res.json({ 
      message: `Daily export ${enabled ? 'enabled' : 'disabled'} for ${channelId === 'all' ? 'all channels' : 'channel'}`,
      channelId,
      dailyExportEnabled: enabled,
      updatedCount: updatedSelection.count
    });
  } catch (error) {
    console.error('Toggle daily export error:', error);
    res.status(500).json({ error: 'Failed to toggle daily export' });
  }
});

// Start data scraping for selected channels (legacy endpoint)
router.post('/connections/:connectionId/scrape', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { selectedChannels = [], selectedDMs = [] } = req.body;

    console.log('Starting data scraping for connection:', connectionId);
    console.log('Selected channels:', selectedChannels.length);
    console.log('Selected DMs:', selectedDMs.length);

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Store selected channels/DMs for scraping
    const scrapingJobs = [];
    
    // Process selected channels
    for (const channelId of selectedChannels) {
      const existingJob = await prisma.slackScrapingJob.findFirst({
        where: {
          slackConnectionId: connectionId,
          channelId: channelId,
          channelType: 'channel'
        }
      });

      if (!existingJob) {
        const job = await prisma.slackScrapingJob.create({
          data: {
            slackConnectionId: connectionId,
            channelId: channelId,
            channelType: 'channel',
            status: 'pending',
            createdAt: new Date()
          }
        });
        scrapingJobs.push(job);
      }
    }

    // Process selected DMs
    for (const dmId of selectedDMs) {
      const existingJob = await prisma.slackScrapingJob.findFirst({
        where: {
          slackConnectionId: connectionId,
          channelId: dmId,
          channelType: 'dm'
        }
      });

      if (!existingJob) {
        const job = await prisma.slackScrapingJob.create({
          data: {
            slackConnectionId: connectionId,
            channelId: dmId,
            channelType: 'dm',
            status: 'pending',
            createdAt: new Date()
          }
        });
        scrapingJobs.push(job);
      }
    }

    // Start background scraping process
    startBackgroundScraping(connection, scrapingJobs);

    res.json({ 
      message: 'Data scraping initiated successfully',
      jobsCreated: scrapingJobs.length,
      totalSelected: selectedChannels.length + selectedDMs.length
    });
  } catch (error) {
    console.error('Start scraping error:', error);
    res.status(500).json({ error: 'Failed to start data scraping' });
  }
});

// Get scraping status for a connection
router.get('/connections/:connectionId/scraping-status', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const jobs = await prisma.slackScrapingJob.findMany({
      where: { slackConnectionId: connectionId },
      orderBy: { createdAt: 'desc' }
    });

    const statusCounts = jobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      jobs,
      statusCounts,
      totalJobs: jobs.length,
      isActive: jobs.some(job => job.status === 'running' || job.status === 'pending')
    });
  } catch (error) {
    console.error('Get scraping status error:', error);
    res.status(500).json({ error: 'Failed to retrieve scraping status' });
  }
});

// Test endpoint to check Slack app configuration
router.get('/test-config', (req, res) => {
  const config = {
    slackClientId: process.env.SLACK_CLIENT_ID,
    slackClientSecret: process.env.SLACK_CLIENT_SECRET ? 'present' : 'missing',
    slackRedirectUri: process.env.SLACK_REDIRECT_URI,
    frontendUrl: process.env.FRONTEND_URL,
    nodeEnv: process.env.NODE_ENV
  };
  
  console.log('Slack configuration check:', config);
  res.json(config);
});

// Test endpoint to verify Slack token
router.get('/connections/:connectionId/test-token', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    console.log('Testing Slack token for connection:', connectionId);

    const connection = await prisma.slackConnection.findFirst({
      where: {
        id: connectionId,
        userId: req.userId
      }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    console.log('Testing token:', {
      tokenType: connection.accessToken?.substring(0, 5),
      tokenLength: connection.accessToken?.length,
      storedScopes: connection.scopes
    });

    // Test the token with auth.test
    const authResponse = await axios.get('https://slack.com/api/auth.test', {
      headers: {
        'Authorization': `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Auth test response:', authResponse.data);

    if (authResponse.data.ok) {
      // Also test what scopes this token actually has
      try {
        const scopesResponse = await axios.post('https://slack.com/api/auth.test', 
          `token=${connection.accessToken}`,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
        console.log('Scopes test response:', scopesResponse.data);
      } catch (scopeError) {
        console.log('Scopes test failed:', scopeError.message);
      }

      // Test channels.list API directly
      try {
        const channelsTestResponse = await axios.get('https://slack.com/api/conversations.list', {
          headers: {
            'Authorization': `Bearer ${connection.accessToken}`,
            'Content-Type': 'application/json'
          },
          params: {
            types: 'public_channel',
            limit: 5
          }
        });
        console.log('Direct channels test:', channelsTestResponse.data);
      } catch (channelsError) {
        console.log('Direct channels test failed:', channelsError.message);
      }

      res.json({
        success: true,
        teamName: authResponse.data.team,
        userName: authResponse.data.user,
        teamId: authResponse.data.team_id,
        userId: authResponse.data.user_id,
        tokenType: connection.accessToken?.substring(0, 5),
        storedScopes: connection.scopes
      });
    } else {
      console.log('Auth test failed:', authResponse.data);
      res.status(400).json({
        success: false,
        error: authResponse.data.error,
        tokenType: connection.accessToken?.substring(0, 5)
      });
    }
  } catch (error) {
    console.error('Token test error:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    res.status(500).json({ error: 'Failed to test token' });
  }
});

// Helper function to set up Pipedream workflow
async function setupPipedreamWorkflow(userId, teamId, accessToken) {
  try {
    // This would integrate with Pipedream's API to create a workflow
    // For now, we'll log the setup
    console.log(`Setting up Pipedream workflow for user ${userId}, team ${teamId}`);
    
    // TODO: Implement actual Pipedream workflow creation
    // const pipedreamResponse = await axios.post('https://api.pipedream.com/v1/workflows', {
    //   name: `Slack Scraper - ${teamId}`,
    //   trigger: { schedule: '0 */6 * * *' }, // Every 6 hours
    //   steps: [
    //     // Slack message fetching steps
    //   ]
    // });
    
    return true;
  } catch (error) {
    console.error('Pipedream setup error:', error);
    return false;
  }
}

// Helper functions

// Optimized user fetching - fetch all users once and cache them
async function getUsersMap(userToken, teamId) {
  const cacheKey = `users-${teamId}`;
  
  // Check cache first
  if (userDataCache.has(cacheKey)) {
    console.log('Using cached user data');
    return userDataCache.get(cacheKey);
  }

  const allUsers = [];
  let cursor = null;
  let hasMore = true;

  try {
    console.log('Fetching all Slack users for team:', teamId);
    
    while (hasMore) {
      const requestFn = async () => {
        const params = {
          limit: 1000,
          presence: 0 // Skip online/offline status for speed
        };
        
        if (cursor) {
          params.cursor = cursor;
        }
        
        return await axios.get('https://slack.com/api/users.list', {
          headers: {
            'Authorization': `Bearer ${userToken}`,
            'Content-Type': 'application/json'
          },
          params: params
        });
      };

      const response = await slackRateLimiter.makeRequest(requestFn, 'fetch all users');

      if (response.data.ok) {
        allUsers.push(...response.data.members);
        
        // Check if there are more pages
        cursor = response.data.response_metadata?.next_cursor;
        hasMore = !!cursor;
        
        console.log(`Fetched ${response.data.members.length} users (total so far: ${allUsers.length}), hasMore: ${hasMore}`);
      } else {
        console.error('Failed to fetch users:', response.data.error);
        break;
      }
    }

    const usersMap = new Map();
    
    allUsers.forEach(user => {
      usersMap.set(user.id, {
        id: user.id,
        name: user.name,
        real_name: user.real_name,
        display_name: user.profile?.display_name,
        email: user.profile?.email,
        is_bot: user.is_bot,
        deleted: user.deleted
      });
    });

    // Cache for 5 minutes to avoid repeated calls
    userDataCache.set(cacheKey, usersMap);
    setTimeout(() => {
      userDataCache.delete(cacheKey);
    }, 5 * 60 * 1000);

    console.log(`Cached ${usersMap.size} users for team ${teamId}`);
    return usersMap;
  } catch (error) {
    console.error('Error fetching users:', error.message);
    return new Map();
  }
}

async function getSlackChannels(userToken, teamId) {
  const allChannels = [];
  let cursor = null;
  let hasMore = true;

  try {
    console.log('Fetching Slack channels with user token...');
    console.log('User token:', userToken ? `${userToken.substring(0, 20)}...` : 'missing');
    console.log('Full user token for debug:', userToken); // TEMPORARY: Show full token
    
    while (hasMore) {
      const requestFn = async () => {
        const params = {
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 1000
        };
        
        if (cursor) {
          params.cursor = cursor;
        }
        
        return await axios.get('https://slack.com/api/conversations.list', {
          headers: {
            'Authorization': `Bearer ${userToken}`,
            'Content-Type': 'application/json'
          },
          params: params
        });
      };

      const response = await slackRateLimiter.makeRequest(requestFn, 'fetch channels');

      console.log('Slack channels API response:', {
        ok: response.data.ok,
        error: response.data.error,
        channels_count: response.data.channels?.length || 0,
        response_metadata: response.data.response_metadata,
        cursor: cursor ? cursor.substring(0, 10) + '...' : 'none'
      });

      if (response.data.ok) {
        const channels = response.data.channels.map(channel => ({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.is_private,
          memberCount: channel.num_members,
          purpose: channel.purpose?.value || '',
          topic: channel.topic?.value || '',
          isArchived: channel.is_archived,
          isMember: channel.is_member
        }));
        
        allChannels.push(...channels);
        
        // Check if there are more pages
        cursor = response.data.response_metadata?.next_cursor;
        hasMore = !!cursor;
        
        console.log(`Fetched ${channels.length} channels (total so far: ${allChannels.length}), hasMore: ${hasMore}`);
      } else {
        console.error('Failed to fetch channels:', response.data.error);
        break;
      }
    }
    
    console.log('Total channels fetched:', allChannels.length);
    console.log('Sample channels:', allChannels.slice(0, 3));
    
    return allChannels;
  } catch (error) {
    console.error('Error fetching channels:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    return allChannels; // Return what we have so far
  }
}

async function getSlackDMs(userToken, teamId) {
  const allDMs = [];
  let cursor = null;
  let hasMore = true;

  try {
    console.log('Fetching Slack DMs with optimized user lookup...');
    
    // Get all users once for efficient name lookup
    const usersMap = await getUsersMap(userToken, teamId);
    
    while (hasMore) {
      const requestFn = async () => {
        const params = {
          types: 'im,mpim',
          exclude_archived: true,
          limit: 1000
        };
        
        if (cursor) {
          params.cursor = cursor;
        }
        
        return await axios.get('https://slack.com/api/conversations.list', {
          headers: {
            'Authorization': `Bearer ${userToken}`,
            'Content-Type': 'application/json'
          },
          params: params
        });
      };

      const response = await slackRateLimiter.makeRequest(requestFn, 'fetch DMs');

      console.log('Slack DMs API response:', {
        ok: response.data.ok,
        error: response.data.error,
        channels_count: response.data.channels?.length || 0,
        response_metadata: response.data.response_metadata,
        cursor: cursor ? cursor.substring(0, 10) + '...' : 'none'
      });

      if (response.data.ok) {
        const dms = [];
        
        for (const dm of response.data.channels) {
          let dmInfo = {
            id: dm.id,
            isGroup: dm.is_mpim,
            memberCount: dm.num_members || 2,
            name: dm.name || 'Direct Message',
            isArchived: dm.is_archived
          };

          // For direct messages, use cached user data for name lookup
          if (dm.is_im && dm.user) {
            const user = usersMap.get(dm.user);
            if (user) {
              if (user.deleted) {
                dmInfo.name = `DM with ${user.real_name || user.name || 'Deleted User'}`;
              } else if (user.is_bot) {
                dmInfo.name = `DM with ${user.real_name || user.name || 'Bot'}`;
              } else {
                const userName = user.display_name || user.real_name || user.name;
                dmInfo.name = `DM with ${userName}`;
              }
            } else {
              // User not found in the map, try to get user info directly
              console.log(`User ${dm.user} not found in users map, attempting direct lookup...`);
              try {
                const userInfoResponse = await axios.get('https://slack.com/api/users.info', {
                  headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json'
                  },
                  params: {
                    user: dm.user
                  }
                });
                
                if (userInfoResponse.data.ok && userInfoResponse.data.user) {
                  const user = userInfoResponse.data.user;
                  const userName = user.profile?.display_name || user.real_name || user.name;
                  dmInfo.name = `DM with ${userName}`;
                } else {
                  dmInfo.name = `DM with ${dm.user}`;
                }
              } catch (userError) {
                console.error(`Failed to get user info for ${dm.user}:`, userError.message);
                dmInfo.name = `DM with ${dm.user}`;
              }
            }
          }

          // For group DMs (MPIMs), use simple naming to avoid extra API calls
          if (dm.is_mpim) {
            dmInfo.name = `Group DM (${dm.num_members || 'unknown'} members)`;
          }

          dms.push(dmInfo);
        }

        allDMs.push(...dms);
        
        // Check if there are more pages
        cursor = response.data.response_metadata?.next_cursor;
        hasMore = !!cursor;
        
        console.log(`Fetched ${dms.length} DMs (total so far: ${allDMs.length}), hasMore: ${hasMore}`);
      } else {
        console.error('Failed to fetch DMs:', response.data.error);
        break;
      }
    }

    console.log('Total DMs fetched:', allDMs.length);
    console.log('Sample DMs:', allDMs.slice(0, 3));
    
    return allDMs;
  } catch (error) {
    console.error('Error fetching DMs:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    return allDMs; // Return what we have so far
  }
}

// New function for automatic channel fetching
async function startChannelFetching(connection, selections) {
  if (!selections || selections.length === 0) {
    console.log('No selections to process');
    return;
  }

  console.log(`⏱️  Starting parallel fetching for ${selections.length} channel selections`);
  
  // Create all scraping jobs first
  const jobs = [];
  for (const selection of selections) {
    try {
      console.log(`📡 Creating job for ${selection.channelType} ${selection.channelId}`);
      
      const job = await prisma.slackScrapingJob.create({
        data: {
          slackConnectionId: connection.id,
          channelId: selection.channelId,
          channelType: selection.channelType,
          status: 'pending'
        }
      });
      
      jobs.push(job);
    } catch (error) {
      console.error(`Failed to create job for ${selection.channelId}:`, error);
    }
  }

  // Process jobs in parallel with concurrency limit
  const concurrencyLimit = 3; // Process 3 jobs simultaneously
  const jobBatches = [];
  
  for (let i = 0; i < jobs.length; i += concurrencyLimit) {
    jobBatches.push(jobs.slice(i, i + concurrencyLimit));
  }

  console.log(`🔄 Processing ${jobs.length} jobs in ${jobBatches.length} batches of ${concurrencyLimit}`);

  for (let batchIndex = 0; batchIndex < jobBatches.length; batchIndex++) {
    const batch = jobBatches[batchIndex];
    console.log(`📦 Processing batch ${batchIndex + 1}/${jobBatches.length} with ${batch.length} jobs`);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (job) => {
      try {
        console.log(`🚀 Starting job ${job.id}: ${job.channelType} ${job.channelId}`);
        return await processScrapingJob(connection, job);
      } catch (error) {
        console.error(`❌ Job ${job.id} failed:`, error);
        return { error: error.message };
      }
    });

    // Wait for current batch to complete before starting next batch
    await Promise.all(batchPromises);
    
    // Small delay between batches to prevent overwhelming the rate limiter
    if (batchIndex < jobBatches.length - 1) {
      console.log(`⏳ Batch ${batchIndex + 1} complete, waiting 500ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`✅ All ${jobs.length} jobs completed with parallel processing`);
}

// New function for manual history export (no limits)
async function startHistoryExport(connection, jobs) {
  if (!jobs || jobs.length === 0) {
    console.log('No jobs to process for history export');
    return;
  }

  console.log(`📚 Starting history export for ${jobs.length} channels/DMs - NO LIMITS`);
  
  // Process jobs in parallel with concurrency limit
  const concurrencyLimit = 2; // Reduced for history export to be more conservative
  const jobBatches = [];
  
  for (let i = 0; i < jobs.length; i += concurrencyLimit) {
    jobBatches.push(jobs.slice(i, i + concurrencyLimit));
  }

  console.log(`🔄 Processing ${jobs.length} history export jobs in ${jobBatches.length} batches of ${concurrencyLimit}`);

  for (let batchIndex = 0; batchIndex < jobBatches.length; batchIndex++) {
    const batch = jobBatches[batchIndex];
    console.log(`📦 Processing history export batch ${batchIndex + 1}/${jobBatches.length} with ${batch.length} jobs`);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (job) => {
      try {
        console.log(`🚀 Starting history export job ${job.id}: ${job.channelType} ${job.channelId}`);
        return await processHistoryExportJob(connection, job);
      } catch (error) {
        console.error(`❌ History export job ${job.id} failed:`, error);
        return { error: error.message };
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
  
  console.log(`✅ All ${jobs.length} history export jobs completed`);
}

async function startBackgroundScraping(connection, jobs) {
  console.log(`Starting background scraping for ${jobs.length} jobs`);
  
  // Process each job asynchronously
  for (const job of jobs) {
    console.log(`Processing job ${job.id}: ${job.channelType} ${job.channelId}`);
    
    // Don't await - let jobs run in parallel
    processScrapingJob(connection, job).catch(error => {
      console.error(`Error processing job ${job.id}:`, error);
    });
  }
}

async function processScrapingJob(connection, job) {
  try {
    // Update job status to running
    await prisma.slackScrapingJob.update({
      where: { id: job.id },
      data: {
        status: 'running',
        startedAt: new Date()
      }
    });

    console.log(`Starting to scrape channel ${job.channelId} (type: ${job.channelType})`);
    
    let hasMore = true;
    let cursor = null;
    let totalMessages = 0;
    let allMessages = []; // Collect all messages for Google Docs
    const batchSize = 200; // Increased from 100 to 200 for better performance
    let actualChannelId = job.channelId;
    let channelInfo = null;
    
    // Enhanced tracking metrics
    let totalFetchAttempts = 0;
    let failedMessages = 0;
    let retryCount = 0;
    let threadMessagesFetched = 0;

    // For DMs, use existing channel ID directly (no need to open new conversation)
    if (job.channelType === 'dm') {
      console.log(`📱 Processing DM: Using existing channel ${job.channelId}`);
      
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
          
          // Use cached user data for naming (from our optimized getUsersMap)
          const usersMap = await getUsersMap(connection.userToken, connection.slackTeamId);
          const user = usersMap.get(userId);
          
          if (user && !user.deleted && !user.is_bot) {
            const userName = user.display_name || user.real_name || user.name;
            channelInfo = { name: `DM with ${userName}`, isPrivate: true };
          } else {
            channelInfo = { name: `DM with ${userId}`, isPrivate: true };
          }
          
          // Use existing channel ID directly
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

    while (hasMore) {
      totalFetchAttempts++;
      console.log(`Fetching batch for channel ${actualChannelId}, cursor: ${cursor ? cursor.substring(0, 10) + '...' : 'none'} (attempt ${totalFetchAttempts})`);
      
      // Fetch messages from Slack using intelligent token fallback
      const messagesResponse = await fetchChannelMessages(
        connection.accessToken, 
        actualChannelId, 
        cursor, 
        batchSize,
        connection.userToken  // Pass user token for fallback
      );

      if (!messagesResponse.ok) {
        throw new Error(`Slack API error: ${messagesResponse.error}`);
      }

      const messages = messagesResponse.messages || [];
      console.log(`Fetched ${messages.length} messages`);

      // Save messages to database and collect for Google Docs
      for (const message of messages) {
        await saveMessageToDatabase(connection.id, actualChannelId, channelInfo?.name, message);
        
        // Collect valid messages for Google Docs (using refined filtering)
        if (!message.bot_id && message.text && (!message.subtype || CAPTURE_MESSAGE_SUBTYPES.includes(message.subtype))) {
          allMessages.push(message);
        }
        
        // Fetch thread replies if this message has a thread (only for recent messages to avoid excessive API calls)
        if (message.thread_ts && message.thread_ts === message.ts) {
          // Only fetch threads for messages from the last 30 days to avoid excessive API calls
          const messageDate = new Date(message.ts * 1000);
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          
          if (messageDate > thirtyDaysAgo) {
            try {
              const threadMessages = await fetchThreadReplies(
                connection.accessToken,
                actualChannelId,
                message.thread_ts,
                connection.userToken
              );
              
              // Save thread replies to database
              for (const threadMessage of threadMessages) {
                await saveMessageToDatabase(connection.id, actualChannelId, channelInfo?.name, threadMessage);
                
                if (!threadMessage.bot_id && threadMessage.text && (!threadMessage.subtype || CAPTURE_MESSAGE_SUBTYPES.includes(threadMessage.subtype))) {
                  allMessages.push(threadMessage);
                }
                
                totalMessages++;
              }
              
              threadMessagesFetched += threadMessages.length;
              console.log(`📝 Fetched ${threadMessages.length} thread replies for message ${message.ts}`);
            } catch (threadError) {
              console.warn(`⚠️ Failed to fetch thread replies for ${message.ts}:`, threadError.message);
              failedMessages++;
            }
          } else {
            console.log(`⏭️ Skipping thread fetch for old message ${message.ts} (older than 30 days)`);
          }
        }
        
        totalMessages++;
      }

      // Update progress
      await prisma.slackScrapingJob.update({
        where: { id: job.id },
        data: {
          messagesScraped: totalMessages,
          progress: Math.min(95, Math.floor((totalMessages / 1000) * 100)) // Estimate progress
        }
      });

      // Staged Google Docs: Save every 200 messages to prevent data loss
      if (allMessages.length >= 200 && (drive && docs)) {
        try {
          console.log(`💾 Staged save: Creating Google Doc with ${allMessages.length} messages...`);
          
          let messageType = job.channelType || 'channel';
          if (actualChannelId.startsWith('D')) {
            messageType = 'dm';
          } else if (actualChannelId.startsWith('G')) {
            messageType = 'group';
          }
          
          const stagedDocResult = await saveMessagesToGoogleDocs(
            connection.id,
            actualChannelId,
            channelInfo?.name || 'Unknown Channel',
            allMessages,
            messageType,
            connection
          );
          
          if (stagedDocResult) {
            console.log(`✅ Staged Google Doc created: ${stagedDocResult.url}`);
            // Clear the array after successful save to prevent duplicates
            allMessages.length = 0;
          }
        } catch (stagedError) {
          console.error(`⚠️ Staged Google Docs save failed:`, stagedError);
          // Continue with scraping even if staged save fails
        }
      }

      // Check if there are more messages
      hasMore = messagesResponse.has_more;
      cursor = messagesResponse.response_metadata?.next_cursor;

      // Reduced delay between batches for faster processing
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Reduced from 200ms to 100ms
      }
    }

    // Save to Google Docs if we have messages
    let googleDocResult = null;
    if (allMessages.length > 0 && (drive && docs)) {
      console.log(`💾 Saving ${allMessages.length} messages to Google Docs...`);
      
      try {
        // Determine message type from job type or channel ID
        let messageType = job.channelType || 'channel';
        if (actualChannelId.startsWith('D')) {
          messageType = 'dm';
        } else if (actualChannelId.startsWith('G')) {
          messageType = 'group';
        }
        
        googleDocResult = await saveMessagesToGoogleDocs(
          connection.id,
          actualChannelId,
          channelInfo?.name || 'Unknown Channel',
          allMessages,
          messageType,
          connection
        );
        
        if (googleDocResult) {
          console.log(`✅ Google Doc created: ${googleDocResult.url}`);
        }
      } catch (googleError) {
        console.error(`⚠️ Google Docs save failed (continuing with database save):`, googleError);
        // Don't fail the entire job if Google Docs save fails
      }
    } else if (!drive || !docs) {
      console.log(`⚠️ Google Docs integration not configured (missing Google API credentials)`);
    }

    // Job completed successfully
    await prisma.slackScrapingJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        progress: 100,
        messagesScraped: totalMessages,
        completedAt: new Date()
      }
    });

    console.log(`Completed scraping job ${job.id}: ${totalMessages} messages (${allMessages.length} saved to Google Docs)`);
    console.log(`📊 Job metrics: ${totalFetchAttempts} fetch attempts, ${failedMessages} failed messages, ${threadMessagesFetched} thread messages`);
    
    return {
      totalMessages,
      googleDocResult,
      metrics: {
        totalFetchAttempts,
        failedMessages,
        retryCount,
        threadMessagesFetched
      }
    };

  } catch (error) {
    console.error(`Error in scraping job ${job.id}:`, error);
    
    // Categorize error types for better dashboard display
    let errorCategory = 'unknown';
    let userFriendlyMessage = error.message;
    
    if (error.message.includes('not_in_channel')) {
      errorCategory = 'access_denied';
      userFriendlyMessage = 'Bot not a member of this channel';
    } else if (error.message.includes('channel_not_found')) {
      errorCategory = 'not_found';
      userFriendlyMessage = 'Channel no longer exists or bot lacks access';
    } else if (error.message.includes('ratelimited') || error.message.includes('429')) {
      errorCategory = 'rate_limited';
      userFriendlyMessage = 'Rate limited - will retry automatically';
    } else if (error.message.includes('missing_scope')) {
      errorCategory = 'permission';
      userFriendlyMessage = 'Insufficient permissions to access channel';
    }
    
    // Mark job as failed with categorized error
    await prisma.slackScrapingJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        errorMessage: userFriendlyMessage,
        completedAt: new Date()
      }
    });
    
    // Log detailed error for debugging
    console.error(`❌ Job ${job.id} failed [${errorCategory}]: ${userFriendlyMessage}`);
  }
}

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
    
    let hasMore = true;
    let cursor = null;
    let totalMessages = 0;
    let allMessages = []; // Collect all messages for Google Docs
    const batchSize = 1000; // Larger batch size for history export
    let actualChannelId = job.channelId;
    let channelInfo = null;
    
    // History export tracking metrics
    let totalFetchAttempts = 0;
    let failedMessages = 0;
    let threadMessagesFetched = 0;
    let docsCreated = 0;

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
          
          if (user && !user.deleted && !user.is_bot) {
            const userName = user.display_name || user.real_name || user.name;
            channelInfo = { name: `DM with ${userName}`, isPrivate: true };
          } else {
            channelInfo = { name: `DM with ${userId}`, isPrivate: true };
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

    // HISTORY EXPORT LOOP - NO LIMITS
    console.log(`🔄 Starting unlimited history fetch for ${actualChannelId}...`);
    
    while (hasMore) {
      totalFetchAttempts++;
      console.log(`📚 History export batch ${totalFetchAttempts} for ${actualChannelId}, cursor: ${cursor ? cursor.substring(0, 10) + '...' : 'none'}`);
      
      // Fetch messages from Slack using intelligent token fallback
      const messagesResponse = await fetchChannelMessages(
        connection.accessToken, 
        actualChannelId, 
        cursor, 
        batchSize, // Larger batch size for history export
        connection.userToken
      );

      if (!messagesResponse.ok) {
        throw new Error(`Slack API error: ${messagesResponse.error}`);
      }

      const messages = messagesResponse.messages || [];
      console.log(`📚 History export fetched ${messages.length} messages (batch ${totalFetchAttempts})`);

      // Save messages to database and collect for Google Docs
      for (const message of messages) {
        await saveMessageToDatabase(connection.id, actualChannelId, channelInfo?.name, message);
        
        // Collect ALL valid messages for Google Docs (no filtering by date)
        if (!message.bot_id && message.text && (!message.subtype || CAPTURE_MESSAGE_SUBTYPES.includes(message.subtype))) {
          allMessages.push(message);
        }
        
        // For history export, fetch ALL thread replies (no date restrictions)
        if (message.thread_ts && message.thread_ts === message.ts) {
          try {
            const threadMessages = await fetchThreadReplies(
              connection.accessToken,
              actualChannelId,
              message.thread_ts,
              connection.userToken
            );
            
            // Save thread replies to database
            for (const threadMessage of threadMessages) {
              await saveMessageToDatabase(connection.id, actualChannelId, channelInfo?.name, threadMessage);
              
              if (!threadMessage.bot_id && threadMessage.text && (!threadMessage.subtype || CAPTURE_MESSAGE_SUBTYPES.includes(threadMessage.subtype))) {
                allMessages.push(threadMessage);
              }
              
              totalMessages++;
            }
            
            threadMessagesFetched += threadMessages.length;
            console.log(`📝 History export: Fetched ${threadMessages.length} thread replies for message ${message.ts}`);
          } catch (threadError) {
            console.warn(`⚠️ Failed to fetch thread replies for ${message.ts}:`, threadError.message);
            failedMessages++;
          }
        }
        
        totalMessages++;
      }

      // Update progress more frequently for history export
      await prisma.slackScrapingJob.update({
        where: { id: job.id },
        data: {
          messagesScraped: totalMessages,
          progress: Math.min(95, Math.floor((totalMessages / 10000) * 100)) // Progress estimate for large exports
        }
      });

      // Save to Google Docs every 1000 messages for history export
      if (allMessages.length >= 1000 && (drive && docs)) {
        try {
          console.log(`💾 History export: Creating Google Doc with ${allMessages.length} messages...`);
          
          let messageType = job.channelType || 'channel';
          if (actualChannelId.startsWith('D')) {
            messageType = 'dm';
          } else if (actualChannelId.startsWith('G')) {
            messageType = 'group';
          }
          
          const stagedDocResult = await saveMessagesToGoogleDocs(
            connection.id,
            actualChannelId,
            channelInfo?.name || 'Unknown Channel',
            allMessages,
            messageType,
            connection
          );
          
          if (stagedDocResult) {
            docsCreated++;
            console.log(`✅ History export: Google Doc ${docsCreated} created: ${stagedDocResult.url}`);
            // Clear the array after successful save
            allMessages.length = 0;
          }
        } catch (stagedError) {
          console.error(`⚠️ History export Google Docs save failed:`, stagedError);
          // Continue with export even if Google Docs save fails
        }
      }

      // Check if there are more messages
      hasMore = messagesResponse.has_more;
      cursor = messagesResponse.response_metadata?.next_cursor;

      // Small delay between batches to be respectful to Slack API
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Save any remaining messages to Google Docs
    let googleDocResult = null;
    if (allMessages.length > 0 && (drive && docs)) {
      try {
        console.log(`💾 History export: Final Google Doc save with ${allMessages.length} messages...`);
        
        let messageType = job.channelType || 'channel';
        if (actualChannelId.startsWith('D')) {
          messageType = 'dm';
        } else if (actualChannelId.startsWith('G')) {
          messageType = 'group';
        }
        
        googleDocResult = await saveMessagesToGoogleDocs(
          connection.id,
          actualChannelId,
          channelInfo?.name || 'Unknown Channel',
          allMessages,
          messageType,
          connection
        );
        
        if (googleDocResult) {
          docsCreated++;
          console.log(`✅ History export: Final Google Doc created: ${googleDocResult.url}`);
        }
      } catch (error) {
        console.error('History export: Final Google Docs save failed:', error);
      }
    }

    // Job completed successfully
    await prisma.slackScrapingJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        progress: 100,
        messagesScraped: totalMessages,
        completedAt: new Date()
      }
    });

    console.log(`✅ History export completed for ${job.id}: ${totalMessages} messages total, ${docsCreated} Google Docs created`);

    return {
      totalMessages,
      googleDocResult,
      docsCreated,
      metrics: {
        totalFetchAttempts,
        failedMessages,
        threadMessagesFetched
      }
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

async function getChannelInfo(accessToken, channelId) {
  const requestFn = async () => {
    return await axios.get('https://slack.com/api/conversations.info', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      params: {
        channel: channelId
      }
    });
  };

  try {
    const response = await slackRateLimiter.makeRequest(requestFn, `fetch channel info for ${channelId}`);

    if (response.data.ok) {
      return {
        name: response.data.channel.name,
        isPrivate: response.data.channel.is_private,
        memberCount: response.data.channel.num_members
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching channel info:', error);
    return null;
  }
}

// Enhanced retry wrapper with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 500) { // Reduced base delay from 1000 to 500
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Handle rate limiting with Retry-After header
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after']) || 2; // Reduced from 5 to 2
        const waitTime = retryAfter * 1000;
        console.log(`⏱️ Rate limited, waiting ${retryAfter}s (Retry-After header)`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Exponential backoff for other errors (less aggressive)
      const delay = baseDelay * Math.pow(1.5, attempt - 1); // Reduced from 2 to 1.5
      console.log(`🔄 Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function fetchChannelMessages(accessToken, channelId, cursor = null, limit = 100, userToken = null) {
  const params = {
    channel: channelId,
    limit: limit,
    include_all_metadata: true
  };

  if (cursor) {
    params.cursor = cursor;
  }

  // Use user token directly for better access
  const token = userToken || accessToken;
  const tokenType = userToken ? 'User Token' : 'Bot Token';

  const requestFn = async () => {
    return await axios.get('https://slack.com/api/conversations.history', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      params: params
    });
  };

  try {
    console.log(`🔄 Fetching messages from ${channelId} using ${tokenType}...`);
    
    // Wrap with retry logic
    const response = await retryWithBackoff(async () => {
      return await slackRateLimiter.makeRequest(requestFn, `fetch messages from ${channelId}`);
    }, 3, 1000);

    console.log(`📊 ${tokenType} Response: ${response.data.ok ? 'SUCCESS' : 'FAILED'}`);
    
    if (response.data.ok) {
      console.log(`✅ ${tokenType}: Retrieved ${response.data.messages?.length || 0} messages`);
      return response.data;
    } else {
      const error = response.data.error;
      console.log(`❌ ${tokenType} Error: ${error}`);
      
      // Log additional error details for debugging
      if (response.data.needed) {
        console.log(`   Required scopes: ${response.data.needed}`);
      }
      if (response.data.provided) {
        console.log(`   Provided scopes: ${response.data.provided}`);
      }
      
      return response.data;
    }
  } catch (error) {
    console.error(`❌ Network error with ${tokenType} for ${channelId}:`, error.message);
    if (error.response?.data) {
      console.error('   Response data:', error.response.data);
    }
    
    return { ok: false, error: error.message };
  }
}

// Fetch thread replies using conversations.replies
async function fetchThreadReplies(accessToken, channelId, threadTs, userToken = null) {
  const token = userToken || accessToken;
  const tokenType = userToken ? 'User Token' : 'Bot Token';

  const requestFn = async () => {
    return await axios.get('https://slack.com/api/conversations.replies', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      params: {
        channel: channelId,
        ts: threadTs,
        limit: 1000
      }
    });
  };

  try {
    console.log(`🧵 Fetching thread replies for ${threadTs} using ${tokenType}...`);
    
    const response = await retryWithBackoff(async () => {
      return await slackRateLimiter.makeRequest(requestFn, `fetch thread replies for ${threadTs}`);
    }, 3, 1000);

    if (response.data.ok) {
      // Skip the first message (it's the parent message we already have)
      const replies = response.data.messages.slice(1);
      console.log(`✅ ${tokenType}: Retrieved ${replies.length} thread replies`);
      return replies;
    } else {
      console.log(`❌ ${tokenType} Thread Error: ${response.data.error}`);
      return [];
    }
  } catch (error) {
    console.error(`❌ Thread fetch error with ${tokenType}:`, error.message);
    return [];
  }
}

// Message filtering allowlist - only skip specific unwanted message types
const SKIP_MESSAGE_SUBTYPES = [
  'bot_message',           // Bot messages
  'me_message',            // /me messages
  'channel_join',          // User joined channel
  'channel_leave',         // User left channel
  'channel_topic',         // Channel topic changes
  'channel_purpose',       // Channel purpose changes
  'channel_name',          // Channel name changes
  'channel_archive',       // Channel archived
  'channel_unarchive',     // Channel unarchived
  'group_join',            // User joined group
  'group_leave',           // User left group
  'group_topic',           // Group topic changes
  'group_purpose',         // Group purpose changes
  'group_name',            // Group name changes
  'group_archive',         // Group archived
  'group_unarchive',       // Group unarchived
  'file_comment',          // File comment (separate from file_share)
  'file_mention',          // File mention
  'pinned_item',           // Item pinned
  'unpinned_item'          // Item unpinned
];

// Message types we want to capture
const CAPTURE_MESSAGE_SUBTYPES = [
  'message_changed',       // Message edits
  'file_share',            // File uploads
  'thread_broadcast'       // Thread broadcasts
];

async function saveMessageToDatabase(connectionId, channelId, channelName, message) {
  try {
    // Enhanced message filtering with allowlist approach
    if (message.bot_id) {
      return; // Skip bot messages
    }
    
    // Check if message subtype should be skipped
    if (message.subtype && SKIP_MESSAGE_SUBTYPES.includes(message.subtype)) {
      return;
    }
    
    // For message_changed, use the updated message content
    if (message.subtype === 'message_changed') {
      message = message.message; // Use the updated message
    }

    // Determine message type
    let messageType = 'channel';
    if (channelId.startsWith('D')) {
      messageType = 'dm';
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
      return; // Skip duplicate
    }

    // Get user info if needed
    let userName = null;
    if (message.user) {
      // We could cache user info to avoid repeated API calls
      userName = `user_${message.user}`;
    }

    // Extract participants from thread or channel
    const participants = [];
    if (message.user) participants.push(message.user);
    if (message.thread_ts && message.replies) {
      message.replies.forEach(reply => {
        if (reply.user && !participants.includes(reply.user)) {
          participants.push(reply.user);
        }
      });
    }

    // Save to database
    await prisma.slackConversation.create({
      data: {
        slackConnectionId: connectionId,
        messageTs: message.ts,
        channelId: channelId,
        channelName: channelName || 'Unknown',
        userId: message.user || 'unknown',
        userName: userName,
        messageText: message.text || '',
        messageType: messageType,
        threadTs: message.thread_ts || null,
        participants: participants,
        tags: [] // We could add AI-based tagging later
      }
    });

  } catch (error) {
    console.error('Error saving message to database:', error);
    // Don't throw - continue with other messages
  }
}

// Get scraping job status
router.get('/scraping-jobs/:jobId', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await prisma.slackScrapingJob.findUnique({
      where: { id: jobId },
      include: {
        slackConnection: true
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    console.error('Error fetching scraping job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check Google Docs integration status
router.get('/google-docs/status', authenticateToken, async (req, res) => {
  try {
    // Check for both authentication methods
    const hasServiceAccount = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    const hasOAuth2 = !!(
      process.env.GOOGLE_CLIENT_ID && 
      process.env.GOOGLE_CLIENT_SECRET && 
      process.env.GOOGLE_REFRESH_TOKEN
    );
    
    const hasGoogleCredentials = hasOAuth2 || hasServiceAccount;
    let googleDriveAccess = false;
    let googleDocsAccess = false;
    let rootFolderName = process.env.GOOGLE_ROOT_FOLDER_NAME || 'Slack Automation Discovery';
    let authMethod = hasOAuth2 ? 'oauth2' : hasServiceAccount ? 'service_account' : 'none';
    
    console.log('🔍 Google Drive status check:', {
      hasOAuth2,
      hasServiceAccount,
      hasGoogleCredentials,
      authMethod,
      driveInitialized: !!drive,
      docsInitialized: !!docs
    });

    if (hasGoogleCredentials && drive && docs) {
      try {
        // Test Google Drive access
        const driveResponse = await drive.files.list({
          pageSize: 1,
          fields: 'files(id, name)'
        });
        googleDriveAccess = !!driveResponse.data;

        // Test Google Docs access by checking about endpoint (no quota usage)
        const aboutResponse = await drive.about.get({
          fields: 'user,storageQuota'
        });
        
        googleDocsAccess = !!aboutResponse.data;
        
        console.log('📋 Google Drive integration status:', {
          user: aboutResponse.data.user?.emailAddress,
          storageUsed: aboutResponse.data.storageQuota?.usage,
          storageLimit: aboutResponse.data.storageQuota?.limit
        });
        
      } catch (apiError) {
        console.warn('Google APIs access test failed:', apiError.message);
        // Still consider it working if we can access the API, even with quota issues
        if (apiError.code === 403 && apiError.message.includes('quota')) {
          googleDriveAccess = true;
          googleDocsAccess = true;
          console.log('⚠️ Google Drive quota exceeded, but integration is configured correctly');
        }
      }
    }

    const response = {
      configured: hasGoogleCredentials && googleDriveAccess && googleDocsAccess,
      authMethod,
      googleDriveAccess,
      googleDocsAccess,
      rootFolderName,
      status: hasGoogleCredentials && googleDriveAccess && googleDocsAccess 
        ? 'ready' 
        : hasGoogleCredentials 
          ? 'error' 
          : 'not_configured',
      debug: {
        hasOAuth2,
        hasServiceAccount,
        driveInitialized: !!drive,
        docsInitialized: !!docs
      }
    };
    
    console.log('📤 Sending Google Drive status response:', response);
    res.json(response);
  } catch (error) {
    console.error('Error checking Google Docs status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual Google Docs export for existing data
router.post('/google-docs/export', authenticateToken, async (req, res) => {
  try {
    const { channelId, connectionId, dateRange } = req.body;

    if (!channelId || !connectionId) {
      return res.status(400).json({ error: 'channelId and connectionId are required' });
    }

    // Check if Google Docs is configured
    if (!drive || !docs) {
      return res.status(400).json({ error: 'Google Docs integration not configured' });
    }

    // Get connection details
    const connection = await prisma.slackConnection.findUnique({
      where: { id: connectionId }
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Get channel info
    const channelInfo = await getChannelInfo(connection.accessToken, channelId);
    if (!channelInfo) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Build query for messages
    let whereClause = {
      connectionId: connectionId,
      channelId: channelId
    };

    // Add date range filter if specified
    if (dateRange && dateRange.start && dateRange.end) {
      whereClause.createdAt = {
        gte: new Date(dateRange.start),
        lte: new Date(dateRange.end)
      };
    }

    // Get messages from database
    const dbMessages = await prisma.slackConversation.findMany({
      where: whereClause,
      orderBy: { timestamp: 'desc' }
    });

    if (dbMessages.length === 0) {
      return res.status(404).json({ error: 'No messages found for the specified criteria' });
    }

    // Convert database messages to Slack format for Google Docs
    const slackMessages = dbMessages.map(msg => ({
      ts: msg.timestamp,
      user: msg.userId,
      text: msg.content,
      user_profile: {
        display_name: msg.userName,
        real_name: msg.userName
      }
    }));

    // Determine message type
    let messageType = 'channel';
    if (channelId.startsWith('D')) {
      messageType = 'dm';
    } else if (channelId.startsWith('G')) {
      messageType = 'group';
    }

    // Save to Google Docs
    const googleDocResult = await saveMessagesToGoogleDocs(
      connectionId,
      channelId,
      channelInfo.name,
      slackMessages,
      messageType,
      connection
    );

    if (!googleDocResult) {
      return res.status(500).json({ error: 'Failed to create Google Doc' });
    }

    res.json({
      success: true,
      message: 'Messages exported to Google Docs',
      googleDoc: googleDocResult,
      messagesExported: slackMessages.length
    });

  } catch (error) {
    console.error('Error in manual Google Docs export:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Enhanced job status with Google Docs info
router.get('/scraping-jobs/:jobId/detailed', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await prisma.slackScrapingJob.findUnique({
      where: { id: jobId },
      include: {
        slackConnection: true
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Add Google Docs integration status
    const googleDocsStatus = {
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN),
      available: job.status === 'completed'
    };

    // If job is completed, try to find associated Google Doc
    let googleDoc = null;
    if (job.status === 'completed' && job.channelName && googleDocsStatus.configured) {
      try {
        // Get the year from job completion date
        const year = new Date(job.completedAt).getFullYear();
        const userInfo = job.slackConnection ? {
          userId: job.slackConnection.slackUserId,
          teamName: job.slackConnection.slackTeamName
        } : null;
        const folders = await setupGoogleDriveFolders(year, userInfo);
        
        // Search for document using new naming convention
        const messageType = job.channelId.startsWith('D') ? 'dm' : 'channel';
        const targetFolderId = messageType === 'dm' ? folders.dmFolderId : folders.channelFolderId;
        
        // Use the new document naming convention
        const documentNamePattern = messageType === 'channel' 
          ? `#${job.channelName}`
          : job.channelName;
          
        const searchResponse = await drive.files.list({
          q: `name contains '${documentNamePattern}' and mimeType='application/vnd.google-apps.document' and '${targetFolderId}' in parents and trashed=false`,
          fields: 'files(id, name, createdTime, webViewLink)',
          orderBy: 'createdTime desc'
        });
        
        if (searchResponse.data.files && searchResponse.data.files.length > 0) {
          const doc = searchResponse.data.files[0];
          googleDoc = {
            id: doc.id,
            name: doc.name,
            url: doc.webViewLink,
            createdTime: doc.createdTime
          };
        }
      } catch (googleError) {
        console.warn('Error checking for Google Doc:', googleError);
      }
    }

    res.json({
      ...job,
      googleDocs: {
        status: googleDocsStatus,
        document: googleDoc
      }
    });
  } catch (error) {
    console.error('Error fetching detailed job status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save conversation to Google Drive
router.post('/save-conversation', authenticateToken, async (req, res) => {
  try {
    const { title, content, conversationType = 'conversation' } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    // Check if Google APIs are configured
    if (!drive || !docs) {
      return res.status(400).json({ error: 'Google Docs integration not configured' });
    }

    // Get current year for folder organization
    const currentYear = new Date().getFullYear();
    
    // Setup folder structure
    const folders = await setupGoogleDriveFolders(currentYear, null);
    
    // Create conversation title with timestamp
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const conversationTitle = `${title} - ${timestamp}`;
    
    // Format content for Google Docs
    const formattedContent = {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: `${conversationTitle}\n\n`
          }
        },
        {
          insertText: {
            location: { index: conversationTitle.length + 3 },
            text: `Type: ${conversationType}\n`
          }
        },
        {
          insertText: {
            location: { index: conversationTitle.length + 3 + `Type: ${conversationType}\n`.length },
            text: `Saved: ${new Date().toLocaleString()}\n\n`
          }
        },
        {
          insertText: {
            location: { index: conversationTitle.length + 3 + `Type: ${conversationType}\n`.length + `Saved: ${new Date().toLocaleString()}\n\n`.length },
            text: content
          }
        }
      ]
    };
    
    // Create Google Doc
    const doc = await createOrUpdateGoogleDoc(
      folders.yearFolderId,
      conversationTitle,
      formattedContent
    );
    
    console.log(`✅ Saved conversation to Google Doc: ${doc.url}`);
    
    res.json({
      success: true,
      message: 'Conversation saved to Google Drive',
      googleDoc: doc
    });

  } catch (error) {
    console.error('Error saving conversation to Google Drive:', error);
    res.status(500).json({ error: 'Failed to save conversation to Google Drive' });
  }
});

// Admin: Get all scraping jobs with workspace info
router.get('/admin/scraping-jobs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Not completed jobs (pending, running, failed, etc)
    const jobs = await prisma.slackScrapingJob.findMany({
      where: { status: { not: 'completed' } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        slackConnection: {
          select: {
            slackTeamName: true
          }
        }
      }
    });
    // Completed jobs
    const completedJobs = await prisma.slackScrapingJob.findMany({
      where: { status: 'completed' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        slackConnection: {
          select: {
            slackTeamName: true
          }
        }
      }
    });
    res.json({ jobs, completedJobs });
  } catch (error) {
    console.error('Get admin scraping jobs error:', error);
    res.status(500).json({ error: 'Failed to retrieve scraping jobs' });
  }
});

// Admin: Delete a specific scraping job
router.delete('/admin/scraping-jobs/:jobId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Check if job exists
    const job = await prisma.slackScrapingJob.findUnique({
      where: { id: jobId }
    });
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Delete the job
    await prisma.slackScrapingJob.delete({
      where: { id: jobId }
    });
    
    console.log(`✅ Admin deleted scraping job: ${jobId}`);
    
    res.json({
      success: true,
      message: 'Scraping job deleted successfully',
      jobId
    });
  } catch (error) {
    console.error('Delete scraping job error:', error);
    res.status(500).json({ error: 'Failed to delete scraping job' });
  }
});

module.exports = router; 