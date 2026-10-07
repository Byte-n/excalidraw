import React from "react";
import { describe, expect, it } from "vitest";
import { applyTableOperation } from "@excalidraw/element/tableScene";
import {
  newTableElement,
  newTextElement,
} from "@excalidraw/element/newElement";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { act, render, unmountComponent } from "../tests/test-utils";

unmountComponent();

const semantics = (elements: readonly ExcalidrawElement[]) =>
  elements.map((element) => {
    const { version, versionNonce, updated, index, ...value } = element;
    return value;
  });

describe("editor 和 headless 表格候选一致", () => {
  it("合并和拆分复用同一文字成员迁移与布局，editor 单独生成版本", async () => {
    await render(<Excalidraw />);
    const table = newTableElement({
      type: "table",
      x: 100,
      y: 100,
      rowCount: 2,
      columnCount: 2,
    });
    const firstId = table.table.cells[0].id;
    const lastId = table.table.cells[1].id;
    const first = newTextElement({
      x: 100,
      y: 100,
      text: "第一格",
      autoResize: false,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: firstId,
        role: "backgroundText",
      },
    });
    const second = newTextElement({
      x: 260,
      y: 100,
      text: "第二格",
      autoResize: false,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: lastId,
        role: "backgroundText",
      },
    });
    API.setElements([table, first, second]);
    const input = structuredClone(window.h.elements);
    const candidate = applyTableOperation(input, {
      action: "mergeCells",
      target: { tableId: table.id },
      firstCellId: firstId,
      lastCellId: lastId,
    });
    act(() => {
      window.h.app.setState({
        tableCellSelection: {
          tableId: table.id,
          anchorId: firstId,
          focusId: lastId,
          mobileMode: false,
        },
      });
    });
    act(() => {
      expect(window.h.app.commitTableCellMerge()).toBe(true);
    });
    expect(semantics(window.h.elements)).toEqual(semantics(candidate.elements));
    const originalTable = input.find((element) => element.id === table.id)!;
    expect(
      window.h.elements.find((element) => element.id === table.id)?.version,
    ).toBe(originalTable.version + 1);
    expect(
      candidate.elements.find((element) => element.id === table.id)?.version,
    ).toBe(originalTable.version);
    const split = applyTableOperation(window.h.elements, {
      action: "splitCell",
      target: { tableId: table.id },
      cellId: firstId,
    });
    act(() => {
      expect(window.h.app.commitTableCellSplit()).toBe(true);
    });
    expect(semantics(window.h.elements)).toEqual(semantics(split.elements));
  });

  it("editor 删除行与 headless 使用同一完整墓碑和平移候选", async () => {
    await render(<Excalidraw />);
    const table = newTableElement({
      type: "table",
      x: 100,
      y: 100,
      rowCount: 2,
      columnCount: 1,
    });
    const first = newTextElement({
      x: 110,
      y: 110,
      text: "删除",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[0].id,
        role: "backgroundText",
      },
    });
    const second = newTextElement({
      x: 110,
      y: 166,
      text: "保留",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[1].id,
        role: "backgroundText",
      },
    });
    API.setElements([table, first, second]);
    const candidate = applyTableOperation(window.h.elements, {
      action: "deleteRow",
      target: { tableId: table.id },
      rowId: table.table.rows[0].id,
    });
    act(() => {
      window.h.app.setState({
        tableRowColSelection: {
          kind: "row",
          tableId: table.id,
          id: table.table.rows[0].id,
        },
      });
    });
    act(() => {
      expect(window.h.app.deleteSelectedTableRowCol()).toBe(true);
    });
    expect(semantics(window.h.elements)).toEqual(semantics(candidate.elements));
    expect(window.h.state.tableRowColSelection).toBeNull();
  });
});
