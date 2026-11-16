import {
  CURSOR_TYPE,
  TABLE_STRUCTURE_INSERTION_OFFSET,
} from "@excalidraw/common";
import {
  deleteSequenceFragmentRow,
  getCursorForResizingElement,
  getSequenceFragmentInsertionBoundaries,
  getSequenceFragmentRowBounds,
  getSequenceFragmentRowIndexAt,
  getSequenceFragmentRowLayout,
  getSequenceFragmentRowSeparatorYs,
  insertSequenceFragmentRow,
  isSequenceFragmentElement,
  moveSequenceFragmentRow,
  refitSequenceFragmentRowBackgroundTexts,
  resizeSequenceFragmentRow,
  textRegionKey,
  updateBoundElements,
  withoutTextBlock,
} from "@excalidraw/element";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { Radians } from "@excalidraw/math";
import type { ExcalidrawElement, NonDeleted } from "@excalidraw/element/types";

import type {
  FragmentPointerGesture,
  FragmentRowSelection,
  FragmentStructureHover,
  PointerDownState,
} from "../../types";
import type App from "../App";

/**
 * Sequence-fragment row structure: the single-column sibling of the table's
 * row controls. A fragment's first row is the operator tab row; every row
 * below it is a condition. The interaction vocabulary is deliberately the
 * table's: an outer rail grip (select / drag to reorder), insertion dots on
 * the left at every row boundary, and draggable separators.
 */

type FragmentApp = Pick<App, keyof App> & Record<string, any>;

/** Structure hit metrics, CSS px (mirrors the table's row affordances). */
export const FRAGMENT_STRUCTURE_RAIL_HIT_SIZE = 16;
export const FRAGMENT_STRUCTURE_LINE_HIT_HALF = 4;
export const FRAGMENT_STRUCTURE_INSERT_HIT_HALF = 8;

const FRAGMENT_TOUCH_HIT_METRICS = { rail: 44, line: 22, insert: 22 } as const;
const FRAGMENT_MOUSE_HIT_METRICS = {
  rail: FRAGMENT_STRUCTURE_RAIL_HIT_SIZE,
  line: FRAGMENT_STRUCTURE_LINE_HIT_HALF,
  insert: FRAGMENT_STRUCTURE_INSERT_HIT_HALF,
} as const;

const getFragmentHitMetrics = (app: FragmentApp) =>
  app.editorInterface.isTouchScreen
    ? FRAGMENT_TOUCH_HIT_METRICS
    : FRAGMENT_MOUSE_HIT_METRICS;

type FragmentLocalPoint = { x: number; y: number };

/** Scene point -> fragment-local point (rotation-aware). */
const getFragmentLocalPoint = (
  element: ExcalidrawElement,
  sceneX: number,
  sceneY: number,
): FragmentLocalPoint => {
  if (!element.angle) {
    return { x: sceneX - element.x, y: sceneY - element.y };
  }
  const halfWidth = element.width / 2;
  const halfHeight = element.height / 2;
  const [rx, ry] = pointRotateRads(
    pointFrom(sceneX - element.x - halfWidth, sceneY - element.y - halfHeight),
    pointFrom(0, 0),
    -element.angle as Radians,
  );
  return { x: rx + halfWidth, y: ry + halfHeight };
};

/** The topmost unlocked fragment whose expanded envelope holds the point. */
const getFragmentAtSceneCoords = (
  app: FragmentApp,
  sceneX: number,
  sceneY: number,
) => {
  const zoom = app.state.zoom.value;
  const metrics = getFragmentHitMetrics(app);
  const outerExtent =
    TABLE_STRUCTURE_INSERTION_OFFSET / zoom + metrics.insert / zoom;
  const line = metrics.line / zoom;
  let candidate: ExcalidrawElement | null = null;
  for (const element of app.scene.getNonDeletedElements()) {
    if (!isSequenceFragmentElement(element) || element.locked) {
      continue;
    }
    const local = getFragmentLocalPoint(element, sceneX, sceneY);
    if (
      local.x >= -outerExtent &&
      local.x <= element.width + line &&
      local.y >= -line &&
      local.y <= element.height + line
    ) {
      candidate = element;
    }
  }
  return candidate;
};

/** Resolve the fragment row control under a scene point. */
export const getFragmentStructureHoverAtSceneCoords = (
  app: FragmentApp,
  sceneCoords: { x: number; y: number },
): FragmentStructureHover | null => {
  const element = getFragmentAtSceneCoords(app, sceneCoords.x, sceneCoords.y);
  if (!element || !isSequenceFragmentElement(element)) {
    return null;
  }
  const zoom = app.state.zoom.value;
  const metrics = getFragmentHitMetrics(app);
  const rail = metrics.rail / zoom;
  const line = metrics.line / zoom;
  const insertHalf = metrics.insert / zoom;
  const insertionOffset = TABLE_STRUCTURE_INSERTION_OFFSET / zoom;
  const insertOuter = insertionOffset + insertHalf;
  const insertInner = Math.max(0, insertionOffset - insertHalf);
  const local = getFragmentLocalPoint(element, sceneCoords.x, sceneCoords.y);
  const fragment = element.shape.fragment;
  const layout = getSequenceFragmentRowLayout(element.height, fragment);
  if (!layout.rows.length) {
    return null;
  }
  const insideRows = local.y >= 0 && local.y <= element.height;

  // Insertion dots sit outside the left frame, clear of the reorder rail.
  if (local.x >= -insertOuter && local.x < -insertInner) {
    for (const boundary of getSequenceFragmentInsertionBoundaries(
      element.height,
      fragment,
    )) {
      if (Math.abs(local.y - boundary.y) <= insertHalf) {
        return {
          elementId: element.id,
          kind: "rowInsert",
          boundaryIndex: boundary.boundaryIndex,
        };
      }
    }
  }

  // The outer left rail selects/reorders the row it spans.
  if (local.x >= -rail && local.x < 0 && insideRows) {
    const index = getSequenceFragmentRowIndexAt(
      element.height,
      fragment,
      local.y,
    );
    const row = layout.rows[index];
    if (row) {
      return { elementId: element.id, kind: "rowGrip", rowId: row.id };
    }
  }

  if (local.x >= 0 && local.x <= element.width && insideRows) {
    // Interior separators resize the row above them (the header included).
    for (const boundaryY of getSequenceFragmentRowSeparatorYs(
      element.height,
      fragment,
    )) {
      if (Math.abs(local.y - boundaryY) <= line) {
        const rowIndex = layout.rows.findIndex(
          (row) => Math.abs(row.y + row.height - boundaryY) < 1e-6,
        );
        const row = layout.rows[rowIndex];
        if (row) {
          return {
            elementId: element.id,
            kind: "rowResize",
            rowId: row.id,
            edge: "end",
          };
        }
      }
    }
    const rowIndex = getSequenceFragmentRowIndexAt(
      element.height,
      fragment,
      local.y,
    );
    const row = layout.rows[rowIndex];
    return row ? { elementId: element.id, kind: "body", rowId: row.id } : null;
  }

  return null;
};

export const getFragmentStructureCursor = (
  hover: FragmentStructureHover,
): string => {
  switch (hover.kind) {
    case "rowGrip":
    case "rowMove":
      return CURSOR_TYPE.MOVE;
    case "rowResize":
      return getCursorForResizingElement({ transformHandleType: "s" });
    case "rowInsert":
      return CURSOR_TYPE.POINTER;
    default:
      return CURSOR_TYPE.AUTO;
  }
};

/**
 * Gesture-owned write/clear of the fragment row hover channel. Hover frames
 * derive the same value into the pointer snapshot; gesture previews write the
 * snapshot synchronously so the renderer always reads one source.
 */
export const setFragmentStructureHover = (
  app: FragmentApp,
  hover: FragmentStructureHover | null,
): void => {
  app.pointer.setFragmentHover(hover);
};

const getFragmentRowBounds = (
  fragment: NonDeleted<ExcalidrawElement>,
  rowId: string,
) =>
  isSequenceFragmentElement(fragment)
    ? getSequenceFragmentRowBounds(
        fragment.width,
        fragment.height,
        fragment.shape.fragment,
        rowId,
      )
    : null;

/** Fragment row center in scene coords (rotation-aware), for the caret. */
const getFragmentRowCenter = (
  fragment: NonDeleted<ExcalidrawElement>,
  bounds: { x: number; y: number; width: number; height: number },
): { x: number; y: number } => {
  const local = pointFrom(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  const [rx, ry] = fragment.angle
    ? pointRotateRads(
        local,
        pointFrom(fragment.width / 2, fragment.height / 2),
        fragment.angle as Radians,
      )
    : local;
  return { x: fragment.x + rx, y: fragment.y + ry };
};

/** Re-lay the fragment's row background texts against the current rows. */
const refitFragmentRowTexts = (
  app: FragmentApp,
  fragment: NonDeleted<ExcalidrawElement>,
  opts?: { rowIds?: readonly string[]; grow?: boolean },
): void => {
  if (!isSequenceFragmentElement(fragment)) {
    return;
  }
  if (refitSequenceFragmentRowBackgroundTexts(app.scene, fragment, opts)) {
    app.scene.triggerUpdate();
  }
};

/** 双击行（含表头）直接进入该行的区域编辑。 */
export const handleFragmentDoubleClick = (
  app: FragmentApp,
  sceneX: number,
  sceneY: number,
): boolean => {
  const hits = app.getElementsAtPosition(sceneX, sceneY);
  const topHit = hits[hits.length - 1];
  if (!topHit || !isSequenceFragmentElement(topHit)) {
    return false;
  }
  const local = getFragmentLocalPoint(topHit, sceneX, sceneY);
  if (
    local.x < 0 ||
    local.x > topHit.width ||
    local.y < 0 ||
    local.y > topHit.height
  ) {
    return false;
  }
  const rowIndex = getSequenceFragmentRowIndexAt(
    topHit.height,
    topHit.shape.fragment,
    local.y,
  );
  const row = getSequenceFragmentRowLayout(topHit.height, topHit.shape.fragment)
    .rows[rowIndex];
  if (!row) {
    return false;
  }
  app.cursor.reset();
  app.startTextEditing({
    sceneX,
    sceneY,
    container: topHit,
    initialCaretSceneCoords: { x: sceneX, y: sceneY },
  });
  return true;
};

/** Enter on a selected row: edit that row's text region (table parity). */
export const editSelectedFragmentRowBackgroundText = (
  app: FragmentApp,
): boolean => {
  const selection: FragmentRowSelection | null = app.state.fragmentRowSelection;
  if (
    !selection ||
    app.state.editingTextElement ||
    app.state.editingTextRegion
  ) {
    return false;
  }
  const fragment = app.scene.getNonDeletedElement(selection.elementId);
  if (!fragment || !isSequenceFragmentElement(fragment) || fragment.locked) {
    return false;
  }
  const bounds = getFragmentRowBounds(fragment, selection.rowId);
  if (!bounds) {
    return false;
  }
  const center = getFragmentRowCenter(fragment, bounds);
  app.startTextEditing({
    sceneX: center.x,
    sceneY: center.y,
    container: fragment,
    initialCaretSceneCoords: center,
  });
  return true;
};

/**
 * Select a fragment row from the body (pointer up without drag). Mirrors the
 * table's cell selection: the row's own channel takes over and the element
 * selection is dropped so Delete reaches the row command.
 */
export const selectFragmentRow = (
  app: FragmentApp,
  elementId: string,
  rowId: string,
): boolean => {
  const fragment = app.scene.getNonDeletedElement(elementId);
  if (!fragment || !isSequenceFragmentElement(fragment) || fragment.locked) {
    return false;
  }
  if (!getFragmentRowBounds(fragment, rowId)) {
    return false;
  }
  app.setState((prevState: any) => {
    const selectedElementIds = { ...prevState.selectedElementIds };
    delete selectedElementIds[elementId];
    return {
      selectedElementIds,
      fragmentRowSelection: { elementId, rowId },
    };
  });
  return true;
};

/** ArrowUp/ArrowDown on a selected row moves the row selection (body only). */
export const moveSelectedFragmentRowFocus = (
  app: FragmentApp,
  direction: "up" | "down",
): boolean => {
  const selection: FragmentRowSelection | null = app.state.fragmentRowSelection;
  if (!selection || app.state.editingTextElement) {
    return false;
  }
  const fragment = app.scene.getNonDeletedElement(selection.elementId);
  if (!fragment || !isSequenceFragmentElement(fragment)) {
    return false;
  }
  const layout = getSequenceFragmentRowLayout(
    fragment.height,
    fragment.shape.fragment,
  );
  const index = layout.rows.findIndex((row) => row.id === selection.rowId);
  if (index < 1) {
    return false;
  }
  const nextIndex = Math.max(
    1,
    Math.min(layout.rows.length - 1, index + (direction === "down" ? 1 : -1)),
  );
  if (nextIndex === index) {
    return false;
  }
  app.setState({
    fragmentRowSelection: {
      elementId: fragment.id,
      rowId: layout.rows[nextIndex].id,
    },
  });
  return true;
};

/** Drop target for a row drag: final index plus the line to paint. */
const getFragmentMoveTarget = (
  element: ExcalidrawElement,
  rowId: string,
  localY: number,
): { targetIndex: number; boundaryIndex: number; y: number } | null => {
  if (!isSequenceFragmentElement(element)) {
    return null;
  }
  const layout = getSequenceFragmentRowLayout(
    element.height,
    element.shape.fragment,
  );
  const rows = layout.rows;
  const draggedIndex = rows.findIndex((row) => row.id === rowId);
  if (draggedIndex < 1 || rows.length < 3) {
    return null;
  }
  let best: { targetIndex: number; boundaryIndex: number; y: number } | null =
    null;
  let bestDistance = Infinity;
  // Candidate final indexes are the body rows; the header never reorders.
  for (let targetIndex = 1; targetIndex < rows.length; targetIndex++) {
    const boundaryY =
      targetIndex <= draggedIndex
        ? rows[targetIndex].y
        : rows[targetIndex].y + rows[targetIndex].height;
    const distance = Math.abs(localY - boundaryY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { targetIndex, boundaryIndex: targetIndex, y: boundaryY };
    }
  }
  return best;
};

/**
 * Pointer down on a fragment row control. Insertion commits immediately
 * (like the table's), the row grip arms a reorder, and a separator arms a
 * live resize. Returns whether the gesture was consumed.
 */
export const armFragmentStructureGestureOnPointerDown = (
  app: FragmentApp,
  pointerDownState: PointerDownState,
): boolean => {
  const hover = getFragmentStructureHoverAtSceneCoords(app, {
    x: pointerDownState.origin.x,
    y: pointerDownState.origin.y,
  });
  if (!hover || hover.kind === "body") {
    return false;
  }
  const element = app.scene.getNonDeletedElement(hover.elementId);
  if (!element || !isSequenceFragmentElement(element)) {
    return false;
  }
  const startShape = element.shape;
  const startHeight = element.height;

  if (hover.kind === "rowInsert") {
    const update = insertSequenceFragmentRow(element, hover.boundaryIndex);
    if (!update) {
      return false;
    }
    app.store.scheduleCapture();
    app.scene.mutateElement(element, {
      height: update.height,
      shape: update.shape,
    });
    app.scene.triggerUpdate();
    const live = app.scene.getNonDeletedElement(element.id);
    if (live) {
      refitFragmentRowTexts(app, live, { grow: false });
    }
    pointerDownState.fragmentGesture.active = {
      kind: "insertRow",
      elementId: element.id,
      startShape,
      startHeight,
    };
    setFragmentStructureHover(app, null);
    return true;
  }

  if (hover.kind === "rowGrip") {
    const layout = getSequenceFragmentRowLayout(
      startHeight,
      startShape.fragment,
    );
    const startIndex = layout.rows.findIndex((row) => row.id === hover.rowId);
    if (startIndex < 0) {
      return false;
    }
    pointerDownState.fragmentGesture.active = {
      kind: "moveRow",
      elementId: element.id,
      rowId: hover.rowId,
      startIndex,
      targetIndex: null,
    };
    app.setState({
      fragmentRowSelection: { elementId: element.id, rowId: hover.rowId },
    });
    return true;
  }

  if (hover.kind !== "rowResize") {
    return false;
  }
  const local = getFragmentLocalPoint(
    element,
    pointerDownState.origin.x,
    pointerDownState.origin.y,
  );
  pointerDownState.fragmentGesture.active = {
    kind: "resizeRow",
    elementId: element.id,
    rowId: hover.rowId,
    startShape,
    startHeight,
    startLocalY: local.y,
    hasChanged: false,
  };
  return true;
};

/** Per-frame progress of an armed fragment row gesture. */
export const handleFragmentGestureMove = (
  app: FragmentApp,
  pointerDownState: PointerDownState,
  pointerCoords: { x: number; y: number },
): boolean => {
  const gesture: FragmentPointerGesture | null =
    pointerDownState.fragmentGesture.active;
  if (!gesture) {
    return false;
  }
  if (gesture.kind === "insertRow") {
    return true;
  }
  const element = app.scene.getNonDeletedElement(gesture.elementId);
  if (!element || !isSequenceFragmentElement(element)) {
    return false;
  }
  const local = getFragmentLocalPoint(
    element,
    pointerCoords.x,
    pointerCoords.y,
  );

  if (gesture.kind === "resizeRow") {
    const startRows = getSequenceFragmentRowLayout(
      gesture.startHeight,
      gesture.startShape.fragment,
    );
    const startRow = startRows.rows.find((row) => row.id === gesture.rowId);
    if (!startRow) {
      return true;
    }
    const startElement = {
      ...element,
      height: gesture.startHeight,
      shape: gesture.startShape,
    } as ExcalidrawElement;
    const update = resizeSequenceFragmentRow(
      startElement,
      gesture.rowId,
      startRow.height + (local.y - gesture.startLocalY),
    );
    if (update) {
      app.scene.mutateElement(element, {
        height: update.height,
        shape: update.shape,
      });
      // the operator tab's height is the header row height: keep its bound
      // label laid out against the live tab
      updateBoundElements(element, app.scene);
      // row boundaries moved: row background texts follow their rows
      refitFragmentRowTexts(app, element, { grow: false });
      gesture.hasChanged = true;
    }
    setFragmentStructureHover(app, {
      elementId: element.id,
      kind: "rowResize",
      rowId: gesture.rowId,
      edge: "end",
    });
    return true;
  }

  const target = getFragmentMoveTarget(element, gesture.rowId, local.y);
  if (target) {
    gesture.targetIndex = target.targetIndex;
    setFragmentStructureHover(app, {
      elementId: element.id,
      kind: "rowMove",
      boundaryIndex: target.boundaryIndex,
      y: target.y,
    });
  }
  return true;
};

/** Esc during an armed gesture: restore the arm-time rows without history. */
export const cancelFragmentGesture = (
  app: FragmentApp,
  pointerDownState: PointerDownState,
): boolean => {
  const gesture = pointerDownState.fragmentGesture.active;
  if (!gesture) {
    return false;
  }
  pointerDownState.fragmentGesture.active = null;
  const element = app.scene.getNonDeletedElement(gesture.elementId);
  if (
    element &&
    isSequenceFragmentElement(element) &&
    (gesture.kind === "insertRow" || gesture.kind === "resizeRow")
  ) {
    app.scene.mutateElement(element, {
      height: gesture.startHeight,
      shape: gesture.startShape,
    });
    app.scene.triggerUpdate();
    const live = app.scene.getNonDeletedElement(element.id);
    if (live) {
      refitFragmentRowTexts(app, live, { grow: false });
    }
  }
  setFragmentStructureHover(app, null);
  return true;
};

/** Pointer up: commit the reorder/resize the preview showed. */
export const finalizeFragmentGestureOnPointerUp = (
  app: FragmentApp,
  pointerDownState: PointerDownState,
): boolean => {
  const gesture = pointerDownState.fragmentGesture.active;
  if (!gesture) {
    return false;
  }
  pointerDownState.fragmentGesture.active = null;
  const element = app.scene.getNonDeletedElement(gesture.elementId);
  if (
    gesture.kind === "moveRow" &&
    gesture.targetIndex !== null &&
    element &&
    isSequenceFragmentElement(element) &&
    gesture.targetIndex !== gesture.startIndex
  ) {
    const update = moveSequenceFragmentRow(
      element,
      gesture.rowId,
      gesture.targetIndex,
    );
    if (update) {
      app.store.scheduleCapture();
      app.scene.mutateElement(element, {
        height: update.height,
        shape: update.shape,
      });
      app.scene.triggerUpdate();
      const live = app.scene.getNonDeletedElement(element.id);
      if (live) {
        refitFragmentRowTexts(app, live, { grow: false });
      }
    }
  }
  setFragmentStructureHover(app, null);
  return true;
};

/** Delete key on a selected row: removes the row and shrinks the fragment. */
export const deleteSelectedFragmentRow = (app: FragmentApp): boolean => {
  const selection: FragmentRowSelection | null = app.state.fragmentRowSelection;
  if (!selection) {
    return false;
  }
  const element = app.scene.getNonDeletedElement(selection.elementId);
  if (!element || !isSequenceFragmentElement(element)) {
    app.setState({ fragmentRowSelection: null });
    return false;
  }
  const update = deleteSequenceFragmentRow(element, selection.rowId);
  if (!update) {
    // the header row is structural; keep it selected so the command is not
    // mistaken for a fragment deletion
    return false;
  }
  app.setState({ fragmentRowSelection: null });
  app.store.scheduleCapture();
  // 行被删除时一并移除它的文本区域，其它行 key 保持不动
  const nextTexts = withoutTextBlock(
    element.texts,
    textRegionKey.row(selection.rowId),
  );
  app.scene.mutateElement(element, {
    height: update.height,
    shape: update.shape,
    texts: nextTexts ?? {},
  });
  app.scene.triggerUpdate();
  const live = app.scene.getNonDeletedElement(element.id);
  if (live) {
    refitFragmentRowTexts(app, live, { grow: false });
  }
  return true;
};
