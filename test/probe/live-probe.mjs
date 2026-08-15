/**
 * Live-mode headless probe — TEST_PLAN.md §5.2 / WEB_APP_REGRESSION_PLAN §9 step 5.
 *
 * Drives socket.io-client directly, with no browser and no UI:
 *   session:create against the two fixture servers
 *   → count frames per side for 5 s
 *   → synthetic click + text + Enter
 *   → count frames again
 *   → capture:run
 *   → assert the result and the on-disk layout.
 *
 * Every assertion here exists because the failure it catches is otherwise
 * invisible. #2 catches background-tab throttling freezing one pane; #3 catches
 * an input path that accepts events and drops them; #7 catches both panes
 * screenshotting the same page.
 *
 * Usage:
 *   node test/probe/live-probe.mjs                # backend on :4000
 *   BACKEND=http://127.0.0.1:4010 node test/probe/live-probe.mjs
 */
import { io } from 'socket.io-client';
import { startFixtureServer } from './fixture-server.mjs';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = process.env.BACKEND || 'http://127.0.0.1:4000';
const STAGE_PORT = Number(process.env.STAGE_PORT || 8081);
const DEV_PORT = Number(process.env.DEV_PORT || 8082);
const FRAME_WINDOW_MS = 5000;

const results = [];
function check(n, label, ok, detail = '') {
  results.push({ n, label, ok });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] #${n} ${label}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(socket, event, timeoutMs, predicate = () => true) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      rej(new Error(`timed out after ${timeoutMs}ms waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      res(payload);
    };
    socket.on(event, handler);
  });
}

function emitAck(socket, event, payload, timeoutMs = 180000) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`ack timeout for "${event}"`)), timeoutMs);
    socket.emit(event, payload, (err, data) => {
      clearTimeout(timer);
      if (err) rej(new Error(`${err.code}: ${err.message}`));
      else res(data);
    });
  });
}

async function main() {
  console.log('── live-mode probe ──────────────────────────────────────────');
  const stage = await startFixtureServer(join(REPO, 'test/fixtures/stage'), STAGE_PORT);
  const dev = await startFixtureServer(join(REPO, 'test/fixtures/dev'), DEV_PORT);
  console.log(`fixtures: http://127.0.0.1:${STAGE_PORT} (stage) · http://127.0.0.1:${DEV_PORT} (dev)`);
  console.log(`backend:  ${BACKEND}`);

  const socket = io(`${BACKEND}/live`, { transports: ['websocket'], forceNew: true });
  await new Promise((res, rej) => {
    socket.once('connect', res);
    socket.once('connect_error', (e) => rej(new Error(`socket connect failed: ${e.message}`)));
    setTimeout(() => rej(new Error('socket connect timeout')), 10000);
  });

  socket.on('live:error', (e) => console.log(`   live:error ${e.code}: ${e.message}`));

  // Frame accounting per side.
  const frames = { before: [], after: [] };
  const firstFrameAt = { before: null, after: null };
  const t0 = Date.now();
  socket.on('pane:frame', ({ pane, data }) => {
    const len = data?.byteLength ?? data?.length ?? 0;
    if (firstFrameAt[pane] === null) firstFrameAt[pane] = Date.now() - t0;
    frames[pane].push({ t: Date.now(), len });
  });

  const progress = [];
  socket.on('capture:progress', ({ stage: s }) => progress.push(s));

  // Pane titles, so #3 can prove input reached the RENDERER independently of
  // frame bytes: the fixture only changes document.title on a successful login.
  const paneTitles = { before: '', after: '' };
  socket.on('pane:state', (s) => {
    if (s.side) paneTitles[s.side] = s.title;
  });

  let sessionId;
  try {
    const state = await emitAck(socket, 'session:create', {
      urlBefore: `http://127.0.0.1:${STAGE_PORT}/`,
      urlAfter: `http://127.0.0.1:${DEV_PORT}/`,
      viewport: { width: 1280, height: 800 },
    });
    sessionId = state.sessionId;
    console.log(`session:  ${sessionId}`);

    // ── #1 both panes deliver >= 1 frame within 3 s ──────────────────────────
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !(frames.before.length && frames.after.length)) {
      await sleep(100);
    }
    check(
      1,
      'both panes deliver >= 1 frame within 3s',
      frames.before.length > 0 && frames.after.length > 0,
      `before=${frames.before.length} after=${frames.after.length} firstAt=${JSON.stringify(firstFrameAt)}ms`
    );

    // ── #2 both panes keep producing frames across a 5 s window ──────────────
    // This is THE test for headless background throttling freezing one pane.
    const windowStart = Date.now();
    // An IDLE page composites nothing at all — that is NFR-18 working, not a
    // fault — so a bare wait cannot distinguish "healthy but static" from
    // "frozen". Drive a real scroll on both panes instead: every wheel event
    // that reaches a live renderer produces a composite, and a pane frozen by
    // background throttling produces none however hard we push it.
    const wheel = (pane, deltaY) =>
      socket.emit('pane:input', {
        sessionId,
        pane,
        event: { kind: 'wheel', x: 640, y: 400, deltaX: 0, deltaY, modifiers: 0 },
      });
    let down = true;
    const nudger = setInterval(() => {
      for (const pane of ['before', 'after']) wheel(pane, down ? 200 : -200);
      down = !down;
    }, 250);
    await sleep(FRAME_WINDOW_MS);
    clearInterval(nudger);
    // Pin both panes back to the top so the later capture is like-for-like.
    for (const pane of ['before', 'after']) wheel(pane, -5000);
    await sleep(500);

    const inWindow = (side) => frames[side].filter((f) => f.t >= windowStart).length;
    check(
      2,
      'both panes keep producing frames across the 5s window (no background throttling)',
      inWindow('before') > 0 && inWindow('after') > 0,
      `before=${inWindow('before')} frames, after=${inWindow('after')} frames`
    );

    // ── #3 post-click frames differ in byte length from pre-click frames ─────
    const preLens = new Set(frames.before.slice(-25).map((f) => f.len));
    const preCount = { before: frames.before.length, after: frames.after.length };

    // The fixture positions the login controls at fixed viewport coordinates.
    const click = (pane, x, y) => {
      for (const type of ['move', 'down', 'up']) {
        socket.emit('pane:input', {
          sessionId,
          pane,
          event: {
            kind: 'mouse',
            type,
            x,
            y,
            button: type === 'move' ? 'none' : 'left',
            buttons: type === 'down' ? 1 : 0,
            clickCount: type === 'move' ? 0 : 1,
            modifiers: 0,
          },
        });
      }
    };

    for (const pane of ['before', 'after']) {
      click(pane, 580, 258); // #username
      socket.emit('pane:input', {
        sessionId,
        pane,
        event: { kind: 'text', text: pane === 'before' ? 'stage-user' : 'dev-user' },
      });
      click(pane, 580, 318); // #password
      socket.emit('pane:input', {
        sessionId,
        pane,
        event: { kind: 'text', text: 'hunter2' },
      });
      socket.emit('pane:input', {
        sessionId,
        pane,
        event: { kind: 'key', type: 'down', key: 'Enter', code: 'Enter', modifiers: 0, repeat: false },
      });
    }
    await sleep(2500);

    const postBefore = frames.before.slice(preCount.before);
    const postAfter = frames.after.slice(preCount.after);
    const newLength = postBefore.some((f) => !preLens.has(f.len));
    // Two independent proofs, because a socket that silently swallows input
    // would otherwise look identical to one that works: the frame bytes must
    // change, AND the page title must be the one the fixture only sets from
    // its click handler.
    const loggedIn =
      /Dashboard/.test(paneTitles.before) && /Dashboard/.test(paneTitles.after);
    check(
      3,
      'frames change after synthetic input (input reached the renderer, not just the socket)',
      postBefore.length > 0 && postAfter.length > 0 && newLength && loggedIn,
      `newFrames before=${postBefore.length} after=${postAfter.length}, unseen byte-length=${newLength}, titles=${JSON.stringify(paneTitles)}`
    );

    // ── capture ──────────────────────────────────────────────────────────────
    // Both panes to the top, so a scroll difference cannot masquerade as a
    // visual regression in assertion #7.
    for (const pane of ['before', 'after']) wheel(pane, -5000);
    await sleep(600);

    progress.length = 0;
    const framesBeforeCapture = { before: frames.before.length, after: frames.after.length };
    const capturePromise = waitFor(socket, 'capture:result', 180000);
    const result = await emitAck(socket, 'capture:run', {
      sessionId,
      page_name: 'Live Probe',
      hide_dynamic: true,
      full_page: false,
      auto_file_bugs: false,
    });
    const captureEvent = await capturePromise;
    const runId = captureEvent.runId;

    // ── #4 progress order ────────────────────────────────────────────────────
    const expected = ['pausing', 'capturing', 'diffing', 'classifying', 'done'];
    const seen = progress.filter((s) => expected.includes(s));
    check(
      4,
      'capture:progress arrives in order pausing -> capturing -> diffing -> classifying -> done',
      JSON.stringify(seen) === JSON.stringify(expected),
      JSON.stringify(seen)
    );

    // ── #5 run id shape ──────────────────────────────────────────────────────
    check(
      5,
      'runId matches /^live-[a-z0-9]+-[0-9a-f]{8}-c1$/ and the filesystem-safe guard',
      /^live-[a-z0-9]+-[0-9a-f]{8}-c1$/.test(runId) && /^[A-Za-z0-9_-]{1,128}$/.test(runId),
      runId
    );

    // ── #6 API url shape (FR-69) ─────────────────────────────────────────────
    check(
      6,
      "result.before_screenshot === '/api/screenshots/{runId}/before'",
      result.before_screenshot === `/api/screenshots/${runId}/before`,
      result.before_screenshot
    );

    // ── #7 the fixtures differ by design ─────────────────────────────────────
    check(
      7,
      'result.classification.diff_percentage > 0 (both panes did not capture the same page)',
      result.classification.diff_percentage > 0,
      `${result.classification.diff_percentage.toFixed(4)}% · sizes=${JSON.stringify(captureEvent.sizes)}`
    );

    // ── #8 frames resume after capture ───────────────────────────────────────
    const resumeStart = Date.now();
    const resumeNudge = setInterval(() => {
      for (const pane of ['before', 'after']) {
        socket.emit('pane:input', {
          sessionId,
          pane,
          event: { kind: 'wheel', x: 640, y: 400, deltaX: 0, deltaY: 30, modifiers: 0 },
        });
      }
    }, 200);
    await sleep(3000);
    clearInterval(resumeNudge);
    const resumedBefore = frames.before.filter((f) => f.t >= resumeStart).length;
    const resumedAfter = frames.after.filter((f) => f.t >= resumeStart).length;
    check(
      8,
      'frames resume on both panes after capture (the finally-restart works)',
      resumedBefore > 0 && resumedAfter > 0,
      `before=${resumedBefore} after=${resumedAfter} (pre-capture totals ${framesBeforeCapture.before}/${framesBeforeCapture.after})`
    );

    // ── on-disk layout (REQUIREMENTS §10.1) ──────────────────────────────────
    const uploadDir = join(REPO, 'backend', 'uploads', runId);
    const resultDir = join(REPO, 'backend', 'results', runId);
    const uploads = existsSync(uploadDir) ? readdirSync(uploadDir) : [];
    const outputs = existsSync(resultDir) ? readdirSync(resultDir) : [];
    console.log(`\nuploads/${runId}: ${JSON.stringify(uploads)}`);
    console.log(`results/${runId}: ${JSON.stringify(outputs)}`);
    const layoutOk =
      uploads.some((f) => f.startsWith('before_')) &&
      uploads.some((f) => f.startsWith('after_')) &&
      outputs.includes(`${runId}_diff.png`) &&
      outputs.some((f) => f.endsWith('.json'));
    check(9, 'on-disk layout matches REQUIREMENTS §10.1', layoutOk);

    const diffRes = await fetch(`${BACKEND}/api/screenshots/${runId}/diff`);
    const beforeRes = await fetch(`${BACKEND}/api/screenshots/${runId}/before`);
    check(
      10,
      'the diff and before images are served over HTTP',
      diffRes.status === 200 && beforeRes.status === 200,
      `diff=${diffRes.status} before=${beforeRes.status}`
    );

    console.log(`\nclassification: ${result.classification.classification} [${result.classification.severity}]`);
    console.log(`explanation:    ${result.classification.explanation}`);
  } finally {
    if (sessionId) {
      await emitAck(socket, 'session:close', { sessionId }, 30000).catch(() => undefined);
    }
    socket.close();
    stage.close();
    dev.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} assertions passed`);
  if (failed.length) {
    console.log(`FAILED: ${failed.map((f) => `#${f.n}`).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nprobe crashed:', err);
  process.exitCode = 1;
});
