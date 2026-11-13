/**
 * Single pointer-frame state (docs/pointer-pipeline/02-frame-contract.md §4.6).
 *
 * Kept outside `appState` on purpose: a pointermove must not trigger a React
 * state update. Like `AppQuickCreate`, changes request an explicit repaint of
 * the interactive layer instead.
 */
import { isSamePointerFrame } from "./pointerFrame";

import type { PointerFrame } from "./pointerFrame";
import type App from "../App";

export class AppPointerState {
  private frame: PointerFrame | null = null;

  /** Point of the last stored hover frame (armed/gesture frames excluded). */
  private lastHoverPoint: PointerFrame["point"] | null = null;

  constructor(private readonly app: App) {}

  getFrame = (): PointerFrame | null => this.frame;

  getLastHoverPoint = (): PointerFrame["point"] | null => this.lastHoverPoint;

  /**
   * Returns whether the frame changed; a change requests a repaint.
   *
   * PR2 has no renderer consumer for the frame yet, so the pointer pipeline
   * stores frames with `repaint: false` to avoid adding repaints that draw
   * nothing. PR3 / PR4 flip this to the default once the renderer reads it.
   */
  setFrame = (
    frame: PointerFrame | null,
    { repaint = true }: { repaint?: boolean } = {},
  ): boolean => {
    const previous = this.frame;
    if (previous === frame) {
      return false;
    }
    if (previous && frame && isSamePointerFrame(previous, frame)) {
      return false;
    }
    this.frame = frame;
    if (frame?.phase === "hover") {
      this.lastHoverPoint = frame.point;
    }
    if (repaint) {
      this.app.repaint.request();
    }
    return true;
  };

  clear = (): boolean => this.setFrame(null);
}
