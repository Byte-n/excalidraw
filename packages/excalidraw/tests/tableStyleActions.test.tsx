import React from "react";

import {
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_PICKS,
} from "@excalidraw/common";

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

describe("table style controls", () => {
  it("shows styles directly and applies a fill without a clear-fill command", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    const panel = document.querySelector(".table-style-actions");
    expect(panel).not.toBeNull();
    expect(
      Array.from(panel!.querySelectorAll(":scope > div > h3")).map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Stroke", "Background"]);
    expect(
      Array.from(panel!.querySelectorAll(":scope > div > h3")).every(
        (heading) =>
          heading.nextElementSibling?.matches(".color-picker-container"),
      ),
    ).toBe(true);
    expect(panel!.querySelector("[title='Clear fill override']")).toBeNull();
    expect(panel!.textContent).toContain("Border width");

    const fill = DEFAULT_ELEMENT_BACKGROUND_PICKS[1];
    const swatch = panel!.querySelector<HTMLButtonElement>(
      `[data-testid='color-top-pick-${fill}']`,
    );
    expect(swatch).not.toBeNull();
    fireEvent.click(swatch!);
    expect(swatch).toHaveClass("active");
    expect(
      (
        window.h.elements.find((element) => element.id === table.id) as
          | typeof table
          | undefined
      )?.table.style?.backgroundColor,
    ).toBe(fill);
  });

  it("uses separate stroke and background controls in the compact toolbar", async () => {
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

    const panel = document.querySelector(
      ".compact-shape-actions .table-style-actions--fill-only",
    )!;
    expect(
      Array.from(panel.querySelectorAll(":scope > .compact-action-item")).map(
        (item) =>
          item.querySelector(".properties-trigger")?.getAttribute("aria-label"),
      ),
    ).toEqual(["Stroke", "Background"]);

    fireEvent.click(
      panel.querySelector<HTMLButtonElement>(`[aria-label='Stroke']`)!,
    );
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("[data-testid='color-red']")!,
    );
    expect(
      (
        window.h.elements.find(
          (element) => element.id === table.id,
        ) as typeof table
      ).table.style?.borderColor,
    ).toBe(DEFAULT_ELEMENT_STROKE_PICKS[1]);

    fireEvent.click(
      panel.querySelector<HTMLButtonElement>(`[aria-label='Background']`)!,
    );
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("[data-testid='color-red']")!,
    );
    expect(
      (
        window.h.elements.find(
          (element) => element.id === table.id,
        ) as typeof table
      ).table.style?.backgroundColor,
    ).toBe(DEFAULT_ELEMENT_BACKGROUND_PICKS[1]);
  });

  it("shows the full shape background picker for selected cells on desktop", async () => {
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
      Array.from(panel.querySelectorAll(":scope > div > h3")).map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Background"]);
    expect(panel.querySelector(".color-picker__top-picks")).not.toBeNull();
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
    fireEvent.click(
      panel.querySelector<HTMLButtonElement>(
        `[data-testid='color-top-pick-${DEFAULT_ELEMENT_BACKGROUND_PICKS[1]}']`,
      )!,
    );
    expect(
      (
        window.h.elements.find(
          (element) => element.id === table.id,
        ) as typeof table
      ).table.cells[0].style.backgroundColor,
    ).toBe(DEFAULT_ELEMENT_BACKGROUND_PICKS[1]);
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
      ".compact-shape-actions .table-style-actions--fill-only",
    )!;
    expect(panel.querySelector(".color-picker__top-picks")).toBeNull();
    expect(
      panel.querySelectorAll(":scope > .compact-action-item"),
    ).toHaveLength(1);
    expect(
      panel.querySelector(".properties-trigger")?.getAttribute("aria-label"),
    ).toBe("Background");
  });

  it("uses one border color for the frame and grid", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    const panel = document.querySelector(".table-style-actions")!;
    const border = DEFAULT_ELEMENT_STROKE_PICKS[1];
    fireEvent.click(
      panel.querySelector<HTMLButtonElement>(
        `[data-testid='color-top-pick-${border}']`,
      )!,
    );

    const style = (
      window.h.elements.find((element) => element.id === table.id) as
        | typeof table
        | undefined
    )?.table.style;
    expect(style?.borderColor).toBe(border);
    expect(style?.gridColor).toBe(border);
    expect(
      panel.querySelector(`[data-testid='color-top-pick-${border}']`),
    ).toHaveClass("active");
    expect(
      Array.from(panel.querySelectorAll(".table-style-actions__target")).map(
        (button) => button.textContent,
      ),
    ).not.toContain("Grid");
    expect(panel.textContent).not.toContain("Grid width");
    expect(panel.textContent).not.toContain("Grid style");
  });

  it("updates table controls and the selected cell fill", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    const panel = document.querySelector(".table-style-actions")!;
    const borderWidth = panel.querySelector<HTMLInputElement>(
      'input[type="range"]',
    )!;
    fireEvent.change(borderWidth, { target: { value: "4" } });
    expect(borderWidth.value).toBe("4");

    const dashed = panel.querySelector<HTMLInputElement>(
      'input[name="table-border-style"]:checked',
    )!;
    fireEvent.click(dashed.parentElement!.nextElementSibling!);
    expect(
      panel.querySelector<HTMLInputElement>(
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
    const fill = DEFAULT_ELEMENT_BACKGROUND_PICKS[2];
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        ".table-style-actions [aria-label='Background']",
      )!,
    );
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("[data-testid='color-green']")!,
    );
    expect(
      (
        window.h.elements.find(
          (element) => element.id === table.id,
        ) as typeof table
      ).table.cells[0].style.backgroundColor,
    ).toBe(fill);
  });
});
