# Visual Regression AI Tool — Project Requirements & Plan

**Document Version:** 1.0  
**Last Updated:** August 2026  
**Project Type:** Internal QA Engineering Tool  
**Status:** Planning Phase

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

### Goals
- Reduce false positive visual alerts by 80%
- Eliminate manual screenshot comparison from the QA workflow
- Automatically file bug tickets with screenshot evidence attached
- Integrate into the existing CI/CD pipeline with zero developer friction

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

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | Gemini AI classification response time | < 15 seconds per page |
| NFR-02 | Pixel diff generation time | < 2 seconds per comparison |
| NFR-03 | Playwright screenshot capture time | < 30 seconds per page (including page load) |
| NFR-04 | Full pipeline for 5 pages end-to-end | < 3 minutes |
| NFR-05 | Frontend dashboard initial load time | < 2 seconds |

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
  "github_issue": "https://... (optional)",
  "created_at": "ISO 8601 timestamp"
}
```

### 10.3 Storage Notes

- No database is required for MVP — JSON files on disk are sufficient
- For production, consider migrating to **PostgreSQL** or **SQLite**
- Screenshot files should be cleaned up after 30 days (add a cron job)
- Max upload size per screenshot: **10 MB**

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

---

## 12. Test Plan

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

### Total Estimated Effort

| Phase | Duration | Effort |
|-------|----------|--------|
| Phase 1 — Core MVP | Week 1–2 | ~9 days |
| Phase 2 — Integrations | Week 3 | ~5.5 days |
| Phase 3 — CI/CD | Week 4 | ~4.5 days |
| Phase 4 — Polish | Week 5 | ~5 days |
| **Total** | **5 weeks** | **~24 person-days** |

---

## 14. Risks & Mitigations

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|-----------|
| R-01 | Gemini free tier rate limit hit in large test suite | Medium | High | Add delay between requests; batch runs off-peak; upgrade to paid tier if needed |
| R-02 | AI misclassifies intentional changes as bugs | Medium | Medium | Tune the prompt with project-specific context; add feedback loop for QA to correct classifications |
| R-03 | Playwright fails to capture pages behind auth | High | High | Implement cookie/session injection in capture config; add auth flow support |
| R-04 | Jira API token expires silently | Low | Medium | Add integration health check endpoint; alert when token is invalid |
| R-05 | Screenshot sizes differ between environments | High | Low | Auto-resize normalization already built in via Jimp |
| R-06 | CI pipeline too slow (>10 min) for large page sets | Medium | Medium | Run page captures in parallel; limit CI run to smoke pages only |
| R-07 | Sensitive UI data captured in screenshots | Low | High | Ensure screenshots are stored securely; not committed to Git; artifacts auto-expire after 30 days |

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

---

*This document is the single source of truth for the Visual Regression AI Tool project. Any scope changes must be approved by the Project Owner and reflected here before implementation begins.*
