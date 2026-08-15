import { randomBytes } from 'crypto';
import { SessionCloseReason } from '../types/live';

/**
 * Session registry: cap enforcement, idle reaping, detach-grace timers
 * (WEB_APP_REGRESSION_PLAN §3.7).
 *
 * Deliberately generic over a minimal structural interface so it can be
 * unit-tested without launching Chromium — LiveSession satisfies it.
 */

/**
 * CLAUDE.md gotcha #8: session ids are interpolated into filesystem paths via
 * the derived run id, so they must satisfy the same guard duplicated in
 * routes/compare.ts and routes/screenshots.ts.
 */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function newSessionId(): string {
  return `live-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

/**
 * FR-70: run ids DERIVE from the session but are never equal to it. A shared
 * run id means capture #2 overwrites capture #1's diff and every result card
 * but the newest shows the wrong images (CLAUDE.md gotcha #4).
 */
export function deriveRunId(sessionId: string, seq: number): string {
  return `${sessionId}-c${seq}`;
}

export class SessionLimitError extends Error {
  readonly code = 'SESSION_LIMIT' as const;
  constructor(max: number) {
    super(
      `Live session limit reached (${max}). Close an existing session, or raise LIVE_MAX_SESSIONS.`
    );
    this.name = 'SessionLimitError';
  }
}

export class SessionNotFoundError extends Error {
  readonly code = 'SESSION_NOT_FOUND' as const;
  constructor(id: string) {
    super(`No live session "${id}". It may have been closed or reaped for inactivity.`);
    this.name = 'SessionNotFoundError';
  }
}

/**
 * FR-75. Each session is two browser contexts ≈ two renderer processes ≈
 * 300-600 MB, so the cap is low on purpose. Read at call time (gotcha #1).
 */
export function maxSessions(): number {
  const raw = Number(process.env.LIVE_MAX_SESSIONS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
}

export function detachGraceMs(): number {
  const raw = Number(process.env.LIVE_DETACH_GRACE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
}

function reapIntervalMs(): number {
  const raw = Number(process.env.LIVE_REAP_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
}

export interface ManagedSession {
  readonly id: string;
  readonly socketIds: Set<string>;
  detachTimer: NodeJS.Timeout | null;
  touch(): void;
  isIdlePast(now: number): boolean;
  close(): Promise<void>;
}

export class SessionManager<T extends ManagedSession> {
  private readonly sessions = new Map<string, T>();
  /** Reserved-but-not-yet-open ids, so two concurrent creates cannot both slip past the cap. */
  private pending = 0;
  private reaper: NodeJS.Timeout | null = null;

  /** Fired for every close, whatever the reason — the socket layer broadcasts it. */
  onClosed: (sessionId: string, reason: SessionCloseReason) => void = () => undefined;

  get size(): number {
    return this.sessions.size;
  }

  ids(): string[] {
    return [...this.sessions.keys()];
  }

  get(id: string): T | undefined {
    return this.sessions.get(id);
  }

  require(id: unknown): T {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) {
      throw new SessionNotFoundError(String(id));
    }
    const session = this.sessions.get(id);
    if (!session) throw new SessionNotFoundError(id);
    return session;
  }

  /**
   * FR-75: the cap is checked BEFORE the factory runs, so a rejected 4th
   * session never launches a browser context it will immediately discard.
   */
  async create(factory: (id: string) => Promise<T>): Promise<T> {
    const max = maxSessions();
    if (this.sessions.size + this.pending >= max) throw new SessionLimitError(max);

    this.pending++;
    const id = newSessionId();
    try {
      const session = await factory(id);
      this.sessions.set(id, session);
      return session;
    } finally {
      this.pending--;
    }
  }

  async close(id: string, reason: SessionCloseReason): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    if (session.detachTimer) {
      clearTimeout(session.detachTimer);
      session.detachTimer = null;
    }
    await session.close();
    this.onClosed(id, reason);
  }

  async closeAll(reason: SessionCloseReason): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id, reason)));
  }

  /** FR-75: idle reaper. Frames do not count as activity — see LiveSession.touch. */
  startReaper(): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => {
      void this.reapOnce();
    }, reapIntervalMs());
    // Never hold the process open just to reap.
    this.reaper.unref?.();
  }

  stopReaper(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
  }

  /** Exposed so tests can drive the reaper deterministically instead of sleeping. */
  async reapOnce(now: number = Date.now()): Promise<string[]> {
    const expired = [...this.sessions.values()].filter((s) => s.isIdlePast(now));
    await Promise.all(expired.map((s) => this.close(s.id, 'idle')));
    return expired.map((s) => s.id);
  }
}
