import { FrameMetadata, LiveInputEvent } from '../types/live';

/**
 * FR-64 — DOM event → LiveInputEvent, with coordinate translation.
 *
 * MIRROR of backend/src/live/inputMap.ts, which is where this arithmetic is
 * unit-tested (there is no frontend test harness in this repo). Keep the two in
 * sync; a divergence produces "clicks land in the wrong place sometimes".
 */

export const MOD_ALT = 1;
export const MOD_CTRL = 2;
export const MOD_META = 4;
export const MOD_SHIFT = 8;

export function modifierBitmask(ev: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (ev.altKey ? MOD_ALT : 0) |
    (ev.ctrlKey ? MOD_CTRL : 0) |
    (ev.metaKey ? MOD_META : 0) |
    (ev.shiftKey ? MOD_SHIFT : 0)
  );
}

export function cdpButton(button: number): 'left' | 'right' | 'middle' | 'none' {
  if (button === 0) return 'left';
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'none';
}

/**
 * Translate a pointer position over the canvas into viewport coordinates.
 *
 * `m` MUST be the metadata of the last *drawn* frame, not the last *received*
 * one: a frame can land between mousedown and mouseup on a page that scrolls
 * during load, and mixing metadata generations produces off-by-scroll clicks.
 *
 * scrollOffsetX/Y are deliberately NOT added — CDP takes viewport coordinates
 * and the browser applies scroll itself.
 */
export function toViewportCoords(
  ev: { clientX: number; clientY: number },
  rect: DOMRect,
  m: FrameMetadata
): { x: number; y: number } {
  const fx = (ev.clientX - rect.left) / rect.width;
  const fy = (ev.clientY - rect.top) / rect.height;
  const scale = m.pageScaleFactor || 1;
  return {
    x: (fx * m.deviceWidth) / scale,
    y: (fy * m.deviceHeight - m.offsetTop) / scale,
  };
}

export function mouseEventToInput(
  ev: MouseEvent,
  type: 'down' | 'up' | 'move',
  rect: DOMRect,
  m: FrameMetadata
): LiveInputEvent {
  const { x, y } = toViewportCoords(ev, rect, m);
  return {
    kind: 'mouse',
    type,
    x,
    y,
    button: type === 'move' ? 'none' : cdpButton(ev.button),
    // REQUIRED or drag does not work.
    buttons: ev.buttons,
    // ev.detail: 2 selects a word, 3 a line.
    clickCount: type === 'move' ? 0 : Math.min(3, Math.max(1, ev.detail || 1)),
    modifiers: modifierBitmask(ev),
  };
}

export function wheelEventToInput(
  ev: { clientX: number; clientY: number; deltaX: number; deltaY: number } & {
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  rect: DOMRect,
  m: FrameMetadata,
  accumulated: { deltaX: number; deltaY: number }
): LiveInputEvent {
  const { x, y } = toViewportCoords(ev, rect, m);
  return {
    kind: 'wheel',
    x,
    y,
    deltaX: accumulated.deltaX,
    deltaY: accumulated.deltaY,
    modifiers: modifierBitmask(ev),
  };
}

/** Keys the dashboard must not act on itself while a pane has focus. */
const SWALLOW_KEYS = new Set([
  'Tab',
  ' ',
  '/',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Backspace',
]);

export function shouldPreventDefault(ev: KeyboardEvent): boolean {
  return SWALLOW_KEYS.has(ev.key);
}

export function keyEventToInput(ev: KeyboardEvent, type: 'down' | 'up'): LiveInputEvent {
  return {
    kind: 'key',
    type,
    key: ev.key,
    code: ev.code,
    modifiers: modifierBitmask(ev),
    repeat: ev.repeat,
  };
}
