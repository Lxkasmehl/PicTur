// Load environment variables FIRST, before any other imports
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from auth-backend directory
// __dirname is auth-backend/src, so we go up one level to auth-backend
const envPath = path.join(__dirname, '../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  // In Docker, variables come from Compose; there is no file at /app/.env unless mounted.
  if (process.env.JWT_SECRET && process.env.JWT_SECRET !== 'your-secret-key-change-in-production') {
    console.log(
      'ℹ️  No .env file in container (using process environment). OK for Docker Compose.\n'
    );
  } else {
    console.log('⚠️  .env file not found or error loading it:', result.error.message);
    console.log('   Looking for .env at:', envPath);
    console.log('   Make sure the .env file exists in the auth-backend folder\n');
  }
} else {
  console.log('✅ .env file loaded successfully\n');
}

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import authRoutes from './routes/auth.js';
import googleAuthRoutes from './routes/googleAuth.js';
import adminRoutes from './routes/admin.js';
import communityGameRoutes from './routes/communityGame.js';
import passport from './config/passport.js';
// Import email service to initialize SMTP configuration check
import './services/email.js';

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Allow both localhost and 127.0.0.1 so CORS works regardless of how the user opens the app
const allowedOrigins = [
  FRONTEND_URL,
  FRONTEND_URL.replace(/localhost/, '127.0.0.1'),
  FRONTEND_URL.replace(/127\.0\.0\.1/, 'localhost'),
].filter((v, i, a) => a.indexOf(v) === i);

// Health check - must be before CORS to allow Playwright to check readiness
// This endpoint is used by Playwright to verify the server is ready
app.get('/api/health', (req, res) => {
  res.status(200).setHeader('Content-Type', 'application/json');
  res.json({ status: 'ok', message: 'PicTur Auth Backend API is running' });
});

// Simple root endpoint for health checks (alternative)
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Middleware
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration for Passport
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth', communityGameRoutes);
app.use('/api/auth', googleAuthRoutes);
app.use('/api/admin', adminRoutes);

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Auth Server running on http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Ensure server is ready to accept connections
server.on('listening', () => {
  console.log(`✅ Server is listening and ready to accept connections`);
});
