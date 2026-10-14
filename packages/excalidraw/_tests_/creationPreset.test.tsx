import { CURSOR_TYPE, reseed } from "@excalidraw/common";

import {
  isMindmapEdgeElement,
  isMindmapNodeElement,
} from "@excalidraw/element";

import { Excalidraw } from "../index";

import { Keyboard, Pointer, UI } from "./helpers/ui";
import { API } from "./helpers/api";
import { act, fireEvent, render, GlobalTestState } from "./test-utils";

import type { ToolType } from "../types";

const { h } = window;

const pointer = () => new Pointer("mouse");

/** 悬停：跟随光标的半透明预设（离屏，不入 scene） */
describe("creation preset preview", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    await render(<Excalidraw />);
  });

  const PRESETS: { tool: ToolType; width: number; height: number }[] = [
    { tool: "rectangle", width: 200, height: 120 },
    { tool: "diamond", width: 200, height: 120 },
    { tool: "ellipse", width: 200, height: 120 },
    { tool: "stickynote", width: 250, height: 250 },
    // 表格没有单独的预设尺寸常量：newTableElement 建出来的默认 3×3 就是预设
    { tool: "table", width: 480, height: 168 },
    { tool: "frame", width: 640, height: 480 },
  ];

  it.each(PRESETS)(
    "$tool follows the pointer at its preset size",
    async ({ tool, width, height }) => {
      UI.clickTool(tool);
      pointer().moveTo(400, 300);

      const preview = h.app.createPreview.elements;
      expect(preview).toHaveLength(1);
      // 鼠标点即元素左上角（与按下拖拽的起点同一锚点）
      expect(preview![0]).toMatchObject({ x: 400, y: 300, width, height });

      // 预览不在场景里：没按下就什么都不会留下
      expect(h.elements).toHaveLength(0);
    },
  );

  it("moves with the pointer", async () => {
    UI.clickTool("rectangle");
    const mouse = pointer();
    mouse.moveTo(400, 300);
    mouse.moveTo(500, 360);

    expect(h.app.createPreview.elements![0]).toMatchObject({
      x: 500,
      y: 360,
    });
  });

  it("previews the whole preset mindmap graph", async () => {
    UI.clickTool("mindmap");
    pointer().moveTo(400, 300);

    const preview = h.app.createPreview.elements!;
    expect(preview.filter(isMindmapNodeElement)).toHaveLength(10);
    expect(preview.filter(isMindmapEdgeElement)).toHaveLength(9);
    // 根节点的左上角落在光标上
    const root = preview.find(
      (element) => isMindmapNodeElement(element) && element.role === "root",
    )!;
    expect(root).toMatchObject({ x: 400, y: 300 });
    expect(h.elements).toHaveLength(0);
  });

  it("follows the current shape pick, not a fixed one", async () => {
    UI.clickTool("diamond");
    pointer().moveTo(400, 300);

    expect(h.app.createPreview.elements![0]).toMatchObject({
      shape: { id: "diamond" },
    });
  });

  it("hides when the tool changes", async () => {
    UI.clickTool("rectangle");
    pointer().moveTo(400, 300);
    expect(h.app.createPreview.elements).not.toBeNull();

    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    expect(h.app.createPreview.elements).toBeNull();
  });

  it("hides when the pointer leaves the canvas", async () => {
    UI.clickTool("rectangle");
    pointer().moveTo(400, 300);
    expect(h.app.createPreview.elements).not.toBeNull();

    fireEvent.pointerLeave(GlobalTestState.interactiveCanvas);
    expect(h.app.createPreview.elements).toBeNull();
  });

  it("does not preview for a tool that has no preset", async () => {
    UI.clickTool("arrow");
    pointer().moveTo(400, 300);
    expect(h.app.createPreview.elements).toBeNull();
  });

  it("leaves the pointer id sequence alone", async () => {
    // 预览元素不入场景，也不该消耗共享的 id 序列——否则同一会话里后续元素的
    // id 会被悬停推后一位
    UI.clickTool("rectangle");
    pointer().moveTo(400, 300);

    UI.clickTool("freedraw");
    const mouse = pointer();
    mouse.downAt(40, 40);
    mouse.moveTo(80, 80);
    mouse.upAt();

    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(1);
    expect(h.elements[0].id).toBe("id0");
  });
});

/** 单击落地：预设尺寸、左上角在按下点——与悬停预览同一锚点 */
describe("creation preset placement", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  const PLACEMENTS: {
    tool: ToolType;
    width: number;
    height: number;
    type: string;
  }[] = [
    { tool: "rectangle", width: 200, height: 120, type: "composite_shape" },
    { tool: "stickynote", width: 250, height: 250, type: "stickynote" },
    { tool: "table", width: 480, height: 168, type: "table" },
    { tool: "frame", width: 640, height: 480, type: "frame" },
  ];

  it.each(PLACEMENTS)(
    "$tool places its preset on a click",
    async ({ tool, width, height, type }) => {
      UI.clickTool(tool);
      pointer().clickAt(300, 240);

      const placed = h.elements.filter((element) => element.type === type);
      expect(placed).toHaveLength(1);
      expect(placed[0]).toMatchObject({ x: 300, y: 240, width, height });
    },
  );

  it("snaps the placement to the grid", async () => {
    h.app.setAppState({ gridModeEnabled: true, gridSize: 20 });
    UI.clickTool("rectangle");
    pointer().clickAt(303, 247);

    expect(h.elements[0]).toMatchObject({ x: 300, y: 240 });
  });

  it("is a single undo step", async () => {
    const live = () => h.elements.filter((element) => !element.isDeleted);

    UI.clickTool("rectangle");
    pointer().clickAt(300, 240);
    expect(live()).toHaveLength(1);
    expect(API.getUndoStack()).toHaveLength(1);

    // h.elements 含墓碑，撤销后元素是被标记删除而不是从数组里消失
    Keyboard.undo();
    expect(live()).toHaveLength(0);

    Keyboard.redo();
    expect(live()).toHaveLength(1);
  });

  it("still lets a drag size the shape freely", async () => {
    UI.clickTool("rectangle");
    const mouse = pointer();
    mouse.downAt(100, 100);
    mouse.moveTo(160, 150);
    mouse.upAt();

    expect(h.elements[0]).toMatchObject({
      x: 100,
      y: 100,
      width: 60,
      height: 50,
    });
  });

  it("drops the preview once the real element takes over", async () => {
    UI.clickTool("rectangle");
    const mouse = pointer();
    mouse.moveTo(300, 240);
    expect(h.app.createPreview.elements).not.toBeNull();

    mouse.downAt(300, 240);
    // 按下之后由真正的 newElement 画在新元素画布上
    expect(h.state.newElement).not.toBeNull();
    mouse.upAt();
  });
});

describe("text tool cursor", () => {
  it("shows the text caret instead of the crosshair", async () => {
    localStorage.clear();
    await render(<Excalidraw />);
    UI.clickTool("text");

    expect(GlobalTestState.interactiveCanvas.style.cursor).toBe(
      CURSOR_TYPE.TEXT,
    );
  });
});
