import { ARROW_TYPE, reseed } from "@excalidraw/common";

import { pointFrom } from "@excalidraw/math";

import type {
  AttachPoint,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { actionChangeArrowType } from "../actions/actionProperties";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;

const r4 = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * PR1 §5.2 非用户路径守卫：切换箭头类型。
 *
 * `actionChangeArrowType` 会在 sharp / round / elbow 之间转换，并调用
 * `calculateAttachPointForElbowArrowBinding` / `bindBindingElement` 重算绑定。
 * 这里通过 UI 同一个 action（`actionManager.executeAction`）冻结转换后的
 * 端点与 attachPoint，作为 PR3 改落点时的 diff 基线。
 *
 * HEAD 现状（冻结即可，不是“应该怎样”）：
 *   - sharp → round 只改 roundness，端点与 attachPoint 都不变；
 *   - round → elbow 会把终点从图形内部吸到轮廓外一个 gap 处；
 *   - elbow → sharp 保留 elbow 的端点与 attachPoint，不会把端点放回原位置。
 */

const RECT_ID = "type-rect";
const ARROW_ID = "type-arrow";

const getArrow = () =>
  h.elements.find(
    (element): element is NonDeleted<ExcalidrawArrowElement> =>
      element.id === ARROW_ID,
  )!;

const executeArrowType = (type: typeof ARROW_TYPE[keyof typeof ARROW_TYPE]) =>
  act(() => {
    h.app.actionManager.executeAction(actionChangeArrowType, "api", type);
  });

const record = () => {
  const arrow = getArrow();
  const end = arrow.points.at(-1)!;
  return {
    elbowed: arrow.elbowed,
    roundness: arrow.roundness,
    x: r4(arrow.x),
    y: r4(arrow.y),
    points: arrow.points.map((point) => [r4(point[0]), r4(point[1])]),
    endBinding: arrow.endBinding && {
      elementId: arrow.endBinding.elementId,
      attachPoint: arrow.endBinding.attachPoint.map(r4),
    },
    fixedSegments: (
      arrow as ExcalidrawArrowElement & { fixedSegments?: unknown }
    ).fixedSegments,
    endGlobal: [r4(arrow.x + end[0]), r4(arrow.y + end[1])],
  };
};

describe("arrow type switch baseline (§5.2)", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    h.state.width = 1920;
    h.state.height = 1080;
  });

  it("sharp → round → elbow → sharp keeps the attachPoint chain stable", () => {
    const rect = API.createElement({
      type: "rectangle",
      id: RECT_ID,
      x: 100,
      y: 100,
      width: 200,
      height: 120,
    }) as NonDeleted<ExcalidrawBindableElement>;

    // 箭头终点 (300, 130) 落在矩形右边缘 y=0.25 处
    const arrow = API.createElement({
      type: "arrow",
      id: ARROW_ID,
      x: 400,
      y: 130,
      width: 100,
      height: 0,
      points: [pointFrom(0, 0), pointFrom(-100, 0)],
      startBinding: null,
      endBinding: {
        elementId: RECT_ID,
        attachPoint: [1, 0.25] as AttachPoint,
      },
    }) as NonDeleted<ExcalidrawArrowElement>;

    API.setElements([
      { ...rect, boundElements: [{ type: "arrow" as const, id: arrow.id }] },
      arrow,
    ]);
    API.setSelectedElements([arrow]);

    const initial = record();

    executeArrowType(ARROW_TYPE.round);
    const round = record();

    executeArrowType(ARROW_TYPE.elbow);
    const elbow = record();

    executeArrowType(ARROW_TYPE.sharp);
    const sharpAgain = record();

    expect({ initial, round, elbow, sharpAgain }).toMatchSnapshot();
  });
});
