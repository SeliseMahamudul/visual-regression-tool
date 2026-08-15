/**
 * Expectations probe — TEST_PLAN §5.3.
 *
 * The A/B that proves the chatbot actually influences classification.
 *
 * **Requires a REAL vision model.** `mockProvider` in visionProvider.ts is a
 * pure function of diff_percentage and ignores `expectations` by design, so it
 * physically cannot demonstrate this. Run the backend with:
 *
 *   cd backend; $env:VISION_PROVIDER='gemini'; npm run build; npm start
 *   node test/probe/expectations-probe.mjs
 *
 * Same image pair submitted twice:
 *   Run A — no expectations.            Expect: BUG, elevated severity.
 *   Run B — expected: ["...the left nav was intentionally removed"].
 *                                       Expect: INTENTIONAL_CHANGE, or BUG at
 *                                       lower severity/confidence, with an
 *                                       explanation referencing the stated intent.
 *
 * FR-56 is asserted separately and is NOT optional: run B's explanation must
 * STILL describe the change. If run B comes back "no significant change
 * detected", the feature is suppressing findings and must be fixed before merge.
 *
 * This probe is inherently non-deterministic (it is an LLM). Treat a single
 * disagreement as a signal to re-run and inspect, not as a hard CI gate.
 */
import { PNG } from 'pngjs';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BACKEND = process.env.BACKEND || 'http://127.0.0.1:4000';

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

// ─── Fixtures: the left navigation removed, content reflowed ───────────────
// Generated at runtime so nothing binary is committed for this probe alone.
// Deterministic: same bytes on every run.
//
// TEST_PLAN §5.3 suggests "nav bar visibly moved". That scenario was tried
// first and produced NO headroom: the vision model classified it
// INTENTIONAL_CHANGE/medium even with no expectations, because a schematic nav
// relocation reads as a tidy redesign on its own. An A/B with nothing to shift
// proves nothing. This uses REQUIREMENTS §12.3's canonical bug case instead —
// missing navigation — which a model reliably calls BUG without context, so
// the effect of the expectation rules is actually measurable.

const W = 800;
const H = 500;

function rect(png, x0, y0, x1, y1, [r, g, b]) {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
      const i = (y * W + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
}

const PAGE = [248, 250, 252];
const HEADER = [30, 41, 59];
const NAV_ITEM = [226, 232, 240];
const SIDEBAR = [241, 245, 249];
const CARD = [255, 255, 255];
const CARD_EDGE = [203, 213, 225];
const LOGO = [37, 99, 235];

/** withNav=true → the baseline; false → the left navigation is gone. */
function build(withNav) {
  const png = new PNG({ width: W, height: H });
  rect(png, 0, 0, W, H, PAGE);

  // Header bar + logo, identical in both.
  rect(png, 0, 0, W, 64, HEADER);
  rect(png, 24, 20, 120, 44, LOGO);

  if (withNav) {
    // Left sidebar column with four navigation items.
    rect(png, 0, 64, 200, H, SIDEBAR);
    for (let i = 0; i < 4; i++) {
      rect(png, 24, 100 + i * 48, 176, 132 + i * 48, NAV_ITEM);
    }
  }

  // Content cards. With the nav present they sit to its right; without it they
  // reflow to fill the width — so the layout itself is never broken, only the
  // navigation is missing.
  const originX = withNav ? 240 : 40;
  const cardW = withNav ? 250 : 350;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const x = originX + col * (cardW + 30);
      const y = 100 + row * 180;
      rect(png, x, y, x + cardW, y + 150, CARD_EDGE);
      rect(png, x + 2, y + 2, x + cardW - 2, y + 148, CARD);
    }
  }
  return PNG.sync.write(png);
}

const dir = mkdtempSync(join(tmpdir(), 'vr-exp-probe-'));
const beforePath = join(dir, 'before.png');
const afterPath = join(dir, 'after.png');
writeFileSync(beforePath, build(true));
writeFileSync(afterPath, build(false));

// ─── Submission ─────────────────────────────────────────────────────────────

const EXPECTATIONS = {
  expected: [
    'the left navigation sidebar was intentionally removed and the content reflowed to fill the space',
  ],
  unexpected: [],
  ignore: [],
  summary: 'The left navigation sidebar was deliberately removed this sprint.',
  raw: 'We intentionally removed the left navigation sidebar this sprint and let the content reflow to fill the full width. Navigation has moved elsewhere in the product.',
};

async function compare(runId, expectations) {
  const form = new FormData();
  // Files first, then text fields — the ordering every other client uses
  // (CLAUDE.md gotcha #2).
  form.append('before', new Blob([readFileSync(beforePath)], { type: 'image/png' }), 'before.png');
  form.append('after', new Blob([readFileSync(afterPath)], { type: 'image/png' }), 'after.png');
  form.append('run_id', runId);
  form.append('page_name', 'Expectations Probe');
  if (expectations) form.append('expectations', JSON.stringify(expectations));

  const res = await fetch(`${BACKEND}/api/compare`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(`compare ${runId} failed (HTTP ${res.status}): ${body.error ?? '(no error)'}`);
  }
  return body.result;
}

const SEVERITY_RANK = { none: 0, low: 1, medium: 2, critical: 3 };

function report(label, result) {
  const c = result.classification;
  console.log(`\n─── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}`);
  console.log(`  classification:     ${c.classification}`);
  console.log(`  severity:           ${c.severity}`);
  console.log(`  confidence:         ${c.confidence}`);
  console.log(`  diff_percentage:    ${c.diff_percentage.toFixed(2)}%`);
  console.log(`  component:          ${c.component}`);
  console.log(`  explanation:        ${c.explanation}`);
  console.log(`  recommended_action: ${c.recommended_action}`);
  console.log(`  expectations key:   ${result.expectations ? 'present' : 'absent'}`);
}

async function main() {
  const health = await fetch(`${BACKEND}/health`).then((r) => r.json());
  console.log(`Backend ${BACKEND} — gemini key configured: ${health.env.gemini}`);
  if (!health.env.gemini) {
    console.error(
      '\nERROR: the backend reports no GEMINI_API_KEY. This probe needs a REAL vision\n' +
        'model — mockProvider ignores expectations by design and cannot prove anything\n' +
        'here. Start the backend with VISION_PROVIDER=gemini and a valid key.'
    );
    process.exit(2);
  }

  const stamp = Date.now();
  const a = await compare(`probe-exp-a-${stamp}`, undefined);
  const b = await compare(`probe-exp-b-${stamp}`, EXPECTATIONS);

  report('Run A — NO expectations', a);
  report('Run B — WITH expectations', b);
  console.log('');

  const ca = a.classification;
  const cb = b.classification;

  // 1. The images really do differ — otherwise both runs are meaningless.
  check(
    'the fixture pair produces a non-zero pixel diff',
    ca.diff_percentage > 0,
    `${ca.diff_percentage.toFixed(2)}%`
  );

  // 2. FR-60: run B's rules are persisted with the result.
  check(
    'run B persists the expectations it was given (FR-60)',
    !!b.expectations && b.expectations.expected.length === 1,
    JSON.stringify(b.expectations?.expected)
  );

  // 3. Backwards compatibility: run A carries no expectations key at all.
  check('run A carries no expectations key (backwards compatibility)', !('expectations' in a));

  // 4. The measurable shift. Any of: reclassified away from BUG, lower
  //    severity, or lower confidence in the same BUG verdict.
  const reclassified = ca.classification === 'BUG' && cb.classification !== 'BUG';
  const lessSevere = SEVERITY_RANK[cb.severity] < SEVERITY_RANK[ca.severity];
  const lessConfidentBug =
    ca.classification === 'BUG' && cb.classification === 'BUG' && cb.confidence < ca.confidence;
  check(
    'run B is measurably less severe than run A (FR-55)',
    reclassified || lessSevere || lessConfidentBug,
    `A=${ca.classification}/${ca.severity}/${ca.confidence} → B=${cb.classification}/${cb.severity}/${cb.confidence}`
  );

  // 5. The explanation references the stated intent.
  const intentWords =
    /intent|intention|deliberate|expected|removed|reflow|as (stated|described)|QA engineer/i;
  check(
    "run B's explanation references the stated intent",
    intentWords.test(cb.explanation),
    cb.explanation.slice(0, 120)
  );

  // 6. FR-56 — THE safety property. Non-negotiable: an expected change is
  //    still reported, never hidden. "No significant change detected" here is
  //    a defect, not a pass.
  const describesChange =
    cb.explanation.trim().length > 20 &&
    !/no (significant |visual |meaningful )?(change|difference)s? (was |were )?(detected|found|observed)/i.test(
      cb.explanation
    ) &&
    /nav|header|sidebar|menu|removed|missing|reflow|width/i.test(cb.explanation);
  check(
    'FR-56: run B STILL reports and describes the change, it is not hidden',
    describesChange,
    cb.explanation.slice(0, 160)
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('Failed: ' + failed.map((f) => f.label).join('; '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nProbe error:', err.message);
  process.exit(1);
});
