import { ROUNDNESS, reseed } from "@excalidraw/common";

import {
  compositeShapePathToSvg,
  getCompositeShapeGlobalPath,
  getContainingFrame,
  getQuickCreateHandles,
  hitTestQuickCreateHandle,
  isArrowElement,
  isCompositeShapeElement,
  isMindmapNodeElement,
} from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, fireEvent, render } from "./test-utils";

import type { NormalizedZoomValue } from "../types";

const { h } = window;

const mouse = new Pointer("mouse");

/** 视图坐标为 0 偏移、zoom=1 时，场景坐标与视图坐标重合 */
const live = () => h.elements.filter((element) => !element.isDeleted);

const selectShape = (shape: NonDeletedExcalidrawElement) => {
  API.setElements([shape]);
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
      const calls: { type: string; args: unknown[] }[] = [];
      const outlines: string[] = [];
      const canvas = h.app.interactiveCanvas!;
      const realGetContext = canvas.getContext.bind(canvas);
      (canvas as any).getContext = (...args: any[]) => {
        const context = (realGetContext as any)(...args);
        return new Proxy(context, {
          get(target, prop: string) {
            const value = (target as any)[prop];
            if (typeof value === "function") {
              return (...callArgs: unknown[]) => {
                calls.push({ type: prop, args: callArgs });
                return value.apply(target, callArgs);
              };
            }
            return value;
          },
        });
      };
      const RealPath2D = globalThis.Path2D;
      (globalThis as any).Path2D = function (svgPath?: string) {
        outlines.push(String(svgPath));
        return new RealPath2D(svgPath);
      };

      const at = (type: string) => calls.filter((call) => call.type === type);
      /** 画在四个手柄圆心上的圆弧 → 半径，用来读每一档的直径 */
      const handleRadii = (): Record<string, number> =>
        Object.fromEntries(
          at("arc")
            .filter((call) =>
              Object.values(HANDLE_CENTERS).some(
                (center) =>
                  center.x === call.args[0] && center.y === call.args[1],
              ),
            )
            .map((call) => [
              `${call.args[0]},${call.args[1]}`,
              call.args[2] as number,
            ]),
        );
      return {
        at,
        handleRadii,
        outlines: () => outlines,
        /** 画过帧没有：一帧里必然重画四个圆点，也很可能带上别的图元 */
        drewFrame: () => calls.length > 0,
        /** 丢掉已记下的帧，只看接下来的绘制 */
        clear: () => {
          calls.length = 0;
          outlines.length = 0;
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

      // 未悬停时没有预演
      expect(frames.outlines()).toEqual([]);

      frames.clear();
      mouse.moveTo(HANDLE_CENTERS.right.x, HANDLE_CENTERS.right.y);
      expect(frames.drewFrame()).toBe(true);

      // 幽灵副本的轮廓就是源图形旋转过的全局轮廓（不另拼一份路径）
      expect(frames.outlines()).toEqual([
        compositeShapePathToSvg(getCompositeShapeGlobalPath(source)),
      ]);
      // 画在真实落点上：目标中心 - 源中心 = 间隙 130 + 源宽 120
      expect(frames.at("translate")).toContainEqual({
        type: "translate",
        args: [250, 0],
      });
      // 幽灵连线：源右边缘中点到副本近端边缘中点，按下限 6/4 画虚线
      expect(frames.at("setLineDash")).toContainEqual({
        type: "setLineDash",
        args: [[6, 4]],
      });
      expect(frames.at("moveTo")).toContainEqual({
        type: "moveTo",
        args: [220, 140],
      });
      expect(frames.at("lineTo")).toContainEqual({
        type: "lineTo",
        args: [350, 140],
      });

      // 指针离开后重画一帧，预演跟着消失
      frames.clear();
      mouse.moveTo(1000, 1000);
      expect(frames.drewFrame()).toBe(true);
      expect(frames.outlines()).toEqual([]);
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
