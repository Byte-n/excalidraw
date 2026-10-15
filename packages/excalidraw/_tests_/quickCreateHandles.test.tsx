import { ROUNDNESS, reseed } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";
import { getCurvePathOps } from "@excalidraw/utils/shape";

import {
  ShapeCache,
  getContainingFrame,
  getCurveConnectorRatio,
  getElementBounds,
  getQuickCreateHandles,
  hitTestQuickCreateHandle,
  isArrowElement,
  isCompositeShapeElement,
  isMindmapNodeElement,
  QUICK_CREATE_GHOST_ALPHA,
  QUICK_CREATE_HANDLE_REST_ALPHA,
  recomputeCurveConnector,
  updateBoundElements,
} from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";
import type { ElementUpdate } from "@excalidraw/element/mutateElement";
import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawSelectionElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  QUICK_CREATE_GHOST_ARROW_ID,
  QUICK_CREATE_GHOST_SHAPE_ID,
} from "../components/App.quickCreate";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, fireEvent, render } from "./test-utils";

import type { Drawable } from "roughjs/bin/core";
import type { NormalizedZoomValue } from "../types";

const { h } = window;

const mouse = new Pointer("mouse");

/** 视图坐标为 0 偏移、zoom=1 时，场景坐标与视图坐标重合 */
const live = () => h.elements.filter((element) => !element.isDeleted);

const selectShape = (
  shape: NonDeletedExcalidrawElement,
  others: readonly NonDeletedExcalidrawElement[] = [],
) => {
  API.setElements([shape, ...others]);
  API.setSelectedElements([shape]);
  mouse.reset();
  // 基准历史：让随后的一次点击单独成为一步可撤销
  act(() => {
    h.app.store.scheduleCapture();
    h.app.scene.triggerUpdate();
  });
};

const createRectangle = (overrides: Record<string, unknown> = {}) =>
  API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 120,
    height: 80,
    ...overrides,
  });

/** 源 100,100–220,180，四边中点外移 22（常态与悬停共用同一圆心） */
const HANDLE_CENTERS = {
  top: { x: 160, y: 78 },
  right: { x: 242, y: 140 },
  bottom: { x: 160, y: 202 },
  left: { x: 78, y: 140 },
} as const;

const handleFor = (direction: "top" | "right" | "bottom" | "left") =>
  getQuickCreateHandles(h.app).find(
    (handle) => handle.direction === direction,
  )!;

const newShape = (sourceId: string) =>
  live().find(
    (element) => isCompositeShapeElement(element) && element.id !== sourceId,
  )!;

const newArrow = (sourceId: string) => {
  const element = live().find(
    (candidate) => candidate.type === "arrow" && candidate.id !== sourceId,
  );
  if (!isArrowElement(element)) {
    throw new Error("Expected an arrow");
  }
  return element;
};

const liveIds = () => live().map((element) => element.id);

/**
 * 本次新建的副本 / 连线：按 id 差集取。场景里本来就摆着别的图形（让位用例的
 * 占位图形）时，`newShape` 那种「第一个非源图形」的取法会取错。
 */
const createdShape = (before: readonly string[]): ExcalidrawElement => {
  const element = live().find(
    (candidate) =>
      isCompositeShapeElement(candidate) && !before.includes(candidate.id),
  );
  if (!element) {
    throw new Error("Expected a composite shape");
  }
  return element;
};

const createdArrow = (before: readonly string[]) => {
  const element = live().find(
    (candidate) => isArrowElement(candidate) && !before.includes(candidate.id),
  );
  if (!isArrowElement(element)) {
    throw new Error("Expected an arrow");
  }
  return element;
};

/** 连线点的**场景**坐标（元素里的 points 是相对 x/y 的局部坐标） */
const worldPoints = (element: ExcalidrawElement) =>
  isArrowElement(element)
    ? element.points.map(([x, y]) => ({ x: element.x + x, y: element.y + y }))
    : [];

/** 点到（可能旋转的）图形中心的「本体坐标」分量，用来判断是否落在轮廓上 */
const outlineRatio = (
  element: ExcalidrawElement,
  point: { x: number; y: number },
) => {
  const cos = Math.cos(-element.angle);
  const sin = Math.sin(-element.angle);
  const dx = point.x - (element.x + element.width / 2);
  const dy = point.y - (element.y + element.height / 2);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return Math.max(
    Math.abs(localX) / (element.width / 2),
    Math.abs(localY) / (element.height / 2),
  );
};

/** 三次贝塞尔求值：验证 K 落在曲线 t = 0.5 上、以及曲线离弦有多远 */
const cubicAt = (
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
) => {
  const u = 1 - t;
  return {
    x:
      u ** 3 * p0.x +
      3 * t * u ** 2 * p1.x +
      3 * t ** 2 * u * p2.x +
      t ** 3 * p3.x,
    y:
      u ** 3 * p0.y +
      3 * t * u ** 2 * p1.y +
      3 * t ** 2 * u * p2.y +
      t ** 3 * p3.y,
  };
};

/**
 * 连线**渲染出来**的曲线 ops（形状缓存里第一个 Drawable 就是连线本身的路径）。
 * 渲染、命中、碰撞、包围盒都以它为准，所以断言要落在它上面，而不是落在点上。
 */
const curveOps = (arrow: ExcalidrawElement) =>
  getCurvePathOps(
    (
      ShapeCache.generateElementShape(
        arrow as Exclude<ExcalidrawElement, ExcalidrawSelectionElement>,
        null,
      ) as unknown as Drawable[]
    )[0],
  );

/** 移动图形并跑一遍绑定更新（与拖拽提交同一条通路），连线因此整条重算 */
const moveShape = (element: ExcalidrawElement, dx: number, dy: number) => {
  const live = h.app.scene.getNonDeletedElement(element.id)!;
  act(() => {
    h.app.scene.mutateElement(live, { x: live.x + dx, y: live.y + dy });
    updateBoundElements(live, h.app.scene);
  });
};

/** 就地改连线的点（等价于拖动中间手柄 / 用户自己加过点的曲线） */
const setArrowPoints = (
  arrow: ExcalidrawElement,
  points: [number, number][],
  extra: Record<string, unknown> = {},
) => {
  const live = h.app.scene.getNonDeletedElement(
    arrow.id,
  )! as NonDeleted<ExcalidrawLinearElement>;
  act(() => {
    h.app.scene.mutateElement(live, {
      points: points.map(([x, y]) => pointFrom<LocalPoint>(x, y)),
      ...extra,
    } as ElementUpdate<NonDeleted<ExcalidrawLinearElement>>);
  });
};

describe("quick create handles", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  it("shows four handles outside the selection box of a single shape", () => {
    const shape = createRectangle();
    selectShape(shape);

    const handles = getQuickCreateHandles(h.app);
    expect(handles.map((handle) => handle.direction)).toEqual([
      "top",
      "right",
      "bottom",
      "left",
    ]);
    for (const handle of handles) {
      expect(handle.center).toEqual(HANDLE_CENTERS[handle.direction]);
    }
  });

  it("shows them for flowchart shapes too", () => {
    const shape = API.createElement({
      type: "fc-terminator",
      x: 100,
      y: 100,
      width: 120,
      height: 80,
    });
    selectShape(shape);
    expect(getQuickCreateHandles(h.app)).toHaveLength(4);
  });

  it("stays hidden for non-target selections", () => {
    const cases: Record<string, NonDeletedExcalidrawElement> = {
      stickynote: API.createElement({ type: "stickynote", x: 100, y: 100 }),
      arrow: API.createElement({ type: "arrow", x: 100, y: 100 }),
      text: API.createElement({ type: "text", x: 100, y: 100, text: "hi" }),
      frame: API.createElement({
        type: "frame",
        x: 100,
        y: 100,
        width: 400,
        height: 300,
      }),
      table: API.createElement({ type: "table", x: 100, y: 100 }),
      locked: createRectangle({ locked: true }),
    };
    for (const element of Object.values(cases)) {
      selectShape(element);
      expect(getQuickCreateHandles(h.app)).toHaveLength(0);
    }
  });

  it("stays hidden for a multi-selection", () => {
    const a = createRectangle();
    const b = createRectangle({ x: 400, y: 100 });
    API.setElements([a, b]);
    API.setSelectedElements([a, b]);
    expect(getQuickCreateHandles(h.app)).toHaveLength(0);
  });

  it("stays hidden for a mindmap node", () => {
    UI.clickTool("mindmap");
    new Pointer("mouse").clickAt(300, 240);
    const node = live().find(
      isMindmapNodeElement,
    )! as NonDeletedExcalidrawElement;
    act(() => {
      // 退出根节点文字编辑，让判定只落在元素类型上
      h.app.setState({ editingTextElement: null });
    });
    API.setSelectedElements([node]);
    expect(getQuickCreateHandles(h.app)).toHaveLength(0);
  });

  it("stays hidden in view mode", () => {
    const shape = createRectangle();
    selectShape(shape);
    expect(getQuickCreateHandles(h.app)).toHaveLength(4);
    act(() => {
      h.app.setState({ viewModeEnabled: true });
    });
    expect(getQuickCreateHandles(h.app)).toHaveLength(0);
  });

  it("keeps the handle screen size constant across zoom levels", () => {
    const shape = createRectangle();
    selectShape(shape);
    const atZoom1 = handleFor("right");

    act(() => {
      h.app.setState({ zoom: { value: 2 as NormalizedZoomValue } });
    });
    const atZoom2 = handleFor("right");
    // 场景坐标随 1/zoom 收缩，屏幕位置不变：外移 22 屏幕 px
    expect(atZoom1.center.x - 220).toBeCloseTo(22);
    expect(atZoom2.center.x - 220).toBeCloseTo(11);
    expect(atZoom1.offset).toBeCloseTo(22);
    expect(atZoom2.offset).toBeCloseTo(11);
    expect(atZoom1.size).toBeCloseTo(8);
    expect(atZoom2.size).toBeCloseTo(4);
    expect(atZoom2.hitSize).toBeCloseTo(atZoom1.hitSize / 2);
  });

  it("uses the compact tier when the element is under 40px on screen", () => {
    const small = createRectangle({ width: 30, height: 20 });
    selectShape(small);
    for (const handle of getQuickCreateHandles(h.app)) {
      expect(handle.compact).toBe(true);
      // 紧凑档：外移 18、常态点 ⌀6（屏幕 px 换算成场景单位）
      expect(handle.offset).toBeCloseTo(18);
      expect(handle.size).toBeCloseTo(6);
    }

    // 阈值是「低于 40」：屏幕最小边正好 40 仍走常规档
    const boundary = createRectangle({ x: 400, width: 40, height: 60 });
    selectShape(boundary);
    expect(handleFor("right").compact).toBe(false);
    expect(handleFor("right").offset).toBeCloseTo(22);
    expect(handleFor("right").size).toBeCloseTo(8);
  });

  it("judges the compact tier by screen size, not scene size", () => {
    const shape = createRectangle({ width: 200, height: 120 });
    selectShape(shape);
    // 屏幕 200×120：常规档
    expect(handleFor("right").compact).toBe(false);

    act(() => {
      h.app.setState({ zoom: { value: 0.4 as NormalizedZoomValue } });
    });
    // 屏幕 80×48，仍 ≥ 40：还是常规档，只是场景单位随 1/zoom 放大
    const atLowZoom = handleFor("right");
    expect(atLowZoom.compact).toBe(false);
    expect(atLowZoom.offset).toBeCloseTo(22 / 0.4);
    expect(atLowZoom.size).toBeCloseTo(8 / 0.4);
  });

  it("uses a 20px hit area for mouse and 32px for touch", () => {
    const shape = createRectangle();
    selectShape(shape);
    expect(handleFor("right").hitSize).toBeCloseTo(20);
    expect(getQuickCreateHandles(h.app, "touch")[0].hitSize).toBeCloseTo(32);
  });

  it("returns no handles and no hit while a modifier key is held", () => {
    const shape = createRectangle();
    selectShape(shape);
    const { center } = handleFor("right");
    // 不按住修饰键时命中，确认下面返回 null 是 suppressed 造成的
    expect(
      hitTestQuickCreateHandle(h.app, center.x, center.y, "mouse"),
    ).toEqual({ direction: "right", elementId: shape.id });

    expect(getQuickCreateHandles(h.app, "mouse", true)).toEqual([]);
    expect(
      hitTestQuickCreateHandle(h.app, center.x, center.y, "mouse", true),
    ).toBeNull();
  });

  it("hides and disables the handles end to end while a modifier key is held", () => {
    const shape = createRectangle();
    selectShape(shape);
    const { center } = handleFor("right");
    const held = () => h.app.quickCreate.isSuppressed();
    // 渲染层与命中层各自读同一个开关（见 renderer/interactiveScene.ts:1621
    // 与 AppQuickCreate.hitTest）
    const rendered = () =>
      getQuickCreateHandles(h.app, "mouse", h.app.quickCreate.isSuppressed());
    const hit = () => h.app.quickCreate.hitTest(center.x, center.y);

    // 事件由 ownerDocument 上的 keydown/keyup 路由（见 components/app/eventListeners.ts）
    fireEvent.keyDown(h.app.ownerDocument, { key: "Shift", shiftKey: true });
    expect(held()).toBe(true);
    expect(rendered()).toHaveLength(0);
    expect(hit()).toBeNull();
    // 悬停也不会残留加号形态
    mouse.moveTo(center.x, center.y);
    expect(h.app.quickCreate.getHovered()).toBeNull();

    // 长按重复触发 keydown 不会卡住状态
    fireEvent.keyDown(h.app.ownerDocument, { key: "Shift", shiftKey: true });
    expect(held()).toBe(true);

    // 松开 shift 时 keyup 事件上的 shiftKey 已为 false
    fireEvent.keyUp(h.app.ownerDocument, { key: "Shift" });
    expect(held()).toBe(false);
    expect(rendered()).toHaveLength(4);
    expect(hit()).toEqual({ direction: "right", elementId: shape.id });

    // 非修饰键不改变状态
    fireEvent.keyDown(h.app.ownerDocument, { key: "a" });
    fireEvent.keyUp(h.app.ownerDocument, { key: "a" });
    expect(held()).toBe(false);
  });

  describe("yielding to elements under the pointer", () => {
    /** 落在源右手柄热区（242,140）里的另一个图形 */
    const blocker = () =>
      API.createElement({
        type: "rectangle",
        x: 230,
        y: 130,
        width: 40,
        height: 40,
      });

    it("does not hover or take over the click when an element sits under the handle", () => {
      const source = createRectangle();
      const other = blocker();
      API.setElements([source, other]);
      API.setSelectedElements([source]);
      mouse.reset();

      // 手柄本身照常渲染（画在指示框外侧是设计稿的行为），只是不接管指针
      expect(getQuickCreateHandles(h.app)).toHaveLength(4);

      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      expect(h.app.quickCreate.getHovered()).toBeNull();

      mouse.downAt(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      mouse.upAt();
      // 没有建图/连线，手势让给了选择
      expect(live()).toHaveLength(2);
      expect(h.app.scene.getSelectedElements(h.app.state)).toEqual([other]);
    });

    it("still takes over when the element under the pointer is locked", () => {
      // 锁定元素不参与命中（getElementAtPosition 默认排除），点击也选不中
      // 它，让位没有意义——手柄照常接管。
      const source = createRectangle();
      const locked = API.createElement({
        type: "rectangle",
        x: 230,
        y: 130,
        width: 40,
        height: 40,
        locked: true,
      });
      API.setElements([source, locked]);
      API.setSelectedElements([source]);
      mouse.reset();
      const before = live().map((element) => element.id);

      expect(
        h.app.getElementAtPosition(
          HANDLE_CENTERS.right.x,
          HANDLE_CENTERS.right.y,
        ),
      ).toBeNull();

      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      expect(h.app.quickCreate.getHovered()).toEqual({
        direction: "right",
        elementId: source.id,
      });

      mouse.downAt(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      mouse.upAt();
      // 连线和副本都建了出来
      expect(
        live()
          .filter((element) => !before.includes(element.id))
          .map((element) => element.type)
          .sort(),
      ).toEqual(["arrow", "composite_shape"]);
    });

    /**
     * 让功能自己建出一份副本 + 一条绑定源的连线，然后把选中切回源元素。
     * 不能用 `selectShape` 回去：它会 `setElements`，把刚建的连线一起清掉，
     * 那这条用例就空了。
     */
    const createCopyAndReselectSource = () => {
      const source = createRectangle();
      selectShape(source);
      mouse.clickAt(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      const arrow = newArrow(source.id);
      const copy = newShape(source.id) as NonDeletedExcalidrawElement;
      expect(live()).toHaveLength(3);
      expect(arrow.startBinding?.elementId).toBe(source.id);
      expect(arrow.endBinding?.elementId).toBe(copy.id);
      API.setSelectedElements([source]);
      mouse.reset();
      return { source, copy, arrow };
    };

    it("does not yield to the source's own outgoing arrow", () => {
      // 功能建的连线从图形边中点 (220,140) 朝外走到副本 (350,140)，而右手柄
      // 圆心 (242,140) 在同一条外法线上——连线必然压在圆心正上方。一条 1–2px
      // 的线不该否决手柄，否则任何带出边的图形（流程图节点）四边手柄全成死的。
      const { source, arrow } = createCopyAndReselectSource();

      expect(
        h.app.getElementAtPosition(
          HANDLE_CENTERS.right.x,
          HANDLE_CENTERS.right.y,
        )?.id,
      ).toBe(arrow.id);

      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      expect(h.app.quickCreate.getHovered()).toEqual({
        direction: "right",
        elementId: source.id,
      });
      expect(
        h.app.quickCreate.hitTest(
          HANDLE_CENTERS.right.x,
          HANDLE_CENTERS.right.y,
        ),
      ).toEqual({ direction: "right", elementId: source.id });

      // 再点一次照常建图：又长出一份副本与一条连线
      mouse.downAt(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      mouse.upAt();
      expect(live()).toHaveLength(5);
      expect(live().filter(isArrowElement)).toHaveLength(2);
      expect(live().filter(isCompositeShapeElement)).toHaveLength(3);
      expect(newShape(source.id)).toMatchObject({ x: 350, y: 100 });
    });

    it("keeps the copy's back-pointing handle alive too", () => {
      // 副本左边手柄圆心 (328,140) 同样落在同一条连线（220,140 → 350,140）上；
      // 用一次功能之后，副本朝回指的那个手柄不能立刻变死。
      const { copy, arrow } = createCopyAndReselectSource();
      const back = { x: copy.x - 22, y: copy.y + copy.height / 2 };
      expect(back).toEqual({ x: 328, y: 140 });

      API.setSelectedElements([copy]);
      mouse.reset();

      expect(h.app.getElementAtPosition(back.x, back.y)?.id).toBe(arrow.id);

      mouse.moveTo(back.x, back.y);
      expect(h.app.quickCreate.getHovered()).toEqual({
        direction: "left",
        elementId: copy.id,
      });
      expect(h.app.quickCreate.hitTest(back.x, back.y)).toEqual({
        direction: "left",
        elementId: copy.id,
      });
    });

    it("stays usable when the source sits in a frame", () => {
      // 画框只在其边框/标题上被命中：把源贴到画框右边框内侧，右圆点正好落
      // 在画框边框上，这样指针确实压在画框上（否则这条用例是空的）。
      const frame = API.createElement({
        type: "frame",
        x: 100,
        y: 100,
        width: 300,
        height: 200,
      });
      const source = createRectangle({
        x: 300,
        y: 140,
        width: 78,
        height: 80,
        containerRef: { kind: "frameLike", elementId: frame.id },
      });
      API.setElements([frame, source]);
      API.setSelectedElements([source]);
      mouse.reset();

      const right = handleFor("right").center;
      expect(right).toEqual({ x: 400, y: 180 });
      expect(h.app.getElementAtPosition(right.x, right.y)?.id).toBe(frame.id);

      mouse.moveTo(right.x, right.y);
      expect(h.app.quickCreate.getHovered()).toEqual({
        direction: "right",
        elementId: source.id,
      });

      mouse.downAt(right.x, right.y);
      mouse.upAt();
      expect(live()).toHaveLength(4);
      expect(newShape(source.id)).toMatchObject({ x: 508, y: 140 });
    });
  });

  describe("creating a connected copy", () => {
    const clickDirection = (direction: "top" | "right" | "bottom" | "left") => {
      const { center } = handleFor(direction);
      mouse.downAt(center.x, center.y);
      mouse.upAt();
    };

    const DIRECTIONS: {
      direction: "top" | "right" | "bottom" | "left";
      position: { x: number; y: number };
      /** 垂直于移动方向的那一轴应与源中点对齐 */
      aligned: { axis: "x" | "y"; value: number };
    }[] = [
      {
        direction: "right",
        position: { x: 350, y: 100 },
        aligned: { axis: "y", value: 140 },
      },
      {
        direction: "left",
        position: { x: -150, y: 100 },
        aligned: { axis: "y", value: 140 },
      },
      {
        direction: "bottom",
        position: { x: 100, y: 270 },
        aligned: { axis: "x", value: 160 },
      },
      {
        direction: "top",
        position: { x: 100, y: -70 },
        aligned: { axis: "x", value: 160 },
      },
    ];

    it.each(DIRECTIONS)(
      "places the copy $direction of the source with the preset gap",
      ({ direction, position, aligned }) => {
        const source = createRectangle();
        selectShape(source);
        clickDirection(direction);

        const copy = newShape(source.id);
        expect(copy).toMatchObject({
          x: position.x,
          y: position.y,
          width: 120,
          height: 80,
        });
        // 另一轴与源中点对齐（连线保持水平/垂直）
        const copyCenter =
          aligned.axis === "x"
            ? copy.x + copy.width / 2
            : copy.y + copy.height / 2;
        expect(copyCenter).toBeCloseTo(aligned.value);
      },
    );

    it("keeps the gap independent from the source size", () => {
      const small = createRectangle();
      selectShape(small);
      clickDirection("right");
      const smallCopy = newShape(small.id);
      expect(smallCopy.x - (small.x + small.width)).toBe(130);

      act(() => {
        h.app.setState({ selectedElementIds: {} });
      });
      const large = createRectangle({
        x: 100,
        y: 100,
        width: 300,
        height: 150,
      });
      selectShape(large);
      clickDirection("bottom");
      const largeCopy = newShape(large.id);
      expect(largeCopy.y - (large.y + large.height)).toBe(90);
    });

    it("copies every visual property except text and bindings", () => {
      const source = createRectangle({
        angle: 30,
        strokeColor: "#ff0000",
        backgroundColor: "#00ff00",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "dashed",
        opacity: 50,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 32 },
        groupIds: ["group-a"],
        boundElements: [{ id: "old-arrow", type: "arrow" }],
      });
      selectShape(source);
      clickDirection("right");

      const copy = newShape(source.id);
      expect(copy).toMatchObject({
        type: "composite_shape",
        shape: { id: "rectangle" },
        width: 120,
        height: 80,
        angle: 30,
        strokeColor: "#ff0000",
        backgroundColor: "#00ff00",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "dashed",
        opacity: 50,
      });
      // 边框圆角与源逐字节一致
      expect(copy.roundness).toEqual(source.roundness);
      expect(copy.roundness).not.toBeNull();
      expect(copy.id).not.toBe(source.id);
      // 文字、分组、容器与原有绑定都不继承
      expect("text" in copy ? (copy as { text?: string }).text ?? "" : "").toBe(
        "",
      );
      expect(copy.groupIds).toEqual([]);
      expect(copy.containerRef).toBeUndefined();
      expect(
        copy.boundElements?.some((bound) => bound.id === "old-arrow") ?? false,
      ).toBe(false);
    });

    it("connects the two shapes with one arrow carrying the current styles", () => {
      const source = createRectangle();
      selectShape(source);
      act(() => {
        h.app.setState({
          currentItemStrokeColor: "#ff00ff",
          currentItemStartArrowhead: "triangle",
          currentItemEndArrowhead: "circle",
          currentItemStrokeStyle: "dotted",
        });
      });
      clickDirection("right");

      const copy = newShape(source.id);
      const arrows = live().filter((element) => element.type === "arrow");
      expect(arrows).toHaveLength(1);
      const arrow = newArrow(source.id);
      expect(arrow.startBinding?.elementId).toBe(source.id);
      expect(arrow.endBinding?.elementId).toBe(copy.id);
      expect(arrow).toMatchObject({
        strokeColor: "#ff00ff",
        strokeStyle: "dotted",
        startArrowhead: "triangle",
        endArrowhead: "circle",
      });
      // 绑定两端都记在图形的 boundElements 上
      expect(copy.boundElements?.some((bound) => bound.id === arrow.id)).toBe(
        true,
      );
    });

    it.each(["elbow", "round"] as const)(
      "follows the current arrow type (%s)",
      (arrowType) => {
        const source = createRectangle();
        selectShape(source);
        act(() => {
          h.app.setState({ currentItemArrowType: arrowType });
        });
        clickDirection("right");

        const arrow = newArrow(source.id);
        expect(arrow.elbowed).toBe(arrowType === "elbow");
        expect(arrow.roundness).toEqual(
          arrowType === "round"
            ? { type: ROUNDNESS.PROPORTIONAL_RADIUS }
            : null,
        );
      },
    );

    it("still lets the side resize handle resize", () => {
      const source = createRectangle();
      selectShape(source);
      // 侧边缩放胶囊的几何中心（边外 4px）不在圆点热区内，这一点仍是缩放
      UI.resize(source, "e", [30, 0]);
      expect(live()).toHaveLength(1);
      expect(h.app.scene.getNonDeletedElement(source.id)).toMatchObject({
        width: 150,
        height: 80,
      });
    });

    it("keeps the dots and the copy on the rotated box when the source is rotated", () => {
      const source = createRectangle({ angle: Math.PI / 4 });
      selectShape(source);

      // 本地框（100,100–220,180）边中点外移 22 后绕中心 (160,140) 旋转 45°
      const centers = Object.fromEntries(
        getQuickCreateHandles(h.app).map((handle) => [
          handle.direction,
          handle.center,
        ]),
      ) as Record<
        "top" | "right" | "bottom" | "left",
        { x: number; y: number }
      >;
      expect(centers.right.x).toBeCloseTo(217.9828, 3);
      expect(centers.right.y).toBeCloseTo(197.9828, 3);
      expect(centers.bottom.x).toBeCloseTo(116.1594, 3);
      expect(centers.bottom.y).toBeCloseTo(183.8406, 3);
      expect(centers.left.x).toBeCloseTo(102.0172, 3);
      expect(centers.left.y).toBeCloseTo(82.0172, 3);
      expect(centers.top.x).toBeCloseTo(203.8406, 3);
      expect(centers.top.y).toBeCloseTo(96.1594, 3);
      // 45° 时下圆点沿旋转方向落位，不再停在未旋转的 (160,202)
      expect(centers.bottom.y).toBeLessThan(202);

      mouse.downAt(centers.right.x, centers.right.y);
      mouse.upAt();

      const copy = newShape(source.id);
      expect(copy.angle).toBeCloseTo(Math.PI / 4);
      const copyCenter = {
        x: copy.x + copy.width / 2,
        y: copy.y + copy.height / 2,
      };
      // 沿旋转 45° 的方向落位：中心位移 160/√2 + 130/√2 + 60/√2 = 250/√2
      expect(copyCenter.x - 160).toBeCloseTo(250 / Math.SQRT2, 3);
      expect(copyCenter.y - 140).toBeCloseTo(250 / Math.SQRT2, 3);
      // 沿该轴量的边缘间隙仍是 130
      const centerDistance = Math.hypot(copyCenter.x - 160, copyCenter.y - 140);
      expect(centerDistance - copy.width / 2 - source.width / 2).toBeCloseTo(
        130,
      );
    });

    it("does not inherit the source's frame membership", () => {
      const frame = API.createElement({
        type: "frame",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      });
      const source = API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 120,
        height: 80,
        containerRef: { kind: "frameLike", elementId: frame.id },
      });
      API.setElements([frame, source]);
      API.setSelectedElements([source]);
      mouse.reset();
      act(() => {
        h.app.store.scheduleCapture();
        h.app.scene.triggerUpdate();
      });

      clickDirection("right");

      const copy = newShape(source.id);
      expect(copy.containerRef).toBeUndefined();
      expect((copy as { frameId?: string | null }).frameId ?? null).toBeNull();
      expect(
        getContainingFrame(copy, h.app.scene.getNonDeletedElementsMap()),
      ).toBeNull();
    });

    it("selects only the copy and undoes both in one step", () => {
      const source = createRectangle();
      selectShape(source);
      const undoStepsBefore = API.getUndoStack().length;
      clickDirection("right");

      const copy = newShape(source.id);
      expect(Object.keys(h.state.selectedElementIds)).toEqual([copy.id]);
      expect(live()).toHaveLength(3);
      // 副本与连线同属一步
      expect(API.getUndoStack()).toHaveLength(undoStepsBefore + 1);

      Keyboard.undo();
      expect(live()).toHaveLength(1);
      expect(live()[0].id).toBe(source.id);

      Keyboard.redo();
      expect(live()).toHaveLength(3);
    });

    it("keeps a locked source inert", () => {
      const source = createRectangle({ locked: true });
      selectShape(source);
      // 命中区不存在，点击只按空白处处理
      mouse.downAt(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      mouse.upAt();
      expect(live()).toHaveLength(1);
    });
  });

  describe("spilling the copy along the absolute axis", () => {
    /** 源 120×80 在 (100,100)：中心 (160,140)，右手柄基准位中心 (410,140) */
    const RIGHT_BASE = { x: 410, y: 140 };
    /** 下手柄基准位中心：源下边 140+90+40 = 280 偏移 */
    const BOTTOM_BASE = { x: 160, y: 310 };
    /** 左右手柄沿绝对 Y 让位、档距 = 1.75 × 副本高(80) = 140；上下手柄沿绝对 X、1.75 × 宽(120) = 210 */
    const RIGHT_STEP = 140;
    const BOTTOM_STEP = 210;

    /** 与副本同尺寸的占位图形：摆在哪一档就占掉哪一档 */
    const blocker = (
      center: { x: number; y: number },
      extra: Record<string, unknown> = {},
    ) =>
      API.createElement({
        type: "rectangle",
        x: center.x - 60,
        y: center.y - 40,
        width: 120,
        height: 80,
        ...extra,
      });

    const clickHandle = (direction: "top" | "right" | "bottom" | "left") => {
      const { center } = handleFor(direction);
      mouse.downAt(center.x, center.y);
      mouse.upAt();
    };

    const placeAndClick = (
      others: readonly NonDeletedExcalidrawElement[],
      direction: "top" | "right" | "bottom" | "left",
      arrowType: "sharp" | "round" | "elbow" = "sharp",
    ) => {
      const source = createRectangle();
      selectShape(source, others);
      act(() => {
        h.app.setState({ currentItemArrowType: arrowType });
      });
      const before = liveIds();
      clickHandle(direction);
      return {
        source,
        copy: createdShape(before),
        arrow: createdArrow(before),
      };
    };

    const copyCenter = (copy: ExcalidrawElement) => ({
      x: copy.x + copy.width / 2,
      y: copy.y + copy.height / 2,
    });

    it.each(["sharp", "round", "elbow"] as const)(
      "keeps the base spot and a two-point straight connector when it is free (%s)",
      (arrowType) => {
        const source = createRectangle();
        selectShape(source);
        act(() => {
          h.app.setState({ currentItemArrowType: arrowType });
        });
        const before = liveIds();
        clickHandle("right");

        const copy = createdShape(before);
        expect(copy).toMatchObject({ x: 350, y: 100 });
        const points = worldPoints(createdArrow(before));
        // 轴向对齐：两点直线，从左往右、同一高度。端点正好贴在两图形的朝对侧
        // 边缘上（几像素的出入来自 orbit 绑定把端点落到轮廓上，不属于落位几何）
        expect(points).toHaveLength(2);
        expect(points[0].y).toBeCloseTo(140, 0);
        expect(points[1].y).toBeCloseTo(140, 0);
        expect(Math.abs(points[0].x - 220)).toBeLessThan(10);
        expect(Math.abs(points[1].x - 350)).toBeLessThan(10);
        expect(points[0].x).toBeLessThan(points[1].x);
      },
    );

    it("spills 上 1 when the base spot is taken, and bends the connector there", () => {
      const { copy, arrow } = placeAndClick([blocker(RIGHT_BASE)], "right");

      // ① 上 1 = 基准位沿**绝对 Y** 上移一档（不随旋转改变）
      expect(copyCenter(copy)).toEqual({
        x: RIGHT_BASE.x,
        y: RIGHT_BASE.y - RIGHT_STEP,
      });
      expect(copy).toMatchObject({ x: 350, y: -40, width: 120, height: 80 });

      // 折线四点：出口 A(220,140) → 转折线 x = 285 上的两个拐角 → 入口 D(350,0)
      expect(arrow.points).toHaveLength(4);
      expect(worldPoints(arrow)).toEqual([
        { x: 220, y: 140 },
        { x: 285, y: 140 },
        { x: 285, y: 0 },
        { x: 350, y: 0 },
      ]);
      // 入口落在副本朝源一侧的**轮廓**上（左边中段，不是包围盒角）
      const entry = worldPoints(arrow)[3];
      expect(outlineRatio(copy, entry)).toBeCloseTo(1);
      expect(entry.x).toBeCloseTo(copy.x);
      expect(entry.y).toBeCloseTo(copy.y + copy.height / 2);
    });

    it("tries 下 1 next, then 上 2, each measured from the base", () => {
      const first = placeAndClick(
        [
          blocker(RIGHT_BASE),
          blocker({ x: RIGHT_BASE.x, y: RIGHT_BASE.y - RIGHT_STEP }),
        ],
        "right",
      );
      // ② 下 1 = 基准位 + 1 档
      expect(copyCenter(first.copy)).toEqual({
        x: RIGHT_BASE.x,
        y: RIGHT_BASE.y + RIGHT_STEP,
      });

      const second = placeAndClick(
        [
          blocker(RIGHT_BASE),
          blocker({ x: RIGHT_BASE.x, y: RIGHT_BASE.y - RIGHT_STEP }),
          blocker({ x: RIGHT_BASE.x, y: RIGHT_BASE.y + RIGHT_STEP }),
        ],
        "right",
      );
      // ③ 上 2 = 基准位 − 2 档（从基准位直接算，不逐档累加）
      expect(copyCenter(second.copy)).toEqual({
        x: RIGHT_BASE.x,
        y: RIGHT_BASE.y - 2 * RIGHT_STEP,
      });
      expect(second.copy).toMatchObject({ x: 350, y: -180 });
    });

    it("spills 右 1 from the bottom handle when the base and 左 1 are taken", () => {
      const { copy, arrow } = placeAndClick(
        [
          blocker(BOTTOM_BASE),
          blocker({ x: BOTTOM_BASE.x - BOTTOM_STEP, y: BOTTOM_BASE.y }),
        ],
        "bottom",
      );

      // 下手柄沿**绝对 X** 扩散、步长 = 1.75 × 副本宽 = 210：② 右 1 = (370,310)
      expect(copyCenter(copy)).toEqual({
        x: BOTTOM_BASE.x + BOTTOM_STEP,
        y: BOTTOM_BASE.y,
      });
      expect(copy).toMatchObject({ x: 310, y: 270 });
      // 竖向手柄的转折线是 y = (180 + 270) / 2 = 225
      expect(worldPoints(arrow)).toEqual([
        { x: 160, y: 180 },
        { x: 160, y: 225 },
        { x: 370, y: 225 },
        { x: 370, y: 270 },
      ]);
      expect(outlineRatio(copy, worldPoints(arrow)[3])).toBeCloseTo(1);
    });

    it("spills along the absolute axis and lands on the rotated copy's outline", () => {
      const angle = Math.PI / 6;
      const source = createRectangle({ angle });
      // 基准位仍是老规则：源中心沿旋转后的方向向量外移 250
      const base = {
        x: 160 + 250 * Math.cos(angle),
        y: 140 + 250 * Math.sin(angle),
      };
      selectShape(source, [blocker(base)]);
      act(() => {
        h.app.setState({ currentItemArrowType: "sharp" });
      });
      const before = liveIds();
      clickHandle("right");

      const copy = createdShape(before);
      const arrow = createdArrow(before);
      const center = copyCenter(copy);
      // 让位方向**不跟着转**：沿绝对 Y 上移一档，x 与基准位一致
      expect(center.x).toBeCloseTo(base.x);
      expect(center.y).toBeCloseTo(base.y - RIGHT_STEP);
      expect(copy.angle).toBeCloseTo(angle);

      const entry = worldPoints(arrow)[3];
      // 入口落在**旋转后**的轮廓上、与副本中心同高（绝对水平线）
      expect(entry.y).toBeCloseTo(center.y);
      expect(outlineRatio(copy, entry)).toBeCloseTo(1);
      // 取包围盒当轮廓的话会落在 中心 − (120·cos30 + 80·sin30)/2 ≈ 中心 − 71.96，
      // 而真轮廓（本体坐标 |x| = 半宽 60）在 中心 − 60/cos30 ≈ 中心 − 69.28
      expect(entry.x).toBeCloseTo(base.x - 60 / Math.cos(angle), 6);
      expect(entry.x).not.toBeCloseTo(base.x - 71.9615, 1);
    });

    it("falls back to the base spot when all ten candidates are taken", () => {
      const candidates = [1, 2, 3, 4, 5].flatMap((k) => [
        { x: RIGHT_BASE.x, y: RIGHT_BASE.y - k * RIGHT_STEP },
        { x: RIGHT_BASE.x, y: RIGHT_BASE.y + k * RIGHT_STEP },
      ]);
      const { copy, arrow } = placeAndClick(
        [blocker(RIGHT_BASE), ...candidates.map((center) => blocker(center))],
        "right",
      );

      // 10 档全被占：回落基准位——副本与连线照建，宁可叠上也不能「点了没反应」
      expect(copyCenter(copy)).toEqual(RIGHT_BASE);
      expect(copy).toMatchObject({ x: 350, y: 100 });
      expect(arrow.endBinding?.elementId).toBe(copy.id);
      expect(arrow.points.length).toBeGreaterThan(0);
    });

    it("still counts a locked shape as an obstacle", () => {
      const { copy } = placeAndClick(
        [blocker(RIGHT_BASE, { locked: true })],
        "right",
      );
      // 让位规则里锁定元素不算「指针压着」，但落点上它占着地方，副本得让开
      expect(copyCenter(copy)).toEqual({
        x: RIGHT_BASE.x,
        y: RIGHT_BASE.y - RIGHT_STEP,
      });
    });

    it("counts a mindmap node as an obstacle", () => {
      const node = API.createElement({
        type: "mindmap-node",
        x: RIGHT_BASE.x - 60,
        y: RIGHT_BASE.y - 40,
        width: 120,
        height: 80,
        mindmap: {
          graphId: "mm",
          parentId: null,
          order: null,
          shape: { id: "rectangle", schemaVersion: 1 },
          collapsed: false,
        },
      });
      const source = createRectangle();
      selectShape(source, [node]);
      const before = liveIds();
      clickHandle("right");

      expect(copyCenter(createdShape(before))).toEqual({
        x: RIGHT_BASE.x,
        y: RIGHT_BASE.y - RIGHT_STEP,
      });
    });

    it("ignores arrows, text and the source's own bound outgoing arrow", () => {
      // 横穿基准位的箭头 + 压在基准位上的文本：都不算占用。箭头还记在源的
      // boundElements 里（源自己的出边箭头就是这种），同样不算。
      const source = createRectangle({
        boundElements: [{ id: "crossing-arrow", type: "arrow" }],
      });
      const crossing = API.createElement({
        type: "arrow",
        id: "crossing-arrow",
        x: 300,
        y: 140,
        width: 200,
        height: 0,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
      });
      const text = API.createElement({
        type: "text",
        x: 350,
        y: 100,
        width: 120,
        height: 80,
        text: "hi",
      });
      selectShape(source, [crossing, text]);
      const before = liveIds();
      clickHandle("right");

      // 佐证用例不是空的：箭头与文本的包围盒都压着基准位
      expect(crossing.x).toBeLessThan(RIGHT_BASE.x - 60);
      expect(crossing.x + crossing.width).toBeGreaterThan(RIGHT_BASE.x + 60);
      expect(text.x).toBe(350);

      expect(copyCenter(createdShape(before))).toEqual(RIGHT_BASE);
    });

    it("ignores a freedraw scribble over the candidate", () => {
      const source = createRectangle();
      const scribble = API.createElement({
        type: "freedraw",
        x: 350,
        y: 100,
        width: 120,
        height: 80,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(120, 80)],
      });
      selectShape(source, [scribble]);
      const before = liveIds();
      clickHandle("right");

      expect(copyCenter(createdShape(before))).toEqual(RIGHT_BASE);
    });

    describe("connector style handling", () => {
      it("turns the sharp arrow into a four-point polyline", () => {
        const { arrow } = placeAndClick(
          [blocker(RIGHT_BASE)],
          "right",
          "sharp",
        );

        expect(arrow.points).toHaveLength(4);
        expect(arrow.elbowed).toBe(false);
        // 折线要的就是直角折线，不能留圆角（留着会被画成圆角拐弯）
        expect(arrow.roundness).toBeNull();
        expect(worldPoints(arrow)[1]).toEqual({ x: 285, y: 140 });
      });

      it("leaves the elbow arrow to the built-in orthogonal router", () => {
        const { arrow } = placeAndClick(
          [blocker(RIGHT_BASE)],
          "right",
          "elbow",
        );

        // 老行为：仍旧 elbowed，路径由内置正交路由算——不把我们算出来的那四个
        // 拐点塞给它（塞进去会绕开它自己那一套布线）
        expect(arrow.elbowed).toBe(true);
        expect(arrow.roundness).toBeNull();
        const points = worldPoints(arrow);
        for (let index = 1; index < points.length; index++) {
          expect(
            points[index - 1].x === points[index].x ||
              points[index - 1].y === points[index].y,
          ).toBe(true);
        }
      });

      it("takes the landed three points from the model, not from the creation path", () => {
        const source = createRectangle();
        selectShape(source, [blocker(RIGHT_BASE)]);
        act(() => {
          h.app.setState({ currentItemArrowType: "round" });
        });
        const before = liveIds();
        clickHandle("right");
        const arrow = createdArrow(before);

        // 只存 A、K、D 三个点，而且创建路径根本没解过弯曲几何（占位三点是源中心 /
        // 副本中心 / 两者中点）：落地三点必须等于模型对同一对两端的输出
        expect(arrow.roundness).toEqual({
          type: ROUNDNESS.PROPORTIONAL_RADIUS,
        });
        expect(arrow.elbowed).toBe(false);
        expect(arrow.points).toHaveLength(3);
        const fromModel = recomputeCurveConnector(
          arrow as NonDeleted<ExcalidrawArrowElement>,
          h.app.scene.getNonDeletedElementsMap(),
        )!;
        // 再算一遍结果不变（模型对同一状态的解是可重复的；允许浮点级出入）
        expect(fromModel).toHaveLength(3);
        for (let index = 0; index < 3; index++) {
          expect(fromModel[index][0]).toBeCloseTo(arrow.points[index][0], 2);
          expect(fromModel[index][1]).toBeCloseTo(arrow.points[index][1], 2);
        }
        // 两端点是绑定解出来的（在轮廓外一个 binding gap 上），不是创建时算的
        // 出口 (220,140) / 入口 (350,0)
        expect(worldPoints(arrow)[0]).not.toEqual({ x: 220, y: 140 });
        expect(outlineRatio(source, worldPoints(arrow)[0])).toBeGreaterThan(1);

        const points = worldPoints(arrow);
        // 控制点由两端推导（转折线在两端中点的轴上位置）：c1 与 A 同高、c2 与 D
        // 同高 → 两端切线水平，箭头方向永远水平；K 是曲线 t = 0.5 处的点
        const [A, K, D] = points;
        const turn = (A.x + D.x) / 2;
        const c1 = { x: turn, y: A.y };
        const c2 = { x: turn, y: D.y };
        expect(cubicAt(A, c1, c2, D, 0.5).x).toBeCloseTo(K.x, 6);
        expect(cubicAt(A, c1, c2, D, 0.5).y).toBeCloseTo(K.y, 6);

        // 渲染走的就是这条三次贝塞尔（形状 ops）：首段第一个控制点与 A 同高、
        // 末段最后一个控制点与 D 同高（局部坐标里 A 归零，D 是相对 A 的偏移）
        const ops = curveOps(arrow);
        const localD = { x: D.x - arrow.x, y: D.y - arrow.y };
        expect(ops[0].op).toBe("move");
        expect(ops[1].op).toBe("bcurveTo");
        expect(ops[1].data[1]).toBeCloseTo(0, 6);
        expect(ops[ops.length - 1].op).toBe("bcurveTo");
        expect(ops[ops.length - 1].data[3]).toBeCloseTo(localD.y, 6);
        // 画出来的**箭头方向**取首末段的弦（bounds.ts 的 getArrowheadPoints），
        // 所以段要短才贴得住切线：两端弦都近水平
        const lastOp = ops.length - 1;
        expect(
          Math.abs(
            (ops[1].data[5] - ops[0].data[1]) /
              (ops[1].data[4] - ops[0].data[0]),
          ),
        ).toBeLessThan(0.05);
        expect(
          Math.abs(
            (ops[lastOp].data[5] - ops[lastOp - 1].data[1]) /
              (ops[lastOp].data[4] - ops[lastOp - 1].data[0]),
          ),
        ).toBeLessThan(0.05);
      });
    });

    it("previews the spilled copy and the very same connector while hovering", () => {
      const source = createRectangle();
      selectShape(source, [blocker(RIGHT_BASE)]);
      act(() => {
        h.app.setState({ currentItemArrowType: "sharp" });
      });

      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      const ghost = h.app.quickCreate.getGhostElements(handleFor("right"));
      const before = liveIds();
      clickHandle("right");
      const copy = createdShape(before);
      const arrow = createdArrow(before);

      // 预演落在让位后的位置上，连线点与落地**逐个一致**（所见即所得）
      expect(ghost[0]).toMatchObject({ x: copy.x, y: copy.y });
      expect(worldPoints(ghost[1])).toEqual(worldPoints(arrow));
      expect(worldPoints(ghost[1])).toHaveLength(4);
      // 预演与落地都是那四个拐点，预演没有消耗共享的 id
      expect(arrow.id).not.toBe(QUICK_CREATE_GHOST_ARROW_ID);
    });

    it("previews the round arrow as the very same three-point curve", () => {
      const source = createRectangle();
      selectShape(source, [blocker(RIGHT_BASE)]);
      act(() => {
        h.app.setState({ currentItemArrowType: "round" });
      });

      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      const ghost = h.app.quickCreate.getGhostElements(handleFor("right"));
      const ghostOps = curveOps(ghost[1]);

      const before = liveIds();
      clickHandle("right");
      const arrow = createdArrow(before);

      // 预演与落地**逐点**一致：A、K、D 三点
      expect(worldPoints(ghost[1])).toHaveLength(3);
      expect(worldPoints(ghost[1])).toEqual(worldPoints(arrow));
      // 连渲染出来的曲线也一样：轴向是渲染时从绑定解的，预演元素替上等效绑定
      // （fixedPoint 与落地同源）才画得出同一条曲线
      expect(curveOps(arrow)).toEqual(ghostOps);
    });

    it("previews the elbow arrow with the same fold points", () => {
      const source = createRectangle();
      selectShape(source, [blocker(RIGHT_BASE)]);
      act(() => {
        h.app.setState({ currentItemArrowType: "elbow" });
      });

      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      const ghost = h.app.quickCreate.getGhostElements(handleFor("right"));

      // 预演没有绑定可依、内置正交路由跑不起来，所以直接画同一套拐点
      // （画成「源中心 → 副本中心」的斜直线就是老版的不贴合之处）
      expect(worldPoints(ghost[1])).toEqual([
        { x: 220, y: 140 },
        { x: 285, y: 140 },
        { x: 285, y: 0 },
        { x: 350, y: 0 },
      ]);
      expect(ghost[1]).toMatchObject({ elbowed: true, roundness: null });
    });

    it("rebuilds the preview when the scene changes the landing spot", () => {
      const source = createRectangle();
      selectShape(source);
      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      const before = h.app.quickCreate.getGhostElements(handleFor("right"));
      expect(before[0]).toMatchObject({ x: 350, y: 100 });

      // 基准位被占：落点变了，预演必须跟着重建——缓存键里带着解出来的落点，
      // 否则场景一变还会画着上一帧的旧位置
      const versionBefore = source.version;
      API.setElements([source, blocker(RIGHT_BASE)]);
      API.setSelectedElements([source]);
      // 源自己的 version 没变：这次重建只能靠落点进缓存键，否则用例是空的
      expect(h.app.scene.getNonDeletedElement(source.id)?.version).toBe(
        versionBefore,
      );
      const after = h.app.quickCreate.getGhostElements(handleFor("right"));
      expect(after).not.toBe(before);
      expect(after[0]).toMatchObject({ x: 350, y: -40 });
    });

    describe("the three-point curve model", () => {
      const placeRound = (
        others: readonly NonDeletedExcalidrawElement[],
        direction: "top" | "right" | "bottom" | "left" = "right",
      ) => placeAndClick(others, direction, "round");

      it("transposes for the vertical handle", () => {
        const source = createRectangle();
        selectShape(source, [
          blocker(BOTTOM_BASE),
          blocker({ x: BOTTOM_BASE.x - BOTTOM_STEP, y: BOTTOM_BASE.y }),
        ]);
        act(() => {
          h.app.setState({ currentItemArrowType: "round" });
        });
        const before = liveIds();
        clickHandle("bottom");
        const copy = createdShape(before);
        const arrow = createdArrow(before);

        // 下边出口 → A 贴源的下边；副本让位到右 1，入口贴它上边（几像素的出入
        // 来自 binding gap）
        const points = worldPoints(arrow);
        expect(points).toHaveLength(3);
        // 出口贴源的下边（沿斜射线落在"轮廓外扩一个 binding gap"上，所以会顺着
        // 边滑一点），入口贴副本的上边
        expect(Math.abs(points[0].x - 160)).toBeLessThan(20);
        expect(Math.abs(points[0].y - 180)).toBeLessThan(10);
        expect(Math.abs(outlineRatio(source, points[0]) - 1)).toBeLessThan(
          0.15,
        );
        expect(Math.abs(outlineRatio(copy, points[2]) - 1)).toBeLessThan(0.15);
        expect(Math.abs(points[2].x - 370)).toBeLessThan(20);
        expect(Math.abs(points[2].y - 270)).toBeLessThan(10);

        // 竖直轴、比例 0.5：控制点在两端中点的轴上位置 → c1/c2 与两端同 x，
        // K 是曲线 t = 0.5 的点（另一轴是两端中点）
        const [A, K, D] = points;
        const turn = (A.y + D.y) / 2;
        const c1 = { x: A.x, y: turn };
        const c2 = { x: D.x, y: turn };
        expect(cubicAt(A, c1, c2, D, 0.5).x).toBeCloseTo(K.x, 6);
        expect(cubicAt(A, c1, c2, D, 0.5).y).toBeCloseTo(K.y, 6);
        expect(K.x).toBeCloseTo((A.x + D.x) / 2, 3);

        // 切线**竖直**：首段第一个控制点的 x 与 A 相同、末段第二个控制点与 D 相同
        const ops = curveOps(arrow);
        expect(ops[1].data[0]).toBeCloseTo(A.x - arrow.x, 6);
        expect(ops[ops.length - 1].data[2]).toBeCloseTo(D.x - arrow.x, 6);
      });

      it("recomputes the whole curve when the bound shape moves", () => {
        const { copy, arrow } = placeRound([blocker(RIGHT_BASE)]);

        moveShape(copy, 0, -140);

        const points = worldPoints(arrow);
        expect(points).toHaveLength(3);
        // 入口跟着副本落到新位置（副本左边中段，几像素的出入来自 binding gap）
        expect(Math.abs(points[2].x - 350)).toBeLessThan(10);
        expect(points[2].y).toBeLessThan(-100);
        // K 落在新让位段中点：比例仍是默认的 0.5
        expect(
          (points[1].x - points[0].x) / (points[2].x - points[0].x),
        ).toBeCloseTo(0.5, 3);
        expect(points[1].y).toBeCloseTo((points[0].y + points[2].y) / 2, 3);
      });

      it("keeps the ratio the user dragged on K when the shape moves again", () => {
        const { copy, arrow } = placeRound([blocker(RIGHT_BASE)]);
        const beforeDrag = curveOps(arrow);

        // 把 K 拖到比例的 0.3 处（等价于拖中间手柄）：转折线从 x = 285 挪到
        // 220 + 0.3 × 130 = 259，而 K 是曲线 t = 0.5 的点，所以落在
        // x = 220 + (0 + 130 + 6 × 39) / 8 = 265.5（局部 45.5）
        setArrowPoints(arrow, [
          [0, 0],
          [45.5, -70],
          [130, -140],
        ]);
        expect(curveOps(arrow)).not.toEqual(beforeDrag);

        moveShape(copy, 0, -140);

        // 新比例被保留：重算后转折线仍在这条曲线的 0.3 处（**旧**三点反推比例）
        const points = worldPoints(arrow);
        expect(
          getCurveConnectorRatio({
            A: points[0],
            D: points[2],
            axis: "h",
            K: points[1],
          }),
        ).toBeCloseTo(0.3, 3);
        // 而 K 自己仍在曲线上（t = 0.5）：另一轴是两端中点
        expect(points[1].y).toBeCloseTo((points[0].y + points[2].y) / 2, 3);
      });

      it("hits the bulge and covers it with the bounding box", () => {
        const { arrow } = placeRound([blocker(RIGHT_BASE)]);
        // 几何取落地后的**模型**三点（不是创建路径算的出口/入口）
        const [A, K, D] = worldPoints(arrow);
        expect(K.x).toBeCloseTo((A.x + D.x) / 2, 3);
        expect(K.y).toBeCloseTo((A.y + D.y) / 2, 3);
        // 水平轴、比例 0.5 → 控制点在两端中点的轴上位置
        const c1 = { x: (A.x + D.x) / 2, y: A.y };
        const c2 = { x: (A.x + D.x) / 2, y: D.y };

        // 曲线在 t = 0.25 处离 A–D 弦最远（≈20 场景单位）：那一点要能选中
        const onCurve = cubicAt(A, c1, c2, D, 0.25);
        const onChord = {
          x: onCurve.x,
          y: A.y + ((D.y - A.y) * (onCurve.x - A.x)) / (D.x - A.x),
        };
        expect(
          Math.hypot(onCurve.x - onChord.x, onCurve.y - onChord.y),
        ).toBeGreaterThan(15);
        expect(h.app.getElementAtPosition(onCurve.x, onCurve.y)?.id).toBe(
          arrow.id,
        );
        // 弦上那一点离曲线太远，命中不到——证明命中走的是曲线而不是弦
        expect(h.app.getElementAtPosition(onChord.x, onChord.y)?.id).not.toBe(
          arrow.id,
        );

        // 包围盒覆盖整条曲线，并且是贴着曲线的（不是整个画布那种宽松盒子）
        const [minX, minY, maxX, maxY] = getElementBounds(
          arrow,
          h.app.scene.getNonDeletedElementsMap(),
        );
        for (let t = 0; t <= 1.0001; t += 0.1) {
          const point = cubicAt(A, c1, c2, D, t);
          expect(point.x).toBeGreaterThanOrEqual(minX - 1);
          expect(point.y).toBeGreaterThanOrEqual(minY - 1);
          expect(point.x).toBeLessThanOrEqual(maxX + 1);
          expect(point.y).toBeLessThanOrEqual(maxY + 1);
          // 边界贴着曲线：盒子的四条边都踩到曲线的极值上
          expect(minX).toBeLessThanOrEqual(A.x);
          expect(maxX).toBeGreaterThanOrEqual(D.x);
        }
        expect(maxX - minX).toBeLessThan(Math.abs(D.x - A.x) + 20);
        expect(maxY - minY).toBeLessThan(Math.abs(D.y - A.y) + 20);
      });

      it("binds to a rotated shape's outline while keeping absolute tangents", () => {
        const angle = Math.PI / 6;
        const source = createRectangle({ angle });
        const base = {
          x: 160 + 250 * Math.cos(angle),
          y: 140 + 250 * Math.sin(angle),
        };
        selectShape(source, [blocker(base)]);
        act(() => {
          h.app.setState({ currentItemArrowType: "round" });
        });
        const before = liveIds();
        clickHandle("right");

        const copy = createdShape(before);
        const arrow = createdArrow(before);

        // 出口在旋转后源的本地 +x 边上 → 轴向仍是**绝对**水平；两端都贴各自的
        // 真实轮廓（几像素的出入来自 binding gap）
        const [A, , D] = worldPoints(arrow);
        expect(Math.abs(outlineRatio(source, A) - 1)).toBeLessThan(0.15);
        expect(Math.abs(outlineRatio(copy, D) - 1)).toBeLessThan(0.15);
        const ops = curveOps(arrow);
        const localA = { x: A.x - arrow.x, y: A.y - arrow.y };
        const localD = { x: D.x - arrow.x, y: D.y - arrow.y };
        expect(ops[1].data[1]).toBeCloseTo(localA.y, 6);
        expect(ops[ops.length - 1].data[3]).toBeCloseTo(localD.y, 6);
      });

      it("keeps the model's shape after the copy is moved away and back", () => {
        // 「创建时算」与「模型算」没有分歧：把副本挪开再挪回原位，比例、轴向、
        // 以及 K 贴在曲线上这些性质都保持不变（两端由绑定重解，与创建时的解算
        // 同一套；orbit 求解的射线方向依赖当前另一端，所以位置允许 binding gap
        // 量级的出入）
        const { copy, arrow } = placeRound([blocker(RIGHT_BASE)]);
        const landed = worldPoints(arrow);

        moveShape(copy, 0, -2 * RIGHT_STEP);
        expect(worldPoints(arrow)).not.toEqual(landed);

        moveShape(copy, 0, 2 * RIGHT_STEP);
        const back = worldPoints(arrow);
        expect(back).toHaveLength(3);
        for (let index = 0; index < 3; index++) {
          expect(Math.abs(back[index].x - landed[index].x)).toBeLessThan(15);
          expect(Math.abs(back[index].y - landed[index].y)).toBeLessThan(15);
        }
        // 比例仍是默认的 0.5，K 仍落在曲线上（t = 0.5）
        expect(
          getCurveConnectorRatio({
            A: back[0],
            D: back[2],
            axis: "h",
            K: back[1],
          }),
        ).toBeCloseTo(0.5, 3);
        expect(back[1].y).toBeCloseTo((back[0].y + back[2].y) / 2, 3);
        // 轴向没变：切线仍水平
        const ops = curveOps(arrow);
        const lastOp = ops.length - 1;
        expect(ops[1].data[1]).toBeCloseTo(back[0].y - arrow.y, 6);
        expect(ops[lastOp].data[3]).toBeCloseTo(back[2].y - arrow.y, 6);
      });

      it("only refreshes the endpoints for arrows outside the model", () => {
        // ≥4 点的曲线：保持现状（只刷首尾两点，中间点原样不动）
        const fourPoint = placeAndClick(
          [blocker(RIGHT_BASE)],
          "right",
          "round",
        );
        setArrowPoints(fourPoint.arrow, [
          [0, 0],
          [40, -40],
          [90, -100],
          [130, -140],
        ]);
        const fourPointMiddle = worldPoints(fourPoint.arrow).slice(1, 3);
        moveShape(fourPoint.copy, 0, -140);
        expect(worldPoints(fourPoint.arrow)).toHaveLength(4);
        expect(worldPoints(fourPoint.arrow).slice(1, 3)).toEqual(
          fourPointMiddle,
        );

        // 2 点的曲线样式：仍旧两点直线，只有端点跟着走
        const line = placeAndClick([blocker(RIGHT_BASE)], "right", "round");
        setArrowPoints(line.arrow, [
          [0, 0],
          [130, -140],
        ]);
        moveShape(line.copy, 0, -140);
        expect(worldPoints(line.arrow)).toHaveLength(2);

        // 折线箭头：仍旧 elbowed + 无圆角，路径由内置正交路由算（每段轴对齐）
        const elbow = placeAndClick([blocker(RIGHT_BASE)], "right", "elbow");
        expect(elbow.arrow).toMatchObject({ elbowed: true, roundness: null });
        moveShape(elbow.copy, 0, -140);
        const elbowPoints = worldPoints(elbow.arrow);
        expect(elbow.arrow.elbowed).toBe(true);
        for (let index = 1; index < elbowPoints.length; index++) {
          expect(
            elbowPoints[index - 1].x === elbowPoints[index].x ||
              elbowPoints[index - 1].y === elbowPoints[index].y,
          ).toBe(true);
        }

        // 直箭头（无圆角）带 3 个点时也不是新模型：中间点不跟着重算
        const sharp = placeAndClick([blocker(RIGHT_BASE)], "right", "round");
        setArrowPoints(
          sharp.arrow,
          [
            [0, 0],
            [65, -70],
            [130, -140],
          ],
          { roundness: null },
        );
        const sharpMiddle = worldPoints(sharp.arrow)[1];
        moveShape(sharp.copy, 0, -140);
        expect(worldPoints(sharp.arrow)).toHaveLength(3);
        expect(worldPoints(sharp.arrow)[1]).toEqual(sharpMiddle);
      });
    });
  });

  describe("pointer types", () => {
    /** 侧边缩放胶囊的几何中心：本地框边外 DEFAULT_TRANSFORM_HANDLE_SPACING*2 = 4px */
    const CAPSULE_CENTER = { x: 224, y: 140 };

    it.each(["touch", "pen"] as const)(
      "creates from the dot with a %s pointer",
      (pointerType) => {
        const source = createRectangle();
        selectShape(source);
        // touch/pen 的手柄命中矩形把圆点中心也包进去，但圆点中心更近，仍应建图
        const pointer = new Pointer(pointerType, 2);
        pointer.clickAt(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);

        const copy = newShape(source.id);
        expect(copy).toMatchObject({ x: 350, y: 100, width: 120, height: 80 });
        expect(live()).toHaveLength(3);
      },
    );

    it.each(["touch", "pen"] as const)(
      "still resizes from the capsule centre with a %s pointer",
      (pointerType) => {
        const source = createRectangle();
        selectShape(source);
        const pointer = new Pointer(pointerType, 2);
        pointer.downAt(CAPSULE_CENTER.x, CAPSULE_CENTER.y);
        pointer.moveTo(CAPSULE_CENTER.x + 30, CAPSULE_CENTER.y);
        pointer.upAt();

        expect(live()).toHaveLength(1);
        expect(h.app.scene.getNonDeletedElement(source.id)).toMatchObject({
          width: 150,
          height: 80,
        });
      },
    );
  });

  describe("hover", () => {
    /**
     * 记录交互层画布**真实画出**的帧。
     *
     * 这里刻意不手动强制重绘：悬停形态只存在 `AppQuickCreate.hovered` 这个组件
     * 字段里、不进 appState，而 `setState({})` 不会让交互层重渲染
     * （InteractiveCanvas 是 memo，且交互层没有常驻动画帧）。所以指针事件之后
     * 有没有这一帧，正是本组用例要盯住的东西——没有显式重绘调用就什么都画不出来。
     */
    const createFrameRecorder = () => {
      /** 每次调用都连当时的 globalAlpha 一起记下：圆点的透明度就靠它读 */
      const calls: { type: string; args: unknown[]; alpha: number }[] = [];
      const canvas = h.app.interactiveCanvas!;
      const realGetContext = canvas.getContext.bind(canvas);
      (canvas as any).getContext = (...args: any[]) => {
        const context = (realGetContext as any)(...args);
        return new Proxy(context, {
          get(target, prop: string) {
            const value = (target as any)[prop];
            if (typeof value === "function") {
              return (...callArgs: unknown[]) => {
                calls.push({
                  type: prop,
                  args: callArgs,
                  alpha: (target as any).globalAlpha,
                });
                return value.apply(target, callArgs);
              };
            }
            return value;
          },
        });
      };

      const at = (type: string) =>
        calls
          .filter((call) => call.type === type)
          .map(({ type: callType, args }) => ({ type: callType, args }));
      /** 调用序号（跨类型）：用来盯住预演与创建入口的绘制先后 */
      const orderOf = (type: string) =>
        calls
          .map((call, index) => (call.type === type ? index : -1))
          .filter((index) => index >= 0);
      /** 画在四个手柄圆心上的圆弧（带当时的 globalAlpha） */
      const dotArcs = () =>
        calls.filter(
          (call) =>
            call.type === "arc" &&
            Object.values(HANDLE_CENTERS).some(
              (center) =>
                center.x === call.args[0] && center.y === call.args[1],
            ),
        );
      /** 画在四个手柄圆心上的圆弧 → 半径，用来读每一档的直径 */
      const handleRadii = (): Record<string, number> =>
        Object.fromEntries(
          dotArcs().map((call) => [
            `${call.args[0]},${call.args[1]}`,
            call.args[2] as number,
          ]),
        );
      /** 四个圆点各自的透明度（画到它时的 globalAlpha） */
      const alphasAtDots = (): Record<string, number> =>
        Object.fromEntries(
          dotArcs().map((call) => [
            `${call.args[0]},${call.args[1]}`,
            call.alpha,
          ]),
        );
      /** 画四个圆点的调用序号（同一帧里还有别的圆弧，所以单独挑出来） */
      const dotArcOrder = () => {
        const dots = dotArcs();
        return calls
          .map((call, index) => (dots.includes(call) ? index : -1))
          .filter((index) => index >= 0);
      };
      return {
        at,
        orderOf,
        dotArcOrder,
        handleRadii,
        alphasAtDots,
        /** 画过帧没有：一帧里必然重画四个圆点，也很可能带上别的图元 */
        drewFrame: () => calls.length > 0,
        /** 丢掉已记下的帧，只看接下来的绘制 */
        clear: () => {
          calls.length = 0;
        },
      };
    };

    let frames: ReturnType<typeof createFrameRecorder>;

    beforeEach(() => {
      frames = createFrameRecorder();
    });

    it("draws the hovered handle at the hover size and the rest at the dot size", () => {
      const shape = createRectangle();
      const radiusOf = (
        radii: Record<string, number>,
        center: { x: number; y: number },
      ) => radii[`${center.x},${center.y}`];

      frames.clear();
      selectShape(shape);
      // 未悬停：四个都是常态点 ⌀8（半径 4）；这一帧由选中引起的重渲染带出来
      expect(frames.drewFrame()).toBe(true);
      expect(frames.handleRadii()).toEqual({
        "160,78": 4,
        "242,140": 4,
        "160,202": 4,
        "78,140": 4,
      });

      // 悬停这一帧必须由指针事件自己画出来（没有手动强制重绘）
      frames.clear();
      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      expect(frames.drewFrame()).toBe(true);
      const radii = frames.handleRadii();
      // 悬停项就地长成 ⌀20（半径 10），圆心不变；其余仍是 ⌀8
      expect(radiusOf(radii, HANDLE_CENTERS.right)).toBe(10);
      expect(radiusOf(radii, HANDLE_CENTERS.top)).toBe(4);
      expect(radiusOf(radii, HANDLE_CENTERS.left)).toBe(4);
      expect(radiusOf(radii, HANDLE_CENTERS.bottom)).toBe(4);
      // 悬停加号总长 9：一半是 4.5
      expect(frames.at("moveTo")).toContainEqual({
        type: "moveTo",
        args: [HANDLE_CENTERS.right.x - 4.5, HANDLE_CENTERS.right.y],
      });
    });

    it("previews the copy and the connector while a handle is hovered", () => {
      const source = createRectangle();
      frames.clear();
      selectShape(source);
      if (!isCompositeShapeElement(source)) {
        throw new Error("Expected a composite shape");
      }

      // 未悬停时没有预演：预演整层都走真实元素渲染，落到画布上就是一次位图 blit
      expect(frames.at("drawImage")).toEqual([]);

      frames.clear();
      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      expect(frames.drewFrame()).toBe(true);

      // 预演的几何与样式就是落地后的那一份：副本 + 连线两个元素
      const ghost = h.app.quickCreate.getGhostElements(handleFor("right"));
      expect(ghost.map((element) => element.id)).toEqual([
        QUICK_CREATE_GHOST_SHAPE_ID,
        QUICK_CREATE_GHOST_ARROW_ID,
      ]);
      const [ghostShape, ghostArrow] = ghost;
      // 副本落在真实落点上：目标中心 - 源中心 = 间隙 130 + 源宽 120
      expect(ghostShape).toMatchObject({
        x: 350,
        y: 100,
        width: 120,
        height: 80,
        // 样式原样照抄源图形，只有不透明度压到一半表示尚未提交
        strokeColor: source.strokeColor,
        backgroundColor: source.backgroundColor,
        strokeStyle: source.strokeStyle,
        strokeWidth: source.strokeWidth,
        opacity: source.opacity * QUICK_CREATE_GHOST_ALPHA,
      });
      // 连线：源右边缘中点到副本近端边缘中点，样式取当前连接线，同样压到一半
      expect(ghostArrow).toMatchObject({
        type: "arrow",
        x: 220,
        y: 140,
        opacity: 100 * QUICK_CREATE_GHOST_ALPHA,
      });
      if (!isArrowElement(ghostArrow)) {
        throw new Error("Expected an arrow");
      }
      expect(ghostArrow.points).toEqual([
        [0, 0],
        [130, 0],
      ]);

      // 预演画在两个真实图元上（副本 + 连线各一次 blit），且**先于**四个创建
      // 入口：预演不得盖住要点的那几个圆点
      const blits = frames.orderOf("drawImage");
      expect(blits).toHaveLength(2);
      expect(Math.max(...blits)).toBeLessThan(
        Math.min(...frames.dotArcOrder()),
      );

      // 指针离开后重画一帧，预演跟着消失
      frames.clear();
      mouse.moveTo(1000, 1000);
      expect(frames.drewFrame()).toBe(true);
      expect(frames.at("drawImage")).toEqual([]);

      // 连线照抄当前连接线样式（线条与两端箭头都会跟着变），样式一变就重建，
      // 不会还画着上一套；没变则复用同一份（预演元素身上挂着位图缓存）
      act(() => {
        h.app.setState({
          currentItemStrokeColor: "#ff00ff",
          currentItemStrokeStyle: "dotted",
          currentItemStartArrowhead: "triangle",
          currentItemEndArrowhead: "circle",
        });
      });
      const styled = h.app.quickCreate.getGhostElements(handleFor("right"));
      expect(styled).not.toBe(ghost);
      expect(styled[1]).toMatchObject({
        strokeColor: "#ff00ff",
        strokeStyle: "dotted",
        startArrowhead: "triangle",
        endArrowhead: "circle",
      });
      expect(h.app.quickCreate.getGhostElements(handleFor("right"))).toBe(
        styled,
      );
    });

    it("keeps the resting dots translucent and the creation entry fully opaque", () => {
      const shape = createRectangle();
      if (!isCompositeShapeElement(shape)) {
        throw new Error("Expected a composite shape");
      }

      frames.clear();
      selectShape(shape);
      // 未悬停：四个圆点都是常态档，压到 REST_ALPHA
      expect(frames.alphasAtDots()).toEqual({
        "160,78": QUICK_CREATE_HANDLE_REST_ALPHA,
        "242,140": QUICK_CREATE_HANDLE_REST_ALPHA,
        "160,202": QUICK_CREATE_HANDLE_REST_ALPHA,
        "78,140": QUICK_CREATE_HANDLE_REST_ALPHA,
      });

      // 悬停那一项就地长成创建入口（加号），恢复完全不透明
      frames.clear();
      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      expect(frames.alphasAtDots()["242,140"]).toBe(1);
      expect(frames.alphasAtDots()["160,78"]).toBe(
        QUICK_CREATE_HANDLE_REST_ALPHA,
      );
    });

    it("draws the touch resting entry whole instead of dimming it", () => {
      const shape = createRectangle();
      selectShape(shape);
      // 触屏没有 hover 可等：常态画的就是悬停档的完整手柄（⌀20 + 加号），
      // 那是唯一入口，不压暗
      act(() => {
        h.app.setState({ lastPointerDownWith: "touch" });
      });

      frames.clear();
      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      expect(frames.alphasAtDots()).toEqual({
        "160,78": 1,
        "242,140": 1,
        "160,202": 1,
        "78,140": 1,
      });
      expect(frames.handleRadii()).toEqual({
        "160,78": 10,
        "242,140": 10,
        "160,202": 10,
        "78,140": 10,
      });
    });

    it("reports the hovered direction and clears when the pointer leaves", () => {
      const shape = createRectangle();
      selectShape(shape);

      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      expect(h.app.quickCreate.getHovered()).toEqual({
        direction: "right",
        elementId: shape.id,
      });

      mouse.moveTo(HANDLE_CENTERS.left.x, HANDLE_CENTERS.left.y);
      expect(h.app.quickCreate.getHovered()).toEqual({
        direction: "left",
        elementId: shape.id,
      });

      mouse.moveTo(1000, 1000);
      expect(h.app.quickCreate.getHovered()).toBeNull();
    });

    it("redraws a frame when a modifier key hides the whole set", () => {
      const shape = createRectangle();
      frames.clear();
      selectShape(shape);
      expect(frames.drewFrame()).toBe(true);

      // 按住修饰键：整组手柄与预演一起消失，这一帧同样只能由显式重绘带出来
      // （光靠 setState 不会重渲染交互层）
      frames.clear();
      fireEvent.keyDown(h.app.ownerDocument, { key: "Shift", shiftKey: true });
      expect(frames.drewFrame()).toBe(true);
      expect(frames.handleRadii()).toEqual({});

      frames.clear();
      fireEvent.keyUp(h.app.ownerDocument, { key: "Shift" });
      expect(frames.drewFrame()).toBe(true);
      expect(Object.keys(frames.handleRadii())).toHaveLength(4);
    });

    it("does not hover while no shape is selected", () => {
      const shape = createRectangle();
      API.setElements([shape]);
      API.setSelectedElements([]);
      const handles = getQuickCreateHandles(h.app);
      expect(handles).toHaveLength(0);
      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      expect(h.app.quickCreate.getHovered()).toBeNull();
    });
  });
});
