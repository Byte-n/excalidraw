import { getIndexedTableCellChildren } from "./tableChildrenIndex";
import { isSequenceFragmentElement } from "./compositeShape/sequenceOutline";
import { getTableSubtreeElements } from "./tableContainer";
import { getMemberTranslationsForRows } from "./tableOps";
import {
  getTableCellTextPadding,
  resolveTableCellTextStyle,
} from "./tableTextStyle";
import { getTableCellBounds, getTableHeight } from "./tableStruct";
import { getTextBlock } from "./text/ops";
import { layoutTextBlock } from "./text/layout";
import { cellKey } from "./text/keys";
import { isTableElement, isFrameLikeElement } from "./typeChecks";

import type { Scene } from "./Scene";
import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  NonDeleted,
  TableDataV1,
} from "./types";
import type { TextBlockMap } from "./text/types";

export const collectCellMemberIds = (
  scene: Scene,
  tableId: string,
  cellIds: readonly string[],
): string[] => {
  const elementsMap = scene.getNonDeletedElementsMap();
  const allElements = scene.getNonDeletedElements();
  const ids = new Set<string>();
  for (const cellId of cellIds) {
    for (const member of getIndexedTableCellChildren(
      elementsMap,
      tableId,
      cellId,
    ) ?? []) {
      ids.add(member.id);
      if (
        isTableElement(member) ||
        isFrameLikeElement(member) ||
        isSequenceFragmentElement(member)
      ) {
        for (const descendant of getTableSubtreeElements(
          allElements,
          member.id,
          elementsMap,
        )) {
          ids.add(descendant.id);
        }
      }
    }
  }
  return [...ids];
};

export const getRowOrColumnCellIds = (
  table: NonDeleted<ExcalidrawTableElement>,
  kind: "row" | "column",
  id: string,
): string[] =>
  table.table.cells
    .filter((cell) => (kind === "row" ? cell.rowId : cell.columnId) === id)
    .map((cell) => cell.id);

export const buildMemberDeltas = (
  scene: Scene,
  table: NonDeleted<ExcalidrawTableElement>,
  kind: "row" | "column",
  translations: Map<string, { dx: number; dy: number }>,
): Map<string, { dx: number; dy: number }> => {
  const deltas = new Map<string, { dx: number; dy: number }>();
  for (const id of translations.keys()) {
    const delta = translations.get(id)!;
    for (const memberId of collectCellMemberIds(
      scene,
      table.id,
      getRowOrColumnCellIds(table, kind, id),
    )) {
      deltas.set(memberId, delta);
    }
  }

  return deltas;
};

export const applyMemberTranslations = (
  scene: Scene,
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
  const deltas = buildMemberDeltas(scene, table, kind, translations);
  const elementsMap = scene.getNonDeletedElementsMap();
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
      scene.mutateElement(
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
 * 表格文本布局：按每个可见格的区域算所需高度，返回「被撑高的末行 → 新行高」。
 * 合并格只撑它跨度的最后一行，与既有行增长语义一致；宽度不参与求解。
 */
export const getTableTextLayout = (
  table: Pick<ExcalidrawTableElement, "table">,
  blockMap: TextBlockMap | undefined,
): Map<string, number> => {
  const requiredHeights = new Map<string, number>();
  for (const cell of table.table.cells) {
    if (cell.mergedInto) {
      continue;
    }
    const block = getTextBlock(blockMap, cellKey(cell.id));
    if (!block?.text) {
      continue;
    }
    const bounds = getTableCellBounds(table.table, cell.id);
    if (!bounds) {
      continue;
    }
    const style = resolveTableCellTextStyle(table.table, cell, block.style);
    const padding = getTableCellTextPadding(table.table, cell);
    const layout = layoutTextBlock({
      text: block.text,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      maxWidth: Math.max(1, bounds.width - padding.x * 2),
      wrap: "wrap",
      growWidth: false,
    });
    const startRow = table.table.rows.findIndex((row) => row.id === cell.rowId);
    const spanRows = table.table.rows.slice(
      startRow,
      startRow + (cell.rowSpan ?? 1),
    );
    const row = spanRows[spanRows.length - 1];
    if (!row) {
      continue;
    }
    const required =
      layout.height + padding.y * 2 - (bounds.height - row.height);
    requiredHeights.set(
      row.id,
      Math.max(requiredHeights.get(row.id) ?? 0, required),
    );
  }
  return requiredHeights;
};

/**
 * 按区域文本撑高表格的最后一行，并平移后续行的成员。只增长、不收缩；
 * 返回是否有行被撑高。
 */
export const applyTableTextLayout = (
  scene: Scene,
  table: NonDeleted<ExcalidrawTableElement>,
): boolean => {
  const requiredHeights = getTableTextLayout(table, table.texts);
  const rowsNeedGrowth = table.table.rows.some((row) => {
    const requiredHeight = requiredHeights.get(row.id);
    return requiredHeight !== undefined && requiredHeight > row.height;
  });
  if (!rowsNeedGrowth) {
    return false;
  }
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
  applyMemberTranslations(scene, table, "row", translations);
  scene.mutateElement(
    table,
    {
      table: nextTable,
      height: getTableHeight(nextTable),
    },
    { informMutation: false, isDragging: true },
  );
  return true;
};
