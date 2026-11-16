import { beforeEach, describe, expect, it } from "vitest";

import { applyShapeOperation } from "../src/shapeScene";
import { CanvasSceneError } from "../src/sceneOperations";
import { applyTextOperation } from "../src/textScene";
import { getTextElementText } from "../src/text/elementText";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";

import type { ExcalidrawElement, ExcalidrawTextElement } from "../src/types";

beforeEach(() => {
  setCustomTextMetricsProvider({
    getLineWidth: (text, font) =>
      Array.from(text).length * parseFloat(font) * 0.5,
  });
});

const createText = (
  text: string,
  extra: Partial<Parameters<typeof applyTextOperation>[1]> = {},
) => {
  const result = applyTextOperation([], {
    action: "create",
    x: 10,
    y: 20,
    text,
    ...extra,
  } as Parameters<typeof applyTextOperation>[1]);
  const element = result.elements.find(
    (item) => item.id === result.createdElementIds[0],
  );
  if (!element || element.type !== "text") {
    throw new Error("测试缺少文字元素");
  }
  return { result, element: element as ExcalidrawTextElement };
};

const updateText = (
  elements: readonly ExcalidrawElement[],
  target: string,
  extra: Partial<Parameters<typeof applyTextOperation>[1]> = {},
) =>
  applyTextOperation(elements, {
    action: "update",
    target: { elementId: target },
    ...extra,
  } as Parameters<typeof applyTextOperation>[1]);

const getText = (elements: readonly ExcalidrawElement[], id: string) => {
  const element = elements.find((item) => item.id === id);
  if (!element || element.type !== "text") {
    throw new Error(`缺少文字元素 ${id}`);
  }
  return element as ExcalidrawTextElement;
};

const expectSceneError = (fn: () => unknown, code: string) => {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(CanvasSceneError);
  expect((error as CanvasSceneError).code).toBe(code);
};

describe("文本语义操作", () => {
  it("创建文字以传入坐标为左上角，并写入样式", () => {
    const { result, element } = createText("Hello", {
      style: { fontSize: 20, textAlign: "center", color: "#ff0000" },
    });
    expect(element.type).toBe("text");
    expect(element.x).toBe(10);
    expect(element.y).toBe(20);
    expect(getTextElementText(element)).toBe("Hello");
    expect(element.texts.body.style.textAlign).toBe("center");
    expect(element.texts.body.style.fontSize).toBe(20);
    expect(element.strokeColor).toBe("#ff0000");
    expect(element.autoResize).toBe(true);
    expect(result.references).toEqual({
      domain: "text",
      action: "create",
      elementId: element.id,
    });
    expect(result.createdElementIds).toEqual([element.id]);
  });

  it("固定宽度创建时按宽度换行", () => {
    const { element } = createText("hello world this is long", {
      autoResize: false,
      width: 50,
    });
    expect(element.autoResize).toBe(false);
    expect(element.width).toBe(50);
    expect(getTextElementText(element)).toContain("\n");
    expect(element.height).toBeGreaterThan(20);
  });

  it("更新文本、样式与固定宽度换行", () => {
    const created = createText("hi");
    const updated = updateText(created.result.elements, created.element.id, {
      text: "hello world",
      style: { fontSize: 20 },
    });
    const text = getText(updated.elements, created.element.id);
    expect(getTextElementText(text)).toBe("hello world");
    expect(text.width).toBeGreaterThan(created.element.width);

    const wrapped = updateText(updated.elements, text.id, {
      text: "hello world this is long",
      autoResize: false,
      width: 45,
    });
    const fixed = getText(wrapped.elements, text.id);
    expect(fixed.autoResize).toBe(false);
    expect(fixed.width).toBe(45);
    expect(getTextElementText(fixed)).toContain("\n");
  });

  it("显式 x/y 更新按左上角定位", () => {
    const created = createText("hello");
    const updated = updateText(created.result.elements, created.element.id, {
      x: 300,
      y: 400,
      text: "hello world",
    });
    const text = getText(updated.elements, created.element.id);
    expect(text.x).toBe(300);
    expect(text.y).toBe(400);
  });

  it("删除文字元素", () => {
    const created = createText("bye");
    const deleted = applyTextOperation(created.result.elements, {
      action: "delete",
      target: { elementId: created.element.id },
    });
    expect(getText(deleted.elements, created.element.id).isDeleted).toBe(true);
    expect(deleted.deletedElementIds).toEqual([created.element.id]);
    expect(deleted.references).toEqual({
      domain: "text",
      action: "delete",
      elementId: created.element.id,
    });
  });

  it("非文字目标抛 target_not_found", () => {
    expectSceneError(
      () =>
        applyTextOperation([], {
          action: "update",
          target: { elementId: "missing" },
          text: "x",
        }),
      "target_not_found",
    );

    const shape = applyShapeOperation([], {
      action: "create",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 100, height: 100 },
    });
    const shapeId = shape.createdElementIds[0];
    expectSceneError(
      () =>
        applyTextOperation(shape.elements, {
          action: "update",
          target: { elementId: shapeId },
          text: "x",
        }),
      "target_not_found",
    );
  });

  it("文字元素不能作为图形更新目标", () => {
    const created = createText("hello");
    expectSceneError(
      () =>
        applyShapeOperation(created.result.elements, {
          action: "update",
          target: { elementId: created.element.id },
          text: "x",
        }),
      "target_not_found",
    );
  });
});

describe("图形 textFit", () => {
  const longText = "这是一个很长很长的文本内容用来撑开图形的高度".repeat(5);

  it("fixed 模式写长文本后几何不变", () => {
    const created = applyShapeOperation([], {
      action: "create",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 100, height: 100 },
      text: longText,
      textFit: { mode: "fixed" },
    });
    const shape = created.elements.find(
      (element) => element.id === created.createdElementIds[0],
    );
    expect(shape).toMatchObject({
      width: 100,
      height: 100,
      textFitMode: "fixed",
      textFitMinWidth: 100,
      textFitMinHeight: 100,
    });

    const updated = applyShapeOperation(created.elements, {
      action: "update",
      target: { elementId: created.createdElementIds[0] },
      text: `${longText}${longText}`,
      textFit: { mode: "fixed" },
    });
    const current = updated.elements.find(
      (element) => element.id === created.createdElementIds[0],
    );
    expect(current).toMatchObject({ width: 100, height: 100 });
  });

  it("auto 模式写长文本会增长几何", () => {
    const created = applyShapeOperation([], {
      action: "create",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 100, height: 100 },
      text: longText,
      textFit: { mode: "auto" },
    });
    const shape = created.elements.find(
      (element) => element.id === created.createdElementIds[0],
    );
    expect(shape!.height).toBeGreaterThan(100);
    expect(shape).toMatchObject({ textFitMode: "auto" });
  });

  it("从 auto 切换到 fixed 时以当前宽高冻结下界", () => {
    const created = applyShapeOperation([], {
      action: "create",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 120, height: 90 },
    });
    const updated = applyShapeOperation(created.elements, {
      action: "update",
      target: { elementId: created.createdElementIds[0] },
      text: longText,
      textFit: { mode: "fixed" },
    });
    const shape = updated.elements.find(
      (element) => element.id === created.createdElementIds[0],
    );
    expect(shape).toMatchObject({
      width: 120,
      height: 90,
      textFitMinWidth: 120,
      textFitMinHeight: 90,
    });
  });
});
