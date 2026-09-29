import type {
  ElementsMapOrArray,
  ExcalidrawElement,
  TableCellContainerRef,
} from "./types";

/**
 * Runtime reverse index for table cell membership: `(tableId, cellId)` ->
 * elements in that cell, in scene order. Both `content` graphics and
 * `backgroundText` are indexed; consumers narrow by `role` when needed.
 * The general `elementId -> direct members` relation is kept by
 * `frameChildrenIndex`, which tableCell refs feed as well.
 */
type TableChildrenIndex = Map<string, Map<string, ExcalidrawElement[]>>;

const indexes = new WeakMap<object, TableChildrenIndex>();
const collectionsByIndex = new WeakMap<
  TableChildrenIndex,
  ElementsMapOrArray
>();
const indexesByElement = new WeakMap<
  ExcalidrawElement,
  Set<TableChildrenIndex>
>();

export const getTableCellRef = (
  element: ExcalidrawElement,
): TableCellContainerRef | undefined =>
  element.containerRef?.kind === "tableCell" ? element.containerRef : undefined;

const removeElementIndex = (
  element: ExcalidrawElement,
  index: TableChildrenIndex,
) => {
  const indexes = indexesByElement.get(element);
  indexes?.delete(index);
  if (indexes?.size === 0) {
    indexesByElement.delete(element);
  }
};

export const unregisterTableChildrenIndex = (
  ...collections: readonly ElementsMapOrArray[]
) => {
  for (const collection of collections) {
    const index = indexes.get(collection as object);
    if (!index) {
      continue;
    }
    for (const element of collection.values()) {
      removeElementIndex(element, index);
    }
    indexes.delete(collection as object);
    collectionsByIndex.delete(index);
  }
};

export const registerTableChildrenIndex = (
  ...collections: readonly ElementsMapOrArray[]
) => {
  for (const collection of collections) {
    const tableChildren: TableChildrenIndex = new Map();
    for (const element of collection.values()) {
      const elementIndexes = indexesByElement.get(element) || new Set();
      elementIndexes.add(tableChildren);
      indexesByElement.set(element, elementIndexes);

      const cellRef = getTableCellRef(element);
      if (!cellRef) {
        continue;
      }
      const cells = tableChildren.get(cellRef.elementId) || new Map();
      const children = cells.get(cellRef.cellId) || [];
      children.push(element);
      cells.set(cellRef.cellId, children);
      tableChildren.set(cellRef.elementId, cells);
    }
    indexes.set(collection as object, tableChildren);
    collectionsByIndex.set(tableChildren, collection);
  }
};

/** Incremental entry point for structure operations and collab commits. */
export const updateTableChildrenIndex = (
  element: ExcalidrawElement,
  previousRef: TableCellContainerRef | undefined,
  nextRef: TableCellContainerRef | undefined,
) => {
  if (
    previousRef?.elementId === nextRef?.elementId &&
    previousRef?.cellId === nextRef?.cellId
  ) {
    return;
  }

  for (const index of indexesByElement.get(element) || []) {
    if (previousRef) {
      const cells = index.get(previousRef.elementId);
      const children = cells?.get(previousRef.cellId);
      if (children) {
        const elementIndex = children.findIndex(
          (child) => child.id === element.id,
        );
        if (elementIndex !== -1) {
          children.splice(elementIndex, 1);
          if (!children.length) {
            cells!.delete(previousRef.cellId);
          }
        }
        if (cells && !cells.size) {
          index.delete(previousRef.elementId);
        }
      }
    }

    if (nextRef) {
      const cells =
        index.get(nextRef.elementId) || new Map<string, ExcalidrawElement[]>();
      const children = cells.get(nextRef.cellId) || [];
      if (!children.some((child) => child.id === element.id)) {
        // keep scene order within the cell
        let insertionIndex = 0;
        for (const candidate of collectionsByIndex.get(index)?.values() || []) {
          if (candidate.id === element.id) {
            break;
          }
          const candidateRef = getTableCellRef(candidate);
          if (
            candidateRef?.elementId === nextRef.elementId &&
            candidateRef.cellId === nextRef.cellId
          ) {
            insertionIndex++;
          }
        }
        children.splice(insertionIndex, 0, element);
        cells.set(nextRef.cellId, children);
        index.set(nextRef.elementId, cells);
      }
    }
  }
};

/**
 * Elements of one cell. Returns `null` when the collection has no index
 * (an empty array means "indexed, cell empty").
 */
export const getIndexedTableCellChildren = (
  elements: ElementsMapOrArray,
  tableId: string,
  cellId: string,
  role?: TableCellContainerRef["role"],
): ExcalidrawElement[] | null => {
  const index = indexes.get(elements as object);
  if (!index) {
    return null;
  }
  const children = index.get(tableId)?.get(cellId) ?? [];
  const filtered = role
    ? children.filter((element) => getTableCellRef(element)?.role === role)
    : children;
  return filtered.slice();
};

/** Elements across every cell of the table, in scene order. */
export const getIndexedTableChildren = (
  elements: ElementsMapOrArray,
  tableId: string,
): ExcalidrawElement[] | null => {
  const index = indexes.get(elements as object);
  if (!index) {
    return null;
  }
  const children: ExcalidrawElement[] = [];
  for (const cellChildren of index.get(tableId)?.values() || []) {
    children.push(...cellChildren);
  }
  return children;
};
