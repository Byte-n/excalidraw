import {
  MIN_FONT_SIZE,
  TABLE_CELL_TEXT_PADDING_X,
  TABLE_CELL_TEXT_PADDING_Y,
  getFontString,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { Radians } from "@excalidraw/math";

import { getIndexedFrameChildren } from "../frameChildrenIndex";
import { measureText } from "../textMeasurements";
import { wrapText } from "../textWrapping";
import { isTextElement } from "../typeChecks";

import {
  getSequenceFragmentRowBounds,
  isSequenceFragmentElement,
} from "./sequenceOutline";

import type { Scene } from "../Scene";
import type {
  ElementsMapOrArray,
  ExcalidrawElement,
  ExcalidrawTextElement,
  FragmentRowContainerRef,
  SequenceFragmentData,
} from "../types";
import type { SequenceFragmentRowBounds } from "./sequenceOutline";

/**
 * Scene-level behavior of a fragment row's background text: the fragment is a
 * single-column table, so every body row is a cell whose background text wraps
 * against the row width and grows the row when it needs more height. The
 * header row (the operator tab) never carries background text.
 */

export const fragmentRowContainerRef = (
  fragmentId: string,
  rowId: string,
): FragmentRowContainerRef => ({
  kind: "fragmentRow",
  elementId: fragmentId,
  rowId,
  role: "backgroundText",
});

export type FragmentRowBackgroundTextElement = ExcalidrawElement & {
  containerRef: FragmentRowContainerRef;
};

/** Background texts of a fragment, optionally narrowed to one row. */
export const getFragmentRowBackgroundTexts = (
  elements: ElementsMapOrArray,
  fragmentId: string,
  rowId?: string,
): FragmentRowBackgroundTextElement[] => {
  const indexed = getIndexedFrameChildren(elements, fragmentId);
  const members =
    indexed ??
    Array.from(elements.values()).filter(
      (element) => element.containerRef?.elementId === fragmentId,
    );
  return members.filter(
    (element): element is FragmentRowBackgroundTextElement => {
      const ref = element.containerRef;
      return (
        ref?.kind === "fragmentRow" &&
        ref.elementId === fragmentId &&
        (!rowId || ref.rowId === rowId) &&
        isTextElement(element)
      );
    },
  );
};

export type SequenceFragmentRowBackgroundTextLayout = {
  text: string;
  width: number;
  height: number;
  x: number;
  y: number;
  angle: Radians;
  textAlign: ExcalidrawTextElement["textAlign"];
  verticalAlign: ExcalidrawTextElement["verticalAlign"];
};

/**
 * Wrapped layout of one row's background text. Same padding and wrapping
 * rules as a table cell background text, but the alignment is fixed to the
 * top-left corner (fragment row text has no alignment options) and the box
 * rotates with the fragment (a fragment, unlike a table, can rotate), so the
 * text center is rotated around the fragment center and the text carries the
 * fragment's angle.
 */
export const getSequenceFragmentRowBackgroundTextLayout = (
  text: ExcalidrawTextElement,
  fragment: ExcalidrawElement,
  bounds: SequenceFragmentRowBounds,
): SequenceFragmentRowBackgroundTextLayout => {
  const paddingX = TABLE_CELL_TEXT_PADDING_X;
  const paddingY = TABLE_CELL_TEXT_PADDING_Y;
  const availableWidth = Math.max(bounds.width - paddingX * 2, 1);
  const font = getFontString({
    fontSize: text.fontSize,
    fontFamily: text.fontFamily,
    fontWeight: text.fontWeight,
  });
  const wrapped = wrapText(text.originalText, font, availableWidth);
  const measured = measureText(wrapped, font, text.lineHeight);
  const width = Math.min(measured.width, availableWidth);
  const height = measured.height;
  const textAlign = "left";
  const verticalAlign = "top";
  const localX = bounds.x + paddingX;
  const localY = bounds.y + paddingY;
  const angle = (fragment.angle ?? 0) as Radians;

  let x = fragment.x + localX;
  let y = fragment.y + localY;
  if (angle !== 0) {
    const [rx, ry] = pointRotateRads(
      pointFrom(localX + width / 2, localY + height / 2),
      pointFrom(fragment.width / 2, fragment.height / 2),
      angle,
    );
    x = fragment.x + rx - width / 2;
    y = fragment.y + ry - height / 2;
  }

  return {
    text: wrapped,
    width,
    height,
    x,
    y,
    angle,
    textAlign,
    verticalAlign,
  };
};

export type SequenceFragmentRowTextRefitOptions = {
  /** Only refit the background texts of these rows (default: all rows). */
  rowIds?: readonly string[];
  /** Grow rows to fit wrapped text (default true). */
  grow?: boolean;
  /** Multiply every row text's font size before the wrap (multi-select scale). */
  fontScale?: number;
};

/**
 * Lays the fragment's row background texts out against their rows and, when
 * `grow` is on, raises rows whose wrapped text no longer fits — the element
 * height follows so `sum(rows.height) === element.height` keeps holding.
 * Later rows move with the layout and their background texts are re-laid out;
 * non-background canvas content keeps its own position (rows don't own it).
 */
export const refitSequenceFragmentRowBackgroundTexts = (
  scene: Scene,
  fragment: ExcalidrawElement,
  opts: SequenceFragmentRowTextRefitOptions = {},
): boolean => {
  if (!isSequenceFragmentElement(fragment)) {
    return false;
  }
  const grow = opts.grow ?? true;
  let didChange = false;
  let elementsMap = scene.getNonDeletedElementsMap();
  let texts = getFragmentRowBackgroundTexts(elementsMap, fragment.id).filter(
    (text) => !opts.rowIds || opts.rowIds.includes(text.containerRef.rowId),
  );
  if (!texts.length) {
    return false;
  }

  if (opts.fontScale !== undefined && opts.fontScale !== 1) {
    for (const text of texts) {
      const liveText = scene.getNonDeletedElement(text.id);
      if (!liveText || !isTextElement(liveText)) {
        continue;
      }
      const fontSize = Math.max(
        MIN_FONT_SIZE,
        liveText.fontSize * opts.fontScale,
      );
      if (fontSize !== liveText.fontSize) {
        scene.mutateElement(
          liveText,
          { fontSize },
          { informMutation: false, isDragging: true },
        );
        didChange = true;
      }
    }
    elementsMap = scene.getNonDeletedElementsMap();
    texts = getFragmentRowBackgroundTexts(elementsMap, fragment.id).filter(
      (text) => !opts.rowIds || opts.rowIds.includes(text.containerRef.rowId),
    );
  }

  if (grow) {
    const fragmentData: SequenceFragmentData | undefined =
      fragment.shape.fragment;
    const requiredHeights = new Map<string, number>();
    for (const text of texts) {
      const liveText = scene.getNonDeletedElement(text.id);
      if (!liveText || !isTextElement(liveText)) {
        continue;
      }
      const bounds = getSequenceFragmentRowBounds(
        fragment.width,
        fragment.height,
        fragmentData,
        text.containerRef.rowId,
      );
      if (!bounds) {
        continue;
      }
      const layout = getSequenceFragmentRowBackgroundTextLayout(
        liveText,
        fragment,
        bounds,
      );
      requiredHeights.set(
        text.containerRef.rowId,
        Math.max(
          requiredHeights.get(text.containerRef.rowId) ?? 0,
          layout.height + TABLE_CELL_TEXT_PADDING_Y * 2,
        ),
      );
    }

    const rows = fragment.shape.fragment?.rows ?? [];
    let heightDelta = 0;
    const nextRows = rows.map((row) => {
      const requiredHeight = requiredHeights.get(row.id);
      if (requiredHeight === undefined || requiredHeight <= row.height) {
        return row;
      }
      heightDelta += requiredHeight - row.height;
      return { ...row, height: requiredHeight };
    });
    if (heightDelta > 0) {
      const angle = fragment.angle ?? 0;
      scene.mutateElement(
        fragment,
        {
          height: fragment.height + heightDelta,
          shape: {
            ...fragment.shape,
            fragment: { ...fragment.shape.fragment, rows: nextRows },
          },
          // the box grows downward from its local top edge; on a rotated
          // fragment compensate x/y so the visual top-left stays put
          ...(angle
            ? {
                x: fragment.x + (Math.sin(angle) * heightDelta) / 2,
                y: fragment.y + ((Math.cos(angle) - 1) * heightDelta) / 2,
              }
            : {}),
        },
        { informMutation: false, isDragging: true },
      );
      didChange = true;
    }
  }

  const liveFragment = scene.getNonDeletedElement(fragment.id);
  if (!liveFragment || !isSequenceFragmentElement(liveFragment)) {
    return didChange;
  }
  const liveElementsMap = scene.getNonDeletedElementsMap();
  for (const text of getFragmentRowBackgroundTexts(
    liveElementsMap,
    liveFragment.id,
  )) {
    const liveText = scene.getNonDeletedElement(text.id);
    if (!liveText || !isTextElement(liveText)) {
      continue;
    }
    const bounds = getSequenceFragmentRowBounds(
      liveFragment.width,
      liveFragment.height,
      liveFragment.shape.fragment,
      text.containerRef.rowId,
    );
    if (!bounds) {
      continue;
    }
    const layout = getSequenceFragmentRowBackgroundTextLayout(
      liveText,
      liveFragment,
      bounds,
    );
    scene.mutateElement(
      liveText,
      layout,
      { informMutation: false, isDragging: true },
    );
    didChange = true;
  }
  return didChange;
};
