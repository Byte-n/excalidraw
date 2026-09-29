import {
  MIN_FONT_SIZE,
  MIN_WIDTH_OR_HEIGHT,
  STICKY_NOTE_BODY_INSET_Y,
  STICKY_NOTE_MAX_FONT_SIZE,
  STICKY_NOTE_MIN_SIZE,
  STICKY_NOTE_PADDING,
  getLineHeight,
  rescalePoints,
} from "@excalidraw/common";

import { getIndexedTableChildren } from "./tableChildrenIndex";
import { getTableHeight, getTableWidth } from "./tableStruct";
import { isElbowArrow, isMindmapEdgeElement } from "./typeChecks";

import type { ElementUpdate } from "./mutateElement";
import type {
  ElementsMapOrArray,
  ExcalidrawElbowArrowElement,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
  TableDataV1,
} from "./types";

/**
 * Uniform-scale command for a table subtree (phase-1:99-119). Everything
 * scales by one factor `s`: row heights, column widths, the table's
 * width/height, and every descendant element's geometry and font sizes.
 *
 * The result is a pure update bag per element id — applying it to the scene,
 * keeping the undo entry atomic, and re-laying out bound text inside its
 * container are the caller's job. No scene, mutation, or binding module is
 * imported on purpose: this file is data-only.
 */

/**
 * Minimum cell sizes a scaled table may reach. Creation presets
 * (`DEFAULT_TABLE_ROW_HEIGHT`/`DEFAULT_TABLE_COLUMN_WIDTH`) are starting
 * points, not constraints; this floor is the interaction magnitude instead —
 * the row/column handles' hit area is at least 24 CSS px (phase-1 interaction
 * spec), so a smaller cell could not be grabbed or hit reliably.
 */
export const MIN_TABLE_ROW_HEIGHT = 24;
export const MIN_TABLE_COLUMN_WIDTH = 24;

/**
 * Whether any cell of the given grid sits below that floor — drag-created
 * tables falling under it snap back to the default creation preset sizes on
 * release instead of committing unusably small cells.
 */
export const isBelowTableMinimumPreset = (table: TableDataV1): boolean =>
  table.columns.some((column) => column.width < MIN_TABLE_COLUMN_WIDTH) ||
  table.rows.some((row) => row.height < MIN_TABLE_ROW_HEIGHT);

export type TableUniformScaleOptions = {
  /**
   * Scene-space point that stays fixed while the subtree scales; defaults to
   * the table's top-left corner. Each element's `x`/`y` moves so that this
   * point keeps its position.
   */
  anchor?: { x: number; y: number };
  /**
   * `false` (default): preview — text layout mode fields (`textFitMode`,
   * `autoResize`, sticky `baseHeight`/`baseFontSize`, mindmap `layoutFrozen`)
   * are left untouched, as the mode switch may only be persisted with a real
   * size change (phase-1:115). `true`: commit — modes are persisted along the
   * geometry.
   */
  persistTextModes?: boolean;
};

export type TableUniformScaleResult = {
  /** One update per subtree element, every id exactly once. */
  updates: Map<string, ElementUpdate<NonDeletedExcalidrawElement>>;
  /**
   * The scale actually applied: the requested scale clamped up to the largest
   * minimum-scale floor found anywhere in the subtree, so no descendant
   * individually stops shrinking while the rest keeps going (phase-1:117).
   */
  clampedScale: number;
};

/**
 * Local, dependency-light mirror of `getStickyNoteMinSize` (stickyNote.ts):
 * a note must fit one line at its label's font ceiling plus padding, never
 * below `STICKY_NOTE_MIN_SIZE`. Kept inline so this pure data module does not
 * import the sticky-note layout module and its Scene-bound binding graph;
 * keep the two in sync.
 */
const getStickyNoteScaleFloor = (
  label: Pick<ExcalidrawTextElement, "fontSize" | "fontFamily"> | undefined,
): { width: number; height: number } => {
  if (!label) {
    return { width: STICKY_NOTE_MIN_SIZE, height: STICKY_NOTE_MIN_SIZE };
  }
  // `normalizeStickyNoteFontSize` semantics: clamp the ceiling before fitting
  const fontSize = Math.min(
    STICKY_NOTE_MAX_FONT_SIZE,
    Math.max(MIN_FONT_SIZE, label.fontSize),
  );
  const lineHeightPx = Math.ceil(fontSize * getLineHeight(label.fontFamily));
  return {
    width: Math.max(
      STICKY_NOTE_MIN_SIZE,
      lineHeightPx + STICKY_NOTE_PADDING * 2,
    ),
    height: Math.max(
      STICKY_NOTE_MIN_SIZE,
      lineHeightPx + STICKY_NOTE_BODY_INSET_Y,
    ),
  };
};

const iterateCollection = (
  elements: ElementsMapOrArray,
  visit: (element: ExcalidrawElement) => void,
): void => {
  if (Array.isArray(elements)) {
    for (const element of elements) {
      visit(element);
    }
  } else {
    for (const element of elements.values()) {
      visit(element);
    }
  }
};

const findElement = (
  elements: ElementsMapOrArray,
  elementId: string,
): ExcalidrawElement | undefined => {
  let found: ExcalidrawElement | undefined;
  iterateCollection(elements, (element) => {
    if (!found && element.id === elementId) {
      found = element;
    }
  });
  return found;
};

/**
 * Elements whose direct `containerRef` points at `tableId`, in scene order.
 * Prefers the registered table children index and falls back to a plain scan
 * when the collection carries none, so the command works on any snapshot.
 */
const getDirectTableCellChildren = (
  elements: ElementsMapOrArray,
  tableId: string,
): ExcalidrawElement[] => {
  const indexed = getIndexedTableChildren(elements, tableId);
  if (indexed) {
    return indexed.filter((element) => !element.isDeleted);
  }

  const children: ExcalidrawElement[] = [];
  iterateCollection(elements, (element) => {
    const ref = element.containerRef;
    if (
      !element.isDeleted &&
      ref?.kind === "tableCell" &&
      ref.elementId === tableId
    ) {
      children.push(element);
    }
  });
  return children;
};

type TableSubtree = {
  /** Table first, then descendants in scene order; ids unique. */
  ordered: ExcalidrawElement[];
  byId: Map<string, ExcalidrawElement>;
  /** containerId -> the host's bound text (first in scene order wins). */
  boundTexts: Map<string, ExcalidrawTextElement>;
};

export type PreparedTableUniformScale = {
  subtree: TableSubtree;
  minScale: number;
  anchor: { x: number; y: number };
};

/**
 * Walks the table's semantic subtree: cell children recursively through
 * nested tables, then bound texts, which inherit their host's membership via
 * `containerId` (they hold no `containerRef`, so the cell index cannot see
 * them), then mindmap edges whose two endpoint nodes are both members — an
 * edge carries the dragged-in node's `containerRef` only when it was derived
 * after the drag, so membership follows the graph relation instead
 * (phase-1:113 semantic-subtree traversal). Every element is visited exactly
 * once — the id set is the single source of membership, so bound texts
 * reached through their host are never transformed twice.
 */
const collectTableSubtree = (
  elements: ElementsMapOrArray,
  table: ExcalidrawTableElement,
): TableSubtree => {
  const ordered: ExcalidrawElement[] = [table];
  const byId = new Map<string, ExcalidrawElement>([[table.id, table]]);
  const queue: ExcalidrawElement[] = [table];

  while (queue.length) {
    const current = queue.shift()!;
    for (const child of getDirectTableCellChildren(elements, current.id)) {
      if (byId.has(child.id)) {
        continue;
      }
      byId.set(child.id, child);
      ordered.push(child);
      if (child.type === "table") {
        queue.push(child);
      }
    }
  }

  const boundTexts = new Map<string, ExcalidrawTextElement>();
  const pendingEdges: ExcalidrawElement[] = [];
  iterateCollection(elements, (element) => {
    if (element.isDeleted || byId.has(element.id)) {
      return;
    }
    if (
      element.type === "text" &&
      element.containerId &&
      byId.has(element.containerId)
    ) {
      byId.set(element.id, element);
      ordered.push(element);
      if (!boundTexts.has(element.containerId)) {
        boundTexts.set(element.containerId, element);
      }
      return;
    }
    if (isMindmapEdgeElement(element)) {
      pendingEdges.push(element);
    }
  });
  // edges may appear before their endpoint nodes are known — resolve after
  // the node membership is complete; an edge with one endpoint outside the
  // subtree stays out, so nothing beyond the table's own graph is scaled
  for (const edge of pendingEdges) {
    if (
      isMindmapEdgeElement(edge) &&
      byId.has(edge.parentId) &&
      byId.has(edge.childId)
    ) {
      byId.set(edge.id, edge);
      ordered.push(edge);
    }
  }

  return { ordered, byId, boundTexts };
};

/**
 * Smallest scale the whole subtree can shrink to, as the largest per-element
 * floor (a floor is the scale at which that element reaches its minimum).
 * Floors, in order of relevance:
 *
 * - tables: every row/column at `MIN_TABLE_ROW_HEIGHT`/`MIN_TABLE_COLUMN_WIDTH`
 *   (per row/column, so non-uniform grids clamp on their thinnest line);
 * - texts: `MIN_FONT_SIZE` per font size — sizes scale by `s` directly;
 * - sticky notes: one line at the label's font ceiling plus padding
 *   (`getStickyNoteScaleFloor`, mirroring `getStickyNoteMinSize`);
 * - composite shapes with an explicit adaptive-text minimum
 *   (`textFitMinWidth`/`textFitMinHeight`): those preserved dimensions;
 * - everything: `MIN_WIDTH_OR_HEIGHT` so no element degenerates to zero.
 */
const getSubtreeMinScale = (subtree: TableSubtree): number => {
  let minScale = 0;
  const consider = (floor: number) => {
    if (Number.isFinite(floor) && floor > minScale) {
      minScale = floor;
    }
  };

  for (const element of subtree.ordered) {
    if (element.width > 0) {
      consider(MIN_WIDTH_OR_HEIGHT / element.width);
    }
    if (element.height > 0) {
      consider(MIN_WIDTH_OR_HEIGHT / element.height);
    }

    if (element.type === "table") {
      for (const row of element.table.rows) {
        consider(MIN_TABLE_ROW_HEIGHT / row.height);
      }
      for (const column of element.table.columns) {
        consider(MIN_TABLE_COLUMN_WIDTH / column.width);
      }
    } else if (element.type === "text") {
      consider(MIN_FONT_SIZE / element.fontSize);
    } else if (element.type === "stickynote") {
      const floor = getStickyNoteScaleFloor(subtree.boundTexts.get(element.id));
      consider(floor.width / element.width);
      consider(floor.height / element.height);
    } else if (element.type === "composite_shape") {
      // `getCompositeShapeTextFitMinSize` falls back to the live size, which
      // would freeze every shape against shrinking; only explicit minima count
      if (
        element.textFitMinWidth !== undefined &&
        element.textFitMinWidth > 0
      ) {
        consider(element.textFitMinWidth / element.width);
      }
      if (
        element.textFitMinHeight !== undefined &&
        element.textFitMinHeight > 0
      ) {
        consider(element.textFitMinHeight / element.height);
      }
    }
  }

  return minScale;
};

/**
 * Uniform scale of the persisted grid: sizes and `fitContent` manual minima
 * scale by the same factor (phase-1.1), so the minima keep bounding later
 * content edits at the scaled geometry. The mode field rides along untouched.
 */
const scaleTableData = (table: TableDataV1, scale: number): TableDataV1 => ({
  schemaVersion: 1,
  ...(table.sizingMode !== undefined ? { sizingMode: table.sizingMode } : {}),
  rows: table.rows.map((row) => ({
    ...row,
    height: row.height * scale,
    ...(row.minHeight !== undefined
      ? { minHeight: row.minHeight * scale }
      : {}),
  })),
  columns: table.columns.map((column) => ({
    ...column,
    width: column.width * scale,
    ...(column.minWidth !== undefined
      ? { minWidth: column.minWidth * scale }
      : {}),
  })),
  // cells keep their ids and styles; their geometry derives from the grid
  cells: table.cells,
});

/**
 * Local mutable update bag. `ElementUpdate<ExcalidrawElement>` distributes
 * into a union of per-type partials whose properties are readonly, which is
 * awkward to assemble field by field; this flat bag is structurally
 * assignable to it, and `fixedSegments` (an elbow-arrow-only field without a
 * union member of its own, compare the local update type in
 * `resizeMultipleElements`) is carried alongside.
 */
type TableElementUpdate = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  table?: TableDataV1;
  fontSize?: number;
  baseFontSize?: number | null;
  autoResize?: boolean;
  baseHeight?: number;
  textFitMode?: "auto" | "fixed";
  layoutFrozen?: boolean;
  points?: ExcalidrawLinearElement["points"];
  fixedSegments?: ExcalidrawElbowArrowElement["fixedSegments"];
};

/**
 * Scales one subtree element by `scale` around `anchor`. Font sizes scale by
 * the factor directly: `measureFontSizeFromWidth` derives a font from a width
 * ratio for non-uniform handles, which under a single uniform factor
 * degenerates to `fontSize × s` — without its measurement passes and
 * container lookups, which a pure data pass cannot afford.
 */
const computeElementScaleUpdate = (
  element: ExcalidrawElement,
  scale: number,
  anchor: { x: number; y: number },
  {
    persistTextModes,
    hostsById,
  }: {
    persistTextModes: boolean;
    hostsById: Map<string, ExcalidrawElement>;
  },
): ElementUpdate<NonDeletedExcalidrawElement> => {
  const nextWidth = element.width * scale;
  const nextHeight = element.height * scale;
  const update: TableElementUpdate = {
    x: anchor.x + (element.x - anchor.x) * scale,
    y: anchor.y + (element.y - anchor.y) * scale,
    width: nextWidth,
    height: nextHeight,
  };

  if (element.type === "table") {
    const nextTable = scaleTableData(element.table, scale);
    update.table = nextTable;
    // keep the element invariant exact: the size is the scaled grid's sums,
    // not an independently scaled float drifting from them
    update.width = getTableWidth(nextTable);
    update.height = getTableHeight(nextTable);
  }

  if (element.type === "text") {
    update.fontSize = element.fontSize * scale;
    // standalone texts (and cell background texts, which are unbound too)
    // freeze their box so the scaled text does not grow the cell back;
    // bound texts keep their `autoResize` and their container
    if (persistTextModes && !element.containerId && element.autoResize) {
      update.autoResize = false;
    }
    if (
      persistTextModes &&
      typeof element.baseFontSize === "number" &&
      hostsById.get(element.containerId ?? "")?.type === "stickynote"
    ) {
      // frozen sticky-note layout: the label's font ceiling scales with the
      // note so later edits do not relayout it back to the old size
      update.baseFontSize = element.baseFontSize * scale;
    }
  }

  if (element.type === "stickynote" && persistTextModes) {
    update.baseHeight = element.baseHeight * scale;
  }

  if (
    element.type === "composite_shape" &&
    persistTextModes &&
    // `getCompositeShapeTextFitMode` semantics; shapes without text (pie,
    // circular-ring) carry the mode inertly, which is harmless
    (element.textFitMode ?? "auto") !== "fixed"
  ) {
    update.textFitMode = "fixed";
  }

  if (
    element.type === "mindmap-node" &&
    persistTextModes &&
    !element.layoutFrozen
  ) {
    // the mindmap auto-fit (text re-measure in the editor + tree relayout)
    // is frozen with the scaled geometry (phase-1:113): later text edits
    // wrap/truncate to the current bounds and relayouts pin the position
    // instead of measuring the node back toward its unscaled size
    update.layoutFrozen = true;
  }

  // linear, freedraw and mindmap-edge paths: same uniform factor, following
  // the non-normalizing convention of `rescalePointsInElement` (a zero-extent
  // axis keeps its coordinate, which a uniform scale preserves anyway)
  if ("points" in element) {
    const points = rescalePoints(
      0,
      nextWidth,
      rescalePoints(1, nextHeight, element.points, false),
      false,
    );
    update.points = points;

    // elbow arrows carry absolute segment geometry; mirror
    // `resizeMultipleElements` and rescale it with the path
    if (isElbowArrow(element) && element.fixedSegments) {
      update.fixedSegments = element.fixedSegments.map((segment) => ({
        ...segment,
        start: points[segment.index - 1],
        end: points[segment.index],
      }));
    }
  }

  // images scale by width/height only: a uniform scale never flips, so the
  // `scale` axis factors (and the crop) stay untouched, as in single-element
  // proportional resizes (resizeElements.ts)

  return update;
};

/**
 * Computes the uniform-scale updates for `tableId`'s whole subtree. Returns
 * `null` when the id does not resolve to a (non-deleted) table element.
 *
 * Nested tables are enumerated once through their parent's cell children and
 * scale exactly once; their rows, columns and descendants are computed under
 * the same single factor. Updates are keyed by element id with every id
 * appearing at most once, so applying them cannot double-transform a bound
 * text reached through both its host and a scan.
 */
export const computeTableUniformScale = (
  elements: ElementsMapOrArray,
  tableId: string,
  scale: number,
  { anchor, persistTextModes = false }: TableUniformScaleOptions = {},
  prepared?: PreparedTableUniformScale,
): TableUniformScaleResult | null => {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`Invalid table scale: ${scale}`);
  }

  const context =
    prepared ?? prepareTableUniformScale(elements, tableId, anchor);
  if (!context) {
    return null;
  }

  const { subtree } = context;
  const clampedScale = Math.max(scale, context.minScale);
  const base = anchor ?? context.anchor;

  const updates = new Map<string, ElementUpdate<NonDeletedExcalidrawElement>>();
  for (const element of subtree.ordered) {
    updates.set(
      element.id,
      computeElementScaleUpdate(element, clampedScale, base, {
        persistTextModes,
        hostsById: subtree.byId,
      }),
    );
  }

  return { updates, clampedScale };
};

export const prepareTableUniformScale = (
  elements: ElementsMapOrArray,
  tableId: string,
  anchor?: { x: number; y: number },
): PreparedTableUniformScale | null => {
  const table = findElement(elements, tableId);
  if (!table || table.isDeleted || table.type !== "table") {
    return null;
  }

  const subtree = collectTableSubtree(elements, table);
  return {
    subtree,
    minScale: getSubtreeMinScale(subtree),
    anchor: anchor ?? { x: table.x, y: table.y },
  };
};
