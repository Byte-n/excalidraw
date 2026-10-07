import { getFontString } from "@excalidraw/common";

import { getBoundTextElement } from "./textElement";
import { getIndexedTableCellChildren } from "./tableChildrenIndex";
import {
  getTableBackgroundTextStyle,
  getTableSubtreeElements,
} from "./tableContainer";
import { getMemberTranslationsForRows } from "./tableOps";
import { getTableCellBounds, getTableHeight } from "./tableStruct";
import {
  isTableElement,
  isFrameLikeElement,
  isTextElement,
} from "./typeChecks";
import { measureText } from "./textMeasurements";
import { wrapText } from "./textWrapping";

import type { Scene } from "./Scene";
import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  ElementsMap,
  NonDeleted,
  TableDataV1,
} from "./types";

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

  const elementsMap = scene.getNonDeletedElementsMap();
  for (const [memberId, delta] of deltas) {
    const member = elementsMap.get(memberId);
    const boundText = member ? getBoundTextElement(member, elementsMap) : null;
    if (boundText && !deltas.has(boundText.id)) {
      deltas.set(boundText.id, delta);
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

export const getCellBackgroundTextLayout = (
  text: ExcalidrawTextElement,
  table: ExcalidrawTableElement,
  bounds: NonNullable<ReturnType<typeof getTableCellBounds>>,
  elementsMap: ElementsMap,
) => {
  const style = getTableBackgroundTextStyle(text, elementsMap);
  const padding = style?.padding ?? 0;
  const availableWidth = Math.max(bounds.width - padding * 2, 1);
  const font = getFontString(text);
  const wrapped = wrapText(text.originalText, font, availableWidth);
  const measured = measureText(wrapped, font, text.lineHeight);
  const width = Math.min(measured.width, availableWidth);
  const height = measured.height;
  const horizontalAlign = style?.horizontalAlign ?? text.textAlign;
  const verticalAlign = style?.verticalAlign ?? text.verticalAlign;
  const freeWidth = Math.max(0, bounds.width - padding * 2 - width);
  const freeHeight = Math.max(0, bounds.height - padding * 2 - height);
  return {
    text: wrapped,
    width,
    height,
    textAlign: horizontalAlign,
    verticalAlign,
    x:
      table.x +
      bounds.x +
      padding +
      (horizontalAlign === "center"
        ? freeWidth / 2
        : horizontalAlign === "right"
        ? freeWidth
        : 0),
    y:
      table.y +
      bounds.y +
      padding +
      (verticalAlign === "middle"
        ? freeHeight / 2
        : verticalAlign === "bottom"
        ? freeHeight
        : 0),
  };
};

export const refitCellBackgroundTexts = (
  scene: Scene,
  table: NonDeleted<ExcalidrawTableElement>,
  cellIds: readonly string[],
): void => {
  const elementsMap = scene.getNonDeletedElementsMap();
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
    const startRow = table.table.rows.findIndex(
      (candidate) => candidate.id === cell.rowId,
    );
    const spanRows = table.table.rows.slice(
      startRow,
      startRow + (cell.rowSpan ?? 1),
    );
    const row = spanRows[spanRows.length - 1];
    if (!row) {
      continue;
    }
    const backgroundTexts = texts.filter(isTextElement);
    textsByCell.set(cellId, backgroundTexts);
    for (const backgroundText of backgroundTexts) {
      const layout = getCellBackgroundTextLayout(
        backgroundText,
        table,
        bounds,
        elementsMap,
      );
      const padding =
        getTableBackgroundTextStyle(backgroundText, elementsMap)?.padding ?? 0;
      requiredHeights.set(
        row.id,
        Math.max(
          requiredHeights.get(row.id) ?? 0,
          layout.height + padding * 2 - (bounds.height - row.height),
        ),
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
    applyMemberTranslations(scene, table, "row", translations);
    scene.mutateElement(
      table,
      {
        table: nextTable,
        height: getTableHeight(nextTable),
      },
      { informMutation: false, isDragging: true },
    );
  }

  const currentTable = scene.getNonDeletedElement(table.id);
  if (!currentTable || !isTableElement(currentTable)) {
    return;
  }
  const currentElementsMap = scene.getNonDeletedElementsMap();
  for (const [cellId, backgroundTexts] of textsByCell) {
    const bounds = getTableCellBounds(currentTable.table, cellId);
    if (!bounds) {
      continue;
    }
    for (const backgroundText of backgroundTexts) {
      const liveText = currentElementsMap.get(backgroundText.id);
      if (!liveText || !isTextElement(liveText)) {
        continue;
      }
      scene.mutateElement(
        liveText,
        getCellBackgroundTextLayout(
          liveText,
          currentTable,
          bounds,
          currentElementsMap,
        ),
        { informMutation: false, isDragging: true },
      );
    }
  }
};
