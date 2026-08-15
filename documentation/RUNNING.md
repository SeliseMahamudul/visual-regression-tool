# Visual Regression AI Tool

**Audience:** QA engineers and developers running this tool on their own machine.
**Companion docs:** [`REQUIREMENTS.md`](./REQUIREMENTS.md) (what the tool must do), [`../README.md`](../README.md) (project overview).

---

## Table of Contents

1. [What you need first](#1-what-you-need-first)
2. [One-time setup](#2-one-time-setup)
3. [Starting the app (backend + frontend)](#3-starting-the-app-backend--frontend)
4. [Your first comparison](#4-your-first-comparison)
5. [How the run flow actually works](#5-how-the-run-flow-actually-works)
6. [The automated Playwright pipeline](#6-the-automated-playwright-pipeline)
7. [Where files end up on disk](#7-where-files-end-up-on-disk)
8. [Configuration reference](#8-configuration-reference)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. What you need first

| Requirement | Version | Check with |
|-------------|---------|-----------|
| Node.js | 20 or newer | `node -v` |
| npm | 9 or newer | `npm -v` |
| A Gemini API key | free tier is fine | see below |

**Getting a Gemini API key** — go to <https://aistudio.google.com>, sign in with a Google
account, click **Get API key**. No billing setup or credit card is required. The free tier
allows 15 requests/minute and 1,500/day, which is far more than local testing needs.

> **Note on the model.** `REQUIREMENTS.md` §7.1 specifies `gemini-2.0-flash`. Google has since
> retired that model — and `gemini-2.5-flash` after it — for newly issued API keys, and both now
> return HTTP 404. The backend defaults to **`gemini-3.6-flash`** instead. If your key serves a
> different set of models, override it with `GEMINI_MODEL` in `backend/.env` (see §8). To list
> what your own key can actually serve:
>
> ```bash
> curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY" \
>   | grep '"name"'
> ```

---

## 2. One-time setup

### Install dependencies

From the repository root (`visual-regression-tool/`):

```bash
npm install
```

This is an npm **workspace** — one install at the root covers `frontend/`, `backend/`, and
`playwright-service/`. You do not need to install in each folder separately.

### Create your environment file

The backend reads its configuration from `backend/.env`, which is **not** committed to git.
Create it by copying the template:

```bash
cp backend/.env.example backend/.env
```

Then open `backend/.env` and set your key:

```ini
GEMINI_API_KEY=AIza...your_actual_key
```

**The only required variable is `GEMINI_API_KEY`.** Everything else has a working default, and
the Jira and GitHub integrations are entirely optional — the tool runs fully without them.

> ⚠️ **Two gotchas that will cost you time.** First, make sure the file ends with a newline;
> appending another variable to a file without one silently glues it onto the end of your key.
> Second, write the value bare — no quotes, no spaces around the `=`.

### Install the Chromium browser (needed for automated capture and for Live mode)

Skip this only if you plan to upload screenshots by hand through the dashboard and never use
**Compare Live**.

```bash
npx playwright install chromium
```

This downloads roughly 150 MB the first time and takes a few minutes. One download serves both
`playwright-service` and the backend's live mode — Playwright shares a browser cache per machine.

---

## 3. Starting the app (backend + frontend)

### The easy way — both at once

From the repository root:

```bash
npm run dev
```

This uses `concurrently` to start both servers in one terminal. You'll see interleaved output
from each. Press `Ctrl+C` once to stop both.

### The explicit way — two terminals

Useful when you want clean, separated logs, or when you're debugging one side.

**Terminal 1 — backend:**

```bash
cd backend
npm run dev
```

Wait for the startup banner. It tells you exactly which integrations are live:

```
🚀 Visual Regression Backend running on http://localhost:4000
📊 Gemini AI: ✅ Configured
🔗 Jira:      ⚠️  Not configured
🐙 GitHub:    ⚠️  Not configured
```

If Gemini shows ❌, your `.env` is missing or the key line is malformed — fix it before going on,
because every comparison will fail at the AI step.

**Terminal 2 — frontend:**

```bash
cd frontend
npm run dev
```

```
VITE v5.4.21  ready in 3032 ms
➜  Local:   http://localhost:5173/
```

### Confirm both are healthy

```bash
curl http://localhost:4000/health
```

```json
{"status":"ok","version":"1.0.0","env":{"gemini":true,"jira":false,"github":false}}
```

**Then open <http://localhost:5173> in your browser.**

### Why you always open port 5173, never 4000

The React dev server is the only thing you visit directly. Vite proxies every request beginning
with `/api` through to the backend on port 4000 (configured in `frontend/vite.config.ts`):

```
Browser ──▶ localhost:5173 ──▶ Vite dev server
                                 ├── / and /assets/*  → serves the React app
                                 └── /api/*           → proxies to localhost:4000
```

This is why the frontend's API client uses the bare relative path `/api` with no hostname. It also
means you never hit a CORS problem in development, because as far as the browser is concerned
everything came from a single origin. Opening `localhost:4000` directly just gives you the API,
with no user interface.

---

## 4. Your first comparison

1. Open <http://localhost:5173>.
2. Type a name into **Page / Component Name** — e.g. `Home Page`. This is what appears on the
   result card and in any bug ticket that gets filed.
3. Drag a baseline screenshot into the left dropzone (**Before**), and the new build's screenshot
   into the right one (**After**). Clicking a dropzone opens a file picker if you prefer. PNG, JPG,
   and WebP are all accepted, up to 10 MB each.
4. Click **🔍 Run Visual Regression Analysis**.
5. The button switches to a spinner reading *Running AI Analysis…*. Expect a verdict in roughly
   3–10 seconds.
6. A result card appears with the AI's classification, and a toast notification fires in the corner.

**Reading the result card:**

| Element | Meaning |
|---------|---------|
| Coloured badge | `BUG`, `INTENTIONAL_CHANGE`, `DYNAMIC_CONTENT`, or `NEEDS_REVIEW` |
| Severity | `critical`, `medium`, `low`, or `none` |
| `NN.NN% diff` pill | Share of pixels that changed — pure arithmetic, no AI involved |
| Confidence | How sure the model is, 0–100 |
| **AI Explanation** | Plain-English description of what changed |
| **Recommended Action** | What the AI suggests you do next |

Below that sits the screenshot viewer with four tabs — **Side by Side**, **Diff View** (changed
pixels highlighted in red), **Before**, and **After**. Cards for bugs and items needing review
start expanded; clean results start collapsed.

The stats bar across the top tallies every comparison in the session: total tested, bugs, needs
review, and clean.

### A tip on interpreting results

The diff percentage and the AI classification answer two different questions, and it's the
combination that's informative. A large diff with an `INTENTIONAL_CHANGE` verdict is a redesign
working as intended. A *small* diff with a `BUG` verdict — a few hundred pixels where a button
label got truncated — is exactly the kind of thing pixel-only tools bury in noise, and is the
whole reason the AI layer exists.

---

## 5. How the run flow actually works

Here is what happens between clicking the button and seeing a verdict.

```
┌──────────────────────────────────────────────────────────────────────┐
│ BROWSER  (localhost:5173)                                            │
│                                                                      │
│  UploadForm.tsx                                                      │
│    two File objects + page name + auto-file settings                 │
│         │                                                            │
│         ▼  App.tsx handleCompare()  — mints a fresh run_id           │
│  api/client.ts  →  multipart POST /api/compare                       │
└─────────┬────────────────────────────────────────────────────────────┘
          │  Vite proxies /api → :4000
          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ BACKEND  (localhost:4000)                                            │
│                                                                      │
│  helmet → cors → rate limiter (100 req / 15 min)                     │
│         │                                                            │
│         ▼                                                            │
│  routes/compare.ts                                                   │
│    1. multer accepts both files                                      │
│         · rejects anything not PNG / JPEG / WebP                     │
│         · rejects anything over 10 MB                                │
│         · stages them, then moves into uploads/{run_id}/             │
│    2. 400 if either image is missing                                 │
│         │                                                            │
│         ▼                                                            │
│  services/pixelDiff.ts        ← no AI, pure computation              │
│    · transcodes to PNG if needed                                     │
│    · resizes to matching dimensions if they differ                   │
│    · pixelmatch → red-highlighted diff image                         │
│    · returns changed-pixel count and percentage                      │
│         │                                                            │
│         ▼                                                            │
│  services/aiClassification.ts                                        │
│    · picks a provider (services/visionProvider.ts)                   │
│    · sends prompt + before + after + diff, base64-encoded            │
│    · retries 429 / 5xx with exponential backoff + jitter             │
│    · parses and validates the JSON verdict                           │
│         │                                                            │
│         ▼                                                            │
│  auto-file bugs?   (only when enabled AND verdict is BUG)            │
│    · services/jiraService.ts    → ticket + 3 screenshot attachments  │
│    · services/githubService.ts  → issue + auto-created labels        │
│    · a failure here is logged, never fatal                           │
│         │                                                            │
│         ▼                                                            │
│  write results/{run_id}/{result_id}.json                             │
│  respond with the verdict + three screenshot URLs                    │
└─────────┬────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ BROWSER                                                              │
│  ResultCard renders the verdict; a toast fires                       │
│  ScreenshotViewer requests the three images back through             │
│  GET /api/screenshots/{run_id}/{before|after|diff}                   │
└──────────────────────────────────────────────────────────────────────┘
```

### The two-stage design, and why it matters

The pipeline deliberately separates **measurement** from **judgement**.

`pixelmatch` answers *what* changed with complete precision and zero interpretation — it counts
pixels. It cannot tell you whether a shifted button is a bug or a redesign, which is precisely why
traditional pixel-diff tools generate so much noise: every dynamic timestamp and anti-aliasing
wobble trips the same alarm as a genuinely broken layout.

The AI stage answers *whether it matters*. It receives all three images — before, after, and the
red-highlighted diff — so it can see both the raw change and where attention should go. The diff
image is what lets a vision model reason about a subtle change it might otherwise skim past.

Because the diff is computed before the AI is consulted, the percentage on the result card is
always exact and always available, even when the AI call fails.

### Endpoints the backend exposes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/compare` | Main pipeline. Multipart: `before`, `after`, `run_id`, `page_name`, `auto_file_bugs`, plus optional Jira/GitHub fields |
| `GET` | `/api/compare/results/:runId` | Every stored result for a run |
| `GET` | `/api/screenshots/:runId/:type` | Serves `before`, `after`, or `diff` as PNG |
| `GET` | `/api/integrations/status` | Live health of Gemini, Jira, GitHub |
| `GET` | `/health` | Liveness plus which integrations are configured |

---

## 6. The automated Playwright pipeline

Everything above assumes you're uploading screenshots by hand. The Playwright service instead
captures them itself, by visiting two deployments of your app and comparing them page by page.

### Write a config file

Start from `docs/vr-config.example.json`. Create `vr-config.json` in the repo root:

```json
{
  "base_url_before": "https://staging.your-app.com",
  "base_url_after":  "https://preview-pr-42.your-app.com",
  "backend_url": "http://localhost:4000",
  "run_id": "local-run-001",
  "output_dir": "./screenshots",
  "auto_file_bugs": false,
  "default_viewport": { "width": 1280, "height": 800 },
  "pages": [
    { "name": "Home Page", "path": "/", "wait_ms": 1000 },
    { "name": "Login",     "path": "/login", "wait_for_selector": "form" },
    { "name": "Dashboard", "path": "/dashboard", "wait_ms": 1500 }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `base_url_before` | Baseline deployment — usually staging or production |
| `base_url_after` | The build under test — usually a PR preview |
| `pages[].path` | Appended to both base URLs, so each page is fetched from both |
| `wait_for_selector` | Blocks capture until this selector exists — use for async content |
| `wait_ms` | Flat pause after load; a blunter alternative to the above |
| `viewport` | Per-page override of `default_viewport` |
| `auto_file_bugs` | When `true`, `BUG` verdicts open Jira tickets and GitHub issues |

### Run it

**The backend must already be running** — the capture service submits to it over HTTP.

```bash
cd playwright-service
VR_CONFIG=../vr-config.json npm run capture
```

On Windows PowerShell:

```powershell
cd playwright-service
$env:VR_CONFIG="../vr-config.json"; npm run capture
```

For each page in the config it opens the before URL, screenshots the full page, opens the after
URL, screenshots that, and submits the pair to `/api/compare` — the same endpoint the dashboard
uses. Before each capture it injects CSS that hides timestamps, avatars, ad iframes, and live
counters, which removes the most common sources of false positives at the source.

Output looks like:

```
▶ Processing: Home Page
  📸 Capturing: https://staging.your-app.com/
  📸 Capturing: https://preview-pr-42.your-app.com/
  🤖 Submitting to AI for analysis...
  🐛 BUG [critical] — Navigation Bar
     The primary navigation links have disappeared in the after screenshot.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 VISUAL REGRESSION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Pages: 3
Issues Found: 1
Clean: 2
```

A machine-readable `summary.json` is written to `output_dir` alongside the PNGs.

### Exit codes — this is the CI gate

| Code | Condition | CI result |
|------|-----------|-----------|
| `0` | No issues, or only intentional/dynamic changes | ✅ passes |
| `0` | Non-critical bugs found | ⚠️ passes with warning |
| `1` | At least one **critical** bug | ❌ fails |

`.github/workflows/visual-regression.yml` wires this into pull requests: it runs capture with
`continue-on-error`, uploads the screenshots as a 30-day artifact, posts a summary comment on the
PR, and then fails the job if the capture step reported a critical regression.

---

## 7. Where files end up on disk

```
backend/
  uploads/
    .staging/                  ← transient; files land here mid-upload
    {run_id}/
      before_{timestamp}.png
      after_{timestamp}.png
  results/
    {run_id}/
      {run_id}_diff.png        ← the red-highlighted diff
      {result_id}.json         ← full verdict record

playwright-service/ (or output_dir)
  screenshots/
    {page_name}_before.png
    {page_name}_after.png
    summary.json
```

No database is involved — every run is JSON on disk, which makes results trivial to inspect,
diff, and delete. A stored result looks like this:

```json
{
  "id": "84f1a10f-31ce-4b7e-a525-e779739c228a",
  "run_id": "runA",
  "page_name": "Home Page",
  "before_screenshot": "…/uploads/runA/before_1786703643489.png",
  "after_screenshot":  "…/uploads/runA/after_1786703643489.png",
  "diff_screenshot":   "…/results/runA/runA_diff.png",
  "classification": {
    "classification": "BUG",
    "severity": "medium",
    "component": "Header Bar",
    "explanation": "Top dark header bar is missing completely in the updated interface.",
    "recommended_action": "File a bug report to inspect header component rendering.",
    "confidence": 73,
    "diff_percentage": 13.333333333333334
  },
  "created_at": "2026-08-14T10:32:07.331Z"
}
```

`uploads/` and `results/` are both gitignored. Nothing is cleaned up automatically — delete the
folders freely between runs; they are rebuilt on demand.

---

## 8. Configuration reference

All of these live in `backend/.env`.

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `GEMINI_API_KEY` | ✅ | — | From <https://aistudio.google.com> |
| `GEMINI_MODEL` | | `gemini-3.6-flash` | Override if your key serves a different model |
| `VISION_PROVIDER` | | `gemini` | `gemini` or `mock` — see below |
| `PORT` | | `4000` | Backend port |
| `FRONTEND_URL` | | `http://localhost:5173` | Sole allowed CORS origin |
| `UPLOADS_DIR` | | `./uploads` | Where screenshots are stored |
| `RESULTS_DIR` | | `./results` | Where diffs and verdicts are stored |
| `DIFF_THRESHOLD` | | `0.1` | pixelmatch sensitivity, 0–1. Lower catches more |
| `AI_MAX_RETRIES` | | `3` | Retry attempts on 429/5xx |
| `AI_RETRY_BASE_MS` | | `1000` | Backoff base delay |
| `VR_PROJECT_CONTEXT` | | — | Free text appended to the AI prompt |
| `JIRA_BASE_URL` | | — | e.g. `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | | — | Your Atlassian account email |
| `JIRA_API_TOKEN` | | — | From id.atlassian.com → API tokens |
| `GITHUB_TOKEN` | | — | PAT with `repo` scope |

### Running without a Gemini key

Setting `VISION_PROVIDER=mock` swaps in an offline provider that classifies purely from the diff
percentage, never touching the network. It's useful for demos, for exercising the pipeline in CI
without burning quota, and for frontend work where you only need *some* verdict to render.

Its verdicts are heuristic, not intelligent, and every explanation says so — you will not mistake
one for a real AI result.

### Tuning the AI

`VR_PROJECT_CONTEXT` is appended to the classification prompt, and is the intended lever for
reducing false positives on your specific app:

```ini
VR_PROJECT_CONTEXT=The dashboard header shows a live user count that changes constantly — always treat it as DYNAMIC_CONTENT. We are mid-migration to a new design system, so colour and spacing shifts on buttons are expected.
```

The prompt itself lives in `backend/src/services/visionPrompt.ts`, isolated from all transport
code so it can be edited without touching anything else.

### Swapping the AI provider

`backend/src/services/visionProvider.ts` is the single file to change. A provider is just a
function taking three image paths and returning the model's raw text; register a new one in the
`PROVIDERS` map and select it with `VISION_PROVIDER`. The prompt, the retry policy, and the
response validation are shared, so a new provider only needs its own HTTP call.

---

## 9. Troubleshooting

### `❌ Missing GEMINI_API_KEY` on startup

`backend/.env` doesn't exist, or the key line is malformed. It must be a bare `KEY=value` with no
quotes and no spaces around the `=`. Restart the backend after editing — `.env` is read only at
startup.

### `AI provider returned 404 — the configured model was not found`

Google has retired the model for newly issued keys. List what yours can serve:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY" | grep '"name"'
```

Pick a `*-flash` model from that list and set `GEMINI_MODEL` in `backend/.env`.

### `EADDRINUSE: address already in use :::4000`

An earlier backend is still running. On Windows:

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

On macOS or Linux: `lsof -ti:4000 | xargs kill -9`

### The dashboard loads but every comparison fails

Check that the backend is actually up (`curl http://localhost:4000/health`). The dashboard is
served by Vite and will render perfectly well with the backend down — the failure only surfaces
when you submit. The error toast carries the backend's own message, which usually names the cause.

### Screenshots show as broken images

The diff renders but before/after don't, or vice versa. Check that `run_id` contains only letters,
digits, hyphens, and underscores — the serving route rejects anything else with a 400, since run
ids are interpolated into filesystem paths.

### `Vision model hit the output token limit`

The model spent its budget on internal reasoning before finishing its JSON. Raise
`maxOutputTokens` in `backend/src/services/visionProvider.ts`, or switch `GEMINI_MODEL` to a
non-thinking model.

### Playwright: `Executable doesn't exist`

The browser binary was never downloaded:

```bash
cd playwright-service && npx playwright install chromium
```

### Rate limited by your own backend

The API allows 100 requests per 15 minutes per IP, to protect the Gemini free tier. Restarting the
backend resets the counter.

### Capture fails on pages behind a login

For the **automated** pipeline, `wait_for_selector` handles async rendering but not sign-in flows.
Set `auth.username`/`auth.password` in the config for HTTP basic auth, or use **Compare Live** and
log in by hand.

---

## 10. Compare Live — two live environments side by side

The workflow this exists for: *"Stage is my baseline. I just upgraded Angular on dev and it broke
some alignment. I want to open both, log in, navigate to the page I care about, click one button,
and see the regression."*

### Using it

1. Start the app normally (`npm run dev`) and open <http://localhost:5173>.
2. Switch the header toggle from **Upload** to **Compare Live**.
3. Enter the two URLs — *Reference / stage* and *Candidate / dev* — and click **Start live session**.
   Both applications appear as interactive panes inside the dashboard.
4. Click into a pane and use it with your own mouse and keyboard. The two panes are fully
   independent: separate browser contexts, separate cookies, separate navigation. Log into each as a
   different user if you want; neither affects the other.
5. Bring both panes to the page you care about, type a page name, and click **Compare**. Both panes
   are captured and run through the existing diff + AI classification pipeline; the result appears as
   a normal result card below.

Credentials you type go straight into the page over the socket. **Nothing is stored and nothing is
logged.** If an environment uses HTTP *basic* auth, supply it in the start form instead — a basic-auth
prompt is a native browser dialog and will never appear inside a pane.

### Known limitations

- Native `<select>` dropdowns, date pickers, autofill, and the OS context menu are widgets drawn
  outside the page surface, so they do not render. Click the control, then use the arrow keys and
  Enter — those are dispatched into the renderer and do work.
- File inputs are out of scope for v1.
- Expect a little input lag. This is a comparison tool, not a remote desktop.
- Very tall full-page captures are refused above 12 000 px rather than silently truncated by
  Chromium's texture limit. Use viewport-only capture for infinite-scroll pages.

### Live-mode settings

All optional; see `backend/.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `LIVE_MAX_SESSIONS` | `3` | Concurrent session cap. Each session is two browser contexts, ~300–600 MB |
| `LIVE_IDLE_TIMEOUT_MS` | `900000` | Idle sessions are reaped after 15 minutes |
| `LIVE_DETACH_GRACE_MS` | `60000` | How long a session survives a dashboard reload |
| `LIVE_SCREENCAST_QUALITY` | `60` | JPEG quality of the live stream. Does not affect the captured PNG |
| `LIVE_VIEWPORT_WIDTH` / `_HEIGHT` | `1280` / `800` | Default pane viewport |
| `LIVE_URL_ALLOWLIST` | *(empty)* | Comma-separated host globs, e.g. `*.stage.corp,localhost`. Empty allows any http(s) host |
| `BIND_HOST` | `127.0.0.1` | **SEC-11.** The backend binds to loopback. Changing this exposes browser control to your network |

### Live-mode troubleshooting

**Sessions die every time you save a file.** `npm run dev` runs the backend under
`ts-node-dev --respawn`, which restarts on every change to `src/` and takes your logged-in sessions
with it. For live-mode work, run the compiled build instead:

```bash
cd backend && npm run build && npm start
```

**Panes render but at a few frames per second.** The Vite proxy is missing `ws: true`, so the
WebSocket upgrade 404'd and Socket.IO fell back to long-polling. Check
`frontend/vite.config.ts`.

**Orphaned browser processes on Windows.** The `Stop-Process -Force` recipe skips the shutdown
handlers. Playwright's process is called `chrome-headless-shell`, *not* `chrome`:

```powershell
Get-Process | Where-Object { $_.Path -like '*ms-playwright*' } | Stop-Process -Force
```

**`Could not launch Chromium for live mode`.** Run `npx playwright install chromium` from the repo
root.
