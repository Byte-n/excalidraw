import { pointFrom } from "@excalidraw/math";

import type {
  ElementsMap,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { LocalPoint } from "@excalidraw/math";

import {
  createSceneArrowElement,
  createSceneConnectionEndpoint,
  createSceneElement,
} from "../src";

/**
 * PR1 §5.2 非用户路径守卫：yjs 建连。
 *
 * `createSceneConnectionEndpoint` 是 `calculateAttachPointForNonElbowArrowBinding`
 * 的直接调用方（packages/yjs/src/element-factory.ts）。它不经过指针拖拽，
 * 只按箭头已知端点做**纯换算**。这里用固定场景冻结 HEAD 的换算结果（保留 4 位）。
 */

const r4 = (value: number) => Math.round(value * 1e4) / 1e4;

const RECT_ID = "yjs-rect";
const ARROW_ID = "yjs-arrow";

const createScene = () => {
  const rect = {
    ...createSceneElement({
      type: "rectangle",
      x: 400,
      y: 200,
      width: 200,
      height: 120,
    }),
    id: RECT_ID,
  } as unknown as NonDeleted<ExcalidrawBindableElement>;

  // 终点 (450, 260)：在矩形内部，横向比例 0.25、纵向正好在中心 (0.5 → 0.5001)
  const arrow = {
    ...createSceneArrowElement({
      type: "arrow",
      x: 250,
      y: 260,
      width: 200,
      height: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
    }),
    id: ARROW_ID,
  } as NonDeleted<ExcalidrawArrowElement>;

  return { rect, arrow };
};

describe("yjs non-elbow connection endpoint baseline (§5.2)", () => {
  it("derives attachPoint from the arrow's local endpoint", () => {
    const { rect, arrow } = createScene();
    const elements = new Map<string, unknown>([
      [rect.id, rect],
      [arrow.id, arrow],
    ]) as unknown as ElementsMap;

    const endpoint = createSceneConnectionEndpoint({
      arrow,
      target: rect,
      end: "end",
      elements,
    });

    expect(endpoint.elementId).toBe(RECT_ID);
    // 0.5 会被 normalizeAttachPoint 推成 0.5001（避免浮点漂移），这是 HEAD 现状
    expect(endpoint.attachPoint.map(r4)).toEqual([0.25, 0.5001]);
  });

  it("ignores a stale stored endBinding and uses the current endpoint", () => {
    const { rect, arrow } = createScene();

    // 故意存一个与端点不符的比例：换算不得复用它
    const staleArrow = {
      ...arrow,
      endBinding: {
        elementId: RECT_ID,
        attachPoint: [0.9, 0.9] as [number, number],
      },
    };

    const elements = new Map<string, unknown>([
      [rect.id, rect],
      [staleArrow.id, staleArrow],
    ]) as unknown as ElementsMap;

    const endpoint = createSceneConnectionEndpoint({
      arrow: staleArrow,
      target: rect,
      end: "end",
      elements,
    });

    expect(endpoint.attachPoint.map(r4)).toEqual([0.25, 0.5001]);
  });
});
