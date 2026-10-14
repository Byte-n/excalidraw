import React from "react";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import {
  act,
  fireEvent,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

unmountComponent();

// radix popover 需要 ResizeObserver（jsdom 没有，同 test-utils 的 togglePopover）
const stubResizeObserver = () => {
  (global as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
};

// 表格整体浮动栏：边框颜色 / 网格线颜色 / 背景颜色三个独立色板外露，
// 其余分组（边框宽度/样式、透明度、表头、标题对齐）进「样式」弹层
const queryFillPanel = () => document.querySelector(".table-style-actions")!;

const openStylesPopup = () => {
  stubResizeObserver();
  fireEvent.click(
    document.querySelector<HTMLButtonElement>(
      ".selected-shape-actions [aria-label='Styles']",
    )!,
  );
};

const applyHexViaOpenPicker = (label: string, hex: string) => {
  stubResizeObserver();
  fireEvent.click(
    document.querySelector<HTMLButtonElement>(
      `.table-style-actions [aria-label='${label}']`,
    )!,
  );
  fireEvent.change(document.querySelector(".color-picker-input")!, {
    target: { value: hex },
  });
};

describe("table style controls", () => {
  it("shows border/grid/background swatches and applies a fill without a clear-fill command", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    const panel = queryFillPanel();
    expect(panel).not.toBeNull();
    // 边框颜色与网格线颜色为两个独立色板，背景色板其后
    expect(
      Array.from(panel.querySelectorAll(":scope > .compact-action-item")).map(
        (item) =>
          item.querySelector(".properties-trigger")?.getAttribute("aria-label"),
      ),
    ).toEqual(["Border color", "Grid line color", "Background"]);
    expect(panel.querySelector("[title='Clear fill override']")).toBeNull();

    applyHexViaOpenPicker("Background", "ffec99");
    expect(
      (
        window.h.elements.find((element) => element.id === table.id) as
          | typeof table
          | undefined
      )?.table.style?.backgroundColor,
    ).toBe("#ffec99");
  });

  it("uses separate stroke and background controls on tablets", async () => {
    (global as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    await render(<Excalidraw UIOptions={{ getFormFactor: () => "tablet" }} />);
    fireEvent.resize(window);
    await waitFor(() =>
      expect(window.h.app.editorInterface.formFactor).toBe("tablet"),
    );
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    // 平板与桌面共用同一场景矩阵渲染（浮动栏 + touch 放大）
    const panel = document.querySelector(
      ".tb-floatbar .table-style-actions--fill-only",
    )!;
    expect(
      Array.from(panel.querySelectorAll(":scope > .compact-action-item")).map(
        (item) =>
          item.querySelector(".properties-trigger")?.getAttribute("aria-label"),
      ),
    ).toEqual(["Border color", "Grid line color", "Background"]);
    expect(panel).toHaveClass("table-style-actions--fill-only");

    applyHexViaOpenPicker("Border color", "e03131");
    expect(
      (
        window.h.elements.find(
          (element) => element.id === table.id,
        ) as typeof table
      ).table.style?.borderColor,
    ).toBe("#e03131");

    applyHexViaOpenPicker("Background", "a5d8ff");
    expect(
      (
        window.h.elements.find(
          (element) => element.id === table.id,
        ) as typeof table
      ).table.style?.backgroundColor,
    ).toBe("#a5d8ff");
  });

  it("shows the shape background picker for selected cells on desktop", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({
        tableCellSelection: {
          tableId: table.id,
          anchorId: table.table.cells[0].id,
          focusId: table.table.cells[0].id,
          mobileMode: false,
        },
      });
    });

    const panel = document.querySelector(
      ".selected-shape-actions .table-style-actions",
    )!;
    expect(
      panel.querySelector(".properties-trigger")?.getAttribute("aria-label"),
    ).toBe("Background");
    expect(
      document.querySelector("[data-testid='table-cell-multi-select']"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid='table-merge-cells']"),
    ).not.toBeNull();
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        "[data-testid='table-cell-multi-select']",
      )!,
    );
    expect(window.h.state.tableCellSelection?.mobileMode).toBe(true);

    // 打开单元格背景色弹层并取色
    fireEvent.click(
      panel.querySelector<HTMLButtonElement>(`[aria-label='Background']`)!,
    );
    fireEvent.change(document.querySelector(".color-picker-input")!, {
      target: { value: "d3f9d8" },
    });
    expect(
      (
        window.h.elements.find(
          (element) => element.id === table.id,
        ) as typeof table
      ).table.cells[0].style.backgroundColor,
    ).toBe("#d3f9d8");
  });

  it("keeps the selected-cell color picker compact on tablets", async () => {
    (global as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    await render(<Excalidraw UIOptions={{ getFormFactor: () => "tablet" }} />);
    fireEvent.resize(window);
    await waitFor(() =>
      expect(window.h.app.editorInterface.formFactor).toBe("tablet"),
    );
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({
        tableCellSelection: {
          tableId: table.id,
          anchorId: table.table.cells[0].id,
          focusId: table.table.cells[0].id,
          mobileMode: false,
        },
      });
    });

    const panel = document.querySelector(
      ".tb-floatbar .table-style-actions--fill-only",
    )!;
    expect(
      panel.querySelectorAll(":scope > .compact-action-item"),
    ).toHaveLength(1);
    expect(
      panel.querySelector(".properties-trigger")?.getAttribute("aria-label"),
    ).toBe("Background");
  });

  it("keeps the border and grid colors independent, transparent included", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    const getStyle = () =>
      (
        window.h.elements.find((element) => element.id === table.id) as
          | typeof table
          | undefined
      )?.table.style;

    applyHexViaOpenPicker("Border color", "e03131");
    expect(getStyle()?.borderColor).toBe("#e03131");
    expect(getStyle()?.gridColor).toBeUndefined();

    // a transparent grid leaves the border alone
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        ".table-style-actions [aria-label='Grid line color']",
      )!,
    );
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        "[data-testid='color-transparent']",
      )!,
    );
    expect(getStyle()?.gridColor).toBe("transparent");
    expect(getStyle()?.borderColor).toBe("#e03131");
    expect(
      document.querySelector(".selected-shape-actions")!.textContent,
    ).not.toContain("Grid width");
    expect(
      document.querySelector(".selected-shape-actions")!.textContent,
    ).not.toContain("Grid style");
  });

  it("applies a transparent background from the picker", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        ".table-style-actions [aria-label='Background']",
      )!,
    );
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        "[data-testid='color-transparent']",
      )!,
    );
    expect(
      (
        window.h.elements.find((element) => element.id === table.id) as
          | typeof table
          | undefined
      )?.table.style?.backgroundColor,
    ).toBe("transparent");
  });

  it("updates table controls and the selected cell fill", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    // 边框宽度/样式在「样式」弹层
    openStylesPopup();
    const stylesPopup = document.querySelector(
      ".properties-content .selected-shape-actions",
    )!;
    const borderWidth = stylesPopup.querySelector<HTMLInputElement>(
      'input[type="range"]',
    )!;
    fireEvent.change(borderWidth, { target: { value: "4" } });
    expect(borderWidth.value).toBe("4");

    const dashed = stylesPopup.querySelector<HTMLInputElement>(
      'input[name="table-border-style"]:checked',
    )!;
    fireEvent.click(dashed.parentElement!.nextElementSibling!);
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="table-border-style"]:checked',
      )?.parentElement,
    ).toHaveAttribute("title", "Dashed");

    const cell = table.table.cells[0];
    act(() => {
      API.setAppState({
        tableCellSelection: {
          tableId: table.id,
          anchorId: cell.id,
          focusId: cell.id,
          mobileMode: false,
        },
      });
    });
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        ".table-style-actions [aria-label='Background']",
      )!,
    );
    fireEvent.change(document.querySelector(".color-picker-input")!, {
      target: { value: "d3f9d8" },
    });
    expect(
      (
        window.h.elements.find(
          (element) => element.id === table.id,
        ) as typeof table
      ).table.cells[0].style.backgroundColor,
    ).toBe("#d3f9d8");
  });

  it("toggles the first-row header from the table style popup", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    openStylesPopup();
    const popup = document.querySelector(".properties-content")!;
    const toggle = popup.querySelector<HTMLButtonElement>('[role="checkbox"]');
    expect(toggle).not.toBeNull();
    expect(popup.textContent).toContain("Header row");
    // header defaults to on
    expect(toggle).toHaveAttribute("aria-checked", "true");

    const getStyle = () =>
      (
        window.h.elements.find((element) => element.id === table.id) as
          | typeof table
          | undefined
      )?.table.style;

    fireEvent.click(toggle!);
    expect(getStyle()?.header).toBe(false);

    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[role="checkbox"]')!,
    );
    expect(getStyle()?.header).toBe(true);
  });

  it("sets the table title alignment from the table style popup", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    openStylesPopup();
    const popup = document.querySelector(".properties-content")!;
    expect(popup.textContent).toContain("Title align");
    // start (left) is the default alignment
    expect(
      popup.querySelector<HTMLInputElement>(
        'input[name="table-title-align"]:checked',
      )?.parentElement,
    ).toHaveAttribute("title", "Left");

    const getStyle = () =>
      (
        window.h.elements.find((element) => element.id === table.id) as
          | typeof table
          | undefined
      )?.table.style;

    // the align patch must merge into the existing style, not replace it
    fireEvent.click(
      popup.querySelector<HTMLButtonElement>('[role="checkbox"]')!,
    );
    expect(getStyle()?.header).toBe(false);

    fireEvent.click(
      document.querySelector<HTMLInputElement>(
        '[data-testid="table-title-align-center"]',
      )!.parentElement!,
    );
    expect(getStyle()?.title?.align).toBe("center");
    expect(getStyle()?.header).toBe(false);

    fireEvent.click(
      document.querySelector<HTMLInputElement>(
        '[data-testid="table-title-align-end"]',
      )!.parentElement!,
    );
    expect(getStyle()?.title?.align).toBe("end");

    fireEvent.click(
      document.querySelector<HTMLInputElement>(
        '[data-testid="table-title-align-start"]',
      )!.parentElement!,
    );
    expect(getStyle()?.title?.align).toBe("start");
  });
});
