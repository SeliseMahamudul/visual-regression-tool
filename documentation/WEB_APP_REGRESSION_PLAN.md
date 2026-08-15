# Web App Regression Plan — Live Two-Environment Comparison

**Document Version:** 1.0
**Created:** 2026-08-15
**Status:** Approved for implementation
**Owner:** QA Engineering

---

## 1. The workflow this enables

> "Stage is my baseline. I just upgraded Angular on dev and it broke some alignment. I want to open
> both, log in, navigate to the specific page I care about, click one button, and see the regression."

That workflow is impossible today. The tool offers two ways in, and neither fits:

- **The dashboard** takes two PNGs you produced somewhere else. You are the screenshot pipeline.
- **`playwright-service`** takes a JSON config listing fixed paths (`docs/vr-config.example.json`),
  runs headless in CI, and **cannot log in** — `CaptureConfig.auth` is declared at
  `playwright-service/src/capture.ts:31` and never read anywhere in the file. Deep pages behind a
  session are unreachable.

This plan adds a **Live mode**: enter two URLs, both applications render as interactive panes
*inside* the dashboard at `:5173`, you log in and navigate each one independently with your own
mouse and keyboard, and one button captures both and runs the existing pipeline.

### Decisions already made

| Decision | Value |
|---|---|
| How the browsers appear | **Embedded, streamed panes inside the dashboard** — not separate OS windows |
| Navigation | **Fully independent.** No mirroring of URLs, clicks, or typing |
| Engine | Playwright (already a dependency of `playwright-service`) |
| Credentials | Typed by the user into the live pane. **Nothing is stored** |

---

## 2. New requirement IDs

Highest existing functional requirement is **FR-51**; the chatbot plan claims FR-52…FR-62, so this
feature claims **FR-63 … FR-75**. Amending `documentation/REQUIREMENTS.md` is part of the work.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-63 | There should be another module named "Compare Live" in the top navigation bar. The the new module MUST accept two URLs and open both as live, interactive panes embedded in the dashboard | Must Have |
| FR-64 | Each pane MUST forward the user's mouse, keyboard, and scroll input to its remote page | Must Have |
| FR-65 | The two panes MUST navigate fully independently — no mirroring | Must Have |
| FR-66 | The two panes MUST use isolated browser contexts so cookies and storage never leak between environments | Must Have |
| FR-67 | Each pane MUST provide a URL bar with back, forward, reload, and stop | Must Have |
| FR-68 | A single action MUST capture both panes and run the existing diff + AI classification pipeline | Must Have |
| FR-69 | Live comparison results MUST render through the existing result card and screenshot viewer | Must Have |
| FR-70 | Each capture MUST use a fresh run id so earlier comparisons are never overwritten | Must Have |
| FR-71 | The system MUST support optional HTTP basic auth credentials per pane (closes the FR-08 gap) | Should Have |
| FR-72 | JavaScript dialogs (alert/confirm/prompt) MUST be surfaced to the user, not auto-dismissed | Must Have |
| FR-73 | Pop-up windows opened by the page (SSO flows) MUST be adopted into the pane | Must Have |
| FR-74 | Sessions MUST survive a dashboard reload without losing the logged-in state | Should Have |
| FR-75 | Idle sessions MUST be reaped and the concurrent session count MUST be capped | Must Have |

New non-functional requirements:

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-16 | Live pane input round-trip latency | < 150 ms perceived |
| NFR-17 | Live pane frame rate on an interactive page | ≥ 15 fps |
| NFR-18 | An idle live pane MUST consume negligible CPU and bandwidth | ~0 |

---

## 3. Architecture

### 3.1 Where the browser lives

**Decision: a new `backend/src/live/` module inside the existing backend process. Not a fourth
service, and `playwright-service/` is not touched.**

Reasoning:

- The capture step must call `generatePixelDiff`, `classifyWithGemini`, `createJiraIssue`, and
  `createGitHubIssue` — all of which are `backend/src/services/*`. In-process means a direct function
  call; a separate service means loopback multipart HTTP, which is rejected for concrete reasons in
  §3.6.
- `backend/package.json` **already declares `socket.io ^4.6.1`** (installed, imported nowhere), and
  `playwright` is already hoisted into the root `node_modules` by the npm workspace. Only
  `"playwright"` needs adding to `backend/package.json` to make the dependency honest. No new
  install weight.
- The frontend already proxies to `:4000` through Vite. One process means one Socket.IO endpoint, one
  proxy rule, one CORS origin.
- **`playwright-service/src/capture.ts` cannot be reused as a library.** It calls `process.exit()` on
  every terminal path and reads its config only from `process.env.VR_CONFIG`. It is also the CI
  entry point referenced by `.github/workflows/visual-regression.yml`; churning it risks the one
  path that currently works, for no gain. Live mode is a **parallel** capture strategy, not a
  replacement.

**What this trades away.** A Chromium crash or a leaked context now degrades the API process.
Mitigated by lazy launch (no browser until the first session), a hard session cap, an idle reaper,
and `try/finally` teardown. The `src/live/` boundary is deliberately self-contained — only
`comparisonRunner.ts` and the shared types cross it — so it can be lifted into its own process later
without changing the wire protocol.

### 3.2 Frame transport — CDP screencast

**Chosen: `Page.startScreencast` over a `CDPSession` obtained from Playwright itself.**

```ts
const cdp = await context.newCDPSession(page);
await cdp.send('Page.startScreencast', {
  format: 'jpeg',   // PNG is 5-10x larger and slower to encode. Fidelity is irrelevant
                    // here — the actual COMPARISON uses page.screenshot() PNG.
  quality: 60,      // LIVE_SCREENCAST_QUALITY; 60 keeps text legible at 1:1
  maxWidth: 1280,   // == viewport, so scale factor is 1 and no resampling occurs
  maxHeight: 800,
  everyNthFrame: 1,
});
```

**Rejected: a `page.screenshot()` polling loop.** Every call forces a synchronous rasterization
through `Page.captureScreenshot` **whether or not the page changed** — 50–150 ms and ~100% of one
core *per pane* on Windows, doubled for two panes, and identical cost on a completely static page,
which is what the user is looking at most of the time. It also yields no scroll or scale metadata, so
every frame would need a `page.evaluate(() => window.scrollY)` round trip just to do coordinate math.

Screencast is push-based: Chromium emits only when the compositor produces a frame, so an idle page
costs nothing (NFR-18), and `Page.screencastFrameAck` provides real backpressure — Chromium will not
emit the next frame until the previous is acked, so a slow client throttles the producer instead of
building an unbounded queue.

Event payload:

```ts
interface ScreencastFrameEvent {
  data: string;              // base64 JPEG of the VISIBLE VIEWPORT SURFACE ONLY
  sessionId: number;         // opaque; must be echoed back in the ack
  metadata: {
    offsetTop: number;       // content offset within the surface; 0 on desktop
    pageScaleFactor: number; // 1 unless pinch-zoomed
    deviceWidth: number;     // CSS px (1280)
    deviceHeight: number;    // CSS px (800)
    scrollOffsetX: number;   // scroll at composite time
    scrollOffsetY: number;
    timestamp?: number;
  };
}
```

Ack policy — ack **immediately** after handing the frame to socket.io, not after the client renders
it. Gating on a client render-ack couples Chromium's frame rate to browser rAF plus network RTT and
makes the pane feel laggy on any hiccup. Emit with `socket.volatile.emit`: for a live viewport a
dropped frame is strictly better than a queued stale one.

Frames go over the wire as a Node `Buffer`, which Socket.IO serialises as a binary attachment
arriving as `ArrayBuffer` in the browser. **Do not send base64** — this is the hottest path in the
system and base64 inflates it 33%.

### 3.3 The headless requirement — a non-obvious blocker

**Headed Chromium does not composite non-foreground windows.** With two panes streaming
simultaneously, one of them would simply freeze — and it would look like a bug in the streaming code,
not like a browser policy.

Required:

- **`chromium.launch({ headless: true })`.** Playwright 1.40's new headless mode gives each page its
  own compositor and produces frames regardless of foreground. This also satisfies the "embedded
  panes, not OS windows" requirement natively.
- Belt-and-braces launch args:
  ```
  --disable-background-timer-throttling
  --disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding
  --disable-features=CalculateNativeWinOcclusion
  ```
- **Never call `page.bringToFront()`** — it would starve the other pane.

The probe in §7 tests this explicitly, because it is the failure most likely to be misdiagnosed.

### 3.4 Input forwarding

#### Coordinate translation

Computed in the **frontend**, which owns the canvas rect. Because `maxWidth`/`maxHeight` equal the
viewport, `imgW === metadata.deviceWidth`.

```ts
// frontend/src/live/inputMap.ts
const rect = canvas.getBoundingClientRect();
const fx = (ev.clientX - rect.left) / rect.width;    // 0..1
const fy = (ev.clientY - rect.top)  / rect.height;   // 0..1
const m  = lastDrawnMetadata;                        // NOT last *received*
const x  = (fx * m.deviceWidth)  / m.pageScaleFactor;
const y  = ((fy * m.deviceHeight) - m.offsetTop) / m.pageScaleFactor;
```

`Input.dispatchMouseEvent` takes **viewport** coordinates, so `scrollOffsetX/Y` are deliberately
**not** added — the browser applies scroll itself. They are still forwarded for the scroll-position
indicator.

**Always use the metadata of the last *drawn* frame, not the last *received* one.** A frame can land
between mousedown and mouseup on a page that scrolls during load; mixing metadata generations
produces off-by-scroll clicks that are maddening to debug. Track a monotonic `frameId` and drop
out-of-order frames client-side.

#### Dispatch — a deliberate hybrid

**Mouse and wheel: raw CDP.** We already hold the `CDPSession`, and CDP gives direct control of
`buttons`, `modifiers`, and `clickCount`.

```ts
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel',
  x, y,
  button: 'left' | 'right' | 'middle' | 'none',
  buttons: bitmask,       // 1=left 2=right 4=middle — REQUIRED or drag does not work
  clickCount: 1 | 2 | 3,  // from ev.detail; 2 selects a word, 3 a line
  modifiers: bits,        // 1=Alt 2=Ctrl 4=Meta 8=Shift
  deltaX, deltaY,         // mouseWheel only
});
```

**Keyboard: Playwright's `page.keyboard`, not `Input.dispatchKeyEvent`.** This is the opinionated
call. `Input.dispatchKeyEvent` needs a correct
`windowsVirtualKeyCode`/`nativeVirtualKeyCode`/`code`/`key`/`text`/`unmodifiedText` tuple, and getting
that table wrong is the single largest bug source in every screencast implementation — Enter submits
nothing, Backspace deletes two characters, Tab moves focus backwards. Playwright ships
`USKeyboardLayout` and dispatches over the same connection, so the cost is a few milliseconds.

```ts
if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) await page.keyboard.insertText(ev.key);
else if (mods.length) await page.keyboard.press(`${mods.join('+')}+${ev.key}`);
else await page.keyboard.press(ev.key);   // 'Enter','Tab','Backspace','ArrowDown','Escape'…
```

`insertText` beats `press` for printable characters: one protocol call instead of down/char/up, and
correct handling of IME and composed characters. Trade-off: it skips `keydown`, so a page with a
keydown-only hotkey listener won't see it — acceptable, and modifier chords go through `press`
anyway.

#### Throttling — not optional

- **Wheel**: register via `addEventListener('wheel', h, { passive: false })` in a `useEffect`.
  React's `onWheel` prop is passive and **cannot** `preventDefault`, so the dashboard page itself
  would scroll instead of the pane. Accumulate deltas and flush one `mouseWheel` per
  `requestAnimationFrame` — raw wheel events fire 100+/s on precision trackpads and will flood the
  socket.
- **Mousemove**: coalesce to one per rAF (~60/s), dropping intermediates.

Events forwarded: `mousedown`, `mouseup`, `mousemove` (throttled), `wheel` (coalesced),
`contextmenu` (→ right button, plus `preventDefault` so the dashboard's own menu stays shut),
`keydown`, `keyup`, and `paste` (→ `insertText` with clipboard text, which makes password managers
usable).

### 3.5 Socket.IO protocol

Namespace `/live`. Types duplicated across `backend/src/types/live.ts` and
`frontend/src/types/live.ts`, matching the repo's existing duplicate-not-share convention.

```ts
export type PaneSide = 'before' | 'after';
export interface Viewport { width: number; height: number }

export interface PaneState {
  side: PaneSide;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPopup: boolean;        // true while a window.open child owns the pane (SSO)
  lastError?: string;
}

export interface SessionState {
  sessionId: string;
  createdAt: string;
  expiresAt: string;       // idle deadline, refreshed on activity
  viewport: Viewport;
  panes: Record<PaneSide, PaneState>;
}

export type LiveInputEvent =
  | { kind: 'mouse'; type: 'down' | 'up' | 'move'; x: number; y: number;
      button: 'left' | 'right' | 'middle' | 'none'; buttons: number;
      clickCount: number; modifiers: number }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  | { kind: 'key'; type: 'down' | 'up'; key: string; code: string;
      modifiers: number; repeat: boolean }
  | { kind: 'text'; text: string };          // paste / IME commit

export interface CaptureRequest {
  sessionId: string;
  page_name: string;
  hide_dynamic: boolean;
  full_page: boolean;
  auto_file_bugs: boolean;
  jira_project_key?: string;
  github_owner?: string;
  github_repo?: string;
  pr_number?: string;
}

export interface LiveError {
  code: 'SESSION_LIMIT' | 'SESSION_NOT_FOUND' | 'URL_REJECTED' | 'NAV_FAILED'
      | 'HTTP_401_BASIC_AUTH' | 'CAPTURE_FAILED' | 'CLASSIFY_FAILED'
      | 'SCREENSHOT_TOO_LARGE' | 'BROWSER_UNAVAILABLE' | 'BAD_REQUEST';
  message: string;
  sessionId?: string;
  pane?: PaneSide;
}
```

**Client → Server**

| Event | Payload | Ack |
|---|---|---|
| `session:create` | `{ urlBefore; urlAfter; viewport?; httpCredentials?: { before?, after? } }` | `(err: LiveError \| null, state?: SessionState)` |
| `session:attach` | `{ sessionId }` | `(err, state?)` |
| `session:close` | `{ sessionId }` | `(err)` |
| `pane:navigate` | `{ sessionId; pane; url }` | — |
| `pane:history` | `{ sessionId; pane; action: 'back'\|'forward'\|'reload'\|'stop' }` | — |
| `pane:input` | `{ sessionId; pane; event: LiveInputEvent }` | — |
| `pane:dialogRespond` | `{ sessionId; pane; accept; promptText? }` | — |
| `capture:run` | `CaptureRequest` | `(err, result?: TestResult)` |

**Server → Client**

| Event | Payload |
|---|---|
| `session:state` | `SessionState` — full snapshot on create, attach, and structural change |
| `session:closed` | `{ sessionId; reason: 'user'\|'idle'\|'error'\|'shutdown' }` |
| `pane:frame` | `{ sessionId; pane; frameId: number; data: ArrayBuffer; metadata }` |
| `pane:state` | `{ sessionId } & PaneState` |
| `pane:dialog` | `{ sessionId; pane; type; message; defaultValue? }` |
| `capture:progress` | `{ sessionId; runId; stage: 'pausing'\|'capturing'\|'diffing'\|'classifying'\|'filing'\|'done' }` |
| `capture:result` | `{ sessionId; runId; result: TestResult; sizes: { before: {w,h}; after: {w,h} } }` |
| `live:error` | `LiveError` |

**Every inbound payload is validated server-side** — `sessionId` against the manager map, `pane`
against the two literals, coordinates against `Number.isFinite` and viewport bounds. Nothing reaches
CDP on trust.

### 3.6 Capture and compare

#### Refactor: extract `runComparison()`

`backend/src/routes/compare.ts` currently holds the entire pipeline inline at **lines 94–183**. Extract
it into `backend/src/services/comparisonRunner.ts` so both the HTTP route and the live session call
the same code:

```ts
export interface ComparisonOptions {
  runId: string;
  pageName: string;
  autoFileBugs: boolean;
  jiraProjectKey?: string;
  githubOwner?: string;
  githubRepo?: string;
  prNumber?: string;
  expectations?: ExpectationRules;              // from the chatbot plan, if landed
  onProgress?: (stage: 'diffing' | 'classifying' | 'filing') => void;
}

export interface ComparisonOutcome { result: TestResult; diff: DiffResult; }

/** The whole pipeline, minus transport. Assumes both files are already on disk
 *  under uploads/{runId}/ and that runId has passed SAFE_RUN_ID. */
export async function runComparison(
  beforePath: string, afterPath: string, opts: ComparisonOptions
): Promise<ComparisonOutcome>;

/** FR-69: live results must carry the same URL shape the dashboard already renders. */
export function toApiUrls(result: TestResult): TestResult;
```

`compare.ts` becomes: multer → validate `run_id` → promote staged files → `runComparison(...)` →
`toApiUrls(...)` → respond. **The staging/rename logic and its long explanatory comment stay in the
route** — they are multipart-specific, and that comment documents `CLAUDE.md` gotcha #2. The
result-JSON write moves into `runComparison`, since both callers need it.

This is a **behaviour-preserving refactor**. §7 step 4 regression-tests it before any live code is
trusted.

#### Why not loopback HTTP

Having the live module POST multipart to its own `/api/compare` was considered and rejected. Two of
the five reasons are outright bugs, not inefficiencies:

1. **`limits: { fileSize: 10 * 1024 * 1024 }` in `compare.ts`.** A full-page PNG of a real Angular
   dashboard at 1280×4000 is routinely 8–15 MB. Live captures would intermittently 400 for reasons
   the user cannot diagnose.
2. **The `/api/` rate limiter** (100 req / 15 min, keyed by IP) would put every live capture into one
   shared bucket keyed on `::1`.
3. Re-encoding two multi-MB PNGs into multipart, streaming them over TCP, and having multer write
   them back to `.staging` and rename them — for files the same process just wrote.
4. It needs a base URL, coupling the live module to network config it should not know about
   (especially given §5's loopback binding).
5. Errors arrive as `{ error: string }` + an HTTP status, losing the typed distinction the socket
   protocol wants for `LiveError.code`.

#### The capture sequence

```
capture:run received
 ├─ validate session; mark busy (reject concurrent captures on one session)
 ├─ runId = `${sessionId}-c${captureSeq++}`;  mkdir uploads/{runId}
 ├─ emit capture:progress 'pausing'
 ├─ Promise.all over both panes:
 │    1. await cdp.send('Page.stopScreencast')
 │    2. await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
 │         — kills the blinking text caret, a guaranteed 1-2px phantom diff
 │    3. if (hide_dynamic) styleHandle = await applyDynamicMask(page)
 │    4. await page.screenshot({ path, fullPage, animations: 'disabled',
 │                              type: 'png', timeout: 30_000 })
 │    5. await styleHandle?.evaluate(n => n.remove())     // restore the live view
 │    6. await cdp.send('Page.startScreencast', params)   // in a finally
 ├─ emit progress 'diffing' / 'classifying' / 'filing' via onProgress
 ├─ outcome = await runComparison(beforePath, afterPath, {...})
 └─ ack + emit capture:result { runId, result: toApiUrls(outcome.result), sizes }
```

**Stop the screencast before `fullPage` screenshotting.** Chromium's `captureBeyondViewport` path
temporarily resizes the surface; leaving screencast running produces a burst of garbage-sized frames,
can deliver a torn frame, and has been observed to deadlock the capture. Restarting is cheap. Wrap in
`try/finally` so the restart happens even if the screenshot throws.

#### Dynamic-element masking — reuse, but make it removable

The selector list is currently inline at `playwright-service/src/capture.ts:57-65`. Hoist it to
`backend/src/services/dynamicMask.ts`:

```ts
export const DYNAMIC_MASK_CSS = `
  [data-testid="timestamp"], [data-testid="avatar"], .dynamic-ad,
  iframe[id^="google_ads"], .live-counter { visibility: hidden !important; }
`;
export async function applyDynamicMask(page: Page): Promise<ElementHandle> {
  return page.addStyleTag({ content: DYNAMIC_MASK_CSS });   // FR-04
}
```

Two differences from the CI path: it must be **removed** afterwards (the user keeps interacting with
this page), and it is exposed as a **checkbox** in the capture bar, default on — in live mode the
user may specifically want to compare an avatar.

### 3.7 Session lifecycle

**Session ids** must satisfy `/^[A-Za-z0-9_-]{1,128}$/`, the guard duplicated in
`routes/compare.ts:41` and `routes/screenshots.ts` (`CLAUDE.md` gotcha #8 — keep them in sync):

```ts
export function newSessionId(): string {
  return `live-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}
```

**Run ids derive from the session but are never equal to it** (FR-70). `CLAUDE.md` gotcha #4: a
shared run id means the second capture overwrites the first's diff and every card but the newest
shows the wrong images.

```ts
const runId = `${session.id}-c${session.captureSeq++}`;   // live-lz9k2f-a1b2c3d4-c1
```

**Structure.**

```
LiveSession
├─ id, createdAt, lastActivityAt, captureSeq, socketIds: Set<string>
├─ panes.before : LivePane { context, page, cdp, lastMetadata, frameSeq, state }
└─ panes.after  : LivePane { … }
```

**Context isolation (FR-66) is non-negotiable.** Two `browser.newContext()` calls, never two pages in
one context. Stage and dev are usually the *same application*, so a shared cookie jar means logging
into dev silently rotates the stage session and the comparison becomes garbage — a failure that
looks like a bug in the application under test, not in this tool.

```ts
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,          // matches capture.ts — keeps live and CI captures comparable (FR-05)
  acceptDownloads: false,        // no remote page writes to the server's disk
  httpCredentials: creds?.[side],// FR-71
  ignoreHTTPSErrors: true,       // internal staging certs — a deliberate, documented choice
});
```

**Idle reaper (FR-75).** `LIVE_IDLE_TIMEOUT_MS`, default 15 min, checked on a 60 s interval. Activity
means `pane:input`, `pane:navigate`, `pane:history`, or `capture:run`. **Frames do not count** — a
page with a spinner would otherwise keep a forgotten session alive forever.

**Disconnect (FR-74).** Do **not** tear down immediately: a Vite HMR reload or an accidental refresh
would destroy a hard-won logged-in session. On `disconnect`, drop the socket id and start a 60 s
grace timer (`LIVE_DETACH_GRACE_MS`), stopping both screencasts meanwhile — no listener, no reason to
burn CPU.

**Reconnect.** The frontend persists `sessionId` in `sessionStorage` and emits `session:attach` on
mount. The server cancels the grace timer, restarts both screencasts, emits a full `session:state`,
and **forces one immediate frame per pane** — `Page.startScreencast` alone will not emit until the
next composite, so a static page would reattach to a blank canvas. Nudge it with a no-op
`Input.dispatchMouseEvent` of type `mouseMoved` at the last known cursor position.

**Concurrency cap (FR-75).** `LIVE_MAX_SESSIONS`, default **3**. Each session is two contexts ≈ two
renderer processes ≈ 300–600 MB. Exceeding it returns `{ code: 'SESSION_LIMIT' }`.

**Shutdown.** `SIGINT`/`SIGTERM` → close all sessions → `browser.close()` → `httpServer.close()`.
Plus a best-effort `process.on('exit')` handler for the Windows force-kill case — the `Stop-Process
-Force` recipe in `CLAUDE.md` skips signal handlers and orphans `chrome.exe`.

---

## 4. Credentials and authentication

**Confirmed: no credential storage of any kind.** The user types into the live pane; keystrokes
travel over the socket into the page. Nothing is persisted, nothing is logged — `input.ts` must
**never** `console.log` a `kind:'key'` or `kind:'text'` payload, and `morgan` does not see socket
traffic.

Four gotchas, each of which silently breaks a real login if unhandled:

1. **HTTP basic auth is a native dialog and is not part of the rendered surface.** It will *never*
   appear in a screencast frame — the pane just sits blank while Chromium waits, with no indication
   why. Handle both ways: optional `httpCredentials` fields on the session-create form passed to
   `browser.newContext()` (**this is the fix for the long-standing FR-08 gap**, and finally gives
   `CaptureConfig.auth` a reason to exist), and detection via `page.on('response')` where
   `status === 401` and `www-authenticate` starts with `Basic` → emit `HTTP_401_BASIC_AUTH` telling
   the user to recreate the session with credentials.

2. **Playwright auto-dismisses JS dialogs when no handler is registered** (FR-72). Any login flow
   that confirms will break in a way that looks like the page ignoring the click. Register
   `page.on('dialog')`, forward as `pane:dialog`, render a real modal in the pane, respond via
   `pane:dialogRespond`.

3. **SSO popups are the big one** (FR-73). Okta, Azure AD, and Auth0 commonly `window.open()` the
   identity provider. Register `context.on('page')`; when a child appears, attach a new `CDPSession`,
   make it the pane's *active* page, set `isPopup: true`, screencast it, and revert to the opener on
   its `close` event. Without this the login simply never completes and it is not obvious why. **Test
   this against the real environment early** (§7 step 8) — it is the difference between "works on my
   static fixture" and "works at the office".

4. **Native `<select>` dropdowns, date pickers, autofill, and the context menu do not render in
   headless Chromium.** The list is a native widget outside the page surface. This is an honest
   limitation: document it, and note the workaround — click the select to focus it, then Arrow keys +
   Enter, which *do* work because they are dispatched into the renderer. **File inputs** are also out
   of scope for v1 (`page.on('filechooser')` exists); say so explicitly rather than let it surprise
   someone.

**Transport.** Keystrokes traverse a plaintext WebSocket. Fine on `localhost`. If this is ever
exposed beyond loopback, TLS is a hard precondition — see §5.

---

## 5. Security

This feature makes the server drive a browser to arbitrary user-supplied URLs. The honest framing:
classic SSRF is only half the problem, because the *legitimate* use case is reaching internal hosts.
A blanket RFC1918 block would break the feature. The real exposures are scheme abuse and non-loopback
binding.

In priority order:

1. **Bind the backend to loopback.** `backend/src/index.ts` currently calls `app.listen(PORT)`, which
   binds `0.0.0.0` — today, anyone on the corporate LAN could drive a browser on your machine. Change
   to `httpServer.listen(PORT, process.env.BIND_HOST || '127.0.0.1')`. **This is the single
   highest-value item in this section.**

2. **Scheme allowlist — `http:` and `https:` only.** Typing
   `file:///C:/Projects/visual-regression-tool/backend/.env` into a pane's URL bar would otherwise
   render the server's API keys into a JPEG and stream them to the client, defeating SEC-01 entirely.
   Also reject `data:`, `blob:`, `about:` (except `about:blank`), `chrome:`, `devtools:`,
   `view-source:`, `javascript:`. Enforce on `session:create`, on `pane:navigate`, **and** on in-page
   navigation via `page.on('framenavigated')` for the main frame.

3. **Cloud-metadata denylist** — `169.254.0.0/16` (AWS/Azure IMDS), `100.100.100.200` (Alibaba),
   `metadata.google.internal` after DNS resolution. **RFC1918 stays allowed**, deliberately, because
   that is where staging lives. Document the trade rather than leaving it implicit.

4. **Optional host allowlist.** `LIVE_URL_ALLOWLIST`, comma-separated host globs
   (`*.stage.corp,*.dev.corp,localhost`). Empty = any http(s) host. Default empty for usability;
   document turning it on if the tool is ever shared.

5. **Socket.IO CORS is separate from Express CORS.** The `app.use(cors(...))` in `index.ts` does
   **not** apply to the Socket.IO handshake. Configure explicitly:
   ```ts
   new Server(httpServer, {
     cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173' },
     maxHttpBufferSize: 1e7,
   });
   ```

6. **`acceptDownloads: false`** on both contexts.

7. **Resource caps** — 3 sessions, 30 s navigation timeout, per-pane navigation rate limit,
   screenshot size ceiling (§6).

**Rate limiter interaction.** `app.use('/api/', limiter)` mounts on a path prefix; Socket.IO lives at
`/socket.io/`, so **live traffic bypasses the limiter entirely** — which is correct and needs no
change. Note two things: this is a further argument against loopback multipart (§3.6), and if a live
REST endpoint is ever added (e.g. `GET /api/live/sessions` for debugging) it inherits the limiter —
mount it outside `/api/` or add `skip: (req) => req.ip === '::1' || req.ip === '127.0.0.1'`.

New requirements for `documentation/REQUIREMENTS.md` §11:

| ID | Requirement |
|----|-------------|
| SEC-10 | Live-mode navigation targets MUST be validated against a scheme allowlist and a cloud-metadata denylist |
| SEC-11 | The backend MUST bind to loopback by default; non-loopback binding MUST be an explicit opt-in |

---

## 6. Risks and failure modes

| Risk | Why it is hard | Mitigation |
|---|---|---|
| **Input latency feels sluggish** | Round trip is socket (~2 ms) + CDP dispatch + input→composite (30–80 ms) + JPEG encode + decode. Drag and text selection feel worst. | Draw a **client-side cursor** on the canvas at the local pointer position — the pointer feels instant even while hover state lags. Never fake scroll or text. Keep quality ≤ 60. Set expectations in the UI copy: this is a comparison tool, not a remote desktop. |
| **Frame storms on animated pages** | Carousels, spinners, video and `animation: infinite` produce 60 fps of full-viewport JPEGs — ~30 Mbit/s per pane. | Ack backpressure is the primary defence. Plus `socket.volatile.emit`, an adaptive `everyNthFrame` rising to 2–3 when measured fps > 25 for 3 s, and a bytes/sec meter in the toolbar so the user can see it. |
| **`fullPage` screenshot while screencasting** | `captureBeyondViewport` resizes the surface — torn frames, occasional hangs. | Always stop → await → screenshot → restart, in `try/finally`. 30 s timeout. |
| **Enormous `fullPage` screenshots** | Infinite-scroll Angular pages report 30 000+ px `scrollHeight`; PNG > 100 MB, or Chromium's 16 384 px texture limit truncates **silently**. | Pre-check `document.documentElement.scrollHeight`; over 12 000 px emit `SCREENSHOT_TOO_LARGE` and offer viewport-only. Expose `full_page` as a toggle. |
| **Before/after height mismatch inflates the diff** | `normalizeImageSize` in `pixelDiff.ts` **stretches** rather than pads (a known gap recorded in `CLAUDE.md`), distorting content. Two live panes rarely scroll to identical heights. | Out of scope to fix here. But return both natural sizes in `capture:result.sizes` and **warn in the UI** when they differ by > 2%, so the user knows the percentage is inflated. Recommend viewport-only capture for like-for-like. |
| **One pane freezes** | Chromium does not composite non-foreground surfaces. | `headless: true` + the four `--disable-*` args (§3.3). Probe step 5 tests it explicitly. |
| **Orphaned `chrome.exe` on Windows** | `CLAUDE.md`'s own kill recipe is `Stop-Process -Force`, which skips signal handlers. | `process.on('exit')` best-effort close. Document the cleanup: `Get-Process chrome -EA SilentlyContinue \| Where-Object { $_.Path -like '*ms-playwright*' } \| Stop-Process -Force` |
| **`ts-node-dev --respawn` kills sessions on every save** | The backend dev script watches `src/`. | Document it: for live-mode work run `cd backend; npm run build; npm start`. |
| **Stale metadata → misplaced clicks** | A frame lands between mousedown and mouseup on a scrolling page. | Coordinate math uses last-**drawn** metadata; monotonic `frameId`; out-of-order frames dropped. |
| **SSO popup breaks login** | `window.open` creates a page the pane is not watching. | `context.on('page')` adoption (§4.3). Validate against the real environment early. |
| **Memory growth over a long session** | Two contexts per session; heavy SPAs leak. | Session cap, idle reaper, and log `process.memoryUsage().rss` on session close. |
| **AI classification takes 5–30 s** | The `capture:run` ack must survive it. | Socket.IO acks have no default timeout and the heartbeat is independent, so this works — but emit `capture:progress` so the UI is not dead. Optionally `{ ack: true, timeout: 180000 }`. |

---

## 7. File-by-file implementation

### New — backend

| Path | Responsibility |
|---|---|
| `backend/src/live/browserPool.ts` | Lazy singleton `Browser`; `getBrowser()`, `closeBrowser()`; launch args; failure → `BROWSER_UNAVAILABLE` |
| `backend/src/live/pane.ts` | `LivePane`: context, page, CDP session, metadata, state. `start/stopScreencast`, `navigate`, `history`, `dispatchInput`, `screenshot`, popup adoption, dialog forwarding, `Page.getNavigationHistory` → `canGoBack/Forward`, `close` |
| `backend/src/live/session.ts` | `LiveSession`: two panes, `captureSeq`, `touch()`, `runCapture()` orchestration, `close(reason)` |
| `backend/src/live/sessionManager.ts` | `Map<string, LiveSession>`, `newSessionId()`, cap enforcement, idle reaper, detach-grace timers, `closeAll()` |
| `backend/src/live/input.ts` | CDP mouse/wheel dispatch, modifier bitmask, coordinate clamping, key routing. **Must never log payloads** |
| `backend/src/live/urlGuard.ts` | `assertNavigable(url): URL` — scheme allowlist, metadata denylist, `LIVE_URL_ALLOWLIST` (SEC-10) |
| `backend/src/live/socket.ts` | `attachLiveNamespace(io)` — all handlers, payload validation, error mapping |
| `backend/src/types/live.ts` | Protocol types (§3.5) |
| `backend/src/services/comparisonRunner.ts` | `runComparison()` + `toApiUrls()`, extracted from `compare.ts:94-183` |
| `backend/src/services/dynamicMask.ts` | `DYNAMIC_MASK_CSS`, `applyDynamicMask()`, hoisted from `capture.ts:57-65` |

### New — frontend

| Path | Responsibility |
|---|---|
| `frontend/src/types/live.ts` | Mirror of the backend protocol types |
| `frontend/src/live/socket.ts` | `getLiveSocket()` singleton — `io('/live', { transports: ['websocket'] })` |
| `frontend/src/live/useLiveSession.ts` | Lifecycle hook: create/attach/close, `sessionStorage` persistence, state reducer, capture with progress |
| `frontend/src/live/frameRenderer.ts` | `createImageBitmap` → `drawImage`, frame ordering, metadata ref, overlays |
| `frontend/src/live/inputMap.ts` | DOM event → `LiveInputEvent`, coordinate translation, rAF coalescing |
| `frontend/src/components/UploadMode.tsx` | The existing upload UI, extracted from `App.tsx` unchanged |
| `frontend/src/components/live/LiveCompare.tsx` | Mode root — `{ onResult: (r: TestResult) => void }` |
| `frontend/src/components/live/SessionStartForm.tsx` | Two URL inputs ("Reference / stage", "Candidate / dev"), optional basic-auth disclosure, viewport preset |
| `frontend/src/components/live/LivePane.tsx` | Canvas, toolbar, focus ring, overlays |
| `frontend/src/components/live/PaneToolbar.tsx` | URL bar, back/forward/reload/stop, loading spinner, popup chip |
| `frontend/src/components/live/CaptureBar.tsx` | Page name, hide-dynamic, full-page, auto-file toggles, Compare button, progress |
| `frontend/src/components/live/PaneDialog.tsx` | In-pane modal for JS dialogs (FR-72) |

### Modified

| Path | Change |
|---|---|
| `backend/src/index.ts` | Keep `import './env'` **first** (gotcha #1). Add `http.createServer(app)`, `new Server(httpServer, {cors, maxHttpBufferSize: 1e7})`, `attachLiveNamespace(io)`. Replace `app.listen(PORT)` with `httpServer.listen(PORT, BIND_HOST ?? '127.0.0.1')` (SEC-11). Shutdown handlers. Export `{ app, httpServer, io }`, keeping `export default app`. Add a `live` session count to `/health` |
| `backend/src/routes/compare.ts` | Replace lines 94–183 with `runComparison()` + `toApiUrls()`. Keep multer staging/rename, its comment, `SAFE_RUN_ID`, and the staging-cleanup `catch`. **No behaviour change** |
| `backend/package.json` | Add `"playwright": "^1.40.1"` (`socket.io` already declared) |
| `backend/.env.example` | `BIND_HOST`, `LIVE_MAX_SESSIONS`, `LIVE_IDLE_TIMEOUT_MS`, `LIVE_DETACH_GRACE_MS`, `LIVE_SCREENCAST_QUALITY`, `LIVE_VIEWPORT_WIDTH/HEIGHT`, `LIVE_URL_ALLOWLIST`. **Trailing newline** |
| `frontend/src/App.tsx` | `mode: 'upload' \| 'live'` state, header segmented control, extract body to `UploadMode`, render `LiveCompare` appending to the shared `results`, widen the container in live mode |
| `frontend/vite.config.ts` | Add `'/socket.io': { target: 'http://localhost:4000', ws: true, changeOrigin: true }` |
| `frontend/package.json` | Add `"socket.io-client": "^4.6.1"` |
| `documentation/REQUIREMENTS.md` | FR-63…FR-75, NFR-16…NFR-18, SEC-10, SEC-11 |
| `documentation/RUNNING.md` | Live mode usage, `npx playwright install chromium`, Windows chrome cleanup |
| `CLAUDE.md` | `src/live/` in the responsibility table; `comparisonRunner.ts`, `dynamicMask.ts`; new gotchas (respawn, orphaned chrome, `ws: true`) |

### Explicitly unchanged

`playwright-service/**` (the CI path stays as-is), `services/{pixelDiff,aiClassification,
visionProvider,visionPrompt,retry,jiraService,githubService}.ts`, `routes/screenshots.ts`,
`components/{ResultCard,ScreenshotViewer,ClassificationBadge,UploadForm}.tsx`, `api/client.ts`.

### Frontend notes worth calling out

**Mode switching without a router.** Do not add `react-router` for two views. A `mode` state in
`App.tsx` plus a segmented control in the header (active `bg-violet-600 text-white`, inactive
`text-slate-400 hover:text-white`, wrapper `bg-slate-800/60 border border-slate-700 rounded-lg p-1`).
Keep `results` and the stats bar lifted in `App` and shared by both modes — a live capture appends to
the same array and renders through the **existing, unmodified** `ResultCard`, because `toApiUrls()`
gives it exactly the shape it already receives (FR-69).

**Render frames to `<canvas>`, not `<img>`.** Object URLs must be individually revoked (a leak at
20 fps otherwise), `<img>` decode is async and unsynchronised so you get visible tearing on swap, and
you cannot overlay. Canvas gives one stable surface, allows the dimmed "Capturing…" overlay, and
`createImageBitmap` decodes off the main thread.

```ts
socket.on('pane:frame', async ({ side, frameId, data, metadata }) => {
  if (side !== mySide || frameId <= lastDrawnId) return;      // drop out-of-order
  const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
  if (canvas.width !== bitmap.width) { canvas.width = bitmap.width; canvas.height = bitmap.height; }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  lastDrawnId = frameId; lastMetadataRef.current = metadata;
});
```

Sizing: canvas intrinsic size = frame natural size; CSS `width: 100%; height: auto; aspect-ratio:
{deviceWidth}/{deviceHeight}` so it scales responsively while `getBoundingClientRect()` keeps the
coordinate math correct.

**A visible focus ring per pane is essential UX, not polish.** `tabIndex={0}` plus
`outline-none focus:ring-2 focus:ring-violet-500`. Without it, typing a password into the wrong pane
is a routine mistake. `preventDefault()` on `Tab`, `Space`, `/`, and arrows so the dashboard does not
scroll or steal focus.

**Layout:** two panes in `grid grid-cols-2 gap-4` inside a `max-w-[1800px]` container. The existing
`max-w-6xl` (1152 px) is far too narrow for two 1280-px panes.

**`ws: true` on the Vite proxy is mandatory.** Without it the upgrade request 404s and Socket.IO
silently falls back to long-polling — which *works*, badly, at maybe 3 fps. That failure mode is
subtle enough to waste an afternoon.

---

## 8. Implementation order

Each step leaves the tree working and typechecking.

1. `comparisonRunner.ts` refactor + `dynamicMask.ts`. **Regression-test `/api/compare` here**, before
   any live code exists.
2. `index.ts`: `http.Server`, socket.io, loopback binding, shutdown handlers. Verify `/health` still
   responds and the frontend still works.
3. `types/live.ts` in both packages; `urlGuard.ts` with unit tests.
4. `browserPool.ts`, `pane.ts` (navigation + screencast only), `sessionManager.ts`, `socket.ts`.
5. Frontend `socket.ts`, `useLiveSession.ts`, `frameRenderer.ts`, `LivePane` — **read-only panes
   first.** Prove frames render on both before touching input.
6. `input.ts` + `inputMap.ts`. Prove clicking and typing work.
7. Capture flow end-to-end.
8. Dialogs, popups, basic auth.
9. Polish: toolbar, capture bar, size-mismatch warning, docs.

---

## 9. Verification and probe

Full detail is in `documentation/TEST_PLAN.md` §5. The condensed live-mode probe:

### Prerequisites
```powershell
cd C:\Projects\visual-regression-tool
npm install
npx playwright install chromium
```

### Step 1 — fixture environments
Two local static sites in `test/fixtures/{stage,dev}/`, identical except a recoloured button
(`#7c3aed` vs `#dc2626`) and a shifted margin, each with a JS-only login form so the manual-login
path is exercised.

```powershell
Start-Process powershell -ArgumentList '-NoExit','-Command','npx --yes http-server test/fixtures/stage -p 8081 -c-1'
Start-Process powershell -ArgumentList '-NoExit','-Command','npx --yes http-server test/fixtures/dev   -p 8082 -c-1'
```
**Success:** both return 200.

### Step 2 — backend
```powershell
$env:VISION_PROVIDER = 'mock'
cd backend; npm run build; npm start
curl.exe -s http://localhost:4000/health
```
**Success:** `status: ok`, and the new `live` counter reads 0.

### Step 3 — loopback binding (SEC-11)
```powershell
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object -First 1).IPAddress
try { Invoke-WebRequest "http://${ip}:4000/health" -TimeoutSec 3 -UseBasicParsing } catch { "correctly refused" }
```
**Success:** connection refused. A 200 means the SSRF surface is open to the LAN.

### Step 4 — refactor regression (before trusting any live code)
```powershell
curl.exe -s -F "before=@test/fixtures/before.png" -F "after=@test/fixtures/after.png" `
  -F "run_id=probe-regress-1" -F "page_name=Regression" http://localhost:4000/api/compare
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:4000/api/screenshots/probe-regress-1/before
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:4000/api/screenshots/probe-regress-1/diff
```
**Success:** `success: true`, `before_screenshot: "/api/screenshots/probe-regress-1/before"`, and both
image fetches return 200. This proves `runComparison()` was behaviour-preserving.

### Step 5 — headless socket probe (no UI)
`test/probe/live-probe.mjs` drives `socket.io-client` directly: create session against :8081/:8082 →
count frames per side for 5 s → synthetic click + text + Enter → `capture:run` → print the result.

```powershell
node test/probe/live-probe.mjs
```

**All of these must hold:**
- Both panes deliver ≥ 1 frame within 3 s.
- **Both** panes keep producing frames across the 5 s window — this is the specific test that
  background throttling is not freezing a pane (§3.3). Non-zero on both sides is the pass condition.
- Frames after the synthetic click **differ in byte length** from those before — proving input reached
  the renderer, not merely that the socket accepted it.
- `capture:progress` arrives in order `pausing → capturing → diffing → classifying → done`.
- `runId` matches `/^live-[a-z0-9]+-[0-9a-f]{8}-c1$/` and satisfies `/^[A-Za-z0-9_-]{1,128}$/`.
- `result.before_screenshot === '/api/screenshots/{runId}/before'`.
- `result.classification.diff_percentage > 0` — the fixtures differ by design; zero means both panes
  screenshotted the same page.
- Frames **resume** on both panes after capture.

Then on disk:
```powershell
Get-ChildItem backend/uploads/<runId>; Get-ChildItem backend/results/<runId>
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:4000/api/screenshots/<runId>/diff
```
**Success:** `before_*.png` + `after_*.png` in `uploads/<runId>/`, `<runId>_diff.png` + a result JSON
in `results/<runId>/`, diff URL 200 — the REQUIREMENTS §10.1 layout honoured identically to the
upload path.

### Step 6 — full UI
```powershell
npm run dev     # from the root
```
Open **http://localhost:5173** (never :4000). Switch to Live, enter the two URLs, Start.

1. Both panes render the fixture pages.
2. Click into the **left** pane's username field and type — text appears **only** in the left pane.
   Repeat on the right. Proves independent input routing and the focus ring.
3. Wheel-scroll the left pane — only that pane scrolls, and the dashboard behind it does **not**
   (proves the non-passive wheel handler).
4. Log in on both panes as **different users**, then reload the left pane: it stays logged in as its
   own user and the right is unaffected. **This is the FR-66 cookie-isolation test.**
5. Navigate the panes to different URLs — confirm no mirroring (FR-65).
6. Bring both to the same page, name it, click **Compare**.
7. Both panes dim, progress ticks, and a `ResultCard` appears with working before/after/diff images
   in the **existing, unmodified** `ScreenshotViewer`.
8. Run a **second** Compare. Both cards show their own correct images — this is `CLAUDE.md` gotcha #4
   (FR-70); a shared run id would make card #1 display card #2's diff.
9. Press F5. The panes reattach to the same session, still logged in (FR-74).

### Step 7 — guardrails
- `file:///C:/Projects/visual-regression-tool/backend/.env` in a URL bar → rejected with
  `URL_REJECTED`, page unchanged (SEC-10).
- A 4th session → `SESSION_LIMIT` (FR-75).
- `LIVE_IDLE_TIMEOUT_MS=30000`, create a session, wait 40 s → `session:closed` reason `idle`, and
  `/health` `live` returns to 0.
- After closing all sessions:
  `Get-Process chrome -EA SilentlyContinue | Where-Object { $_.Path -like '*ms-playwright*' }`
  returns nothing.

### Step 8 — real staging (the one thing fixtures cannot prove)
Run once against the actual stage and dev Angular builds and verify **manual login completes**,
including any SSO popup (§4.3). This is the highest-risk unknown in the feature and should be
validated **before** the rest is polished, not after.

---

## 10. Execution contract

**The implementing agent must complete every step below. This is not optional and not negotiable.**

### 1. Implement
Build the plan as specified. TypeScript strict throughout (NFR-13); no `any` without a comment
explaining why. Cite the FR/NFR/SEC ids from §2 and §5 in code comments, following this codebase's
existing convention.

### 2. Run a probe test and prove it passes
Run §9 steps 1–7 in order, plus:
```powershell
npm run typecheck      # root — all three packages
cd backend; npm test
```
**Paste the actual command output into the final report. Do not assert success — show it.** Step 4
(the refactor regression) and step 5 (the socket probe) are the two that matter most; neither may be
skipped.

### 3. Debug and prove the fix
If anything fails, **debug and resolve it**, then re-run and show the passing output. A step that was
skipped, or that still fails, must be reported as such — never presented as done. If step 8 cannot be
run because no real staging environment is reachable, say so explicitly rather than implying it
passed.

### 4. Commit
```powershell
git checkout -b feat/live-environment-comparison
git add -A
git commit    # descriptive message; never commit backend/.env (SEC-01/SEC-02)
git push -u origin feat/live-environment-comparison
```
Never commit directly to `main`. Confirm `test/fixtures/` is committed but `uploads/`, `results/`,
and `screenshots/` remain gitignored.

### 5. Raise a pull request
Against `main` on `https://github.com/SeliseMahamudul/visual-regression-tool`.

**The `gh` CLI is not installed on this machine.** Either install it
(`winget install --id GitHub.cli`) then `gh pr create --fill`, or output this URL for the user:
```
https://github.com/SeliseMahamudul/visual-regression-tool/compare/main...feat/live-environment-comparison?expand=1
```

### 6. Report back
- The PR link.
- What was proven, with the probe output.
- What was **not** done or could not be verified — especially step 8 — stated plainly.
- Any deviation from this plan and why.
