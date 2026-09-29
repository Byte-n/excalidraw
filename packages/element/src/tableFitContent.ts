import { getFontString } from "@excalidraw/common";

import type { Bounds } from "@excalidraw/common";

import { getElementBounds } from "./bounds";

import { getBoundTextElement } from "./textElement";
import { measureText } from "./textMeasurements";
import { wrapText } from "./textWrapping";
import { getIndexedTableChildren } from "./tableChildrenIndex";
import { getTableSubtreeElements } from "./tableContainer";
import {
  getTableColumnOffset,
  getTableRowOffset,
  getTableSizingMode,
  getTableWidth,
  getTableHeight,
} from "./tableStruct";
import {
  isFrameLikeElement,
  isMindmapEdgeElement,
  isTableElement,
} from "./typeChecks";

import type { ElementUpdate } from "./mutateElement";

import type {
  ElementsMap,
  ElementsMapOrArray,
  ExcalidrawElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
  TableDataV1,
} from "./types";

/**
 * Content-driven sizing of a table (phase-1.1). Requirements are derived
 * values measured from the scene on demand — they are never persisted and
 * never recomputed at file load. One computation works on one snapshot: it
 * measures column requirements first, then row requirements (background
 * texts wrap at the computed column widths), and only ever grows a
 * row/column — shrinking happens solely through explicit user operations
 * (separator drag, reset) that re-evaluate from the new floors.
 */

/**
 * Spacing a cell keeps beyond its content's visible bounds, on the right and
 * bottom edges a requirement is measured from (phase-1.1 尺寸计算).
 */
export const TABLE_CELL_CONTENT_PADDING = 8;

/**
 * Horizontal and vertical inset removed from the column width / added around
 * the measured text height when a cell's background text drives its row's
 * requirement. Background texts never widen their column.
 */
export const TABLE_BACKGROUND_TEXT_PADDING = 8;

/** Scene-space displacement of one cell's members after an expansion. */
export type TableFitCellDelta = Readonly<{ dx: number; dy: number }>;

export type TableCellContentRequirements = {
  /** Required width per column id; absent means "no requirement". */
  columns: Map<string, number>;
  /** Required height per row id; absent means "no requirement". */
  rows: Map<string, number>;
};

export type TableFitContentResult = {
  /** Grid grown to the requirements; the input object when nothing grew. */
  table: TableDataV1;
  /**
   * Scene-space displacement per cell id whose origin moved (grown columns
   * shift later columns, grown rows shift later rows). Members of the cell —
   * nested subtrees and bound texts included — translate by their cell's
   * delta; background texts are re-fit to the new cell geometry on top.
   */
  cellDeltas: Map<string, TableFitCellDelta>;
  changed: boolean;
};

/** Flat, id-keyed element updates for a whole fit-content computation. */
export type TableFitContentUpdates = {
  updates: Map<string, ElementUpdate<NonDeletedExcalidrawElement>>;
  /** Ids of tables whose grid actually changed. */
  changedTableIds: Set<string>;
  changed: boolean;
};

type MutableUpdate = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  table?: TableDataV1;
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

const toElementsMap = (elements: ElementsMapOrArray): ElementsMap =>
  Array.isArray(elements)
    ? new Map(elements.map((element) => [element.id, element]))
    : (elements as ElementsMap);

/**
 * All direct cell members of one table (any role), in scene order. Prefers
 * the registered table children index and falls back to a scan, so the
 * command works on any snapshot (same convention as `tableScale.ts`).
 */
const getTableMembers = (
  elements: ElementsMapOrArray,
  tableId: string,
): ExcalidrawElement[] => {
  const indexed = getIndexedTableChildren(elements, tableId);
  if (indexed) {
    return indexed.filter((element) => !element.isDeleted);
  }
  const children: ExcalidrawElement[] = [];
  iterateCollection(elements, (element) => {
    if (
      !element.isDeleted &&
      element.containerRef?.kind === "tableCell" &&
      element.containerRef.elementId === tableId
    ) {
      children.push(element);
    }
  });
  return children;
};

/** Font string of a text element for the shared text layout pipeline. */
const textFontString = (text: ExcalidrawTextElement) =>
  getFontString({ fontSize: text.fontSize, fontFamily: text.fontFamily });

/**
 * Rotates an axis-aligned scene box's corners into the table's unrotated
 * local frame and returns their AABB — the element's exact visible bounds in
 * the table's local axes (a rotated element's own angle is absorbed by
 * rotating the unrotated corners by `element.angle - table.angle`).
 * `override` substitutes the element's unrotated box, for nested tables
 * measured at their post-fit geometry.
 */
const getTableLocalBounds = (
  table: ExcalidrawTableElement,
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  override?: { x: number; y: number; width: number; height: number },
): Bounds => {
  const [ux1, uy1, ux2, uy2] = override
    ? [
        override.x,
        override.y,
        override.x + override.width,
        override.y + override.height,
      ]
    : getElementBounds(element, elementsMap, true);
  const centerX = (ux1 + ux2) / 2;
  const centerY = (uy1 + uy2) / 2;
  const relativeAngle = element.angle - table.angle;
  const cos = Math.cos(relativeAngle);
  const sin = Math.sin(relativeAngle);
  // table-local position of the element's center: rotate the center offset
  // out of the table's rotation, then anchor at the grid's top-left
  const tableCenterX = table.x + table.width / 2;
  const tableCenterY = table.y + table.height / 2;
  const centerDeltaX = centerX - tableCenterX;
  const centerDeltaY = centerY - tableCenterY;
  const tableCos = Math.cos(table.angle);
  const tableSin = Math.sin(table.angle);
  const originX =
    centerDeltaX * tableCos + centerDeltaY * tableSin + table.width / 2;
  const originY =
    -centerDeltaX * tableSin + centerDeltaY * tableCos + table.height / 2;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [dx, dy] of [
    [ux1 - centerX, uy1 - centerY],
    [ux2 - centerX, uy1 - centerY],
    [ux1 - centerX, uy2 - centerY],
    [ux2 - centerX, uy2 - centerY],
  ] as const) {
    const x = originX + dx * cos - dy * sin;
    const y = originY + dx * sin + dy * cos;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
};

/** Applies one table-local displacement in scene space (rotation included). */
const localDeltaToSceneDelta = (
  table: ExcalidrawTableElement,
  dx: number,
  dy: number,
): { dx: number; dy: number } => {
  const cos = Math.cos(table.angle);
  const sin = Math.sin(table.angle);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
};

/**
 * Keeps the table's unrotated top-left (the expansion anchor) at its rendered
 * scene position while the grid grows by `dw`/`dh` — the x/y compensation a
 * rotated table needs so its members' scene deltas stay pure rotations of the
 * local offsets (phase-1.1: the unrotated local top-left is the anchor).
 */
const getAnchorPreservingPosition = (
  table: ExcalidrawTableElement,
  dw: number,
  dh: number,
): { x: number; y: number } => {
  const cos = Math.cos(table.angle);
  const sin = Math.sin(table.angle);
  return {
    x: table.x + (dw / 2) * (cos - 1) - (dh / 2) * sin,
    y: table.y + (dh / 2) * (cos - 1) + (dw / 2) * sin,
  };
};

/**
 * One cell's complete member set for translation: direct members, nested
 * container subtrees (nested tables recurse; frames take their members) and
 * bound texts following their hosts. Every id appears once.
 */
const collectCellMemberIdsForFit = (
  elements: ElementsMapOrArray,
  tableId: string,
  cellId: string,
  elementsMap: ElementsMap,
): Set<string> => {
  const ids = new Set<string>();
  const allElements = Array.from(
    (Array.isArray(elements)
      ? elements
      : elements.values()) as Iterable<ExcalidrawElement>,
  );
  const addSubtree = (member: ExcalidrawElement) => {
    if (ids.has(member.id)) {
      return;
    }
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
  };

  for (const member of getTableMembers(elements, tableId)) {
    const ref = member.containerRef;
    if (ref?.kind !== "tableCell" || ref.cellId !== cellId) {
      continue;
    }
    addSubtree(member);
  }
  return ids;
};

const considerRequirement = (
  map: Map<string, number>,
  id: string,
  need: number,
): void => {
  if (!Number.isFinite(need)) {
    return;
  }
  const existing = map.get(id);
  map.set(id, existing === undefined ? need : Math.max(existing, need));
};

/** Expansion-only growth: a size never falls below its current value. */
const grow = (size: number, need: number | undefined): number =>
  need !== undefined && Number.isFinite(need) && need > size ? need : size;

const cellOf = (table: ExcalidrawTableElement, cellId: string) =>
  table.table.cells.find((candidate) => candidate.id === cellId);

/**
 * Measures the regular content requirements of one table's cells: every
 * content member contributes its visible bounds' right/bottom position in the
 * table's local axes (plus the cell padding) to its own column and row.
 * Content overflowing leftwards/upwards never adds a requirement, bound texts
 * ride their hosts, and mindmap edges with both endpoints inside the table
 * count towards the parent endpoint's cell — every element measured once.
 * `postFitBounds` substitutes nested tables' post-fit geometry.
 */
const measureGraphicRequirements = (
  table: ExcalidrawTableElement,
  elementsMap: ElementsMap,
  elements: ElementsMapOrArray,
  postFitBounds:
    | Map<string, { x: number; y: number; width: number; height: number }>
    | undefined,
): TableCellContentRequirements => {
  const requirements: TableCellContentRequirements = {
    columns: new Map(),
    rows: new Map(),
  };
  // element id -> the cell its requirement is attributed to; direct content
  // members first, then bound texts through their hosts and mindmap edges
  // through their endpoints — the same semantic-subtree closure
  // `computeTableUniformScale` walks, so nothing is measured twice
  const attributedCells = new Map<string, string>();
  for (const member of getTableMembers(elements, table.id)) {
    const ref = member.containerRef;
    if (ref?.kind === "tableCell" && ref.role === "content") {
      attributedCells.set(member.id, ref.cellId);
    }
  }

  const pendingEdges: ExcalidrawElement[] = [];
  iterateCollection(elements, (element) => {
    if (element.isDeleted || attributedCells.has(element.id)) {
      return;
    }
    if (element.type === "text" && element.containerId) {
      const hostCell = attributedCells.get(element.containerId);
      if (hostCell) {
        attributedCells.set(element.id, hostCell);
      }
      return;
    }
    if (isMindmapEdgeElement(element)) {
      pendingEdges.push(element);
    }
  });
  // edges may appear before their endpoint nodes are known — resolve after
  // the node attribution is complete; an edge reaching outside the table's
  // own graph stays out (it is no member, per phase-1.1)
  for (const edge of pendingEdges) {
    if (
      isMindmapEdgeElement(edge) &&
      attributedCells.has(edge.parentId) &&
      attributedCells.has(edge.childId)
    ) {
      attributedCells.set(edge.id, attributedCells.get(edge.parentId)!);
    }
  }

  for (const [memberId, cellId] of attributedCells) {
    const member = elementsMap.get(memberId);
    const cell = cellOf(table, cellId);
    if (!member || !cell) {
      continue;
    }
    const override = isTableElement(member)
      ? postFitBounds?.get(member.id)
      : undefined;
    const [, , maxX, maxY] = getTableLocalBounds(
      table,
      member,
      elementsMap,
      override,
    );
    const cellLeft = getTableColumnOffset(table.table, cell.columnId) ?? 0;
    const cellTop = getTableRowOffset(table.table, cell.rowId) ?? 0;
    // only right/bottom extremes drive growth; left/top overflow keeps the
    // P01 overflow display and never widens a column or heightens a row
    const columnNeed = maxX - cellLeft + TABLE_CELL_CONTENT_PADDING;
    if (columnNeed > 0) {
      considerRequirement(requirements.columns, cell.columnId, columnNeed);
    }
    const rowNeed = maxY - cellTop + TABLE_CELL_CONTENT_PADDING;
    if (rowNeed > 0) {
      considerRequirement(requirements.rows, cell.rowId, rowNeed);
    }
  }

  return requirements;
};

/**
 * Measures the background-text requirements: every cell's background text
 * wraps at `columnWidths` (minus the text padding) and adds its full wrapped
 * text height to its row only — never to its column, and never from the box's
 * current height (phase-1.1 尺寸计算).
 */
const measureTextRowRequirements = (
  table: ExcalidrawTableElement,
  elements: ElementsMapOrArray,
  elementsMap: ElementsMap,
  columnWidths: Map<string, number>,
): Map<string, number> => {
  const rowRequirements = new Map<string, number>();
  for (const member of getTableMembers(elements, table.id)) {
    const ref = member.containerRef;
    if (
      ref?.kind !== "tableCell" ||
      ref.role !== "backgroundText" ||
      member.type !== "text"
    ) {
      continue;
    }
    const text = member as ExcalidrawTextElement;
    if (!text.text.trim()) {
      continue;
    }
    const cell = cellOf(table, ref.cellId);
    if (!cell) {
      continue;
    }
    const columnWidth = columnWidths.get(cell.columnId) ?? 0;
    const wrapWidth = Math.max(
      columnWidth - TABLE_BACKGROUND_TEXT_PADDING * 2,
      1,
    );
    const font = textFontString(text);
    const wrapped = wrapText(text.text, font, wrapWidth);
    const measuredHeight = measureText(wrapped, font, text.lineHeight).height;
    considerRequirement(
      rowRequirements,
      cell.rowId,
      measuredHeight + TABLE_BACKGROUND_TEXT_PADDING * 2,
    );
  }
  return rowRequirements;
};

/**
 * Measures the content requirements of one table's cells (phase-1.1 尺寸计算):
 * regular content contributes its visible bounds' right/bottom position in the
 * table's local axes (plus the cell padding) to its own column and row;
 * background texts contribute their full wrapped text height — measured at
 * `columnWidths` (pass the post-computation widths) — to their row only.
 */
export const measureTableCellContentRequirements = (
  elements: ElementsMapOrArray,
  table: ExcalidrawTableElement,
  opts: {
    /** Column widths to wrap background texts at; defaults to the current ones. */
    columnWidths?: Map<string, number>;
  } = {},
): TableCellContentRequirements => {
  const elementsMap = toElementsMap(elements);
  const graphic = measureGraphicRequirements(
    table,
    elementsMap,
    elements,
    undefined,
  );
  const columnWidths =
    opts.columnWidths ??
    new Map(table.table.columns.map((column) => [column.id, column.width]));
  const rows = measureTextRowRequirements(
    table,
    elements,
    elementsMap,
    columnWidths,
  );
  for (const [rowId, need] of graphic.rows) {
    considerRequirement(rows, rowId, need);
  }
  return { columns: graphic.columns, rows };
};

/**
 * Grows rows/columns to the measured requirements (single pass, expansion
 * only — manual minima are floors, never targets; content never shrinks a
 * row/column). Returns per-cell scene deltas for the member translation.
 */
export const computeTableFitContent = (
  table: ExcalidrawTableElement,
  requirements: TableCellContentRequirements,
): TableFitContentResult => {
  const current = table.table;

  const columns = current.columns.map((column) => ({
    ...column,
    width: grow(column.width, requirements.columns.get(column.id)),
  }));
  const rows = current.rows.map((row) => ({
    ...row,
    height: grow(row.height, requirements.rows.get(row.id)),
  }));

  const changed =
    columns.some(
      (column, index) => column.width !== current.columns[index].width,
    ) || rows.some((row, index) => row.height !== current.rows[index].height);

  if (!changed) {
    return { table: current, cellDeltas: new Map(), changed: false };
  }

  const nextTable: TableDataV1 = { ...current, columns, rows };
  const cellDeltas = new Map<string, TableFitCellDelta>();
  for (const cell of current.cells) {
    const dx =
      (getTableColumnOffset(nextTable, cell.columnId) ?? 0) -
      (getTableColumnOffset(current, cell.columnId) ?? 0);
    const dy =
      (getTableRowOffset(nextTable, cell.rowId) ?? 0) -
      (getTableRowOffset(current, cell.rowId) ?? 0);
    if (dx !== 0 || dy !== 0) {
      cellDeltas.set(cell.id, localDeltaToSceneDelta(table, dx, dy));
    }
  }
  return { table: nextTable, cellDeltas, changed: true };
};

/**
 * Full fit-content computation for one table subtree (phase-1.1): nested
 * `fitContent` tables are computed inside-out first, then each table's own
 * requirements are measured from the snapshot with post-fit nested geometry.
 * Returns flat, id-unique updates — table data with the anchor-preserving
 * x/y, member translations once per element — or `null` when the id does not
 * resolve to a non-deleted table. Nothing mutates the scene here.
 */
export const computeTableFitContentUpdates = (
  elements: ElementsMapOrArray,
  tableId: string,
): TableFitContentUpdates | null => {
  const elementsMap = toElementsMap(elements);
  const root = elementsMap.get(tableId);
  if (!root || root.isDeleted || !isTableElement(root)) {
    return null;
  }

  const updates = new Map<string, MutableUpdate>();
  const changedTableIds = new Set<string>();
  let changed = false;

  const pendingOf = (element: ExcalidrawElement): MutableUpdate => {
    let update = updates.get(element.id);
    if (!update) {
      update = {};
      updates.set(element.id, update);
    }
    return update;
  };

  const addTranslation = (
    element: ExcalidrawElement,
    delta: { dx: number; dy: number },
  ) => {
    if (delta.dx === 0 && delta.dy === 0) {
      return;
    }
    const update = pendingOf(element);
    update.x = (update.x ?? element.x) + delta.dx;
    update.y = (update.y ?? element.y) + delta.dy;
  };

  const fitTable = (table: ExcalidrawTableElement): void => {
    // inside-out: nested fitContent tables settle before the parent measures
    const postFitBounds = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >();
    for (const member of getTableMembers(elements, table.id)) {
      if (
        !isTableElement(member) ||
        getTableSizingMode(member.table) !== "fitContent"
      ) {
        continue;
      }
      fitTable(member as ExcalidrawTableElement);
      const pending = updates.get(member.id);
      postFitBounds.set(member.id, {
        x: pending?.x ?? member.x,
        y: pending?.y ?? member.y,
        width: pending?.width ?? member.width,
        height: pending?.height ?? member.height,
      });
    }

    if (getTableSizingMode(table.table) !== "fitContent") {
      // a fixed table never grows from content, but its nested fitContent
      // children were still computed above
      return;
    }

    // 1. column requirements from the visible geometry
    const graphic = measureGraphicRequirements(
      table,
      elementsMap,
      elements,
      postFitBounds,
    );

    // 2. column widths first, then background texts wrap at the new widths
    const columns = table.table.columns.map((column) => ({
      ...column,
      width: grow(column.width, graphic.columns.get(column.id)),
    }));
    const columnWidths = new Map(
      columns.map((column) => [column.id, column.width]),
    );
    const textRows = measureTextRowRequirements(
      table,
      elements,
      elementsMap,
      columnWidths,
    );
    const rows = table.table.rows.map((row) => {
      const graphicNeed = graphic.rows.get(row.id);
      const textNeed = textRows.get(row.id);
      let height = row.height;
      if (graphicNeed !== undefined && graphicNeed > height) {
        height = graphicNeed;
      }
      if (textNeed !== undefined && textNeed > height) {
        height = textNeed;
      }
      return { ...row, height };
    });

    const gridChanged =
      columns.some(
        (column, index) => column.width !== table.table.columns[index].width,
      ) ||
      rows.some((row, index) => row.height !== table.table.rows[index].height);
    if (!gridChanged) {
      return;
    }

    const nextTable: TableDataV1 = { ...table.table, columns, rows };
    changed = true;
    changedTableIds.add(table.id);

    // 3. anchor-preserving table update
    const tableUpdate = pendingOf(table);
    tableUpdate.table = nextTable;
    tableUpdate.width = getTableWidth(nextTable);
    tableUpdate.height = getTableHeight(nextTable);
    const position = getAnchorPreservingPosition(
      table,
      tableUpdate.width - table.width,
      tableUpdate.height - table.height,
    );
    if (position.x !== table.x || position.y !== table.y) {
      tableUpdate.x = (tableUpdate.x ?? table.x) + position.x - table.x;
      tableUpdate.y = (tableUpdate.y ?? table.y) + position.y - table.y;
    }

    // 4. member translations per grown cell (scene deltas)
    for (const cell of table.table.cells) {
      const dx =
        (getTableColumnOffset(nextTable, cell.columnId) ?? 0) -
        (getTableColumnOffset(table.table, cell.columnId) ?? 0);
      const dy =
        (getTableRowOffset(nextTable, cell.rowId) ?? 0) -
        (getTableRowOffset(table.table, cell.rowId) ?? 0);
      if (dx === 0 && dy === 0) {
        continue;
      }
      const delta = localDeltaToSceneDelta(table, dx, dy);
      for (const memberId of collectCellMemberIdsForFit(
        elements,
        table.id,
        cell.id,
        elementsMap,
      )) {
        const member = elementsMap.get(memberId);
        if (member && !member.isDeleted) {
          addTranslation(member, delta);
        }
      }
    }
  };

  fitTable(root as ExcalidrawTableElement);

  if (!changed) {
    return { updates: new Map(), changedTableIds, changed: false };
  }

  return {
    updates: updates as Map<string, ElementUpdate<NonDeletedExcalidrawElement>>,
    changedTableIds,
    changed,
  };
};
