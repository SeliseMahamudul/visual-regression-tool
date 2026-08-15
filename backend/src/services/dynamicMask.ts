import type { ElementHandle, Page } from 'playwright';

/**
 * FR-04: hide dynamic elements that cause false-positive diffs.
 * Hoisted from playwright-service/src/capture.ts so live mode and the CI
 * capture path share one selector list (WEB_APP_REGRESSION_PLAN §3.6).
 */
export const DYNAMIC_MASK_CSS = `
  [data-testid="timestamp"],
  [data-testid="avatar"],
  .dynamic-ad,
  iframe[id^="google_ads"],
  .live-counter { visibility: hidden !important; }
`;

/**
 * Unlike the CI path, live mode must be able to REMOVE the mask afterwards —
 * the user keeps interacting with this page. The returned handle is the
 * injected <style> node; call `handle.evaluate(n => n.remove())`.
 */
export async function applyDynamicMask(page: Page): Promise<ElementHandle<Node>> {
  return page.addStyleTag({ content: DYNAMIC_MASK_CSS });
}

/** Best-effort removal; a detached node or closed page must never fail a capture. */
export async function removeDynamicMask(
  handle: ElementHandle<Node> | undefined
): Promise<void> {
  if (!handle) return;
  try {
    await handle.evaluate((node) => (node as ChildNode).remove());
  } catch {
    /* page navigated or closed — the style tag is gone either way */
  }
}
