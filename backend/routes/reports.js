const express = require('express');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const router = express.Router();
const prisma = new PrismaClient();

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

// Generate a new automation report (admin only)
router.post('/generate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, period = 'weekly', startDate, endDate } = req.body;
    
    const reportStartDate = startDate ? new Date(startDate) : getDefaultStartDate(period);
    const reportEndDate = endDate ? new Date(endDate) : new Date();

    // Get automation tasks for the period (from all users)
    const tasks = await prisma.automationTask.findMany({
      where: {
        createdAt: {
          gte: reportStartDate,
          lte: reportEndDate
        }
      },
      orderBy: [
        { confidence: 'desc' },
        { estimatedRoi: 'desc' }
      ],
      take: 50, // Limit to top 50 tasks
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

    if (tasks.length === 0) {
      return res.status(400).json({ error: 'No automation tasks found for the specified period' });
    }

    // Create the report
    const report = await prisma.automationReport.create({
      data: {
        userId: req.userId,
        title: title || `${period.charAt(0).toUpperCase() + period.slice(1)} Automation Report`,
        period,
        startDate: reportStartDate,
        endDate: reportEndDate
      }
    });

    // Add tasks to the report
    const reportTasks = await Promise.all(
      tasks.map((task, index) => 
        prisma.automationReportTask.create({
          data: {
            reportId: report.id,
            automationTaskId: task.id,
            rank: index + 1
          }
        })
      )
    );

    res.status(201).json({
      message: 'Report generated successfully',
      report: {
        ...report,
        taskCount: tasks.length
      }
    });
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Get all reports (admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const reports = await prisma.automationReport.findMany({
      include: {
        _count: {
          select: { tasks: true }
        },
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    const total = await prisma.automationReport.count();

    res.json({
      reports,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to retrieve reports' });
  }
});

// Get specific report with tasks (admin only)
router.get('/:reportId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await prisma.automationReport.findFirst({
      where: { id: reportId },
      include: {
        tasks: {
          include: {
            automationTask: {
              include: {
                slackConversation: {
                  select: {
                    channelName: true,
                    messageType: true,
                    slackConnection: {
                      select: {
                        slackTeamName: true
                      }
                    }
                  }
                }
              }
            }
          },
          orderBy: { rank: 'asc' }
        }
      }
    });

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Calculate summary statistics
    const summary = calculateReportSummary(report.tasks);

    res.json({
      report,
      summary
    });
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({ error: 'Failed to retrieve report' });
  }
});

// Delete a report (admin only)
router.delete('/:reportId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await prisma.automationReport.findFirst({
      where: { id: reportId }
    });

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    await prisma.automationReport.delete({
      where: { id: reportId }
    });

    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// Export report data (admin only)
router.get('/:reportId/export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { format = 'json' } = req.query;

    const report = await prisma.automationReport.findFirst({
      where: { id: reportId },
      include: {
        tasks: {
          include: {
            automationTask: {
              include: {
                slackConversation: {
                  select: {
                    channelName: true,
                    messageType: true,
                    slackConnection: {
                      select: {
                        slackTeamName: true
                      }
                    }
                  }
                }
              }
            }
          },
          orderBy: { rank: 'asc' }
        }
      }
    });

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (format === 'csv') {
      const csvData = generateCSVReport(report);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="automation-report-${report.id}.csv"`);
      res.send(csvData);
    } else {
      // JSON format
      res.json({
        report,
        exportedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

// Get report analytics (admin only)
router.get('/analytics/overview', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    
    const dateFrom = new Date();
    if (period === '7d') dateFrom.setDate(dateFrom.getDate() - 7);
    else if (period === '30d') dateFrom.setDate(dateFrom.getDate() - 30);
    else if (period === '90d') dateFrom.setDate(dateFrom.getDate() - 90);

    // Get report statistics (all data for admin)
    const totalReports = await prisma.automationReport.count({
      where: {
        createdAt: { gte: dateFrom }
      }
    });

    const tasksByDifficulty = await prisma.automationTask.groupBy({
      by: ['difficulty'],
      where: {
        createdAt: { gte: dateFrom }
      },
      _count: { id: true }
    });

    const tasksByRoi = await prisma.automationTask.groupBy({
      by: ['estimatedRoi'],
      where: {
        createdAt: { gte: dateFrom }
      },
      _count: { id: true }
    });

    const tasksByStatus = await prisma.automationTask.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: dateFrom }
      },
      _count: { id: true }
    });

    res.json({
      totalReports,
      tasksByDifficulty,
      tasksByRoi,
      tasksByStatus,
      period
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Failed to retrieve analytics' });
  }
});

// Helper functions
function getDefaultStartDate(period) {
  const date = new Date();
  switch (period) {
    case 'weekly':
      date.setDate(date.getDate() - 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() - 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() - 3);
      break;
    default:
      date.setDate(date.getDate() - 7);
  }
  return date;
}

function calculateReportSummary(tasks) {
  const summary = {
    totalTasks: tasks.length,
    byDifficulty: {},
    byRoi: {},
    byStatus: {},
    averageConfidence: 0
  };

  let totalConfidence = 0;

  tasks.forEach(task => {
    const automationTask = task.automationTask;
    
    // Count by difficulty
    summary.byDifficulty[automationTask.difficulty] = 
      (summary.byDifficulty[automationTask.difficulty] || 0) + 1;
    
    // Count by ROI
    summary.byRoi[automationTask.estimatedRoi] = 
      (summary.byRoi[automationTask.estimatedRoi] || 0) + 1;
    
    // Count by status
    summary.byStatus[automationTask.status] = 
      (summary.byStatus[automationTask.status] || 0) + 1;
    
    totalConfidence += automationTask.confidence;
  });

  summary.averageConfidence = tasks.length > 0 ? totalConfidence / tasks.length : 0;

  return summary;
}

function generateCSVReport(report) {
  const headers = [
    'Rank',
    'Task Description',
    'Frequency',
    'Difficulty',
    'Estimated ROI',
    'Suggested Tools',
    'Confidence',
    'Status',
    'Channel',
    'Team'
  ];

  const rows = report.tasks.map(task => [
    task.rank,
    `"${task.automationTask.taskDescription}"`,
    task.automationTask.frequency,
    task.automationTask.difficulty,
    task.automationTask.estimatedRoi,
    `"${task.automationTask.suggestedTools.join(', ')}"`,
    task.automationTask.confidence,
    task.automationTask.status,
    task.automationTask.slackConversation.channelName || 'DM',
    task.automationTask.slackConversation.slackConnection.slackTeamName
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

module.exports = router; 