import type { Server, Socket } from 'socket.io';
import {
  CaptureRequest,
  CaptureStage,
  LiveError,
  LiveInputEvent,
  PaneSide,
  SessionCreateRequest,
  SessionState,
  Viewport,
} from '../types/live';
import { LiveSession } from './session';
import {
  SessionLimitError,
  SessionManager,
  SessionNotFoundError,
  detachGraceMs,
} from './sessionManager';
import { getBrowser, BrowserUnavailableError } from './browserPool';
import { UrlRejectedError } from './urlGuard';
import { validateExpectationRules } from '../services/textProvider';

/** One registry for the process; /health and the shutdown hook both read it. */
export const liveSessions = new SessionManager<LiveSession>();

const PANE_SIDES: readonly PaneSide[] = ['before', 'after'];

// ── payload validation — nothing reaches CDP on trust (§3.5) ────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asPaneSide(v: unknown): PaneSide {
  if (v === 'before' || v === 'after') return v;
  throw new BadRequestError(`pane must be one of: ${PANE_SIDES.join(', ')}`);
}

function asFinite(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new BadRequestError(`${field} must be a finite number`);
  }
  return v;
}

function asString(v: unknown, field: string, maxLen = 2048): string {
  if (typeof v !== 'string') throw new BadRequestError(`${field} must be a string`);
  if (v.length > maxLen) throw new BadRequestError(`${field} exceeds ${maxLen} characters`);
  return v;
}

class BadRequestError extends Error {
  readonly code = 'BAD_REQUEST' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

function asViewport(v: unknown): Viewport {
  const fallbackW = Number(process.env.LIVE_VIEWPORT_WIDTH) || 1280;
  const fallbackH = Number(process.env.LIVE_VIEWPORT_HEIGHT) || 800;
  if (!isRecord(v)) return { width: fallbackW, height: fallbackH };
  const width = Math.round(asFinite(v.width, 'viewport.width'));
  const height = Math.round(asFinite(v.height, 'viewport.height'));
  if (width < 320 || width > 3840 || height < 240 || height > 2160) {
    throw new BadRequestError('viewport must be between 320x240 and 3840x2160');
  }
  return { width, height };
}

/**
 * Input validation. NOTE: this function must never log its argument — a
 * kind:'key' or kind:'text' payload is the user's password (§4).
 */
function asInputEvent(v: unknown, viewport: Viewport): LiveInputEvent {
  if (!isRecord(v)) throw new BadRequestError('event must be an object');

  switch (v.kind) {
    case 'mouse': {
      if (v.type !== 'down' && v.type !== 'up' && v.type !== 'move') {
        throw new BadRequestError('mouse event type must be down, up or move');
      }
      const button = v.button;
      if (button !== 'left' && button !== 'right' && button !== 'middle' && button !== 'none') {
        throw new BadRequestError('mouse button must be left, right, middle or none');
      }
      return {
        kind: 'mouse',
        type: v.type,
        x: asFinite(v.x, 'x'),
        y: asFinite(v.y, 'y'),
        button,
        buttons: Math.max(0, Math.min(31, Math.trunc(asFinite(v.buttons, 'buttons')))),
        clickCount: Math.max(0, Math.min(3, Math.trunc(asFinite(v.clickCount, 'clickCount')))),
        modifiers: Math.max(0, Math.min(15, Math.trunc(asFinite(v.modifiers, 'modifiers')))),
      };
    }
    case 'wheel':
      return {
        kind: 'wheel',
        x: asFinite(v.x, 'x'),
        y: asFinite(v.y, 'y'),
        // Clamp so one crafted event cannot scroll a page by a billion pixels.
        deltaX: Math.max(-viewport.width * 4, Math.min(viewport.width * 4, asFinite(v.deltaX, 'deltaX'))),
        deltaY: Math.max(-viewport.height * 4, Math.min(viewport.height * 4, asFinite(v.deltaY, 'deltaY'))),
        modifiers: Math.max(0, Math.min(15, Math.trunc(asFinite(v.modifiers, 'modifiers')))),
      };
    case 'key':
      if (v.type !== 'down' && v.type !== 'up') {
        throw new BadRequestError('key event type must be down or up');
      }
      return {
        kind: 'key',
        type: v.type,
        key: asString(v.key, 'key', 32),
        code: typeof v.code === 'string' ? v.code.slice(0, 32) : '',
        modifiers: Math.max(0, Math.min(15, Math.trunc(asFinite(v.modifiers, 'modifiers')))),
        repeat: !!v.repeat,
      };
    case 'text':
      return { kind: 'text', text: asString(v.text, 'text', 10_000) };
    default:
      throw new BadRequestError('event.kind must be mouse, wheel, key or text');
  }
}

function asCaptureRequest(v: unknown): CaptureRequest {
  if (!isRecord(v)) throw new BadRequestError('capture request must be an object');
  return {
    sessionId: asString(v.sessionId, 'sessionId', 128),
    page_name: typeof v.page_name === 'string' ? v.page_name.slice(0, 200) : 'Live Comparison',
    hide_dynamic: v.hide_dynamic !== false,
    full_page: !!v.full_page,
    auto_file_bugs: !!v.auto_file_bugs,
    jira_project_key: typeof v.jira_project_key === 'string' ? v.jira_project_key : undefined,
    github_owner: typeof v.github_owner === 'string' ? v.github_owner : undefined,
    github_repo: typeof v.github_repo === 'string' ? v.github_repo : undefined,
    pr_number: typeof v.pr_number === 'string' ? v.pr_number : undefined,
    // FR-55/FR-62: malformed expectations degrade to "none", never fail the
    // capture — same defensive posture as routes/compare.ts.
    expectations: validateExpectationRules(v.expectations),
  };
}

function asCreateRequest(v: unknown): SessionCreateRequest {
  if (!isRecord(v)) throw new BadRequestError('session:create payload must be an object');
  const creds = isRecord(v.httpCredentials) ? v.httpCredentials : undefined;
  const readCreds = (side: PaneSide) => {
    const c = creds?.[side];
    if (!isRecord(c)) return undefined;
    const username = typeof c.username === 'string' ? c.username : '';
    const password = typeof c.password === 'string' ? c.password : '';
    return username ? { username, password } : undefined;
  };
  return {
    // The URLs themselves are validated by assertNavigable inside the pane (SEC-10).
    urlBefore: asString(v.urlBefore, 'urlBefore'),
    urlAfter: asString(v.urlAfter, 'urlAfter'),
    viewport: asViewport(v.viewport),
    httpCredentials: { before: readCreds('before'), after: readCreds('after') },
  };
}

// ── error mapping ──────────────────────────────────────────────────────────

export function toLiveError(err: unknown, sessionId?: string): LiveError {
  if (err instanceof UrlRejectedError) return { code: 'URL_REJECTED', message: err.message, sessionId };
  if (err instanceof SessionLimitError) return { code: 'SESSION_LIMIT', message: err.message };
  if (err instanceof SessionNotFoundError) return { code: 'SESSION_NOT_FOUND', message: err.message, sessionId };
  if (err instanceof BrowserUnavailableError) return { code: 'BROWSER_UNAVAILABLE', message: err.message };
  if (err instanceof BadRequestError) return { code: 'BAD_REQUEST', message: err.message, sessionId };
  const e = err as Error;
  if (e?.name === 'ScreenshotTooLargeError') {
    return { code: 'SCREENSHOT_TOO_LARGE', message: e.message, sessionId };
  }
  return { code: 'CAPTURE_FAILED', message: e?.message || 'Unexpected live-mode error', sessionId };
}

// ── namespace ──────────────────────────────────────────────────────────────

type Ack = (err: LiveError | null, payload?: unknown) => void;

function safeAck(ack: unknown): Ack {
  return typeof ack === 'function' ? (ack as Ack) : () => undefined;
}

export function attachLiveNamespace(io: Server): void {
  const nsp = io.of('/live');

  liveSessions.onClosed = (sessionId, reason) => {
    nsp.to(sessionId).emit('session:closed', { sessionId, reason });
  };
  liveSessions.startReaper();

  nsp.on('connection', (socket: Socket) => {
    const emitError = (err: unknown, sessionId?: string) => {
      socket.emit('live:error', toLiveError(err, sessionId));
    };

    /** Every handler that mutates a session runs through here. */
    const withSession = async (
      raw: unknown,
      fn: (session: LiveSession) => Promise<void>
    ): Promise<void> => {
      let sessionId: string | undefined;
      try {
        if (!isRecord(raw)) throw new BadRequestError('payload must be an object');
        sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : undefined;
        const session = liveSessions.require(raw.sessionId);
        // Activity for the idle reaper — frames deliberately do not count (FR-75).
        session.touch();
        await fn(session);
      } catch (err) {
        emitError(err, sessionId);
      }
    };

    socket.on('session:create', async (payload: unknown, ack: unknown) => {
      const done = safeAck(ack);
      try {
        const req = asCreateRequest(payload);
        const viewport = req.viewport as Viewport;
        const browser = await getBrowser();

        const session = await liveSessions.create(async (id) => {
          const s = new LiveSession(id, viewport, {
            onFrame: (side, frameId, data, metadata) => {
              // volatile: for a live viewport a dropped frame is strictly
              // better than a queued stale one (§3.2).
              nsp.to(id).volatile.emit('pane:frame', {
                sessionId: id,
                pane: side,
                frameId,
                data,
                metadata,
              });
            },
            onPaneState: (state) => nsp.to(id).emit('pane:state', { sessionId: id, ...state }),
            onDialog: (side, dialog) =>
              nsp.to(id).emit('pane:dialog', { sessionId: id, pane: side, ...dialog }),
            onError: (err) => nsp.to(id).emit('live:error', err),
            onCaptureProgress: (runId, stage: CaptureStage) =>
              nsp.to(id).emit('capture:progress', { sessionId: id, runId, stage }),
          });
          // Join the room BEFORE opening the panes. Frames and pane:state are
          // emitted from the very first paint; if the socket is still outside
          // the room they are dropped, and a static page then never composites
          // again — the pane would sit blank until the user happened to
          // interact with it. Same failure the reattach nudge exists for.
          await socket.join(id);
          s.socketIds.add(socket.id);
          try {
            await s.open(browser, req);
          } catch (err) {
            // A half-open session must not occupy a slot or leak a context.
            await socket.leave(id);
            await s.close();
            throw err;
          }
          return s;
        });

        const state: SessionState = session.state();
        done(null, state);
        nsp.to(session.id).emit('session:state', state);
        // Belt-and-braces: force one composite per pane so the canvas is never
        // blank on a page that finished painting before the room join.
        await session.nudgeFrames();
      } catch (err) {
        done(toLiveError(err));
      }
    });

    /** FR-74: reattach after a dashboard reload without losing logged-in state. */
    socket.on('session:attach', async (payload: unknown, ack: unknown) => {
      const done = safeAck(ack);
      try {
        if (!isRecord(payload)) throw new BadRequestError('payload must be an object');
        const session = liveSessions.require(payload.sessionId);
        if (session.detachTimer) {
          clearTimeout(session.detachTimer);
          session.detachTimer = null;
        }
        session.socketIds.add(socket.id);
        socket.join(session.id);
        session.touch();
        await session.resumeStreams();
        const state = session.state();
        done(null, state);
        socket.emit('session:state', state);
      } catch (err) {
        done(toLiveError(err));
      }
    });

    socket.on('session:close', async (payload: unknown, ack: unknown) => {
      const done = safeAck(ack);
      try {
        if (!isRecord(payload)) throw new BadRequestError('payload must be an object');
        const session = liveSessions.require(payload.sessionId);
        await liveSessions.close(session.id, 'user');
        done(null);
      } catch (err) {
        done(toLiveError(err));
      }
    });

    socket.on('pane:navigate', (payload: unknown) =>
      withSession(payload, async (session) => {
        const p = payload as Record<string, unknown>;
        await session.pane(asPaneSide(p.pane)).navigate(asString(p.url, 'url'));
      })
    );

    socket.on('pane:history', (payload: unknown) =>
      withSession(payload, async (session) => {
        const p = payload as Record<string, unknown>;
        const action = p.action;
        if (action !== 'back' && action !== 'forward' && action !== 'reload' && action !== 'stop') {
          throw new BadRequestError('action must be back, forward, reload or stop');
        }
        await session.pane(asPaneSide(p.pane)).history(action);
      })
    );

    socket.on('pane:input', (payload: unknown) =>
      withSession(payload, async (session) => {
        const p = payload as Record<string, unknown>;
        const side = asPaneSide(p.pane);
        // asInputEvent validates; neither it nor dispatchInput may log the payload.
        const event = asInputEvent(p.event, session.viewport);
        await session.pane(side).dispatchInput(event);
      })
    );

    socket.on('pane:dialogRespond', (payload: unknown) =>
      withSession(payload, async (session) => {
        const p = payload as Record<string, unknown>;
        const side = asPaneSide(p.pane);
        const promptText = typeof p.promptText === 'string' ? p.promptText : undefined;
        await session.pane(side).respondToDialog(!!p.accept, promptText);
      })
    );

    socket.on('capture:run', async (payload: unknown, ack: unknown) => {
      const done = safeAck(ack);
      let sessionId: string | undefined;
      try {
        const req = asCaptureRequest(payload);
        sessionId = req.sessionId;
        const session = liveSessions.require(req.sessionId);
        const outcome = await session.runCapture(req);
        done(null, outcome.result);
        nsp.to(session.id).emit('capture:result', {
          sessionId: session.id,
          runId: outcome.runId,
          result: outcome.result,
          sizes: outcome.sizes,
        });
      } catch (err) {
        const mapped = toLiveError(err, sessionId);
        done(mapped);
        socket.emit('live:error', mapped);
      }
    });

    /**
     * FR-74: do NOT tear down immediately. A Vite HMR reload or an accidental
     * refresh would otherwise destroy a hard-won logged-in session. Drop the
     * socket, stop both screencasts (no listener, no reason to burn CPU), and
     * start the detach-grace timer.
     */
    socket.on('disconnect', () => {
      for (const id of liveSessions.ids()) {
        const session = liveSessions.get(id);
        if (!session || !session.socketIds.delete(socket.id)) continue;
        if (session.socketIds.size > 0) continue;

        void session.pauseStreams();
        session.detachTimer = setTimeout(() => {
          const still = liveSessions.get(id);
          if (still && still.socketIds.size === 0) {
            void liveSessions.close(id, 'idle');
          }
        }, detachGraceMs());
        session.detachTimer.unref?.();
      }
    });
  });
}
