import { chromium, Browser, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import dotenv from 'dotenv';

dotenv.config();

export interface PageConfig {
  name: string;
  path: string;
  wait_for_selector?: string;
  wait_ms?: number;
  viewport?: { width: number; height: number };
}

export interface CaptureConfig {
  base_url_before: string;
  base_url_after: string;
  pages: PageConfig[];
  run_id: string;
  output_dir: string;
  backend_url: string;
  auto_file_bugs: boolean;
  jira_project_key?: string;
  github_owner?: string;
  github_repo?: string;
  pr_number?: string;
  default_viewport?: { width: number; height: number };
  auth?: {
    username?: string;
    password?: string;
    login_url?: string;
    login_selector?: string;
  };
}

async function captureScreenshot(
  page: Page,
  url: string,
  outputPath: string,
  config: PageConfig
): Promise<void> {
  console.log(`  📸 Capturing: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  if (config.wait_for_selector) {
    await page.waitForSelector(config.wait_for_selector, { timeout: 10000 });
  }

  if (config.wait_ms) {
    await page.waitForTimeout(config.wait_ms);
  }

  // Hide dynamic elements that cause false positives
  await page.addStyleTag({
    content: `
      [data-testid="timestamp"],
      [data-testid="avatar"],
      .dynamic-ad,
      iframe[id^="google_ads"],
      .live-counter { visibility: hidden !important; }
    `,
  });

  await page.screenshot({
    path: outputPath,
    fullPage: true,
    animations: 'disabled',
  });
}

async function submitForAnalysis(
  beforePath: string,
  afterPath: string,
  config: CaptureConfig,
  pageName: string
): Promise<any> {
  const form = new FormData();
  form.append('before', fs.createReadStream(beforePath), 'before.png');
  form.append('after', fs.createReadStream(afterPath), 'after.png');
  form.append('run_id', config.run_id);
  form.append('page_name', pageName);
  form.append('auto_file_bugs', String(config.auto_file_bugs));

  if (config.jira_project_key) form.append('jira_project_key', config.jira_project_key);
  if (config.github_owner) form.append('github_owner', config.github_owner);
  if (config.github_repo) form.append('github_repo', config.github_repo);
  if (config.pr_number) form.append('pr_number', config.pr_number);

  const response = await axios.post(`${config.backend_url}/api/compare`, form, {
    headers: form.getHeaders(),
    timeout: 60000,
  });

  return response.data;
}

export async function runCapture(config: CaptureConfig): Promise<void> {
  if (!fs.existsSync(config.output_dir)) {
    fs.mkdirSync(config.output_dir, { recursive: true });
  }

  console.log('\n🚀 Visual Regression Capture Starting');
  console.log(`📋 Run ID: ${config.run_id}`);
  console.log(`🔗 Before URL: ${config.base_url_before}`);
  console.log(`🔗 After URL:  ${config.base_url_after}`);
  console.log(`📄 Pages: ${config.pages.length}\n`);

  const browser: Browser = await chromium.launch({ headless: true });
  const results: any[] = [];

  try {
    for (const pageConfig of config.pages) {
      console.log(`\n▶ Processing: ${pageConfig.name}`);

      const context = await browser.newContext({
        viewport: pageConfig.viewport || config.default_viewport || { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });

      const page = await context.newPage();
      const safeName = pageConfig.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

      const beforePath = path.join(config.output_dir, `${safeName}_before.png`);
      const afterPath = path.join(config.output_dir, `${safeName}_after.png`);

      // Capture BEFORE
      await captureScreenshot(
        page,
        `${config.base_url_before}${pageConfig.path}`,
        beforePath,
        pageConfig
      );

      // Capture AFTER
      await captureScreenshot(
        page,
        `${config.base_url_after}${pageConfig.path}`,
        afterPath,
        pageConfig
      );

      await context.close();

      // Submit for AI analysis
      console.log(`  🤖 Submitting to AI for analysis...`);
      const result = await submitForAnalysis(beforePath, afterPath, config, pageConfig.name);
      results.push(result);

      const { classification } = result.result;
      const icon =
        classification.classification === 'BUG'
          ? '🐛'
          : classification.classification === 'NEEDS_REVIEW'
          ? '⚠️'
          : '✅';
      console.log(
        `  ${icon} ${classification.classification} [${classification.severity}] — ${classification.component}`
      );
      console.log(`     ${classification.explanation}`);
      if (result.result.jira_ticket) console.log(`  🎫 Jira: ${result.result.jira_ticket}`);
      if (result.result.github_issue) console.log(`  🐙 GitHub: ${result.result.github_issue}`);
    }
  } finally {
    await browser.close();
  }

  // Summary
  const bugs = results.filter(
    (r) =>
      r.result?.classification?.classification === 'BUG' ||
      r.result?.classification?.classification === 'NEEDS_REVIEW'
  );

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 VISUAL REGRESSION SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total Pages: ${results.length}`);
  console.log(`Issues Found: ${bugs.length}`);
  console.log(`Clean: ${results.length - bugs.length}`);

  // Save summary
  const summaryPath = path.join(config.output_dir, 'summary.json');
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({ run_id: config.run_id, results, summary: { total: results.length, bugs: bugs.length } }, null, 2)
  );
  console.log(`\n📄 Full report saved to: ${summaryPath}`);

  // Exit with non-zero code if critical bugs found (for CI)
  const hasCritical = bugs.some((r) => r.result?.classification?.severity === 'critical');
  if (hasCritical) {
    console.log('\n❌ Critical visual regressions found. CI check FAILED.');
    process.exit(1);
  } else if (bugs.length > 0) {
    console.log('\n⚠️  Non-critical visual changes found. Review recommended.');
    process.exit(0);
  } else {
    console.log('\n✅ All pages passed visual regression check.');
    process.exit(0);
  }
}

// CLI entry point
if (require.main === module) {
  const configPath = process.env.VR_CONFIG || './vr-config.json';

  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`);
    console.error('Create a vr-config.json file. See docs/vr-config.example.json');
    process.exit(1);
  }

  const config: CaptureConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  runCapture(config).catch((err) => {
    console.error('❌ Capture failed:', err.message);
    process.exit(1);
  });
}
