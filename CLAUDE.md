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
breaks the dashboard's images.

---

## Known gaps against the spec

Be aware these are *not* done, so don't assume they work:

- **No test suite exists.** REQUIREMENTS §12 specifies unit tests for `generatePixelDiff`,
  `classifyWithGemini`, `severityToPriority`, and `severityToLabel`, plus integration tests.
  `backend/package.json` has a `test` script wired to jest, but there is no jest config, no
  `ts-jest`, and no test files. The Definition of Done requires these.
- **`severityToPriority` and `severityToLabel` are not exported**, so they aren't testable as-is.
- **HTTP basic auth for staging (FR-08) is unimplemented.** `CaptureConfig.auth` is declared in
  `playwright-service/src/capture.ts` but never read. Playwright's `httpCredentials` is the hook.
- **A page capture failure aborts the whole run (NFR-07).** The loop in `runCapture` has no
  per-page try/catch, so one bad page kills every remaining page.
- **The dashboard's "AI Ready" badge is hardcoded** (FR-44). `getIntegrationStatus()` exists in
  `frontend/src/api/client.ts` and the endpoint works, but nothing calls it.
- **Jira ticket links in `ResultCard.tsx` are `href="#"`** (FR-41). The backend returns the ticket
  key but no base URL, so the link can't be constructed client-side yet.
- **Image normalization stretches rather than pads.** When before/after differ in size,
  `normalizeImageSize` resizes to the max dimensions, distorting content and inflating the diff
  percentage. REQUIREMENTS FR-13 says "auto-resize", so this matches the letter of the spec, but
  padding would produce far more meaningful diffs for full-page screenshots of differing height.
- **There is a junk directory at the repo root** literally named
  `{frontend/src/{components,...},backend/...}` — an unexpanded `mkdir -p` brace pattern created by
  a shell without brace expansion. It's empty and safe to delete.

---

## Working here

- Run `npm run typecheck` at the root to check all three packages.
- After editing backend source, rebuild (`cd backend && npm run build`) if running from `dist/`;
  `npm run dev` uses ts-node-dev and reloads on its own.
- On Windows, `pkill` won't stop the backend. Use:
  `Get-NetTCPConnection -LocalPort 4000 -State Listen | Select -Expand OwningProcess -Unique | ForEach { Stop-Process -Id $_ -Force }`
- `uploads/`, `results/`, and `screenshots/` are gitignored scratch space — delete them freely.
- **Never commit `backend/.env`** (SEC-01/SEC-02). It's gitignored; keep it that way. Ensure the file
  ends with a newline, or appending a variable will silently corrupt the last value.
