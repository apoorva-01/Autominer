const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for ngrok/reverse proxy setups
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting - more flexible approach
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // increased from 500 to 1000 requests per windowMs
  skip: (req) => {
    // Skip rate limiting for auth endpoints
    return req.path.startsWith('/api/auth/');
  }
});
app.use(globalLimiter);

// Separate, more lenient rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 auth attempts per 15 minutes should be sufficient
  message: { error: 'Too many authentication attempts, please try again later' }
});

// Admin endpoints rate limiter
const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 300, // 300 requests per 5 minutes
  message: { error: 'Too many admin API requests, please try again later' }
});

// Analysis endpoints rate limiter
const analysisLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 300, // 300 requests per 5 minutes
  message: { error: 'Too many analysis API requests, please try again later' }
});

// Slack endpoints rate limiter
const slackLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 300, // 300 requests per 5 minutes
  message: { error: 'Too many Slack API requests, please try again later' }
});

// Logging
app.use(morgan('tiny'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Slack Automation Discovery API'
  });
});

// API routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/admin', adminLimiter, require('./routes/admin'));
app.use('/api/analysis', analysisLimiter, require('./routes/analysis'));
app.use('/api/slack', slackLimiter, require('./routes/slack'));
app.use('/api/reports', require('./routes/reports'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  // console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  // console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL}`);
  // console.log(`📋 Jobs are now handled by separate job runner service`);
}); 