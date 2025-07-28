const express = require('express');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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

// Middleware to verify admin role
const requireAdmin = (req, res, next) => {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Admin: Get all users and their connections
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
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
router.get('/connections', authenticateToken, requireAdmin, async (req, res) => {
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

// Admin: Get system stats
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
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

// Admin: Delete a user and all related data
router.delete('/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  try {
    // Delete all related data for the user
    // Delete all jobs for user's connections
    const connections = await prisma.slackConnection.findMany({ where: { userId } });
    const connectionIds = connections.map(c => c.id);
    if (connectionIds.length > 0) {
      await prisma.slackScrapingJob.deleteMany({ where: { slackConnectionId: { in: connectionIds } } });
      await prisma.slackChannelSelection.deleteMany({ where: { slackConnectionId: { in: connectionIds } } });
      await prisma.slackConversation.deleteMany({ where: { slackConnectionId: { in: connectionIds } } });
      // Add more related deletions if needed
    }
    // Delete Slack connections
    await prisma.slackConnection.deleteMany({ where: { userId } });
    // Delete the user
    await prisma.user.delete({ where: { id: userId } });
    res.json({ success: true, message: 'User and all related data deleted.' });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Admin: Update a user's name, role, email, and password
router.patch('/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { name, role, email, password } = req.body;
  if (!name && !role && !email && !password) {
    return res.status(400).json({ error: 'At least one of name, role, email, or password must be provided.' });
  }
  try {
    const data = {};
    if (name) data.name = name;
    if (role) data.role = role;
    if (email) data.email = email;
    if (password) {
      // DEBUG: Log the incoming password value (REMOVE after testing!)
      // console.log('[DEBUG] Incoming password value for user update:', password);
      const saltRounds = 10;
      data.password = await bcrypt.hash(password, saltRounds);
    }
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data
    });
    res.json({ user: updatedUser });
  } catch (error) {
    if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
      return res.status(400).json({ error: 'Email already in use.' });
    }
    console.error('Admin update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

module.exports = router; 