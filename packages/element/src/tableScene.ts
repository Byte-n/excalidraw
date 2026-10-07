import { getFontString, invariant } from "@excalidraw/common";

import { newTableElement, newTextElement } from "./newElement";
import { getIndexedTableCellChildren } from "./tableChildrenIndex";
import { getTableSubtreeElements } from "./tableContainer";
import { measureText, normalizeText } from "./textMeasurements";
import {
  getCellsInTableRange,
  getMemberTranslationsForColumns,
  getMemberTranslationsForRows,
  insertColumnInTable,
  insertRowInTable,
  mergeTableCells,
  removeColumnFromTable,
  removeRowFromTable,
  splitTableCells,
} from "./tableOps";
import {
  assertValidTableData,
  getTableCellRange,
  getTableHeight,
  getTableWidth,
  getVisibleTableCell,
} from "./tableStruct";
import {
  applyMemberTranslations,
  collectCellMemberIds,
  refitCellBackgroundTexts,
} from "./tableSceneGeometry";
import { isTableElement, isTextElement } from "./typeChecks";
import {
  CanvasSceneError,
  createCalculationScene,
  deleteSceneElements,
  finishSceneOperation,
} from "./sceneOperations";

import type { Scene } from "./Scene";
import type {
  CanvasElementOperationReferences,
  CanvasElementOperationResult,
  NullableStyle,
  ScenePoint,
} from "./sceneOperations";
import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  FontFamilyValues,
  NonDeleted,
  TableCellData,
  TableDataV1,
  TableStyle,
} from "./types";

export type TableTarget = Readonly<{ tableId: string }>;
export type CellStylePatch = NullableStyle<TableCellData["style"]>;
export type TableStylePatch = NullableStyle<Omit<TableStyle, "title">> & {
  readonly title?: NullableStyle<NonNullable<TableStyle["title"]>>;
};
export type TableOperation =
  | {
      action: "create";
      position: ScenePoint;
      rowCount: number;
      columnCount: number;
      title?: string;
      style?: TableStylePatch;
    }
  | { action: "delete"; target: TableTarget }
  | { action: "setCellText"; target: TableTarget; cellId: string; text: string }
  | { action: "insertRow" | "insertColumn"; target: TableTarget; at: number }
  | { action: "deleteRow"; target: TableTarget; rowId: string }
  | { action: "deleteColumn"; target: TableTarget; columnId: string }
  | {
      action: "mergeCells";
      target: TableTarget;
      firstCellId: string;
      lastCellId: string;
    }
  | { action: "splitCell"; target: TableTarget; cellId: string }
  | {
      action: "setCellStyle";
      target: TableTarget;
      cellId: string;
      style: CellStylePatch;
    }
  | { action: "setTitle"; target: TableTarget; text: string }
  | { action: "setStyle"; target: TableTarget; style: TableStylePatch };
export type TableOperationReferences = Extract<
  CanvasElementOperationReferences,
  { domain: "table" }
>;

const compareSlotIdentity = (
  left: ExcalidrawElement,
  right: ExcalidrawElement,
) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

/** 清除覆盖后由既有渲染继承链提供默认值，不持久化 null。 */
const patchStyle = <T extends object>(
  current: T,
  patch: NullableStyle<T>,
): T => {
  const next = { ...current };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value === null) {
      delete next[key];
    } else if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
};

export const getTableSceneTitle = (
  elements: readonly ExcalidrawElement[],
  tableId: string,
): NonDeleted<ExcalidrawTextElement> | undefined =>
  elements
    .filter(
      (element): element is NonDeleted<ExcalidrawTextElement> =>
        !element.isDeleted &&
        isTextElement(element) &&
        element.containerRef?.kind === "tableTitle" &&
        element.containerRef.elementId === tableId,
    )
    .sort(compareSlotIdentity)[0];

/** 标题持久化位置只使用场景坐标；缩放和操作轨道属于编辑器。 */
export const getTableSceneTitlePosition = (
  table: ExcalidrawTableElement,
  title: Pick<ExcalidrawTextElement, "width" | "height">,
) => {
  const align = table.table.style?.title?.align ?? "start";
  return {
    x:
      table.x +
      (align === "center"
        ? (table.width - title.width) / 2
        : align === "end"
        ? table.width - title.width
        : 0),
    y: table.y - (table.table.style?.title?.gap ?? 2) - title.height,
  };
};

export const positionTableSceneTitle = (
  scene: Scene,
  table: ExcalidrawTableElement,
) => {
  const title = getTableSceneTitle(
    scene.getElementsIncludingDeleted(),
    table.id,
  );
  if (title) {
    scene.mutateElement(title, getTableSceneTitlePosition(table, title));
  }
};

export const setTableSceneTitle = (
  scene: Scene,
  table: ExcalidrawTableElement,
  value: string,
  options?: { fontFamily?: FontFamilyValues },
) => {
  const text = normalizeText(value);
  let title = getTableSceneTitle(scene.getElementsIncludingDeleted(), table.id);
  if (!title) {
    title = newTextElement({
      x: table.x,
      y: table.y,
      text,
      fontFamily: options?.fontFamily,
      containerRef: { kind: "tableTitle", elementId: table.id },
    });
    scene.insertElementsAtIndex([title], scene.getElementIndex(table.id) + 1);
  } else {
    scene.mutateElement(title, {
      text,
      originalText: text,
      ...measureText(text, getFontString(title), title.lineHeight),
    });
  }
  positionTableSceneTitle(scene, table);
  return title;
};

export const setTableSceneStyle = (
  scene: Scene,
  table: ExcalidrawTableElement,
  patch: TableStylePatch,
) => {
  const { title, ...leaves } = patch;
  const style = patchStyle(table.table.style ?? {}, leaves);
  scene.mutateElement(table, {
    table: {
      ...table.table,
      style: {
        ...style,
        ...(title !== undefined && {
          title: patchStyle(table.table.style?.title ?? {}, title),
        }),
      },
    },
  });
  positionTableSceneTitle(scene, table);
};

export const setTableSceneCellStyle = (
  scene: Scene,
  table: ExcalidrawTableElement,
  cellId: string,
  style: CellStylePatch,
) => {
  const cell = requireCell(table, cellId);
  scene.mutateElement(table, {
    table: {
      ...table.table,
      cells: table.table.cells.map((entry) =>
        entry.id === cell.id
          ? { ...entry, style: patchStyle(entry.style, style) }
          : entry,
      ),
    },
  });
  return cell.id;
};

const requireCell = (table: ExcalidrawTableElement, cellId: string) => {
  const cell = getVisibleTableCell(table.table, cellId);
  if (!cell) {
    throw new CanvasSceneError("target_not_found", "表格单元格不存在");
  }
  return cell;
};

export const setTableSceneCellText = (
  scene: Scene,
  table: NonDeleted<ExcalidrawTableElement>,
  cellId: string,
  value: string,
) => {
  const anchor = requireCell(table, cellId);
  const text = normalizeText(value);
  let element = getIndexedTableCellChildren(
    scene.getNonDeletedElementsMap(),
    table.id,
    anchor.id,
    "backgroundText",
  )
    ?.filter(isTextElement)
    .sort(compareSlotIdentity)[0];
  if (element) {
    scene.mutateElement(element, { text, originalText: text });
  } else {
    element = newTextElement({
      x: table.x,
      y: table.y,
      text,
      textAlign: "center",
      verticalAlign: "middle",
      autoResize: false,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: anchor.id,
        role: "backgroundText",
      },
    });
    const content = getIndexedTableCellChildren(
      scene.getNonDeletedElementsMap(),
      table.id,
      anchor.id,
      "content",
    )?.[0];
    scene.insertElementsAtIndex(
      [element],
      content
        ? scene.getElementIndex(content.id)
        : scene.getElementIndex(table.id) + 1,
    );
  }
  refitCellBackgroundTexts(scene, table, [anchor.id]);
  return element;
};

/** 拒绝部分跨越第三个合并区域，端点本身的完整 span 计入矩形。 */
const assertMergeRectangle = (
  table: TableDataV1,
  firstId: string,
  lastId: string,
) => {
  const first = getVisibleTableCell(table, firstId)!;
  const last = getVisibleTableCell(table, lastId)!;
  const row = (cell: TableCellData) =>
    table.rows.findIndex((entry) => entry.id === cell.rowId);
  const column = (cell: TableCellData) =>
    table.columns.findIndex((entry) => entry.id === cell.columnId);
  const startRow = Math.min(row(first), row(last));
  const endRow = Math.max(
    row(first) + (first.rowSpan ?? 1) - 1,
    row(last) + (last.rowSpan ?? 1) - 1,
  );
  const startColumn = Math.min(column(first), column(last));
  const endColumn = Math.max(
    column(first) + (first.columnSpan ?? 1) - 1,
    column(last) + (last.columnSpan ?? 1) - 1,
  );
  for (const cell of table.cells.filter((cell) => !cell.mergedInto)) {
    const r = row(cell);
    const c = column(cell);
    const lastRow = r + (cell.rowSpan ?? 1) - 1;
    const lastColumn = c + (cell.columnSpan ?? 1) - 1;
    if (
      r <= endRow &&
      lastRow >= startRow &&
      c <= endColumn &&
      lastColumn >= startColumn &&
      (r < startRow ||
        lastRow > endRow ||
        c < startColumn ||
        lastColumn > endColumn)
    ) {
      throw new CanvasSceneError(
        "invalid_operation",
        "合并范围部分跨越已有合并单元格",
      );
    }
  }
};

export const mergeTableSceneCells = (
  scene: Scene,
  table: NonDeleted<ExcalidrawTableElement>,
  firstId: string,
  lastId: string,
) => {
  requireCell(table, firstId);
  requireCell(table, lastId);
  assertMergeRectangle(table.table, firstId, lastId);
  const range = getTableCellRange(table.table, firstId, lastId);
  const selected = getCellsInTableRange(table.table, range).sort(
    (left, right) =>
      table.table.rows.findIndex((row) => row.id === left.rowId) -
        table.table.rows.findIndex((row) => row.id === right.rowId) ||
      table.table.columns.findIndex((column) => column.id === left.columnId) -
        table.table.columns.findIndex((column) => column.id === right.columnId),
  );
  if (selected.filter((cell) => !cell.mergedInto).length < 2) {
    throw new CanvasSceneError(
      "invalid_operation",
      "Select at least two visible cells to merge",
    );
  }
  const merged = mergeTableCells(table.table, firstId, lastId);
  const anchor = selected[0].id;
  const elementsMap = scene.getNonDeletedElementsMap();
  const backgrounds = selected.flatMap((cell) =>
    (
      getIndexedTableCellChildren(
        elementsMap,
        table.id,
        cell.id,
        "backgroundText",
      ) ?? []
    ).filter(isTextElement),
  );
  // 重复软引用按现有显示投影的稳定身份选择，避免拼接隐藏副本的内容。
  const visibleBackgrounds = selected.flatMap((cell) =>
    backgrounds
      .filter(
        (element) =>
          element.containerRef?.kind === "tableCell" &&
          element.containerRef.cellId === cell.id,
      )
      .sort(compareSlotIdentity)
      .slice(0, 1),
  );
  const text = visibleBackgrounds
    .filter((element) => element.originalText.length > 0)
    .map((element) => element.originalText)
    .join("\n");
  const retained =
    visibleBackgrounds.find(
      (element) =>
        element.containerRef?.kind === "tableCell" &&
        element.containerRef.cellId === anchor,
    ) ?? visibleBackgrounds.find((element) => element.originalText.length > 0);
  for (const cell of selected) {
    for (const member of getIndexedTableCellChildren(
      elementsMap,
      table.id,
      cell.id,
    ) ?? []) {
      if (
        member.containerRef?.kind === "tableCell" &&
        member.containerRef.role === "content"
      ) {
        scene.mutateElement(member as ExcalidrawElement, {
          containerRef: { ...member.containerRef, cellId: anchor },
        });
      }
    }
  }
  for (const background of backgrounds) {
    scene.mutateElement(
      background,
      background.id === retained?.id
        ? {
            text,
            originalText: text,
            containerRef: {
              kind: "tableCell",
              elementId: table.id,
              cellId: anchor,
              role: "backgroundText",
            },
          }
        : { isDeleted: true, containerRef: undefined },
    );
  }
  scene.mutateElement(table, { table: merged });
  refitCellBackgroundTexts(scene, table, [anchor]);
  return anchor;
};

export const splitTableSceneCells = (
  scene: Scene,
  table: NonDeleted<ExcalidrawTableElement>,
  cellIds: readonly string[],
) => {
  const anchors = [...new Set(cellIds.map((id) => requireCell(table, id).id))];
  if (
    !anchors.some((id) => {
      const cell = requireCell(table, id);
      return (cell.rowSpan ?? 1) > 1 || (cell.columnSpan ?? 1) > 1;
    })
  ) {
    throw new CanvasSceneError(
      "invalid_operation",
      "Select a merged cell to split",
    );
  }
  scene.mutateElement(table, { table: splitTableCells(table.table, anchors) });
  refitCellBackgroundTexts(scene, table, anchors);
};

const updateTableStructure = (
  scene: Scene,
  table: NonDeleted<ExcalidrawTableElement>,
  next: TableDataV1,
  axis: "row" | "column",
) => {
  applyMemberTranslations(
    scene,
    table,
    axis,
    axis === "row"
      ? getMemberTranslationsForRows(table.table, next)
      : getMemberTranslationsForColumns(table.table, next),
  );
  scene.mutateElement(table, {
    table: next,
    width: getTableWidth(next),
    height: getTableHeight(next),
  });
  refitCellBackgroundTexts(
    scene,
    table,
    next.cells.filter((cell) => !cell.mergedInto).map((cell) => cell.id),
  );
  positionTableSceneTitle(scene, table);
};

export const applyTableOperation = (
  elements: readonly ExcalidrawElement[],
  operation: TableOperation,
): CanvasElementOperationResult => {
  const scene = createCalculationScene(elements);
  try {
    let table: NonDeleted<ExcalidrawTableElement>;
    if (operation.action === "create") {
      if (
        !Number.isSafeInteger(operation.rowCount) ||
        operation.rowCount < 1 ||
        !Number.isSafeInteger(operation.columnCount) ||
        operation.columnCount < 1
      ) {
        throw new CanvasSceneError("invalid_input", "表格行列数量必须为正整数");
      }
      table = newTableElement({
        type: "table",
        x: operation.position.x,
        y: operation.position.y,
        rowCount: operation.rowCount,
        columnCount: operation.columnCount,
      });
      scene.insertElementsAtIndex(
        [table],
        scene.getElementsIncludingDeleted().length,
      );
    } else {
      const target = scene.getNonDeletedElement(operation.target.tableId);
      if (!target || !isTableElement(target)) {
        throw new CanvasSceneError("target_not_found", "表格不存在");
      }
      table = target;
    }
    assertValidTableData(table.table);
    const references: TableOperationReferences = {
      domain: "table",
      action: operation.action,
      tableId: table.id,
    };
    switch (operation.action) {
      case "create":
        if (operation.style) {
          setTableSceneStyle(scene, table, operation.style);
        }
        if (operation.title !== undefined) {
          setTableSceneTitle(scene, table, operation.title);
        }
        references.rows = table.table.rows.map((row, index) => ({
          rowId: row.id,
          index,
        }));
        references.columns = table.table.columns.map((column, index) => ({
          columnId: column.id,
          index,
        }));
        references.cells = table.table.cells.map((cell) => ({
          cellId: cell.id,
          rowId: cell.rowId,
          columnId: cell.columnId,
        }));
        break;
      case "delete":
        deleteSceneElements(
          new Set([
            table.id,
            ...getTableSubtreeElements(
              scene.getNonDeletedElements(),
              table.id,
              scene.getNonDeletedElementsMap(),
            ).map((element) => element.id),
          ]),
          scene,
        );
        break;
      case "setCellText":
        references.cellId = operation.cellId;
        references.anchorCellId = requireCell(table, operation.cellId).id;
        setTableSceneCellText(scene, table, operation.cellId, operation.text);
        break;
      case "setCellStyle":
        references.cellId = operation.cellId;
        references.anchorCellId = setTableSceneCellStyle(
          scene,
          table,
          operation.cellId,
          operation.style,
        );
        break;
      case "setTitle":
        setTableSceneTitle(scene, table, operation.text);
        break;
      case "setStyle":
        setTableSceneStyle(scene, table, operation.style);
        break;
      case "mergeCells":
        references.cellId = operation.firstCellId;
        references.anchorCellId = mergeTableSceneCells(
          scene,
          table,
          operation.firstCellId,
          operation.lastCellId,
        );
        break;
      case "splitCell":
        references.cellId = operation.cellId;
        references.anchorCellId = requireCell(table, operation.cellId).id;
        splitTableSceneCells(scene, table, [operation.cellId]);
        break;
      case "insertRow":
      case "insertColumn": {
        const axis = operation.action === "insertRow" ? "row" : "column";
        const count =
          axis === "row" ? table.table.rows.length : table.table.columns.length;
        if (
          !Number.isSafeInteger(operation.at) ||
          operation.at < 0 ||
          operation.at > count
        ) {
          throw new CanvasSceneError("invalid_input", "表格插入位置无效");
        }
        const next =
          axis === "row"
            ? insertRowInTable(table.table, operation.at)
            : insertColumnInTable(table.table, operation.at);
        if (axis === "row") {
          references.rowId = next.rows[operation.at].id;
        } else {
          references.columnId = next.columns[operation.at].id;
        }
        updateTableStructure(scene, table, next, axis);
        break;
      }
      case "deleteRow":
      case "deleteColumn": {
        const axis = operation.action === "deleteRow" ? "row" : "column";
        const id =
          operation.action === "deleteRow"
            ? operation.rowId
            : operation.columnId;
        const entries = axis === "row" ? table.table.rows : table.table.columns;
        if (!entries.some((entry) => entry.id === id)) {
          throw new CanvasSceneError("target_not_found", "表格行列不存在");
        }
        if (entries.length === 1) {
          throw new CanvasSceneError(
            "invalid_operation",
            "不能删除表格最后一行或一列",
          );
        }
        const removal =
          axis === "row"
            ? removeRowFromTable(table.table, id)
            : removeColumnFromTable(table.table, id);
        const remapped = removal.remappedCellIds ?? new Map<string, string>();
        for (const [oldId, newId] of remapped) {
          for (const memberId of collectCellMemberIds(scene, table.id, [
            oldId,
          ])) {
            const member = scene.getNonDeletedElement(memberId);
            if (
              member?.containerRef?.kind === "tableCell" &&
              member.containerRef.cellId === oldId
            ) {
              scene.mutateElement(member, {
                containerRef: { ...member.containerRef, cellId: newId },
              });
            }
          }
        }
        const doomed = new Set(
          removal.removedCellIds
            .filter((cellId) => !remapped.has(cellId))
            .flatMap((cellId) =>
              collectCellMemberIds(scene, table.id, [cellId]),
            ),
        );
        deleteSceneElements(doomed, scene);
        for (const memberId of doomed) {
          const member = scene.getElement(memberId);
          invariant(member, "待删除的表格成员必须存在");
          if (member.containerRef) {
            scene.mutateElement(member, { containerRef: undefined });
          }
        }
        updateTableStructure(scene, table, removal.table, axis);
        if (axis === "row") {
          references.rowId = id;
        } else {
          references.columnId = id;
        }
        break;
      }
    }
    return finishSceneOperation(
      elements,
      scene.getElementsIncludingDeleted(),
      references,
    );
  } finally {
    scene.destroy();
  }
};
