# Visual Regression AI Tool — Project Requirements & Plan

**Document Version:** 1.1  
**Last Updated:** 15 August 2026  
**Project Type:** Internal QA Engineering Tool  
**Status:** v1.0 delivered · v1.1 scope approved, implementation pending

> **v1.1 changelog.** Adds two capabilities and the requirements that govern them:
> **§3.8 Expectation Chatbot** (FR-52–FR-62) and **§3.9 Live Two-Environment Comparison**
> (FR-63–FR-75), plus NFR-16–NFR-18 and SEC-10–SEC-13. Implementation specs live in
> `CHATBOT_IMPLEMENTATION_PLAN.md` (repo root) and `documentation/WEB_APP_REGRESSION_PLAN.md`;
> verification lives in `documentation/TEST_PLAN.md`. §12 has been updated to reflect the test suite
> that now exists.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Stakeholders](#2-stakeholders)
3. [Functional Requirements](#3-functional-requirements)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [System Architecture](#5-system-architecture)
6. [Tech Stack Decisions](#6-tech-stack-decisions)
7. [API & Integration Requirements](#7-api--integration-requirements)
8. [Environment Setup Requirements](#8-environment-setup-requirements)
9. [CI/CD Pipeline Requirements](#9-cicd-pipeline-requirements)
10. [Data & Storage Requirements](#10-data--storage-requirements)
11. [Security Requirements](#11-security-requirements)
12. [Test Plan](#12-test-plan)
13. [Milestones & Delivery Plan](#13-milestones--delivery-plan)
14. [Risks & Mitigations](#14-risks--mitigations)
15. [Definition of Done](#15-definition-of-done)
16. [Related Documents](#16-related-documents)

---

## 1. Project Overview

### Problem Statement
Traditional visual regression tools (Percy, BackstopJS, Applitools) rely on pixel diffing alone. This generates a high volume of false positives — minor rendering differences, dynamic content, and anti-aliasing changes — that require manual review. This creates a bottleneck that slows down QA engineers and erodes trust in visual test results.

### Solution
An AI-powered visual regression platform that:
- Automatically captures before/after screenshots using Playwright
- Generates pixel diffs using `pixelmatch`
- Classifies each change using **Google Gemini 2.0 Flash** (free vision AI)
- Auto-files confirmed bugs to **Jira** and **GitHub Issues**
- Runs on every Pull Request via **GitHub Actions**
- Provides a **React dashboard** for manual reviews
- **(v1.1)** Lets the QA engineer state, in plain English, which changes are expected — so the AI
  stops flagging deliberate redesigns as bugs
- **(v1.1)** Opens two environments as live, interactive panes inside the dashboard, so a page behind
  a login can be compared without producing screenshots by hand

### Goals
- Reduce false positive visual alerts by 80%
- Eliminate manual screenshot comparison from the QA workflow
- Automatically file bug tickets with screenshot evidence attached
- Integrate into the existing CI/CD pipeline with zero developer friction
- **(v1.1)** Make ad-hoc comparison of two running environments a one-click operation, including
  pages that require authentication

---

## 2. Stakeholders

| Role | Name / Team | Responsibility |
|------|-------------|----------------|
| Project Owner | QA Lead | Requirements approval, final sign-off |
| Developer | Frontend/Backend Engineer | Build and maintain the tool |
| QA Engineer | Test Team | Primary users of the dashboard |
| DevOps | Infrastructure Team | GitHub Actions, secrets management |
| Project Manager | PM | Milestone tracking, reporting |

---

## 3. Functional Requirements

### 3.1 Screenshot Capture (Playwright)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | The system MUST capture full-page screenshots of a configurable list of URLs using Playwright (Chromium) | Must Have |
| FR-02 | Playwright MUST support configurable viewport sizes per page | Must Have |
| FR-03 | Playwright MUST support `wait_for_selector` to wait for dynamic content before capturing | Must Have |
| FR-04 | Playwright MUST suppress dynamic elements (timestamps, avatars, ads) via injected CSS before capture | Must Have |
| FR-05 | Screenshots MUST be captured in PNG format at 1x device pixel ratio | Must Have |
| FR-06 | The capture service MUST accept a JSON config file listing pages and their settings | Must Have |
| FR-07 | The capture service MUST exit with code `1` if critical bugs are found (for CI gate) | Must Have |
| FR-08 | The system SHOULD support basic HTTP auth for staging environments | Should Have |
| FR-09 | The system COULD support mobile viewport presets (375px, 768px) | Could Have |

---

### 3.2 Pixel Diff Engine (pixelmatch)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10 | The system MUST generate a diff image highlighting pixel-level differences between before and after screenshots | Must Have |
| FR-11 | The diff MUST use red color to indicate changed pixels | Must Have |
| FR-12 | The system MUST calculate and report the percentage of pixels changed | Must Have |
| FR-13 | The system MUST auto-resize images to the same dimensions before diffing if they differ | Must Have |
| FR-14 | The diff threshold MUST be configurable (default: 0.1) to tune sensitivity | Should Have |

---

### 3.3 AI Classification (Gemini Flash)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-15 | The system MUST send before, after, and diff images to Gemini 2.0 Flash for classification | Must Have |
| FR-16 | The AI MUST return one of four classifications: `BUG`, `INTENTIONAL_CHANGE`, `DYNAMIC_CONTENT`, `NEEDS_REVIEW` | Must Have |
| FR-17 | The AI MUST return a severity level: `critical`, `medium`, `low`, or `none` | Must Have |
| FR-18 | The AI MUST return a plain-English explanation of the change | Must Have |
| FR-19 | The AI MUST return a recommended action for the QA engineer | Must Have |
| FR-20 | The AI MUST return a confidence percentage (0–100) | Must Have |
| FR-21 | The system MUST handle Gemini API errors gracefully with retry logic | Must Have |
| FR-22 | The system SHOULD support swapping to an alternative vision model (e.g., Groq, Ollama) via config | Should Have |

---

### 3.4 Jira Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-23 | The system MUST create a Jira Bug ticket when classification is `BUG` and auto_file_bugs is enabled | Must Have |
| FR-24 | The Jira ticket MUST include: summary, severity, component, AI explanation, run ID, and diff percentage | Must Have |
| FR-25 | The system MUST attach before, after, and diff screenshots to the Jira ticket | Must Have |
| FR-26 | The Jira ticket priority MUST map from AI severity: critical→Highest, medium→Medium, low→Low | Must Have |
| FR-27 | The Jira ticket MUST include labels: `visual-regression`, `automated`, `severity-{level}` | Must Have |
| FR-28 | Jira integration MUST be optional — system works fully without Jira configured | Must Have |
| FR-29 | The system SHOULD support Jira Cloud and Jira Server via configurable base URL | Should Have |

---

### 3.5 GitHub Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-30 | The system MUST create a GitHub Issue when classification is `BUG` and auto_file_bugs is enabled | Must Have |
| FR-31 | The GitHub Issue MUST include a formatted table with: page, component, severity, classification, run ID | Must Have |
| FR-32 | The system MUST auto-create GitHub labels if they do not exist: `visual-regression`, `priority: critical`, etc. | Must Have |
| FR-33 | The system MUST post a summary comment on the Pull Request after each run | Must Have |
| FR-34 | The PR comment MUST include: pages tested, bugs found, links to auto-filed issues | Must Have |
| FR-35 | GitHub integration MUST be optional — system works fully without GitHub token configured | Must Have |

---

### 3.6 React Dashboard (Frontend)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-36 | The dashboard MUST allow users to upload before and after screenshots via drag-and-drop | Must Have |
| FR-37 | The dashboard MUST display the AI classification, severity, component, and explanation | Must Have |
| FR-38 | The dashboard MUST show a side-by-side, diff-only, before-only, and after-only view | Must Have |
| FR-39 | The dashboard MUST show a summary stats bar (total tested, bugs, needs review, clean) | Must Have |
| FR-40 | The dashboard MUST allow toggling auto-file bugs to Jira and GitHub | Must Have |
| FR-41 | The dashboard MUST display a link to auto-filed Jira tickets and GitHub issues | Must Have |
| FR-42 | The dashboard MUST show a loading state during AI analysis | Must Have |
| FR-43 | The dashboard MUST show toast notifications for completed analyses | Must Have |
| FR-44 | The dashboard SHOULD show integration health status (Gemini ✅, Jira ✅, GitHub ✅) | Should Have |
| FR-45 | The dashboard COULD support a run history page showing past test runs | Could Have |

---

### 3.7 Backend API (Node.js)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-46 | `POST /api/compare` MUST accept multipart form data with before/after images and run config | Must Have |
| FR-47 | `GET /api/screenshots/:runId/:type` MUST serve before, after, and diff images | Must Have |
| FR-48 | `GET /api/integrations/status` MUST return the health of all configured integrations | Must Have |
| FR-49 | `GET /health` MUST return backend status and which integrations are configured | Must Have |
| FR-50 | All results MUST be persisted to disk as JSON files per run | Must Have |
| FR-51 | The API MUST enforce rate limiting (100 req/15 min) to protect the Gemini free tier | Must Have |

---

### 3.8 Expectation Chatbot (v1.1)

Implementation spec: `CHATBOT_IMPLEMENTATION_PLAN.md` (repo root).

Addresses risk **R-02** directly. Before v1.1 the only way to give the vision model project context
was the global `VR_PROJECT_CONTEXT` env var, read once at process start — so "we deliberately
restyled the header this sprint" required editing `.env` and restarting the backend, and applied to
every page of every run.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-52 | The dashboard MUST provide a chat interface where the user describes expected and unexpected UI changes in natural language | Must Have |
| FR-53 | The system MUST convert the user's natural-language description into a structured `ExpectationRules` object (`expected`, `unexpected`, `ignore`, `summary`, `raw`) | Must Have |
| FR-54 | The system MUST display the extracted rules back to the user for confirmation before they are applied | Must Have |
| FR-55 | The extracted rules MUST be injected into the vision classification prompt for that comparison only | Must Have |
| FR-56 | Expectation rules MUST bias classification toward `INTENTIONAL_CHANGE`, and MUST NOT suppress, hide, or omit any detected change | Must Have |
| FR-57 | The chat text model MUST be a separate, independently configurable provider from the vision model | Must Have |
| FR-58 | The chat provider MUST be swappable by changing a single service file (mirrors FR-22 / NFR-15) | Must Have |
| FR-59 | The system MUST work fully offline with `CHAT_PROVIDER=mock`, requiring no API key | Must Have |
| FR-60 | The rules in force for a run MUST be persisted with that run's result JSON for audit | Must Have |
| FR-61 | The dashboard MUST display which expectation rules were in force when showing a result | Should Have |
| FR-62 | A malformed, oversized, or hostile `expectations` payload MUST NOT fail the comparison | Must Have |

> **FR-56 is a safety requirement, not a quality one.** An implementation that silently drops changes
> the user called "expected" would let a QA engineer bury a real regression by describing it
> approximately — strictly worse than not having the feature. Rules influence *classification*; they
> never remove a finding from the report. Where the evidence contradicts what the user stated, the
> model is instructed to say so and lower its confidence.

**Scope boundaries.** Instructions are per-comparison only: no saved profiles, no global rule set, no
cross-run persistence of conversations, and no feedback-loop learning. The chat model is deliberately
separate from the vision model so chat traffic cannot consume the Gemini free-tier budget
(15 RPM / 1,500 RPD) that classification depends on.

---

### 3.9 Live Two-Environment Comparison (v1.1)

Implementation spec: `documentation/WEB_APP_REGRESSION_PLAN.md`.

Addresses risk **R-03** directly. Before v1.1, comparing a page behind a login was impossible: the
dashboard required screenshots produced elsewhere, and the Playwright CLI took a fixed list of paths
and could not authenticate.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-63 | There should be another module named "Compare Live" in the top navigation bar. The the new module MUST accept two URLs and open both as live, interactive panes embedded in the dashboard | Must Have |
| FR-64 | Each pane MUST forward the user's mouse, keyboard, and scroll input to its remote page | Must Have |
| FR-65 | The two panes MUST navigate fully independently — no mirroring of URLs or interactions | Must Have |
| FR-66 | The two panes MUST use isolated browser contexts so cookies, storage, and sessions never leak between environments | Must Have |
| FR-67 | Each pane MUST provide a URL bar with back, forward, reload, and stop | Must Have |
| FR-68 | A single user action MUST capture both panes and run the existing diff + AI classification pipeline | Must Have |
| FR-69 | Live comparison results MUST render through the existing result card and screenshot viewer | Must Have |
| FR-70 | Each capture MUST use a fresh run id so earlier comparisons are never overwritten | Must Have |
| FR-71 | The system MUST support optional HTTP basic auth credentials per pane (supersedes FR-08 for live mode) | Should Have |
| FR-72 | JavaScript dialogs (`alert`, `confirm`, `prompt`, `beforeunload`) MUST be surfaced to the user, not auto-dismissed | Must Have |
| FR-73 | Pop-up windows opened by the page (SSO / identity provider flows) MUST be adopted into the originating pane | Must Have |
| FR-74 | A live session MUST survive a dashboard reload without losing authenticated state | Should Have |
| FR-75 | Idle sessions MUST be reaped, and the number of concurrent live sessions MUST be capped | Must Have |

**Scope boundaries.** Live mode is a *parallel* capture strategy: the Playwright CLI service and the
CI pipeline are unchanged, and credentials are never stored — the user types them into the pane, and
nothing is persisted or logged. Known limitations to be documented rather than worked around: native
`<select>` dropdowns, date pickers, and file-choosers do not render in headless Chromium and are out
of scope for v1.1.

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | Gemini AI classification response time | < 15 seconds per page |
| NFR-02 | Pixel diff generation time | < 2 seconds per comparison |
| NFR-03 | Playwright screenshot capture time | < 30 seconds per page (including page load) |
| NFR-04 | Full pipeline for 5 pages end-to-end | < 3 minutes |
| NFR-05 | Frontend dashboard initial load time | < 2 seconds |
| NFR-16 | Live pane input round-trip latency (v1.1) | < 150 ms perceived |
| NFR-17 | Live pane frame rate while interacting (v1.1) | ≥ 15 fps |
| NFR-18 | CPU and bandwidth consumed by an **idle** live pane (v1.1) | ~0 — push-based frames only |

### 4.2 Reliability

| ID | Requirement |
|----|-------------|
| NFR-06 | The system MUST handle Gemini API rate limit errors (429) with exponential backoff retry |
| NFR-07 | Playwright page capture failures MUST be caught and logged without stopping the full run |
| NFR-08 | Jira/GitHub API failures MUST NOT cause the classification pipeline to fail |
| NFR-09 | The backend MUST return meaningful error messages for all failure scenarios |

### 4.3 Usability

| ID | Requirement |
|----|-------------|
| NFR-10 | A QA engineer with no setup knowledge MUST be able to run the tool after reading the README |
| NFR-11 | The Playwright capture CLI MUST print a clear summary table at the end of each run |
| NFR-12 | All CI failures MUST include a downloadable screenshots artifact in GitHub Actions |

### 4.4 Maintainability

| ID | Requirement |
|----|-------------|
| NFR-13 | All code MUST be written in TypeScript with strict mode enabled |
| NFR-14 | The AI prompt in `aiClassification.ts` MUST be clearly separated and documented for easy tuning |
| NFR-15 | The vision AI provider MUST be swappable by changing a single service file |

> **NFR-14 note (v1.1):** the prompt now lives in `visionPrompt.ts` and, once FR-55 lands, is built
> by `buildClassificationPrompt(expectations?)` rather than being a module-level constant.
> Environment variables MUST be read at call time, never at module load — see `CLAUDE.md`.

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Actions CI                         │
│   Trigger: PR opened / updated                                   │
│   1. Start backend   2. Run Playwright   3. Post PR comment      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
               ┌───────────────┼────────────────┐
               ▼               ▼                ▼
   ┌─────────────────┐ ┌──────────────┐ ┌────────────────┐
   │  Playwright     │ │  Node.js     │ │  React + TS    │
   │  Service        │ │  Backend     │ │  Dashboard     │
   │  (CLI tool)     │ │  Express API │ │  :5173         │
   │                 │ │  :4000       │ │                │
   │ 1. Open pages   │ │              │ │ • Upload UI    │
   │ 2. Screenshot   │ │ • pixelmatch │ │ • Results view │
   │ 3. Submit to    │ │ • Gemini AI  │ │ • Stats bar    │
   │    backend      │ │ • File store │ │ • Side-by-side │
   └────────┬────────┘ └──────┬───────┘ └────────────────┘
            │                 │
            └────────┬────────┘
                     ▼
       ┌─────────────────────────┐
       │  External Services      │
       │                         │
       │  Gemini 2.0 Flash (AI)  │
       │  Jira REST API          │
       │  GitHub REST API        │
       └─────────────────────────┘
```

### 5.1 v1.1 additions

Neither new capability changes the pipeline below the capture step: both feed the **same**
diff → classify → file sequence, which is extracted into a shared `runComparison()` so the HTTP
route and the live session invoke identical logic.

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  React Dashboard  :5173                                          │
   │                                                                  │
   │  ┌── Upload mode ──────────┐   ┌── Live mode (v1.1) ──────────┐  │
   │  │ drag & drop two PNGs    │   │  ┌─ pane ─┐   ┌─ pane ─┐     │  │
   │  │ + Expectation Chatbot   │   │  │ STAGE  │   │  DEV   │     │  │
   │  │   (FR-52…FR-62)         │   │  │ live   │   │ live   │     │  │
   │  └──────────┬──────────────┘   │  └────────┘   └────────┘     │  │
   │             │                  │     [ CAPTURE & COMPARE ]    │  │
   │             │                  └──────────────┬───────────────┘  │
   └─────────────┼─────────────────────────────────┼──────────────────┘
        POST /api/compare                   Socket.IO  /live
        POST /api/chat                   (frames out, input in)
                 │                                 │
   ┌─────────────▼─────────────────────────────────▼──────────────────┐
   │  Node.js Backend  :4000  (bound to 127.0.0.1 — SEC-11)           │
   │                                                                  │
   │   textProvider.ts          live/  ── Playwright (headless)       │
   │   (groq│ollama│mock)         browserPool · session · pane         │
   │        │                     CDP Page.startScreencast            │
   │        │                            │                            │
   │        └──────────► comparisonRunner.runComparison() ◄───────────┤
   │                     pixelDiff → aiClassification → Jira/GitHub   │
   └──────────────────────────────────────────────────────────────────┘
```

Key architectural constraints:

- The live browser runs **inside the existing backend process** (`backend/src/live/`), not a fourth
  service, because the capture step calls the diff and classification services directly.
- `playwright-service/` — the CI capture CLI — is **unchanged**. Live mode is additive.
- The chat model and the vision model are **separate providers** with separate credentials and
  separate quotas (FR-57).

---

## 6. Tech Stack Decisions

| Component | Technology | Reason |
|-----------|-----------|--------|
| Frontend Language | TypeScript | Type safety, IDE support, fewer runtime bugs |
| Frontend Framework | React 18 | Component model ideal for dashboard UI |
| Frontend Styling | Tailwind CSS | Utility-first, fast to build, no CSS conflicts |
| Backend Language | TypeScript | Consistent language across the stack |
| Backend Framework | Node.js + Express | Lightweight, familiar, great ecosystem for file handling |
| Screenshot Capture | Playwright (Chromium) | Most reliable headless browser, full-page capture, good CI support |
| Pixel Diffing | pixelmatch | Lightweight, battle-tested, used by Percy internally |
| AI Vision Model | Google Gemini 2.0 Flash | **Free** (1,500 req/day), excellent vision quality, JSON output |
| Bug Tracker | Jira REST API v3 | Industry standard in most QA orgs |
| Source Control | GitHub REST API v4 | Native PR comments + Issues |
| CI/CD | GitHub Actions | Free, tight GitHub integration, artifact upload support |
| Image Processing | Jimp | Pure JS image resize/normalize, no native deps needed |

---

## 7. API & Integration Requirements

### 7.1 Google Gemini API

| Item | Detail |
|------|--------|
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent` |
| Auth | API Key via query param |
| Free Tier | 15 RPM, 1,500 RPD |
| Cost | $0 |
| Payload | Base64-encoded PNG images (before, after, diff) |
| Output | JSON: classification, severity, component, explanation, confidence |
| Get Key | https://aistudio.google.com |

### 7.2 Jira REST API

| Item | Detail |
|------|--------|
| Endpoint | `{JIRA_BASE_URL}/rest/api/3/issue` |
| Auth | Basic Auth (email + API token) |
| Permissions needed | Create Issues, Add Attachments |
| Token | Generate at id.atlassian.com/manage-profile/security/api-tokens |

### 7.3 GitHub REST API

| Item | Detail |
|------|--------|
| Endpoint | `https://api.github.com` |
| Auth | Bearer token (Personal Access Token or GitHub Actions `GITHUB_TOKEN`) |
| Permissions needed | `issues: write`, `pull-requests: write` |
| Token | Generate at github.com/settings/tokens |

---

## 8. Environment Setup Requirements

### 8.1 Developer Machine Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ | LTS recommended |
| npm | 9+ | Included with Node |
| Git | Any | For cloning |
| Chromium | Auto-installed | Via `playwright install chromium` |
| OS | Windows / macOS / Linux | All supported |

### 8.2 Required Environment Variables

| Variable | Required | Where to Get |
|----------|----------|--------------|
| `GEMINI_API_KEY` | ✅ Yes | aistudio.google.com |
| `JIRA_BASE_URL` | Optional | Your Jira instance URL |
| `JIRA_EMAIL` | Optional | Your Atlassian account email |
| `JIRA_API_TOKEN` | Optional | id.atlassian.com/manage-profile/security/api-tokens |
| `GITHUB_TOKEN` | Optional | github.com/settings/tokens (needs `repo` scope) |
| `PORT` | Optional | Default: 4000 |
| `FRONTEND_URL` | Optional | Default: http://localhost:5173 |
| `VISION_PROVIDER` | Optional | `gemini` (default) or `mock` for offline runs |
| `GEMINI_MODEL` | Optional | Override when the pinned model is retired — see `CLAUDE.md` |

#### v1.1 additions

| Variable | Required | Purpose |
|----------|----------|---------|
| `CHAT_PROVIDER` | Optional | `mock` (default, offline) · `groq` · `ollama` (FR-57/FR-59) |
| `GROQ_API_KEY` | Optional | Free tier, no card: console.groq.com/keys |
| `GROQ_MODEL` | Optional | Pin explicitly; do not use a `-latest` alias |
| `OLLAMA_BASE_URL` | Optional | Default `http://localhost:11434` — fully local chat |
| `OLLAMA_MODEL` | Optional | Default `llama3.2` |
| `BIND_HOST` | Optional | Default `127.0.0.1` (SEC-11). Changing this is an explicit opt-in |
| `LIVE_MAX_SESSIONS` | Optional | Default 3 (FR-75) |
| `LIVE_IDLE_TIMEOUT_MS` | Optional | Default 15 min (FR-75) |
| `LIVE_DETACH_GRACE_MS` | Optional | Default 60 s — survives a dashboard reload (FR-74) |
| `LIVE_SCREENCAST_QUALITY` | Optional | JPEG quality, default 60 |
| `LIVE_VIEWPORT_WIDTH` / `_HEIGHT` | Optional | Default 1280 × 800 |
| `LIVE_URL_ALLOWLIST` | Optional | Comma-separated host globs. Empty = any http(s) host (SEC-10) |

### 8.3 GitHub Actions Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `GEMINI_API_KEY` | ✅ | AI classification |
| `APP_BASE_URL` | ✅ | Staging / baseline URL |
| `APP_PREVIEW_URL` | ✅ | PR preview / new build URL |
| `JIRA_BASE_URL` | Optional | Jira instance |
| `JIRA_EMAIL` | Optional | Jira email |
| `JIRA_API_TOKEN` | Optional | Jira token |
| `JIRA_PROJECT_KEY` | Optional | e.g. `QA` |

---

## 9. CI/CD Pipeline Requirements

### 9.1 Trigger Conditions

```
Triggers on:
  pull_request:
    branches: [main, develop, staging]
    types: [opened, synchronize, reopened]
```

### 9.2 Pipeline Steps

| Step | Tool | Failure Behavior |
|------|------|-----------------|
| 1. Checkout code | actions/checkout | Hard fail |
| 2. Setup Node.js | actions/setup-node | Hard fail |
| 3. Install dependencies | npm ci | Hard fail |
| 4. Install Playwright browsers | playwright install chromium | Hard fail |
| 5. Start backend | npm start | Hard fail |
| 6. Wait for backend health | curl /health | Hard fail |
| 7. Generate VR config | Shell script | Hard fail |
| 8. Run Playwright capture | npm run capture | Soft fail (continue-on-error) |
| 9. Upload screenshots | actions/upload-artifact | Soft fail |
| 10. Post PR comment | actions/github-script | Soft fail |
| 11. Check critical bugs | exit code check | Hard fail if critical found |

### 9.3 CI Gate Logic

```
Exit code 0 → No bugs / only intentional changes → CI passes ✅
Exit code 0 → Non-critical bugs found → CI passes with warning ⚠️
Exit code 1 → Critical bugs found → CI fails ❌
```

### 9.4 Artifacts Produced

- `screenshots/` folder uploaded as GitHub Actions artifact
- Retained for 30 days
- Downloadable from the Actions run page

---

## 10. Data & Storage Requirements

### 10.1 File Storage (Local / Server)

```
uploads/
  └── {run_id}/
        ├── before_{timestamp}.png
        └── after_{timestamp}.png

results/
  └── {run_id}/
        ├── {run_id}_diff.png
        └── {result_id}.json
```

### 10.2 Result JSON Schema

```json
{
  "id": "uuid",
  "run_id": "string",
  "page_name": "string",
  "before_screenshot": "path/string",
  "after_screenshot": "path/string",
  "diff_screenshot": "path/string",
  "classification": {
    "classification": "BUG | INTENTIONAL_CHANGE | DYNAMIC_CONTENT | NEEDS_REVIEW",
    "severity": "critical | medium | low | none",
    "component": "string",
    "explanation": "string",
    "recommended_action": "string",
    "confidence": 0-100,
    "diff_percentage": 0.0-100.0
  },
  "jira_ticket": "QA-247 (optional)",
  "jira_url": "https://your-org.atlassian.net/browse/QA-247 (optional)",
  "github_issue": "https://... (optional)",
  "expectations": {
    "expected": ["the navigation bar was intentionally moved into the header"],
    "unexpected": ["the sidebar width must not change"],
    "ignore": ["the timestamp in the footer"],
    "summary": "Header redesign expected; sidebar width must hold",
    "raw": "the user's original words, verbatim"
  },
  "created_at": "ISO 8601 timestamp"
}
```

`jira_url` (FR-41) and `expectations` (FR-60) are both **optional**; records written before v1.1 will
not carry them, and consumers MUST tolerate their absence.

### 10.3 Storage Notes

- No database is required for MVP — JSON files on disk are sufficient
- For production, consider migrating to **PostgreSQL** or **SQLite**
- Screenshot files should be cleaned up after 30 days (add a cron job)
- Max upload size per screenshot: **10 MB**
- **v1.1:** live-mode run ids are derived from the session id as `{session_id}-c{n}`, so every capture
  in a session gets its own storage key (FR-70) while remaining grouped by prefix on disk. All run
  ids — uploaded or live — MUST satisfy `/^[A-Za-z0-9_-]{1,128}$/`, since they are interpolated into
  filesystem paths.
- **v1.1:** live captures bypass the 10 MB multipart limit because they are written directly to
  `uploads/{run_id}/` by the capture service rather than being uploaded. Full-page screenshots of a
  real application routinely exceed 10 MB, which is why the live path does not re-enter the HTTP
  endpoint.

---

## 11. Security Requirements

| ID | Requirement |
|----|-------------|
| SEC-01 | API keys (Gemini, Jira, GitHub) MUST be stored in `.env` files, never committed to Git |
| SEC-02 | The `.env` file MUST be listed in `.gitignore` |
| SEC-03 | GitHub Actions secrets MUST be used for all keys in CI |
| SEC-04 | The backend MUST use `helmet` for HTTP security headers |
| SEC-05 | The backend MUST implement rate limiting on all API endpoints |
| SEC-06 | File uploads MUST be validated for image MIME types only |
| SEC-07 | File uploads MUST be capped at 10 MB per file |
| SEC-08 | CORS MUST be restricted to the frontend origin only |
| SEC-09 | Screenshot files MUST NOT be publicly accessible via predictable URLs |
| SEC-10 | Live-mode navigation targets MUST be validated against a scheme allowlist (`http:`/`https:` only) and a cloud-metadata IP denylist, on session creation, on user navigation, and on in-page navigation |
| SEC-11 | The backend MUST bind to loopback (`127.0.0.1`) by default; binding to any other interface MUST be an explicit opt-in |
| SEC-12 | User-supplied expectation text MUST be delimited and length-capped before injection into any model prompt |
| SEC-13 | Expectation rules MUST NOT be able to suppress a detected change, only influence its classification |

### 11.1 Notes on the v1.1 security requirements

**SEC-11 is the highest-value item in this section.** The backend currently calls `app.listen(PORT)`,
which binds `0.0.0.0`. On its own that is a modest exposure; combined with live mode — where the
server drives a real browser to user-supplied URLs — it would let anyone on the same network drive a
browser running on the engineer's machine. Loopback binding closes this.

**SEC-10 is about scheme abuse, not classic SSRF.** A blanket private-IP block would break the
feature, because reaching internal staging hosts is the *legitimate* use case; RFC1918 addresses are
therefore deliberately allowed. The real exposures are non-HTTP schemes — `file:///…/backend/.env` in
a pane's URL bar would render the server's API keys into an image and stream them to the client,
defeating SEC-01 entirely — and cloud metadata endpoints (`169.254.169.254`,
`metadata.google.internal`). An optional host allowlist (`LIVE_URL_ALLOWLIST`) is available for
deployments that want to tighten this further.

**SEC-05 remains satisfied** under v1.1. The chat endpoint receives its own dedicated rate limit
rather than raising the global one, so a conversation cannot exhaust the budget that protects
`/api/compare` and the Gemini free tier. Socket.IO traffic is served from `/socket.io/` and is
governed by the session cap and idle reaper (FR-75) rather than by the HTTP limiter.

---

## 12. Test Plan

> **The detailed, executable test plan is `documentation/TEST_PLAN.md`.** This section defines the
> minimum bar; that document defines how it is proven, including the traceability matrix mapping every
> requirement id to the test that covers it.

**Status as of 15 August 2026:** the suite specified in §12.1 and §12.2 **exists and passes** —
`backend/jest.config.js` (ts-jest + supertest), with `backend/src/test/setupEnv.ts` forcing
`VISION_PROVIDER=mock` and blanking every API key so the suite is hermetic.

```
Test Suites: 5 passed, 5 total
Tests:       34 passed, 34 total
```

Run it with `npm test` at the repository root.

**v1.1 additions to this bar** (detailed in `TEST_PLAN.md`):

| Area | Minimum coverage |
|---|---|
| Chatbot | `buildClassificationPrompt()` with and without rules · rule extraction · `validateExpectationRules` hardening (FR-62) · `POST /api/chat` validation · backwards compatibility of `/api/compare` without an `expectations` field |
| **FR-56 specifically** | An A/B probe proving an expected change is reclassified **and still reported**. A run that returns "no significant change" is a defect, not a pass |
| Live mode | URL guard (SEC-10) · session id and run id format (FR-70) · session cap and idle reaper (FR-75) · screencast coordinate translation · `runComparison()` storage layout |
| Live probe | Both panes stream concurrently · input provably reaches the renderer · capture produces a non-zero diff and the §10.1 layout on disk |
| Regression | `POST /api/compare` behaves identically after `runComparison()` is extracted |

### 12.1 Unit Tests

| What to Test | Tool | Location |
|-------------|------|----------|
| `generatePixelDiff()` — correct diff % calculation | Jest | `backend/src/services/pixelDiff.test.ts` |
| `classifyWithGemini()` — handles API error gracefully | Jest + mock | `backend/src/services/aiClassification.test.ts` |
| `severityToPriority()` — correct Jira priority mapping | Jest | `backend/src/services/jiraService.test.ts` |
| `severityToLabel()` — correct GitHub label mapping | Jest | `backend/src/services/githubService.test.ts` |

### 12.2 Integration Tests

| Scenario | Expected Result |
|----------|-----------------|
| POST `/api/compare` with valid images | Returns classification JSON |
| POST `/api/compare` with missing `after` | Returns 400 Bad Request |
| POST `/api/compare` with Gemini key missing | Returns 500 with clear error |
| GET `/api/screenshots/:runId/diff` | Serves PNG image |
| GET `/api/integrations/status` with no env vars | Returns all integrations as false |

### 12.3 End-to-End Tests

| Scenario | Steps | Expected |
|----------|-------|---------|
| Happy path — no visual change | Upload identical screenshots | `DYNAMIC_CONTENT` or `INTENTIONAL_CHANGE`, 0% diff |
| Bug detection | Upload screenshots with nav bar removed | `BUG`, `critical` severity |
| Color change only | Upload screenshots with button color changed | `INTENTIONAL_CHANGE` or `BUG`, `medium` severity |
| CI pipeline | Open a test PR against the repo | Playwright captures, AI classifies, PR comment posted |

### 12.4 Manual Acceptance Criteria

- [ ] QA engineer can upload two screenshots via drag-and-drop in the dashboard
- [ ] AI classification appears within 15 seconds
- [ ] Side-by-side / diff view toggle works correctly
- [ ] Auto-file to Jira creates a ticket with screenshots attached
- [ ] Auto-file to GitHub creates an issue with correct labels
- [ ] GitHub Actions workflow triggers on PR open
- [ ] CI fails when a critical bug is detected
- [ ] PR comment appears with correct bug count

### 12.5 Manual Acceptance Criteria — v1.1

**Expectation chatbot**
- [ ] Typing an expectation returns extracted rules, shown for confirmation before use (FR-54)
- [ ] A wrongly extracted rule can be removed without retyping the whole instruction
- [ ] Rules are visible on the result card afterwards (FR-61)
- [ ] A comparison with no chat input behaves exactly as it did in v1.0
- [ ] **An expected change is still reported, not hidden (FR-56)**

**Live comparison**
- [ ] Two URLs open as interactive panes inside the dashboard (FR-63)
- [ ] Typing reaches only the focused pane, and which pane has focus is visually obvious (FR-64)
- [ ] Scrolling a pane does not scroll the dashboard behind it
- [ ] The panes navigate independently (FR-65)
- [ ] Logging into both as different users does not cross-contaminate; reloading one keeps its own
      session (FR-66)
- [ ] One click captures both and produces a result card (FR-68, FR-69)
- [ ] A second capture does not overwrite the first (FR-70)
- [ ] Reloading the dashboard reattaches to the live session, still authenticated (FR-74)
- [ ] A `confirm()` dialog appears as a modal instead of being silently dismissed (FR-72)
- [ ] An SSO pop-up is adopted into the pane and login completes (FR-73)
- [ ] `file:///…/backend/.env` typed into a URL bar is rejected (SEC-10)
- [ ] The backend is unreachable from another machine on the network (SEC-11)

---

## 13. Milestones & Delivery Plan

### Phase 1 — Core MVP (Week 1–2)

| Task | Owner | Est. Days |
|------|-------|-----------|
| Set up monorepo structure (frontend, backend, playwright-service) | Dev | 0.5 |
| Backend: Express server + file upload endpoint | Dev | 1 |
| Backend: pixelmatch pixel diff service | Dev | 1 |
| Backend: Gemini Flash AI classification service | Dev | 1.5 |
| Backend: Screenshot serving route | Dev | 0.5 |
| Frontend: Upload form with drag-and-drop | Dev | 1 |
| Frontend: Result card with classification display | Dev | 1 |
| Frontend: Before/After/Diff viewer | Dev | 1 |
| Playwright: Auto-capture service + JSON config | Dev | 1.5 |
| **Phase 1 Review & Testing** | QA | 1 |

**Phase 1 Deliverable:** Working local tool — upload screenshots → get AI classification

---

### Phase 2 — Integrations (Week 3)

| Task | Owner | Est. Days |
|------|-------|-----------|
| Jira: Create bug ticket with attachments | Dev | 1.5 |
| GitHub: Create issue + auto-create labels | Dev | 1 |
| GitHub: Post PR summary comment | Dev | 1 |
| Backend: Integration health check endpoint | Dev | 0.5 |
| Frontend: Integration settings panel | Dev | 0.5 |
| **Phase 2 Review & Testing** | QA | 1 |

**Phase 2 Deliverable:** Bugs auto-filed to Jira and GitHub from both dashboard and CLI

---

### Phase 3 — CI/CD Pipeline (Week 4)

| Task | Owner | Est. Days |
|------|-------|-----------|
| GitHub Actions workflow (`.yml`) | DevOps | 1 |
| GitHub Actions: Secrets configuration | DevOps | 0.5 |
| GitHub Actions: Screenshot artifact upload | DevOps | 0.5 |
| GitHub Actions: PR comment posting | DevOps | 0.5 |
| CI gate: Fail on critical bugs | DevOps | 0.5 |
| End-to-end pipeline testing on a real PR | QA + DevOps | 1 |
| **Phase 3 Review** | All | 0.5 |

**Phase 3 Deliverable:** Full CI/CD pipeline running automatically on every PR

---

### Phase 4 — Polish & Hardening (Week 5)

| Task | Owner | Est. Days |
|------|-------|-----------|
| Error handling + retry logic for Gemini API | Dev | 1 |
| Rate limiting + helmet security | Dev | 0.5 |
| Unit tests for core services | Dev | 1 |
| README + setup documentation | Dev | 1 |
| Dashboard: Stats bar + run history view | Dev | 1 |
| Final QA pass + UAT with QA team | QA | 1 |

**Phase 4 Deliverable:** Production-ready tool, documented and tested

---

### Phase 5 — Expectation Chatbot (v1.1)

Spec: `CHATBOT_IMPLEMENTATION_PLAN.md`. Ordered so each step leaves the tree typechecking.

| Task | Owner | Est. Days |
|------|-------|-----------|
| Types in both packages; shared model-JSON extraction helper | Dev | 0.5 |
| `textProvider.ts` (mock first) + `chatPrompt.ts` | Dev | 1 |
| `POST /api/chat` + dedicated rate limit | Dev | 0.5 |
| `buildClassificationPrompt()` refactor + call-time env fix | Dev | 0.5 |
| Thread through provider → classification → compare route; **backwards-compat regression** | Dev | 0.5 |
| Groq and Ollama providers | Dev | 0.5 |
| Frontend: `ExpectationChat`, form and result-card wiring | Dev | 1.5 |
| Unit tests + expectations A/B probe | Dev | 1 |
| **Phase 5 Review & UAT** | QA | 0.5 |

**Phase 5 Deliverable:** the AI takes stated intent into account, without ever hiding a change.

---

### Phase 6 — Live Two-Environment Comparison (v1.1)

Spec: `documentation/WEB_APP_REGRESSION_PLAN.md`. The riskiest item — real-environment SSO login —
is validated early rather than at the end.

| Task | Owner | Est. Days |
|------|-------|-----------|
| Extract `runComparison()` + `dynamicMask.ts`; **regression-test `/api/compare`** | Dev | 1 |
| `http.Server` + Socket.IO wiring; loopback binding; shutdown handlers | Dev | 0.5 |
| Protocol types; `urlGuard.ts` + tests (SEC-10) | Dev | 0.5 |
| `browserPool` · `pane` · `sessionManager` · `socket` — navigation and screencast | Dev | 2 |
| Frontend read-only panes: socket, session hook, canvas frame renderer | Dev | 1.5 |
| Input forwarding: CDP dispatch + coordinate mapping + tests | Dev | 1.5 |
| Capture-and-compare flow end to end | Dev | 1 |
| Dialogs, SSO pop-up adoption, basic auth (FR-71–FR-73) | Dev | 1 |
| Toolbar, capture bar, size-mismatch warning, docs | Dev | 1 |
| Live probe + manual UAT incl. **real staging login** | QA | 1 |
| **Phase 6 Review** | All | 0.5 |

**Phase 6 Deliverable:** navigate two live environments to any authenticated page and compare them in
one click.

---

### Total Estimated Effort

| Phase | Duration | Effort |
|-------|----------|--------|
| Phase 1 — Core MVP | Week 1–2 | ~9 days |
| Phase 2 — Integrations | Week 3 | ~5.5 days |
| Phase 3 — CI/CD | Week 4 | ~4.5 days |
| Phase 4 — Polish | Week 5 | ~5 days |
| **v1.0 subtotal** | **5 weeks** | **~24 person-days** |
| Phase 5 — Expectation Chatbot | Week 6 | ~6.5 days |
| Phase 6 — Live Comparison | Week 7–9 | ~11.5 days |
| **v1.1 total** | **~9 weeks** | **~42 person-days** |

---

## 14. Risks & Mitigations

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|-----------|
| R-01 | Gemini free tier rate limit hit in large test suite | Medium | High | Add delay between requests; batch runs off-peak; upgrade to paid tier if needed |
| R-02 | AI misclassifies intentional changes as bugs | Medium | Medium | **Addressed in v1.1 by §3.8 (FR-52–FR-62):** the QA engineer states expected changes per comparison and they are injected into the classification prompt, replacing the global env-var-only mitigation |
| R-03 | Playwright fails to capture pages behind auth | High | High | **Addressed in v1.1 by §3.9 (FR-63–FR-73):** the engineer logs in manually in a live pane, so no credential injection or scripted auth flow is required |
| R-04 | Jira API token expires silently | Low | Medium | Add integration health check endpoint; alert when token is invalid |
| R-05 | Screenshot sizes differ between environments | High | Low | Auto-resize normalization already built in via Jimp |
| R-06 | CI pipeline too slow (>10 min) for large page sets | Medium | Medium | Run page captures in parallel; limit CI run to smoke pages only |
| R-07 | Sensitive UI data captured in screenshots | Low | High | Ensure screenshots are stored securely; not committed to Git; artifacts auto-expire after 30 days |
| R-08 | Expectation rules are used to silence real regressions, whether deliberately or by imprecise wording | Medium | **High** | FR-56 / SEC-13: rules bias classification but never suppress a finding; the model is instructed to report every change and to lower confidence when evidence contradicts the stated intent. Rules are persisted per run (FR-60) and displayed on the result (FR-61) so any verdict can be audited |
| R-09 | Live mode turns the backend into a browser driven to arbitrary URLs (SSRF-adjacent) | Medium | High | SEC-10 / SEC-11: loopback binding by default, scheme allowlist, cloud-metadata denylist, optional host allowlist. RFC1918 stays reachable deliberately — internal staging is the use case |
| R-10 | Chat traffic exhausts the Gemini free tier and blocks classification | Medium | Medium | FR-57: a separate chat provider with its own credentials and quota, plus a dedicated rate limit for `/api/chat` rather than raising the global one |
| R-11 | Live full-page captures of long SPA pages are truncated or oversized | Medium | Medium | Pre-check page height and offer viewport-only capture; expose a full-page toggle. Chromium truncates silently past its texture limit, so this is detected rather than discovered later |
| R-12 | Before/after captures at different scroll heights inflate the diff percentage | High | Low | Known: `normalizeImageSize` stretches rather than pads. Live mode returns both natural sizes and warns when they differ materially. Changing the normalization strategy is a product decision — it alters diff semantics for every historical run |
| R-13 | Long-lived headless browsers leak memory or orphan processes on Windows | Medium | Medium | FR-75 session cap and idle reaper; explicit shutdown handlers; documented cleanup command in `RUNNING.md` |

---

## 15. Definition of Done

A feature or milestone is considered **Done** when all of the following are true:

- [ ] All functional requirements for the feature are implemented
- [ ] Code is written in TypeScript with no `any` type escapes without comment
- [ ] Unit tests written and passing for all service functions
- [ ] Manual acceptance criteria checked off by a QA engineer (not the developer)
- [ ] No API keys or secrets present in committed code
- [ ] README updated if setup steps changed
- [ ] Feature works end-to-end in a fresh clone environment
- [ ] CI pipeline passes on a test PR

### v1.1 additions to the Definition of Done

- [ ] Every new requirement id is cited in the code that implements it, per the convention already
      used across this codebase
- [ ] A **probe test** exercising the feature end-to-end has been run, and its **actual output is
      recorded** — a claim of success without the output that demonstrates it does not count
- [ ] Anything that failed, was skipped, or could not be verified is reported as such, explicitly.
      Reporting a partially-verified feature as done is a defect in its own right
- [ ] The work is committed on a feature branch — never directly on `main` — and raised as a pull
      request
- [ ] `npm run typecheck` passes for all three packages
- [ ] No secrets committed; `backend/.env` remains gitignored (SEC-01 / SEC-02)

---

## 16. Related Documents

| Document | Purpose |
|---|---|
| `CHATBOT_IMPLEMENTATION_PLAN.md` (repo root) | Implementation spec for §3.8 (FR-52–FR-62) |
| `documentation/WEB_APP_REGRESSION_PLAN.md` | Implementation spec for §3.9 (FR-63–FR-75) |
| `documentation/TEST_PLAN.md` | Executable test plan and requirement traceability matrix |
| `documentation/RUNNING.md` | How to run the tool locally |
| `CLAUDE.md` (repo root) | Engineering context, conventions, and the list of bugs already fixed here |

---

*This document is the single source of truth for the Visual Regression AI Tool project. Any scope changes must be approved by the Project Owner and reflected here before implementation begins.*
