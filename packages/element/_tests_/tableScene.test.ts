import { pointFrom } from "@excalidraw/math";

import { describe, expect, it, vi } from "vitest";

import type { LocalPoint } from "@excalidraw/math";

import {
  newArrowElement,
  newElement,
  newTableElement,
  newTextElement,
} from "../src/newElement";
import { applyTableOperation, getTableSceneTitle } from "../src/tableScene";
import { CanvasSceneError } from "../src/sceneOperations";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";
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
const background = (
  table: ExcalidrawTableElement,
  cellId: string,
  text: string,
) =>
  newTextElement({
    x: table.x,
    y: table.y,
    text,
    textAlign: "center",
    verticalAlign: "middle",
    autoResize: false,
    containerRef: {
      kind: "tableCell",
      elementId: table.id,
      cellId,
      role: "backgroundText",
    },
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
  it("重复标题和背景文字按显示投影的稳定身份选择，合并不拼接隐藏文字", () => {
    const table = fixture();
    const first = cellAt(table, 0, 0);
    const second = cellAt(table, 0, 1);
    const hidden = {
      ...background(table, first.id, "隐藏"),
      id: "z-background",
    };
    const visible = {
      ...background(table, first.id, "可见"),
      id: "a-background",
    };
    const next = background(table, second.id, "下一格");
    const title = newTextElement({
      x: 100,
      y: 50,
      text: "标题",
      containerRef: { kind: "tableTitle", elementId: table.id },
    });
    expect(
      getTableSceneTitle(
        [
          { ...title, id: "z-title" },
          { ...title, id: "a-title" },
        ],
        table.id,
      )?.id,
    ).toBe("a-title");
    const result = applyTableOperation([table, hidden, visible, next], {
      action: "mergeCells",
      target: { tableId: table.id },
      firstCellId: first.id,
      lastCellId: second.id,
    });
    expect(
      result.elements.find((element) => element.id === visible.id),
    ).toMatchObject({ originalText: "可见\n下一格", isDeleted: false });
    expect(
      result.elements.find((element) => element.id === hidden.id)?.isDeleted,
    ).toBe(true);
  });

  it("创建真实标题和稳定行列格子引用，不依赖 DOM", () => {
    vi.stubGlobal("document", undefined);
    try {
      const result = applyTableOperation([], {
        action: "create",
        position: { x: 10, y: 100 },
        rowCount: 2,
        columnCount: 3,
        title: "标题",
        style: { backgroundColor: "#fff", title: { align: "end", gap: 7 } },
      });
      expect(result.createdElementIds).toHaveLength(2);
      expect(result.references.domain).toBe("table");
      if (result.references.domain !== "table") {
        throw new Error("表格引用缺失");
      }
      const table = tableIn(result.elements, result.references.tableId);
      expect(table.width).toBe(480);
      expect(table.height).toBe(112);
      expect(result.references.rows).toHaveLength(2);
      expect(result.references.columns).toHaveLength(3);
      expect(result.references.cells).toHaveLength(6);
      const title = getTableSceneTitle(result.elements, table.id)!;
      expect(title.containerRef).toEqual({
        kind: "tableTitle",
        elementId: table.id,
      });
      expect(title.x).toBe(table.x + table.width - title.width);
      expect(title.y).toBe(table.y - title.height - 7);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("合并按行优先拼接文字，迁移正文成员并保留既有身份元数据", () => {
    const table = fixture();
    const first = cellAt(table, 0, 0);
    const last = cellAt(table, 1, 1);
    const texts = [
      background(table, first.id, "左上"),
      background(table, cellAt(table, 0, 1).id, "右上"),
      background(table, cellAt(table, 1, 0).id, "左下"),
      background(table, last.id, "右下"),
    ];
    const member = newElement({
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
    });
    const label = newTextElement({
      x: 275,
      y: 175,
      text: "成员标签",
      containerId: member.id,
    });
    const input = [
      table,
      ...texts,
      { ...member, boundElements: [{ id: label.id, type: "text" as const }] },
      label,
    ];
    const before = structuredClone(input);
    const result = applyTableOperation(input, {
      action: "mergeCells",
      target: { tableId: table.id },
      firstCellId: first.id,
      lastCellId: last.id,
    });
    expect(input).toEqual(before);
    expect(
      result.elements.find((element) => element.id === texts[0].id),
    ).toMatchObject({
      originalText: "左上\n右上\n左下\n右下",
      version: texts[0].version,
      versionNonce: texts[0].versionNonce,
      updated: texts[0].updated,
      created: texts[0].created,
      index: texts[0].index,
    });
    expect(result.deletedElementIds).toEqual(
      texts.slice(1).map((text) => text.id),
    );
    expect(
      result.elements.find((element) => element.id === member.id)?.containerRef,
    ).toMatchObject({ cellId: first.id });
    expect(result.elements.find((element) => element.id === label.id)).toEqual(
      label,
    );
    const merged = tableIn(result.elements, table.id);
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
    expect(
      split.elements.find((element) => element.id === texts[0].id),
    ).toMatchObject({ originalText: "左上\n右上\n左下\n右下" });
  });

  it("covered cell 的文字和样式指向同一真实 anchor，清空不替换正文成员", () => {
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
    const text = changed.elements.find((element) => element.type === "text")!;
    expect(text.containerRef).toMatchObject({
      cellId: first.id,
      role: "backgroundText",
    });
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
    expect(
      empty.elements.find((element) => element.id === text.id),
    ).toMatchObject({ originalText: "", isDeleted: false });
  });

  it("文字自动增长行高并平移后续行成员和绑定文字", () => {
    const table = fixture();
    const member = newElement({
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
    });
    const label = newTextElement({
      x: 110,
      y: 168,
      text: "标签",
      containerId: member.id,
    });
    const result = applyTableOperation(
      [
        table,
        { ...member, boundElements: [{ id: label.id, type: "text" }] },
        label,
      ],
      {
        action: "setCellText",
        target: { tableId: table.id },
        cellId: cellAt(table, 0, 0).id,
        text: "第一行\n第二行\n第三行\n第四行",
      },
    );
    const next = tableIn(result.elements, table.id);
    const growth = next.table.rows[0].height - table.table.rows[0].height;
    expect(growth).toBeGreaterThan(0);
    expect(result.elements.find((element) => element.id === member.id)?.y).toBe(
      member.y + growth,
    );
    expect(result.elements.find((element) => element.id === label.id)?.y).toBe(
      label.y + growth,
    );
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
    "%s 的存活合并 anchor 继承文字和正文",
    (action) => {
      const table = fixture();
      const anchor = cellAt(table, 0, 0);
      const covered = cellAt(table, 1, 1);
      const text = background(table, anchor.id, "保留");
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
      const merged = applyTableOperation([table, text, member], {
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
      const survivingAnchor = cellAt(tableIn(result.elements, table.id), 0, 0);
      expect(
        result.elements.find((element) => element.id === text.id),
      ).toMatchObject({
        isDeleted: false,
        originalText: "保留",
        containerRef: { cellId: survivingAnchor.id },
      });
      expect(
        result.elements.find((element) => element.id === member.id),
      ).toMatchObject({
        isDeleted: false,
        containerRef: { cellId: survivingAnchor.id },
      });
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
    const child = background(nested, nested.table.cells[0].id, "嵌套");
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
        fixedPoint: [0.5, 0.5],
        mode: "orbit" as const,
      },
    };
    const result = applyTableOperation(
      [table, nested, child, survivor, arrow],
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

  it("标题更新保持真实文字 ID，样式叶子 null 恢复继承布局且不清除省略字段", () => {
    const created = applyTableOperation([], {
      action: "create",
      position: { x: 100, y: 100 },
      rowCount: 1,
      columnCount: 1,
      title: "旧标题",
      style: {
        borderColor: "red",
        opacity: 60,
        title: { align: "end", gap: 10 },
      },
    });
    const table = created.elements.find(isTableElement)!;
    const title = getTableSceneTitle(created.elements, table.id)!;
    const renamed = applyTableOperation(created.elements, {
      action: "setTitle",
      target: { tableId: table.id },
      text: "更长的新标题",
    });
    expect(getTableSceneTitle(renamed.elements, table.id)?.id).toBe(title.id);
    const cleared = applyTableOperation(renamed.elements, {
      action: "setStyle",
      target: { tableId: table.id },
      style: { borderColor: null, title: { align: null, gap: null } },
    });
    expect(tableIn(cleared.elements, table.id).table.style).toEqual({
      opacity: 60,
      title: {},
    });
    const nextTitle = getTableSceneTitle(cleared.elements, table.id)!;
    expect(nextTitle.x).toBe(table.x);
    expect(nextTitle.y).toBe(table.y - nextTitle.height - 2);
    expect(nextTitle.version).toBe(title.version);
    const empty = applyTableOperation(cleared.elements, {
      action: "setTitle",
      target: { tableId: table.id },
      text: "",
    });
    expect(getTableSceneTitle(empty.elements, table.id)).toMatchObject({
      id: title.id,
      originalText: "",
      isDeleted: false,
    });
  });

  it("整表删除包含标题、正文子树与绑定文字并保留输入墓碑", () => {
    const created = applyTableOperation([], {
      action: "create",
      position: { x: 0, y: 50 },
      rowCount: 1,
      columnCount: 1,
      title: "删除标题",
    });
    const table = created.elements.find(isTableElement)!;
    const member = newElement({
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
    });
    const label = newTextElement({
      x: 10,
      y: 60,
      text: "标签",
      containerId: member.id,
    });
    const tombstone = {
      ...newElement({ type: "rectangle", x: 0, y: 0, width: 1, height: 1 }),
      isDeleted: true,
    };
    const result = applyTableOperation(
      [
        ...created.elements,
        { ...member, boundElements: [{ id: label.id, type: "text" }] },
        label,
        tombstone,
      ],
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
});
