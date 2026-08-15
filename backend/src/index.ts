// MUST be first: populates process.env before any service module is evaluated.
import './env';

import * as http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';

import compareRouter from './routes/compare';
import chatRouter from './routes/chat';
import screenshotsRouter from './routes/screenshots';
import integrationsRouter from './routes/integrations';
import { attachLiveNamespace, liveSessions } from './live/socket';
import { closeBrowser } from './live/browserPool';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// SEC-11: loopback by default. app.listen(PORT) binds 0.0.0.0, which would let
// anyone on the corporate LAN drive a browser on this machine through live
// mode. Non-loopback binding is an explicit opt-in via BIND_HOST.
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting. Mounted on /api/ only; Socket.IO lives at /socket.io/, so live
// traffic bypasses this entirely — which is correct (§5). If a live REST
// endpoint is ever added it must be mounted OUTSIDE /api/ or skip loopback.
//
// FR-52: chat is chattier than the upload flow the global limiter was sized
// for. The global bucket is 100 requests / 15 min shared across EVERY /api/
// endpoint — including each GET /api/screenshots/:runId/:type, three per result
// card. A chat panel spending that same budget would lock the user out of
// /api/compare mid-session. Give it a dedicated bucket, mounted BEFORE the
// global limiter so /api/chat never touches the shared one. SEC-05 still holds:
// every route remains rate limited, just not from one pool. Do NOT instead
// raise the global max — that weakens the limit protecting the Gemini free tier.
app.use('/api/chat', rateLimit({ windowMs: 60 * 1000, max: 20 }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  // Mounting the chat limiter first is not enough on its own: '/api/' also
  // matches '/api/chat', so a chat request would be counted against BOTH
  // buckets and still drain the shared one. Skipping it here is what actually
  // gives chat its own budget.
  skip: (req) => req.path.startsWith('/chat'),
});
app.use('/api/', limiter);

// Routes
app.use('/api/compare', compareRouter);
app.use('/api/chat', chatRouter);
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
    // Open live sessions — the probe and the idle-reaper check read this.
    live: liveSessions.size,
  });
});

const httpServer = http.createServer(app);

// Socket.IO CORS is SEPARATE from the Express cors() above — the handshake
// never passes through Express middleware (§5.5).
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173' },
  maxHttpBufferSize: 1e7,
});
attachLiveNamespace(io);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[live] ${signal} — closing live sessions…`);
  try {
    await liveSessions.closeAll('shutdown');
    await closeBrowser();
  } catch (err) {
    console.error('[live] shutdown error:', err);
  }
  httpServer.close(() => process.exit(0));
  // Don't hang forever on a lingering keep-alive socket.
  setTimeout(() => process.exit(0), 5000).unref();
}

// Guarded so integration tests can `import app` (via supertest) without also
// binding a real port — mirrors the require.main pattern already used in
// playwright-service/src/capture.ts.
if (require.main === module) {
  httpServer.listen(PORT, BIND_HOST, () => {
    console.log(`🚀 Visual Regression Backend running on http://${BIND_HOST}:${PORT}`);
    console.log(`📊 Gemini AI: ${process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Missing GEMINI_API_KEY'}`);
    console.log(`🔗 Jira:      ${process.env.JIRA_API_TOKEN ? '✅ Configured' : '⚠️  Not configured'}`);
    console.log(`🐙 GitHub:    ${process.env.GITHUB_TOKEN ? '✅ Configured' : '⚠️  Not configured'}`);
    console.log(`🖥️  Live mode: socket.io namespace /live (bound to ${BIND_HOST} — SEC-11)`);
  });

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Best-effort for the Windows force-kill case: CLAUDE.md's own kill recipe is
  // Stop-Process -Force, which skips signal handlers and orphans chrome.exe.
  process.on('exit', () => {
    void closeBrowser();
  });
}

export { app, httpServer, io };
export default app;
