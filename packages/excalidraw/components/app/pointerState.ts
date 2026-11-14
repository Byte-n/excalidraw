/**
 * Single synchronous pointer snapshot (docs/pointer-pipeline/02-frame-contract.md
 * §4.6).
 *
 * Kept outside `appState` on purpose: a pointermove must not trigger a React
 * state update. Every commit atomically replaces the frame together with the
 * hover affordances derived from it; comparisons always run against the
 * previous committed snapshot, never against asynchronous React state.
 */
import { isSamePointerFrame } from "./pointerFrame";
import {
  EMPTY_POINTER_HOVER,
  derivePointerHover,
  isSamePointerHover,
} from "./pointerSnapshot";

import type { PointerFrame } from "./pointerFrame";
import type { PointerHoverSnapshot, PointerSnapshot } from "./pointerSnapshot";
import type {
  FragmentStructureHover,
  TableRowColStructureHover,
} from "../../types";
import type App from "../App";

export type PointerCommitResult = {
  frameChanged: boolean;
  hoverChanged: boolean;
  changed: boolean;
};

const sameFrame = (
  previous: PointerFrame | null,
  next: PointerFrame | null,
): boolean =>
  previous === next ||
  (previous !== null && next !== null && isSamePointerFrame(previous, next));

export class AppPointerState {
  private snapshot: PointerSnapshot = {
    frame: null,
    hover: EMPTY_POINTER_HOVER,
  };

  /** React consumers (static canvas, DOM popups) subscribe to hover only. */
  private readonly listeners = new Set<() => void>();

  /** Point of the last stored hover frame (armed/gesture frames excluded). */
  private lastHoverPoint: PointerFrame["point"] | null = null;

  /** Target of the last stored hover frame; lets armed frames reuse it. */
  private lastHoverTarget: PointerFrame["target"] | null = null;

  constructor(private readonly app: App) {}

  getSnapshot = (): PointerSnapshot => this.snapshot;

  getHoverSnapshot = (): PointerHoverSnapshot => this.snapshot.hover;

  /** Point-only commits keep the hover reference, so subscribers stay quiet. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify = () => {
    for (const listener of this.listeners) {
      listener();
    }
  };

  getFrame = (): PointerFrame | null => this.snapshot.frame;

  getLastHoverPoint = (): PointerFrame["point"] | null => this.lastHoverPoint;

  getLastHoverTarget = (): PointerFrame["target"] | null =>
    this.lastHoverTarget;

  /**
   * Atomically replaces the frame and re-derives the container hover.
   * `repaint` is false for dispatcher-driven frames that decide their own
   * repaint budget from the returned diff.
   */
  commit = (
    frame: PointerFrame | null,
    {
      repaint = true,
      hover,
    }: { repaint?: boolean; hover?: PointerHoverSnapshot } = {},
  ): PointerCommitResult => {
    const previous = this.snapshot;
    const nextHover =
      hover ??
      (frame === null
        ? EMPTY_POINTER_HOVER
        : frame.phase === "hover"
        ? derivePointerHover(frame)
        : previous.hover);
    const frameChanged = !sameFrame(previous.frame, frame);
    const hoverChanged = !isSamePointerHover(previous.hover, nextHover);
    if (!frameChanged && !hoverChanged) {
      return { frameChanged: false, hoverChanged: false, changed: false };
    }
    this.snapshot = {
      frame,
      hover: hoverChanged ? nextHover : previous.hover,
    };
    if (frame?.phase === "hover") {
      this.lastHoverPoint = frame.point;
      this.lastHoverTarget = frame.target;
    }
    if (hoverChanged) {
      this.notify();
    }
    if (repaint) {
      this.app.repaint.request();
    }
    return { frameChanged, hoverChanged, changed: true };
  };

  /**
   * Frame-only writer for callers that do not own hover (connection preview,
   * quick-create gestures, armed pointer sessions). Returns whether the frame
   * changed.
   */
  setFrame = (
    frame: PointerFrame | null,
    options: { repaint?: boolean } = {},
  ): boolean => this.commit(frame, options).frameChanged;

  setHover = (
    hover: PointerHoverSnapshot,
    { repaint = true }: { repaint?: boolean } = {},
  ): boolean => {
    const previous = this.snapshot;
    if (isSamePointerHover(previous.hover, hover)) {
      return false;
    }
    this.snapshot = { frame: previous.frame, hover };
    this.notify();
    if (repaint) {
      this.app.repaint.request();
    }
    return true;
  };

  /** Gesture-owned frame drop target (drag-in highlight). */
  setFrameHighlight = (
    frame: PointerHoverSnapshot["frameToHighlight"],
    options: { repaint?: boolean } = {},
  ): boolean =>
    this.setHover({ ...this.snapshot.hover, frameToHighlight: frame }, options);

  /** Creation / drag-in cell highlight. */
  setCellHover = (
    cell: PointerHoverSnapshot["cell"],
    options: { repaint?: boolean } = {},
  ): boolean => this.setHover({ ...this.snapshot.hover, cell }, options);

  /** Gesture-owned or imperative clear of one hover channel. */
  setTableHover = (
    hover: TableRowColStructureHover | null,
    options: { repaint?: boolean } = {},
  ): boolean =>
    this.setHover({ ...this.snapshot.hover, table: hover }, options);

  /** Gesture-owned or imperative clear of one hover channel. */
  setFragmentHover = (
    hover: FragmentStructureHover | null,
    options: { repaint?: boolean } = {},
  ): boolean =>
    this.setHover({ ...this.snapshot.hover, fragment: hover }, options);

  clearHover = ({ repaint = true }: { repaint?: boolean } = {}): boolean =>
    this.setHover(EMPTY_POINTER_HOVER, { repaint });

  /**
   * Drops the transient affordances a canvas gesture/deselect invalidates
   * while keeping the element/link under the pointer, matching the previous
   * AppState reset surface.
   */
  clearHoverAffordances = ({
    repaint = true,
  }: { repaint?: boolean } = {}): boolean =>
    this.setHover(
      {
        ...EMPTY_POINTER_HOVER,
        elementId: this.snapshot.hover.elementId,
        elementIds: this.snapshot.hover.elementIds,
        linkElementId: this.snapshot.hover.linkElementId,
      },
      { repaint },
    );

  clear = (): boolean => this.setFrame(null);
}
