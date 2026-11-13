import { reseed } from "@excalidraw/common";

import { pointFrom } from "@excalidraw/math";

import { reanchorBindingsToOutline } from "../src/binding";
import {
  newArrowElement,
  newElement,
  newMindmapNodeElement,
} from "../src/newElement";
import { Scene } from "../src/Scene";

import type {
  AttachPoint,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  NonDeleted,
} from "../src/types";

/**
 * PR1 §5.2 非用户路径守卫：类型转换重锚。
 *
 * `reanchorBindingsToOutline`（binding.ts）的唯一生产调用方是
 * `ConvertElementTypePopup.tsx`：转换换了轮廓后，先按新轮廓重锚绑定，
 * 再 `updateBindings` 移动端点。这里绕过 App，直接在 `Scene` 上调纯函数，
 * 冻结“重锚后 attachPoint 落在新轮廓的哪里”。
 *
 * 注意 HEAD 现状：重锚只改 `attachPoint`，**不改箭头端点**（端点由随后的
 * `updateBindings` 负责移动）。因此本守卫只冻结 attachPoint，并断言端点未动。
 */

const r4 = (value: number) => Math.round(value * 1e4) / 1e4;

const SCENE_ARROW_ID = "reanchor-arrow";

const reanchor = (
  shape: NonDeleted<ExcalidrawBindableElement>,
  attachPoint: [number, number],
) => {
  const arrow = {
    ...newArrowElement({
      type: "arrow",
      x: 400,
      y: 180,
      width: 200,
      height: 0,
      points: [pointFrom(0, 0), pointFrom(-100, 0)],
    }),
    id: SCENE_ARROW_ID,
    endBinding: {
      elementId: shape.id,
      attachPoint: attachPoint as AttachPoint,
    },
  } as NonDeleted<ExcalidrawArrowElement>;

  const scene = new Scene(
    [
      {
        ...shape,
        boundElements: [{ type: "arrow" as const, id: arrow.id }],
      },
      arrow,
    ],
    { skipValidation: true },
  );

  const before = scene.getNonDeletedElement(arrow.id) as ExcalidrawArrowElement;
  const beforeEnd = before.points.at(-1)!;

  reanchorBindingsToOutline(
    scene.getNonDeletedElement(
      shape.id,
    ) as NonDeleted<ExcalidrawBindableElement>,
    scene,
  );

  const after = scene.getNonDeletedElement(arrow.id) as ExcalidrawArrowElement;
  const afterEnd = after.points.at(-1)!;

  return {
    attachPoint: after.endBinding?.attachPoint.map(r4),
    elementId: after.endBinding?.elementId,
    endpoint: [r4(after.x + afterEnd[0]), r4(after.y + afterEnd[1])],
    endpointUnchanged:
      beforeEnd[0] === afterEnd[0] && beforeEnd[1] === afterEnd[1],
  };
};

const cases: {
  name: string;
  shape: () => NonDeleted<ExcalidrawBindableElement>;
}[] = [
  {
    name: "composite star",
    shape: () =>
      ({
        ...newElement({
          type: "star",
          x: 100,
          y: 100,
          width: 200,
          height: 160,
        }),
        id: "reanchor-star",
      } as unknown as NonDeleted<ExcalidrawBindableElement>),
  },
  {
    name: "composite open path (brace)",
    shape: () =>
      ({
        ...newElement({
          type: "brace",
          x: 100,
          y: 100,
          width: 200,
          height: 160,
        }),
        id: "reanchor-brace",
      } as unknown as NonDeleted<ExcalidrawBindableElement>),
  },
  {
    name: "mindmap node",
    shape: () =>
      ({
        ...newMindmapNodeElement({
          x: 100,
          y: 100,
          width: 200,
          height: 160,
          graphId: "reanchor-graph",
          role: "root",
          parentId: null,
          order: null,
        }),
        id: "reanchor-node",
      } as unknown as NonDeleted<ExcalidrawBindableElement>),
  },
];

describe("type-conversion reanchor baseline (§5.2)", () => {
  beforeEach(() => {
    reseed(7);
  });

  it.each(cases)(
    "reanchors a bound arrow to the $name outline",
    ({ shape }) => {
      const record = reanchor(shape(), [0.9, 0.25]);

      // 重锚只改 attachPoint，端点本身留给 updateBindings
      expect(record.endpointUnchanged).toBe(true);
      expect(record.elementId).toBeDefined();
      expect(record).toMatchSnapshot();
    },
  );

  it("keeps the arrow when the attach point already hugs an open path", () => {
    // 大括号这类开路径：焦点已经贴着路径（距离 ≤ gap）时不重锚
    const brace = {
      ...newElement({
        type: "brace",
        x: 100,
        y: 100,
        width: 200,
        height: 160,
      }),
      id: "reanchor-brace-hugging",
    } as unknown as NonDeleted<ExcalidrawBindableElement>;

    const record = reanchor(brace, [0.1123, 0.7423]);

    expect(record).toMatchSnapshot();
  });
});
