import { chromium, Browser } from 'playwright';

/**
 * Lazy singleton Chromium for live mode. No browser is launched until the first
 * session is created, so an API process that never uses live mode pays nothing.
 */

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

export class BrowserUnavailableError extends Error {
  readonly code = 'BROWSER_UNAVAILABLE' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BrowserUnavailableError';
  }
}

/**
 * headless: true is REQUIRED, not a preference (WEB_APP_REGRESSION_PLAN §3.3).
 * Headed Chromium does not composite non-foreground windows, so with two panes
 * streaming simultaneously one of them simply freezes — and it looks like a bug
 * in the streaming code, not like a browser policy. The four --disable-* args
 * are belt-and-braces against the same class of throttling.
 *
 * Never call page.bringToFront() anywhere in src/live — it starves the other pane.
 */
export const LAUNCH_ARGS = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
];

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  if (launching) return launching;

  launching = chromium
    .launch({ headless: true, args: LAUNCH_ARGS })
    .then((b) => {
      browser = b;
      // A crashed Chromium must not leave a stale handle behind; the next
      // getBrowser() should relaunch rather than throw "Target closed".
      b.on('disconnected', () => {
        if (browser === b) browser = null;
      });
      return b;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserUnavailableError(
        `Could not launch Chromium for live mode: ${message}. Run "npx playwright install chromium" from the repo root.`
      );
    })
    .finally(() => {
      launching = null;
    });

  return launching;
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  if (!b) return;
  try {
    await b.close();
  } catch {
    /* best effort — shutdown must not throw */
  }
}

/** For /health and tests: is a Chromium currently held open? */
export function isBrowserRunning(): boolean {
  return !!browser && browser.isConnected();
}
