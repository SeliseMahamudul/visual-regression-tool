# 👁️ Visual Regression AI Tool

An AI-powered visual regression testing platform that compares UI screenshots, classifies changes using **Google Gemini Flash** (free), auto-captures with **Playwright**, integrates with **Jira** and **GitHub**, and runs on every PR via **GitHub Actions CI/CD**.

Two ways to feed it screenshots: upload before/after PNGs by hand, or open **Compare Live** and drive
two real environments — stage vs. dev, side by side, inside the dashboard — then capture both with one
click. Either way, an **expectation chatbot** lets you tell the AI in plain English what you meant to
change, so a deliberate redesign doesn't come back labelled a critical bug.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Actions CI/CD                     │
│  PR opened → Playwright captures before/after → Backend API  │
│  → Gemini AI classifies → Jira/GitHub issues auto-filed      │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌─────────────┐  ┌──────────────┐  ┌───────────────┐
    │  React +TS  │  │  Node.js +TS │  │  Playwright   │
    │  Frontend   │  │  Backend API │  │  Screenshot   │
    │  Dashboard  │  │  :4000       │  │  Service      │
    └─────────────┘  └──────────────┘  └───────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌─────────────┐  ┌──────────────┐  ┌───────────────┐
    │  pixelmatch │  │ Gemini Flash │  │ Jira + GitHub │
    │  Pixel Diff │  │  (Free API)  │  │  Integration  │
    └─────────────┘  └──────────────┘  └───────────────┘
```

The diagram above is the original CI-triggered path. Two more ways into the same pipeline:

- **Compare Live** — the backend also runs a headless Playwright `Browser` in-process and streams two
  panes to the dashboard over a `/live` Socket.IO namespace (CDP screencast in, input events out).
  Capturing both panes calls the exact same `runComparison()` function `/api/compare` uses, so results
  from either path look identical downstream.
- **Expectation chatbot** — a second, independently-configurable text model (`textProvider.ts`:
  Groq / Ollama / offline mock) turns a plain-English description into structured rules that get
  layered onto the Gemini Flash prompt for one comparison, deliberately kept off the vision model's
  rate-limit budget.

---

## 📁 Project Structure

```
visual-regression-ai/
├── frontend/                   # React + TypeScript dashboard
│   └── src/
│       ├── components/
│       │   ├── UploadForm.tsx          # Drag-and-drop screenshot upload
│       │   ├── ExpectationChat.tsx     # Chat panel — extracts ExpectationRules
│       │   ├── ResultCard.tsx          # AI result display card
│       │   ├── ScreenshotViewer.tsx    # Before/After/Diff viewer
│       │   ├── ClassificationBadge.tsx # Bug/Intentional/Dynamic badge
│       │   └── live/                   # Compare Live: panes, toolbar, capture bar
│       ├── live/                       # Socket.IO client, frame renderer, input mapping
│       ├── api/client.ts               # Axios API client
│       ├── types/{index,live}.ts       # Shared TypeScript types
│       └── App.tsx                     # Main dashboard — Dashboard / Compare Live tabs
│
├── backend/                    # Node.js + TypeScript API
│   └── src/
│       ├── routes/
│       │   ├── compare.ts              # POST /api/compare (main endpoint)
│       │   ├── chat.ts                 # POST /api/chat (expectation extraction)
│       │   ├── screenshots.ts          # GET /api/screenshots/:runId/:type
│       │   └── integrations.ts         # GET /api/integrations/status
│       ├── services/
│       │   ├── aiClassification.ts     # Gemini Flash vision AI
│       │   ├── visionPrompt.ts         # Classification prompt + expectation injection
│       │   ├── textProvider.ts         # Chat model: groq / ollama / mock
│       │   ├── comparisonRunner.ts     # The diff→classify→file pipeline, shared by
│       │   │                           #   /api/compare AND Compare Live
│       │   ├── pixelDiff.ts            # pixelmatch diff generation
│       │   ├── jiraService.ts          # Jira REST API integration
│       │   └── githubService.ts        # GitHub API integration
│       ├── live/                       # Compare Live: browser pool, panes, sessions,
│       │                               #   Socket.IO handlers, URL guard (SSRF defence)
│       └── index.ts                    # Express + Socket.IO server entry
│
├── playwright-service/         # Playwright screenshot automation (CI path)
│   └── src/
│       └── capture.ts                  # Auto-capture + submit to backend
│
├── test/
│   ├── fixtures/                       # stage/dev pages + PNGs used by probes & CI
│   └── probe/                          # Headless end-to-end scripts (live mode, expectations)
│
├── .github/
│   └── workflows/
│       └── visual-regression.yml       # GitHub Actions CI/CD pipeline
│
└── docs/
    └── vr-config.example.json          # Example page capture config
```

---

## 🚀 Running Locally

> Full walkthrough — including the request flow, config reference, and troubleshooting — lives in
> [`documentation/RUNNING.md`](./documentation/RUNNING.md). This is the short version.

### Prerequisites

| Requirement | Version | Check with | Notes |
|-------------|---------|-----------|-------|
| Node.js | 20 or newer | `node -v` | |
| npm | 9 or newer | `npm -v` | Ships with Node 20 |
| Google Gemini API key | free tier | — | Optional — see [mock mode](#running-without-an-api-key) |
| Chromium for Playwright | — | — | Needed for automated capture and for Compare Live; not needed for the plain upload flow |

**Getting a Gemini API key:** sign in at [aistudio.google.com](https://aistudio.google.com) and click
**Get API key**. No billing or credit card required. The free tier allows 15 requests/minute and
1,500/day, which is far more than local testing needs.

### 1. Clone & install

```bash
git clone https://github.com/SeliseMahamudul/visual-regression-tool.git
cd visual-regression-tool
npm install
```

This is an npm **workspace** — a single `npm install` at the repo root covers
`frontend/`, `backend/`, and `playwright-service/`. Do not install inside each folder separately.

### 2. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Then edit `backend/.env` and set your key:

```ini
GEMINI_API_KEY=AIza...your_actual_key    # the only required variable
```

Everything else has a working default, and Jira/GitHub are entirely optional — the tool runs fully
without them. That includes the expectation chatbot (`CHAT_PROVIDER` defaults to `mock`, offline, no
key) and Compare Live (works with just the backend and Chromium installed — see the **Compare Live**
section further down).

> ⚠️ Write the value bare — no quotes, no spaces around the `=` — and make sure the file ends with a
> newline, or appending another variable will silently glue it onto the end of your key.

### 3. Start both servers

```bash
npm run dev        # backend :4000 + frontend :5173, in one terminal
```

Or run them separately for cleaner logs:

```bash
cd backend  && npm run dev     # terminal 1
cd frontend && npm run dev     # terminal 2
```

The backend prints a banner telling you which integrations are live:

```
🚀 Visual Regression Backend running on http://localhost:4000
📊 Gemini AI: ✅ Configured
🔗 Jira:      ⚠️  Not configured
🐙 GitHub:    ⚠️  Not configured
```

If Gemini shows ❌, fix `.env` before going further — every comparison will fail at the AI step.
`.env` is read only at startup, so restart the backend after editing it.

### 4. Verify and open

```bash
curl http://localhost:4000/health
# {"status":"ok","version":"1.0.0","env":{"gemini":true,"jira":false,"github":false},"live":0}
```

`live` is the count of active Compare Live sessions — 0 until you open one.

**Open [http://localhost:5173](http://localhost:5173)** — never :4000. Vite serves the dashboard and
proxies `/api/*` through to the backend, which is why the frontend uses a bare relative `/api` path
and why there are no CORS issues in development. Port 4000 on its own is just the API, no UI.

Upload a before and an after screenshot, give the page a name, and click **Run Visual Regression
Analysis**. Expect a verdict in roughly 3–10 seconds.

### Running without an API key

```ini
VISION_PROVIDER=mock
```

Swaps in an offline provider that classifies from the diff percentage alone and never touches the
network. Useful for demos, frontend work, and CI runs that shouldn't burn quota. Verdicts are
heuristic, not intelligent, and every explanation says so.

### Optional: automated Playwright capture

Only needed if you want the tool to capture screenshots itself rather than uploading them by hand.

```bash
cd playwright-service && npx playwright install chromium   # ~150 MB, first time only
```

Copy `docs/vr-config.example.json` to `vr-config.json` at the repo root and point it at your two
deployments, then — **with the backend already running** —

```bash
cd playwright-service
VR_CONFIG=../vr-config.json npm run capture
```

On Windows PowerShell:

```powershell
cd playwright-service
$env:VR_CONFIG="../vr-config.json"; npm run capture
```

---

## 🖥️ Compare Live — two real environments, side by side

Instead of producing screenshots elsewhere and uploading them, **Compare Live** opens two real,
interactive browser panes *inside* the dashboard. You log in and navigate each one yourself — they
never mirror each other — then capture both with one click and the result runs through the same
pixel-diff + AI pipeline as the upload flow.

```
cd C:\Projects\visual-regression-tool
npx playwright install chromium   # one-time, ~150 MB — same browser the upload/CI paths already need
npm run dev
```

Open the dashboard, switch to the **Compare Live** tab, and enter your two URLs (e.g. stage vs. dev).
Each pane gets its own isolated browser context, so logging into one never leaks a session or cookie
into the other. A URL bar with back/forward/reload/stop sits above each pane; a capture bar with
page-name, dynamic-element masking, full-page, and auto-file toggles sits above both.

Notable behaviour:
- **Every capture gets a fresh run id** — a second comparison never overwrites the first.
- **JS dialogs** (`alert`/`confirm`/`prompt`) are surfaced as an in-pane modal rather than silently
  dismissed, and **SSO pop-ups** (Okta, Azure AD, Auth0) are adopted into the pane so login completes.
- **HTTP Basic Auth** is a native browser dialog and never appears in the pane — supply credentials
  in the session form instead (they're held only in the browser context, never stored or logged).
- **Native `<select>` dropdowns, date pickers, autofill, and the context menu** are OS widgets and
  don't render headlessly — click to focus, then arrow keys + Enter. File inputs are out of scope.
- The backend binds to **loopback only** by default (`BIND_HOST=127.0.0.1`) — Compare Live drives a
  real browser to user-supplied URLs, so exposing it to the LAN hands that capability to anyone on
  the network. Changing `BIND_HOST` is an explicit, documented opt-in.
- Sessions are capped (`LIVE_MAX_SESSIONS`, default 3) and idle ones are reaped
  (`LIVE_IDLE_TIMEOUT_MS`, default 15 min) — each session is two browser contexts, roughly
  300–600 MB.

Config knobs live in `backend/.env.example` under **Live mode**. Full design rationale — the CDP
screencast transport, input-forwarding protocol, and threat model — is in
[`documentation/WEB_APP_REGRESSION_PLAN.md`](./documentation/WEB_APP_REGRESSION_PLAN.md).

---

## 💬 Expectation chatbot — stop false positives before they happen

The single biggest source of noise in visual regression tools is a *deliberate* change coming back
labelled a critical bug. The chatbot fixes this without any global config file: describe what you
changed, in plain English, and the AI treats it as context for that one comparison.

Available in both flows:

- **Upload mode** — the chat panel sits between the drop zones and the advanced settings in the
  upload form. Rules apply to that one comparison and reset afterward.
- **Compare Live** — the same panel appears next to the URL form (before you start) and again above
  the capture bar (once the session is live, since seeing both pages is often what tells you what to
  expect). Rules are **session-level**: set once, applied to every capture in that session until you
  change or clear them.

How it works: type something like *"We intentionally moved the search bar into the header. The
sidebar width must not change."* — a text model (Groq, Ollama, or an offline `mock` heuristic)
extracts it into three groups:

| Group | Effect on classification |
|-------|---------------------------|
| **Expected** | Biases toward `INTENTIONAL_CHANGE` |
| **Must not happen** | Biases toward `BUG`, raised severity |
| **Dynamic / ignore** | Biases toward `DYNAMIC_CONTENT` |

The extracted rules are shown back to you for confirmation — and each one can be deleted individually
— **before** they're applied to anything. Once applied, they're persisted with the result JSON, so a
result card six weeks from now still shows exactly what was claimed at the time.

**The one hard rule: expectations bias the verdict, they never hide a finding.** The AI is explicitly
instructed to still report and explain every change it sees — including ones you called expected —
and to trust its own eyes and lower its confidence if what it sees contradicts what you said. A
feature that could be used to suppress a real regression by describing it approximately would be
worse than not having the feature at all.

Runs fully offline by default:

```ini
CHAT_PROVIDER=mock       # no key, no network — crude but deterministic sentence classification
```

For real extraction, set `CHAT_PROVIDER=groq` (free tier, no credit card —
[console.groq.com/keys](https://console.groq.com/keys)) or `CHAT_PROVIDER=ollama` (fully local,
requires `ollama serve` running). Chat traffic is deliberately a **separate model and a separate rate
limit budget** from vision classification, so a chatty conversation can never starve the Gemini free
tier `/api/compare` depends on. Config in `backend/.env.example` under **Chat / expectation
extraction**.

### Common problems

| Symptom | Fix |
|---------|-----|
| `❌ Missing GEMINI_API_KEY` | `backend/.env` missing or malformed. Bare `KEY=value`, then restart the backend |
| `AI provider returned 404` | Google retired the model for your key. List available ones with `curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY" \| grep '"name"'` and set `GEMINI_MODEL` |
| `EADDRINUSE :::4000` | An old backend is still running. macOS/Linux: `lsof -ti:4000 \| xargs kill -9`. Windows: `Get-NetTCPConnection -LocalPort 4000 -State Listen \| Select -Expand OwningProcess -Unique \| ForEach { Stop-Process -Id $_ -Force }` |
| Dashboard loads but every comparison fails | Backend is down — Vite serves the UI fine without it. Check `/health` |
| Screenshots show as broken images | `run_id` must match `^[A-Za-z0-9_-]{1,128}$`; the serving route rejects anything else |
| Playwright `Executable doesn't exist` | `cd playwright-service && npx playwright install chromium` |
| Compare Live panes never render anything | Chromium isn't installed for the workspace root — run `npx playwright install chromium` from the repo root, not just inside `playwright-service` |
| Compare Live: `SESSION_LIMIT` | `LIVE_MAX_SESSIONS` (default 3) reached — close an existing session or raise the limit in `backend/.env` |
| Chat panel returns generic "Offline rule extraction..." text | `CHAT_PROVIDER` is `mock` (the default) — set it to `groq` or `ollama` for real extraction |

More cases in [`documentation/RUNNING.md` §9](./documentation/RUNNING.md#9-troubleshooting).

---

## 🤖 Gemini Flash (Free AI)

This tool uses **Google Gemini Flash** — completely free. The default model is `gemini-3.6-flash`
(`gemini-2.0-flash` and `gemini-2.5-flash` have been retired for newly issued keys and now 404);
override it with `GEMINI_MODEL` in `backend/.env` if your key serves a different set.

| Limit | Value |
|-------|-------|
| Requests/minute | 15 |
| Requests/day | 1,500 |
| Cost | **$0** |

Get your free API key at [aistudio.google.com](https://aistudio.google.com)

### AI Classifications

| Result | When |
|--------|------|
| 🐛 `BUG` | Unintended regression — broken layout, missing elements, wrong colors |
| ✅ `INTENTIONAL_CHANGE` | Deliberate design update detected |
| 🔄 `DYNAMIC_CONTENT` | Timestamps, avatars, ads — safely ignored |
| ⚠️ `NEEDS_REVIEW` | Ambiguous — human judgment needed |

---

## 🎭 Playwright Auto-Capture

### Configure pages to test

Copy and edit `docs/vr-config.example.json` → `vr-config.json`:

```json
{
  "base_url_before": "https://staging.your-app.com",
  "base_url_after": "https://preview.your-app.com",
  "backend_url": "http://localhost:4000",
  "run_id": "my-test-run-001",
  "output_dir": "./screenshots",
  "auto_file_bugs": true,
  "jira_project_key": "QA",
  "github_owner": "your-org",
  "github_repo": "your-repo",
  "pages": [
    { "name": "Home Page", "path": "/" },
    { "name": "Login", "path": "/login", "wait_for_selector": "form" },
    { "name": "Dashboard", "path": "/dashboard", "wait_ms": 1500 }
  ]
}
```

### Run capture

```bash
cd playwright-service
VR_CONFIG=./vr-config.json npm run capture
```

Playwright will:
1. Open each page in a headless Chrome browser
2. Capture before & after screenshots
3. Submit them to the backend for AI analysis
4. Print results and auto-file bugs
5. Exit with code `1` if critical bugs found (for CI)

---

## ⚙️ GitHub Actions CI/CD

### Setup

Add these secrets to your GitHub repository (`Settings → Secrets`):

| Secret | Required | Description |
|--------|----------|-------------|
| `GEMINI_API_KEY` | ✅ | Free Gemini API key |
| `APP_BASE_URL` | ✅ | Your staging/baseline URL |
| `APP_PREVIEW_URL` | ✅ | Your PR preview URL |
| `GITHUB_TOKEN` | Auto | Provided by GitHub Actions |
| `JIRA_BASE_URL` | Optional | Your Jira instance URL |
| `JIRA_EMAIL` | Optional | Your Jira email |
| `JIRA_API_TOKEN` | Optional | Jira API token |
| `JIRA_PROJECT_KEY` | Optional | e.g., `QA` |
| `VR_BACKEND_URL` | Optional | If backend is hosted externally |

### What happens on every PR

```
PR Opened/Updated
      │
      ▼
GitHub Actions triggers
      │
      ▼
Playwright captures screenshots
(staging URL vs PR preview URL)
      │
      ▼
AI classifies each page
      │
      ├── BUG found? → Files Jira + GitHub Issue
      │                Posts PR comment with summary
      │                Marks CI check ⚠️
      │
      └── Critical BUG? → Fails CI ❌
```

---

## 🔗 Integrations

### Jira

When a bug is detected, the tool:
- Creates a Bug ticket with correct priority
- Attaches before/after/diff screenshots
- Sets labels: `visual-regression`, `severity-critical`, etc.
- Links the Run ID for traceability

### GitHub

When a bug is detected:
- Creates a GitHub Issue with a formatted table
- Applies color-coded labels (`priority: critical`, `visual-regression`)
- Auto-creates labels if they don't exist
- Posts a summary comment on the PR

---

## 📡 Backend API Reference

### `POST /api/compare`
Submit screenshots for AI analysis.

**Form fields:**
- `before` — File (before screenshot)
- `after` — File (after screenshot)
- `run_id` — string
- `page_name` — string
- `auto_file_bugs` — boolean
- `jira_project_key` — string (optional)
- `github_owner` / `github_repo` — string (optional)
- `expectations` — JSON string of an `ExpectationRules` object (optional) — normally produced by the
  chat panel, never required. A malformed value is ignored rather than failing the comparison.

**Response:**
```json
{
  "success": true,
  "result": {
    "id": "uuid",
    "run_id": "run-123",
    "page_name": "Home Page",
    "classification": {
      "classification": "BUG",
      "severity": "critical",
      "component": "Navigation Bar",
      "explanation": "The navigation links disappeared...",
      "recommended_action": "Check recent CSS changes...",
      "confidence": 95,
      "diff_percentage": 12.4
    },
    "jira_ticket": "QA-247",
    "github_issue": "https://github.com/org/repo/issues/88",
    "expectations": { "expected": [], "unexpected": [], "ignore": [], "summary": "", "raw": "" }
  }
}
```
`expectations` is present only when a rule set was applied to the run.

### `POST /api/chat`
Turn a plain-English description into structured `ExpectationRules`. JSON body, not multipart —
rate-limited separately from `/api/compare` (20 req/min) so a conversation can't lock you out of the
comparison endpoint.

**Body:**
```json
{ "messages": [{ "role": "user", "content": "We darkened the header on purpose. The sidebar must not move." }] }
```

**Response:**
```json
{
  "reply": "Got it — 1 expected change, 1 thing that must not happen.",
  "rules": {
    "expected": ["We darkened the header on purpose"],
    "unexpected": ["The sidebar must not move"],
    "ignore": [],
    "summary": "1 expected, 1 unexpected, 0 ignored",
    "raw": "We darkened the header on purpose. The sidebar must not move."
  }
}
```

### Compare Live — Socket.IO, not REST
Compare Live's browser panes, input forwarding, and capture flow run over a `/live` Socket.IO
namespace, not plain HTTP — full event reference in
[`documentation/WEB_APP_REGRESSION_PLAN.md` §3.5](./documentation/WEB_APP_REGRESSION_PLAN.md).
Capturing both panes still ends by calling the same pipeline as `/api/compare`, so the result shape
— including `expectations` — is identical.

### `GET /api/integrations/status`
Check which integrations are connected.

### `GET /health`
Backend health check. Also reports the number of active Compare Live sessions (`live`).

---

## 🛠️ Development

```bash
# Backend only
cd backend && npm run dev

# Frontend only
cd frontend && npm run dev

# Playwright service
cd playwright-service && VR_CONFIG=../vr-config.json npm run capture

# Typecheck all three packages
npm run typecheck

# Backend unit + integration tests (hermetic — no API key, no network)
cd backend && npm test

# Build for production
npm run build
```

Headless end-to-end probes for Compare Live and the expectation chatbot live in `test/probe/` — they
need a running backend and, for the chatbot's A/B probe, a real `GEMINI_API_KEY`. See
[`documentation/TEST_PLAN.md`](./documentation/TEST_PLAN.md) for what each one proves and how to run
it.

---

## 📄 License

MIT — built for the QA engineering community.
