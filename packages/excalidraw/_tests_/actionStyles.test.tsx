import React from "react";

import {
  CODES,
  COLOR_PALETTE,
  ROUNDNESS,
  STROKE_WIDTH,
} from "@excalidraw/common";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { copiedStyles } from "../actions/actionStyles";
import { Excalidraw } from "../index";
import { API } from "../_tests_/helpers/api";
import { Keyboard, Pointer, UI } from "../_tests_/helpers/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  togglePopover,
} from "../_tests_/test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

describe("actionStyles", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    // https://github.com/floating-ui/floating-ui/issues/1908#issuecomment-1301553793
    // affects node v16+
    await act(async () => {});
  });

  it("should copy & paste styles via keyboard", async () => {
    UI.clickTool("rectangle");
    mouse.down(10, 10);
    mouse.up(20, 20);

    UI.clickTool("rectangle");
    mouse.down(10, 10);
    mouse.up(20, 20);

    // Change some styles of second rectangle
    // 弹层全色板网格：色块按调色板色名 testid color-<name>，族色块取当前明度档
    togglePopover("Stroke");
    UI.clickOnTestId("color-red");
    togglePopover("Background");
    UI.clickOnTestId("color-red");
    // Fill style / stroke width / stroke style / opacity live in the styles popup
    togglePopover("Styles");
    // Fill style
    fireEvent.click(screen.getByTitle("Cross-hatch"));
    // Stroke width
    fireEvent.click(screen.getByTitle("Bold"));
    // Stroke style
    fireEvent.click(screen.getByTitle("Dotted"));
    // Opacity
    fireEvent.change(screen.getByTestId("opacity"), {
      target: { value: "60" },
    });

    mouse.reset();

    API.setSelectedElements([h.elements[1]] as NonDeletedExcalidrawElement[]);

    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.codeDown(CODES.C);
    });
    const secondRect = JSON.parse(copiedStyles)[0];
    expect(secondRect.id).toBe(h.elements[1].id);

    mouse.reset();
    // Paste styles to first rectangle
    API.setSelectedElements([h.elements[0]] as NonDeletedExcalidrawElement[]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.codeDown(CODES.V);
    });

    const firstRect = API.getSelectedElement();
    expect(firstRect.id).toBe(h.elements[0].id);
    expect(firstRect.strokeColor).toBe("#d83a52");
    expect(firstRect.backgroundColor).toBe("#fdecee");
    expect(firstRect.fillStyle).toBe("cross-hatch");
    expect(firstRect.strokeWidth).toBe(STROKE_WIDTH.bold);
    expect(firstRect.strokeStyle).toBe("dotted");
    expect(firstRect.opacity).toBe(60);
  });

  it("applies the copied background to a frame, keeping its corners", async () => {
    // 画板底色是元素属性，复制样式照常带过去；圆角仍是固定 chrome
    const rect = API.createElement({
      type: "rectangle",
      backgroundColor: "#fdecee",
    });
    const frame = API.createElement({
      type: "frame",
      backgroundColor: COLOR_PALETTE.transparent,
    });
    API.setElements([rect, frame]);

    API.setSelectedElements([rect]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.codeDown(CODES.C);
    });
    mouse.reset();

    API.setSelectedElements([frame]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.codeDown(CODES.V);
    });

    const pasted = API.getSelectedElement();
    expect(pasted.backgroundColor).toBe("#fdecee");
    expect(pasted.roundness).toBe(null);
  });

  it("should show and apply roundness for sticky notes", async () => {
    const stickyNote = API.createElement({
      type: "stickynote",
      roundness: null,
    });

    API.setElements([stickyNote]);
    API.setSelectedElements([stickyNote]);

    // 边角在浮动栏「样式」弹层内（T3 场景矩阵）
    togglePopover("Styles");
    fireEvent.click(screen.getByTitle("Round"));

    expect(API.getSelectedElement().roundness).toEqual({
      type: ROUNDNESS.PROPORTIONAL_RADIUS,
    });
  });

  it("sticky note stroke popup hides transparent in the palette grid", async () => {
    UI.clickTool("stickynote");

    togglePopover("Font color");

    // 全色板网格 15 位：便签文字无透明色域，透明位渲染为隐藏占位
    // （保住其余颜色的网格位与热键序），可见色块 14 枚
    const popup = document.querySelector(".color-picker-content")!;
    const grid = popup.querySelector(".color-picker-content--default")!;
    expect(grid.querySelectorAll("button.color-picker__button").length).toBe(
      14,
    );
    expect(screen.queryByTestId("color-transparent")).toBeNull();
    expect(grid.querySelector(".is-transparent")).toBeNull();
    expect(grid.querySelectorAll("[aria-hidden='true']").length).toBe(1);
  });

  it("keeps the excluded transparent hotkey dead and the palette keys intact", async () => {
    UI.clickTool("stickynote");

    togglePopover("Font color");

    const picker = document.querySelector(".color-picker-content")!;
    const before = h.state.currentItemStickynoteStrokeColor;

    // 透明被排除（隐藏占位）：其绑定键 q 为空键，不泄漏到全局
    // 工具锁定快捷键
    fireEvent.keyDown(picker, { key: "q" });
    expect(h.state.currentItemStickynoteStrokeColor).toBe(before);
    expect(h.state.activeTool.locked).toBe(false);

    // 调色板键按位生效（w = 白）
    fireEvent.keyDown(picker, { key: "w" });
    expect(h.state.currentItemStickynoteStrokeColor).toBe(COLOR_PALETTE.white);
  });

  it("should track sticky note stroke color separately", async () => {
    API.setAppState({
      currentItemStrokeColor: COLOR_PALETTE.red[4],
      currentItemStickynoteStrokeColor: COLOR_PALETTE.black,
    });
    const stickyNote = API.createElement({
      type: "stickynote",
      strokeColor: COLOR_PALETTE.black,
    });

    API.setElements([stickyNote]);
    API.setSelectedElements([stickyNote]);

    togglePopover("Font color");
    // 全色板网格：蓝色族色块（取当前明度档 4）
    UI.clickOnTestId("color-blue");

    expect(API.getSelectedElement().strokeColor).toBe(COLOR_PALETTE.blue[4]);
    expect(h.state.currentItemStickynoteStrokeColor).toBe(
      COLOR_PALETTE.blue[4],
    );
    expect(h.state.currentItemStrokeColor).toBe(COLOR_PALETTE.red[4]);
  });
});
