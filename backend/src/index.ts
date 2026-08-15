// MUST be first: populates process.env before any service module is evaluated.
import './env';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import compareRouter from './routes/compare';
import screenshotsRouter from './routes/screenshots';
import integrationsRouter from './routes/integrations';

const app = express();
const PORT = process.env.PORT || 4000;

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Routes
app.use('/api/compare', compareRouter);
app.use('/api/screenshots', screenshotsRouter);
app.use('/api/integrations', integrationsRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    env: {
      gemini: !!process.env.GEMINI_API_KEY,
      jira: !!process.env.JIRA_API_TOKEN,
      github: !!process.env.GITHUB_TOKEN,
    },
  });
});

// Guarded so integration tests can `import app` (via supertest) without also
// binding a real port — mirrors the require.main pattern already used in
// playwright-service/src/capture.ts.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Visual Regression Backend running on http://localhost:${PORT}`);
    console.log(`📊 Gemini AI: ${process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Missing GEMINI_API_KEY'}`);
    console.log(`🔗 Jira:      ${process.env.JIRA_API_TOKEN ? '✅ Configured' : '⚠️  Not configured'}`);
    console.log(`🐙 GitHub:    ${process.env.GITHUB_TOKEN ? '✅ Configured' : '⚠️  Not configured'}`);
  });
}

export default app;
