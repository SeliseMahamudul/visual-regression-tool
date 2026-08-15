/**
 * Live-mode guardrails — WEB_APP_REGRESSION_PLAN §9 step 7, plus the SEC-11
 * loopback check from §9 step 3 and the FR-70 second-capture check from
 * §9 step 6.8 (the automatable half of it).
 *
 * Run the backend for this probe with a short idle timeout, e.g.
 *   VISION_PROVIDER=mock LIVE_IDLE_TIMEOUT_MS=5000 LIVE_REAP_INTERVAL_MS=1000 \
 *   PORT=4011 node dist/index.js
 *   BACKEND=http://127.0.0.1:4011 node test/probe/guardrails-probe.mjs
 */
import { io } from 'socket.io-client';
import { networkInterfaces } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './fixture-server.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = process.env.BACKEND || 'http://127.0.0.1:4000';
const PORT = new URL(BACKEND).port || '4000';
const STAGE_PORT = Number(process.env.STAGE_PORT || 8091);
const DEV_PORT = Number(process.env.DEV_PORT || 8092);

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  const socket = io(`${BACKEND}/live`, { transports: ['websocket'], forceNew: true });
  return new Promise((res, rej) => {
    socket.once('connect', () => res(socket));
    socket.once('connect_error', (e) => rej(e));
    setTimeout(() => rej(new Error('connect timeout')), 10000);
  });
}

function emitAck(socket, event, payload, timeoutMs = 120000) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`ack timeout for ${event}`)), timeoutMs);
    socket.emit(event, payload, (err, data) => {
      clearTimeout(timer);
      if (err) rej(Object.assign(new Error(err.message), { code: err.code }));
      else res(data);
    });
  });
}

async function health() {
  const res = await fetch(`${BACKEND}/health`);
  return res.json();
}

async function main() {
  console.log('── live-mode guardrails ─────────────────────────────────────');
  console.log(`backend: ${BACKEND}`);

  // ── SEC-11: the server must refuse a non-loopback interface address ────────
  const lanIp = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address)[0];

  if (!lanIp) {
    console.log('[SKIP] SEC-11 loopback check — no non-loopback IPv4 interface on this host');
  } else {
    let refused = false;
    let detail = '';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`http://${lanIp}:${PORT}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      detail = `reachable, HTTP ${res.status} — SSRF surface is open to the LAN`;
    } catch (err) {
      refused = true;
      detail = `${lanIp}:${PORT} refused (${err.cause?.code || err.name})`;
    }
    check('SEC-11: backend is unreachable on a non-loopback interface address', refused, detail);
  }

  const stage = await startFixtureServer(join(REPO, 'test/fixtures/stage'), STAGE_PORT);
  const dev = await startFixtureServer(join(REPO, 'test/fixtures/dev'), DEV_PORT);
  const urls = {
    urlBefore: `http://127.0.0.1:${STAGE_PORT}/`,
    urlAfter: `http://127.0.0.1:${DEV_PORT}/`,
    viewport: { width: 1024, height: 700 },
  };

  const sockets = [];
  const sessionIds = [];
  try {
    // ── SEC-10: file:// rejected at session:create ──────────────────────────
    const s0 = await connect();
    sockets.push(s0);
    let createErr = null;
    await emitAck(s0, 'session:create', {
      ...urls,
      urlBefore: 'file:///C:/Projects/visual-regression-tool/backend/.env',
    }).catch((e) => {
      createErr = e;
    });
    check(
      'SEC-10: file:// on session:create is rejected with URL_REJECTED',
      createErr?.code === 'URL_REJECTED',
      createErr ? `${createErr.code}: ${createErr.message}` : 'session was CREATED — secrets are exfiltratable'
    );

    // ── SEC-10: file:// rejected in the URL bar, page unchanged ─────────────
    const state = await emitAck(s0, 'session:create', urls);
    sessionIds.push(state.sessionId);
    const urlBefore = state.panes.before.url;

    const liveError = new Promise((res) => s0.once('live:error', res));
    s0.emit('pane:navigate', {
      sessionId: state.sessionId,
      pane: 'before',
      url: 'file:///C:/Projects/visual-regression-tool/backend/.env',
    });
    const err = await Promise.race([liveError, sleep(5000).then(() => null)]);
    await sleep(500);
    const after = await emitAck(s0, 'session:attach', { sessionId: state.sessionId });
    check(
      'SEC-10: file:// in the URL bar is rejected and the pane is unchanged',
      err?.code === 'URL_REJECTED' && after.panes.before.url === urlBefore,
      `${err?.code} · url still ${after.panes.before.url}`
    );

    // ── FR-70: a second capture never overwrites the first ──────────────────
    const cap = (n) =>
      emitAck(s0, 'capture:run', {
        sessionId: state.sessionId,
        page_name: `Guardrail ${n}`,
        hide_dynamic: true,
        full_page: false,
        auto_file_bugs: false,
      });
    const r1 = await cap(1);
    const r2 = await cap(2);
    const runId1 = r1.run_id;
    const runId2 = r2.run_id;
    const dir = (id) => join(REPO, 'backend', 'results', id);
    const bothOnDisk =
      existsSync(join(dir(runId1), `${runId1}_diff.png`)) &&
      existsSync(join(dir(runId2), `${runId2}_diff.png`));
    check(
      'FR-70: a second capture gets its own run id and its own diff on disk',
      runId1 !== runId2 &&
        runId1.endsWith('-c1') &&
        runId2.endsWith('-c2') &&
        bothOnDisk &&
        r1.before_screenshot !== r2.before_screenshot,
      `${runId1} · ${runId2}`
    );

    // ── FR-75: the 4th session is rejected with SESSION_LIMIT ───────────────
    for (let i = 0; i < 2; i++) {
      const s = await connect();
      sockets.push(s);
      const st = await emitAck(s, 'session:create', urls);
      sessionIds.push(st.sessionId);
    }
    const h3 = await health();

    const s4 = await connect();
    sockets.push(s4);
    let limitErr = null;
    await emitAck(s4, 'session:create', urls).catch((e) => {
      limitErr = e;
    });
    check(
      'FR-75: the 4th concurrent session is rejected with SESSION_LIMIT',
      limitErr?.code === 'SESSION_LIMIT' && h3.live === 3,
      `/health live=${h3.live} · ${limitErr?.code}: ${limitErr?.message}`
    );

    // ── FR-75: the idle reaper closes an inactive session ───────────────────
    const idleMs = Number(process.env.EXPECT_IDLE_MS || 5000);
    console.log(`\nwaiting ${Math.round(idleMs * 2.5)}ms for the idle reaper…`);
    const closed = [];
    for (const s of sockets) s.on('session:closed', (p) => closed.push(p));
    await sleep(idleMs * 2.5);
    const hIdle = await health();
    check(
      'FR-75: idle sessions are reaped and /health live returns to 0',
      hIdle.live === 0 && closed.some((c) => c.reason === 'idle'),
      `/health live=${hIdle.live} · closed=${JSON.stringify(closed.map((c) => c.reason))}`
    );
    sessionIds.length = 0;
  } finally {
    for (const id of sessionIds) {
      await emitAck(sockets[0], 'session:close', { sessionId: id }, 20000).catch(() => undefined);
    }
    for (const s of sockets) s.close();
    stage.close();
    dev.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} guardrails passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('guardrail probe crashed:', err);
  process.exitCode = 1;
});
