const express = require('express');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const OpenAI = require('openai');

const router = express.Router();
const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  const { connectionId } = req.query;
  if (!connectionId) return res.status(400).json({ error: 'connectionId required' });
  const channels = await prisma.slackConversation.findMany({
    where: { slackConnectionId: connectionId },
    select: { channelId: true, channelName: true },
    distinct: ['channelId', 'channelName'],
    orderBy: { channelName: 'asc' }
  });
  res.json({ channels });
});

// Get years for a channel in a workspace
router.get('/years', authenticateToken, requireAdmin, async (req, res) => {
  const { connectionId, channelId } = req.query;
  if (!connectionId || !channelId) return res.status(400).json({ error: 'connectionId and channelId required' });
  const messages = await prisma.slackConversation.findMany({
    where: { slackConnectionId: connectionId, channelId },
    select: { slackSentAt: true, createdAt: true }
  });

  const years = [
    ...new Set(
      messages
        .map(m => {
          const date = m.slackSentAt;
          // console.log('date', date);
          return date ? date.getFullYear() : null;
        })
        .filter(year => year !== null)
    )
  ].sort((a, b) => b - a);

  res.json({ years });
});

// Trigger analysis for user's conversations (admin only)
router.post('/run', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { connectionId, channelId, year, dateRange } = req.body;
    
    // Get connections (admin can analyze all connections)
    const connections = connectionId 
      ? [await prisma.slackConnection.findFirst({
          where: { id: connectionId }
        })]
      : await prisma.slackConnection.findMany({
          where: { isActive: true }
        });

    if (!connections.length) {
      return res.status(400).json({ error: 'No active connections found' });
    }

    const results = [];
    
    for (const connection of connections) {
      const analysisResult = await analyzeConnectionConversationsFiltered(connection, { channelId, year, dateRange });
      console.log('!!!!!!!!analysisResult', analysisResult);
      results.push({
        connectionId: connection.id,
        teamName: connection.slackTeamName,
        ...analysisResult
      });
    }

    res.json({ 
      message: 'Analysis completed',
      results,
      totalTasksFound: results.reduce((sum, r) => sum + r.tasksFound, 0)
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to run analysis' });
  }
});

// Get analysis results (admin only)
router.get('/results', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { connectionId, limit = 50, offset = 0 } = req.query;
    
    const whereClause = {};

    if (connectionId) {
      whereClause.slackConversation = {
        slackConnectionId: connectionId
      };
    }

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

    const total = await prisma.automationTask.count({
      where: whereClause
    });

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
    console.error('Get results error:', error);
    res.status(500).json({ error: 'Failed to retrieve results' });
  }
});

// Update task status (admin only)
router.patch('/tasks/:taskId/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'approved', 'rejected', 'implemented'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Verify task exists (admin can update any task)
    const task = await prisma.automationTask.findFirst({
      where: {
        id: taskId
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updatedTask = await prisma.automationTask.update({
      where: { id: taskId },
      data: { status }
    });

    res.json({ 
      message: 'Task status updated',
      task: updatedTask
    });
  } catch (error) {
    console.error('Update task status error:', error);
    res.status(500).json({ error: 'Failed to update task status' });
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


async function analyzeConnectionConversationsFiltered(connection, { channelId, year, dateRange }) {
  try {
    // Build where clause
    const where = { slackConnectionId: connection.id };
    if (channelId) where.channelId = channelId;
    if (year) {
      const start = new Date(`${year}-01-01T00:00:00Z`);
      const end = new Date(`${parseInt(year) + 1}-01-01T00:00:00Z`);
      where.slackSentAt = { gte: start, lt: end };
    } else if (dateRange?.from) {
      where.slackSentAt = { gte: new Date(dateRange.from) };
    }
    // Get conversations for analysis
    const conversations = await prisma.slackConversation.findMany({
      where,
      orderBy: { slackSentAt: 'desc' },
      take: 10 // Limit to avoid token limits
    });
    console.log('!!!!!!!!conversations.length', conversations.length);
    if (conversations.length === 0) {
      return { tasksFound: 0, message: 'No conversations found for analysis' };
    }
    // Prepare conversation data for AI analysis
    const conversationText = conversations.map(conv => ({
      channel: conv.channelName || 'DM',
      message: conv.messageText,
      participants: conv.participants,
      timestamp: conv.createdAt
    }));
    // Analyze with OpenAI
    const analysis = await analyzeWithOpenAI(conversationText);
    console.log('!!!!!!!!analysis', analysis);
    // Store results
    const tasks = await storeAnalysisResults(connection.id, conversations, analysis);
    return {
      tasksFound: tasks.length,
      message: `Found ${tasks.length} potential automation tasks`
    };
  } catch (error) {
    console.error('Connection analysis error:', error);
    return { tasksFound: 0, error: error.message };
  }
}

// OpenAI analysis function
async function analyzeWithOpenAI(conversations) {
  const prompt = `You are a senior automation engineer analyzing internal company conversations. 
  
Given these Slack conversations, identify recurring tasks that appear to be manual and repetitive.

For each task you identify, provide:
1. Task Description (clear, actionable description)
2. Frequency (daily/weekly/monthly based on conversation patterns)
3. Difficulty (low/medium/high - how hard to automate)
4. Estimated ROI (low/medium/high - potential time/cost savings)
5. Suggested Tools (specific automation tools like Zapier, Make, Pipedream, etc.)
6. Confidence (0-1 score for how confident you are this is worth automating)

Only identify tasks that:
- Appear multiple times in conversations
- Are clearly manual processes
- Could realistically be automated
- Would provide business value

Return your analysis as a JSON array of task objects.

Conversations:
${JSON.stringify(conversations, null, 2)}`;

  console.log('!!!!!!!!prompt', prompt);

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2000,
    temperature: 0.3
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Failed to parse OpenAI response:', error);
    return [];
  }
}

// Store analysis results
async function storeAnalysisResults(connectionId, conversations, analysis) {
  const tasks = [];
  
  for (const task of analysis) {
    try {
      if (
        typeof task['Task Description'] !== 'string' ||
        !task['Task Description'].trim()
      ) {
        // Skip tasks with missing or empty description
        continue;
      }
      // Find the most relevant conversation for this task
      const relevantConversation = conversations.find(conv => 
        typeof conv.messageText === 'string' &&
        typeof task['Task Description'] === 'string' &&
        task['Task Description'].trim() &&
        conv.messageText.toLowerCase().includes(
          task['Task Description'].toLowerCase().split(' ')[0]
        )
      ) || conversations[0];

      const createdTask = await prisma.automationTask.create({
        data: {
          slackConversationId: relevantConversation.id,
          taskDescription: task['Task Description'],
          frequency: task.Frequency,
          difficulty: task.Difficulty,
          estimatedRoi: task['Estimated ROI'],
          suggestedTools: Array.isArray(task['Suggested Tools'])
            ? task['Suggested Tools']
            : typeof task['Suggested Tools'] === 'string'
              ? task['Suggested Tools'].split(',').map(t => t.trim()).filter(Boolean)
              : [],
          confidence: task['Confidence'] || 0.5,
          status: 'pending'
        }
      });

      tasks.push(createdTask);
    } catch (error) {
      console.error('Failed to store task:', error);
    }
  }

  return tasks;
}

module.exports = router; 