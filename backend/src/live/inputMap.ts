/**
 * FR-64 — the pure arithmetic behind input forwarding.
 *
 * This is the single most bug-prone piece of live mode: a regression here
 * produces "clicks land in the wrong place sometimes", which is nearly
 * impossible to diagnose from a bug report. It is pure, so it is unit-tested
 * here on the backend even though the *caller* lives in the frontend
 * (frontend/src/live/inputMap.ts mirrors this file — keep the two in sync).
 */

import { FrameMetadata, Viewport } from '../types/live';

/** CDP Input.dispatch* modifier bitmask. */
export const MOD_ALT = 1;
export const MOD_CTRL = 2;
export const MOD_META = 4;
export const MOD_SHIFT = 8;

export interface ModifierFlags {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function modifierBitmask(ev: ModifierFlags): number {
  return (
    (ev.altKey ? MOD_ALT : 0) |
    (ev.ctrlKey ? MOD_CTRL : 0) |
    (ev.metaKey ? MOD_META : 0) |
    (ev.shiftKey ? MOD_SHIFT : 0)
  );
}

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PointerPosition {
  clientX: number;
  clientY: number;
}

/**
 * Translates a DOM pointer position over the canvas into VIEWPORT coordinates
 * for Input.dispatchMouseEvent.
 *
 * scrollOffsetX/Y are DELIBERATELY NOT ADDED — CDP takes viewport coordinates
 * and the browser applies scroll itself. Adding them is the most likely silent
 * bug in this feature: everything works until the page is scrolled.
 *
 * The metadata passed in must be that of the last *drawn* frame, not the last
 * *received* one; mixing metadata generations produces off-by-scroll clicks.
 */
export function toViewportCoords(
  pointer: PointerPosition,
  rect: CanvasRect,
  m: FrameMetadata
): { x: number; y: number } {
  const fx = (pointer.clientX - rect.left) / rect.width; // 0..1
  const fy = (pointer.clientY - rect.top) / rect.height; // 0..1
  const scale = m.pageScaleFactor || 1;
  return {
    x: (fx * m.deviceWidth) / scale,
    y: (fy * m.deviceHeight - m.offsetTop) / scale,
  };
}

/**
 * Server-side hardening: nothing reaches CDP on trust (§3.5). Non-finite
 * coordinates are rejected by the caller; finite ones are clamped into the
 * viewport so a crafted payload cannot dispatch at absurd offsets.
 */
export function clampToViewport(
  x: number,
  y: number,
  viewport: Viewport
): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return { x: clamp(x, viewport.width), y: clamp(y, viewport.height) };
}

/** DOM `MouseEvent.button` → CDP button name. */
export function cdpButton(button: number): 'left' | 'right' | 'middle' | 'none' {
  if (button === 0) return 'left';
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'none';
}

/**
 * Keys that Playwright's page.keyboard.press understands directly. Anything of
 * length 1 without ctrl/meta goes through insertText instead — one protocol
 * call instead of down/char/up, and correct for IME/composed characters.
 */
export function shouldInsertText(key: string, mods: number): boolean {
  return key.length === 1 && (mods & MOD_CTRL) === 0 && (mods & MOD_META) === 0;
}

/** Builds the Playwright chord string, e.g. "Control+Shift+KeyA" → "Control+Shift+a". */
export function playwrightChord(key: string, mods: number): string {
  const parts: string[] = [];
  if (mods & MOD_CTRL) parts.push('Control');
  if (mods & MOD_ALT) parts.push('Alt');
  if (mods & MOD_SHIFT) parts.push('Shift');
  if (mods & MOD_META) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}
