import { pointFrom } from "@excalidraw/math";

import { describe, expect, it, vi } from "vitest";

import type { LocalPoint } from "@excalidraw/math";

import {
  newArrowElement,
  newElement,
  newTableElement,
} from "../src/newElement";
import { duplicateElements } from "../src/duplicate";
import { applyTableOperation } from "../src/tableScene";
import { CanvasSceneError } from "../src/sceneOperations";
import {
  getTableCellTextBaseStyle,
  resolveTableCellTextStyle,
} from "../src/tableTextStyle";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";
import { cellKey } from "../src/text/keys";
import { getTextBlock, withTextBlock } from "../src/text/ops";
import { isTableElement } from "../src/typeChecks";

import type {
  ExcalidrawElement,
  ExcalidrawArrowElement,
  ExcalidrawTableElement,
  NonDeleted,
} from "../src/types";
import type { TableOperation } from "../src/tableScene";

setCustomTextMetricsProvider({
  getLineWidth: (text, font) => text.length * parseFloat(font) * 0.5,
});

const tableIn = (
  elements: readonly ExcalidrawElement[],
  id: string,
): NonDeleted<ExcalidrawTableElement> => {
  const table = elements.find(
    (element): element is NonDeleted<ExcalidrawTableElement> =>
      element.id === id && !element.isDeleted && isTableElement(element),
  );
  if (!table) {
    throw new Error("测试表格不存在");
  }
  return table;
};
const cellAt = (table: ExcalidrawTableElement, row: number, column: number) =>
  table.table.cells.find(
    (cell) =>
      cell.rowId === table.table.rows[row].id &&
      cell.columnId === table.table.columns[column].id,
  )!;
const fixture = () =>
  newTableElement({
    type: "table",
    x: 100,
    y: 100,
    rowCount: 3,
    columnCount: 3,
  });
/** 给表格写进若干单元格文本块。 */
const withCellTexts = (
  table: ExcalidrawTableElement,
  entries: readonly (readonly [cellId: string, text: string])[],
): ExcalidrawTableElement => ({
  ...table,
  texts: entries.reduce(
    (acc, [cellId, text]) =>
      withTextBlock(acc, cellKey(cellId), {
        text,
        style: getTableCellTextBaseStyle(),
      }),
    table.texts,
  ),
});
const assertError = (
  elements: readonly ExcalidrawElement[],
  operation: TableOperation,
  code: CanvasSceneError["code"],
) => {
  const before = structuredClone(elements);
  try {
    applyTableOperation(elements, operation);
    throw new Error("非法操作必须失败");
  } catch (error) {
    expect(error).toBeInstanceOf(CanvasSceneError);
    expect((error as CanvasSceneError).code).toBe(code);
  }
  expect(elements).toEqual(before);
};

describe("完整表格纯场景操作", () => {
  it("合并拼接可见格文本到锚点，删除被覆盖格的文本键", () => {
    const table = fixture();
    const first = cellAt(table, 0, 0);
    const second = cellAt(table, 0, 1);
    const withText = withCellTexts(table, [
      [first.id, "可见"],
      [second.id, "下一格"],
    ]);
    const result = applyTableOperation([withText], {
      action: "mergeCells",
      target: { tableId: table.id },
      firstCellId: first.id,
      lastCellId: second.id,
    });
    const merged = tableIn(result.elements, table.id);
    expect(getTextBlock(merged.texts, cellKey(first.id))?.text).toBe(
      "可见\n下一格",
    );
    expect(getTextBlock(merged.texts, cellKey(second.id))).toBeUndefined();
  });

  it("创建表格名称和稳定行列格子引用，不依赖 DOM", () => {
    vi.stubGlobal("document", undefined);
    try {
      const result = applyTableOperation([], {
        action: "create",
        position: { x: 10, y: 100 },
        rowCount: 2,
        columnCount: 3,
        name: "标题",
        style: { backgroundColor: "#fff" },
      });
      expect(result.createdElementIds).toHaveLength(1);
      expect(result.references.domain).toBe("table");
      if (result.references.domain !== "table") {
        throw new Error("表格引用缺失");
      }
      const table = tableIn(result.elements, result.references.tableId);
      expect(table.name).toBe("标题");
      expect(table.width).toBe(480);
      expect(table.height).toBe(112);
      expect(result.references.rows).toHaveLength(2);
      expect(result.references.columns).toHaveLength(3);
      expect(result.references.cells).toHaveLength(6);
      expect(
        result.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("合并按行优先拼接文字，迁移正文成员并保留既有身份元数据", () => {
    const table = fixture();
    const first = cellAt(table, 0, 0);
    const last = cellAt(table, 1, 1);
    const withText = withCellTexts(table, [
      [first.id, "左上"],
      [cellAt(table, 0, 1).id, "右上"],
      [cellAt(table, 1, 0).id, "左下"],
      [last.id, "右下"],
    ]);
    const member = {
      ...newElement({
        type: "rectangle",
        x: 275,
        y: 175,
        width: 20,
        height: 20,
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId: last.id,
          role: "content",
        },
      }),
      texts: {
        body: {
          text: "成员标签",
          style: getTableCellTextBaseStyle(),
        },
      },
    };
    const input = [withText, member];
    const before = structuredClone(input);
    const result = applyTableOperation(input, {
      action: "mergeCells",
      target: { tableId: table.id },
      firstCellId: first.id,
      lastCellId: last.id,
    });
    expect(input).toEqual(before);
    const merged = tableIn(result.elements, table.id);
    expect(getTextBlock(merged.texts, cellKey(first.id))).toMatchObject({
      text: "左上\n右上\n左下\n右下",
    });
    expect(getTextBlock(merged.texts, cellKey(last.id))).toBeUndefined();
    expect(
      result.elements.find((element) => element.id === member.id),
    ).toMatchObject({
      containerRef: { cellId: first.id },
      texts: { body: { text: "成员标签" } },
    });
    expect(cellAt(merged, 0, 0)).toMatchObject({ rowSpan: 2, columnSpan: 2 });
    const split = applyTableOperation(result.elements, {
      action: "splitCell",
      target: { tableId: table.id },
      cellId: last.id,
    });
    expect(split.references).toMatchObject({
      cellId: last.id,
      anchorCellId: first.id,
    });
    expect(
      tableIn(split.elements, table.id).table.cells.every(
        (cell) => !cell.mergedInto && !cell.rowSpan && !cell.columnSpan,
      ),
    ).toBe(true);
    expect(split.createdElementIds).toHaveLength(0);
    // 拆分后锚点保留文本，新露出的格从空文本开始
    expect(
      getTextBlock(tableIn(split.elements, table.id).texts, cellKey(first.id))
        ?.text,
    ).toBe("左上\n右上\n左下\n右下");
    expect(
      getTextBlock(tableIn(split.elements, table.id).texts, cellKey(last.id)),
    ).toBeUndefined();
  });

  it("covered cell 的文本写到可见锚点，清空只删该键", () => {
    const table = fixture();
    const first = cellAt(table, 0, 0);
    const covered = cellAt(table, 0, 1);
    const merged = applyTableOperation([table], {
      action: "mergeCells",
      target: { tableId: table.id },
      firstCellId: first.id,
      lastCellId: covered.id,
    });
    const changed = applyTableOperation(merged.elements, {
      action: "setCellText",
      target: { tableId: table.id },
      cellId: covered.id,
      text: "更新",
    });
    expect(changed.references).toMatchObject({
      cellId: covered.id,
      anchorCellId: first.id,
    });
    const changedTable = tableIn(changed.elements, table.id);
    expect(getTextBlock(changedTable.texts, cellKey(first.id))?.text).toBe(
      "更新",
    );
    expect(
      getTextBlock(changedTable.texts, cellKey(covered.id)),
    ).toBeUndefined();
    const styled = applyTableOperation(changed.elements, {
      action: "setCellStyle",
      target: { tableId: table.id },
      cellId: covered.id,
      style: { backgroundColor: "#aaa", clipContent: true },
    });
    expect(cellAt(tableIn(styled.elements, table.id), 0, 0).style).toEqual({
      backgroundColor: "#aaa",
      clipContent: true,
    });
    const cleared = applyTableOperation(styled.elements, {
      action: "setCellStyle",
      target: { tableId: table.id },
      cellId: covered.id,
      style: { backgroundColor: null },
    });
    expect(cellAt(tableIn(cleared.elements, table.id), 0, 0).style).toEqual({
      clipContent: true,
    });
    const empty = applyTableOperation(cleared.elements, {
      action: "setCellText",
      target: { tableId: table.id },
      cellId: covered.id,
      text: "",
    });
    expect(empty.createdElementIds).toHaveLength(0);
    const emptyTable = tableIn(empty.elements, table.id);
    expect(emptyTable.texts?.[cellKey(first.id)]).toBeUndefined();
  });

  it("单元格文本出厂为 13px 左对齐垂直居中，短文字不撑行高", () => {
    const table = fixture();
    // 非首行单元格，隔离表头字重对测量的影响
    const cell = cellAt(table, 1, 0);
    const result = applyTableOperation([table], {
      action: "setCellText",
      target: { tableId: table.id },
      cellId: cell.id,
      text: "标签",
    });
    const next = tableIn(result.elements, table.id);
    expect(getTextBlock(next.texts, cellKey(cell.id))?.style).toMatchObject({
      fontSize: 13,
      textAlign: "left",
      verticalAlign: "middle",
    });
    expect(next.table.rows[1].height).toBe(56);
  });

  it("首行文本按表头派生 600 字重且不写回块", () => {
    const table = fixture();
    const result = applyTableOperation([table], {
      action: "setCellText",
      target: { tableId: table.id },
      cellId: cellAt(table, 0, 0).id,
      text: "表头",
    });
    const next = tableIn(result.elements, table.id);
    const block = getTextBlock(next.texts, cellKey(cellAt(table, 0, 0).id));
    // 纯渲染派生：块自身不落 fontWeight
    expect(block?.style.fontWeight).toBeUndefined();
    expect(
      resolveTableCellTextStyle(next.table, cellAt(next, 0, 0), block?.style)
        .fontWeight,
    ).toBe(600);
  });

  it("文字自动增长行高并平移后续行成员", () => {
    const table = fixture();
    const member = {
      ...newElement({
        type: "rectangle",
        x: 110,
        y: 168,
        width: 20,
        height: 20,
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId: cellAt(table, 1, 0).id,
          role: "content",
        },
      }),
      texts: {
        body: {
          text: "标签",
          style: getTableCellTextBaseStyle(),
        },
      },
    };
    const result = applyTableOperation([table, member], {
      action: "setCellText",
      target: { tableId: table.id },
      cellId: cellAt(table, 0, 0).id,
      text: "第一行\n第二行\n第三行\n第四行",
    });
    const next = tableIn(result.elements, table.id);
    const growth = next.table.rows[0].height - table.table.rows[0].height;
    expect(growth).toBeGreaterThan(0);
    const movedMember = result.elements.find(
      (element) => element.id === member.id,
    );
    expect(movedMember?.y).toBe(member.y + growth);
    expect(movedMember?.texts).toEqual(member.texts);
  });

  it.each(["insertRow", "insertColumn"] as const)(
    "%s 保留既有成员身份与索引并同步移动",
    (action) => {
      const table = fixture();
      const member = newElement({
        type: "rectangle",
        x: 275,
        y: 170,
        width: 20,
        height: 20,
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId: cellAt(table, 1, 1).id,
          role: "content",
        },
      });
      const result = applyTableOperation([table, member], {
        action,
        target: { tableId: table.id },
        at: 0,
      });
      const next = result.elements.find((element) => element.id === member.id)!;
      expect(next.x).toBe(member.x + (action === "insertColumn" ? 160 : 0));
      expect(next.y).toBe(member.y + (action === "insertRow" ? 56 : 0));
      expect(next.version).toBe(member.version);
      expect(next.index).toBe(member.index);
      expect(result.references).toHaveProperty(
        action === "insertRow" ? "rowId" : "columnId",
      );
    },
  );

  it.each(["deleteRow", "deleteColumn"] as const)(
    "%s 的存活合并 anchor 继承文本键和正文",
    (action) => {
      const table = fixture();
      const anchor = cellAt(table, 0, 0);
      const covered = cellAt(table, 1, 1);
      const withText = withCellTexts(table, [[anchor.id, "保留"]]);
      const member = newElement({
        type: "rectangle",
        x: 110,
        y: 110,
        width: 20,
        height: 20,
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId: anchor.id,
          role: "content",
        },
      });
      const merged = applyTableOperation([withText, member], {
        action: "mergeCells",
        target: { tableId: table.id },
        firstCellId: anchor.id,
        lastCellId: covered.id,
      });
      const result = applyTableOperation(
        merged.elements,
        action === "deleteRow"
          ? {
              action,
              target: { tableId: table.id },
              rowId: table.table.rows[0].id,
            }
          : {
              action,
              target: { tableId: table.id },
              columnId: table.table.columns[0].id,
            },
      );
      const nextTable = tableIn(result.elements, table.id);
      const survivingAnchor = cellAt(nextTable, 0, 0);
      expect(
        getTextBlock(nextTable.texts, cellKey(survivingAnchor.id))?.text,
      ).toBe("保留");
      if (survivingAnchor.id !== anchor.id) {
        expect(
          getTextBlock(nextTable.texts, cellKey(anchor.id)),
        ).toBeUndefined();
      }
      expect(
        result.elements.find((element) => element.id === member.id),
      ).toMatchObject({
        isDeleted: false,
        containerRef: { cellId: survivingAnchor.id },
      });
      // 被删除格不残留文本键
      for (const key of Object.keys(nextTable.texts ?? {})) {
        const cellId = key.slice("cell:".length);
        expect(
          nextTable.table.cells.some(
            (cell) => cell.id === cellId && !cell.mergedInto,
          ),
        ).toBe(true);
      }
    },
  );

  it("删除普通行时递归墓碑嵌套成员，存活行平移，incident 连线保留并解绑", () => {
    const table = fixture();
    const nested = newTableElement({
      type: "table",
      x: 110,
      y: 110,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: cellAt(table, 0, 0).id,
        role: "content",
      },
    });
    const withNestedText = withCellTexts(nested, [
      [nested.table.cells[0].id, "嵌套"],
    ]);
    const child = newElement({
      type: "rectangle",
      x: 120,
      y: 120,
      width: 20,
      height: 20,
      containerRef: {
        kind: "tableCell",
        elementId: nested.id,
        cellId: nested.table.cells[0].id,
        role: "content",
      },
    });
    const survivor = newElement({
      type: "rectangle",
      x: 110,
      y: 170,
      width: 20,
      height: 20,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: cellAt(table, 1, 0).id,
        role: "content",
      },
    });
    const arrow: ExcalidrawArrowElement = {
      ...newArrowElement({
        type: "arrow",
        elbowed: false,
        x: 0,
        y: 0,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(110, 110)],
      }),
      endBinding: {
        elementId: nested.id,
        attachPoint: [0.5, 0.5],
      },
    };
    const result = applyTableOperation(
      [table, withNestedText, child, survivor, arrow],
      {
        action: "deleteRow",
        target: { tableId: table.id },
        rowId: table.table.rows[0].id,
      },
    );
    expect(result.deletedElementIds).toEqual([nested.id, child.id]);
    expect(
      result.elements.find((element) => element.id === survivor.id)?.y,
    ).toBe(114);
    expect(
      result.elements.find((element) => element.id === arrow.id),
    ).toMatchObject({ isDeleted: false, endBinding: null });
    for (const id of [nested.id, child.id]) {
      expect(
        result.elements.find((element) => element.id === id)?.containerRef,
      ).toBeUndefined();
    }
  });

  it("表格名称更新写回元素，样式叶子 null 恢复继承布局且不清除省略字段", () => {
    const created = applyTableOperation([], {
      action: "create",
      position: { x: 100, y: 100 },
      rowCount: 1,
      columnCount: 1,
      name: "旧标题",
      style: {
        borderColor: "red",
        opacity: 60,
      },
    });
    const table = created.elements.find(isTableElement)!;
    expect(table.name).toBe("旧标题");
    const renamed = applyTableOperation(created.elements, {
      action: "setName",
      target: { tableId: table.id },
      name: "更长的新标题",
    });
    expect(tableIn(renamed.elements, table.id).name).toBe("更长的新标题");
    const cleared = applyTableOperation(renamed.elements, {
      action: "setStyle",
      target: { tableId: table.id },
      style: { borderColor: null },
    });
    expect(tableIn(cleared.elements, table.id).table.style).toEqual({
      opacity: 60,
    });
    const empty = applyTableOperation(cleared.elements, {
      action: "setName",
      target: { tableId: table.id },
      name: "   ",
    });
    expect(tableIn(empty.elements, table.id).name).toBe(null);
    expect(
      empty.elements.filter((element) => element.type === "text"),
    ).toHaveLength(0);
  });

  it("整表删除包含正文子树并保留输入墓碑", () => {
    const created = applyTableOperation([], {
      action: "create",
      position: { x: 0, y: 50 },
      rowCount: 1,
      columnCount: 1,
    });
    const table = created.elements.find(isTableElement)!;
    const member = {
      ...newElement({
        type: "rectangle",
        x: 10,
        y: 60,
        width: 20,
        height: 20,
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId: table.table.cells[0].id,
          role: "content",
        },
      }),
      texts: {
        body: {
          text: "标签",
          style: getTableCellTextBaseStyle(),
        },
      },
    };
    const tombstone = {
      ...newElement({ type: "rectangle", x: 0, y: 0, width: 1, height: 1 }),
      isDeleted: true,
    };
    const result = applyTableOperation(
      [...created.elements, member, tombstone],
      { action: "delete", target: { tableId: table.id } },
    );
    expect(result.elements.every((element) => element.isDeleted)).toBe(true);
    expect(result.deletedElementIds).not.toContain(tombstone.id);
    expect(result.elements.find((element) => element.id === tombstone.id)).toBe(
      tombstone,
    );
  });

  it("非法跨合并范围、删除末行列或错误归属不改变输入", () => {
    const table = fixture();
    const first = applyTableOperation([table], {
      action: "mergeCells",
      target: { tableId: table.id },
      firstCellId: cellAt(table, 0, 1).id,
      lastCellId: cellAt(table, 1, 1).id,
    });
    assertError(
      first.elements,
      {
        action: "mergeCells",
        target: { tableId: table.id },
        firstCellId: cellAt(table, 1, 0).id,
        lastCellId: cellAt(table, 1, 2).id,
      },
      "invalid_operation",
    );
    assertError(
      [table],
      {
        action: "setCellText",
        target: { tableId: table.id },
        cellId: "other-table-cell",
        text: "拒绝",
      },
      "target_not_found",
    );
    assertError(
      [table],
      { action: "insertRow", target: { tableId: table.id }, at: 99 },
      "invalid_input",
    );
    const single = newTableElement({
      type: "table",
      x: 0,
      y: 0,
      rowCount: 1,
      columnCount: 1,
    });
    assertError(
      [single],
      {
        action: "deleteRow",
        target: { tableId: single.id },
        rowId: single.table.rows[0].id,
      },
      "invalid_operation",
    );
    assertError(
      [single],
      {
        action: "deleteColumn",
        target: { tableId: single.id },
        columnId: single.table.columns[0].id,
      },
      "invalid_operation",
    );
    assertError(
      [single],
      {
        action: "splitCell",
        target: { tableId: single.id },
        cellId: single.table.cells[0].id,
      },
      "invalid_operation",
    );
  });

  it("插入行列保留既有文本键，删除行列丢弃被删格的键", () => {
    const table = fixture();
    const keptCell = cellAt(table, 1, 1);
    const withText = withCellTexts(table, [[keptCell.id, "保留"]]);

    const inserted = applyTableOperation([withText], {
      action: "insertRow",
      target: { tableId: table.id },
      at: 0,
    });
    const insertedTable = tableIn(inserted.elements, table.id);
    // 既有格 id 不变，文本键随格保留
    expect(getTextBlock(insertedTable.texts, cellKey(keptCell.id))?.text).toBe(
      "保留",
    );

    const deleted = applyTableOperation(inserted.elements, {
      action: "deleteRow",
      target: { tableId: table.id },
      rowId: table.table.rows[1].id,
    });
    const deletedTable = tableIn(deleted.elements, table.id);
    expect(Object.keys(deletedTable.texts ?? {})).toHaveLength(0);
    expect(
      deletedTable.table.cells.some((cell) => cell.id === keptCell.id),
    ).toBe(false);
  });

  it("复制表格按单元格映射重写文本键", () => {
    const table = fixture();
    const cell = cellAt(table, 0, 0);
    const withText = withCellTexts(table, [[cell.id, "复制"]]);
    const duplicated = duplicateElements({
      type: "everything",
      elements: [withText],
    }).duplicatedElements;
    const copy = duplicated.find(isTableElement)!;
    expect(copy.id).not.toBe(table.id);
    const copiedCellId = copy.table.cells[0].id;
    expect(copiedCellId).not.toBe(cell.id);
    expect(getTextBlock(copy.texts, cellKey(copiedCellId))?.text).toBe("复制");
    // 源表格不受影响
    expect(getTextBlock(withText.texts, cellKey(cell.id))?.text).toBe("复制");
  });
});
