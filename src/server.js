const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const connectDB = require('./config/db');
const { validateSecurityConfig } = require('./config/security');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

// Import routes
const authRoutes = require('./routes/authRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const limitRoutes = require('./routes/limitRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');

// Validate critical environment variables early
if (!process.env.JWT_SECRET) {
  console.error('❌ Configuration Error: JWT_SECRET is not defined in environment variables.');
  process.exit(1);
}

try {
  validateSecurityConfig();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

// Connect to MongoDB
connectDB();

const app = express();

// Enable trust proxy for reverse proxies (Render, Railway, Heroku, AWS, etc.)
// Required for express-rate-limit to correctly resolve client IP
app.set('trust proxy', 1);

// Security Middlewares
app.use(
  helmet({
    contentSecurityPolicy: false, // JSON API backend
    crossOriginEmbedderPolicy: false,
  })
);

// Normalize allowed origins (strip trailing slashes, parse comma-separated CLIENT_URL)
const clientOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((url) => url.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const allowedOrigins = Array.from(new Set([...clientOrigins, ...defaultOrigins]));

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      const cleanOrigin = origin.replace(/\/+$/, '');
      const isAllowed = allowedOrigins.includes(cleanOrigin);

      if (isAllowed || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error(`Blocked by CORS: origin ${origin} is not allowed.`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body Parsers & Cookie Parser
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

// Request logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Credit Card Expense Tracker API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    security: {
      fieldEncryption: 'AES-256-GCM',
      auth: 'JWT & bcrypt-12',
    },
  });
});

// Rate limiting for general API routes
app.use('/api', apiLimiter);

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/limits', limitRoutes);
app.use('/api/analytics', analyticsRoutes);

// 404 Route Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Resource not found at ${req.originalUrl}`,
  });
});

// Centralized error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`🚀 Expense Tracker Backend Server running on port ${PORT}`);
    console.log(`🔒 AES-256-GCM field encryption active`);
    console.log(`🌐 Allowed CORS origins: ${allowedOrigins.join(', ')}`);
  });

  const handleShutdown = (signal) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    if (server) {
      server.close(async () => {
        console.log('HTTP server closed.');
        try {
          const mongoose = require('mongoose');
          await mongoose.connection.close(false);
          console.log('MongoDB connection closed.');
        } catch (err) {
          console.error('Error closing MongoDB connection:', err);
        }
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

module.exports = app;
