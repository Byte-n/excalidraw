import { act } from "react-dom/test-utils";
import { vi } from "vitest";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import {
  getCommonBounds,
  getTransformHandles,
  getTransformHandlesFromCoords,
} from "@excalidraw/element";

import type { TransformHandleType } from "@excalidraw/element";
import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import {
  assertSelectedElements,
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
} from "./test-utils";

import type { NormalizedZoomValue } from "../types";

unmountComponent();

const { h } = window;

const mouse = new Pointer("mouse");

const mouseDown = (clientX: number, clientY: number) => {
  fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
    pointerType: "mouse",
  });
};
const mouseMove = (clientX: number, clientY: number) => {
  fireEvent.pointerMove(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
    pointerType: "mouse",
  });
};
const mouseUp = (clientX: number, clientY: number) => {
  fireEvent.pointerUp(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
    pointerType: "mouse",
  });
};

/** lets the rAF-throttled pointer session run its pending frame */
const nextFrame = () =>
  act(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve(null));
      }),
  );

/**
 * 画布的 2d context（vitest-canvas-mock）+ 记录每一次 fillText。
 * 手柄/读数的位置由渲染层算，测试只认「画出来的字」，避免把几何常量抄一遍。
 */
const spyOnFillText = () => {
  const context = GlobalTestState.interactiveCanvas.getContext("2d")!;
  return { context, fillText: vi.spyOn(context, "fillText") };
};

const drawnTexts = (fillText: ReturnType<typeof vi.spyOn>) =>
  fillText.mock.calls.map((call) => call[0]);

/** 记录 context.font 的每一次赋值，用来验证字号是否跟着 zoom 换算 */
const recordFonts = (context: CanvasRenderingContext2D) => {
  const fonts: string[] = [];
  let current = "";
  Object.defineProperty(context, "font", {
    configurable: true,
    get: () => current,
    set: (value: string) => {
      current = value;
      fonts.push(value);
    },
  });
  return fonts;
};

const live = () => h.elements.filter((element) => !element.isDeleted);

const createRect = (overrides: Record<string, unknown> = {}) =>
  API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 200,
    height: 120,
    ...overrides,
  });

const select = (elements: NonDeletedExcalidrawElement[]) => {
  API.setElements(elements);
  API.setSelectedElements(elements);
  mouse.reset();
  act(() => {
    h.app.store.scheduleCapture();
    h.app.scene.triggerUpdate();
  });
};

/** 单选手柄中心：`getTransformHandles` 的四元组是 [x, y, width, height] */
const singleHandleCenter = (handle: TransformHandleType) => {
  const element = live()[0];
  const handles = getTransformHandles(
    element,
    h.state.zoom,
    h.app.scene.getNonDeletedElementsMap(),
    "mouse",
    {},
  );
  const box = handles[handle]!;
  return { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 };
};

/** 多选手柄中心：选框恒为角度 0 的公共包围盒 */
const multiHandleCenter = (handle: TransformHandleType) => {
  const bounds = getCommonBounds(live());
  const handles = getTransformHandlesFromCoords(
    [bounds[0], bounds[1], bounds[2], bounds[3], 0, 0],
    0 as any,
    h.state.zoom,
    "mouse",
    {},
  );
  const box = handles[handle]!;
  return { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 };
};

/** 视图坐标零偏移、zoom=1 时场景坐标与视图坐标重合，直接当 client 坐标用 */
const dragHandle = async (
  center: { x: number; y: number },
  delta: { x: number; y: number },
) => {
  mouseDown(center.x, center.y);
  mouseMove(center.x + delta.x, center.y + delta.y);
  await nextFrame();
};

describe("transform status readout", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw />);
  });

  describe("单选", () => {
    it("rotating reports the element's angle and not its size", async () => {
      const rect = createRect();
      select([rect]);
      const { fillText } = spyOnFillText();

      const handle = singleHandleCenter("rotation");
      // 从 se 角外推到正上的旋转柄，绕中心扫过 90° 的四分之一左右
      const center = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
      await dragHandle(handle, {
        x: -handle.x + center.x,
        y: -handle.y + center.y - 60,
      });

      const texts = drawnTexts(fillText);
      expect(texts.some((text) => /^-?\d+°$/.test(String(text)))).toBe(true);
      expect(texts).not.toContain("200 × 120");

      mouseUp(0, 0);
    });

    it("resizing reports width × height", async () => {
      const rect = createRect();
      select([rect]);
      const { fillText } = spyOnFillText();

      const handle = singleHandleCenter("se");
      await dragHandle(handle, { x: 40, y: 24 });

      expect(drawnTexts(fillText)).toContain("240 × 144");

      mouseUp(handle.x + 40, handle.y + 24);
    });

    it("hovering the rotation handle shows the angle without pressing", async () => {
      const rect = createRect({ angle: (30 * Math.PI) / 180 });
      select([rect]);
      const { fillText } = spyOnFillText();

      mouseMove(999, 999);
      expect(drawnTexts(fillText)).not.toContain("30°");

      const handle = singleHandleCenter("rotation");
      mouseMove(handle.x, handle.y);

      expect(drawnTexts(fillText)).toContain("30°");
    });

    it("hovering a resize handle shows the size", async () => {
      const rect = createRect();
      select([rect]);
      const { fillText } = spyOnFillText();

      const handle = singleHandleCenter("se");
      mouseMove(handle.x, handle.y);

      expect(drawnTexts(fillText)).toContain("200 × 120");
    });

    it("drops the readout when the pointer leaves the handle", async () => {
      const rect = createRect({ angle: (30 * Math.PI) / 180 });
      select([rect]);
      const { fillText } = spyOnFillText();

      const handle = singleHandleCenter("rotation");
      mouseMove(handle.x, handle.y);
      expect(drawnTexts(fillText)).toContain("30°");

      fillText.mockClear();
      mouseMove(600, 600);
      expect(drawnTexts(fillText)).not.toContain("30°");
    });

    it("sizes the badge in screen px regardless of zoom", async () => {
      const rect = createRect();
      select([rect]);

      for (const zoom of [0.5, 1, 2]) {
        act(() => {
          h.app.setState({ zoom: { value: zoom as NormalizedZoomValue } });
        });
        const { context, fillText } = spyOnFillText();
        const fonts = recordFonts(context);

        // zoom ≠ 1 时场景坐标与视图坐标不再重合，手柄中心要换算过去
        const center = singleHandleCenter("se");
        const handle = sceneCoordsToViewportCoords(
          { sceneX: center.x, sceneY: center.y },
          h.state,
        );
        mouseMove(handle.x, handle.y);

        expect(drawnTexts(fillText)).toContain("200 × 120");
        // 11px / zoom：交互层画布整体按 zoom 缩放，不除 zoom 的话字会跟着涨，
        // 而同一处的内边距 12/zoom、高度 20/zoom 都换算了（见 docs/TODO.md）
        expect(fonts).toContain(`${11 / zoom}px sans-serif`);
        fillText.mockRestore();
      }
    });
  });

  describe("多选", () => {
    const createMulti = () => [
      createRect({ x: 100, y: 100, width: 120, height: 80 }),
      createRect({ x: 260, y: 160, width: 100, height: 120 }),
      createRect({ x: 140, y: 260, width: 140, height: 60 }),
    ];

    const expectedBounds = () => {
      const [x1, y1, x2, y2] = getCommonBounds(live());
      return `${Math.round(x2 - x1)} × ${Math.round(y2 - y1)}`;
    };

    it("resizing reports the common bounds", async () => {
      select(createMulti());
      const { fillText } = spyOnFillText();

      const handle = multiHandleCenter("se");
      // 按下不动也要有读数（增量/尺寸在按下那一刻就成立）
      mouseDown(handle.x, handle.y);
      mouseMove(handle.x + 40, handle.y + 30);
      await nextFrame();

      expect(drawnTexts(fillText)).toContain(expectedBounds());

      mouseUp(handle.x + 40, handle.y + 30);
    });

    it("rotating reports the sweep delta together with the selection size", async () => {
      select(createMulti());
      const { fillText } = spyOnFillText();
      const size = expectedBounds();

      const handle = multiHandleCenter("rotation");
      await dragHandle(handle, { x: -60, y: 90 });

      const texts = drawnTexts(fillText).map(String);
      expect(
        texts.some((text) => text.includes("°") && text.includes(size)),
      ).toBe(true);

      mouseUp(0, 0);
    });

    it("hovering the rotation handle falls back to the selection size", async () => {
      select(createMulti());
      const { fillText } = spyOnFillText();

      const handle = multiHandleCenter("rotation");
      mouseMove(handle.x, handle.y);

      const texts = drawnTexts(fillText).map(String);
      expect(texts).toContain(expectedBounds());
      // 没按下就没有增量，不该报角度
      expect(texts.some((text) => /^[+-]\d+°/.test(text))).toBe(false);
    });

    it("does not show the readout on a locked selection", async () => {
      const elements = createMulti().map((element) => ({
        ...element,
        locked: true,
      }));
      select(elements as NonDeletedExcalidrawElement[]);
      const { fillText } = spyOnFillText();

      mouseMove(200, 300);

      expect(drawnTexts(fillText)).not.toContain(expectedBounds());
    });
  });

  it("forgets a hover once the selection changes", async () => {
    const first = createRect({ angle: (30 * Math.PI) / 180 });
    select([first]);
    const { fillText } = spyOnFillText();

    const handle = singleHandleCenter("rotation");
    mouseMove(handle.x, handle.y);
    expect(drawnTexts(fillText)).toContain("30°");

    // 换一个选区，但不再移动指针：上一次的悬停不能残留在新选区上
    fillText.mockClear();
    const second = createRect({ x: 300, y: 300, angle: (75 * Math.PI) / 180 });
    select([second]);

    expect(drawnTexts(fillText)).not.toContain("30°");
  });

  /**
   * 变换读数要能画出来，前提是渲染层的「画选中元素」那一块没被跳过——它以
   * `!appState.selectionElement` 为门槛，而按下时会建一枚零尺寸框选草稿。
   * 缩放/旋转分支必须把它丢掉（和拖拽分支同一口径），否则整个手势里选择框、
   * 手柄、读数全都不画。下面两条分别盯住「丢」与「别丢过头」。
   */
  describe("pointer-down 框选草稿", () => {
    it("clears it once the press turns out to be a transform gesture", async () => {
      const rect = createRect();
      select([rect]);

      const handle = singleHandleCenter("se");
      mouseDown(handle.x, handle.y);
      expect(h.state.selectionElement).not.toBeNull();

      mouseMove(handle.x + 40, handle.y + 24);
      await nextFrame();
      expect(h.state.selectionElement).toBeNull();

      mouseUp(handle.x + 40, handle.y + 24);
    });

    it("keeps it when a modifier key is pressed mid box-select", async () => {
      const inside = createRect({ x: 100, y: 0, width: 50, height: 50 });
      const outside = createRect({ x: 400, y: 400, width: 50, height: 50 });
      API.setElements([inside, outside]);
      API.setSelectedElements([]);

      // 空白处起手 → 框选；手势中按修饰键会走键盘路径，那条路带着
      // `resize.handleType === false` 进入 maybeHandleResize，不能顺手清掉草稿
      mouse.downAt(175, -20);
      mouse.move(-1000, -1000);
      fireEvent.keyDown(window, { key: "Shift" });
      mouse.moveTo(85, 70);
      mouse.up();

      assertSelectedElements([inside.id]);
    });
  });
});
