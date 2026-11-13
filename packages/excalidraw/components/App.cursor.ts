import { CURSOR_TYPE, MIME_TYPES, THEME } from "@excalidraw/common";

import { isHandToolActive, isEraserActive } from "../appState";

import { bucketFillIconSvgPaths } from "./icons";

import type { AppState, DataURL } from "../types";
import type App from "./App";

const laserPointerCursorSVG_tag = `<svg viewBox="0 0 24 24" stroke-width="1" width="28" height="28" xmlns="http://www.w3.org/2000/svg">`;
const laserPointerCursorBackgroundSVG = `<path d="M6.164 11.755a5.314 5.314 0 0 1-4.932-5.298 5.314 5.314 0 0 1 5.311-5.311 5.314 5.314 0 0 1 5.307 5.113l8.773 8.773a3.322 3.322 0 0 1 0 4.696l-.895.895a3.322 3.322 0 0 1-4.696 0l-8.868-8.868Z" style="fill:#fff"/>`;
const laserPointerCursorIconSVG = `<path stroke="#1b1b1f" fill="#fff" d="m7.868 11.113 7.773 7.774a2.359 2.359 0 0 0 1.667.691 2.368 2.368 0 0 0 2.357-2.358c0-.625-.248-1.225-.69-1.667L11.201 7.78 9.558 9.469l-1.69 1.643v.001Zm10.273 3.606-3.333 3.333m-3.25-6.583 2 2m-7-7 3 3M3.664 3.625l1 1M2.529 6.922l1.407-.144m5.735-2.932-1.118.866M4.285 9.823l.758-1.194m1.863-6.207-.13 1.408"/>`;

const laserPointerCursorDataURL_lightMode = `data:${
  MIME_TYPES.svg
},${encodeURIComponent(
  `${laserPointerCursorSVG_tag}${laserPointerCursorIconSVG}</svg>`,
)}`;
const laserPointerCursorDataURL_darkMode = `data:${
  MIME_TYPES.svg
},${encodeURIComponent(
  `${laserPointerCursorSVG_tag}${laserPointerCursorBackgroundSVG}${laserPointerCursorIconSVG}</svg>`,
)}`;

const createBucketFillCursorDataURL = (color: string) => {
  const paths = bucketFillIconSvgPaths
    .map(
      (path, index) =>
        `<path d="${path}" ${index < 2 ? `fill="${color}"` : ""} />`,
    )
    .join("");

  return `data:${MIME_TYPES.svg},${encodeURIComponent(
    `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke-linecap="round" stroke-linejoin="round"><g stroke="#fff" fill="#fff" stroke-width="5">${paths}</g><g stroke="#1b1b1f" stroke-width="1.25">${paths}</g></svg>`,
  )}`;
};

let eraserCanvasCache:
  | (HTMLCanvasElement & { theme?: AppState["theme"] })
  | null = null;
let eraserPreviewDataURL: DataURL | null = null;

/** Eraser cursor (cached by theme); no side effects on the live cursor. */
const getEraserCursor = (app: Pick<App, "state">): string => {
  const cursorImageSizePx = 20;
  const theme = app.state.theme;

  if (!eraserCanvasCache || eraserCanvasCache.theme !== theme) {
    const isDarkTheme = theme === THEME.DARK;
    eraserCanvasCache = document.createElement("canvas");
    eraserCanvasCache.theme = theme;
    eraserCanvasCache.height = cursorImageSizePx;
    eraserCanvasCache.width = cursorImageSizePx;
    const context = eraserCanvasCache.getContext("2d")!;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(
      eraserCanvasCache.width / 2,
      eraserCanvasCache.height / 2,
      5,
      0,
      2 * Math.PI,
    );
    context.fillStyle = isDarkTheme ? "#000" : "#fff";
    context.fill();
    context.strokeStyle = isDarkTheme ? "#fff" : "#000";
    context.stroke();
    eraserPreviewDataURL = eraserCanvasCache.toDataURL(
      MIME_TYPES.svg,
    ) as DataURL;
  }

  return `url(${eraserPreviewDataURL}) ${cursorImageSizePx / 2} ${
    cursorImageSizePx / 2
  }, auto`;
};

/**
 * Resting tool cursor as a pure value ("" = environment default). Extracted
 * from `applyForTool` so the frame dispatcher can be the single cursor writer
 * (05-general-hover.md §4.4).
 */
export const getToolCursor = (
  app: Pick<App, "state" | "bucketFill">,
  activeTool: AppState["activeTool"] | undefined = app.state.activeTool,
): string => {
  if (!activeTool) {
    return "";
  }
  const theme =
    activeTool.type === "eraser" ||
    activeTool.type === "laser" ||
    activeTool.type === "bucketfill"
      ? app.state.theme
      : undefined;

  if (activeTool.type === "selection") {
    return "";
  }
  if (isHandToolActive({ activeTool })) {
    return CURSOR_TYPE.GRAB;
  }
  if (isEraserActive({ activeTool })) {
    return getEraserCursor(app as App);
  }
  if (activeTool.type === "autoshape") {
    return CURSOR_TYPE.CROSSHAIR;
  }
  if (activeTool.type === "text") {
    return CURSOR_TYPE.TEXT;
  }
  if (activeTool.type === "bucketfill") {
    const bucketFillColor = app.bucketFill.getBucketFillBackgroundColor(
      app.state.currentItemBackgroundColor,
      theme,
    );
    return `url(${createBucketFillCursorDataURL(bucketFillColor)}) 5 18, auto`;
  }
  if (activeTool.type === "laser") {
    const url =
      app.state.theme === THEME.LIGHT
        ? laserPointerCursorDataURL_lightMode
        : laserPointerCursorDataURL_darkMode;
    return `url(${url}), auto`;
  }
  if (!["image", "custom"].includes(activeTool.type)) {
    return CURSOR_TYPE.CROSSHAIR;
  }
  if (activeTool.type !== "image") {
    return CURSOR_TYPE.AUTO;
  }
  return "";
};

/**
 * Captures all cursor management for the interactive canvas.
 *
 * The canvas cursor is set exclusively imperatively, through this class —
 * never via inline styles or React-rendered `style.cursor`, which React
 * would rewrite on rerender whenever the computed value changes, clobbering
 * cursors set here.
 */
export class AppCursor {
  private toolCursorMemo: {
    canvas: HTMLCanvasElement;
    type: AppState["activeTool"]["type"];
    bucketFillColor?: string;
    theme?: AppState["theme"];
  } | null = null;

  constructor(private app: App) {}

  private get canvas() {
    return this.app.interactiveCanvas;
  }

  set = (cursor: string) => {
    // Hover and interaction cursors override the resting tool cursor. The
    // next applyForTool() must restore it even if the tool itself is unchanged.
    this.toolCursorMemo = null;
    if (this.canvas) {
      this.canvas.style.cursor = cursor;
    }
  };

  /**
   * Resets to the resting cursor — the cursor shown when no interaction or
   * hover affordance overrides it: the view-mode grab cursor when
   * drag-to-pan applies, the active tool's cursor otherwise.
   */
  reset = () => {
    if (
      this.app.state.viewModeEnabled &&
      !this.app.isActiveToolPointerCapturing()
    ) {
      if (this.app.isNavigationEnabled()) {
        this.set(CURSOR_TYPE.GRAB);
      } else {
        this.clear();
      }
    } else {
      this.applyForTool();
    }
  };

  /** applies the given tool's cursor (defaults to the active tool) */
  applyForTool = (
    activeTool: AppState["activeTool"] = this.app.state.activeTool,
  ) => {
    const canvas = this.canvas;
    if (!canvas) {
      return;
    }

    const theme =
      activeTool.type === "eraser" ||
      activeTool.type === "laser" ||
      activeTool.type === "bucketfill"
        ? this.app.state.theme
        : undefined;

    const bucketFillColor =
      activeTool.type === "bucketfill"
        ? this.app.bucketFill.getBucketFillBackgroundColor(
            this.app.state.currentItemBackgroundColor,
            theme,
          )
        : undefined;
    const memo = this.toolCursorMemo;
    if (
      memo?.canvas === canvas &&
      memo.type === activeTool.type &&
      memo.bucketFillColor === bucketFillColor &&
      memo.theme === theme
    ) {
      return;
    }

    this.set(getToolCursor(this.app, activeTool));

    this.toolCursorMemo = {
      canvas,
      type: activeTool.type,
      bucketFillColor,
      theme,
    };
  };

  /**
   * Re-runs the hover cursor logic at the last known pointer position by
   * re-dispatching a synthetic pointermove — for state changes that alter
   * what hovering means without the pointer moving (e.g. the tool reverting
   * to selection after an element is created). Mouse only: touch and pen
   * have no resting hover to restore.
   */
  refreshHover = () => {
    const lastEvent =
      this.app.lastPointerMoveEvent ?? this.app.lastPointerUpEvent;

    if (!lastEvent || !this.canvas) {
      return;
    }

    const pointerType = (lastEvent as PointerEvent).pointerType;
    if (pointerType && pointerType !== "mouse") {
      return;
    }

    // jsdom has no PointerEvent; a MouseEvent of type "pointermove" walks
    // the identical dispatch path
    const EventConstructor =
      typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;

    this.canvas.dispatchEvent(
      new EventConstructor("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: lastEvent.clientX,
        clientY: lastEvent.clientY,
      }),
    );
  };

  /** clears the inline cursor so the environment default (CSS) applies */
  private clear = () => {
    this.set("");
  };
}
