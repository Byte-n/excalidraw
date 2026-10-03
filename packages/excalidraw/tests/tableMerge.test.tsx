import { act } from "react-dom/test-utils";

import type {
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import {
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
} from "./test-utils";

unmountComponent();

const { h } = window;

describe("table cell merge", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  it("joins background text and remaps members in one scene operation", () => {
    const table = API.createElement({
      type: "table",
      x: 100,
      y: 100,
      rowCount: 2,
      columnCount: 2,
    });
    const firstId = table.table.cells[0].id;
    const secondId = table.table.cells[1].id;
    const first = API.createElement({
      type: "text",
      x: 100,
      y: 100,
      width: 160,
      height: 56,
      text: "first",
      originalText: "first",
      autoResize: false,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: firstId,
        role: "backgroundText",
      },
    } as any);
    const second = API.createElement({
      type: "text",
      x: 260,
      y: 100,
      width: 160,
      height: 56,
      text: "second",
      originalText: "second",
      autoResize: false,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: secondId,
        role: "backgroundText",
      },
    } as any);
    const shape = API.createElement({
      type: "rectangle",
      x: 275,
      y: 115,
      width: 30,
      height: 30,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: secondId,
        role: "content",
      },
    });
    API.setElements([table, first, second, shape]);
    act(() =>
      h.app.setState({
        tableCellSelection: {
          tableId: table.id,
          anchorId: firstId,
          focusId: secondId,
          mobileMode: false,
        },
      }),
    );
    act(() => expect(h.app.commitTableCellMerge()).toBe(true));
    const current = h.elements.find(
      (element): element is ExcalidrawTableElement => element.id === table.id,
    )!;
    expect(
      current.table.cells.find((cell) => cell.id === secondId)?.mergedInto,
    ).toBe(firstId);
    expect(
      (
        h.elements.find(
          (element) => element.id === first.id,
        ) as ExcalidrawTextElement
      ).originalText,
    ).toBe("first\nsecond");
    expect(
      h.elements.find((element) => element.id === second.id)?.isDeleted,
    ).toBe(true);
    expect(
      h.elements.find((element) => element.id === shape.id)?.containerRef,
    ).toMatchObject({ cellId: firstId });
    expect(h.app.commitTableCellSplit()).toBe(true);
    expect(
      h.elements.find((element) => element.id === shape.id)?.containerRef,
    ).toMatchObject({ cellId: firstId });
    const splitText = h.elements.find(
      (element) => element.id === first.id,
    ) as ExcalidrawTextElement;
    expect(splitText.width).toBe(160);
    expect(splitText.x).toBe(100);
    expect(splitText.originalText).toBe("first\nsecond");
  });

  it("keeps a shift-click range within one table", () => {
    const table = API.createElement({
      type: "table",
      x: 100,
      y: 100,
      rowCount: 2,
      columnCount: 2,
    });
    API.setElements([table]);
    expect(h.state.activeTool.type).toBe("selection");
    fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
      clientX: 180,
      clientY: 128,
      pointerType: "mouse",
    });
    expect(h.state.tableCellSelection?.anchorId).toBe(table.table.cells[0].id);
    fireEvent.pointerUp(GlobalTestState.interactiveCanvas, {
      clientX: 180,
      clientY: 128,
      pointerType: "mouse",
    });
    expect(h.state.tableCellSelection?.anchorId).toBe(table.table.cells[0].id);
    fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
      clientX: 340,
      clientY: 184,
      pointerType: "mouse",
      shiftKey: true,
    });
    expect(h.state.tableCellSelection).toMatchObject({
      tableId: table.id,
      anchorId: table.table.cells[0].id,
      focusId: table.table.cells[3].id,
    });
  });

  it("explains why a single ordinary cell cannot merge or split", () => {
    const table = API.createElement({
      type: "table",
      rowCount: 2,
      columnCount: 2,
    });
    API.setElements([table]);
    act(() =>
      h.app.setState({
        tableCellSelection: {
          tableId: table.id,
          anchorId: table.table.cells[0].id,
          focusId: table.table.cells[0].id,
          mobileMode: false,
        },
      }),
    );
    act(() => expect(h.app.commitTableCellMerge()).toBe(false));
    expect(h.state.toast?.message).toBe(
      "Select at least two visible cells to merge",
    );
    act(() => expect(h.app.commitTableCellSplit()).toBe(false));
    expect(h.state.toast?.message).toBe("Select a merged cell to split");
    expect(
      (
        h.elements.find(
          (element) => element.id === table.id,
        ) as ExcalidrawTableElement
      ).table,
    ).toEqual(table.table);
  });

  it("shows two cell action icons and switches between merge and split", () => {
    const table = API.createElement({
      type: "table",
      rowCount: 2,
      columnCount: 2,
    });
    API.setElements([table]);
    act(() =>
      h.app.setState({
        tableCellSelection: {
          tableId: table.id,
          anchorId: table.table.cells[0].id,
          focusId: table.table.cells[0].id,
          mobileMode: false,
        },
      }),
    );
    const merge = h.app.ownerDocument.querySelector<HTMLButtonElement>(
      ".compact-shape-actions [data-testid='table-merge-cells']",
    );
    const multiSelect = h.app.ownerDocument.querySelector<HTMLButtonElement>(
      ".compact-shape-actions [data-testid='table-cell-multi-select']",
    );
    expect(multiSelect?.getAttribute("aria-pressed")).toBe("false");
    expect(multiSelect?.querySelector("svg")).not.toBeNull();
    expect(merge?.querySelector("svg")).not.toBeNull();
    expect(merge?.disabled).toBe(true);
    expect(merge?.title).toContain("Select at least two visible cells");
    expect(
      h.app.ownerDocument.querySelector<HTMLButtonElement>(
        ".compact-shape-actions [data-testid='table-split-cells']",
      ),
    ).toBeNull();
    act(() => fireEvent.click(multiSelect!));
    expect(multiSelect?.getAttribute("aria-pressed")).toBe("true");
    act(() => fireEvent.click(multiSelect!));
    expect(multiSelect?.getAttribute("aria-pressed")).toBe("false");
    expect(
      h.app.ownerDocument.querySelector(".mobile-table-cell-actions"),
    ).toBeNull();
    act(() =>
      h.app.setState({
        tableCellSelection: {
          tableId: table.id,
          anchorId: table.table.cells[0].id,
          focusId: table.table.cells[1].id,
          mobileMode: false,
        },
      }),
    );
    const enabledMerge = h.app.ownerDocument.querySelector<HTMLButtonElement>(
      ".compact-shape-actions [data-testid='table-merge-cells']",
    );
    expect(enabledMerge?.disabled).toBe(false);
    act(() => fireEvent.click(enabledMerge!));
    const split = h.app.ownerDocument.querySelector<HTMLButtonElement>(
      ".compact-shape-actions [data-testid='table-split-cells']",
    );
    expect(split?.disabled).toBe(false);
    expect(split?.classList.contains("active")).toBe(true);
    expect(split?.querySelector("path")?.getAttribute("d")).toBe(
      merge?.querySelector("path")?.getAttribute("d"),
    );
    expect(split?.getAttribute("aria-label")).toBe("Split cells");
    expect(
      h.app.ownerDocument.querySelector<HTMLButtonElement>(
        ".compact-shape-actions [data-testid='table-merge-cells']",
      ),
    ).toBeNull();
  });
});
