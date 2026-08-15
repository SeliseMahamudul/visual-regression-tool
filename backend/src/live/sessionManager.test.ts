import {
  ManagedSession,
  SAFE_ID,
  SessionLimitError,
  SessionManager,
  SessionNotFoundError,
  deriveRunId,
  maxSessions,
  newSessionId,
} from './sessionManager';
import { SessionCloseReason } from '../types/live';

/** A LiveSession stand-in: same structural contract, no Chromium. */
class FakeSession implements ManagedSession {
  readonly socketIds = new Set<string>();
  detachTimer: NodeJS.Timeout | null = null;
  lastActivityAt = Date.now();
  closed = false;
  captureSeq = 0;

  constructor(readonly id: string, private readonly idleMs = 1000) {}

  touch(): void {
    this.lastActivityAt = Date.now();
  }
  isIdlePast(now: number): boolean {
    return now - this.lastActivityAt > this.idleMs;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

afterEach(() => {
  delete process.env.LIVE_MAX_SESSIONS;
});

describe('newSessionId (CLAUDE.md gotcha #8)', () => {
  it('satisfies /^[A-Za-z0-9_-]{1,128}$/ across 1000 generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = newSessionId();
      expect(SAFE_ID.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(1000);
  });

  it('matches the shape the live probe asserts on', () => {
    expect(newSessionId()).toMatch(/^live-[a-z0-9]+-[0-9a-f]{8}$/);
  });
});

describe('deriveRunId (FR-70, gotcha #4)', () => {
  it('produces a distinct id per capture, never equal to the session id', () => {
    const sid = newSessionId();
    const ids = [1, 2, 3].map((n) => deriveRunId(sid, n));
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain(sid);
    expect(ids[0]).toBe(`${sid}-c1`);
  });

  it('keeps derived run ids inside the filesystem-safe guard', () => {
    const sid = newSessionId();
    for (let n = 1; n <= 500; n++) {
      expect(SAFE_ID.test(deriveRunId(sid, n))).toBe(true);
    }
  });
});

describe('SessionManager cap (FR-75)', () => {
  it('rejects the 4th session with SESSION_LIMIT when the cap is 3', async () => {
    const mgr = new SessionManager<FakeSession>();
    expect(maxSessions()).toBe(3);

    for (let i = 0; i < 3; i++) {
      await mgr.create(async (id) => new FakeSession(id));
    }
    expect(mgr.size).toBe(3);

    await expect(mgr.create(async (id) => new FakeSession(id))).rejects.toBeInstanceOf(
      SessionLimitError
    );
    expect(mgr.size).toBe(3);
  });

  it('never runs the factory for a rejected session — no wasted browser context', async () => {
    process.env.LIVE_MAX_SESSIONS = '1';
    const mgr = new SessionManager<FakeSession>();
    await mgr.create(async (id) => new FakeSession(id));

    const factory = jest.fn(async (id: string) => new FakeSession(id));
    await expect(mgr.create(factory)).rejects.toBeInstanceOf(SessionLimitError);
    expect(factory).not.toHaveBeenCalled();
  });

  it('honours LIVE_MAX_SESSIONS at call time', async () => {
    process.env.LIVE_MAX_SESSIONS = '1';
    const mgr = new SessionManager<FakeSession>();
    await mgr.create(async (id) => new FakeSession(id));
    await expect(mgr.create(async (id) => new FakeSession(id))).rejects.toBeInstanceOf(
      SessionLimitError
    );
  });

  it('frees a slot when a session closes', async () => {
    process.env.LIVE_MAX_SESSIONS = '1';
    const mgr = new SessionManager<FakeSession>();
    const s = await mgr.create(async (id) => new FakeSession(id));
    await mgr.close(s.id, 'user');
    expect(mgr.size).toBe(0);
    await expect(mgr.create(async (id) => new FakeSession(id))).resolves.toBeDefined();
  });
});

describe('SessionManager lookup', () => {
  it('throws SESSION_NOT_FOUND for unknown, malformed, and non-string ids', async () => {
    const mgr = new SessionManager<FakeSession>();
    expect(() => mgr.require('live-nope-00000000')).toThrow(SessionNotFoundError);
    expect(() => mgr.require('../../etc/passwd')).toThrow(SessionNotFoundError);
    expect(() => mgr.require(undefined)).toThrow(SessionNotFoundError);
    expect(() => mgr.require(42)).toThrow(SessionNotFoundError);
  });
});

describe('idle reaper (FR-75)', () => {
  it('closes a session past its idle deadline and reports the reason', async () => {
    const mgr = new SessionManager<FakeSession>();
    const closed: Array<[string, SessionCloseReason]> = [];
    mgr.onClosed = (id, reason) => closed.push([id, reason]);

    const s = await mgr.create(async (id) => new FakeSession(id, 1000));
    s.lastActivityAt = Date.now() - 5000;

    const reaped = await mgr.reapOnce();
    expect(reaped).toEqual([s.id]);
    expect(s.closed).toBe(true);
    expect(mgr.size).toBe(0);
    expect(closed).toEqual([[s.id, 'idle']]);
  });

  it('spares a session whose touch() landed inside the window', async () => {
    const mgr = new SessionManager<FakeSession>();
    const s = await mgr.create(async (id) => new FakeSession(id, 1000));
    s.lastActivityAt = Date.now() - 5000;

    s.touch();

    expect(await mgr.reapOnce()).toEqual([]);
    expect(s.closed).toBe(false);
    expect(mgr.size).toBe(1);
  });

  it('reaps only the expired session, leaving the active one alone', async () => {
    const mgr = new SessionManager<FakeSession>();
    const stale = await mgr.create(async (id) => new FakeSession(id, 1000));
    const fresh = await mgr.create(async (id) => new FakeSession(id, 1000));
    stale.lastActivityAt = Date.now() - 5000;

    expect(await mgr.reapOnce()).toEqual([stale.id]);
    expect(fresh.closed).toBe(false);
    expect(mgr.ids()).toEqual([fresh.id]);
  });
});

describe('closeAll (shutdown)', () => {
  it('closes every session and empties the registry', async () => {
    const mgr = new SessionManager<FakeSession>();
    const made = [
      await mgr.create(async (id) => new FakeSession(id)),
      await mgr.create(async (id) => new FakeSession(id)),
    ];
    await mgr.closeAll('shutdown');
    expect(made.every((s) => s.closed)).toBe(true);
    expect(mgr.size).toBe(0);
  });
});
