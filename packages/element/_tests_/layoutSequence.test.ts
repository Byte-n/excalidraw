import { beforeEach, describe, expect, it } from "vitest";

import {
  isActivationElement,
  isSequenceFragmentElement,
} from "../src/compositeShape";
import { layoutElements } from "../src/layout";
import {
  applySequenceOperation,
  type SequenceOperation,
} from "../src/sequenceScene";
import { CanvasSceneError } from "../src/sceneOperations";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";

import type { ExcalidrawElement } from "../src/types";

beforeEach(() => {
  setCustomTextMetricsProvider({
    getLineWidth: (text, font) =>
      Array.from(text).length * parseFloat(font) * 0.5,
  });
});

const refId = (result: ReturnType<typeof applySequenceOperation>) => {
  if (result.references.domain !== "sequence") {
    throw new Error("引用域错误");
  }
  return result.references.elementId;
};

const run = (
  elements: readonly ExcalidrawElement[],
  operation: SequenceOperation,
) => applySequenceOperation(elements, operation);

const byId = (elements: readonly ExcalidrawElement[], id: string) => {
  const element = elements.find((item) => item.id === id);
  if (!element) {
    throw new Error(`缺少元素 ${id}`);
  }
  return element;
};

const participant = (
  elements: readonly ExcalidrawElement[],
  kind: "sc-lifeline-entity" | "sc-lifeline-object",
  x: number,
  height?: number,
) =>
  run(elements, {
    action: "addParticipant",
    kind,
    position: { x, y: 0 },
    ...(height === undefined ? {} : { height }),
  });

const message = (
  elements: readonly ExcalidrawElement[],
  from: string,
  to: string,
  y?: number,
) =>
  run(elements, {
    action: "addMessage",
    from: { participantId: from },
    to: { participantId: to },
    ...(y === undefined ? {} : { y }),
  });

const buildDiagram = () => {
  const first = participant([], "sc-lifeline-entity", 0);
  const second = participant(first.elements, "sc-lifeline-object", 500);
  const firstId = refId(first);
  const secondId = refId(second);
  const call = message(second.elements, firstId, secondId, 200);
  const reply = message(call.elements, secondId, firstId, 300);
  const fragment = run(reply.elements, {
    action: "addFragment",
    position: { x: -40, y: 160 },
    width: 700,
    height: 220,
    operator: "alt",
  });
  return {
    elements: fragment.elements,
    firstId,
    secondId,
    callId: refId(call),
    replyId: refId(reply),
    fragmentId: refId(fragment),
  };
};

describe("sequence 布局", () => {
  it("参与者横向等距排列、顶部对齐，消息按行排布", () => {
    const { elements, firstId, secondId, callId, replyId } = buildDiagram();
    const result = layoutElements(elements, {
      ids: [firstId, secondId],
      algorithm: "sequence",
      origin: { x: 40, y: 60 },
      options: { gap: 120, rankGap: 50, nodeGap: 60 },
    });
    const first = byId(result.elements, firstId);
    const second = byId(result.elements, secondId);
    expect(first.x).toBe(40);
    expect(first.y).toBe(60);
    expect(second.x).toBeCloseTo(first.x + first.width + 120, 6);
    expect(second.y).toBe(60);

    const call = byId(result.elements, callId);
    const reply = byId(result.elements, replyId);
    if (call.type !== "arrow" || reply.type !== "arrow") {
      throw new Error("消息应为箭头");
    }
    expect(call.points[1][1]).toBe(0);
    expect(reply.points[1][1]).toBe(0);
    expect(reply.y - call.y).toBeCloseTo(50, 6);
    expect(call.y).toBeCloseTo(60 + 68.272 + 60, 6);

    const startActivation = byId(result.elements, call.startBinding!.elementId);
    const endActivation = byId(result.elements, call.endBinding!.elementId);
    if (
      !isActivationElement(startActivation) ||
      !isActivationElement(endActivation)
    ) {
      throw new Error("激活条类型错误");
    }
    expect(call.x).toBeCloseTo(startActivation.x + startActivation.width, 6);
    expect(call.x + call.points[1][0]).toBeCloseTo(endActivation.x, 6);
    expect(startActivation.y).toBeLessThanOrEqual(call.y);
    expect(startActivation.y + startActivation.height).toBeGreaterThanOrEqual(
      call.y,
    );
  });

  it("生命线随消息行向下增长，片段覆盖参与者与消息", () => {
    const first = participant([], "sc-lifeline-entity", 0, 150);
    const second = participant(first.elements, "sc-lifeline-object", 500, 150);
    const firstId = refId(first);
    const secondId = refId(second);
    const call = message(second.elements, firstId, secondId, 200);
    const reply = message(call.elements, secondId, firstId, 300);
    const fragment = run(reply.elements, {
      action: "addFragment",
      position: { x: -40, y: 160 },
      width: 700,
      height: 220,
      operator: "alt",
    });
    const callId = refId(call);
    const replyId = refId(reply);
    const fragmentId = refId(fragment);
    const result = layoutElements(fragment.elements, {
      ids: [firstId, secondId, fragmentId],
      algorithm: "sequence",
      origin: { x: 0, y: 0 },
      options: { gap: 100, rankGap: 50, nodeGap: 60 },
    });
    const lastRow = byId(result.elements, replyId).y;
    for (const lifelineId of [firstId, secondId]) {
      const lifeline = byId(result.elements, lifelineId);
      expect(lifeline.height).toBeGreaterThanOrEqual(lastRow + 32);
    }

    const laidOutFragment = byId(result.elements, fragmentId);
    if (!isSequenceFragmentElement(laidOutFragment)) {
      throw new Error("片段类型错误");
    }
    const laidOutFirst = byId(result.elements, firstId);
    const laidOutSecond = byId(result.elements, secondId);
    expect(laidOutFragment.x).toBeLessThanOrEqual(laidOutFirst.x);
    expect(laidOutFragment.x + laidOutFragment.width).toBeGreaterThanOrEqual(
      laidOutSecond.x + laidOutSecond.width,
    );
    expect(laidOutFragment.y).toBeLessThanOrEqual(
      byId(result.elements, callId).y,
    );
    expect(laidOutFragment.y + laidOutFragment.height).toBeGreaterThanOrEqual(
      byId(result.elements, replyId).y,
    );
    expect(laidOutFragment.shape.fragment?.rows?.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("重复布局保持几何不变", () => {
    const { elements, firstId, secondId, fragmentId } = buildDiagram();
    const request = {
      ids: [firstId, secondId, fragmentId],
      algorithm: "sequence" as const,
      origin: { x: 0, y: 0 },
      options: { gap: 100, rankGap: 50, nodeGap: 60 },
    };
    const first = layoutElements(elements, request);
    const second = layoutElements(first.elements, request);
    expect(second.affectedElementIds).toEqual([]);
    for (const id of [firstId, secondId, fragmentId]) {
      const before = byId(first.elements, id);
      const after = byId(second.elements, id);
      expect([after.x, after.y, after.width, after.height]).toEqual([
        before.x,
        before.y,
        before.width,
        before.height,
      ]);
    }
  });

  it("没有生命线时拒绝布局", () => {
    const fragment = run([], {
      action: "addFragment",
      position: { x: 0, y: 0 },
    });
    expect(() =>
      layoutElements(fragment.elements, {
        ids: [refId(fragment)],
        algorithm: "sequence",
      }),
    ).toThrow(CanvasSceneError);
  });
});
