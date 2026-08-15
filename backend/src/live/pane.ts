import type { Browser, BrowserContext, CDPSession, Dialog, ElementHandle, Page } from 'playwright';
import {
  FrameMetadata,
  HttpCredentials,
  LiveError,
  LiveInputEvent,
  PaneSide,
  PaneState,
  Viewport,
} from '../types/live';
import { assertNavigable, isNavigable } from './urlGuard';
import { applyDynamicMask, removeDynamicMask } from '../services/dynamicMask';
import { cdpButton, clampToViewport, playwrightChord, shouldInsertText } from './inputMap';

export interface PaneCallbacks {
  onFrame: (side: PaneSide, frameId: number, data: Buffer, metadata: FrameMetadata) => void;
  onState: (side: PaneSide, state: PaneState) => void;
  onDialog: (
    side: PaneSide,
    dialog: { type: string; message: string; defaultValue?: string }
  ) => void;
  onError: (err: Omit<LiveError, 'sessionId'>) => void;
}

function screencastQuality(): number {
  const raw = Number(process.env.LIVE_SCREENCAST_QUALITY);
  // 60 keeps text legible at 1:1. Fidelity is irrelevant here — the actual
  // COMPARISON uses page.screenshot() PNG, not the screencast (§3.2).
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : 60;
}

/**
 * Chromium's texture limit truncates enormous fullPage captures SILENTLY.
 * Pre-check scrollHeight and refuse rather than produce a wrong diff.
 */
const MAX_FULLPAGE_HEIGHT = 12_000;

/**
 * One live browser pane (WEB_APP_REGRESSION_PLAN §7).
 *
 * FR-66: each pane owns its OWN BrowserContext, never a second page in a shared
 * one. Stage and dev are usually the same application, so a shared cookie jar
 * means logging into dev silently rotates the stage session and the comparison
 * becomes garbage — a failure that looks like a bug in the application under
 * test rather than in this tool.
 */
export class LivePane {
  readonly side: PaneSide;
  private readonly viewport: Viewport;
  private readonly cb: PaneCallbacks;

  private context!: BrowserContext;
  /** The page currently owning the pane — the opener, or an adopted popup (FR-73). */
  private page!: Page;
  private opener: Page | null = null;
  private cdp: CDPSession | null = null;

  private frameSeq = 0;
  private screencasting = false;
  private lastCursor = { x: 0, y: 0 };
  private pendingDialog: Dialog | null = null;
  /**
   * Input must be serialised per pane. Socket.IO invokes handlers in receipt
   * order but does not await them, so without this chain a `text` payload can
   * reach CDP before the `mouse down/up` that focuses the field it belongs to —
   * the click appears to work and the typing lands nowhere.
   */
  private inputChain: Promise<void> = Promise.resolve();

  state: PaneState;

  constructor(side: PaneSide, viewport: Viewport, cb: PaneCallbacks) {
    this.side = side;
    this.viewport = viewport;
    this.cb = cb;
    this.state = {
      side,
      url: 'about:blank',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      isPopup: false,
    };
  }

  async open(browser: Browser, url: string, creds?: HttpCredentials): Promise<void> {
    this.context = await browser.newContext({
      viewport: { width: this.viewport.width, height: this.viewport.height },
      // Matches playwright-service/src/capture.ts — keeps live and CI captures
      // comparable (FR-05).
      deviceScaleFactor: 1,
      // No remote page writes to the server's disk (§5.6).
      acceptDownloads: false,
      // FR-71 / closes the long-standing FR-08 gap: HTTP basic auth is a NATIVE
      // dialog and will never appear in a screencast frame, so it must be
      // supplied up front.
      httpCredentials: creds,
      // Internal staging certificates — a deliberate, documented choice (§5).
      ignoreHTTPSErrors: true,
    });

    // FR-67: the pane toolbar shows the page title. Without this, a
    // single-page app that swaps views (an Angular route change — precisely
    // the workflow this feature exists for) would show a stale title forever,
    // because no navigation event fires. A MutationObserver on <title> costs
    // nothing until the title actually changes, so NFR-18 still holds.
    await this.context.exposeBinding('__vrTitleChanged', () => {
      void this.refreshState();
    });
    await this.context.addInitScript(() => {
      const install = () => {
        const titleEl = document.querySelector('title');
        if (!titleEl) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const report = () => (window as unknown as Record<string, () => void>)
          .__vrTitleChanged?.();
        new MutationObserver(report).observe(titleEl, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
      } else {
        install();
      }
    });

    // FR-73: SSO providers commonly window.open(). Adopt the child as the
    // pane's active page or the login simply never completes.
    this.context.on('page', (child) => {
      void this.adoptPopup(child);
    });

    const page = await this.context.newPage();
    await this.attachPage(page, false);
    await this.navigate(url);
  }

  // ── page wiring ───────────────────────────────────────────────────────────

  private async attachPage(page: Page, isPopup: boolean): Promise<void> {
    this.page = page;
    this.state.isPopup = isPopup;

    // FR-72: Playwright AUTO-DISMISSES dialogs when no handler is registered.
    // Any login flow that confirms would break in a way that looks like the
    // page ignoring the click.
    page.on('dialog', (dialog) => {
      this.pendingDialog = dialog;
      this.cb.onDialog(this.side, {
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue() || undefined,
      });
    });

    page.on('load', () => void this.refreshState());
    page.on('domcontentloaded', () => void this.refreshState());

    // SEC-10: in-page navigation must be guarded too, not only the URL bar.
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (url && url !== 'about:blank' && !isNavigable(url)) {
        this.cb.onError({
          code: 'URL_REJECTED',
          message: `Blocked in-page navigation to ${url} (SEC-10).`,
          pane: this.side,
        });
        void page.goto('about:blank').catch(() => undefined);
        return;
      }
      void this.refreshState();
    });

    // HTTP basic auth is invisible in a screencast: the pane just sits blank
    // while Chromium waits. Tell the user why (FR-71).
    page.on('response', (response) => {
      if (response.status() !== 401) return;
      const header = response.headers()['www-authenticate'] || '';
      if (!/^basic/i.test(header)) return;
      this.cb.onError({
        code: 'HTTP_401_BASIC_AUTH',
        message:
          'This environment requires HTTP basic auth. Close the session and recreate it with credentials for this pane.',
        pane: this.side,
      });
    });

    await this.startScreencast();
    await this.refreshState();
  }

  private async adoptPopup(child: Page): Promise<void> {
    // context.on('page') also fires for the pane's own first page.
    if (!this.page || child === this.page) return;
    try {
      this.opener = this.page;
      await this.stopScreencast();
      await this.attachPage(child, true);
      child.on('close', () => {
        void (async () => {
          const back = this.opener;
          this.opener = null;
          if (!back || back.isClosed()) return;
          await this.stopScreencast();
          await this.attachPage(back, false);
        })();
      });
    } catch (err) {
      this.cb.onError({
        code: 'NAV_FAILED',
        message: `Could not adopt popup window: ${(err as Error).message}`,
        pane: this.side,
      });
    }
  }

  // ── screencast ────────────────────────────────────────────────────────────

  async startScreencast(): Promise<void> {
    if (this.screencasting || !this.page || this.page.isClosed()) return;
    this.cdp = await this.context.newCDPSession(this.page);

    this.cdp.on('Page.screencastFrame', (evt) => {
      const cdp = this.cdp;
      // Ack IMMEDIATELY — gating on a client render-ack couples Chromium's
      // frame rate to browser rAF plus network RTT and makes the pane laggy.
      if (cdp) {
        cdp
          .send('Page.screencastFrameAck', { sessionId: evt.sessionId })
          .catch(() => undefined);
      }
      const md = evt.metadata;
      const metadata: FrameMetadata = {
        offsetTop: md.offsetTop ?? 0,
        pageScaleFactor: md.pageScaleFactor ?? 1,
        deviceWidth: md.deviceWidth ?? this.viewport.width,
        deviceHeight: md.deviceHeight ?? this.viewport.height,
        scrollOffsetX: md.scrollOffsetX ?? 0,
        scrollOffsetY: md.scrollOffsetY ?? 0,
        timestamp: md.timestamp,
      };
      // Sent as a Buffer, which Socket.IO serialises as a binary attachment.
      // NEVER base64 — this is the hottest path in the system and base64
      // inflates it by 33% (§3.2).
      this.cb.onFrame(this.side, ++this.frameSeq, Buffer.from(evt.data, 'base64'), metadata);
    });

    await this.cdp.send('Page.startScreencast', {
      // JPEG: PNG is 5-10x larger and slower to encode.
      format: 'jpeg',
      quality: screencastQuality(),
      // == viewport, so the scale factor is 1 and no resampling occurs.
      maxWidth: this.viewport.width,
      maxHeight: this.viewport.height,
      everyNthFrame: 1,
    });
    this.screencasting = true;
  }

  async stopScreencast(): Promise<void> {
    if (!this.cdp) {
      this.screencasting = false;
      return;
    }
    try {
      await this.cdp.send('Page.stopScreencast');
    } catch {
      /* page may already be gone */
    }
    try {
      await this.cdp.detach();
    } catch {
      /* best effort */
    }
    this.cdp = null;
    this.screencasting = false;
  }

  /**
   * Page.startScreencast alone will not emit until the next composite, so a
   * static page would reattach to a BLANK CANVAS. Nudge the compositor with a
   * no-op mouseMoved at the last known cursor position.
   */
  async nudgeFrame(): Promise<void> {
    if (!this.cdp) return;
    try {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: this.lastCursor.x,
        y: this.lastCursor.y,
        button: 'none',
        buttons: 0,
        modifiers: 0,
      });
    } catch {
      /* best effort */
    }
  }

  // ── navigation ────────────────────────────────────────────────────────────

  async navigate(rawUrl: string): Promise<void> {
    const url = assertNavigable(rawUrl); // SEC-10 — throws UrlRejectedError
    this.state.loading = true;
    this.state.lastError = undefined;
    this.cb.onState(this.side, { ...this.state });
    try {
      await this.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (err) {
      this.state.lastError = (err as Error).message;
      this.cb.onError({
        code: 'NAV_FAILED',
        message: `Could not load ${url.href}: ${(err as Error).message}`,
        pane: this.side,
      });
    } finally {
      this.state.loading = false;
      await this.refreshState();
    }
  }

  async history(action: 'back' | 'forward' | 'reload' | 'stop'): Promise<void> {
    try {
      if (action === 'back') await this.page.goBack({ timeout: 30_000 });
      else if (action === 'forward') await this.page.goForward({ timeout: 30_000 });
      else if (action === 'reload') await this.page.reload({ timeout: 30_000 });
      else if (this.cdp) await this.cdp.send('Page.stopLoading');
    } catch (err) {
      this.state.lastError = (err as Error).message;
    } finally {
      await this.refreshState();
    }
  }

  private async refreshState(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      this.state.url = this.page.url();
      this.state.title = await this.page.title();
    } catch {
      /* page mid-navigation */
    }
    // FR-67: back/forward availability comes from CDP, not from a guess.
    if (this.cdp) {
      try {
        const h = await this.cdp.send('Page.getNavigationHistory');
        this.state.canGoBack = h.currentIndex > 0;
        this.state.canGoForward = h.currentIndex < h.entries.length - 1;
      } catch {
        /* best effort */
      }
    }
    this.cb.onState(this.side, { ...this.state });
  }

  // ── input (FR-64) ─────────────────────────────────────────────────────────

  /**
   * NEVER log the payload of this method. Keystrokes are the user's real
   * credentials for the environment under test — nothing is stored, nothing is
   * logged (§4). morgan does not see socket traffic.
   */
  async dispatchInput(event: LiveInputEvent): Promise<void> {
    const next = this.inputChain.then(() => this.dispatchInputNow(event));
    // A failed event must not poison the chain for every later event.
    this.inputChain = next.catch(() => undefined);
    return next;
  }

  private async dispatchInputNow(event: LiveInputEvent): Promise<void> {
    if (!this.page || this.page.isClosed()) return;

    if (event.kind === 'mouse') {
      if (!this.cdp) return;
      const { x, y } = clampToViewport(event.x, event.y, this.viewport);
      this.lastCursor = { x, y };
      const type =
        event.type === 'down' ? 'mousePressed' : event.type === 'up' ? 'mouseReleased' : 'mouseMoved';
      await this.cdp.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: event.button,
        // REQUIRED or drag does not work.
        buttons: event.buttons,
        clickCount: event.clickCount,
        modifiers: event.modifiers,
      });
      return;
    }

    if (event.kind === 'wheel') {
      if (!this.cdp) return;
      const { x, y } = clampToViewport(event.x, event.y, this.viewport);
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x,
        y,
        button: 'none',
        buttons: 0,
        modifiers: event.modifiers,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
      return;
    }

    if (event.kind === 'text') {
      await this.page.keyboard.insertText(event.text);
      return;
    }

    // Keyboard goes through Playwright, NOT Input.dispatchKeyEvent (§3.4):
    // getting the windowsVirtualKeyCode/code/key/text tuple wrong is the single
    // largest bug source in every screencast implementation.
    if (event.type !== 'down') return; // press() covers down+up
    if (shouldInsertText(event.key, event.modifiers)) {
      await this.page.keyboard.insertText(event.key);
    } else {
      await this.page.keyboard.press(playwrightChord(event.key, event.modifiers));
    }
  }

  async respondToDialog(accept: boolean, promptText?: string): Promise<void> {
    const dialog = this.pendingDialog;
    this.pendingDialog = null;
    if (!dialog) return;
    try {
      if (accept) await dialog.accept(promptText);
      else await dialog.dismiss();
    } catch {
      /* dialog already handled by a navigation */
    }
  }

  // ── capture ───────────────────────────────────────────────────────────────

  /**
   * Stops the screencast, blurs the caret, optionally masks dynamic elements,
   * screenshots, then ALWAYS restarts the screencast.
   *
   * Screencast must stop before a fullPage screenshot: Chromium's
   * captureBeyondViewport path temporarily resizes the surface, producing a
   * burst of garbage-sized frames, torn frames, and observed deadlocks (§3.6).
   */
  async capture(filePath: string, opts: { fullPage: boolean; hideDynamic: boolean }): Promise<void> {
    let mask: ElementHandle<Node> | undefined;
    await this.stopScreencast();
    try {
      // A blinking text caret is a guaranteed 1-2px phantom diff.
      await this.page
        .evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          el?.blur();
        })
        .catch(() => undefined);

      if (opts.fullPage) {
        const height = await this.page
          .evaluate(() => document.documentElement.scrollHeight)
          .catch(() => 0);
        if (height > MAX_FULLPAGE_HEIGHT) {
          const err = new Error(
            `Page is ${height}px tall; full-page capture above ${MAX_FULLPAGE_HEIGHT}px is truncated silently by Chromium. Use viewport-only capture.`
          );
          err.name = 'ScreenshotTooLargeError';
          throw err;
        }
      }

      if (opts.hideDynamic) mask = await applyDynamicMask(this.page); // FR-04

      await this.page.screenshot({
        path: filePath,
        fullPage: opts.fullPage,
        animations: 'disabled',
        type: 'png',
        timeout: 30_000,
      });
    } finally {
      await removeDynamicMask(mask);
      // finally, so the pane comes back to life even if the screenshot threw.
      await this.startScreencast();
      await this.nudgeFrame();
    }
  }

  // ── teardown ──────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.stopScreencast();
    try {
      await this.context?.close();
    } catch {
      /* best effort */
    }
  }
}
