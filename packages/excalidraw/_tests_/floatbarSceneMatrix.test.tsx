import React from "react";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, fireEvent, render } from "./test-utils";

const { h } = window;

// radix 弹层需要 ResizeObserver（jsdom 没有，同 test-utils 的 togglePopover）
const stubResizeObserver = () => {
  (global as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
};

const queryFloatbar = () => document.querySelector(".tb-floatbar");

const openStylesPopup = () => {
  stubResizeObserver();
  fireEvent.click(
    document.querySelector<HTMLButtonElement>(
      ".tb-floatbar [aria-label='Styles']",
    )!,
  );
};

describe("浮动栏场景矩阵（T3）", () => {
  it("单个矩形：色板外露 + 样式/图层/更多 + 链接", async () => {
    await render(<Excalidraw />);
    const rect = API.createElement({
      type: "rectangle",
      backgroundColor: "#e6f4f1",
    });
    API.setElements([rect]);
    act(() => {
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });

    const bar = queryFloatbar()!;
    expect(bar).not.toBeNull();

    // 分组 DOM 统一 fieldset>legend，无 h3 分组标题
    expect(bar.querySelectorAll("h3").length).toBe(0);

    // 外露色板：描边 + 背景
    expect(bar.querySelector("[aria-label='Stroke']")).not.toBeNull();
    expect(bar.querySelector("[aria-label='Background']")).not.toBeNull();

    // 样式 / 图层 / 更多 触发器
    expect(bar.querySelector("[aria-label='Styles']")).not.toBeNull();
    expect(bar.querySelector("[aria-label='Layers']")).not.toBeNull();
    expect(
      bar.querySelector("[data-testid='toolbar-more-menu']"),
    ).not.toBeNull();
    // 单选操作组含「链接」（无链接时为「Add link」）
    expect(bar.querySelector("[aria-label='Add link']")).not.toBeNull();

    // 样式弹层 = 填充/描边宽度/描边样式/透明度，fieldset>legend 结构
    // （本仓库基础图形统一为复合形状：复合形状无边角组——场景矩阵「复合形状」行）
    openStylesPopup();
    const popup = document.querySelector(".properties-content")!;
    expect(popup.querySelectorAll("h3").length).toBe(0);
    const legends = Array.from(popup.querySelectorAll("fieldset > legend")).map(
      (legend) => legend.textContent,
    );
    expect(legends).toEqual([
      "Fill",
      "Stroke width",
      "Stroke style",
      "Opacity",
    ]);
  });

  it("多选不同描边色：描边色板显示 is-mix 多值态，取色后统一", async () => {
    await render(<Excalidraw />);
    const rectA = API.createElement({
      type: "rectangle",
      x: 0,
      strokeColor: "#e03131",
    });
    const rectB = API.createElement({
      type: "rectangle",
      x: 200,
      strokeColor: "#1971c2",
    });
    API.setElements([rectA, rectB]);
    act(() => {
      API.setAppState({
        selectedElementIds: { [rectA.id]: true, [rectB.id]: true },
      });
    });

    const strokeTrigger = queryFloatbar()!.querySelector(
      "[aria-label='Stroke']",
    )!;
    expect(strokeTrigger).toHaveClass("is-mix");

    // 取色后两元素同色且多值态消除
    stubResizeObserver();
    fireEvent.click(strokeTrigger);
    fireEvent.change(document.querySelector(".color-picker-input")!, {
      target: { value: "0e8c7e" },
    });
    expect(
      h.elements.every((element) => element.strokeColor === "#0e8c7e"),
    ).toBe(true);
    expect(
      queryFloatbar()!.querySelector("[aria-label='Stroke']"),
    ).not.toHaveClass("is-mix");
  });

  it("图片：无颜色组，含裁剪入口；样式弹层为边角/透明度", async () => {
    await render(<Excalidraw />);
    const image = API.createElement({
      type: "image",
      fileId: "scene-matrix-image" as any,
    });
    API.setElements([image]);
    act(() => {
      API.setAppState({ selectedElementIds: { [image.id]: true } });
    });

    const bar = queryFloatbar()!;
    expect(bar.querySelector("[aria-label='Stroke']")).toBeNull();
    expect(bar.querySelector("[aria-label='Background']")).toBeNull();
    // 裁剪入口在浮动栏操作区
    expect(bar.querySelector("[aria-label='Crop image']")).not.toBeNull();

    openStylesPopup();
    const popup = document.querySelector(".properties-content")!;
    const legends = Array.from(popup.querySelectorAll("fieldset > legend")).map(
      (legend) => legend.textContent,
    );
    expect(legends).toEqual(["Edges", "Opacity"]);
  });

  it("便签（zh-CN）：外露色板为「文字颜色」+「纸色」", async () => {
    await render(<Excalidraw langCode="zh-CN" />);
    const note = API.createElement({ type: "stickynote" });
    API.setElements([note]);
    act(() => {
      API.setAppState({ selectedElementIds: { [note.id]: true } });
    });

    const bar = queryFloatbar()!;
    expect(bar.querySelector("[aria-label='文字颜色']")).not.toBeNull();
    expect(bar.querySelector("[aria-label='纸色']")).not.toBeNull();
    expect(bar.querySelector("[aria-label='描边']")).toBeNull();
  });

  it("思维导图整树（选中根）：布局方向 + 默认连线触发器，无原生颜色/数字输入", async () => {
    await render(<Excalidraw />);
    API.setElements([
      API.createElement({
        type: "text",
        id: "root-text",
        text: "root",
        containerId: "root",
      }),
    ]);
    const root = API.createElement({
      type: "mindmap-node" as any,
      id: "root",
      x: 100,
      y: 100,
    });
    API.setElements([...h.elements, root]);

    act(() => {
      API.setAppState({
        selectedElementIds: { root: true, "root-text": true },
      });
    });

    const bar = queryFloatbar()!;
    expect(
      bar.querySelector("[data-testid='floatbar-group-mindmapGraphDirection']"),
    ).not.toBeNull();
    expect(
      bar.querySelector("[data-testid='floatbar-group-mindmapGraphEdge']"),
    ).not.toBeNull();

    // 默认连线弹层：颜色/宽度/线型/路径四子组，无原生输入
    stubResizeObserver();
    fireEvent.click(
      bar.querySelector<HTMLButtonElement>(
        "[data-testid='floatbar-group-mindmapGraphEdge']",
      )!,
    );
    const popup = document.querySelector(".properties-content")!;
    expect(popup.querySelectorAll("input[type='color']").length).toBe(0);
    expect(popup.querySelectorAll("input[type='number']").length).toBe(0);
    const legends = Array.from(popup.querySelectorAll("legend")).map(
      (legend) => legend.textContent,
    );
    expect(legends).toEqual([
      "Default edge",
      "Color",
      "Width",
      "Line style",
      "Routing",
    ]);
  });

  it("表格整体：边框颜色与网格线颜色两个独立色板，首行表头复选项在样式弹层", async () => {
    await render(<Excalidraw />);
    const table = API.createElement({ type: "table" });
    API.setElements([table]);
    act(() => {
      API.setAppState({ selectedElementIds: { [table.id]: true } });
    });

    const bar = queryFloatbar()!;
    expect(bar.querySelector("[aria-label='Border color']")).not.toBeNull();
    expect(bar.querySelector("[aria-label='Grid line color']")).not.toBeNull();
    expect(bar.querySelector("[aria-label='Background']")).not.toBeNull();

    openStylesPopup();
    const popup = document.querySelector(".properties-content")!;
    expect(popup.querySelector("[role='checkbox']")).not.toBeNull();
    expect(popup.textContent).toContain("Header row");
  });

  it("Frame：重命名入口聚焦画布标题", async () => {
    await render(<Excalidraw />);
    const frame = API.createElement({ type: "frame" });
    API.setElements([frame]);
    act(() => {
      API.setAppState({ selectedElementIds: { [frame.id]: true } });
    });

    const bar = queryFloatbar()!;
    fireEvent.click(
      bar.querySelector<HTMLButtonElement>("[data-testid='frame-rename']")!,
    );
    expect(h.state.editingFrame).toBe(frame.id);
  });

  it("Frame：外露背景色板（画板填充可设），样式弹层只剩透明度", async () => {
    await render(<Excalidraw />);
    const frame = API.createElement({
      type: "frame",
      backgroundColor: "transparent",
    });
    API.setElements([frame]);
    act(() => {
      API.setAppState({ selectedElementIds: { [frame.id]: true } });
    });

    const bar = queryFloatbar()!;
    // 画板底色是元素属性（默认透明），因此背景色板外露
    expect(bar.querySelector("[aria-label='Background']")).not.toBeNull();
    // 但边框是固定的 1px 浅灰 chrome，不是可调描边
    expect(bar.querySelector("[aria-label='Stroke']")).toBeNull();

    // 填充样式不在画板域内（底色恒为实底），故样式弹层无 Fill 分组
    openStylesPopup();
    const popup = document.querySelector(".properties-content")!;
    const legends = Array.from(popup.querySelectorAll("fieldset > legend")).map(
      (legend) => legend.textContent,
    );
    expect(legends).toEqual(["Opacity"]);
  });
});
