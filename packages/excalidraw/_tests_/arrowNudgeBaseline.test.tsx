import { KEYS, reseed } from "@excalidraw/common";

import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";

import type {
  AttachPoint,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;

/**
 * PR1 §5.2 非用户路径守卫：方向键微调。
 *
 * 这条路径不走指针拖拽，但会经过 `calculateAttachPointForNonElbowArrowBinding`
 * （keyboard.ts 的 keyup 收尾）。PR3 改落点几何后，这里必须保持 HEAD 的行为：
 * `attachPoint` 是**端点本身的比例**，不会重新吸附回轮廓。
 *
 * 记录到的 HEAD 行为（非理想化，勿“修正”）：
 *   1. 只选中已绑定箭头时，方向键**不会**移动它——keyboard.ts 会把绑定目标
 *      不在选区内的箭头从移动列表里剔除；只有 keyup 会按当前端点重算 attachPoint。
 *   2. 同时选中箭头与绑定目标时，两者各移动一个步长，attachPoint 保持不变，
 *      等于移动后端点相对目标的归一化比例（端点落在图形内部时也不会被吸回轮廓）。
 *   3. 网格模式下步长等于 `gridSize`。
 */

const RECT_ID = "nudge-rect";
const ARROW_ID = "nudge-arrow";

const createNudgeScene = (attachPoint: [number, number]) => {
  const rect = API.createElement({
    type: "rectangle",
    id: RECT_ID,
    x: 400,
    y: 200,
    width: 200,
    height: 120,
  }) as NonDeleted<ExcalidrawBindableElement>;

  const arrow = API.createElement({
    type: "arrow",
    id: ARROW_ID,
    x: 250,
    y: 230,
    width: 200,
    height: 0,
    points: [pointFrom(0, 0), pointFrom(200, 0)],
    startBinding: null,
    endBinding: { elementId: RECT_ID, attachPoint: attachPoint as AttachPoint },
  }) as NonDeleted<ExcalidrawArrowElement>;

  API.setElements([
    { ...rect, boundElements: [{ type: "arrow" as const, id: arrow.id }] },
    arrow,
  ]);

  return { rect, arrow };
};

const getArrow = () =>
  h.elements.find(
    (element): element is NonDeleted<ExcalidrawArrowElement> =>
      element.id === ARROW_ID,
  )!;

const getRect = () =>
  h.elements.find(
    (element): element is NonDeleted<ExcalidrawBindableElement> =>
      element.id === RECT_ID,
  )!;

/** 箭头**终点**（全局坐标）：`x/y + points.at(-1)`。 */
const getArrowEnd = (arrow: ExcalidrawArrowElement): GlobalPoint => {
  const end = arrow.points.at(-1)!;
  return pointFrom<GlobalPoint>(arrow.x + end[0], arrow.y + end[1]);
};

/** `attachPoint` 是否就是端点相对目标的归一化比例（即“没重新吸附”）。 */
const getExpectedAttachPoint = (
  arrow: ExcalidrawArrowElement,
  rect: ExcalidrawBindableElement,
): [number, number] => {
  const end = getArrowEnd(arrow);
  return [(end[0] - rect.x) / rect.width, (end[1] - rect.y) / rect.height];
};

describe("arrow-key nudge baseline (§5.2)", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    h.state.width = 1920;
    h.state.height = 1080;
  });

  it("bound arrow alone: not moved, keyup re-derives attachPoint from the unmoved endpoint", () => {
    const { arrow } = createNudgeScene([0.9, 0.9]);

    API.setSelectedElements([arrow]);

    Keyboard.keyDown(KEYS.ARROW_RIGHT);

    // keydown 阶段：箭头被移出移动列表，位置完全不变，binding 也不变
    expect([getArrow().x, getArrow().y]).toEqual([250, 230]);
    expect(getArrowEnd(getArrow())).toEqual([450, 230]);
    expect(getArrow().endBinding).toEqual({
      elementId: RECT_ID,
      attachPoint: [0.9, 0.9],
    });

    Keyboard.keyUp(KEYS.ARROW_RIGHT);

    // keyup 阶段：按**未移动**的端点重算 attachPoint，覆盖掉不匹配的旧值
    expect([getArrow().x, getArrow().y]).toEqual([250, 230]);
    expect(getArrow().endBinding).toEqual({
      elementId: RECT_ID,
      attachPoint: [0.25, 0.25],
    });
    expect(getArrow().endBinding!.attachPoint).toEqual(
      getExpectedAttachPoint(getArrow(), getRect()),
    );
  });

  it("arrow + bound target: each key moves the endpoint by exactly 1px, attachPoint is the endpoint fraction", () => {
    const { rect, arrow } = createNudgeScene([0.25, 0.25]);

    API.setSelectedElements([rect, arrow]);

    Keyboard.keyDown(KEYS.ARROW_RIGHT);
    Keyboard.keyUp(KEYS.ARROW_RIGHT);

    // 1px 步长；端点从 (450, 230) 移到 (451, 230)
    expect([getArrow().x, getArrow().y]).toEqual([251, 230]);
    expect([getRect().x, getRect().y]).toEqual([401, 200]);
    expect(getArrowEnd(getArrow())).toEqual([451, 230]);

    // 端点仍在目标内部，没有被吸回轮廓；attachPoint 恰好是端点比例
    expect(getArrow().endBinding).toEqual({
      elementId: RECT_ID,
      attachPoint: [0.25, 0.25],
    });
    expect(getArrow().endBinding!.attachPoint).toEqual(
      getExpectedAttachPoint(getArrow(), getRect()),
    );

    Keyboard.keyDown(KEYS.ARROW_DOWN);
    Keyboard.keyUp(KEYS.ARROW_DOWN);

    expect([getArrow().x, getArrow().y]).toEqual([251, 231]);
    expect([getRect().x, getRect().y]).toEqual([401, 201]);
    expect(getArrowEnd(getArrow())).toEqual([451, 231]);
    expect(getArrow().endBinding).toEqual({
      elementId: RECT_ID,
      attachPoint: [0.25, 0.25],
    });
    expect(getArrow().endBinding!.attachPoint).toEqual(
      getExpectedAttachPoint(getArrow(), getRect()),
    );
  });

  it("grid mode: the step is the effective grid size", () => {
    const { rect, arrow } = createNudgeScene([0.25, 0.25]);

    API.setAppState({ gridModeEnabled: true, gridSize: 20 });

    API.setSelectedElements([rect, arrow]);

    Keyboard.keyDown(KEYS.ARROW_RIGHT);
    Keyboard.keyUp(KEYS.ARROW_RIGHT);

    expect([getArrow().x, getArrow().y]).toEqual([270, 230]);
    expect([getRect().x, getRect().y]).toEqual([420, 200]);
    expect(getArrowEnd(getArrow())).toEqual([470, 230]);
    expect(getArrow().endBinding).toEqual({
      elementId: RECT_ID,
      attachPoint: [0.25, 0.25],
    });
    expect(getArrow().endBinding!.attachPoint).toEqual(
      getExpectedAttachPoint(getArrow(), getRect()),
    );
  });
});
