# CLAUDE.md

Context for Claude Code when working in this repository.

---

## What this project is

An AI-powered visual regression testing tool. It compares "before" and "after" UI screenshots,
computes a pixel diff, then asks a vision model whether the change is a genuine bug or benign —
which is the whole point: pixel-diff-only tools (Percy, BackstopJS) drown QA engineers in false
positives from timestamps, avatars, and anti-aliasing. Confirmed bugs can be auto-filed to Jira and
GitHub, and the whole thing runs on pull requests via GitHub Actions.

It's an internal QA engineering tool, not a product. `documentation/REQUIREMENTS.md` is the
authoritative spec — every requirement has an ID (`FR-01`, `NFR-06`, `SEC-03`) and code comments
reference those IDs. **When changing behaviour, check whether a requirement covers it, and cite the
ID in the comment.**

---

## Layout

```
visual-regression-tool/          ← npm workspace root; run npm install HERE only
├── backend/          Express + TypeScript API on :4000 — the entire pipeline
├── frontend/         React 18 + Vite + Tailwind dashboard on :5173
├── playwright-service/  CLI that captures screenshots and submits them to the backend
├── documentation/    REQUIREMENTS.md (the spec) · RUNNING.md (how to run it)
├── docs/             vr-config.example.json
└── .github/workflows/visual-regression.yml
```

The backend is where nearly all the logic lives:

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Express setup, middleware, `/health`. Imports `./env` **first** — see gotchas |
| `src/routes/compare.ts` | `POST /api/compare` — the whole pipeline, orchestrated |
| `src/routes/screenshots.ts` | Serves before/after/diff PNGs by run id |
| `src/routes/integrations.ts` | Live health of Gemini/Jira/GitHub |
| `src/services/pixelDiff.ts` | pixelmatch + Jimp. No AI — pure computation |
| `src/services/aiClassification.ts` | Retry policy, response parsing, validation |
| `src/services/visionProvider.ts` | **The only file to touch to swap AI provider** (FR-22/NFR-15) |
| `src/services/visionPrompt.ts` | The classification prompt, isolated for tuning (NFR-14) |
| `src/services/retry.ts` | Exponential backoff + jitter (NFR-06) |
| `src/services/jiraService.ts` | Creates tickets, attaches all three screenshots |
| `src/services/githubService.ts` | Creates issues, auto-creates labels, PR comments |
| `src/services/comparisonRunner.ts` | `runComparison()` + `toApiUrls()` — the pipeline minus transport. **Both** `/api/compare` and live mode call it |
| `src/services/dynamicMask.ts` | `DYNAMIC_MASK_CSS` + apply/remove (FR-04), shared with the live capture |

Live mode (FR-63…FR-75) lives in `src/live/`, deliberately self-contained so it could be lifted
into its own process later without changing the wire protocol:

| File | Responsibility |
|------|----------------|
| `src/live/browserPool.ts` | Lazy singleton Chromium. **`headless: true` is required, not a preference** — see gotcha #9 |
| `src/live/pane.ts` | One pane: own `BrowserContext` (FR-66), CDP screencast, input, dialogs, popup adoption, capture |
| `src/live/session.ts` | Two panes + `runCapture()` orchestration |
| `src/live/sessionManager.ts` | Registry, `newSessionId()`/`deriveRunId()`, cap, idle reaper (FR-75) |
| `src/live/input.ts` → `inputMap.ts` | Coordinate translation and modifier bitmask. **Never log a payload** — it is the user's password |
| `src/live/urlGuard.ts` | `assertNavigable()` — scheme allowlist + metadata denylist (SEC-10) |
| `src/live/socket.ts` | `/live` namespace, payload validation, error mapping |

---

## Running it

Full instructions are in `documentation/RUNNING.md`. The short version:

```bash
npm install                    # at the ROOT — it's a workspace
cp backend/.env.example backend/.env    # then add GEMINI_API_KEY
npm run dev                    # starts backend :4000 + frontend :5173
```

Open **:5173**, never :4000 — Vite proxies `/api` to the backend, which is why the frontend's API
client uses a bare relative `/api` path and why there are no CORS issues in dev.

Verify with `curl http://localhost:4000/health`.

Set `VISION_PROVIDER=mock` to run the whole pipeline offline with no API key — useful for frontend
work and for tests.

---

## Conventions

- **TypeScript strict everywhere** (NFR-13). All three packages have `"strict": true`. Avoid `any`;
  if unavoidable, comment why (Definition of Done requires this).
- **Integrations are always optional** (FR-28, FR-35). Jira or GitHub failing must never break
  classification — catch, log, continue. The tool has to work with only a Gemini key.
- **Env vars are read at call time, never at module load.** See gotchas below.
- Services throw `Error` with actionable messages; routes convert to HTTP status codes (NFR-09).
- Storage is JSON files on disk, no database. Layout is specified in REQUIREMENTS §10.1 — keep to it.

---

## Gotchas that have already bitten

These are real bugs that were found and fixed here. Don't reintroduce them.

**1. `import './env'` must be the first import in `index.ts`.**
CommonJS hoists all `require`s above statements, so calling `dotenv.config()` inline would run
*after* every service module body has already evaluated. That's why `env.ts` exists as its own
module, and why services read `process.env` inside functions rather than at module top level.

**2. Never read `req.body` in a multer `destination`/`filename` callback.**
Multer streams fields in the order the client wrote them. Both the dashboard and the Playwright
service append the image files *before* `run_id`, so `req.body.run_id` is always `undefined` at
destination time. This silently scattered uploads into random UUID folders while results were
written under the real run id — so `GET /api/screenshots/:runId/before` 404'd on every single run,
while `diff` worked fine. Files are now staged in `uploads/.staging/` and moved into
`uploads/{run_id}/` after parsing.

**3. Jimp's `.write()` is fire-and-forget.** Use `.writeAsync()` and await it. The old code called
`.write()` then immediately `fs.readFileSync`'d the result — a race that would intermittently read a
truncated or absent file.

**4. A fresh `run_id` per comparison, not per session.** The dashboard used to mint one id for the
whole session, so a second comparison overwrote the first's diff and every card but the newest
displayed the wrong images. Run ids are the storage key.

**5. Gemini model names go stale.** REQUIREMENTS §7.1 specifies `gemini-2.0-flash`; Google has since
retired both it and `gemini-2.5-flash` for newly issued keys, and they now return 404. The default
is `gemini-3.6-flash`, overridable via `GEMINI_MODEL`. If classification suddenly 404s, list what
the key can serve:
`curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$KEY" | grep '"name"'`

**6. Gemini 3.x spends "thinking" tokens from `maxOutputTokens`.** The original 500-token budget
truncated the JSON mid-object, surfacing as a confusing parse error. It's 2048 now, the request sets
`responseMimeType: 'application/json'`, and a `MAX_TOKENS` finish reason raises a named error rather
than failing at the parse.

**7. Response text can span multiple parts.** Join every `parts[].text`; taking `parts[0]` alone can
return an empty or partial string on thinking models.

**8. `run_id` is interpolated into filesystem paths.** Both `compare.ts` and `screenshots.ts` guard
it with `/^[A-Za-z0-9_-]{1,128}$/`. Keep the two in sync — an id that can be stored but not served
breaks the dashboard's images. `sessionManager.ts` exports the same regex as `SAFE_ID`, because live
run ids derive from session ids.

**9. Headed Chromium does not composite non-foreground windows.** With two live panes streaming at
once, one would simply freeze — and it looks exactly like a bug in the streaming code, not like a
browser policy. `browserPool.ts` launches `headless: true` plus four `--disable-*` args. Never call
`page.bringToFront()`: it starves the other pane. The live probe's assertion #2 exists solely to
catch a regression here.

**10. Frames emitted before the client joins its Socket.IO room are lost forever.** A static page
composites once, on load; if that frame is dropped the pane sits blank until the user happens to
interact with it, which reads as "live mode is broken". `socket.ts` joins the room *before*
`session.open()`, and `LivePane.nudgeFrame()` forces a composite after every (re)attach.

**11. Socket.IO does not await your handlers.** Handlers fire in receipt order but run concurrently,
so a `text` payload could reach CDP before the `mousedown` that focuses the field it belongs to —
the click looks fine and the typing lands nowhere. `LivePane.dispatchInput` serialises per pane
through a promise chain.

**12. `ws: true` on the Vite proxy is mandatory.** Without it the upgrade request 404s and Socket.IO
silently falls back to long-polling, which works — badly, at maybe 3 fps.

**13. `ts-node-dev --respawn` kills live sessions on every save.** For live-mode work run
`cd backend && npm run build && npm start` instead of `npm run dev`.

---

## Known gaps against the spec

Resolved (2026-08-15) by a probe-test → compare-against-REQUIREMENTS.md → fix loop:
test suite now exists (`backend/jest.config.js` + `*.test.ts` next to each service, 34 tests,
`npm test` at root runs it); `severityToPriority`/`severityToLabel` are exported; FR-08 basic auth
is wired via Playwright's `httpCredentials` (see `playwright-service/src/capture.ts`); NFR-07
per-page try/catch means one bad page no longer kills the run — it's recorded as a `NEEDS_REVIEW`
entry instead; the dashboard's "AI Ready" badge now calls `getIntegrationStatus()`; Jira links use
a real `jira_url` the backend builds from `JIRA_BASE_URL` (`jiraService.ts#jiraIssueUrl`) instead of
`href="#"`; the CI PR comment now includes a per-page table with Jira/GitHub issue links (FR-34) —
previously `commentOnPR()` in `githubService.ts` built this but nothing ever called it; the junk
`{frontend/...}` directory at the repo root is gone.

Be aware these are still *not* done:

- **Image normalization stretches rather than pads.** When before/after differ in size,
  `normalizeImageSize` resizes to the max dimensions, distorting content and inflating the diff
  percentage. REQUIREMENTS FR-13 says "auto-resize", so this matches the letter of the spec, but
  padding would produce far more meaningful diffs for full-page screenshots of differing height.
  Left as-is: fixing it changes diff-percentage semantics for every existing run, which is a product
  decision, not a bug fix.
- **FR-45 (run history page) and FR-09 (mobile viewport presets) are Could-Have and unimplemented.**
  Per-page `viewport` overrides already exist in `CaptureConfig`, so FR-09 is achievable via config
  today without new code.
- **Live mode's UI interactions have never been verified by a human.** The socket protocol, capture
  pipeline, guardrails, and frame delivery are proven headlessly by `test/probe/live-probe.mjs`
  (10/10) and `test/probe/guardrails-probe.mjs` (6/6), but WEB_APP_REGRESSION_PLAN §9 step 6 (the
  click-through: focus ring, per-pane typing, cookie isolation across a reload, F5 reattach) and
  §9 step 8 (a real staging/SSO login) still need a QA engineer. FR-72 (dialogs), FR-73 (SSO popup
  adoption), and FR-74 (reattach) are implemented but **only** covered by manual acceptance.

---

## Working here

- Run `npm run typecheck` at the root to check all three packages.
- After editing backend source, rebuild (`cd backend && npm run build`) if running from `dist/`;
  `npm run dev` uses ts-node-dev and reloads on its own.
- On Windows, `pkill` won't stop the backend. Use:
  `Get-NetTCPConnection -LocalPort 4000 -State Listen | Select -Expand OwningProcess -Unique | ForEach { Stop-Process -Id $_ -Force }`
  That force-kill skips the shutdown handlers, so it can orphan browsers. Playwright's process is
  named **`chrome-headless-shell`**, not `chrome`:
  `Get-Process | Where-Object { $_.Path -like '*ms-playwright*' } | Stop-Process -Force`
- Live-mode probes need a running backend and the fixture servers; they are **not** jest tests:
  `node test/probe/live-probe.mjs` and `node test/probe/guardrails-probe.mjs`
  (both accept `BACKEND=http://127.0.0.1:PORT`).
- `uploads/`, `results/`, and `screenshots/` are gitignored scratch space — delete them freely.
- **Never commit `backend/.env`** (SEC-01/SEC-02). It's gitignored; keep it that way. Ensure the file
  ends with a newline, or appending a variable will silently corrupt the last value.
