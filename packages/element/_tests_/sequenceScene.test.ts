import { beforeEach, describe, expect, it } from "vitest";

import {
  getSequenceLifelineDefaultSize,
  isActivationElement,
  isSequenceFragmentElement,
  isSequenceLifelineElement,
  SEQUENCE_ACTIVATION_HEIGHT,
  SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT,
  SEQUENCE_MIN_POLE_LENGTH,
} from "../src/compositeShape";
import { applySequenceOperation } from "../src/sequenceScene";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";

import type { ExcalidrawElement } from "../src/types";

beforeEach(() => {
  setCustomTextMetricsProvider({
    getLineWidth: (text, font) =>
      Array.from(text).length * parseFloat(font) * 0.5,
  });
});

const byId = (elements: readonly ExcalidrawElement[], id: string) => {
  const element = elements.find((item) => item.id === id);
  if (!element) {
    throw new Error(`缺少元素 ${id}`);
  }
  return element;
};

const refId = (result: ReturnType<typeof applySequenceOperation>) => {
  if (result.references.domain !== "sequence") {
    throw new Error("引用域错误");
  }
  return result.references.elementId;
};

const addParticipant = (
  elements: readonly ExcalidrawElement[],
  kind: "sc-lifeline-entity" | "sc-lifeline-object",
  x: number,
  y: number,
  text?: string,
) =>
  applySequenceOperation(elements, {
    action: "addParticipant",
    kind,
    position: { x, y },
    ...(text === undefined ? {} : { text }),
  });

const twoParticipants = () => {
  const first = addParticipant([], "sc-lifeline-entity", 0, 0, "客户端");
  const second = addParticipant(
    first.elements,
    "sc-lifeline-object",
    400,
    0,
    "服务端",
  );
  return {
    elements: second.elements,
    firstId: refId(first),
    secondId: refId(second),
  };
};

describe("sequence 参与者", () => {
  it("按默认尺寸创建生命线", () => {
    const result = addParticipant([], "sc-lifeline-entity", 10, 20);
    const lifeline = byId(result.elements, refId(result));
    const size = getSequenceLifelineDefaultSize("sc-lifeline-entity");
    expect(lifeline).toMatchObject({
      type: "sequence",
      x: 10,
      y: 20,
      width: size.width,
      height: size.height,
    });
    expect(isSequenceLifelineElement(lifeline)).toBe(true);
    if (!isSequenceLifelineElement(lifeline)) {
      return;
    }
    expect(lifeline.height).toBeGreaterThanOrEqual(
      lifeline.shape.lifeline.headHeight + SEQUENCE_MIN_POLE_LENGTH,
    );
  });

  it("生命线标签写入正文并触发头部适配", () => {
    const result = addParticipant([], "sc-lifeline-entity", 10, 20, "客户端");
    const lifeline = byId(result.elements, refId(result));
    expect(lifeline.texts?.body?.text).toBe("客户端");
    const size = getSequenceLifelineDefaultSize("sc-lifeline-entity");
    expect(lifeline.height).toBeGreaterThan(size.height);
  });

  it("删除参与者时级联删除激活条与消息", () => {
    const { elements, firstId, secondId } = twoParticipants();
    const message = applySequenceOperation(elements, {
      action: "addMessage",
      from: { participantId: firstId },
      to: { participantId: secondId },
      y: 200,
    });
    const messageArrow = byId(message.elements, refId(message));
    if (messageArrow.type !== "arrow") {
      throw new Error("消息应为箭头");
    }
    const removed = applySequenceOperation(message.elements, {
      action: "removeParticipant",
      target: { elementId: firstId },
    });
    expect(removed.deletedElementIds).toEqual(
      expect.arrayContaining([
        firstId,
        refId(message),
        messageArrow.startBinding!.elementId,
      ]),
    );
    expect(removed.deletedElementIds).not.toContain(
      messageArrow.endBinding!.elementId,
    );
    const alive = removed.elements.filter((element) => !element.isDeleted);
    expect(alive.some((element) => element.id === refId(message))).toBe(false);
    expect(
      alive.some(
        (element) =>
          isActivationElement(element) &&
          element.shape.link?.lifelineId === firstId,
      ),
    ).toBe(false);
  });
});

describe("sequence 消息与激活条", () => {
  it("创建消息时自动创建两端激活条并建立绑定", () => {
    const { elements, firstId, secondId } = twoParticipants();
    const result = applySequenceOperation(elements, {
      action: "addMessage",
      from: { participantId: firstId },
      to: { participantId: secondId },
      y: 200,
      text: "调用",
    });
    const arrow = byId(result.elements, refId(result));
    if (arrow.type !== "arrow") {
      throw new Error("消息应为箭头");
    }
    expect(arrow.points).toHaveLength(2);
    expect(arrow.points[1][1]).toBe(0);
    expect(arrow.startBinding).not.toBeNull();
    expect(arrow.endBinding).not.toBeNull();
    expect(arrow.texts?.label?.text).toBe("调用");
    expect(result.createdElementIds).toHaveLength(3);

    const startActivation = byId(
      result.elements,
      arrow.startBinding!.elementId,
    );
    const endActivation = byId(result.elements, arrow.endBinding!.elementId);
    expect(isActivationElement(startActivation)).toBe(true);
    expect(isActivationElement(endActivation)).toBe(true);
    if (
      !isActivationElement(startActivation) ||
      !isActivationElement(endActivation)
    ) {
      return;
    }
    expect(startActivation.shape.link?.lifelineId).toBe(firstId);
    expect(endActivation.shape.link?.lifelineId).toBe(secondId);
    const first = byId(result.elements, firstId);
    expect(
      first.boundElements?.some(
        (entry) =>
          entry.id === startActivation.id && entry.type === "activation",
      ),
    ).toBe(true);
    expect(arrow.x).toBe(startActivation.x + startActivation.width);
    expect(arrow.x + arrow.points[1][0]).toBe(endActivation.x);
  });

  it("同一竖向范围复用已有激活条", () => {
    const { elements, firstId, secondId } = twoParticipants();
    const first = applySequenceOperation(elements, {
      action: "addMessage",
      from: { participantId: firstId },
      to: { participantId: secondId },
      y: 200,
    });
    const firstArrow = byId(first.elements, refId(first));
    if (firstArrow.type !== "arrow") {
      throw new Error("消息应为箭头");
    }
    const second = applySequenceOperation(first.elements, {
      action: "addMessage",
      from: { participantId: firstId },
      to: { participantId: secondId },
      y: 240,
    });
    expect(second.createdElementIds).toHaveLength(1);
    const secondArrow = byId(second.elements, refId(second));
    if (secondArrow.type !== "arrow") {
      throw new Error("消息应为箭头");
    }
    expect(secondArrow.startBinding?.elementId).toBe(
      firstArrow.startBinding?.elementId,
    );
    expect(secondArrow.endBinding?.elementId).toBe(
      firstArrow.endBinding?.elementId,
    );
  });

  it("同一参与者的消息生成自消息折线", () => {
    const { elements, firstId } = twoParticipants();
    const result = applySequenceOperation(elements, {
      action: "addMessage",
      from: { participantId: firstId },
      to: { participantId: firstId },
      y: 200,
      text: "重试",
    });
    const arrow = byId(result.elements, refId(result));
    if (arrow.type !== "arrow") {
      throw new Error("消息应为箭头");
    }
    expect(arrow.points).toHaveLength(4);
    expect(arrow.startBinding?.elementId).toBe(arrow.endBinding?.elementId);
    expect(arrow.startBinding?.attachPoint?.[0]).toBe(1);
    expect(arrow.endBinding?.attachPoint?.[0]).toBe(1);
  });
});

describe("sequence 组合片段", () => {
  it("创建片段时初始化页签行与正文行，并支持增删行", () => {
    const created = applySequenceOperation([], {
      action: "addFragment",
      position: { x: 0, y: 0 },
      operator: "alt",
    });
    const fragment = byId(created.elements, refId(created));
    if (!isSequenceFragmentElement(fragment)) {
      throw new Error("片段类型错误");
    }
    expect(fragment.textFitMode).toBe("fixed");
    expect(fragment.shape.fragment?.rows?.length).toBeGreaterThanOrEqual(2);
    expect(fragment.texts?.body?.text).toBe("alt");
    const beforeHeight = fragment.height;

    const inserted = applySequenceOperation(created.elements, {
      action: "updateFragment",
      target: { elementId: fragment.id },
      insertRowAt: 1,
    });
    const grown = byId(inserted.elements, fragment.id);
    expect(grown.height).toBeCloseTo(
      beforeHeight + SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT,
      6,
    );

    if (!isSequenceFragmentElement(grown)) {
      throw new Error("片段类型错误");
    }
    const deleted = applySequenceOperation(inserted.elements, {
      action: "updateFragment",
      target: { elementId: fragment.id },
      deleteRowId: grown.shape.fragment!.rows[1].id,
    });
    const shrunk = byId(deleted.elements, fragment.id);
    expect(shrunk.height).toBeCloseTo(beforeHeight, 6);
  });

  it("更新不存在的行报 target_not_found", () => {
    const created = applySequenceOperation([], {
      action: "addFragment",
      position: { x: 0, y: 0 },
    });
    expect(() =>
      applySequenceOperation(created.elements, {
        action: "updateFragment",
        target: { elementId: refId(created) },
        deleteRowId: "missing-row",
      }),
    ).toThrowError(/组合片段行不存在/);
  });
});

describe("sequence 消息生命周期", () => {
  it("删除消息时清理连线，但保留激活条", () => {
    const { elements, firstId, secondId } = twoParticipants();
    const created = applySequenceOperation(elements, {
      action: "addMessage",
      from: { participantId: firstId },
      to: { participantId: secondId },
      y: 200,
    });
    const removed = applySequenceOperation(created.elements, {
      action: "removeMessage",
      target: { elementId: refId(created) },
    });
    expect(removed.deletedElementIds).toContain(refId(created));
    const alive = removed.elements.filter((element) => !element.isDeleted);
    expect(
      alive.filter((element) => isActivationElement(element)),
    ).toHaveLength(2);
    const activation = alive.find((element) => isActivationElement(element))!;
    expect(
      activation.boundElements?.some((entry) => entry.id === refId(created)) ??
        false,
    ).toBe(false);
  });

  it("激活条默认高度覆盖周围消息行", () => {
    const { elements, firstId, secondId } = twoParticipants();
    const created = applySequenceOperation(elements, {
      action: "addMessage",
      from: { participantId: firstId },
      to: { participantId: secondId },
      y: 200,
    });
    const arrow = byId(created.elements, refId(created));
    if (arrow.type !== "arrow") {
      throw new Error("消息应为箭头");
    }
    const activation = byId(created.elements, arrow.startBinding!.elementId);
    expect(activation.height).toBe(SEQUENCE_ACTIVATION_HEIGHT);
  });
});
