import {
  CURSOR_TYPE,
  KEYS,
  VERTICAL_ALIGN,
  distance,
  DRAGGING_THRESHOLD,
  getGridPoint,
  getFontString,
  getLineHeight,
  isSelectionLikeTool,
  TABLE_STRUCTURE_INSERTION_OFFSET,
} from "@excalidraw/common";
import { pointDistance, pointFrom } from "@excalidraw/math";
import {
  MIN_TABLE_COLUMN_WIDTH,
  MIN_TABLE_ROW_HEIGHT,
  computeTableAxisScale,
  computeTableUniformScale,
  prepareTableUniformScale,
  evenlySplitTableSize,
  fixBindingsAfterDeletion,
  getBoundTextElement,
  getCursorForResizingElement,
  getElementAbsoluteCoords,
  getIndexedTableCellChildren,
  getMemberTranslationsForColumns,
  getMemberTranslationsForRows,
  getTableCellAtPoint,
  getTableCellBounds,
  getTableColumnOffset,
  getTableHeight,
  getTableRowOffset,
  getTableSubtreeElements,
  getTableWidth,
  measureText,
  resizeTest,
  insertColumnInTable,
  insertRowInTable,
  isBelowTableMinimumPreset,
  isBoundToContainer,
  isFrameLikeElement,
  isTableCellBackgroundText,
  isTableElement,
  isTextElement,
  moveColumnInTable,
  moveRowInTable,
  newElementWith,
  newTextElement,
  newTableElement,
  removeColumnFromTable,
  removeRowFromTable,
  tableDefaultSizes,
  wrapText,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
  TableDataV1,
} from "@excalidraw/element/types";

import type {
  ElementUpdate,
  MaybeTransformHandleType,
} from "@excalidraw/element";

import { snapNewElement } from "../../snapping";

import type App from "../App";

import type {
  AppState,
  PointerDownState,
  TablePointerGesture,
  TableRowColStructureHover,
} from "../../types";

/**
 * The table interaction surface: drag creation, the cell hover channel and
 * per-cell background text editing. Structure commands (rows/columns,
 * drag-in, scaling) live in the element package and later phases.
 */

/** App compatibility shim, same as the other pointer controllers. */
type TableApp = Pick<App, keyof App> & Record<string, any>;

export const createTableElementOnPointerDown = (
  app: TableApp,
  pointerDownState: PointerDownState,
): void => {
  const [gridX, gridY] = getGridPoint(
    pointerDownState.origin.x,
    pointerDownState.origin.y,
    app.lastPointerDownEvent?.[KEYS.CTRL_OR_CMD]
      ? null
      : app.getEffectiveGridSize(),
  );

  // deepest container wins: a table drawn inside another table's cell is a
  // nested table (direct tableCell ref), else a frame, else the canvas
  // (phase-1.md:60, :87)
  const containerRef = app.getContainerRefForDropAt({
    x: gridX,
    y: gridY,
  });

  const table = newTableElement({
    type: "table",
    x: gridX,
    y: gridY,
    opacity: app.state.currentItemOpacity,
    locked: false,
    containerRef,
  });

  app.insertNewElement(table);

  app.setState({
    multiElement: null,
    newElement: table,
  });
};

/**
 * Preview drag for a new table: the dragged extent splits evenly across the
 * preset row/column counts. Row/column data moves with the size so the
 * element invariant (`width`/`height` = row/column sums) holds during the
 * whole gesture.
 */
export const maybeDragNewTableElement = (
  app: TableApp,
  pointerDownState: PointerDownState,
  event: MouseEvent | KeyboardEvent,
  informMutation = true,
): void => {
  const newElement = app.state.newElement as NonDeletedExcalidrawElement | null;
  if (!newElement || newElement.type !== "table") {
    return;
  }

  const pointerCoords = pointerDownState.lastCoords;
  let [gridX, gridY] = getGridPoint(
    pointerCoords.x,
    pointerCoords.y,
    event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
  );

  app.maybeCacheReferenceSnapPoints(event, [newElement]);

  const { snapOffset, snapLines } = snapNewElement(
    newElement,
    app,
    event,
    {
      x: pointerDownState.originInGrid.x + (app.state.originSnapOffset?.x ?? 0),
      y: pointerDownState.originInGrid.y + (app.state.originSnapOffset?.y ?? 0),
    },
    {
      x: gridX - pointerDownState.originInGrid.x,
      y: gridY - pointerDownState.originInGrid.y,
    },
    app.scene.getNonDeletedElementsMap(),
  );

  gridX += snapOffset.x;
  gridY += snapOffset.y;

  app.setState({
    snapLines,
  });

  const width = distance(pointerDownState.originInGrid.x, gridX);
  const height = distance(pointerDownState.originInGrid.y, gridY);
  // a drag towards the top/left keeps the far corner anchored, like
  // `dragNewElement` does for plain shapes
  const x =
    gridX < pointerDownState.originInGrid.x
      ? pointerDownState.originInGrid.x - width
      : pointerDownState.originInGrid.x;
  const y =
    gridY < pointerDownState.originInGrid.y
      ? pointerDownState.originInGrid.y - height
      : pointerDownState.originInGrid.y;

  const { rows, columns } = evenlySplitTableSize(
    newElement.table,
    width,
    height,
  );
  app.scene.mutateElement(
    newElement,
    {
      x,
      y,
      table: { ...newElement.table, rows, columns },
      width,
      height,
    },
    { informMutation, isDragging: false },
  );

  app.setState({
    newElement,
  });
};

/**
 * Release of a new-table drag. A click already holds the default preset; a
 * drag that cannot give every cell the interactive minimum falls back to the
 * default preset sizes (it was previewed at the true drag size, like the
 * sticky note). Selection and the tool revert stay in the shared pointer-up
 * tail.
 */
export const finalizeNewTableElementOnPointerUp = (
  app: TableApp,
  newElement: NonDeletedExcalidrawElement,
): void => {
  if (
    newElement.type !== "table" ||
    !isBelowTableMinimumPreset(newElement.table)
  ) {
    return;
  }

  const sizes = tableDefaultSizes(newElement.table);
  const table = { ...newElement.table, ...sizes };
  app.scene.mutateElement(
    newElement,
    {
      table,
      width: getTableWidth(table),
      height: getTableHeight(table),
    },
    { informMutation: false, isDragging: false },
  );

  app.store.scheduleCapture();
  app.scene.triggerUpdate();
};

/** Writes the shared cell-hover channel, no-op when the value is unchanged. */
export const updateTableCellHighlight = (
  app: TableApp,
  highlightedTableCell: AppState["highlightedTableCell"],
): void => {
  const previous = app.state.highlightedTableCell;
  if (
    previous?.tableId === highlightedTableCell?.tableId &&
    previous?.cellId === highlightedTableCell?.cellId
  ) {
    return;
  }
  app.setState({ highlightedTableCell });
};

/**
 * Hover highlight for the cell under the pointer. Same gesture gates as the
 * frame highlight, plus: a child element above the table keeps the pointer to
 * itself, and the channel is a selection-mode affordance until the drag-in
 * phase widens it to dragged elements.
 */
export const maybeUpdateTableCellHighlightOnPointerMove = (
  app: TableApp,
  sceneCoords: { x: number; y: number },
  isOverScrollBar: boolean,
): void => {
  if (
    app.state.newElement ||
    app.state.multiElement ||
    app.state.selectionElement ||
    // the cell under an open text editor must not move while typing; the
    // editor's submit/Esc path resets the channel
    app.state.editingTextElement
  ) {
    return;
  }

  if (app.state.selectedElementsAreBeingDragged) {
    // drag-in preview (phase-1.md:87): the live target for the dragged
    // elements, resolved by the very function the pointer-up commit uses.
    // A mindmap drag session owns its gesture entirely (no cell drop is
    // committed for it), so it must not advertise one.
    if (app.mindmap.getDragPreview?.()) {
      return;
    }
    const target = getTableCellDropTargetAtSceneCoords(app, sceneCoords, {
      excludeElementIds: app.state.selectedElementIds,
    });
    updateTableCellHighlight(
      app,
      target ? { tableId: target.table.id, cellId: target.cellId } : null,
    );
    return;
  }

  if (!isSelectionLikeTool(app.state.activeTool.type) || isOverScrollBar) {
    updateTableCellHighlight(app, null);
    return;
  }

  const hits = app.getElementsAtPosition(sceneCoords.x, sceneCoords.y);
  const topHit = hits[hits.length - 1];
  // a hit above the table (a cell's child, an unrelated element) keeps the
  // priority to the child; only a table itself resolves to a cell
  const table = topHit && topHit.type === "table" ? topHit : null;
  const cellId = table
    ? getTableCellAtPoint(table, sceneCoords.x, sceneCoords.y)
    : null;

  // structure zones beat cells (phase-1.md:85): a grip, separator, insert
  // boundary or select strip under the pointer suppresses the cell highlight
  const structureHover = getTableStructureHoverAtSceneCoords(app, sceneCoords);
  if (structureHover || !table || !cellId) {
    updateTableCellHighlight(app, null);
    return;
  }

  updateTableCellHighlight(app, { tableId: table.id, cellId });
};

/**
 * The cell a drop lands in (phase-1.md:87): the deepest visible table under
 * the point wins — nested tables sit above their parent in scene order, so
 * the scan keeps the last hit. Semantics mirror
 * `getTopLayerFrameAtSceneCoords`: locked tables are not bare drop targets,
 * but a hit on one of their members resolves to that member's cell, and a
 * pre-existing member of a table stays committed to it when an unrelated
 * element covers the drop point.
 *
 * Both the drag preview and the pointer-up commit call this function.
 */
export const getTableCellDropTargetAtSceneCoords = (
  app: TableApp,
  sceneCoords: { x: number; y: number },
  opts?: {
    /** to exclude selected (dragged) elements, etc. */
    excludeElementIds?: AppState["selectedElementIds"];
    /** the table a dragged cell member currently belongs to */
    currentTableId?: string | null;
  },
): { table: NonDeleted<ExcalidrawTableElement>; cellId: string } | null => {
  const elementsMap = app.scene.getNonDeletedElementsMap();

  const tablesUnderCursor: NonDeleted<ExcalidrawTableElement>[] = [];
  for (const element of app.scene.getNonDeletedElements()) {
    if (
      isTableElement(element) &&
      !element.locked &&
      getTableCellAtPoint(element, sceneCoords.x, sceneCoords.y)
    ) {
      tablesUnderCursor.push(element);
    }
  }

  if (!tablesUnderCursor.length) {
    return null;
  }

  const topLayerTable = tablesUnderCursor.at(-1)!;
  const topLayerCellId = getTableCellAtPoint(
    topLayerTable,
    sceneCoords.x,
    sceneCoords.y,
  )!;

  const hitElement = app
    .getElementsAtPosition(sceneCoords.x, sceneCoords.y, {
      includeLockedElements: true,
    })
    .findLast((element) => !opts?.excludeElementIds?.[element.id]);

  if (hitElement) {
    // the hit table itself accepts the drop for the cell under the pointer
    if (isTableElement(hitElement) && !hitElement.locked) {
      const hitCell = getTableCellAtPoint(
        hitElement,
        sceneCoords.x,
        sceneCoords.y,
      );
      if (hitCell) {
        return { table: hitElement, cellId: hitCell };
      }
    }

    // a cell member hit resolves to its direct parent cell — including a
    // member of a locked table
    if (
      hitElement.containerRef?.kind === "tableCell" &&
      !isBoundToContainer(hitElement)
    ) {
      const table = elementsMap.get(hitElement.containerRef.elementId);
      if (table && isTableElement(table) && !table.isDeleted) {
        return { table, cellId: hitElement.containerRef.cellId };
      }
    }

    const hitElementIndex = app.scene.getElementIndex(hitElement.id);
    const topLayerTableIndex = app.scene.getElementIndex(topLayerTable.id);

    if (
      hitElementIndex !== -1 &&
      topLayerTableIndex !== -1 &&
      hitElementIndex <= topLayerTableIndex
    ) {
      return { table: topLayerTable, cellId: topLayerCellId };
    }

    // to support dragging a pre-existing cell member underneath a
    // non-member element covering the cursor
    const currentTable = opts?.currentTableId
      ? tablesUnderCursor.find((table) => table.id === opts.currentTableId) ??
        null
      : null;

    if (currentTable) {
      return {
        table: currentTable,
        cellId: getTableCellAtPoint(
          currentTable,
          sceneCoords.x,
          sceneCoords.y,
        )!,
      };
    }

    return null;
  }

  return { table: topLayerTable, cellId: topLayerCellId };
};

/**
 * Double-click on a cell's blank area (or its background text) opens the
 * cell's background text editor, creating the text element when the cell has
 * none. Returns false when the double-click belongs to something else — a
 * hit above the table keeps the generic double-click behavior.
 */
export const handleTableCellDoubleClick = (
  app: TableApp,
  sceneX: number,
  sceneY: number,
): boolean => {
  const hits = app.getElementsAtPosition(sceneX, sceneY);
  const topHit = hits[hits.length - 1];
  if (!topHit || topHit.type !== "table") {
    return false;
  }
  const cellId = getTableCellAtPoint(topHit, sceneX, sceneY);
  if (!cellId) {
    return false;
  }

  app.cursor.reset();
  editTableCellBackgroundText(app, topHit, cellId, { x: sceneX, y: sceneY });
  return true;
};

const editTableCellBackgroundText = (
  app: TableApp,
  table: NonDeleted<ExcalidrawTableElement>,
  cellId: string,
  initialCaretSceneCoords: { x: number; y: number },
): void => {
  const elementsMap = app.scene.getNonDeletedElementsMap();
  // the cell index is keyed by a non-deleted collection, so members are
  // non-deleted; only text elements may carry the backgroundText role
  const existing = getIndexedTableCellChildren(
    elementsMap,
    table.id,
    cellId,
    "backgroundText",
  )?.find(
    (element): element is ExcalidrawTextElement => element.type === "text",
  ) as NonDeleted<ExcalidrawTextElement> | undefined;

  if (existing) {
    app.setState({ editingTextElement: existing });
    app.handleTextWysiwyg(existing, {
      isExistingElement: true,
      initialCaretSceneCoords,
    });
    return;
  }

  const text = createTableCellBackgroundText(app, table, cellId);

  app.setState({ editingTextElement: text });
  app.handleTextWysiwyg(text, { isExistingElement: false });
};

const createTableCellBackgroundText = (
  app: TableApp,
  table: NonDeleted<ExcalidrawTableElement>,
  cellId: string,
): NonDeleted<ExcalidrawTextElement> => {
  const bounds = getTableCellBounds(table.table, cellId);
  if (!bounds) {
    throw new Error(`Unknown table cell: ${cellId}`);
  }

  const fontFamily = app.state.currentItemFontFamily;

  let text = newTextElement({
    x: 0,
    y: 0,
    strokeColor: app.state.currentItemStrokeColor,
    backgroundColor: app.state.currentItemBackgroundColor,
    fillStyle: app.state.currentItemFillStyle,
    strokeWidth: app.getCurrentItemStrokeWidth("text"),
    strokeStyle: app.state.currentItemStrokeStyle,
    roughness: app.state.currentItemRoughness,
    opacity: app.state.currentItemOpacity,
    text: "",
    fontSize: app.state.currentItemFontSize,
    fontFamily,
    lineHeight: getLineHeight(fontFamily),
    // The text box covers the cell; wrapped background text can expand the
    // owning row, while the column width remains controlled by the table.
    textAlign: "center",
    verticalAlign: VERTICAL_ALIGN.MIDDLE,
    containerId: null,
    autoResize: false,
    locked: false,
    containerRef: {
      kind: "tableCell",
      elementId: table.id,
      cellId,
      role: "backgroundText",
    },
  });

  // Center the fixed-size box on the cell in scene coordinates, so the box
  // covers the cell exactly.
  const cellCenterX = table.x + bounds.x + bounds.width / 2;
  const cellCenterY = table.y + bounds.y + bounds.height / 2;
  text = newElementWith(text, {
    width: bounds.width,
    height: bounds.height,
    x: cellCenterX - bounds.width / 2,
    y: cellCenterY - bounds.height / 2,
  });

  app.scene.insertElementsAtIndex(
    [text],
    getTableCellBackgroundInsertionIndex(app, table, cellId),
  );

  return text;
};

/**
 * Scene index for a cell's background text: above the table element and below
 * the cell's other members — directly before the cell's first `content`
 * member, or right after the table when the cell has none (phase-1.md:68).
 * Inserted at the index itself (not appended), like bound text.
 */
const getTableCellBackgroundInsertionIndex = (
  app: TableApp,
  table: NonDeleted<ExcalidrawTableElement>,
  cellId: string,
): number => {
  const elements = app.scene.getElementsIncludingDeleted();
  const elementsMap = app.scene.getNonDeletedElementsMap();

  const firstContent = getIndexedTableCellChildren(
    elementsMap,
    table.id,
    cellId,
    "content",
  )?.[0];
  if (firstContent) {
    const index = elements.findIndex(
      (element) => element.id === firstContent.id,
    );
    if (index !== -1) {
      return index;
    }
  }

  const tableIndex = elements.findIndex((element) => element.id === table.id);
  return tableIndex === -1 ? elements.length : tableIndex + 1;
};

// ---------------------------------------------------------------------------
// Row/column structure UI (P1-5b): outer grips, resize separators, insertion
// boundaries and the row/column selection channel (phase-1.md:78-83, :91-97),
// plus the lower-right uniform scale gesture (phase-1.md:99-119).
//
// Two invariants run through everything below:
// - preview and commit resolve through the very same functions, so what the
//   user saw is exactly what lands (phase-1.md:87);
// - every gesture is judged against the snapshots taken when it was armed,
//   previews never accumulate rounding drift, and Esc restores the scene
//   verbatim without a history entry.
// ---------------------------------------------------------------------------

/** Minimum hit area of every structure zone, in CSS px (phase-1.md:89). */
export const TABLE_STRUCTURE_ZONE_SIZE = 24;

type TableLocalPoint = { x: number; y: number };

/** Scene point -> table-local point. */
const getTableLocalPoint = (
  table: NonDeleted<ExcalidrawTableElement>,
  sceneX: number,
  sceneY: number,
): TableLocalPoint => {
  return { x: sceneX - table.x, y: sceneY - table.y };
};

/** Cell center in scene geometry. */
const getTableCellSceneCenter = (
  table: NonDeleted<ExcalidrawTableElement>,
  cellId: string,
): { x: number; y: number } | null => {
  const bounds = getTableCellBounds(table.table, cellId);
  if (!bounds) {
    return null;
  }
  return {
    x: table.x + bounds.x + bounds.width / 2,
    y: table.y + bounds.y + bounds.height / 2,
  };
};

/**
 * Direct members of the given cells plus, for nested tables and frames, their
 * complete subtrees and every bound text — a row/column translation has to
 * carry all of them together.
 */
const collectCellMemberIds = (
  app: TableApp,
  tableId: string,
  cellIds: readonly string[],
): string[] => {
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const allElements = app.scene.getNonDeletedElements();
  const ids = new Set<string>();
  for (const cellId of cellIds) {
    for (const member of getIndexedTableCellChildren(
      elementsMap,
      tableId,
      cellId,
    ) ?? []) {
      ids.add(member.id);
      if (isTableElement(member) || isFrameLikeElement(member)) {
        for (const descendant of getTableSubtreeElements(
          allElements,
          member.id,
          elementsMap,
        )) {
          ids.add(descendant.id);
        }
      }
      const boundText = getBoundTextElement(member, elementsMap);
      if (boundText) {
        ids.add(boundText.id);
      }
    }
  }
  return [...ids];
};

/** Cell ids of one row or column of the table. */
const getRowOrColumnCellIds = (
  table: NonDeleted<ExcalidrawTableElement>,
  kind: "row" | "column",
  id: string,
): string[] =>
  table.table.cells
    .filter((cell) => (kind === "row" ? cell.rowId : cell.columnId) === id)
    .map((cell) => cell.id);

/**
 * Resolves the translation delta for every member element of the translated
 * rows/columns — direct cell members, nested subtree members, and bound texts
 * (which follow their host, having no cell ref of their own).
 */
const buildMemberDeltas = (
  app: TableApp,
  table: NonDeleted<ExcalidrawTableElement>,
  kind: "row" | "column",
  translations: Map<string, { dx: number; dy: number }>,
): Map<string, { dx: number; dy: number }> => {
  const deltas = new Map<string, { dx: number; dy: number }>();
  for (const id of translations.keys()) {
    const delta = translations.get(id)!;
    for (const memberId of collectCellMemberIds(
      app,
      table.id,
      getRowOrColumnCellIds(table, kind, id),
    )) {
      deltas.set(memberId, delta);
    }
  }

  // bound texts have no cell ref: they move with their host element
  const elementsMap = app.scene.getNonDeletedElementsMap();
  for (const [memberId, delta] of deltas) {
    const member = elementsMap.get(memberId);
    const boundText = member ? getBoundTextElement(member, elementsMap) : null;
    if (boundText && !deltas.has(boundText.id)) {
      deltas.set(boundText.id, delta);
    }
  }
  return deltas;
};

/**
 * Moves the members of every translated row/column by its table-provided
 * delta — `getMemberTranslationsForRows/Columns` is the only source of member
 * displacement (phase-1.md:95); the App layer never computes one itself.
 * With `startMembers` given, positions reset from the arm-time snapshot so
 * live drag frames cannot accumulate rounding drift.
 */
const applyMemberTranslations = (
  app: TableApp,
  table: NonDeleted<ExcalidrawTableElement>,
  kind: "row" | "column",
  translations: Map<string, { dx: number; dy: number }>,
  opts?: {
    startMembers?: Map<string, { x: number; y: number; ownerId: string }>;
  },
): boolean => {
  if (!translations.size) {
    return false;
  }
  const deltas = buildMemberDeltas(app, table, kind, translations);
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const candidateIds = opts?.startMembers
    ? [...opts.startMembers.keys()]
    : [...deltas.keys()];
  let movedAny = false;

  for (const memberId of candidateIds) {
    const member = elementsMap.get(memberId);
    if (!member || member.isDeleted) {
      continue;
    }
    const start = opts?.startMembers?.get(memberId);
    const delta = deltas.get(memberId) ?? { dx: 0, dy: 0 };
    const x = (start ? start.x : member.x) + delta.dx;
    const y = (start ? start.y : member.y) + delta.dy;
    if (member.x !== x || member.y !== y) {
      app.scene.mutateElement(
        member as ExcalidrawElement,
        { x, y },
        { informMutation: false, isDragging: true },
      );
      movedAny = true;
    }
  }
  return movedAny;
};

/**
 * Re-fits the background text boxes of the given cells to their (new) cell
 * geometry. Background text uses the current column width for wrapping and
 * its measured height is allowed to grow the owning row.
 */
const refitCellBackgroundTexts = (
  app: TableApp,
  table: NonDeleted<ExcalidrawTableElement>,
  cellIds: readonly string[],
): void => {
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const textsByCell = new Map<string, ExcalidrawTextElement[]>();
  const requiredHeights = new Map<string, number>();
  for (const cellId of cellIds) {
    const texts = getIndexedTableCellChildren(
      elementsMap,
      table.id,
      cellId,
      "backgroundText",
    );
    if (!texts?.length) {
      continue;
    }
    const bounds = getTableCellBounds(table.table, cellId);
    if (!bounds) {
      continue;
    }
    const cell = table.table.cells.find((candidate) => candidate.id === cellId);
    if (!cell) {
      continue;
    }
    const row = table.table.rows.find(
      (candidate) => candidate.id === cell.rowId,
    );
    if (!row) {
      continue;
    }
    const backgroundTexts = texts as ExcalidrawTextElement[];
    textsByCell.set(cellId, backgroundTexts);
    for (const backgroundText of backgroundTexts) {
      const wrapped = wrapText(
        backgroundText.originalText,
        getFontString(backgroundText),
        Math.max(bounds.width, 1),
      );
      const height = measureText(
        wrapped,
        getFontString(backgroundText),
        backgroundText.lineHeight,
      ).height;
      requiredHeights.set(
        row.id,
        Math.max(requiredHeights.get(row.id) ?? 0, height),
      );
    }
  }

  const rowsNeedGrowth = table.table.rows.some((row) => {
    const requiredHeight = requiredHeights.get(row.id);
    return requiredHeight !== undefined && requiredHeight > row.height;
  });
  if (rowsNeedGrowth) {
    const nextTable: TableDataV1 = {
      ...table.table,
      rows: table.table.rows.map((row) => {
        const requiredHeight = requiredHeights.get(row.id);
        return requiredHeight !== undefined && requiredHeight > row.height
          ? { ...row, height: requiredHeight }
          : row;
      }),
    };
    const translations = getMemberTranslationsForRows(table.table, nextTable);
    applyMemberTranslations(app, table, "row", translations);
    app.scene.mutateElement(
      table,
      {
        table: nextTable,
        height: getTableHeight(nextTable),
      },
      { informMutation: false, isDragging: true },
    );
  }

  const currentTable = app.scene.getNonDeletedElement(table.id);
  if (!currentTable || !isTableElement(currentTable)) {
    return;
  }
  const currentElementsMap = app.scene.getNonDeletedElementsMap();
  for (const [cellId, backgroundTexts] of textsByCell) {
    const bounds = getTableCellBounds(currentTable.table, cellId);
    const center = getTableCellSceneCenter(currentTable, cellId);
    if (!bounds || !center) {
      continue;
    }
    for (const backgroundText of backgroundTexts) {
      const liveText = currentElementsMap.get(backgroundText.id);
      if (!liveText || !isTextElement(liveText)) {
        continue;
      }
      const wrapped = wrapText(
        liveText.originalText,
        getFontString(liveText),
        Math.max(bounds.width, 1),
      );
      const height = measureText(
        wrapped,
        getFontString(liveText),
        liveText.lineHeight,
      ).height;
      app.scene.mutateElement(
        liveText,
        {
          x: center.x - bounds.width / 2,
          y: center.y - height / 2,
          width: bounds.width,
          height,
          text: wrapped,
        },
        { informMutation: false, isDragging: true },
      );
    }
  }
};

/**
 * Background text is a row-sizing input regardless of the table's sizing
 * mode. The text box keeps the cell width, while its wrapped height grows the
 * row and translates members in later rows.
 */
export const refitTableCellBackgroundText = (
  app: TableApp,
  elementId: string,
): boolean => {
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const text = elementsMap.get(elementId);
  const ref = text?.containerRef;
  if (!text || !isTableCellBackgroundText(text) || ref?.kind !== "tableCell") {
    return false;
  }

  const table = elementsMap.get(ref.elementId);
  if (!table || !isTableElement(table)) {
    return false;
  }
  const cell = table.table.cells.find(
    (candidate) => candidate.id === ref.cellId,
  );
  if (!cell) {
    return false;
  }
  const bounds = getTableCellBounds(table.table, cell.id);
  if (!bounds) {
    return false;
  }

  const row = table.table.rows.find((candidate) => candidate.id === cell.rowId);
  if (!row) {
    return false;
  }
  refitCellBackgroundTexts(app, table, [cell.id]);
  const updatedTable = app.scene.getNonDeletedElement(table.id);
  app.scene.triggerUpdate();
  return Boolean(
    updatedTable &&
      isTableElement(updatedTable) &&
      updatedTable.table.rows.find((candidate) => candidate.id === row.id)
        ?.height !== row.height,
  );
};

/**
 * The structure zones of one table, judged in table-local coordinates
 * (phase-1.md:80-83). Priority: insertion point > reorder grip > resize
 * line > first row/column border strip (outer frame affordances beat
 * cells). Every zone is at least `TABLE_STRUCTURE_ZONE_SIZE` CSS px wide.
 * Resize lines carry the dragged `edge`: an `end` border squeezes the two
 * adjacent entries, a `start` border (the outer left/top frame) grows the
 * first entry and moves the frame edge.
 */
const resolveStructureHover = (
  app: TableApp,
  table: NonDeleted<ExcalidrawTableElement>,
  local: TableLocalPoint,
): TableRowColStructureHover | null => {
  const band = TABLE_STRUCTURE_ZONE_SIZE / app.state.zoom.value;
  const { x: lx, y: ly } = local;
  const inLeftBand = lx >= -band && lx < 0;
  const inTopBand = ly >= -band && ly < 0;
  const insertionExtent =
    TABLE_STRUCTURE_INSERTION_OFFSET / app.state.zoom.value + band / 2;
  const inLeftInsertionBand = lx >= -insertionExtent && lx < 0;
  const inTopInsertionBand = ly >= -insertionExtent && ly < 0;
  const inRightBand = lx >= table.width - band / 2 && lx <= table.width + band;
  const inBottomBand =
    ly >= table.height - band / 2 && ly <= table.height + band;
  const insideRows = ly >= 0 && ly <= table.height;
  const insideColumns = lx >= 0 && lx <= table.width;

  // The top and left rails expose reorder handles and insertion points.
  // Resolve the boundaries first so their plus buttons remain clickable.
  if (inTopInsertionBand && lx >= -band / 2 && lx <= table.width + band / 2) {
    let offset = 0;
    for (let index = 0; index <= table.table.columns.length; index++) {
      if (index > 0) {
        offset += table.table.columns[index - 1].width;
      }
      if (Math.abs(lx - offset) <= band / 2) {
        return {
          tableId: table.id,
          kind: "columnInsert",
          boundaryIndex: index,
        };
      }
    }
  }
  if (inTopBand && insideColumns) {
    const columnId = rowOrColumnIdAt(table, "column", lx);
    if (columnId) {
      return { tableId: table.id, kind: "columnGrip", columnId };
    }
  }
  if (inLeftInsertionBand && ly >= -band / 2 && ly <= table.height + band / 2) {
    let offset = 0;
    for (let index = 0; index <= table.table.rows.length; index++) {
      if (index > 0) {
        offset += table.table.rows[index - 1].height;
      }
      if (Math.abs(ly - offset) <= band / 2) {
        return { tableId: table.id, kind: "rowInsert", boundaryIndex: index };
      }
    }
  }
  if (inLeftBand && insideRows) {
    const rowId = rowOrColumnIdAt(table, "row", ly);
    if (rowId) {
      return { tableId: table.id, kind: "rowGrip", rowId };
    }
  }

  if (lx === 0 || ly === 0) {
    return null;
  }

  if (inRightBand && insideRows) {
    return {
      tableId: table.id,
      kind: "columnResize",
      columnId: table.table.columns[table.table.columns.length - 1].id,
      edge: "end",
    };
  }
  if (inBottomBand && insideColumns) {
    return {
      tableId: table.id,
      kind: "rowResize",
      rowId: table.table.rows[table.table.rows.length - 1].id,
      edge: "end",
    };
  }

  // The interior grid lines drag the boundary between the two adjacent
  // rows/columns: the entry above/left grows or shrinks, its neighbor
  // compensates, and the table's total size stays put.
  if (insideRows && insideColumns) {
    let offset = 0;
    for (const row of table.table.rows.slice(0, -1)) {
      offset += row.height;
      if (Math.abs(ly - offset) <= band / 2) {
        return {
          tableId: table.id,
          kind: "rowResize",
          rowId: row.id,
          edge: "end",
        };
      }
    }
    offset = 0;
    for (const column of table.table.columns.slice(0, -1)) {
      offset += column.width;
      if (Math.abs(lx - offset) <= band / 2) {
        return {
          tableId: table.id,
          kind: "columnResize",
          columnId: column.id,
          edge: "end",
        };
      }
    }
  }

  // The strips just inside the left/top frame drag the first column's/row's
  // outer border: the entry grows or shrinks and the frame edge follows it.
  if (insideRows && insideColumns) {
    if (lx < band) {
      const columnId = table.table.columns[0].id;
      return {
        tableId: table.id,
        kind: "columnResize",
        columnId,
        edge: "start",
      };
    }
    if (ly < band) {
      const rowId = table.table.rows[0].id;
      return { tableId: table.id, kind: "rowResize", rowId, edge: "start" };
    }
  }

  return null;
};

/** The row (or column) id whose span contains the given local coordinate. */
const rowOrColumnIdAt = (
  table: NonDeleted<ExcalidrawTableElement>,
  kind: "row" | "column",
  coordinate: number,
): string | null => {
  const entries =
    kind === "row"
      ? table.table.rows.map(({ id, height }) => ({ id, size: height }))
      : table.table.columns.map(({ id, width }) => ({ id, size: width }));
  let offset = 0;
  for (const entry of entries) {
    if (coordinate < offset + entry.size) {
      return entry.id;
    }
    offset += entry.size;
  }
  return null;
};

/**
 * The table whose structure zones the pointer rests on: the topmost visible,
 * unlocked table whose zone envelope (bounds grown by one zone band) contains
 * the point — the same topmost-wins rule the cell highlight uses.
 */
const getStructureZoneTableAtSceneCoords = (
  app: TableApp,
  sceneX: number,
  sceneY: number,
): NonDeleted<ExcalidrawTableElement> | null => {
  const band = TABLE_STRUCTURE_ZONE_SIZE / app.state.zoom.value;
  const outerExtent =
    TABLE_STRUCTURE_INSERTION_OFFSET / app.state.zoom.value + band / 2;
  let candidate: NonDeleted<ExcalidrawTableElement> | null = null;
  for (const element of app.scene.getNonDeletedElements()) {
    if (!isTableElement(element) || element.locked) {
      continue;
    }
    const local = getTableLocalPoint(element, sceneX, sceneY);
    if (
      local.x >= -outerExtent &&
      local.x <= element.width + band &&
      local.y >= -outerExtent &&
      local.y <= element.height + band
    ) {
      candidate = element;
    }
  }
  return candidate;
};

/**
 * Structure zones of the pointer position, with the lower-right scale
 * handle of a selected table winning over the bottom and right resize zones.
 */
export const getTableStructureHoverAtSceneCoords = (
  app: TableApp,
  sceneCoords: { x: number; y: number },
): TableRowColStructureHover | null => {
  const table = getStructureZoneTableAtSceneCoords(
    app,
    sceneCoords.x,
    sceneCoords.y,
  );
  if (!table) {
    return null;
  }

  // The selected table's whole frame scales (corners uniformly, sides one
  // axis) — its frame band wins over every structure zone around it.
  const selectedElements = app.scene.getSelectedElements(app.state);
  if (
    selectedElements.length === 1 &&
    selectedElements[0].id === table.id &&
    isTableElement(selectedElements[0])
  ) {
    const handleType = resizeTest(
      table,
      app.scene.getNonDeletedElementsMap(),
      app.state,
      sceneCoords.x,
      sceneCoords.y,
      app.state.zoom,
      "mouse",
      app.editorInterface,
    );
    if (handleType) {
      return null;
    }
  }

  return resolveStructureHover(
    app,
    table,
    getTableLocalPoint(table, sceneCoords.x, sceneCoords.y),
  );
};

const STRUCTURE_CURSORS: {
  [T in TableRowColStructureHover["kind"]]: string;
} = {
  table: CURSOR_TYPE.AUTO,
  rowGrip: CURSOR_TYPE.MOVE,
  columnGrip: CURSOR_TYPE.MOVE,
  rowResize: getCursorForResizingElement({ transformHandleType: "s" }),
  columnResize: getCursorForResizingElement({ transformHandleType: "e" }),
  rowInsert: CURSOR_TYPE.POINTER,
  columnInsert: CURSOR_TYPE.POINTER,
};

export const getTableStructureCursor = (
  hover: TableRowColStructureHover,
): string => STRUCTURE_CURSORS[hover.kind];

/**
 * Writes the shared structure-hover channel, no-op when the value is
 * unchanged. The unified interaction dispatch derives this legacy state
 * field from the resolved target (interaction-target-resolution.md), so
 * callers must not set it around the pointer-move flow themselves.
 */
export const setTableStructureHover = (
  app: TableApp,
  hover: TableRowColStructureHover | null,
): void => {
  const previous = app.state.tableStructureHover;
  if (
    previous?.kind === hover?.kind &&
    previous?.tableId === hover?.tableId &&
    (previous as any)?.id === (hover as any)?.id &&
    (previous as any)?.rowId === (hover as any)?.rowId &&
    (previous as any)?.columnId === (hover as any)?.columnId &&
    (previous as any)?.boundaryIndex === (hover as any)?.boundaryIndex
  ) {
    return;
  }
  app.setState({ tableStructureHover: hover });
};

/**
 * The grid-region hover used to reveal a table's structure affordances when
 * the pointer rests on its body with no zone under it. Unlike the zone
 * hover, this never wins over cell highlight or element hits.
 */
export const getTableBodyHoverAtSceneCoords = (
  app: TableApp,
  sceneCoords: { x: number; y: number },
): TableRowColStructureHover | null => {
  const table = getStructureZoneTableAtSceneCoords(
    app,
    sceneCoords.x,
    sceneCoords.y,
  );
  if (!table) {
    return null;
  }
  const local = getTableLocalPoint(table, sceneCoords.x, sceneCoords.y);
  if (
    local.x >= 0 &&
    local.x <= table.width &&
    local.y >= 0 &&
    local.y <= table.height
  ) {
    return { tableId: table.id, kind: "table" };
  }
  return null;
};

/**
 * Legacy structure-hover channel, kept for flows where the unified
 * interaction dispatch is ineligible (dragging, creating, gesturing). When
 * the dispatch runs, it owns this state through the table provider instead.
 */
export const maybeUpdateTableStructureHoverOnPointerMove = (
  app: TableApp,
  sceneCoords: { x: number; y: number },
  isOverScrollBar: boolean,
): void => {
  if (
    !isSelectionLikeTool(app.state.activeTool.type) ||
    isOverScrollBar ||
    app.state.viewModeEnabled ||
    app.state.editingTextElement ||
    app.state.newElement ||
    app.state.multiElement ||
    app.state.selectionElement ||
    app.state.selectedElementsAreBeingDragged
  ) {
    return;
  }

  const hover =
    getTableStructureHoverAtSceneCoords(app, sceneCoords) ??
    getTableBodyHoverAtSceneCoords(app, sceneCoords);
  setTableStructureHover(app, hover);
};

/**
 * Where a dragged row/column would land: the boundary between the remaining
 * rows/columns the pointer hovers, as the final array index
 * `moveRowInTable`/`moveColumnInTable` expects, plus the table-local offset
 * of the preview line. The offset lives in the current grid — the source
 * row/column still occupies its band while dragged — so the line always
 * sits on a visible grid boundary no matter the row heights / column widths.
 * The drag preview and the pointer-up commit both call this, so the line
 * the user sees is exactly the landing spot (phase-1.md:87, :94).
 */
const resolveTableMoveTarget = (
  table: NonDeleted<ExcalidrawTableElement>,
  kind: "moveRow" | "moveColumn",
  id: string,
  local: TableLocalPoint,
): { offset: number; boundaryIndex: number } => {
  const entries =
    kind === "moveRow"
      ? table.table.rows.map(({ id: entryId, height }) => ({
          id: entryId,
          size: height,
        }))
      : table.table.columns.map(({ id: entryId, width }) => ({
          id: entryId,
          size: width,
        }));
  const coordinate = kind === "moveRow" ? local.y : local.x;

  // 判定用当前网格的几何：指针越过多少个非源行/列的中心，就是落点下标
  let boundaryIndex = 0;
  let offset = 0;
  for (const entry of entries) {
    if (entry.id !== id && coordinate > offset + entry.size / 2) {
      boundaryIndex += 1;
    }
    offset += entry.size;
  }

  // 预览线画在当前网格的可见边界上：源行/列在拖动期间仍占着原位置，所以
  // 按当前数组的完整累加和取落点边界——源行/列计入累计和，只是不计入落点
  // 计数。行高/列宽不等时指示器也不会漂移出可见网格线
  let lineOffset = 0;
  let seen = 0;
  for (const entry of entries) {
    if (seen === boundaryIndex) {
      break;
    }
    lineOffset += entry.size;
    if (entry.id !== id) {
      seen += 1;
    }
  }
  return { offset: lineOffset, boundaryIndex };
};

/**
 * Arms the whole-table scale gesture for a selected table's frame handle:
 * any corner scales the subtree uniformly from the opposite corner, any
 * side stretches one axis from the opposite side (that axis's fonts stay
 * untouched). Returns false for other handle types or when the table's
 * subtree cannot be prepared.
 */
export const maybeArmTableScaleGesture = (
  app: TableApp,
  pointerDownState: PointerDownState,
  table: NonDeleted<ExcalidrawTableElement>,
  handleType: MaybeTransformHandleType,
): boolean => {
  if (
    handleType !== "nw" &&
    handleType !== "ne" &&
    handleType !== "sw" &&
    handleType !== "se" &&
    handleType !== "n" &&
    handleType !== "s" &&
    handleType !== "e" &&
    handleType !== "w"
  ) {
    return false;
  }

  const [x1, y1, x2, y2] = getElementAbsoluteCoords(
    table,
    app.scene.getNonDeletedElementsMap(),
  );
  // the opposite corner stays fixed while the subtree scales
  const cornerAnchors: Record<
    "nw" | "ne" | "sw" | "se",
    { x: number; y: number }
  > = {
    se: { x: x1, y: y1 },
    nw: { x: x2, y: y2 },
    ne: { x: x1, y: y2 },
    sw: { x: x2, y: y1 },
  };
  const axis =
    handleType === "n" || handleType === "s"
      ? ("y" as const)
      : handleType === "e" || handleType === "w"
      ? ("x" as const)
      : undefined;
  // side anchors: the opposite side's midpoint stays fixed on the dragged axis
  const anchor = cornerAnchors[handleType as "nw" | "ne" | "sw" | "se"] ?? {
    x:
      handleType === "e"
        ? x1
        : handleType === "w"
        ? x2
        : (x1 + x2) / 2,
    y:
      handleType === "s"
        ? y1
        : handleType === "n"
        ? y2
        : (y1 + y2) / 2,
  };

  const preparedScale = prepareTableUniformScale(
    pointerDownState.originalElements,
    table.id,
    anchor,
  );
  if (!preparedScale) {
    return false;
  }
  pointerDownState.tableGesture.active = {
    kind: "scale",
    tableId: table.id,
    handleType,
    ...(axis ? { axis } : {}),
    startBounds: [x1, y1, x2, y2],
    anchor,
    subtreeIds: preparedScale.subtree.ordered.map((element) => element.id),
    snapshotElements: pointerDownState.originalElements,
    preparedScale,
    previewScale: 1,
  };
  return true;
};

/**
 * Pointer down on a structure zone: arms the matching gesture on
 * `pointerDownState.tableGesture` (snapshots taken now), performs the
 * row/column select click of a grip immediately, and reports whether the
 * event was consumed. Consumed pointer downs skip element selection
 * entirely — outer frame affordances beat cells (phase-1.md:85).
 */
export const armTableStructureGestureOnPointerDown = (
  app: TableApp,
  pointerDownState: PointerDownState,
): boolean => {
  if (
    !isSelectionLikeTool(app.state.activeTool.type) ||
    app.state.viewModeEnabled ||
    app.state.editingTextElement
  ) {
    return false;
  }

  const sceneCoords = pointerDownState.origin;
  // The selected table's whole frame scales (corners uniformly, sides one
  // axis) and beats every structure zone around it.
  const selectedElements = app.scene.getSelectedElements(app.state);
  if (selectedElements.length === 1 && isTableElement(selectedElements[0])) {
    const table = selectedElements[0];
    const handleType = resizeTest(
      table,
      app.scene.getNonDeletedElementsMap(),
      app.state,
      sceneCoords.x,
      sceneCoords.y,
      app.state.zoom,
      "mouse",
      app.editorInterface,
    );
    if (
      handleType &&
      maybeArmTableScaleGesture(app, pointerDownState, table, handleType)
    ) {
      return true;
    }
  }
  const hover = getTableStructureHoverAtSceneCoords(app, sceneCoords);
  if (!hover) {
    // any pointer down off the structure zones leaves the row/column
    // selection channel — the next click inside a cell is a plain one
    if (app.state.tableRowColSelection) {
      app.setState({ tableRowColSelection: null });
    }
    return false;
  }

  switch (hover.kind) {
    case "table": {
      return false;
    }
    case "rowGrip":
    case "columnGrip":
    case "rowResize":
    case "columnResize":
    case "rowInsert":
    case "columnInsert": {
      break;
    }
  }

  switch (hover.kind) {
    case "rowGrip": {
      app.setState({
        tableRowColSelection: {
          tableId: hover.tableId,
          kind: "row",
          id: hover.rowId,
        },
      });
      pointerDownState.tableGesture.active = {
        kind: "moveRow",
        tableId: hover.tableId,
        rowId: hover.rowId,
      };
      break;
    }
    case "columnGrip": {
      app.setState({
        tableRowColSelection: {
          tableId: hover.tableId,
          kind: "column",
          id: hover.columnId,
        },
      });
      pointerDownState.tableGesture.active = {
        kind: "moveColumn",
        tableId: hover.tableId,
        columnId: hover.columnId,
      };
      break;
    }
    case "rowResize":
    case "columnResize": {
      const table = app.scene.getNonDeletedElement(hover.tableId);
      if (!table || !isTableElement(table)) {
        return false;
      }
      const isRow = hover.kind === "rowResize";
      const entries = isRow ? table.table.rows : table.table.columns;
      const id = isRow ? hover.rowId : hover.columnId;
      const startIndex = entries.findIndex((entry) => entry.id === id);
      if (startIndex < 0) {
        return false;
      }
      const startMembers = collectTableMemberSnapshots(
        app,
        table,
        isRow ? "row" : "column",
      );
      // the members whose cell geometry the drag changes: an `end` border
      // moves the boundary into the adjacent next entry (squeeze), while a
      // `start` border drags the first entry's outer frame edge
      const affectedOwnerIds =
        hover.edge === "start"
          ? new Set([entries[0].id])
          : new Set(
              entries
                .slice(startIndex + 1, startIndex + 2)
                .map((entry) => entry.id),
            );
      const startOffset = isRow
        ? getTableRowOffset(table.table, id)
        : getTableColumnOffset(table.table, id);
      if (startOffset === null) {
        return false;
      }
      const resizedCellIds = getRowOrColumnCellIds(
        table,
        isRow ? "row" : "column",
        id,
      ).concat(
        hover.edge === "end" && entries[startIndex + 1]
          ? getRowOrColumnCellIds(
              table,
              isRow ? "row" : "column",
              entries[startIndex + 1].id,
            )
          : [],
      );
      pointerDownState.tableGesture.active = {
        kind: isRow ? "resizeRow" : "resizeColumn",
        tableId: hover.tableId,
        id,
        edge: hover.edge,
        startTable: table.table,
        startX: table.x,
        startY: table.y,
        startMembers,
        affectedMembers: [...startMembers]
          .filter(([, member]) => affectedOwnerIds.has(member.ownerId))
          .map(([memberId]) => memberId),
        resizedCellIds,
        startIndex,
        startSize: isRow
          ? table.table.rows[startIndex].height
          : table.table.columns[startIndex].width,
        startOffset,
        startLocal: getTableLocalPoint(table, sceneCoords.x, sceneCoords.y),
        startElements: app.scene.getElementsIncludingDeleted(),
      };
      break;
    }
    case "rowInsert": {
      pointerDownState.tableGesture.active = {
        kind: "insertRow",
        tableId: hover.tableId,
        boundaryIndex: hover.boundaryIndex,
        origin: sceneCoords,
      };
      break;
    }
    case "columnInsert": {
      pointerDownState.tableGesture.active = {
        kind: "insertColumn",
        tableId: hover.tableId,
        boundaryIndex: hover.boundaryIndex,
        origin: sceneCoords,
      };
      break;
    }
  }

  app.setState({ tableStructureHover: null, tableStructurePreview: null });
  return true;
};

/** Arm-time snapshot of every subtree member position, per owning row/column. */
const collectTableMemberSnapshots = (
  app: TableApp,
  table: NonDeleted<ExcalidrawTableElement>,
  kind: "row" | "column",
): Map<string, { x: number; y: number; ownerId: string }> => {
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const snapshots = new Map<
    string,
    { x: number; y: number; ownerId: string }
  >();
  for (const cell of table.table.cells) {
    const ownerId = kind === "row" ? cell.rowId : cell.columnId;
    for (const memberId of collectCellMemberIds(app, table.id, [cell.id])) {
      if (snapshots.has(memberId)) {
        continue;
      }
      const member = elementsMap.get(memberId);
      if (member && !member.isDeleted) {
        snapshots.set(memberId, { x: member.x, y: member.y, ownerId });
      }
    }
  }
  return snapshots;
};

/**
 * Per-frame progress of an armed gesture. Returns false when no gesture is
 * active so the generic drag/resize paths proceed. Dragging mutates the
 * scene but never captures — the single history entry is written once at
 * pointer up (phase-1.md:126).
 */
export const handleTableGestureMove = (
  app: TableApp,
  pointerDownState: PointerDownState,
  pointerCoords: { x: number; y: number },
): boolean => {
  const gesture = pointerDownState.tableGesture.active;
  if (!gesture) {
    return false;
  }
  const table = app.scene.getNonDeletedElement(gesture.tableId);
  if (!table || !isTableElement(table)) {
    pointerDownState.tableGesture.active = null;
    return false;
  }

  switch (gesture.kind) {
    case "moveRow":
    case "moveColumn": {
      const { offset, boundaryIndex } = resolveTableMoveTarget(
        table,
        gesture.kind,
        gesture.kind === "moveRow" ? gesture.rowId : gesture.columnId,
        getTableLocalPoint(table, pointerCoords.x, pointerCoords.y),
      );
      app.setState({
        tableStructurePreview: {
          tableId: gesture.tableId,
          kind: gesture.kind === "moveRow" ? "row" : "column",
          offset,
          boundaryIndex,
          source: "move",
        },
      });
      return true;
    }
    case "resizeRow":
    case "resizeColumn": {
      const isRow = gesture.kind === "resizeRow";
      const local = getTableLocalPoint(table, pointerCoords.x, pointerCoords.y);
      const minSize = isRow ? MIN_TABLE_ROW_HEIGHT : MIN_TABLE_COLUMN_WIDTH;
      const nextEntrySize = isRow
        ? gesture.startTable.rows[gesture.startIndex + 1]?.height
        : gesture.startTable.columns[gesture.startIndex + 1]?.width;
      // 判定一律以按下时的快照为基准，随后整帧重设
      const pointerAxis = isRow ? local.y : local.x;
      const requestedSize =
        gesture.edge === "start"
          ? // dragging the first entry's outer border: the pointer's
            // distance to the entry's far edge
            gesture.startOffset + gesture.startSize - pointerAxis
          : pointerAxis - gesture.startOffset;
      // an `end` border squeezes the two adjacent entries, so the delta
      // clamps on both minima; a `start` border (and the outermost `end`
      // border) only respects the dragged entry's own minimum
      const maxDelta =
        gesture.edge === "end" && nextEntrySize !== undefined
          ? nextEntrySize - minSize
          : Number.POSITIVE_INFINITY;
      const size = Math.min(
        Math.max(requestedSize, minSize),
        gesture.startSize + maxDelta,
      );
      if (
        size ===
        (isRow
          ? table.table.rows[gesture.startIndex].height
          : table.table.columns[gesture.startIndex].width)
      ) {
        return true;
      }
      const delta = size - gesture.startSize;
      const memberDelta = gesture.edge === "start" ? -delta : delta;
      const newTable: TableDataV1 = isRow
        ? {
            ...gesture.startTable,
            rows: gesture.startTable.rows.map((row, index) =>
              index === gesture.startIndex
                ? { ...row, height: size }
                : // the squeezed neighbor compensates the boundary move
                gesture.edge === "end" && index === gesture.startIndex + 1
                ? { ...row, height: nextEntrySize! - delta }
                : row,
            ),
          }
        : {
            ...gesture.startTable,
            columns: gesture.startTable.columns.map((column, index) =>
              index === gesture.startIndex
                ? { ...column, width: size }
                : gesture.edge === "end" && index === gesture.startIndex + 1
                ? { ...column, width: nextEntrySize! - delta }
                : column,
            ),
          };
      for (const memberId of gesture.affectedMembers) {
        const start = gesture.startMembers.get(memberId)!;
        const member = app.scene.getNonDeletedElement(memberId);
        if (member) {
          app.scene.mutateElement(
            member as ExcalidrawElement,
            {
              x: start.x + (isRow ? 0 : memberDelta),
              y: start.y + (isRow ? memberDelta : 0),
            },
            { informMutation: false, isDragging: true },
          );
        }
      }
      const updatedTable = app.scene.getNonDeletedElement(gesture.tableId);
      app.scene.mutateElement(
        table,
        {
          // a start border drags the table's own frame edge with it
          ...(gesture.edge === "start"
            ? isRow
              ? { y: gesture.startY - delta }
              : { x: gesture.startX - delta }
            : {}),
          table: newTable,
          width: isRow ? table.width : getTableWidth(newTable),
          height: isRow ? getTableHeight(newTable) : table.height,
        },
        { informMutation: false, isDragging: true },
      );
      // 被调行列及被挤压邻格的背景文本跟随新格几何（字号不变）；
      // 必须在表格数据落地之后按新 bounds 计算
      if (updatedTable && isTableElement(updatedTable)) {
        refitCellBackgroundTexts(app, updatedTable, gesture.resizedCellIds);
      }
      app.scene.triggerUpdate();
      return true;
    }
    case "insertRow":
    case "insertColumn": {
      // the hover channel draws the insertion line; the commit happens on
      // pointer up as a click
      return true;
    }
    case "scale": {
      applyTableScalePreview(app, gesture, pointerCoords);
      return true;
    }
  }
};

/**
 * Scale preview: every frame recomputes the whole subtree from the arm-time
 * snapshot times the pointer's factor (`persistTextModes: false` — the mode
 * switch only persists with the real commit, phase-1.md:115). Corners apply
 * one uniform factor; sides apply it to their single axis.
 */
const applyTableScalePreview = (
  app: TableApp,
  gesture: Extract<TablePointerGesture, { kind: "scale" }>,
  pointerCoords: { x: number; y: number },
): void => {
  const scale = resolveTableScaleFromPointer(gesture, pointerCoords);
  if (gesture.axis) {
    const minScale =
      gesture.axis === "x"
        ? gesture.preparedScale.minScaleX
        : gesture.preparedScale.minScaleY;
    if (Math.max(scale, minScale) === gesture.previewScale) {
      return;
    }
    const result = computeTableAxisScale(
      gesture.snapshotElements,
      gesture.tableId,
      gesture.axis === "x" ? scale : 1,
      gesture.axis === "y" ? scale : 1,
      { anchor: gesture.anchor, persistTextModes: false },
      gesture.preparedScale,
    );
    if (!result) {
      return;
    }
    gesture.previewScale =
      gesture.axis === "x" ? result.clampedScaleX : result.clampedScaleY;
    applyTableScaleUpdates(app, result.updates);
    return;
  }
  if (
    Math.max(scale, gesture.preparedScale.minScale) === gesture.previewScale
  ) {
    return;
  }
  const result = computeTableUniformScale(
    gesture.snapshotElements,
    gesture.tableId,
    scale,
    { anchor: gesture.anchor, persistTextModes: false },
    gesture.preparedScale,
  );
  if (!result) {
    return;
  }
  gesture.previewScale = result.clampedScale;
  applyTableScaleUpdates(app, result.updates);
};

/** Applies one computed scale update bag to the scene as drag frames. */
const applyTableScaleUpdates = (
  app: TableApp,
  updates: Map<string, ElementUpdate<NonDeletedExcalidrawElement>>,
): void => {
  for (const [id, update] of updates) {
    const element = app.scene.getNonDeletedElement(id);
    if (element) {
      app.scene.mutateElement(element as ExcalidrawElement, update as any, {
        informMutation: false,
        isDragging: true,
      });
    }
  }
  app.scene.triggerUpdate();
};

/** The scale factor the pointer implies against the arm-time bounds. */
const resolveTableScaleFromPointer = (
  gesture: Extract<TablePointerGesture, { kind: "scale" }>,
  pointerCoords: { x: number; y: number },
): number => {
  const [x1, y1, x2, y2] = gesture.startBounds;
  const { anchor } = gesture;
  const startWidth = Math.abs(x2 - x1);
  const startHeight = Math.abs(y2 - y1);
  if (gesture.axis === "x") {
    return Math.max(Math.abs(pointerCoords.x - anchor.x) / startWidth, 0.01);
  }
  if (gesture.axis === "y") {
    return Math.max(Math.abs(pointerCoords.y - anchor.y) / startHeight, 0.01);
  }
  const factorX = Math.abs(pointerCoords.x - anchor.x) / startWidth;
  const factorY = Math.abs(pointerCoords.y - anchor.y) / startHeight;
  // 四角拖动保持等比：两轴比值的均值；提交仍以快照 × 最终倍率整体计算
  return Math.max((factorX + factorY) / 2, 0.01);
};

/**
 * Esc during a gesture: restore the arm-time scene verbatim, drop every
 * trace of the gesture, and never touch history (phase-1.md:116).
 */
export const cancelTableGesture = (
  app: TableApp,
  pointerDownState: PointerDownState,
): boolean => {
  const gesture = pointerDownState.tableGesture.active;
  if (!gesture) {
    return false;
  }
  pointerDownState.tableGesture.active = null;
  app.setState({ tableStructureHover: null, tableStructurePreview: null });

  if (gesture.kind === "resizeRow" || gesture.kind === "resizeColumn") {
    // elements are immutable: the arm-time array still references the
    // pre-gesture versions, so replacing the scene with it restores exactly
    app.scene.replaceAllElements([...gesture.startElements]);
    app.scene.triggerUpdate();
  } else if (gesture.kind === "scale") {
    const restored = app.scene
      .getElementsIncludingDeleted()
      .map((element) => gesture.snapshotElements.get(element.id) ?? element);
    app.scene.replaceAllElements(restored);
    app.scene.triggerUpdate();
  }
  return true;
};

/**
 * Pointer up of an armed gesture: commit the operation the preview showed,
 * through the very same resolution the preview used, and capture exactly
 * once. No-op outcomes (released in place, drag-cancelled inserts) write no
 * history. Returns true when the pointer session was a table gesture.
 */
export const finalizeTableGestureOnPointerUp = (
  app: TableApp,
  pointerDownState: PointerDownState,
  sceneCoords: { x: number; y: number },
): boolean => {
  const gesture = pointerDownState.tableGesture.active;
  if (!gesture) {
    return false;
  }
  pointerDownState.tableGesture.active = null;
  app.setState({ tableStructureHover: null, tableStructurePreview: null });

  const table = app.scene.getNonDeletedElement(gesture.tableId);
  if (!table || !isTableElement(table)) {
    return true;
  }

  switch (gesture.kind) {
    case "moveRow":
    case "moveColumn": {
      const kind = gesture.kind === "moveRow" ? "row" : "column";
      const id = gesture.kind === "moveRow" ? gesture.rowId : gesture.columnId;
      const { boundaryIndex } = resolveTableMoveTarget(
        table,
        gesture.kind,
        id,
        getTableLocalPoint(table, sceneCoords.x, sceneCoords.y),
      );
      const newTable =
        kind === "row"
          ? moveRowInTable(table.table, id, boundaryIndex)
          : moveColumnInTable(table.table, id, boundaryIndex);
      if (newTable === table.table) {
        // released in place — 无变化不进历史
        return true;
      }
      const translations =
        kind === "row"
          ? getMemberTranslationsForRows(table.table, newTable)
          : getMemberTranslationsForColumns(table.table, newTable);
      app.store.scheduleCapture();
      applyMemberTranslations(app, table, kind, translations);
      app.scene.mutateElement(table, {
        table: newTable,
        width: getTableWidth(newTable),
        height: getTableHeight(newTable),
      });
      app.scene.triggerUpdate();
      return true;
    }
    case "resizeRow":
    case "resizeColumn": {
      // the drag frames already mutated the scene; the release only closes
      // the single history entry. A drag back to the start size leaves the
      // grid untouched — capture nothing (无变化不进历史)
      const rowsUnchanged =
        gesture.kind === "resizeRow" &&
        gesture.startTable.rows.every(
          (row, index) => row.height === table.table.rows[index]?.height,
        );
      const columnsUnchanged =
        gesture.kind === "resizeColumn" &&
        gesture.startTable.columns.every(
          (column, index) => column.width === table.table.columns[index]?.width,
        );
      if (rowsUnchanged || columnsUnchanged) {
        return true;
      }
      app.store.scheduleCapture();
      app.scene.triggerUpdate();
      return true;
    }
    case "insertRow":
    case "insertColumn": {
      const dragged = pointDistance(
        pointFrom(sceneCoords.x, sceneCoords.y),
        pointFrom(gesture.origin.x, gesture.origin.y),
      );
      if (dragged * app.state.zoom.value > DRAGGING_THRESHOLD) {
        // a drag is not a click: no insertion (无变化不进历史)
        return true;
      }
      commitTableInsert(app, table, gesture.kind, gesture.boundaryIndex);
      return true;
    }
    case "scale": {
      // 释放：以快照 × 最终倍率（persistTextModes: true）一次提交
      const scale = resolveTableScaleFromPointer(gesture, sceneCoords);
      let updates: Map<string, ElementUpdate<NonDeletedExcalidrawElement>>;
      let changed: boolean;
      let geometryAlreadyPreviewed: boolean;
      if (gesture.axis) {
        const result = computeTableAxisScale(
          gesture.snapshotElements,
          gesture.tableId,
          gesture.axis === "x" ? scale : 1,
          gesture.axis === "y" ? scale : 1,
          { anchor: gesture.anchor, persistTextModes: true },
          gesture.preparedScale,
        );
        if (!result) {
          return true;
        }
        updates = result.updates;
        changed = result.clampedScaleX !== 1 || result.clampedScaleY !== 1;
        geometryAlreadyPreviewed =
          (gesture.axis === "x"
            ? result.clampedScaleX
            : result.clampedScaleY) === gesture.previewScale;
      } else {
        const result = computeTableUniformScale(
          gesture.snapshotElements,
          gesture.tableId,
          scale,
          { anchor: gesture.anchor, persistTextModes: true },
          gesture.preparedScale,
        );
        if (!result) {
          return true;
        }
        updates = result.updates;
        changed = result.clampedScale !== 1;
        geometryAlreadyPreviewed = result.clampedScale === gesture.previewScale;
      }
      if (!changed && gesture.previewScale !== 1) {
        const restored = app.scene
          .getElementsIncludingDeleted()
          .map(
            (element) => gesture.snapshotElements.get(element.id) ?? element,
          );
        app.scene.replaceAllElements(restored);
        app.scene.triggerUpdate();
        return true;
      }
      if (changed) {
        app.store.scheduleCapture();
        for (const [id, update] of updates) {
          const element = app.scene.getNonDeletedElement(id);
          if (element) {
            // The snapshot calculation is deterministic. When pointerup lands
            // at the last preview factor, its geometry is already in the scene.
            // Avoid passing unchanged dimensions/points to mutateElement:
            // those fields otherwise evict both shape and bitmap caches.
            const commitUpdate = { ...update } as Record<string, unknown>;
            const updatedPoints = (update as any).points as
              | readonly (readonly [number, number])[]
              | undefined;
            const currentPoints =
              "points" in element ? element.points : undefined;
            const pointsMatch =
              !updatedPoints ||
              (currentPoints &&
                updatedPoints.length === currentPoints.length &&
                updatedPoints.every(
                  (point, index) =>
                    point[0] === currentPoints[index][0] &&
                    point[1] === currentPoints[index][1],
                ));
            if (
              geometryAlreadyPreviewed &&
              element.width === update.width &&
              element.height === update.height &&
              pointsMatch
            ) {
              delete commitUpdate.width;
              delete commitUpdate.height;
              delete commitUpdate.points;
            }
            app.scene.mutateElement(
              element as ExcalidrawElement,
              commitUpdate as any,
              { informMutation: false, isDragging: false },
            );
          }
        }
        app.scene.triggerUpdate();
      }
      return true;
    }
  }
};

/** Applies one insert command and translates the shifted members with it. */
export const commitTableInsert = (
  app: TableApp,
  table: NonDeleted<ExcalidrawTableElement>,
  kind: "insertRow" | "insertColumn",
  boundaryIndex: number,
): void => {
  const newTable =
    kind === "insertRow"
      ? insertRowInTable(table.table, boundaryIndex)
      : insertColumnInTable(table.table, boundaryIndex);
  const translations =
    kind === "insertRow"
      ? getMemberTranslationsForRows(table.table, newTable)
      : getMemberTranslationsForColumns(table.table, newTable);
  app.store.scheduleCapture();
  applyMemberTranslations(
    app,
    table,
    kind === "insertRow" ? "row" : "column",
    translations,
  );
  app.scene.mutateElement(table, {
    table: newTable,
    width: getTableWidth(newTable),
    height: getTableHeight(newTable),
  });
  app.scene.triggerUpdate();
};

/**
 * Deletes the selected row/column (the `tableRowColSelection` channel):
 * the removed cells' members go away recursively (nested subtrees included),
 * bindings are repaired, and the whole operation is one undo entry
 * (phase-1.md:96). Deleting the last row/column is rejected.
 */
export const deleteSelectedTableRowCol = (app: TableApp): boolean => {
  const selection = app.state.tableRowColSelection;
  if (!selection) {
    return false;
  }
  const table = app.scene.getNonDeletedElement(selection.tableId);
  if (!table || !isTableElement(table)) {
    app.setState({ tableRowColSelection: null });
    return true;
  }

  const kind = selection.kind;
  const id = selection.id;
  let result;
  try {
    result =
      kind === "row"
        ? removeRowFromTable(table.table, id)
        : removeColumnFromTable(table.table, id);
  } catch {
    // 最后一行/列拒绝删除——走删除整表的明确命令
    return true;
  }

  const elementsMap = app.scene.getNonDeletedElementsMap();
  const allElements = app.scene.getNonDeletedElements();
  const doomedIds = new Set<string>();
  for (const cellId of result.removedCellIds) {
    for (const memberId of collectCellMemberIds(app, table.id, [cellId])) {
      doomedIds.add(memberId);
    }
  }
  // nested containers inside the removed cells take their own subtrees
  for (const memberId of [...doomedIds]) {
    const member = elementsMap.get(memberId);
    if (member && (isTableElement(member) || isFrameLikeElement(member))) {
      for (const descendant of getTableSubtreeElements(
        allElements,
        member.id,
        elementsMap,
      )) {
        doomedIds.add(descendant.id);
      }
    }
  }

  for (const memberId of doomedIds) {
    const member = elementsMap.get(memberId);
    if (member) {
      app.scene.mutateElement(member as ExcalidrawElement, {
        isDeleted: true,
        // the ref clears along with the element: a dangling tableCell ref
        // to a removed cell would fail the scene's reference validation
        containerRef: member.containerRef ? undefined : member.containerRef,
      });
    }
  }
  fixBindingsAfterDeletion(
    app.scene.getNonDeletedElements(),
    [...doomedIds].reduce<ExcalidrawElement[]>((acc, id) => {
      const element = elementsMap.get(id);
      if (element) {
        acc.push(element as ExcalidrawElement);
      }
      return acc;
    }, []),
  );

  app.scene.mutateElement(table, {
    table: result.table,
    width: getTableWidth(result.table),
    height: getTableHeight(result.table),
  });
  app.setState({ tableRowColSelection: null });
  app.store.scheduleCapture();
  app.scene.triggerUpdate();
  return true;
};

/**
 * Moves the selected row/column one slot (keyboard reorder entry,
 * phase-1.md:89). Returns false when nothing is selectable.
 */
export const moveSelectedTableRowCol = (
  app: TableApp,
  direction: -1 | 1,
): boolean => {
  const selection = app.state.tableRowColSelection;
  if (!selection) {
    return false;
  }
  const table = app.scene.getNonDeletedElement(selection.tableId);
  if (!table || !isTableElement(table)) {
    return false;
  }

  const entries =
    selection.kind === "row" ? table.table.rows : table.table.columns;
  const fromIndex = entries.findIndex((entry) => entry.id === selection.id);
  const toIndex = fromIndex + direction;
  if (fromIndex === -1 || toIndex < 0 || toIndex >= entries.length) {
    return true;
  }

  // `moveRowInTable`/`moveColumnInTable` count the final index over the
  // array without the moved entry: a one-slot shift splices at
  // `fromIndex + direction` there (the assertion runs against the full
  // array, so `entries.length - 1` is a valid append-at-end index)
  const targetIndex = fromIndex + direction;
  if (targetIndex < 0 || targetIndex > entries.length - 1) {
    return true;
  }
  const newTable =
    selection.kind === "row"
      ? moveRowInTable(table.table, selection.id, targetIndex)
      : moveColumnInTable(table.table, selection.id, targetIndex);
  if (newTable === table.table) {
    return true;
  }
  const translations =
    selection.kind === "row"
      ? getMemberTranslationsForRows(table.table, newTable)
      : getMemberTranslationsForColumns(table.table, newTable);
  applyMemberTranslations(app, table, selection.kind, translations);
  app.scene.mutateElement(table, {
    table: newTable,
    width: getTableWidth(newTable),
    height: getTableHeight(newTable),
  });
  app.store.scheduleCapture();
  app.scene.triggerUpdate();
  return true;
};
