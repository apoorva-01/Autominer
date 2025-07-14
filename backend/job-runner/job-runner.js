const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const { startDailyFetchJob } = require('./jobs/daily-fetch');
const { startHistoryExportProcessor, processPendingHistoryExportJobs } = require('./jobs/history-export-processor');
require('dotenv').config();

const prisma = new PrismaClient();
const PORT = process.env.JOB_RUNNER_PORT || 3002;

console.log('🚀 Starting Job Runner Service...');
console.log(`📊 Environment: ${process.env.NODE_ENV}`);
console.log(`🔗 Job Runner Port: ${PORT}`);

// Health check endpoint for the job runner
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Slack Automation Job Runner',
    jobs: {
      dailyFetch: 'running',
      historyExportProcessor: 'running'
    }
  });
});

// Add JSON body parsing
app.use(express.json());

// Endpoint to manually trigger history export processing
app.post('/trigger/history-export', async (req, res) => {
  try {
    console.log('🔄 Manually triggering history export processor...');
    // Process the pending jobs
    await processPendingHistoryExportJobs();
    res.json({ 
      success: true, 
      message: 'History export processor triggered successfully' 
    });
  } catch (error) {
    console.error('❌ Failed to trigger history export processor:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Start the health check server
app.listen(PORT, () => {
  console.log(`🏥 Job Runner health check available on port ${PORT}`);
});

// Initialize and start all jobs
async function initializeJobs() {
  try {
    console.log('🔧 Initializing job runner...');
    
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connection established');
    
    // Start daily fetch job
    console.log('📅 Starting daily fetch job scheduler...');
    startDailyFetchJob();
    
    // Start history export processor
    console.log('📅 Starting history export job processor...');
    startHistoryExportProcessor();
    
    console.log('✅ All jobs initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize jobs:', error);
    process.exit(1);
  }
}

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

// Start the job runner
initializeJobs(); 