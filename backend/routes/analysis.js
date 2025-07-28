const express = require('express');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');
const { analyzeConnectionConversationsFiltered, analyzeWithGemini, analyzeWithOpenAI, storeAnalysisResults } = require('../analysis-runner/analysis-core');
const axios = require('axios');
const { getUsersMap } = require('./slack');

const router = express.Router();
const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Performance debugging
const DEBUG_PERF = true;

function logPerformance(req, operation, startTime) {
  if (!DEBUG_PERF) return;
  const duration = Date.now() - startTime;
  console.log(`[PERF] ${operation} completed in ${duration}ms | URL: ${req.originalUrl}`);
  if (duration > 1000) {
    console.warn(`⚠️ [SLOW REQUEST] ${operation} took ${duration}ms to complete | URL: ${req.originalUrl}`);
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

// Middleware to require admin role
const requireAdmin = (req, res, next) => {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Get channels for a workspace
router.get('/channels', authenticateToken, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  const { connectionId } = req.query;
  if (!connectionId) return res.status(400).json({ error: 'connectionId required' });

  try {
    console.log(`[DEBUG] Fetching channels for connectionId: ${connectionId}`);
    const channels = await prisma.slackConversation.findMany({
      where: { slackConnectionId: connectionId },
      select: { channelId: true, channelName: true },
      distinct: ['channelId', 'channelName'],
      orderBy: { channelName: 'asc' }
    });
    
    logPerformance(req, 'Fetching channels', startTime);
    res.json({ channels });
  } catch (error) {
    console.error(`[ERROR] Failed to fetch channels: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// Get years for a channel in a workspace
router.get('/years', authenticateToken, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  const { connectionId, channelId } = req.query;
  
  if (!connectionId || !channelId) return res.status(400).json({ error: 'connectionId and channelId required' });
  
  try {
    console.log(`[DEBUG] Fetching years for connectionId: ${connectionId}, channelId: ${channelId}`);
    
    const messages = await prisma.slackConversation.findMany({
      where: { slackConnectionId: connectionId, channelId },
      select: { slackSentAt: true, createdAt: true }
    });
    
    console.log(`[DEBUG] Found ${messages.length} messages`);

    const years = [
      ...new Set(
        messages
          .map(m => {
            const date = m.slackSentAt;
            return date ? date.getFullYear() : null;
          })
          .filter(year => year !== null)
      )
    ].sort((a, b) => b - a);
    
    logPerformance(req, 'Fetching years', startTime);
    res.json({ years });
  } catch (error) {
    console.error(`[ERROR] Failed to fetch years: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch years' });
  }
});

// Get all people for a workspace (original logic, for AdminOrgChart.jsx)
router.get('/people', authenticateToken, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  let { connectionId, slackTeamId } = req.query;
  
  try {
    if (!connectionId && slackTeamId) {
      // Look up the connection by slackTeamId
      console.log(`[DEBUG] Looking up connection by slackTeamId: ${slackTeamId}`);
      const connection = await prisma.slackConnection.findFirst({ where: { slackTeamId } });
      if (!connection) return res.status(404).json({ error: 'Slack connection not found' });
      connectionId = connection.id;
    }
    
    if (!connectionId) return res.status(400).json({ error: 'connectionId or slackTeamId required' });
    
    console.log(`[DEBUG] Fetching people for connectionId: ${connectionId}`);
    
    // FIXED: Use a single optimized query with groupBy
    console.time('peopleChannels-query');
    const peopleChannels = await prisma.$queryRaw`
      SELECT 
        "userId", 
        MAX("userName") as "userName", 
        ARRAY_AGG(DISTINCT "channelId") as "channelIds"
      FROM "slack_conversations"
      WHERE "slackConnectionId" = ${connectionId} AND "userId" IS NOT NULL
      GROUP BY "userId"
    `;
    console.timeEnd('peopleChannels-query');
    
    console.log(`[DEBUG] Found ${peopleChannels.length} unique users with conversations`);
    
    // Get Slack user directory once
    console.log(`[DEBUG] Fetching connection details for connectionId: ${connectionId}`);
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });

    let usersMap = new Map();
    if (connection && connection.userToken && connection.slackTeamId) {
      try {
        console.log(`[DEBUG] Fetching Slack users map with token for team: ${connection.slackTeamId}`);
        console.time('usersMap-fetch');
        usersMap = await getUsersMap(connection.userToken, connection.slackTeamId);
        console.timeEnd('usersMap-fetch');
        console.log(`[DEBUG] Retrieved ${usersMap.size} users from Slack API`);
      } catch (err) {
        console.error(`[ERROR] Failed to fetch Slack users for real names: ${err.message}`);
      }
    }
    
    // Return all users in the workspace, not just those in conversations
    const people = Array.from(usersMap.values())
      .filter(u => !u.deleted && !u.is_bot)
      .map(u => ({
        id: u.id,
        name: u.display_name || u.real_name || u.name || u.id,
        email: u.profile?.email,
        isActive: !u.deleted,
      }));
      
    // Get list of userIds with conversations in one go
    const peopleWithConversations = peopleChannels.map(p => p.userId);
    
    logPerformance(req, 'Fetching people', startTime);
    res.json({ people, peopleWithConversations });
  } catch (error) {
    console.error(`[ERROR] Failed to fetch people: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch people' });
  }
});

// New endpoint: Get all people across all connections for a given team
router.get('/team-people', authenticateToken, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  const { slackTeamId } = req.query;
  
  if (!slackTeamId) return res.status(400).json({ error: 'slackTeamId required' });
  
  try {
    // Find all connections for this team
    console.log(`[DEBUG] Fetching connections for slackTeamId: ${slackTeamId}`);
    const connections = await prisma.slackConnection.findMany({ 
      where: { slackTeamId },
      select: { id: true, userToken: true }
    });
    
    if (connections.length === 0) {
      return res.status(404).json({ error: 'No connections found for this team' });
    }
    
    const connectionIds = connections.map(c => c.id);
    console.log(`[DEBUG] Found ${connectionIds.length} connections for team ${slackTeamId}`);
    
    // Get all people with conversations across all connections for this team
    // First, get all conversations for these connections
    const allConversations = await prisma.slackConversation.findMany({
      where: {
        slackConnectionId: { in: connectionIds }
      },
      select: {
        userId: true,
        userName: true,
        channelId: true,
        slackConnectionId: true
      }
    });
    
    console.log(`[DEBUG] Retrieved ${allConversations.length} total conversations`);
    
    // Filter out conversations with null or empty userIds
    const conversations = allConversations.filter(convo => convo.userId && convo.userId !== '');
    
    console.log(`[DEBUG] Found ${conversations.length} unique users with conversations across all connections`);
    
    console.log(`[DEBUG] Retrieved ${conversations.length} conversations, filtering valid users`);
    
    // Group channels and connections by user
    const userMap = {};
    for (const convo of conversations) {
      // Skip entries with invalid userId
      if (!convo.userId) {
        console.log(`[DEBUG] Skipping conversation with null/empty userId`);
        continue;
      }
      
      if (!userMap[convo.userId]) {
        userMap[convo.userId] = {
          id: convo.userId,
          name: convo.userName || convo.userId,
          channelIds: new Set(),
          connectionIds: new Set()
        };
      }
      
      if (convo.channelId) {
        userMap[convo.userId].channelIds.add(convo.channelId);
      }
      
      if (convo.slackConnectionId) {
        userMap[convo.userId].connectionIds.add(convo.slackConnectionId);
      }
    }
    
    console.log(`[DEBUG] Found ${Object.keys(userMap).length} valid users after filtering`);
    
    // Find a connection with a valid userToken to fetch user info
    let usersMap = new Map();
    const connectionWithToken = connections.find(c => c.userToken);
    
    if (connectionWithToken) {
      try {
        console.log(`[DEBUG] Fetching Slack users map with token for team: ${slackTeamId}`);
        console.time('usersMap-fetch');
        usersMap = await getUsersMap(connectionWithToken.userToken, slackTeamId);
        console.timeEnd('usersMap-fetch');
        console.log(`[DEBUG] Retrieved ${usersMap.size} users from Slack API`);
      } catch (err) {
        console.error(`[ERROR] Failed to fetch Slack users for real names: ${err.message}`);
      }
    }
    
    // Convert Sets to arrays and enhance with Slack user info
    const people = Object.values(userMap).map(user => {
      const slackUser = usersMap.get(user.id);
      return {
        id: user.id,
        name: slackUser ? (slackUser.display_name || slackUser.real_name || slackUser.name || user.name) : user.name,
        channelIds: Array.from(user.channelIds),
        connectionIds: Array.from(user.connectionIds)
      };
    });
    
    logPerformance(req, 'Fetching team people', startTime);
    res.json({ people });
  } catch (error) {
    console.error(`[ERROR] Failed to fetch team people: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({ error: 'Failed to fetch team people' });
  }
});

// New endpoint: Get only the user who created the SlackConnection (for Analysis.jsx)
router.get('/people-for-analysis', authenticateToken, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  const { connectionId } = req.query;
  
  if (!connectionId) return res.status(400).json({ error: 'connectionId required' });
  
  try {
    // Find the SlackConnection for this workspace
    console.log(`[DEBUG] Fetching SlackConnection for connectionId: ${connectionId}`);
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) return res.status(404).json({ error: 'Slack connection not found' });
    
    // Only return the user who created this SlackConnection
    console.log(`[DEBUG] Fetching user for userId: ${connection.userId}`);
    const user = await prisma.user.findUnique({ where: { id: connection.userId } });
    if (!user) return res.json({ people: [] });
    
    // Optionally, fetch Slack user info for display name
    let displayName = user.name || user.email || user.id;
    if (connection.userToken && connection.slackTeamId && connection.slackUserId) {
      try {
        console.log(`[DEBUG] Fetching user info from Slack for userId: ${connection.slackUserId}`);
        console.time('slack-user-fetch');
        const usersMap = await getUsersMap(connection.userToken, connection.slackTeamId);
        const slackUser = usersMap.get(connection.slackUserId);
        if (slackUser) {
          displayName = slackUser.display_name || slackUser.real_name || slackUser.name || displayName;
        } else {
          // Fallback to users.info if not found in cache
          const response = await axios.get('https://slack.com/api/users.info', {
            headers: {
              'Authorization': `Bearer ${connection.userToken}`,
              'Content-Type': 'application/json'
            },
            params: { user: connection.slackUserId }
          });
          if (response.data.ok && response.data.user) {
            displayName = response.data.user.profile?.display_name || response.data.user.profile?.real_name || displayName;
          }
        }
        console.timeEnd('slack-user-fetch');
      } catch (err) {
        console.error(`[ERROR] Failed to fetch Slack user real name: ${err.message}`);
      }
    }
    
    logPerformance(req, 'Fetching people for analysis', startTime);
    res.json({ people: [{ id: connection.slackUserId, name: displayName, channelIds: [] }] });
  } catch (error) {
    console.error(`[ERROR] Failed to fetch people for analysis: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch people for analysis' });
  }
});

// Trigger analysis for user's conversations (admin only)
router.post('/run', authenticateToken, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  try {
    const { connectionId, channelIds, personId, slackTeamId } = req.body;
    console.log(`[DEBUG] Running analysis for connectionId: ${connectionId}, channels: ${channelIds?.length || 0}, personId: ${personId || 'none'}, slackTeamId: ${slackTeamId || 'none'}`);
    
    // Validate that we have a connectionId
    if (!connectionId) {
      return res.status(400).json({ error: 'connectionId is required' });
    }
    
    // Verify the connection exists
    const connection = await prisma.slackConnection.findUnique({
      where: { id: connectionId }
    });
    
    if (!connection) {
      return res.status(404).json({ error: `Connection ${connectionId} not found` });
    }
    
    // Forward the request to the analysis-runner service with timeout
    const runnerUrl = process.env.ANALYSIS_RUNNER_URL || 'http://localhost:3003/trigger/analysis';
    console.log(`[DEBUG] Forwarding to analysis runner at: ${runnerUrl}`);
    console.time('analysis-runner-request');
    
    const payload = {
      connectionId,
      channelIds,
      personId,
      slackTeamId,
      timeout: 180000 // 3 minute timeout
    };
    
    const response = await axios.post(runnerUrl, payload, {
      timeout: 240000 // 4 minutes
    });
    console.timeEnd('analysis-runner-request');
    
    // Check if the response contains the expected data structure
    if (response.data && response.data.success) {
      console.log(`[DEBUG] Analysis completed successfully`);
      logPerformance(req, 'Running analysis', startTime);
      res.json(response.data);
    } else {
      // If response doesn't have expected structure, return a more helpful error
      console.log(`[DEBUG] Analysis runner response:`, response.data);
      logPerformance(req, 'Running analysis', startTime);
      res.json({
        success: true,
        message: 'Analysis request submitted successfully',
        status: 'completed',
        results: response.data
      });
    }
  } catch (error) {
    console.error(`[ERROR] Analysis runner proxy error: ${error.message}`);
    console.error(error.stack);
    if (error.code === 'ECONNABORTED') {
      // Handle timeout specifically
      res.status(504).json({ 
        error: 'Analysis timed out, but may still be processing in the background',
        status: 'timeout'
      });
    } else if (error.response) {
      console.error(`[ERROR] Analysis runner response error:`, error.response.data);
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ 
        error: 'Failed to run analysis',
        details: error.message
      });
    }
  }
});

// Get analysis results (admin only)
router.get('/results', authenticateToken, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  try {
    const { connectionId, analysisId, limit = 50, offset = 0 } = req.query;
    console.log(`[DEBUG] Fetching analysis results for connectionId: ${connectionId}, analysisId: ${analysisId}, limit: ${limit}, offset: ${offset}`);
    
    const whereClause = {};

    if (connectionId) {
      whereClause.slackConversation = {
        slackConnectionId: connectionId
      };
    }
    
    if (analysisId) {
      whereClause.analysisId = analysisId;
    }

    console.time('tasks-query');
    const tasks = await prisma.automationTask.findMany({
      where: whereClause,
      include: {
        slackConversation: {
          select: {
            channelName: true,
            messageType: true,
            createdAt: true,
            slackConnection: {
              select: {
                slackTeamName: true
              }
            }
          }
        }
      },
      orderBy: [
        { confidence: 'desc' },
        { createdAt: 'desc' }
      ],
      take: parseInt(limit),
      skip: parseInt(offset)
    });
    console.timeEnd('tasks-query');

    console.time('tasks-count');
    const total = await prisma.automationTask.count({
      where: whereClause
    });
    console.timeEnd('tasks-count');

    logPerformance(req, 'Fetching analysis results', startTime);
    res.json({
      tasks,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error(`[ERROR] Get results error: ${error.message}`);
    res.status(500).json({ error: 'Failed to retrieve results' });
  }
});

// Update task status (admin only)
router.patch('/tasks/:taskId/status', authenticateToken, requireAdmin, async (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  
  if (!taskId || !status) {
    return res.status(400).json({ error: 'taskId and status are required' });
  }
  
  // Validate status
  const validStatuses = ['pending', 'approved', 'rejected', 'implemented'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }
  
  try {
    // Update the task status
    const updatedTask = await prisma.automationTask.update({
      where: { id: taskId },
      data: { status }
    });
    
    res.json({ 
      success: true, 
      task: updatedTask 
    });
  } catch (error) {
    console.error(`[ERROR] Failed to update task status: ${error.message}`);
    
    if (error.code === 'P2025') {
      // Prisma error code for record not found
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.status(500).json({ error: 'Failed to update task status' });
  }
});

// Bulk delete automation tasks (admin only)
router.delete('/tasks', authenticateToken, requireAdmin, async (req, res) => {
  const { taskIds } = req.body;
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return res.status(400).json({ error: 'taskIds (array) required' });
  }
  try {
    const result = await prisma.automationTask.deleteMany({
      where: { id: { in: taskIds } }
    });
    res.json({ success: true, deletedCount: result.count });
  } catch (error) {
    console.error('Bulk delete automation tasks error:', error);
    res.status(500).json({ error: 'Failed to delete automation tasks' });
  }
});

// Delete a single automation task (admin only)
router.delete('/tasks/:taskId', authenticateToken, requireAdmin, async (req, res) => {
  const { taskId } = req.params;
  try {
    const task = await prisma.automationTask.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    await prisma.automationTask.delete({ where: { id: taskId } });
    res.json({ success: true, taskId });
  } catch (error) {
    console.error('Delete automation task error:', error);
    res.status(500).json({ error: 'Failed to delete automation task' });
  }
});

// Get analysis summary (admin only)
router.get('/summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    
    const dateFrom = new Date();
    if (period === '7d') dateFrom.setDate(dateFrom.getDate() - 7);
    else if (period === '30d') dateFrom.setDate(dateFrom.getDate() - 30);
    else if (period === '90d') dateFrom.setDate(dateFrom.getDate() - 90);

    const summary = await prisma.automationTask.groupBy({
      by: ['difficulty', 'estimatedRoi', 'status'],
      where: {
        createdAt: {
          gte: dateFrom
        }
      },
      _count: { id: true },
      _avg: { confidence: true }
    });

    const topTasks = await prisma.automationTask.findMany({
      where: {
        createdAt: {
          gte: dateFrom
        }
      },
      orderBy: [
        { confidence: 'desc' },
        { estimatedRoi: 'desc' }
      ],
      take: 10,
      include: {
        slackConversation: {
          select: {
            channelName: true,
            slackConnection: {
              select: {
                slackTeamName: true
              }
            }
          }
        }
      }
    });

    res.json({
      summary,
      topTasks,
      period
    });
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({ error: 'Failed to retrieve summary' });
  }
});

// Get enhanced dashboard statistics
router.get('/dashboard-stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.userRole === 'admin' ? null : req.userId;
    
    // Get total messages across all connections
    const totalMessages = await prisma.slackConversation.count({
      where: userId ? {
        slackConnection: {
          userId: userId
        }
      } : {}
    });

    // Get active scraping jobs
    const activeJobs = await prisma.slackScrapingJob.findMany({
      where: {
        status: 'running',
        ...(userId ? {
          slackConnection: {
            userId: userId
          }
        } : {})
      },
      include: {
        slackConnection: {
          select: {
            slackTeamName: true
          }
        }
      }
    });

    // Get recent completed jobs
    const recentCompletedJobs = await prisma.slackScrapingJob.findMany({
      where: {
        status: 'completed',
        completedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        },
        ...(userId ? {
          slackConnection: {
            userId: userId
          }
        } : {})
      },
      include: {
        slackConnection: {
          select: {
            slackTeamName: true
          }
        }
      },
      orderBy: {
        completedAt: 'desc'
      },
      take: 10
    });

    // Get channel selections summary
    const channelSelections = await prisma.slackChannelSelection.findMany({
      where: {
        isActive: true,
        ...(userId ? {
          userId: userId
        } : {})
      },
      include: {
        slackConnection: {
          select: {
            slackTeamName: true
          }
        }
      }
    });

    // Calculate progress by connection
    const connectionProgress = await prisma.slackConnection.findMany({
      where: {
        isActive: true,
        ...(userId ? {
          userId: userId
        } : {})
      },
      select: {
        id: true,
        slackTeamName: true,
        channelSelections: {
          where: {
            isActive: true
          },
          select: {
            channelId: true,
            channelType: true,
            totalMessages: true,
            lastFetchedAt: true
          }
        },
        conversations: {
          select: {
            id: true,
            messageType: true,
            createdAt: true
          }
        },
        scrapingJobs: {
          where: {
            status: 'running'
          },
          select: {
            id: true,
            progress: true,
            messagesScraped: true
          }
        }
      }
    });

    // Get messages per day for the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const messagesByDay = await prisma.slackConversation.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: {
          gte: sevenDaysAgo
        },
        ...(userId ? {
          slackConnection: {
            userId: userId
          }
        } : {})
      },
      _count: {
        id: true
      }
    });

    // Format daily stats
    const dailyStats = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateString = date.toISOString().split('T')[0];
      
      const messagesOnDate = messagesByDay
        .filter(msg => msg.createdAt.toISOString().split('T')[0] === dateString)
        .reduce((sum, msg) => sum + msg._count.id, 0);
      
      dailyStats.push({
        date: dateString,
        messages: messagesOnDate
      });
    }

    res.json({
      stats: {
        totalMessages,
        totalActiveJobs: activeJobs.length,
        totalCompletedJobs: recentCompletedJobs.length,
        totalChannelSelections: channelSelections.length,
        messagesLast24h: messagesByDay.reduce((sum, msg) => sum + msg._count.id, 0)
      },
      activeJobs,
      recentCompletedJobs,
      connectionProgress,
      dailyStats,
      channelSelections
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve dashboard stats' });
  }
});

// GET org chart assignments (department assignments for a connection)
router.get('/orgchart', authenticateToken, requireAdmin, async (req, res) => {
  let { slackTeamId, connectionId } = req.query;
  
  if (!slackTeamId && !connectionId) {
    return res.status(400).json({ error: 'slackTeamId or connectionId required' });
  }
  
  // If we have a slackTeamId but no connectionId, find an active connection for this team
  if (slackTeamId && !connectionId) {
    const connection = await prisma.slackConnection.findFirst({
      where: { slackTeamId, isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    
    if (connection) {
      connectionId = connection.id;
    } else {
      return res.status(404).json({ error: 'No active connection found for this team' });
    }
  } 
  // If we have connectionId but no slackTeamId, look up the slackTeamId
  else if (connectionId && !slackTeamId) {
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    slackTeamId = connection.slackTeamId;
  }
  
  const assignments = {};
  const managerAssignments = {};
  const dbAssignments = await prisma.departmentAssignment.findMany({ where: { connectionId } });
  
  dbAssignments.forEach(a => {
    assignments[a.userId] = a.department;
    managerAssignments[a.userId] = a.managerId || null;
  });
  
  res.json({ assignments, managerAssignments });
});

// POST org chart assignments (replace all assignments for a connection)
router.post('/orgchart', authenticateToken, requireAdmin, async (req, res) => {
  let { slackTeamId, connectionId, assignments, managerAssignments } = req.body;
  
  // Handle the case where slackTeamId is provided but connectionId is not
  if (slackTeamId && !connectionId) {
    const connection = await prisma.slackConnection.findFirst({
      where: { slackTeamId, isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    
    if (connection) {
      connectionId = connection.id;
    } else {
      return res.status(404).json({ error: 'No active connection found for this team' });
    }
  } 
  // Handle the case where connectionId is provided but slackTeamId is not
  else if (connectionId && !slackTeamId) {
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    slackTeamId = connection.slackTeamId;
  }
  
  if (!connectionId || !assignments) {
    return res.status(400).json({ error: 'connectionId/slackTeamId and assignments required' });
  }
  
  // Remove all existing assignments for this connection
  await prisma.departmentAssignment.deleteMany({ where: { connectionId } });
  
  // Add new assignments
  const data = Object.entries(assignments).map(([userId, department]) => ({
    userId,
    department,
    connectionId,
    managerId: managerAssignments && managerAssignments[userId] ? managerAssignments[userId] : null
  }));
  
  if (data.length > 0) {
    await prisma.departmentAssignment.createMany({ data });
  }
  
  res.json({ success: true });
});

// Get all available roles
router.get('/roles', authenticateToken, requireAdmin, async (req, res) => {
  let { slackTeamId, connectionId } = req.query;
  if (!slackTeamId && connectionId) {
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) return res.status(404).json({ error: 'Slack connection not found' });
    slackTeamId = connection.slackTeamId;
  }
  if (!slackTeamId) return res.status(400).json({ error: 'slackTeamId or connectionId required' });
  // Return only roles assigned in this workspace (via DepartmentRole)
  const roles = await prisma.role.findMany({
    where: {
      departmentRoles: {
        some: { slackTeamId }
      }
    },
    orderBy: { name: 'asc' }
  });
  res.json({ roles: roles.map(r => ({ name: r.name, description: r.description })) });
});

// Add a new role
router.post('/roles', authenticateToken, requireAdmin, async (req, res) => {
  let { role, description, slackTeamId, connectionId, oldRole } = req.body;
  if (!slackTeamId && connectionId) {
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) return res.status(404).json({ error: 'Slack connection not found' });
    slackTeamId = connection.slackTeamId;
  }
  if (!role) return res.status(400).json({ error: 'role required' });
  if (!slackTeamId) return res.status(400).json({ error: 'slackTeamId or connectionId required' });

  // If oldRole is provided and different, update the existing role
  if (oldRole && oldRole !== role) {
    // Check if the old role exists
    const existingRole = await prisma.role.findUnique({ where: { name: oldRole } });
    if (!existingRole) return res.status(404).json({ error: 'Old role not found' });
    // Check if the new role name already exists
    const newRoleExists = await prisma.role.findUnique({ where: { name: role } });
    if (newRoleExists) return res.status(400).json({ error: 'Role name already exists' });
    // Update the role name and description
    await prisma.role.update({
      where: { name: oldRole },
      data: { name: role, description: description || '' }
    });
    // Update DepartmentRole assignments to use the new roleId
    const updatedRole = await prisma.role.findUnique({ where: { name: role } });
    await prisma.departmentRole.updateMany({
      where: { roleId: existingRole.id },
      data: { roleId: updatedRole.id }
    });
  } else {
    // Create or update the role as before
    await prisma.role.upsert({
      where: { name: role },
      update: { description: description || '' },
      create: { name: role, description: description || '' }
    });
  }

  // Ensure a DepartmentRole exists for this role and slackTeamId
  const upsertedRole = await prisma.role.findUnique({ where: { name: role } });
  const existingDepartmentRole = await prisma.departmentRole.findFirst({
    where: { roleId: upsertedRole.id, slackTeamId }
  });
  if (!existingDepartmentRole) {
    await prisma.departmentRole.create({
      data: {
        userId: '', // No user assigned at creation
        department: '', // No department assigned at creation
        roleId: upsertedRole.id,
        slackTeamId
      }
    });
  }
  // Return all roles for this workspace
  const roles = await prisma.role.findMany({
    where: {
      departmentRoles: {
        some: { slackTeamId }
      }
    },
    orderBy: { name: 'asc' }
  });
  res.json({ roles: roles.map(r => ({ name: r.name, description: r.description })) });
});

// Delete a role
router.delete('/roles', authenticateToken, requireAdmin, async (req, res) => {
  let { role, slackTeamId, connectionId } = req.body;
  if (!slackTeamId && connectionId) {
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) return res.status(404).json({ error: 'Slack connection not found' });
    slackTeamId = connection.slackTeamId;
  }
  if (!role) return res.status(400).json({ error: 'role required' });
  if (!slackTeamId) return res.status(400).json({ error: 'slackTeamId or connectionId required' });
  // Remove all DepartmentRole assignments for this role in this workspace
  await prisma.departmentRole.deleteMany({ where: { role: { name: role }, slackTeamId } });
  // Optionally, you could also delete the role if it is not used anywhere else
  // For now, just return all roles for this workspace
  const roles = await prisma.role.findMany({
    where: {
      departmentRoles: {
        some: { slackTeamId }
      }
    },
    orderBy: { name: 'asc' }
  });
  res.json({ roles: roles.map(r => ({ name: r.name, description: r.description })) });
});

// Get people and role assignments for a department
router.get('/department-people', authenticateToken, requireAdmin, async (req, res) => {
  let { department, slackTeamId, connectionId } = req.query;
  if (!slackTeamId && connectionId) {
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) return res.status(404).json({ error: 'Slack connection not found' });
    slackTeamId = connection.slackTeamId;
  }
  if (!department || !slackTeamId) return res.status(400).json({ error: 'department and slackTeamId (or connectionId) required' });
  // Find all people assigned to this department in this workspace
  const assignments = await prisma.departmentAssignment.findMany({ where: { department, connectionId } });
  const userIds = assignments.map(a => a.userId);
  // Fetch Slack user directory for real names
  const connection = await prisma.slackConnection.findFirst({ where: { slackTeamId } });
  let usersMap = new Map();
  if (connection && connection.userToken && connection.slackTeamId) {
    try {
      usersMap = await getUsersMap(connection.userToken, connection.slackTeamId);
    } catch (err) {
      console.error('Failed to fetch Slack users for real names:', err.message);
    }
  }
  // Build people array from usersMap for all assigned userIds
  const people = userIds.map(id => {
    const slackUser = usersMap.get(id);
    return {
      id,
      name: slackUser
        ? slackUser.display_name || slackUser.real_name || slackUser.name || id
        : id,
      email: slackUser?.profile?.email,
      isActive: slackUser ? !slackUser.deleted : true,
    };
  });
  // Get role assignments
  const roleAssignments = await prisma.departmentRole.findMany({
    where: { department, slackTeamId },
    include: { role: true }
  });
  const roleMap = {};
  roleAssignments.forEach(r => { roleMap[r.userId] = r.role?.name || ''; });
  // Get manager assignments
  const managerAssignmentsRaw = await prisma.departmentAssignment.findMany({ where: { department, connectionId } });
  const managerAssignments = {};
  managerAssignmentsRaw.forEach(a => { managerAssignments[a.userId] = a.managerId || ''; });
  // Get all roles for this workspace
  const allRoles = await prisma.role.findMany({
    where: {
      departmentRoles: {
        some: { slackTeamId }
      }
    },
    orderBy: { name: 'asc' }
  });
  res.json({ people, assignments: roleMap, managerAssignments, roles: allRoles.map(r => ({ name: r.name, description: r.description })) });
});

// Set role assignments for a department
router.post('/department-roles', authenticateToken, requireAdmin, async (req, res) => {
  let { department, assignments, managerAssignments, slackTeamId, connectionId } = req.body;
  if (!slackTeamId && connectionId) {
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) return res.status(404).json({ error: 'Slack connection not found' });
    slackTeamId = connection.slackTeamId;
  }
  if (!department || !assignments || !slackTeamId) return res.status(400).json({ error: 'department, assignments, and slackTeamId (or connectionId) required' });
  // Remove all existing roles for this department/workspace
  await prisma.departmentRole.deleteMany({ where: { department, slackTeamId } });
  // Add new assignments
  const roleRecords = [];
  for (const [userId, roleName] of Object.entries(assignments)) {
    if (!roleName) continue;
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (role) {
      roleRecords.push({ userId, department, roleId: role.id, slackTeamId });
    }
  }
  if (roleRecords.length > 0) await prisma.departmentRole.createMany({ data: roleRecords });
  // Update manager assignments
  if (managerAssignments && typeof managerAssignments === 'object') {
    for (const [userId, managerId] of Object.entries(managerAssignments)) {
      await prisma.departmentAssignment.updateMany({
        where: { userId, department, connectionId },
        data: { managerId: managerId || null }
      });
    }
  }
  res.json({ success: true });
});

// Department management endpoints
router.get('/departments', authenticateToken, requireAdmin, async (req, res) => {
  let { slackTeamId, connectionId } = req.query;
  if (!slackTeamId && connectionId) {
    // Look up the slackTeamId by connectionId
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) return res.status(404).json({ error: 'Slack connection not found' });
    slackTeamId = connection.slackTeamId;
  }
  if (!slackTeamId) return res.status(400).json({ error: 'slackTeamId or connectionId required' });
  try {
    const departments = await prisma.department.findMany({ where: { slackTeamId }, orderBy: { name: 'asc' } });
    res.json({ departments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// Get department managers endpoint
router.get('/department-managers', authenticateToken, requireAdmin, async (req, res) => {
  let { slackTeamId, connectionId } = req.query;
  if (!slackTeamId && connectionId) {
    // Look up the slackTeamId by connectionId
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) return res.status(404).json({ error: 'Slack connection not found' });
    slackTeamId = connection.slackTeamId;
    connectionId = connection.id; // Ensure we have the correct connectionId
  } else if (slackTeamId && !connectionId) {
    // Look up a valid connection for this team to use for manager assignments
    const connection = await prisma.slackConnection.findFirst({ 
      where: { slackTeamId, isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    if (connection) {
      connectionId = connection.id;
    }
  }
  
  if (!slackTeamId) return res.status(400).json({ error: 'slackTeamId or connectionId required' });
  
  try {
    // Get all departments for this team
    const departments = await prisma.department.findMany({ 
      where: { slackTeamId },
      select: { id: true }
    });
    
    const departmentIds = departments.map(d => d.id);
    
    // Get all department assignments with managers for these departments
    const assignments = await prisma.departmentAssignment.findMany({
      where: { 
        department: { in: departmentIds },
        connectionId,
        managerId: { not: null }
      }
    });
    
    // Format as { departmentId: managerId } map
    const managers = {};
    assignments.forEach(assignment => {
      managers[assignment.department] = assignment.managerId;
    });
    
    res.json({ managers });
  } catch (error) {
    console.error('Failed to fetch department managers:', error);
    res.status(500).json({ error: 'Failed to fetch department managers' });
  }
});

// Update department managers
router.post('/department-managers', authenticateToken, requireAdmin, async (req, res) => {
  let { slackTeamId, connectionId, managers } = req.body;
  
  if (!slackTeamId && connectionId) {
    // Look up the slackTeamId by connectionId
    const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
    if (!connection) return res.status(404).json({ error: 'Slack connection not found' });
    slackTeamId = connection.slackTeamId;
    connectionId = connection.id; // Ensure we have the correct connectionId
  } else if (slackTeamId && !connectionId) {
    // Look up a valid connection for this team to use for manager assignments
    const connection = await prisma.slackConnection.findFirst({ 
      where: { slackTeamId, isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    if (connection) {
      connectionId = connection.id;
    } else {
      return res.status(404).json({ error: 'No active connection found for this team' });
    }
  }
  
  if (!managers || typeof managers !== 'object') {
    return res.status(400).json({ error: 'managers object required' });
  }
  
  if (!slackTeamId) return res.status(400).json({ error: 'slackTeamId or connectionId required' });
  
  try {
    // Update each department's manager
    for (const [departmentId, managerId] of Object.entries(managers)) {
      // Check if department exists and belongs to this team
      const department = await prisma.department.findFirst({
        where: { id: departmentId, slackTeamId }
      });
      
      if (!department) {
        console.error(`Department ${departmentId} not found or not part of team ${slackTeamId}`);
        continue;
      }
      
      // Check if there's an existing assignment for this department
      const existing = await prisma.departmentAssignment.findFirst({
        where: { department: departmentId, connectionId }
      });
      
      if (existing) {
        // Update existing assignment
        await prisma.departmentAssignment.update({
          where: { id: existing.id },
          data: { managerId: managerId || null }
        });
      } else if (managerId) {
        // Create new assignment only if there's a manager to assign
        await prisma.departmentAssignment.create({
          data: {
            department: departmentId,
            connectionId,
            userId: managerId, // Required field
            managerId
          }
        });
      }
    }
    
    // Get updated managers to return
    const updatedAssignments = await prisma.departmentAssignment.findMany({
      where: { 
        department: { in: Object.keys(managers) },
        connectionId,
        managerId: { not: null }
      }
    });
    
    // Format as { departmentId: managerId } map
    const updatedManagers = {};
    updatedAssignments.forEach(assignment => {
      updatedManagers[assignment.department] = assignment.managerId;
    });
    
    res.json({ success: true, managers: updatedManagers });
  } catch (error) {
    console.error('Failed to update department managers:', error);
    res.status(500).json({ error: 'Failed to update department managers' });
  }
});

router.post('/departments', authenticateToken, requireAdmin, async (req, res) => {
  const { id, name, description, slackTeamId } = req.body;
  if (!name) return res.status(400).json({ error: 'Department name required' });
  if (!slackTeamId) return res.status(400).json({ error: 'slackTeamId required' });
  try {
    let department;
    if (id) {
      department = await prisma.department.update({
        where: { id },
        data: { name, description, slackTeamId }
      });
    } else {
      department = await prisma.department.create({
        data: { name, description, slackTeamId }
      });
    }
    const departments = await prisma.department.findMany({ where: { slackTeamId }, orderBy: { name: 'asc' } });
    res.json({ departments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save department' });
  }
});

router.delete('/departments', authenticateToken, requireAdmin, async (req, res) => {
  const { id, slackTeamId } = req.body;
  if (!id) return res.status(400).json({ error: 'Department id required' });
  if (!slackTeamId) return res.status(400).json({ error: 'slackTeamId required' });
  try {
    await prisma.department.delete({ where: { id } });
    const departments = await prisma.department.findMany({ where: { slackTeamId }, orderBy: { name: 'asc' } });
    res.json({ departments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

// Department-based automation analysis (intra- and inter-department)
router.post('/department-analysis', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { connectionId, departmentIds } = req.body;
    
    // Validate request
    if (!connectionId) {
      return res.status(400).json({ error: 'connectionId is required' });
    }
    
    if (!departmentIds || !Array.isArray(departmentIds) || departmentIds.length < 2) {
      return res.status(400).json({ error: 'At least 2 departmentIds are required for inter-department analysis' });
    }
    
    console.log(`[INTER-DEPT] Starting analysis for ${departmentIds.length} departments: ${departmentIds.join(', ')}`);
    
    // Get department names for better logging
    const departments = await prisma.department.findMany({
      where: { id: { in: departmentIds } },
      select: { id: true, name: true }
    });
    
    const departmentNames = departments.map(d => d.name).join(', ');
    console.log(`[INTER-DEPT] Analyzing departments: ${departmentNames}`);
    
    // Forward the request to the analysis-runner service with timeout
    const runnerUrl = process.env.ANALYSIS_RUNNER_URL || 'http://localhost:3003/trigger/analysis';
    const payload = {
      ...req.body,
      timeout: 180000 // 3 minute timeout
    };
    
    console.log(`[INTER-DEPT] Forwarding to ${runnerUrl} with payload:`, JSON.stringify(payload));
    
    const response = await axios.post(runnerUrl, payload, {
      timeout: 240000 // 4 minutes
    });
    
    // Check if the response contains the expected data structure
    if (response.data && response.data.success) {
      console.log(`[INTER-DEPT] Analysis completed successfully for departments: ${departmentNames}`);
      res.json(response.data);
    } else {
      // If response doesn't have expected structure, return a more helpful error
      console.log(`[INTER-DEPT] Analysis runner response:`, response.data);
      res.json({
        success: true,
        message: 'Analysis request submitted successfully',
        status: 'completed',
        results: response.data
      });
    }
  } catch (error) {
    console.error('[ERROR] Department analysis runner proxy error:', error.message);
    if (error.code === 'ECONNABORTED') {
      // Handle timeout specifically
      res.status(504).json({ 
        error: 'Analysis timed out, but may still be processing in the background',
        status: 'timeout'
      });
    } else if (error.response) {
      console.error('[ERROR] Error details:', error.response.data);
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ 
        error: 'Failed to run department analysis',
        details: error.message
      });
    }
  }
});

// Intra-department automation analysis
router.post('/intra-department-analysis', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { connectionId, departmentId } = req.body;
    if (!departmentId) {
      return res.status(400).json({ error: 'departmentId required' });
    }
    
    // Get the department to find its slackTeamId
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { slackTeamId: true, name: true }
    });
    
    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }
    
    console.log(`[DEBUG] Running intra-department analysis for department: ${department.name} (${departmentId})`);
    
    // Use connectionId if provided, otherwise find a connection for this slackTeamId
    let connId = connectionId;
    if (!connId) {
      const connection = await prisma.slackConnection.findFirst({
        where: { slackTeamId: department.slackTeamId, isActive: true },
        orderBy: { createdAt: 'desc' }
      });
      if (!connection) {
        return res.status(404).json({ error: 'No active connection found for this department' });
      }
      connId = connection.id;
    }
    
    // Forward to analysis-runner with departmentIds: [departmentId]
    const runnerUrl = process.env.ANALYSIS_RUNNER_URL || 'http://localhost:3003/trigger/analysis';
    const payload = { 
      connectionId: connId, 
      departmentIds: [departmentId],
      timeout: 120000 // 2 minute timeout to prevent client disconnection issues
    };
    
    console.log(`[DEBUG] Forwarding to analysis-runner: ${JSON.stringify(payload)}`);
    
    // Set a longer timeout for the request to prevent client disconnection
    const response = await axios.post(runnerUrl, payload, {
      timeout: 180000 // 3 minutes
    });
    
    // Check if the response contains the expected data structure
    if (response.data && response.data.success) {
      console.log(`[DEBUG] Analysis completed successfully for department: ${department.name}`);
      res.json(response.data);
    } else {
      // If response doesn't have expected structure, return a more helpful error
      console.error(`[ERROR] Unexpected response from analysis-runner:`, response.data);
      res.json({
        success: true,
        message: 'Analysis request submitted successfully',
        status: 'completed',
        results: response.data
      });
    }
  } catch (error) {
    console.error(`[ERROR] Intra-department analysis runner proxy error: ${error.message}`);
    if (error.code === 'ECONNABORTED') {
      // Handle timeout specifically
      res.status(504).json({ 
        error: 'Analysis timed out, but may still be processing in the background',
        status: 'timeout'
      });
    } else if (error.response) {
      console.error(`[ERROR] Analysis runner response error:`, error.response.data);
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ 
        error: 'Failed to run intra-department analysis',
        details: error.message
      });
    }
  }
});

// Get all automation tasks with filtering
router.get('/automations', authenticateToken, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  const { status, slackTeamId, sortBy = 'date', search, limit = 100 } = req.query;
  
  try {
    console.log(`[DEBUG] Fetching automation tasks with filters: status=${status}, team=${slackTeamId}, sortBy=${sortBy}`);
    
    // Build where clause based on filters
    const whereClause = {};
    
    if (status && status !== 'all') {
      whereClause.status = status;
    }
    
    if (slackTeamId) {
      whereClause.slackConversation = {
        slackConnection: {
          slackTeamId
        }
      };
    }
    
    // Build order by based on sortBy parameter
    let orderBy = {};
    switch (sortBy) {
      case 'confidence':
        orderBy = { confidence: 'desc' };
        break;
      case 'priority':
        orderBy = { priorityScore: 'desc' };
        break;
      case 'timeSaved':
        orderBy = { estimatedTimeSaved: 'desc' };
        break;
      case 'date':
      default:
        orderBy = { createdAt: 'desc' };
    }
    
    // First check if we have any automation tasks at all
    const totalCount = await prisma.automationTask.count();
    console.log(`[DEBUG] Total automation tasks in database: ${totalCount}`);
    
    // Fetch tasks with pagination
    const tasks = await prisma.automationTask.findMany({
      where: whereClause,
      orderBy,
      take: parseInt(limit, 10),
      include: {
        slackConversation: {
          select: {
            channelName: true,
            slackConnection: {
              select: {
                slackTeamName: true
              }
            }
          }
        }
      }
    });
    
    console.log(`[DEBUG] Found ${tasks.length} tasks matching the filters`);
    
    // If search is provided, filter in memory (as full-text search might not be available)
    let filteredTasks = tasks;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredTasks = tasks.filter(task => {
        return (
          (task.title || '').toLowerCase().includes(searchLower) ||
          (task.taskName || '').toLowerCase().includes(searchLower) ||
          (task.taskDescription || '').toLowerCase().includes(searchLower) ||
          (task.suggestedAutomationApproach || '').toLowerCase().includes(searchLower)
        );
      });
      console.log(`[DEBUG] After search filter, found ${filteredTasks.length} tasks`);
    }
    
    // Get counts by status for statistics
    const statusCounts = {
      pending: filteredTasks.filter(t => t.status === 'pending').length,
      approved: filteredTasks.filter(t => t.status === 'approved').length,
      rejected: filteredTasks.filter(t => t.status === 'rejected').length,
      implemented: filteredTasks.filter(t => t.status === 'implemented').length,
      total: filteredTasks.length
    };
    
    console.log(`[DEBUG] Status counts: ${JSON.stringify(statusCounts)}`);
    
    logPerformance(req, 'Fetching automation tasks', startTime);
    res.json({ 
      tasks: filteredTasks,
      statusCounts,
      totalCount: filteredTasks.length
    });
  } catch (error) {
    console.error(`[ERROR] Failed to fetch automation tasks: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({ error: 'Failed to fetch automation tasks' });
  }
});

module.exports = router; 