import React from "react";

import { KEYS } from "@excalidraw/common";
import { LinearElementEditor } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import type {
  ExcalidrawImageElement,
  ExcalidrawLinearElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { actionToggleLinearEditor } from "../actions";
import { FLOATBAR_GAP } from "../components/toolbar/floatingPosition";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, fireEvent, render } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

const queryFloatbar = () => document.querySelector<HTMLElement>(".tb-floatbar");

describe("浮动工具栏（T2 容器与定位）", () => {
  it("桌面选中元素：出现 role=toolbar 的浮动栏，内容为既有属性面板", async () => {
    await render(<Excalidraw />);
    const rect = API.createElement({ type: "rectangle", x: 0, y: 0 });
    API.setElements([rect]);
    act(() => {
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });

    const bar = queryFloatbar();
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("role")).toBe("toolbar");
    expect(bar?.getAttribute("aria-label")).toBe("Selected element properties");
    // T3 之前沿用既有面板内容（选择器保持可用）
    expect(bar!.querySelector(".selected-shape-actions")).not.toBeNull();
  });

  it("无选中·工具配置态：激活绘制工具时固定顶部居中，切回选择工具隐藏", async () => {
    await render(<Excalidraw />);
    expect(queryFloatbar()).toBeNull();

    act(() => {
      h.app.setActiveTool({ type: "arrow" });
    });
    const bar = queryFloatbar();
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("aria-label")).toBe("Tool default styles");

    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    expect(queryFloatbar()).toBeNull();
  });

  it("无选中·工具配置态：形状/画框等工具不展示配置栏，仅箭头/线条/自由书写/文字/便签展示", async () => {
    await render(<Excalidraw />);

    // 形状类/画框/表格等：激活未落笔时不展示顶部配置栏
    for (const tool of [
      "rectangle",
      "ellipse",
      "diamond",
      "frame",
      "table",
    ] as const) {
      act(() => {
        h.app.setActiveTool({ type: tool });
      });
      expect(queryFloatbar()).toBeNull();
    }

    // 连线、画笔与文字类：仍在顶部展示配置栏
    for (const tool of [
      "arrow",
      "line",
      "freedraw",
      "text",
      "stickynote",
    ] as const) {
      act(() => {
        h.app.setActiveTool({ type: tool });
      });
      const bar = queryFloatbar();
      expect(bar).not.toBeNull();
      expect(bar?.getAttribute("aria-label")).toBe("Tool default styles");
    }

    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
  });

  it("无选中·工具配置态：不显示「图层」触发器（z-order 无作用对象），选中后恢复", async () => {
    await render(<Excalidraw />);

    act(() => {
      h.app.setActiveTool({ type: "arrow" });
    });
    const bar = queryFloatbar();
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("aria-label")).toBe("Tool default styles");
    expect(
      bar!.querySelector("[data-testid='floatbar-group-compactLayers']"),
    ).toBeNull();

    // 有选区后恢复显示（z-order 的作用对象存在）
    const rect = API.createElement({ type: "rectangle", x: 0, y: 0 });
    API.setElements([rect]);
    act(() => {
      h.app.setActiveTool({ type: "selection" });
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });
    expect(
      queryFloatbar()?.querySelector(
        "[data-testid='floatbar-group-compactLayers']",
      ),
    ).not.toBeNull();
  });

  it("拖动/缩放选区时隐藏（is-hidden），松手复位；裁剪模式豁免", async () => {
    await render(<Excalidraw />);
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    act(() => {
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });

    act(() => {
      API.setAppState({ selectedElementsAreBeingDragged: true });
    });
    expect(queryFloatbar()?.classList.contains("is-hidden")).toBe(true);

    act(() => {
      API.setAppState({ selectedElementsAreBeingDragged: false });
    });
    expect(queryFloatbar()?.classList.contains("is-hidden")).toBe(false);

    // 缩放中隐藏
    act(() => {
      API.setAppState({ isResizing: true });
    });
    expect(queryFloatbar()?.classList.contains("is-hidden")).toBe(true);
    act(() => {
      API.setAppState({ isResizing: false });
    });

    // 裁剪模式下拖动裁剪框不隐藏
    const image = API.createElement({
      type: "image",
      fileId: "crop-drag-file" as any,
    });
    API.setElements([image]);
    act(() => {
      API.setAppState({ selectedElementIds: { [image.id]: true } });
    });
    act(() => {
      h.app.startImageCropping(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
      );
    });
    act(() => {
      API.setAppState({ selectedElementsAreBeingDragged: true });
    });
    expect(queryFloatbar()?.classList.contains("is-hidden")).toBe(false);
    act(() => {
      h.app.finishImageCropping();
      API.setAppState({ selectedElementsAreBeingDragged: false });
    });
  });

  it("文本编辑态：选区被清空后仍锚定被编辑文本（不落到顶部工具条下方）", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    // 固定容器尺寸，避免 jsdom 下量测为 0 影响左右收敛的期望值
    act(() => {
      API.setAppState({ width: 800, height: 600 });
    });
    const text = API.createElement({
      type: "text",
      text: "ola",
      x: 300,
      y: 200,
      width: 20,
      height: 20,
    });
    API.setElements([text]);
    API.setSelectedElements([text]);

    act(() => {
      Keyboard.keyPress(KEYS.ENTER);
    });
    expect(h.state.editingTextElement?.id).toBe(text.id);
    // 根因：进入文本编辑时选区被清空，浮动栏因此失去锚点而退回顶部
    expect(h.state.selectedElementIds).toEqual({});

    const bar = queryFloatbar()!;
    expect(bar.getAttribute("aria-label")).toBe("Selected element properties");

    // jsdom 下浮动栏量测为 0×0，故 left/top 即锚点包围盒边缘（上方居中 + 间距）
    const edited = h.app.scene.getNonDeletedElement(text.id)!;
    expect(bar.style.left).toBe(`${edited.x + edited.width / 2}px`);
    expect(bar.style.top).toBe(`${edited.y - FLOATBAR_GAP}px`);
  });

  it("图形文本编辑态：锚定容器图形本身，而非其中的文本", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    act(() => {
      API.setAppState({ width: 800, height: 600 });
    });
    const shape = API.createElement({
      type: "rectangle",
      x: 300,
      y: 200,
      width: 100,
      height: 60,
      boundElements: [],
    });
    const boundText = API.createElement({
      type: "text",
      text: "ola",
      x: 310,
      y: 220,
      width: 40,
      height: 20,
      containerId: shape.id,
    });
    API.setElements([shape, boundText]);
    API.updateElement(shape, {
      boundElements: [{ type: "text", id: boundText.id }],
    });

    mouse.doubleClickOn(boundText);
    expect(h.state.editingTextElement?.id).toBe(boundText.id);
    expect(h.state.selectedElementIds).toEqual({});

    const bar = queryFloatbar()!;
    expect(bar.getAttribute("aria-label")).toBe("Selected element properties");
    // 锚定图形的包围盒（300,200,100×60）——输入时图形尺寸会随文本变化
    expect(bar.style.left).toBe("350px");
    expect(bar.style.top).toBe(`${200 - FLOATBAR_GAP}px`);
  });

  it("全锁定选区：浮动栏内联「已锁定 + 解锁」，解锁后恢复属性面板", async () => {
    await render(<Excalidraw />);
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    act(() => {
      API.updateElement(rect, { locked: true } as any);
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });

    const bar = queryFloatbar()!;
    expect(bar.getAttribute("aria-label")).toBe("Locked");
    expect(bar.textContent).toContain("Locked");
    expect(bar.querySelector(".selected-shape-actions")).toBeNull();

    fireEvent.click(bar.querySelector(".tb-btn-primary")!);
    expect(
      (h.app.scene.getNonDeletedElement(rect.id) as typeof rect).locked,
    ).toBe(false);
    expect(
      queryFloatbar()!.querySelector(".selected-shape-actions"),
    ).not.toBeNull();
  });

  it("混合锁定选区：正常显示属性分组", async () => {
    await render(<Excalidraw />);
    const lockedRect = API.createElement({ type: "rectangle", x: 0 });
    const freeRect = API.createElement({ type: "rectangle", x: 200 });
    API.setElements([lockedRect, freeRect]);
    act(() => {
      API.updateElement(lockedRect, { locked: true } as any);
      API.setAppState({
        selectedElementIds: { [lockedRect.id]: true, [freeRect.id]: true },
      });
    });

    const bar = queryFloatbar()!;
    expect(bar.textContent).not.toContain("Locked");
    expect(bar.querySelector(".selected-shape-actions")).not.toBeNull();
  });

  it("裁剪模式条：Esc 取消并还原到进入时状态，且不产生历史记录", async () => {
    // handleKeyboardGlobally：快捷键走 document 级监听（与真实使用一致）
    await render(<Excalidraw handleKeyboardGlobally />);
    const image = API.createElement({
      type: "image",
      fileId: "crop-cancel-file" as any,
      width: 200,
      height: 100,
    });
    API.setElements([image]);
    act(() => {
      API.setAppState({ selectedElementIds: { [image.id]: true } });
    });

    act(() => {
      h.app.startImageCropping(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
      );
    });
    expect(h.state.croppingElementId).toBe(image.id);

    // 模式条替换浮动栏内容
    const bar = queryFloatbar()!;
    expect(bar.getAttribute("aria-label")).toBe("Crop image");
    expect(bar.textContent).toContain("Crop image");
    expect(bar.textContent).toContain("Apply");
    expect(bar.querySelector(".selected-shape-actions")).toBeNull();

    // 模拟裁剪框拖动
    const undoDepthBefore = h.history.undoStack.length;
    act(() => {
      h.app.scene.mutateElement(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
        {
          crop: {
            x: 10,
            y: 10,
            width: 100,
            height: 50,
            naturalWidth: 200,
            naturalHeight: 100,
          },
        },
      );
    });
    expect(
      (h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement)
        .crop,
    ).toEqual({
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      naturalWidth: 200,
      naturalHeight: 100,
    });

    // Esc = 取消：还原到进入时状态（crop: null）并退出
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.state.croppingElementId).toBeNull();
    expect(
      (h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement)
        .crop,
    ).toBeNull();
    // 取消不产生新的历史条目（撤销不会把已取消的裁剪带回来）
    expect(h.history.undoStack.length).toBe(undoDepthBefore);
  });

  it("裁剪取消后撤销：裁剪期间的中间历史条目被跳过（无幻影态）", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const image = API.createElement({
      type: "image",
      fileId: "crop-undo-file" as any,
      width: 200,
      height: 100,
    });
    API.setElements([image]);
    act(() => {
      API.setAppState({ selectedElementIds: { [image.id]: true } });
    });

    act(() => {
      h.app.startImageCropping(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
      );
    });
    // 模拟裁剪框拖动 + 松手捕获（等价 pointerup 时的 scheduleCapture）
    act(() => {
      h.app.scene.mutateElement(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
        {
          crop: {
            x: 30,
            y: 30,
            width: 60,
            height: 40,
            naturalWidth: 200,
            naturalHeight: 100,
          },
        },
      );
      h.app.store.scheduleCapture();
    });
    act(() => {
      h.setState({});
    });
    const undoDepthAfterCropDrag = h.history.undoStack.length;

    // Esc 取消：还原 + 不产生新历史条目
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.history.undoStack.length).toBe(undoDepthAfterCropDrag);
    expect(
      (h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement)
        .crop,
    ).toBeNull();

    // 撤销：裁剪条目与当前状态等价（无可见变化）被历史跳过，
    // 直接落到上一个真实操作（创建图片）——不会回到「已裁剪」幻影态
    Keyboard.undo();
    const imageAfterUndo = h.app.scene.getNonDeletedElement(image.id) as
      | ExcalidrawImageElement
      | undefined;
    expect(imageAfterUndo?.crop ?? null).toBeNull();
  });

  it("裁剪模式条：已有裁剪（crop 非 null）再次进入，拖手柄后 Esc 仍还原", async () => {
    // 回归：快照必须按值拷贝——cropElement.ts 的手柄拖动会原地修改
    // crop 对象，按引用快照会被同步污染而无法还原
    await render(<Excalidraw handleKeyboardGlobally />);
    const image = API.createElement({
      type: "image",
      fileId: "crop-recrop-file" as any,
      width: 200,
      height: 100,
    });
    API.setElements([image]);

    // 注意：元素上的 crop 会被手柄拖动原地修改，入场时须用拷贝，
    // 断言以原始字面量为准
    const initialCrop = {
      x: 10,
      y: 10,
      width: 150,
      height: 80,
      naturalWidth: 200,
      naturalHeight: 100,
    };
    act(() => {
      h.app.scene.mutateElement(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
        { crop: { ...initialCrop } },
      );
      API.setAppState({ selectedElementIds: { [image.id]: true } });
    });

    act(() => {
      h.app.startImageCropping(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
      );
    });
    expect(h.state.croppingElementId).toBe(image.id);

    // 拖右侧边缘手柄（走 cropElement 原地修改路径）
    UI.crop(
      h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
      "e",
      200,
      100,
      [-50, 0],
    );
    const afterDrag = (
      h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement
    ).crop!;
    expect(afterDrag).not.toEqual(initialCrop);

    // Esc = 取消：还原到进入时的裁剪框
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.state.croppingElementId).toBeNull();
    expect(
      (h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement)
        .crop,
    ).toEqual(initialCrop);
  });

  it("裁剪模式条：Enter/应用按钮保留裁剪并退出", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const image = API.createElement({
      type: "image",
      fileId: "crop-apply-file" as any,
      width: 200,
      height: 100,
    });
    API.setElements([image]);
    act(() => {
      API.setAppState({ selectedElementIds: { [image.id]: true } });
    });

    act(() => {
      h.app.startImageCropping(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
      );
    });
    act(() => {
      h.app.scene.mutateElement(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
        {
          crop: {
            x: 20,
            y: 20,
            width: 80,
            height: 40,
            naturalWidth: 200,
            naturalHeight: 100,
          },
        },
      );
    });

    Keyboard.keyPress(KEYS.ENTER);
    expect(h.state.croppingElementId).toBeNull();
    expect(
      (h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement)
        .crop,
    ).toEqual({
      x: 20,
      y: 20,
      width: 80,
      height: 40,
      naturalWidth: 200,
      naturalHeight: 100,
    });
  });

  it("裁剪模式条：双击画布应用裁剪并退出", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const image = API.createElement({
      type: "image",
      fileId: "crop-dblclick-file" as any,
      width: 200,
      height: 100,
    });
    API.setElements([image]);
    act(() => {
      API.setAppState({ selectedElementIds: { [image.id]: true } });
    });

    act(() => {
      h.app.startImageCropping(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
      );
    });
    act(() => {
      h.app.scene.mutateElement(
        h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
        {
          crop: {
            x: 5,
            y: 5,
            width: 90,
            height: 60,
            naturalWidth: 200,
            naturalHeight: 100,
          },
        },
      );
    });

    mouse.doubleClickOn(
      h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement,
    );
    expect(h.state.croppingElementId).toBeNull();
    expect(
      (h.app.scene.getNonDeletedElement(image.id) as ExcalidrawImageElement)
        .crop,
    ).toEqual({
      x: 5,
      y: 5,
      width: 90,
      height: 60,
      naturalWidth: 200,
      naturalHeight: 100,
    });
  });

  describe("表格单元格", () => {
    // 默认表格：3×3，列宽 160 / 行高 56，置于 (200,200)
    const TABLE_X = 200;
    const TABLE_Y = 200;
    const COLUMN_WIDTH = 160;

    const createTable = () => {
      const table = API.createElement({
        type: "table",
        x: TABLE_X,
        y: TABLE_Y,
      });
      API.setElements([table]);
      return table;
    };

    const selectCell = (
      table: ReturnType<typeof createTable>,
      anchorIndex: number,
      focusIndex = anchorIndex,
    ) => {
      act(() => {
        API.setAppState({
          tableCellSelection: {
            tableId: table.id,
            anchorId: table.table.cells[anchorIndex].id,
            focusId: table.table.cells[focusIndex].id,
            mobileMode: false,
          },
        });
      });
    };

    it("单元格选区：浮动栏锚定该单元格（而非整张表格）", async () => {
      await render(<Excalidraw handleKeyboardGlobally />);
      act(() => {
        API.setAppState({ width: 800, height: 600 });
      });
      const table = createTable();
      selectCell(table, 0);

      const bar = queryFloatbar()!;
      expect(bar.getAttribute("aria-label")).toBe(
        "Selected element properties",
      );
      // 单元格命令仍在该栏（这是单元格选区的工具栏）
      expect(
        bar.querySelector("[data-testid='table-cell-multi-select']"),
      ).not.toBeNull();
      // 首个单元格（200,200,160×56）上方居中；整表中心是 440
      expect(bar.style.left).toBe(`${TABLE_X + COLUMN_WIDTH / 2}px`);
      expect(bar.style.top).toBe(`${TABLE_Y - FLOATBAR_GAP}px`);
    });

    it("单元格范围选区：锚定所选范围的并集", async () => {
      await render(<Excalidraw handleKeyboardGlobally />);
      act(() => {
        API.setAppState({ width: 800, height: 600 });
      });
      const table = createTable();
      // cells[0]/cells[1] = 第一行的前两个单元格（行主序）
      selectCell(table, 0, 1);

      const bar = queryFloatbar()!;
      // 并集 x 200..520、y 200..256 → 上方居中于 360
      expect(bar.style.left).toBe(`${TABLE_X + COLUMN_WIDTH}px`);
      expect(bar.style.top).toBe(`${TABLE_Y - FLOATBAR_GAP}px`);
    });

    it("单元格背景文本编辑：浮动栏展示文本属性，单元格命令与表格色板让位", async () => {
      await render(<Excalidraw handleKeyboardGlobally />);
      act(() => {
        API.setAppState({ width: 800, height: 600 });
      });
      const table = createTable();
      selectCell(table, 0);

      // Enter = 编辑所选单元格的背景文本
      act(() => {
        Keyboard.keyPress(KEYS.ENTER);
      });
      expect(h.state.editingTextElement).not.toBeNull();

      const bar = queryFloatbar()!;
      // 文本属性接管：字体/对齐 + 文本色板（描边色域）
      expect(
        bar.querySelector("[aria-label='Show font picker']"),
      ).not.toBeNull();
      expect(bar.querySelector("[aria-label='Text align']")).not.toBeNull();
      // 被编辑的是文本，取色域按文本场景命名为「字体颜色」
      expect(bar.querySelector("[aria-label='Font color']")).not.toBeNull();
      // 单元格命令（选区模式/合并拆分）与单元格背景色板让位
      expect(
        bar.querySelector("[data-testid='table-cell-multi-select']"),
      ).toBeNull();
      expect(bar.querySelector("[data-testid='table-merge-cells']")).toBeNull();
      expect(bar.querySelector(".table-style-actions")).toBeNull();
      // 位置仍贴着被编辑的单元格
      expect(bar.style.left).toBe(`${TABLE_X + COLUMN_WIDTH / 2}px`);
      expect(bar.style.top).toBe(`${TABLE_Y - FLOATBAR_GAP}px`);
    });
  });

  it("编辑节点模式条：进入后显示「编辑节点 + 完成」，点击完成退出", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const line = API.createElement({
      type: "line",
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 100)],
    });
    API.setElements([line]);
    act(() => {
      API.setAppState({
        selectedElementIds: { [line.id]: true },
        selectedLinearElement: new LinearElementEditor(
          h.app.scene.getNonDeletedElement(
            line.id,
          ) as NonDeleted<ExcalidrawLinearElement>,
          h.app.scene.getNonDeletedElementsMap(),
        ),
      });
    });

    act(() => {
      h.app.actionManager.executeAction(actionToggleLinearEditor);
    });
    expect(h.state.selectedLinearElement?.isEditing).toBe(true);

    const bar = queryFloatbar()!;
    expect(bar.getAttribute("aria-label")).toBe("Edit nodes");
    expect(bar.textContent).toContain("Edit nodes");
    expect(bar.querySelector(".selected-shape-actions")).toBeNull();

    fireEvent.click(bar.querySelector(".tb-btn-primary")!);
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);
    // 退出后回到正常属性浮动栏
    expect(
      queryFloatbar()!.querySelector(".selected-shape-actions"),
    ).not.toBeNull();
  });

  it("编辑节点模式下 Enter/Esc 同效退出（与「完成」一致）", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const line = API.createElement({
      type: "line",
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 100)],
    });
    API.setElements([line]);

    const enterEditing = () => {
      act(() => {
        API.setAppState({
          selectedElementIds: { [line.id]: true },
          selectedLinearElement: new LinearElementEditor(
            h.app.scene.getNonDeletedElement(
              line.id,
            ) as NonDeleted<ExcalidrawLinearElement>,
            h.app.scene.getNonDeletedElementsMap(),
          ),
        });
      });
      act(() => {
        h.app.actionManager.executeAction(actionToggleLinearEditor);
      });
      expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    };

    enterEditing();
    Keyboard.keyPress(KEYS.ENTER);
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);

    enterEditing();
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);
  });

  it("平板形态：浮动栏与桌面同源同档，内容为场景矩阵渲染", async () => {
    await render(<Excalidraw UIOptions={{ getFormFactor: () => "tablet" }} />);
    act(() => {
      h.app.refreshEditorInterface();
    });
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    act(() => {
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });

    const bar = queryFloatbar();
    expect(bar).not.toBeNull();
    // 尺寸不分档：桌面/平板同一套规格，故不再有 touch 放大类
    expect(bar?.classList.contains("touch")).toBe(false);
    // 平板与桌面共用同一场景矩阵渲染
    expect(bar!.querySelector(".selected-shape-actions")).not.toBeNull();
  });

  it("手机形态：不渲染浮动栏（仍走底部条）", async () => {
    await render(<Excalidraw UIOptions={{ getFormFactor: () => "phone" }} />);
    act(() => {
      h.app.refreshEditorInterface();
    });
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    act(() => {
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });

    expect(queryFloatbar()).toBeNull();
    // 底部条仍在
    expect(document.querySelector(".mobile-shape-actions")).not.toBeNull();
  });
});
