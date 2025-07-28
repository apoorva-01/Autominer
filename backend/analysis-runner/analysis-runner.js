const { PrismaClient } = require('@prisma/client');
const express = require('express');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const timeout = require('connect-timeout');
require('dotenv').config();

const prisma = new PrismaClient();
const PORT = process.env.ANALYSIS_RUNNER_PORT || 3003;

// Performance settings
const REQUEST_TIMEOUT_MS = 300000; // 5-minute timeout for analysis operations
const DEFAULT_CACHE_TTL = 600; // 10 minutes cache TTL
const ANALYSIS_CACHE_TTL = 1800; // 30 minutes cache TTL for analysis results

// Initialize cache
const cache = new NodeCache({ 
  stdTTL: DEFAULT_CACHE_TTL,
  checkperiod: 120, // Check for expired keys every 2 minutes
  maxKeys: 1000 // Maximum cache size
});

console.log('🚀 Starting Analysis Runner Service...');
console.log(`📊 Environment: ${process.env.NODE_ENV}`);
console.log(`🔗 Analysis Runner Port: ${PORT}`);

const app = express();
app.use(express.json());

// Apply timeouts to long-running routes
const timeoutMiddleware = timeout(REQUEST_TIMEOUT_MS);
const haltOnTimedout = (req, res, next) => {
  if (!req.timedout) next();
};

// Rate limiting middleware
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.',
});

// Apply rate limiting to all routes
app.use(apiLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Slack Automation Analysis Runner',
    cacheStats: {
      keys: cache.keys().length,
      hits: cache.getStats().hits,
      misses: cache.getStats().misses,
    }
  });
});

const { analyzeConnectionConversationsFiltered } = require('./analysis-core');

// Helper function to generate cache key
function generateAnalysisCacheKey(params) {
  const { connectionId, channelIds, personId, model, departmentIds, dateFrom } = params;
  
  // Create a sorted, normalized representation of the query parameters
  const normalizedParams = {
    connectionId,
    channelIds: channelIds ? [...channelIds].sort().join(',') : '',
    personId: personId || '',
    model: model || 'gemini',
    departmentIds: departmentIds ? [...departmentIds].sort().join(',') : '',
    dateFrom: dateFrom ? dateFrom.toISOString().split('T')[0] : '',
  };
  
  return `analysis:${JSON.stringify(normalizedParams)}`;
}

// Manual trigger endpoint for analysis
app.post('/trigger/analysis', 
  timeoutMiddleware, 
  haltOnTimedout, 
  async (req, res) => {
    try {
      console.log('[DEBUG] Incoming /trigger/analysis payload:', req.body);
      const { connectionId, channelIds, personId, model, departmentIds } = req.body;
      
      if (!connectionId) {
        return res.status(400).json({ error: 'connectionId required' });
      }
      
      // Always use last 90 days by default, but allow overriding via request
      const daysToAnalyze = req.body.days || 90;
      const dateFrom = new Date(Date.now() - daysToAnalyze * 24 * 60 * 60 * 1000);
      
      // Check cache first
      const cacheKey = generateAnalysisCacheKey({ 
        connectionId, channelIds, personId, model, departmentIds, dateFrom 
      });
      
      const cachedResult = cache.get(cacheKey);
      if (cachedResult) {
        console.log(`[CACHE] Hit for ${cacheKey}`);
        return res.json({
          success: true,
          ...cachedResult,
          fromCache: true
        });
      }
      
      console.log(`[CACHE] Miss for ${cacheKey}`);
      
      // Find the connection
      const connection = await prisma.slackConnection.findFirst({ where: { id: connectionId } });
      if (!connection) {
        return res.status(404).json({ error: 'Slack connection not found' });
      }
      
      // Configure request cancellation on client disconnect
      let isCancelled = false;
      res.on('close', () => {
        isCancelled = true;
        console.log(`[INFO] Client closed connection for analysis ${cacheKey}`);
      });
      
      // Execute analysis with periodic checks for cancellation
      const result = await analyzeConnectionConversationsFiltered(connection, {
        channelIds,
        personId,
        departmentIds,
        dateRange: { from: dateFrom },
        model: model || 'gemini',
        checkCancelled: () => isCancelled
      });
      
      // If client has already disconnected, don't bother caching or responding
      if (isCancelled) {
        console.log(`[INFO] Analysis completed but client disconnected for ${cacheKey}`);
        return;
      }
      
      // Cache the result
      cache.set(cacheKey, result, ANALYSIS_CACHE_TTL);
      
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('❌ Failed to trigger analysis job:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
});

// Cache management endpoints (admin only)
app.post('/admin/cache/clear', async (req, res) => {
  try {
    // This should be properly protected with authentication
    const stats = cache.getStats();
    cache.flushAll();
    res.json({
      success: true,
      message: 'Cache cleared successfully',
      previousStats: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🏥 Analysis Runner health check available on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
}); 