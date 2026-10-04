import { arrayToMap, cloneJSON, randomId } from "@excalidraw/common";

import { syncMovedIndices } from "./fractionalIndex";
import { getBoundTextElement } from "./textElement";
import { mutateElement } from "./mutateElement";
import { getMindmapElementsForSelection } from "./mindmap";
import {
  assertValidTableData,
  getTableCellAtPoint,
  getTableCellBounds,
} from "./tableStruct";
import { getIndexedFrameChildren } from "./frameChildrenIndex";

import {
  isBoundToContainer,
  isFrameLikeElement,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  isTableElement,
} from "./typeChecks";

import type {
  ElementsMap,
  ElementsMapOrArray,
  ExcalidrawElement,
  ExcalidrawTableElement,
  TableCellContainerRef,
  TableDataV1,
  BackgroundTextStyle,
} from "./types";

/**
 * Membership writes for table cells — the counterpart of `addElementsToFrame`
 * for the `tableCell` container kind (phase-1.md:21, :59, :66, :87).
 */

export const tableCellContainerRef = (
  tableId: string,
  cellId: string,
  role: TableCellContainerRef["role"] = "content",
): TableCellContainerRef => ({
  kind: "tableCell",
  elementId: tableId,
  cellId,
  role,
});

export const getTableContentClipRects = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): readonly { x: number; y: number; width: number; height: number }[] => {
  const clips: { x: number; y: number; width: number; height: number }[] = [];
  let current: ExcalidrawElement | undefined = element;
  if (isBoundToContainer(element)) {
    current = elementsMap.get(element.containerId);
  }
  const visited = new Set<string>();
  while (current?.containerRef?.elementId && !visited.has(current.id)) {
    visited.add(current.id);
    const ref = current.containerRef;
    const parent = elementsMap.get(ref.elementId);
    if (!parent) {
      break;
    }
    if (ref.kind === "tableCell" && isTableElement(parent)) {
      const cell = parent.table.cells.find(
        (candidate) => candidate.id === ref.cellId,
      );
      const visible =
        cell &&
        parent.table.cells.find(
          (candidate) => candidate.id === (cell.mergedInto ?? cell.id),
        );
      if (
        visible &&
        (visible.style.clipContent ?? parent.table.style?.clipContent)
      ) {
        const bounds = getTableCellBounds(parent.table, visible.id);
        if (bounds) {
          clips.push({
            x: parent.x + bounds.x,
            y: parent.y + bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
        }
      }
    }
    current = parent;
  }
  return clips;
};

export const getTableBackgroundTextStyle = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): BackgroundTextStyle | undefined => {
  const ref = element.containerRef;
  if (!ref || ref.kind !== "tableCell") {
    return undefined;
  }
  const table = elementsMap.get(ref.elementId);
  if (!table || !isTableElement(table)) {
    return undefined;
  }
  const cell = table.table.cells.find(
    (candidate) => candidate.id === ref.cellId,
  );
  if (!cell) {
    return undefined;
  }
  const row = table.table.rows.find((candidate) => candidate.id === cell.rowId);
  const column = table.table.columns.find(
    (candidate) => candidate.id === cell.columnId,
  );
  return row?.style?.backgroundText ?? column?.style?.backgroundText;
};

/** Same direct-parent relation, role and cell — no write, no history. */
export const isSameTableCellRef = (
  element: ExcalidrawElement,
  tableId: string,
  cellId: string,
): boolean =>
  element.containerRef?.kind === "tableCell" &&
  element.containerRef.elementId === tableId &&
  element.containerRef.cellId === cellId;

/**
 * Whether the element belongs to the cell's rendered subtree: it is a direct
 * member of the cell, or it descends from one (e.g. the members of a nested
 * table placed in the cell). Used for the cell's z-order tail.
 */
export const isElementInTableCellSubtree = (
  element: ExcalidrawElement,
  tableId: string,
  cellId: string,
  elementsMap: ElementsMap,
): boolean => {
  let current: ExcalidrawElement | undefined = isBoundToContainer(element)
    ? (elementsMap.get(element.containerId) as ExcalidrawElement | undefined)
    : element;
  while (current) {
    if (isSameTableCellRef(current, tableId, cellId)) {
      return true;
    }
    current = current.containerRef?.elementId
      ? (elementsMap.get(current.containerRef.elementId) as
          | ExcalidrawElement
          | undefined)
      : undefined;
  }
  return false;
};

/**
 * Scene index for appending to a cell: above the table when the cell is
 * empty, otherwise above the topmost element of the cell's subtree, keeping
 * the existing members and their relative order (phase-1.md:87). Mirrors
 * `getFrameChildrenInsertionIndex`, scanning from the scene end.
 */
export const getTableCellInsertionIndex = (
  elements: readonly ExcalidrawElement[],
  tableId: string,
  cellId: string,
): number | null => {
  const elementsMap = arrayToMap(elements);
  for (let index = elements.length - 1; index >= 0; index--) {
    const element = elements[index];
    if (element.id === tableId) {
      // cell content renders above the table element itself
      return index + 1;
    }
    if (isElementInTableCellSubtree(element, tableId, cellId, elementsMap)) {
      return index + 1;
    }
  }
  return null;
};

/**
 * Expands the dropped selection to the complete semantic objects it
 * represents: a selected Mindmap node rides with its whole subtree, but only
 * the root records the cell ref — the members inherit through the graph
 * relations (phase-1.md:21). Groups have no root, so their direct members
 * each record the same cell (the plain per-element write covers them).
 */
const expandSemanticObjectsForCellDrop = (
  elements: readonly ExcalidrawElement[],
  elementsToAdd: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] =>
  getMindmapElementsForSelection(elements, elementsToAdd);

/**
 * Adds semantic objects to a table cell and appends them to the cell's
 * z-order tail. Bound text follows its host through `containerId` without a
 * ref of its own; mindmap subtrees are recorded on their root only; a frame
 * enters as a whole object — the frame itself records the cell while its
 * members keep pointing at it through their frameLike refs
 * (phase-1.md:21, :60, :127).
 *
 * @returns mutated allElements (same data structure)
 */
export const addElementsToTableCell = <T extends ElementsMapOrArray>(
  allElements: T,
  elementsToAdd: readonly ExcalidrawElement[],
  table: ExcalidrawTableElement,
  cellId: string,
): T => {
  const elementsMap = arrayToMap(allElements) as ElementsMap;
  const nonDeleted = Array.from(allElements.values()).filter(
    (element) => !element.isDeleted,
  );
  const candidateElements = expandSemanticObjectsForCellDrop(
    nonDeleted,
    elementsToAdd,
  );
  const candidateIds = new Set(candidateElements.map((el) => el.id));

  const finalElementsToAdd = new Set<ExcalidrawElement>();

  for (const element of candidateElements) {
    // bound text follows its host through `containerId` — it never records a
    // spatial parent of its own (phase-1.md:66)
    if (isBoundToContainer(element)) {
      continue;
    }
    // a member of a frame entering the cell inherits through that frame —
    // the frame records the cell, the member keeps its frameLike ref
    // (phase-1.md:21, :127)
    if (
      element.containerRef?.kind === "frameLike" &&
      candidateIds.has(element.containerRef.elementId)
    ) {
      continue;
    }
    if (isTableElement(element) || isFrameLikeElement(element)) {
      // a container entering a cell of its own descendant tree would close a
      // parent-chain cycle — skip it
      let ancestor: ExcalidrawElement | undefined = table;
      while (ancestor) {
        if (ancestor.id === element.id) {
          break;
        }
        ancestor = ancestor.containerRef?.elementId
          ? (elementsMap.get(ancestor.containerRef.elementId) as
              | ExcalidrawElement
              | undefined)
          : undefined;
      }
      if (ancestor?.id === element.id) {
        continue;
      }
    }
    if (isMindmapNodeElement(element) && element.role !== "root") {
      // the graph root records the membership; nodes and edges inherit
      continue;
    }
    if (isMindmapEdgeElement(element)) {
      continue;
    }

    finalElementsToAdd.add(element);

    const boundTextElement = getBoundTextElement(element, elementsMap);
    if (boundTextElement && !finalElementsToAdd.has(boundTextElement)) {
      // the bound text keeps `containerId` (no ref write), but must ride the
      // z-order reorder together with its host
      finalElementsToAdd.add(boundTextElement);
    }
  }

  if (!finalElementsToAdd.size) {
    return allElements;
  }

  let didChangeMembership = false;

  for (const element of finalElementsToAdd) {
    if (isBoundToContainer(element)) {
      continue;
    }
    if (isSameTableCellRef(element, table.id, cellId)) {
      // membership unchanged — no write, no history entry
      continue;
    }
    if (
      element.containerRef?.kind === "frameLike" &&
      finalElementsToAdd.has(
        elementsMap.get(element.containerRef.elementId) as ExcalidrawElement,
      )
    ) {
      // the frame is committed to the cell in this very batch: the member
      // inherits through it and its frameLike ref stays untouched
      // (defensive twin of the candidate-loop skip, for callers that pass
      // a frame together with its members)
      continue;
    }
    mutateElement(element, elementsMap, {
      containerRef: tableCellContainerRef(table.id, cellId, "content"),
    });
    didChangeMembership = true;
  }

  // dragging elements that already belong to the cell keeps their relative
  // order (no z-order churn)
  if (!didChangeMembership) {
    return allElements;
  }

  const otherElements = Array.from(allElements.values()).filter(
    (element) => !finalElementsToAdd.has(element),
  );
  const insertionIndex = getTableCellInsertionIndex(
    otherElements,
    table.id,
    cellId,
  );

  if (insertionIndex === null) {
    return allElements;
  }

  const reorderedElements = [
    ...otherElements.slice(0, insertionIndex),
    ...finalElementsToAdd,
    ...otherElements.slice(insertionIndex),
  ];

  syncMovedIndices(reorderedElements, arrayToMap([...finalElementsToAdd]));

  return (
    Array.isArray(allElements)
      ? reorderedElements
      : new Map(reorderedElements.map((element) => [element.id, element]))
  ) as T;
};

/**
 * The one table a dropped selection currently belongs to — mirrors
 * `getCommonFrameId`: `null` when any element is not a direct cell member
 * (bound text inherits, so it does not veto; a frame placed in a cell is a
 * member through its own `tableCell` ref).
 */
export const getCommonTableCellId = (
  elements: readonly ExcalidrawElement[],
): string | null => {
  let commonTableId: string | undefined;

  for (const element of elements) {
    const ref = element.containerRef;
    if (ref?.kind !== "tableCell") {
      return null;
    }
    if (commonTableId === undefined) {
      commonTableId = ref.elementId;
    } else if (commonTableId !== ref.elementId) {
      return null;
    }
  }

  return commonTableId ?? null;
};

/**
 * Complete descendants of a table or frame, including nested containers and
 * bound text. Container operations treat the subtree as one unit.
 */
export const getContainerSubtreeElements = (
  allElements: readonly ExcalidrawElement[],
  containerId: string,
  elementsMap: ElementsMap,
): ExcalidrawElement[] => {
  const subtreeIds = new Set<string>();
  const queue = [containerId];
  const seenContainers = new Set<string>([containerId]);

  for (let index = 0; index < queue.length; index++) {
    const currentContainerId = queue[index];
    // the direct-parent index covers tableCell and frameLike refs alike;
    // fall back to a scan for collections without an index
    const members =
      getIndexedFrameChildren(allElements, currentContainerId) ??
      Array.from(allElements.values()).filter(
        (element) => element.containerRef?.elementId === currentContainerId,
      );
    for (const member of members) {
      if (member.isDeleted) {
        continue;
      }
      subtreeIds.add(member.id);
      const boundTextElement = getBoundTextElement(member, elementsMap);
      if (boundTextElement) {
        subtreeIds.add(boundTextElement.id);
      }
      if (
        (isTableElement(member) || isFrameLikeElement(member)) &&
        !seenContainers.has(member.id)
      ) {
        seenContainers.add(member.id);
        queue.push(member.id);
      }
    }
  }

  return allElements.filter((element) => subtreeIds.has(element.id));
};

export const getTableSubtreeElements = getContainerSubtreeElements;

/**
 * Copy-time regeneration of a table's structure ids (phase-1.md:69): rows,
 * columns and cells all get fresh ids while keeping sizes and the
 * (rowId, columnId) intersection structure. The returned map remaps each
 * original cell id to its duplicate, for the `tableCell` refs of copied
 * descendants.
 */
export const regenerateTableIds = (
  table: TableDataV1,
  randomizer: () => string = randomId,
): { table: TableDataV1; cellIdMap: Map<string, string> } => {
  // Reject malformed source structures before their references are remapped.
  assertValidTableData(table);
  const rowIdMap = new Map(table.rows.map((row) => [row.id, randomizer()]));
  const columnIdMap = new Map(
    table.columns.map((column) => [column.id, randomizer()]),
  );
  const cellIdMap = new Map(table.cells.map((cell) => [cell.id, randomizer()]));

  return {
    table: {
      schemaVersion: table.schemaVersion,
      style: table.style ? cloneJSON(table.style) : undefined,
      rows: table.rows.map((row) => ({
        id: rowIdMap.get(row.id)!,
        height: row.height,
        style: row.style ? cloneJSON(row.style) : undefined,
      })),
      columns: table.columns.map((column) => ({
        id: columnIdMap.get(column.id)!,
        width: column.width,
        style: column.style ? cloneJSON(column.style) : undefined,
      })),
      cells: table.cells.map((cell) => ({
        id: cellIdMap.get(cell.id)!,
        rowId: rowIdMap.get(cell.rowId)!,
        columnId: columnIdMap.get(cell.columnId)!,
        style: cloneJSON(cell.style),
        ...(cell.rowSpan !== undefined ? { rowSpan: cell.rowSpan } : {}),
        ...(cell.columnSpan !== undefined
          ? { columnSpan: cell.columnSpan }
          : {}),
        ...(cell.mergedInto
          ? { mergedInto: cellIdMap.get(cell.mergedInto)! }
          : {}),
      })),
    },
    cellIdMap,
  };
};

/**
 * Paste-time eligibility for a cell drop (the `tableCell` counterpart of
 * `filterElementsEligibleAsFrameChildren`): bound text follows its host; the
 * members of a table duplicated together with them ride that table's copy
 * instead of being re-parented into the target cell, and the members of a
 * frame in the batch ride the frame, which records the cell itself
 * (phase-1.md:21, :69, :127).
 */
export const filterElementsEligibleAsTableCellChildren = (
  elements: readonly ExcalidrawElement[],
  table: ExcalidrawTableElement,
): ExcalidrawElement[] => {
  const duplicatedContainers = new Set<string>();
  for (const element of elements) {
    if (isTableElement(element) || isFrameLikeElement(element)) {
      duplicatedContainers.add(element.id);
    }
  }

  return elements.filter((element) => {
    if (isBoundToContainer(element)) {
      // follows its host through `containerId`
      return false;
    }
    if (
      element.containerRef &&
      duplicatedContainers.has(element.containerRef.elementId)
    ) {
      // the direct parent is part of this batch: the element rides its
      // parent's copy instead of being re-parented into the target cell
      return false;
    }
    return true;
  });
};

/**
 * Cell-scoped alignment reference (phase-1.md:79, :87): when the dragged
 * selection consists of one table cell's direct members, snap references
 * narrow to that cell's other members plus the cell's own geometry (its
 * corners, edge midpoints and center), instead of the whole scene. Returns
 * `null` for any other drag so snapping keeps its global behavior.
 */
export const getTableCellSnapScope = (
  elements: readonly ExcalidrawElement[],
  selectedElements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
): { table: ExcalidrawTableElement; cellId: string } | null => {
  let scope: { tableId: string; cellId: string } | null = null;

  for (const element of selectedElements) {
    const ref = element.containerRef;
    // bound text and mindmap members inherit instead of carrying a ref, so
    // they fall back to the global snap set
    if (isBoundToContainer(element) || ref?.kind !== "tableCell") {
      return null;
    }
    if (!scope) {
      scope = { tableId: ref.elementId, cellId: ref.cellId };
    } else if (scope.tableId !== ref.elementId || scope.cellId !== ref.cellId) {
      return null;
    }
  }

  if (!scope) {
    return null;
  }

  const table = elementsMap.get(scope.tableId) as
    | ExcalidrawTableElement
    | undefined;
  if (!table || table.isDeleted || !isTableElement(table)) {
    return null;
  }
  if (
    !getTableCellAtPoint(
      table,
      table.x + table.width / 2,
      table.y + table.height / 2,
    )
  ) {
    return null;
  }
  return { table, cellId: scope.cellId };
};

/**
 * The snap reference points of one cell in scene coords: its four corners,
 * edge midpoints and center — alignment lines to these read as edge and
 * center alignment, never as cell splits (phase-1.md:79).
 */
export const getTableCellSnapPoints = (
  table: ExcalidrawTableElement,
  cellId: string,
): [number, number][] => {
  const bounds = getTableCellBounds(table.table, cellId);
  if (!bounds) {
    return [];
  }
  const toScene = (localX: number, localY: number): [number, number] => [
    table.x + localX,
    table.y + localY,
  ];

  return [
    toScene(bounds.x, bounds.y),
    toScene(bounds.x + bounds.width, bounds.y),
    toScene(bounds.x, bounds.y + bounds.height),
    toScene(bounds.x + bounds.width, bounds.y + bounds.height),
    // edge midpoints and the cell center
    toScene(bounds.x + bounds.width / 2, bounds.y),
    toScene(bounds.x, bounds.y + bounds.height / 2),
    toScene(bounds.x + bounds.width, bounds.y + bounds.height / 2),
    toScene(bounds.x + bounds.width / 2, bounds.y + bounds.height),
    toScene(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
  ];
};

/**
 * Drop-out counterpart of the commit: a `tableCell` ref names the direct
 * parent cell, so membership clears when the element did not land in its own
 * table. Landing in another table's cell is written by the explicit commit
 * (`addElementsToTableCell`); members of the committed target are kept.
 *
 * @returns mutated allElements (same data structure)
 */
export const updateTableCellMembershipOfSelectedElements = <
  T extends ElementsMapOrArray,
>(
  allElements: T,
  selectedElements: readonly ExcalidrawElement[],
  dropSceneCoords: { x: number; y: number } | null,
  committedTarget: { tableId: string; cellId: string } | null,
): T => {
  const elementsMap = arrayToMap(allElements) as ElementsMap;
  const elementsToFilter = new Set<ExcalidrawElement>(selectedElements);

  for (const element of elementsToFilter) {
    const ref = element.containerRef;
    if (!ref || ref.kind !== "tableCell") {
      continue;
    }
    if (
      committedTarget &&
      ref.elementId === committedTarget.tableId &&
      ref.cellId === committedTarget.cellId
    ) {
      // just committed by this drop
      continue;
    }
    const table = elementsMap.get(ref.elementId) as
      | ExcalidrawTableElement
      | undefined;
    if (!table || table.isDeleted || !isTableElement(table)) {
      if (table && !table.isDeleted) {
        // dangling ref to a non-table element
        mutateElement(element, elementsMap, { containerRef: undefined });
      }
      continue;
    }
    if (!dropSceneCoords) {
      // no drop point to re-judge against — membership is stable
      continue;
    }
    const cellId = getTableCellAtPoint(
      table,
      dropSceneCoords.x,
      dropSceneCoords.y,
    );
    if (!cellId) {
      // dropped outside its direct table: the frame-like ancestor (if any)
      // adopts it through the regular frame branch of the caller
      mutateElement(element, elementsMap, { containerRef: undefined });
    }
    // still inside its own table: a cross-cell move within the same table is
    // written by the commit; no extra write here
  }

  return allElements;
};
