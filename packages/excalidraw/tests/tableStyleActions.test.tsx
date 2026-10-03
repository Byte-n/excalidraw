import React from "react";

import {
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_PICKS,
} from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, fireEvent, render, unmountComponent } from "./test-utils";

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
    const swatch = document.querySelector<HTMLButtonElement>(
      `.table-style-actions [data-testid='color-top-pick-${fill}']`,
    )!;
    fireEvent.click(swatch);
    expect(swatch).toHaveClass("active");
    expect(
      (
        window.h.elements.find(
          (element) => element.id === table.id,
        ) as typeof table
      ).table.cells[0].style.backgroundColor,
    ).toBe(fill);
  });
});
