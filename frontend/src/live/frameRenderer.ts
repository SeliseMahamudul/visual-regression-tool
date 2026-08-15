import { FrameMetadata } from '../types/live';

/**
 * Draws screencast frames onto a <canvas>.
 *
 * Canvas, not <img>: object URLs must be individually revoked (a leak at 20
 * fps otherwise), <img> decode is async and unsynchronised so you get visible
 * tearing on swap, and you cannot overlay a "Capturing…" scrim on an <img>.
 * createImageBitmap decodes off the main thread.
 */
export class FrameRenderer {
  private lastDrawnId = 0;
  private lastMetadata: FrameMetadata | null = null;
  private drawing = false;
  private bytesWindow: Array<{ t: number; bytes: number }> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** Metadata of the last *drawn* frame — the only correct basis for input math. */
  get metadata(): FrameMetadata | null {
    return this.lastMetadata;
  }

  /** Rough bytes/sec over the last 2 s, for the toolbar meter. */
  get bytesPerSecond(): number {
    const cutoff = Date.now() - 2000;
    this.bytesWindow = this.bytesWindow.filter((b) => b.t >= cutoff);
    const total = this.bytesWindow.reduce((sum, b) => sum + b.bytes, 0);
    return Math.round(total / 2);
  }

  reset(): void {
    this.lastDrawnId = 0;
    this.lastMetadata = null;
  }

  async draw(frameId: number, data: ArrayBuffer, metadata: FrameMetadata): Promise<void> {
    // Drop out-of-order frames; a stale frame would rewind the pane and, worse,
    // rewind the metadata the click math depends on.
    if (frameId <= this.lastDrawnId) return;
    // One decode in flight at a time — piling them up on a 60 fps page starves
    // the main thread and the newest frame wins anyway.
    if (this.drawing) return;
    this.drawing = true;
    try {
      const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
      if (frameId <= this.lastDrawnId) {
        bitmap.close();
        return;
      }
      const ctx = this.canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        return;
      }
      if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
        this.canvas.width = bitmap.width;
        this.canvas.height = bitmap.height;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      this.lastDrawnId = frameId;
      this.lastMetadata = metadata;
      this.bytesWindow.push({ t: Date.now(), bytes: data.byteLength });
    } finally {
      this.drawing = false;
    }
  }
}
