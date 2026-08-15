# Test Plan — Proving the Visual Regression Tool Works

**Document Version:** 1.0
**Created:** 2026-08-15
**Status:** Approved for implementation
**Owner:** QA Engineering

---

## 1. Purpose and scope

This plan makes "the functionality is achieved" a **demonstrable claim rather than an assertion**.
Every requirement id in `documentation/REQUIREMENTS.md` — existing and newly allocated — maps to a
specific test, and every test states its pass condition in terms of observable output.

It covers three things:

1. **The existing baseline** — what is already proven, so nobody re-does it.
2. **The two new features** — the expectation chatbot (`CHATBOT_IMPLEMENTATION_PLAN.md`) and live
   two-environment comparison (`WEB_APP_REGRESSION_PLAN.md`).
3. **End-to-end probes** that exercise the real pipeline, not mocks of it.

### Guiding principle

> A test that cannot fail proves nothing.

Two rules follow, and both are enforced in the execution contract (§8):

- **Show the output.** Paste real command output into the report. Never write "tests pass" without
  the run that says so.
- **Prove the negative.** For every "it works" test, there is a companion establishing that the test
  would have caught the failure — the live-mode input probe asserts frame bytes *change* after a
  synthetic click, because a socket that silently swallows input would otherwise look identical to
  one that works.

---

## 2. Current baseline — already proven, do not redo

**A working test suite exists.** Anyone starting from the older "no test suite exists" note in
`CLAUDE.md` is reading a stale gap list.

```
backend/jest.config.js          preset: ts-jest, testEnvironment: node,
                                roots: <rootDir>/src, testMatch: **/*.test.ts,
                                setupFiles: <rootDir>/src/test/setupEnv.ts
backend/src/test/setupEnv.ts    forces VISION_PROVIDER=mock, blanks every API key,
                                redirects UPLOADS_DIR/RESULTS_DIR to .tmp-* dirs
```

`backend/package.json` already has `ts-jest`, `@types/jest`, `supertest`, and `@types/supertest`.

Verified baseline as of 2026-08-15:

```
Test Suites: 5 passed, 5 total
Tests:       34 passed, 34 total
Time:        ~6 s
```

| Suite | Covers | Requirement ids |
|---|---|---|
| `src/services/pixelDiff.test.ts` | `generatePixelDiff` (0% on identical, proportional %, size normalization), `resolveThreshold` | §12.1, FR-13, FR-14 |
| `src/services/aiClassification.test.ts` | `parseClassificationResponse` (clean JSON, fences, out-of-contract enums, confidence clamp, non-JSON), `classifyWithGemini` error mapping (429/404/401), mock provider without a key | §12.1, FR-16, FR-20, FR-21, NFR-06 |
| `src/services/jiraService.test.ts` | `severityToPriority`, `jiraIssueUrl` | FR-26, FR-41 |
| `src/services/githubService.test.ts` | `severityToLabel` | FR-32 |
| `src/routes/compare.test.ts` | All five §12.2 integration scenarios via supertest | §12.2, FR-46, FR-47, FR-48, NFR-09 |

**REQUIREMENTS §12.1 and §12.2 are therefore fully satisfied today.** `severityToPriority` and
`severityToLabel` are exported and tested. The suite is hermetic: no API key, no network, no reliance
on a dev `.env`.

### What the baseline does *not* cover

These are the real gaps this plan closes:

- No test touches `visionPrompt.ts` — the prompt can be broken silently.
- No test touches `visionProvider.ts`'s Gemini request construction (§7.1 payload shape, multi-part
  text joining, `MAX_TOKENS` handling — all `CLAUDE.md` gotchas #6 and #7).
- No frontend tests at all, in any package.
- No end-to-end test against a real browser or a real page.
- No test asserts the on-disk storage layout of REQUIREMENTS §10.1.

---

## 3. Test harness additions

The backend harness needs no changes — it works. Two additions:

### 3.1 Fixtures

```
test/fixtures/
├── stage/index.html        Reference environment
├── dev/index.html          Candidate: button #7c3aed → #dc2626, sidebar margin shifted 12px
├── before.png              Small deterministic PNG pair used by CLI probes
└── after.png
```

`stage/` and `dev/` are byte-identical **except** the two deliberate differences, and both carry a
JS-only login form (any credentials; sets `sessionStorage` and swaps to a "Dashboard" view). The
login form is not decoration — it is what makes the *manual login* path in live mode testable without
a real staging environment, and it doubles as the demo.

These are **committed**. `uploads/`, `results/`, and `screenshots/` stay gitignored.

### 3.2 Probe scripts

```
test/probe/live-probe.mjs        Headless socket.io-client driver for live mode (§5.2)
test/probe/expectations-probe.mjs A/B classification with and without expectations (§5.3)
```

Both are plain Node ESM, runnable standalone, and print machine-checkable output. They are **not**
jest tests: they need a running backend and real fixture servers, and conflating that with the
hermetic unit suite would make `npm test` slow and flaky.

---

## 4. Unit and integration tests to add

### 4.1 Chatbot feature

| File | Test | Proves |
|---|---|---|
| `src/services/visionPrompt.test.ts` | `buildClassificationPrompt()` with no args is byte-identical to the pre-refactor `CLASSIFICATION_PROMPT` | The refactor changed nothing for existing runs |
| | Reads `VR_PROJECT_CONTEXT` **at call time** — set the env var *after* import and assert it appears | `CLAUDE.md` gotcha #1 is not reintroduced |
| | With expectations: output contains `raw` verbatim, all three rule groups, and the "still report every change" instruction | FR-55, **FR-56** |
| | Empty arrays produce no empty headings | Prompt hygiene |
| `src/services/textProvider.test.ts` | Mock provider: "must not change" → `unexpected`; "ignore timestamps" → `ignore`; plain statement → `expected` | FR-53, FR-59 |
| | `validateExpectationRules` on `null`, `[]`, `{expected: "string"}`, 500 items, a 10 000-char entry → never throws, always returns a normalised object, caps at 20 items / 500 chars | **FR-62**, SEC-12 |
| | `getTextProvider()` defaults to `mock`; unknown name throws naming the valid options | FR-58 |
| `src/services/jsonFromModel.test.ts` | `extractJsonObject` on clean JSON, fenced JSON, preamble + JSON, garbage | Shared helper matches the behaviour it replaced |
| `src/routes/chat.test.ts` | Valid `messages` → 200 with well-formed `ExpectationRules` | FR-52, FR-53 |
| | `messages` missing / not an array / 21 items / 5 000-char content → 400 with an actionable message | NFR-09, SEC-12 |
| | `rules.raw` equals the concatenated **user** messages, never model output | SEC-12 |
| `src/routes/compare.test.ts` (extend) | Valid `expectations` field → persisted in the result JSON | **FR-60** |
| | `expectations=not-json-at-all` → still 200 | **FR-62** |
| | **No `expectations` field → byte-identical response shape to the current baseline** | Backwards compatibility |

### 4.2 Live comparison feature

| File | Test | Proves |
|---|---|---|
| `src/live/urlGuard.test.ts` | `http://` and `https://` accepted | SEC-10 |
| | `file:///C:/…/backend/.env`, `data:`, `javascript:`, `chrome:`, `view-source:` **rejected** | SEC-10 — the secret-exfiltration path |
| | `http://169.254.169.254/…` and `metadata.google.internal` rejected | SEC-10 |
| | `http://192.168.1.50:4200` **accepted** | RFC1918 is deliberately allowed — staging lives there |
| | `LIVE_URL_ALLOWLIST=*.stage.corp` → matching accepted, others rejected; empty → all http(s) accepted | SEC-10 |
| `src/live/sessionManager.test.ts` | `newSessionId()` satisfies `/^[A-Za-z0-9_-]{1,128}$/` across 1 000 generations | `CLAUDE.md` gotcha #8 |
| | Derived run ids `${sessionId}-c${n}` are unique per capture and also satisfy the regex | **FR-70**, gotcha #4 |
| | Creating session 4 with a cap of 3 → `SESSION_LIMIT` | FR-75 |
| | Idle reaper closes a session past its deadline; a `touch()` inside the window prevents it | FR-75 |
| `src/live/inputMap.test.ts` *(logic mirrored from the frontend)* | Coordinate translation: centre click on a 640-px-wide canvas showing a 1280-px frame → `x = 640` | FR-64 |
| | `pageScaleFactor: 2` and `offsetTop: 50` handled correctly | FR-64 |
| | `scrollOffsetY` is **not** added to `y` | The most likely silent bug in the feature |
| | Modifier bitmask: Shift→8, Ctrl→2, Alt→1, Meta→4, and combinations | FR-64 |
| `src/services/comparisonRunner.test.ts` | `runComparison()` produces the REQUIREMENTS §10.1 layout: `uploads/{runId}/`, `results/{runId}/{id}.json`, `{runId}_diff.png` | FR-50, §10.1 |
| | `toApiUrls()` rewrites exactly the three screenshot fields and touches nothing else | FR-69 |
| | `onProgress` fires `diffing` → `classifying` in order | Live progress UI |

**The coordinate-translation tests matter more than they look.** That arithmetic is the single most
bug-prone piece of the live feature, it is pure and therefore trivially unit-testable, and a
regression in it produces "clicks land in the wrong place sometimes" — which is nearly impossible to
diagnose from a bug report.

### 4.3 Backfill for existing gaps

| File | Test | Proves |
|---|---|---|
| `src/services/visionProvider.test.ts` | Gemini request body: `parts` order is prompt, before, after, diff, contextLine; `inline_data.mime_type` from extension; `responseMimeType: 'application/json'`; `maxOutputTokens: 2048` | REQUIREMENTS §7.1 |
| | A response with `finishReason: 'MAX_TOKENS'` throws a **named** error, not a parse error | Gotcha #6 |
| | A multi-part response joins **every** `parts[].text`, not just `[0]` | Gotcha #7 |
| | Unknown `VISION_PROVIDER` throws listing valid options | FR-22 |

These are cheap (axios mocked, no network) and they lock down three documented gotchas that currently
have no regression protection at all.

---

## 5. End-to-end probes

Probes need a running backend. All run with `VISION_PROVIDER=mock` and `CHAT_PROVIDER=mock` — no API
key, no network, deterministic.

### 5.1 Refactor regression — run FIRST

`WEB_APP_REGRESSION_PLAN.md` extracts `runComparison()` out of `routes/compare.ts`. Before any live
code is trusted, prove the HTTP path is unchanged:

```powershell
$env:VISION_PROVIDER = 'mock'
cd backend; npm run build; npm start     # separate terminal

curl.exe -s -F "before=@test/fixtures/before.png" -F "after=@test/fixtures/after.png" `
  -F "run_id=probe-regress-1" -F "page_name=Regression" http://localhost:4000/api/compare
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:4000/api/screenshots/probe-regress-1/before
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:4000/api/screenshots/probe-regress-1/diff
```

**Pass:** `success: true`; `before_screenshot` is `/api/screenshots/probe-regress-1/before`; both
image fetches return 200. Plus `cd backend; npm test` still reports **34+ passed, 0 failed**.

### 5.2 Live mode probe

Fixture servers:

```powershell
Start-Process powershell -ArgumentList '-NoExit','-Command','npx --yes http-server test/fixtures/stage -p 8081 -c-1'
Start-Process powershell -ArgumentList '-NoExit','-Command','npx --yes http-server test/fixtures/dev   -p 8082 -c-1'
node test/probe/live-probe.mjs
```

The probe: connect to `/live` → `session:create` against :8081/:8082 → count frames per side for 5 s →
synthetic click on the login button, `kind:'text'`, then `Enter` → count frames again → `capture:run`
→ print the result.

**Every one of these must hold:**

| # | Assertion | Why it is there |
|---|---|---|
| 1 | Both panes deliver ≥ 1 frame within 3 s | Screencast starts on both |
| 2 | **Both** panes keep producing frames across the full 5 s window | The specific test for background-tab throttling freezing one pane. Non-zero on **both** sides is the pass condition |
| 3 | Post-click frames differ in byte length from pre-click frames | Input reached the **renderer**, not merely the socket. Without this, a no-op input path passes |
| 4 | `capture:progress` arrives in order `pausing → capturing → diffing → classifying → done` | Capture sequence integrity |
| 5 | `runId` matches `/^live-[a-z0-9]+-[0-9a-f]{8}-c1$/` **and** `/^[A-Za-z0-9_-]{1,128}$/` | FR-70, gotcha #8 |
| 6 | `result.before_screenshot === '/api/screenshots/{runId}/before'` | FR-69 |
| 7 | `result.classification.diff_percentage > 0` | Fixtures differ by design. Zero means both panes captured the **same** page — the failure this whole feature would otherwise hide |
| 8 | Frames resume on both panes after capture | The `finally` restart works |

Then the on-disk layout (REQUIREMENTS §10.1):

```powershell
Get-ChildItem backend/uploads/<runId>      # before_*.png, after_*.png
Get-ChildItem backend/results/<runId>      # <runId>_diff.png + <uuid>.json
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:4000/api/screenshots/<runId>/diff
```

### 5.3 Expectations probe

The A/B that proves the chatbot actually influences classification. **Requires a real vision model** —
`mockProvider` is a pure function of `diff_percentage` and ignores expectations by design, so it
cannot demonstrate this.

```powershell
$env:VISION_PROVIDER = 'gemini'    # needs GEMINI_API_KEY
node test/probe/expectations-probe.mjs
```

Same image pair (nav bar visibly moved), submitted twice:

- **Run A** — no expectations. Expected: `BUG`, elevated severity.
- **Run B** — `expected: ["the navigation bar was intentionally moved into the header"]`.
  Expected: `INTENTIONAL_CHANGE`, or `BUG` with **lower** severity/confidence and an explanation that
  references the stated intent.

**Pass:** Run B's classification is measurably less severe than Run A's, and its explanation
references the intent. **Also assert Run B's explanation still describes the change** — FR-56. If run
B returns "no significant change detected", the feature is suppressing findings and **must be fixed
before merge**, not shipped.

This probe is inherently non-deterministic (it is an LLM). Treat a single disagreement as a signal to
re-run and inspect, not as a hard CI gate. Record the actual outputs in the report either way.

### 5.4 REQUIREMENTS §12.3 scenarios

| Scenario | Steps | Expected |
|---|---|---|
| No visual change | Upload identical screenshots | 0% diff; `DYNAMIC_CONTENT` or `INTENTIONAL_CHANGE` |
| Bug detection | Nav bar removed | `BUG`, `critical` |
| Colour change only | Button recoloured | `INTENTIONAL_CHANGE` or `BUG`, `medium` |
| CI pipeline | Open a test PR | Playwright captures, AI classifies, PR comment posted |

---

## 6. Manual acceptance criteria

In the style of REQUIREMENTS §12.4. **Checked off by a QA engineer, not the developer** (Definition
of Done).

### Existing functionality — must not regress
- [ ] Drag-and-drop upload of two screenshots still works
- [ ] Classification appears within 15 s (NFR-01)
- [ ] Side-by-side / diff / before / after toggles work (FR-38)
- [ ] Stats bar counts are correct (FR-39)
- [ ] Two consecutive comparisons each show their **own** images (gotcha #4)
- [ ] The "AI Ready" badge reflects real integration status (FR-44)

### Chatbot
- [ ] Chat panel is discoverable without instruction
- [ ] Typing an expectation returns extracted rules within a few seconds
- [ ] Rules are shown for confirmation **before** being applied (FR-54)
- [ ] An incorrectly extracted rule can be deleted without retyping everything
- [ ] Rules are visible on the result card afterwards (FR-61)
- [ ] A comparison with **no** chat input behaves exactly as before
- [ ] **An expected change is still reported, not hidden** (FR-56) — the safety property

### Live comparison
- [ ] Two URLs open as interactive panes inside the dashboard (FR-63)
- [ ] Typing goes only to the focused pane, and which pane has focus is **visible** (FR-64)
- [ ] Wheel-scrolling a pane does not scroll the dashboard behind it
- [ ] The two panes navigate independently (FR-65)
- [ ] Logging into both as different users does not cross-contaminate; reloading one keeps its own
      session (**FR-66**)
- [ ] Back / forward / reload / URL bar work per pane (FR-67)
- [ ] One click captures both and produces a result card (FR-68, FR-69)
- [ ] A second capture does not overwrite the first (FR-70)
- [ ] Reloading the dashboard reattaches to the live session, still logged in (FR-74)
- [ ] A JS `confirm()` appears as a modal instead of being silently dismissed (FR-72)
- [ ] An SSO popup is adopted into the pane and login completes (FR-73)
- [ ] `file:///…/backend/.env` in a URL bar is rejected (SEC-10)
- [ ] The backend is unreachable from another machine on the LAN (SEC-11)

---

## 7. Traceability matrix

| Requirement | Test | Status |
|---|---|---|
| FR-10…FR-14 | `pixelDiff.test.ts` | ✅ baseline |
| FR-16, FR-17, FR-20 | `aiClassification.test.ts` | ✅ baseline |
| FR-21, NFR-06 | `aiClassification.test.ts` error mapping | ✅ baseline |
| FR-22 | `visionProvider.test.ts` unknown-provider | ➕ §4.3 |
| FR-26 | `jiraService.test.ts` | ✅ baseline |
| FR-32 | `githubService.test.ts` | ✅ baseline |
| FR-41 | `jiraService.test.ts` `jiraIssueUrl` | ✅ baseline |
| FR-46…FR-48 | `compare.test.ts` | ✅ baseline |
| FR-50, §10.1 | `comparisonRunner.test.ts` + probe §5.2 | ➕ new |
| §7.1 payload, gotchas #6/#7 | `visionProvider.test.ts` | ➕ §4.3 |
| FR-52, FR-53 | `chat.test.ts`, `textProvider.test.ts` | ➕ new |
| FR-54, FR-61 | Manual §6 | ➕ new |
| FR-55 | `visionPrompt.test.ts` | ➕ new |
| **FR-56** | `visionPrompt.test.ts` + probe §5.3 + manual §6 | ➕ new |
| FR-57, FR-58, FR-59 | `textProvider.test.ts` | ➕ new |
| FR-60, FR-62 | `compare.test.ts` extension | ➕ new |
| FR-63, FR-67 | Manual §6 | ➕ new |
| FR-64 | `inputMap.test.ts` + probe §5.2 #3 | ➕ new |
| FR-65, FR-66 | Manual §6 | ➕ new |
| FR-68, FR-69 | Probe §5.2 #4–#7 | ➕ new |
| FR-70 | `sessionManager.test.ts` + probe #5 + manual | ➕ new |
| FR-71, FR-72, FR-73 | Manual §6 | ➕ new |
| FR-74 | Manual §6 | ➕ new |
| FR-75 | `sessionManager.test.ts` | ➕ new |
| SEC-10 | `urlGuard.test.ts` + manual | ➕ new |
| SEC-11 | Probe §5.2 loopback check + manual | ➕ new |
| SEC-12, SEC-13 | `textProvider.test.ts`, `chat.test.ts` | ➕ new |
| NFR-09 | `chat.test.ts` 400s + baseline | ✅/➕ |
| NFR-13 | `npm run typecheck` (all three packages) | ✅ baseline |

**Known uncovered, stated honestly:** FR-01…FR-09 (Playwright CLI capture) have no automated tests —
they are exercised only by the CI workflow on a real PR. FR-23…FR-25, FR-27…FR-31, FR-33…FR-35
(actual Jira/GitHub ticket creation) are tested only at the mapping-function level; the API calls
themselves are never exercised against a real instance. FR-45 and FR-09 remain unimplemented
Could-Haves. Do not claim otherwise.

---

## 8. Execution contract

**The implementing agent must complete every step below. This is not optional and not negotiable.**

### 1. Implement
Write the tests and fixtures in this plan. TypeScript strict (NFR-13); no `any` without a comment.
Cite requirement ids in test names, matching the existing convention (`'normalizes an out-of-contract
classification to NEEDS_REVIEW (FR-16)'`).

### 2. Run the probe tests and prove they pass

```powershell
npm run typecheck              # root — all three packages
cd backend; npm test           # must be 34 + new, 0 failed
```

Then, with the backend and both fixture servers running:

```powershell
node test/probe/live-probe.mjs
node test/probe/expectations-probe.mjs     # needs GEMINI_API_KEY
```

Plus the §5.1 refactor regression and the §5.2 on-disk layout checks.

**Paste the actual command output into the final report — the full jest summary line and the probe
output. Do not assert success; show it.**

Success criteria:
- Jest: `0 failed`, and the total is **greater than the 34-test baseline**. A suite that did not grow
  did not add coverage.
- Every §5.2 assertion #1–#8 holds.
- §5.3 shows a measurable classification shift **and** confirms the change is still reported (FR-56).
- `npm run typecheck` clean across all three packages.

### 3. Debug and prove the fix
If anything fails, **debug and resolve it**, then re-run and show the passing output. Do not delete,
skip, or weaken a test to make it pass — if a test is wrong, say why in the report and fix the test
deliberately.

A step that was skipped, or that still fails, **must be reported as such**. If `expectations-probe`
could not run for lack of a `GEMINI_API_KEY`, say that plainly rather than implying it passed.

### 4. Commit
```powershell
git checkout -b test/regression-tool-verification
git add -A
git commit    # never commit backend/.env (SEC-01/SEC-02)
git push -u origin test/regression-tool-verification
```
Never commit directly to `main`. Confirm `test/fixtures/` and `test/probe/` are committed, and that
`uploads/`, `results/`, `screenshots/`, and `backend/src/test/.tmp-*` are **not**.

### 5. Raise a pull request
Against `main` on `https://github.com/SeliseMahamudul/visual-regression-tool`.

**The `gh` CLI is not installed on this machine.** Either install it
(`winget install --id GitHub.cli`) then `gh pr create --fill`, or output this URL for the user:
```
https://github.com/SeliseMahamudul/visual-regression-tool/compare/main...test/regression-tool-verification?expand=1
```

### 6. Report back
- The PR link.
- The full jest summary and probe output.
- The traceability matrix updated with real pass/fail status.
- What was **not** verified and why — stated plainly.
- Any deviation from this plan and the reason for it.
