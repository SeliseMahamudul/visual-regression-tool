# 👁️ Visual Regression AI Tool

An AI-powered visual regression testing platform that compares UI screenshots, classifies changes using **Google Gemini Flash** (free), auto-captures with **Playwright**, integrates with **Jira** and **GitHub**, and runs on every PR via **GitHub Actions CI/CD**.

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

---

## 📁 Project Structure

```
visual-regression-ai/
├── frontend/                   # React + TypeScript dashboard
│   └── src/
│       ├── components/
│       │   ├── UploadForm.tsx          # Drag-and-drop screenshot upload
│       │   ├── ResultCard.tsx          # AI result display card
│       │   ├── ScreenshotViewer.tsx    # Before/After/Diff viewer
│       │   └── ClassificationBadge.tsx # Bug/Intentional/Dynamic badge
│       ├── api/client.ts               # Axios API client
│       ├── types/index.ts              # Shared TypeScript types
│       └── App.tsx                     # Main dashboard
│
├── backend/                    # Node.js + TypeScript API
│   └── src/
│       ├── routes/
│       │   ├── compare.ts              # POST /api/compare (main endpoint)
│       │   ├── screenshots.ts          # GET /api/screenshots/:runId/:type
│       │   └── integrations.ts         # GET /api/integrations/status
│       ├── services/
│       │   ├── aiClassification.ts     # Gemini Flash vision AI
│       │   ├── pixelDiff.ts            # pixelmatch diff generation
│       │   ├── jiraService.ts          # Jira REST API integration
│       │   └── githubService.ts        # GitHub API integration
│       └── index.ts                    # Express server entry
│
├── playwright-service/         # Playwright screenshot automation
│   └── src/
│       └── capture.ts                  # Auto-capture + submit to backend
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
| Chromium for Playwright | — | — | Only for automated capture, not the dashboard |

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
without them.

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
# {"status":"ok","version":"1.0.0","env":{"gemini":true,"jira":false,"github":false}}
```

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

### Common problems

| Symptom | Fix |
|---------|-----|
| `❌ Missing GEMINI_API_KEY` | `backend/.env` missing or malformed. Bare `KEY=value`, then restart the backend |
| `AI provider returned 404` | Google retired the model for your key. List available ones with `curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY" \| grep '"name"'` and set `GEMINI_MODEL` |
| `EADDRINUSE :::4000` | An old backend is still running. macOS/Linux: `lsof -ti:4000 \| xargs kill -9`. Windows: `Get-NetTCPConnection -LocalPort 4000 -State Listen \| Select -Expand OwningProcess -Unique \| ForEach { Stop-Process -Id $_ -Force }` |
| Dashboard loads but every comparison fails | Backend is down — Vite serves the UI fine without it. Check `/health` |
| Screenshots show as broken images | `run_id` must match `^[A-Za-z0-9_-]{1,128}$`; the serving route rejects anything else |
| Playwright `Executable doesn't exist` | `cd playwright-service && npx playwright install chromium` |

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
    "github_issue": "https://github.com/org/repo/issues/88"
  }
}
```

### `GET /api/integrations/status`
Check which integrations are connected.

### `GET /health`
Backend health check.

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

# Build for production
npm run build
```

---

## 📄 License

MIT — built for the QA engineering community.
