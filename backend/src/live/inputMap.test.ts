import {
  MOD_ALT,
  MOD_CTRL,
  MOD_META,
  MOD_SHIFT,
  cdpButton,
  clampToViewport,
  modifierBitmask,
  playwrightChord,
  shouldInsertText,
  toViewportCoords,
} from './inputMap';
import { FrameMetadata } from '../types/live';

const meta = (over: Partial<FrameMetadata> = {}): FrameMetadata => ({
  offsetTop: 0,
  pageScaleFactor: 1,
  deviceWidth: 1280,
  deviceHeight: 800,
  scrollOffsetX: 0,
  scrollOffsetY: 0,
  ...over,
});

describe('toViewportCoords (FR-64)', () => {
  it('maps a centre click on a 640px-wide canvas showing a 1280px frame to x = 640', () => {
    const rect = { left: 0, top: 0, width: 640, height: 400 };
    const { x, y } = toViewportCoords({ clientX: 320, clientY: 200 }, rect, meta());
    expect(x).toBe(640);
    expect(y).toBe(400);
  });

  it('accounts for the canvas offset within the page', () => {
    const rect = { left: 100, top: 50, width: 640, height: 400 };
    const { x, y } = toViewportCoords({ clientX: 420, clientY: 250 }, rect, meta());
    expect(x).toBe(640);
    expect(y).toBe(400);
  });

  it('handles pageScaleFactor: 2', () => {
    const rect = { left: 0, top: 0, width: 640, height: 400 };
    const { x, y } = toViewportCoords({ clientX: 320, clientY: 200 }, rect, meta({ pageScaleFactor: 2 }));
    expect(x).toBe(320);
    expect(y).toBe(200);
  });

  it('handles offsetTop: 50', () => {
    const rect = { left: 0, top: 0, width: 1280, height: 800 };
    const { y } = toViewportCoords({ clientX: 0, clientY: 100 }, rect, meta({ offsetTop: 50 }));
    expect(y).toBe(50);
  });

  it('handles offsetTop together with pageScaleFactor', () => {
    const rect = { left: 0, top: 0, width: 1280, height: 800 };
    const { y } = toViewportCoords(
      { clientX: 0, clientY: 100 },
      rect,
      meta({ offsetTop: 50, pageScaleFactor: 2 })
    );
    expect(y).toBe(25);
  });

  it('does NOT add scrollOffsetY to y — CDP takes viewport coordinates', () => {
    const rect = { left: 0, top: 0, width: 1280, height: 800 };
    const unscrolled = toViewportCoords({ clientX: 640, clientY: 400 }, rect, meta());
    const scrolled = toViewportCoords(
      { clientX: 640, clientY: 400 },
      rect,
      meta({ scrollOffsetX: 300, scrollOffsetY: 1200 })
    );
    expect(scrolled).toEqual(unscrolled);
    expect(scrolled.y).toBe(400);
  });

  it('treats a missing/zero pageScaleFactor as 1 rather than dividing by zero', () => {
    const rect = { left: 0, top: 0, width: 1280, height: 800 };
    const { x } = toViewportCoords({ clientX: 640, clientY: 0 }, rect, meta({ pageScaleFactor: 0 }));
    expect(Number.isFinite(x)).toBe(true);
    expect(x).toBe(640);
  });
});

describe('modifierBitmask (FR-64)', () => {
  it('maps each modifier to its CDP bit', () => {
    expect(modifierBitmask({ altKey: true })).toBe(1);
    expect(modifierBitmask({ ctrlKey: true })).toBe(2);
    expect(modifierBitmask({ metaKey: true })).toBe(4);
    expect(modifierBitmask({ shiftKey: true })).toBe(8);
  });

  it('combines modifiers', () => {
    expect(modifierBitmask({ ctrlKey: true, shiftKey: true })).toBe(MOD_CTRL | MOD_SHIFT);
    expect(modifierBitmask({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(
      MOD_ALT | MOD_CTRL | MOD_META | MOD_SHIFT
    );
  });

  it('is 0 with no modifiers', () => {
    expect(modifierBitmask({})).toBe(0);
  });
});

describe('clampToViewport', () => {
  it('clamps a crafted out-of-bounds coordinate into the viewport', () => {
    expect(clampToViewport(-500, 99999, { width: 1280, height: 800 })).toEqual({ x: 0, y: 800 });
  });

  it('leaves in-bounds coordinates untouched', () => {
    expect(clampToViewport(10, 20, { width: 1280, height: 800 })).toEqual({ x: 10, y: 20 });
  });
});

describe('cdpButton', () => {
  it('maps DOM button numbers to CDP button names', () => {
    expect(cdpButton(0)).toBe('left');
    expect(cdpButton(1)).toBe('middle');
    expect(cdpButton(2)).toBe('right');
    expect(cdpButton(4)).toBe('none');
  });
});

describe('key routing', () => {
  it('routes printable characters to insertText', () => {
    expect(shouldInsertText('a', 0)).toBe(true);
    expect(shouldInsertText('A', MOD_SHIFT)).toBe(true);
  });

  it('routes named keys and ctrl/meta chords to press', () => {
    expect(shouldInsertText('Enter', 0)).toBe(false);
    expect(shouldInsertText('Backspace', 0)).toBe(false);
    expect(shouldInsertText('a', MOD_CTRL)).toBe(false);
    expect(shouldInsertText('v', MOD_META)).toBe(false);
  });

  it('builds Playwright chord strings in a stable order', () => {
    expect(playwrightChord('Enter', 0)).toBe('Enter');
    expect(playwrightChord('a', MOD_CTRL)).toBe('Control+a');
    expect(playwrightChord('Tab', MOD_SHIFT)).toBe('Shift+Tab');
    expect(playwrightChord('a', MOD_CTRL | MOD_SHIFT)).toBe('Control+Shift+a');
  });
});
