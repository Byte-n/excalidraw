import { DEFAULT_ELEMENT_PROPS } from "@excalidraw/common";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import { BASE_SHAPE_IDS, baseShapeData } from "../src/compositeShape";
import { ARROWHEAD_VALUES } from "../src/arrowheads";
import { applyShapeOperation } from "../src/shapeScene";
import { applyConnectorOperation } from "../src/connectorScene";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";
import { LinearElementEditor } from "../src/linearElementEditor";
import { getBoundTextElement } from "../src/textElement";
import { isLinearElement } from "../src/typeChecks";
import { Scene } from "../src/Scene";
import { updateBindings } from "../src/binding";
import { getDefaultAppState } from "../../excalidraw/appState";
import { commitCanvasElementOperation } from "../../excalidraw/components/app/sceneOperations";
import { restoreElements } from "../../excalidraw/data/restore";

import type { ExcalidrawElement, ExcalidrawLinearElement } from "../src/types";
import type { ShapeOptions } from "../src/shapeScene";

const shape = (x = 0) =>
  applyShapeOperation([], {
    action: "create",
    kind: "rectangle",
    geometry: { x, y: 0, width: 100, height: 100 },
    text: "端点",
  });

const getLinear = (
  elements: readonly ExcalidrawElement[],
  id: string,
): ExcalidrawLinearElement => {
  const element = elements.find((item) => item.id === id);
  if (!element || !isLinearElement(element)) {
    throw new Error("测试缺少连线");
  }
  return element;
};

const preserveIdentity = (
  before: readonly ExcalidrawElement[],
  after: readonly ExcalidrawElement[],
) => {
  for (const element of before) {
    expect(after.find((item) => item.id === element.id)).toMatchObject({
      id: element.id,
      version: element.version,
      versionNonce: element.versionNonce,
      updated: element.updated,
      created: element.created,
      index: element.index,
    });
  }
};

beforeEach(() => {
  setCustomTextMetricsProvider({
    getLineWidth: (text, font) =>
      Array.from(text).length * parseFloat(font) * 0.5,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("普通图形纯场景操作", () => {
  it.each(BASE_SHAPE_IDS)("%s 创建真实标签且保留完整既有候选", (kind) => {
    const input = shape().elements;
    const snapshot = structuredClone(input);
    const created = applyShapeOperation(input, {
      action: "create",
      kind,
      geometry: { x: 200, y: 100, width: 160, height: 120 },
      text: "新图形",
    });
    const target = created.elements.find(
      (element) => element.id === created.createdElementIds[0],
    );
    expect(target).toMatchObject({
      type: "composite_shape",
      shape: baseShapeData(kind),
    });
    const text = created.elements.find(
      (element) =>
        element.type === "text" && element.containerId === target?.id,
    );
    expect(text).toMatchObject({ originalText: "新图形", isDeleted: false });
    expect(target?.boundElements).toContainEqual({
      id: text?.id,
      type: "text",
    });
    expect(created.createdElementIds).toEqual([target?.id, text?.id]);
    expect(input).toEqual(snapshot);
    preserveIdentity(input, created.elements);
  });

  it.each([
    ["triangle", { apexX: 0.3 }, { apexX: null }],
    [
      "trapezoid",
      { narrowWidthRatio: 0.2, narrowEdge: "bottom" },
      { narrowWidthRatio: null, narrowEdge: null },
    ],
    [
      "cube",
      { controlPoint: { x: 0.3, y: 0.4 } },
      { controlPoint: { x: null, y: null } },
    ],
    [
      "pie",
      {
        centralAngle: 45,
        radius: 0.3,
        sectorRatio: 0.2,
        startRadialLineAngle: 15,
      },
      {
        centralAngle: null,
        radius: null,
        sectorRatio: null,
        startRadialLineAngle: null,
      },
    ],
    [
      "circular-ring",
      {
        centralAngle: 60,
        radius: 0.3,
        sectorRatio: 0.7,
        startRadialLineAngle: -15,
      },
      {
        centralAngle: null,
        radius: null,
        sectorRatio: null,
        startRadialLineAngle: null,
      },
    ],
  ] as const)("%s 参数逐叶更新和恢复工厂默认", (kind, options, clear) => {
    const created = applyShapeOperation([], {
      action: "create",
      kind,
      geometry: { x: 0, y: 0, width: 200, height: 100 },
    });
    const target = { elementId: created.createdElementIds[0] };
    const updated = applyShapeOperation(created.elements, {
      action: "update",
      target,
      shapeOptions: options,
    });
    const reset = applyShapeOperation(updated.elements, {
      action: "update",
      target,
      shapeOptions: clear,
    });
    expect(updated.changedElementIds).toEqual([target.elementId]);
    expect(reset.elements[0]).toMatchObject({ shape: baseShapeData(kind) });
    preserveIdentity(created.elements, reset.elements);
  });

  it("立方体控制点省略叶子保持，null仅恢复指定叶子", () => {
    const created = applyShapeOperation([], {
      action: "create",
      kind: "cube",
      geometry: { x: 0, y: 0, width: 100, height: 100 },
      shapeOptions: { controlPoint: { x: 0.2, y: 0.4 } },
    });
    const updated = applyShapeOperation(created.elements, {
      action: "update",
      target: { elementId: created.createdElementIds[0] },
      shapeOptions: { controlPoint: { x: null } },
    });
    expect(updated.elements[0]).toMatchObject({
      shape: { cube: { controlPoint: { x: 0.82, y: 0.4 } } },
    });
  });

  it("图形与文字样式null恢复默认，空文字墓碑标签", () => {
    const initial = shape();
    const id = initial.createdElementIds[0];
    const updated = applyShapeOperation(initial.elements, {
      action: "update",
      target: { elementId: id },
      style: { strokeWidth: 7, backgroundColor: "red", roundness: "round" },
      textStyle: { fontSize: 36, color: "blue" },
    });
    const reset = applyShapeOperation(updated.elements, {
      action: "update",
      target: { elementId: id },
      style: { strokeWidth: null, backgroundColor: null, roundness: null },
      textStyle: { fontSize: null, color: null },
    });
    expect(reset.elements[0]).toMatchObject({
      strokeWidth: DEFAULT_ELEMENT_PROPS.strokeWidth,
      backgroundColor: DEFAULT_ELEMENT_PROPS.backgroundColor,
      roundness: null,
    });
    const cleared = applyShapeOperation(reset.elements, {
      action: "update",
      target: { elementId: id },
      text: "",
    });
    expect(cleared.deletedElementIds).toEqual([initial.createdElementIds[1]]);
    expect(cleared.elements[0].boundElements).toEqual([]);
    preserveIdentity(initial.elements, cleared.elements);
  });

  const mismatchedOptions: ShapeOptions[] = [
    { apexX: 0.4 },
    { controlPoint: { x: 0.1 } },
  ];
  it.each(mismatchedOptions)(
    "kind/options不匹配失败且不修改输入",
    (shapeOptions) => {
      const initial = shape().elements;
      const snapshot = structuredClone(initial);
      expect(() =>
        applyShapeOperation(initial, {
          action: "update",
          target: { elementId: initial[0].id },
          shapeOptions,
        }),
      ).toThrow(expect.objectContaining({ code: "invalid_input" }));
      expect(initial).toEqual(snapshot);
    },
  );
});

describe("连线纯场景与editor几何", () => {
  it("editor共享纯候选并只递增每个变化元素一次版本", () => {
    const initial = shape();
    const scene = new Scene(initial.elements, { skipValidation: true });
    const before = structuredClone(scene.getElementsIncludingDeleted());
    const result = applyShapeOperation(before, {
      action: "update",
      target: { elementId: before[0].id },
      text: "editor共享真实标签",
    });
    commitCanvasElementOperation(scene, result);
    for (const element of scene.getElementsIncludingDeleted()) {
      const previous = before.find((item) => item.id === element.id);
      if (!previous) {
        throw new Error("测试缺少原元素");
      }
      expect(element.version).toBe(
        previous.version +
          (result.changedElementIds.includes(element.id) ? 1 : 0),
      );
      expect(element.index).toBe(previous.index);
      expect(element.created).toBe(previous.created);
    }
    scene.destroy();
  });

  it("editor移动既有line端点时解除该端绑定并保留另一端", () => {
    const left = shape();
    const right = shape(400);
    const created = applyConnectorOperation(
      [...left.elements, ...right.elements],
      {
        action: "create",
        kind: "line",
        start: { elementId: left.createdElementIds[0] },
        end: { elementId: right.createdElementIds[0] },
        label: "绑定线",
      },
    );
    const scene = new Scene(created.elements, { skipValidation: true });
    const connector = scene.getNonDeletedElement(created.createdElementIds[0]);
    if (!isLinearElement(connector)) {
      throw new Error("缺少线");
    }
    LinearElementEditor.movePoints(
      connector,
      scene,
      new Map([[0, { point: pointFrom<LocalPoint>(-200, -200) }]]),
    );
    updateBindings(connector, scene, {
      ...getDefaultAppState(),
      width: 800,
      height: 600,
      offsetLeft: 0,
      offsetTop: 0,
    });
    expect(connector.startBinding).toBeNull();
    expect(connector.endBinding?.elementId).toBe(right.createdElementIds[0]);
    expect(
      scene.getNonDeletedElement(left.createdElementIds[0])?.boundElements,
    ).not.toContainEqual({ id: connector.id, type: "arrow" });
    expect(
      scene.getNonDeletedElement(right.createdElementIds[0])?.boundElements,
    ).toContainEqual({ id: connector.id, type: "arrow" });
    scene.destroy();
  });

  it("editor restore保留line端点与真实标签的合法关系", () => {
    const target = shape();
    const created = applyConnectorOperation(target.elements, {
      action: "create",
      kind: "line",
      start: { elementId: target.createdElementIds[0] },
      end: { point: { x: 300, y: 100 } },
      label: "恢复标签",
    });
    const restored = restoreElements(created.elements, null, {
      repairBindings: true,
    });
    const connector = getLinear(restored, created.createdElementIds[0]);
    expect(connector.startBinding?.elementId).toBe(target.createdElementIds[0]);
    expect(connector.boundElements).toContainEqual({
      id: created.createdElementIds[1],
      type: "text",
    });
    expect(
      restored.find((element) => element.id === target.createdElementIds[0])
        ?.boundElements,
    ).toContainEqual({ id: connector.id, type: "arrow" });
  });
  it.each(["arrow", "line"] as const)(
    "%s创建双向绑定并在移动端点时布局真实标签",
    (kind) => {
      const left = shape();
      const right = shape(400);
      const input = [...left.elements, ...right.elements];
      const snapshot = structuredClone(input);
      const created = applyConnectorOperation(input, {
        action: "create",
        kind,
        start: { elementId: left.createdElementIds[0] },
        end: { elementId: right.createdElementIds[0] },
        label: "连接标签",
      });
      const id = created.createdElementIds[0];
      for (const endpoint of [
        left.createdElementIds[0],
        right.createdElementIds[0],
      ]) {
        expect(
          created.elements.find((element) => element.id === endpoint)
            ?.boundElements,
        ).toContainEqual({ id, type: "arrow" });
      }
      const before = getLinear(created.elements, id);
      const moved = applyShapeOperation(created.elements, {
        action: "update",
        target: { elementId: left.createdElementIds[0] },
        geometry: { x: 100, y: 150 },
      });
      const after = getLinear(moved.elements, id);
      expect(after.x).not.toBe(before.x);
      expect(after.y).not.toBe(before.y);
      const scene = new Scene(moved.elements, {
        skipValidation: true,
        calculationOnly: true,
      });
      const text = getBoundTextElement(after, scene.getNonDeletedElementsMap());
      expect(text).not.toBeNull();
      if (!text) {
        throw new Error("缺少标签");
      }
      expect(text).toMatchObject(
        LinearElementEditor.getBoundTextElementPosition(
          after,
          text,
          scene.getNonDeletedElementsMap(),
        ),
      );
      scene.destroy();
      expect(input).toEqual(snapshot);
      preserveIdentity(input, moved.elements);
      preserveIdentity(created.elements, moved.elements);
    },
  );

  it.each(["arrow", "line"] as const)(
    "%s删除端点保留连接线和另一端，删除线仅墓碑标签",
    (kind) => {
      const left = shape();
      const right = shape(400);
      const created = applyConnectorOperation(
        [...left.elements, ...right.elements],
        {
          action: "create",
          kind,
          start: { elementId: left.createdElementIds[0] },
          end: { elementId: right.createdElementIds[0] },
          label: "标签",
        },
      );
      const id = created.createdElementIds[0];
      const deletedShape = applyShapeOperation(created.elements, {
        action: "delete",
        target: { elementId: left.createdElementIds[0] },
      });
      expect(getLinear(deletedShape.elements, id)).toMatchObject({
        isDeleted: false,
        startBinding: null,
        endBinding: { elementId: right.createdElementIds[0] },
      });
      expect(deletedShape.deletedElementIds).toEqual(left.createdElementIds);
      const deletedLine = applyConnectorOperation(deletedShape.elements, {
        action: "delete",
        target: { elementId: id },
      });
      expect(deletedLine.deletedElementIds).toEqual(created.createdElementIds);
      expect(
        deletedLine.elements.find(
          (element) => element.id === right.createdElementIds[0],
        )?.boundElements,
      ).not.toContainEqual({ id, type: "arrow" });
      expect(deletedLine.elements).toHaveLength(created.elements.length);
    },
  );

  it("同目标双端重连只解除一端，反向类别保持合法", () => {
    const target = shape();
    const shapeId = target.createdElementIds[0];
    const created = applyConnectorOperation(target.elements, {
      action: "create",
      kind: "line",
      start: { elementId: shapeId },
      end: { elementId: shapeId },
      label: "同端",
    });
    const id = created.createdElementIds[0];
    const reconnected = applyConnectorOperation(created.elements, {
      action: "reconnect",
      target: { elementId: id },
      start: { point: { x: -100, y: -100 } },
    });
    expect(getLinear(reconnected.elements, id)).toMatchObject({
      startBinding: null,
      endBinding: { elementId: shapeId },
    });
    expect(
      reconnected.elements[0].boundElements?.filter((ref) => ref.id === id),
    ).toEqual([{ id, type: "arrow" }]);
    const snapshot = structuredClone(reconnected.elements);
    expect(() =>
      applyConnectorOperation(reconnected.elements, {
        action: "reconnect",
        target: { elementId: id },
        end: { elementId: created.createdElementIds[1] },
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_operation" }));
    expect(reconnected.elements).toEqual(snapshot);
  });

  it("布线路径与标签共享几何，line折线拒绝", () => {
    const created = applyConnectorOperation([], {
      action: "create",
      kind: "arrow",
      start: { point: { x: 0, y: 0 } },
      end: { point: { x: 200, y: 100 } },
      label: "路径",
    });
    const id = created.createdElementIds[0];
    const curved = applyConnectorOperation(created.elements, {
      action: "update",
      target: { elementId: id },
      routing: "curved",
    });
    expect(getLinear(curved.elements, id).points.length).toBe(3);
    const orthogonal = applyConnectorOperation(curved.elements, {
      action: "update",
      target: { elementId: id },
      routing: "orthogonal",
    });
    const points = getLinear(orthogonal.elements, id).points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(
      points
        .slice(1)
        .every(
          (point, index) =>
            point[0] === points[index][0] || point[1] === points[index][1],
        ),
    ).toBe(true);
    expect(() =>
      applyConnectorOperation([], {
        action: "create",
        kind: "line",
        start: { point: { x: 0, y: 0 } },
        end: { point: { x: 200, y: 100 } },
        routing: "orthogonal",
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("公开合法头部均可用于line且支持null清除", () => {
    for (const head of ARROWHEAD_VALUES) {
      const created = applyConnectorOperation([], {
        action: "create",
        kind: "line",
        start: { point: { x: 0, y: 0 } },
        end: { point: { x: 100, y: 100 } },
        startArrowhead: head,
        endArrowhead: head,
      });
      expect(
        getLinear(created.elements, created.createdElementIds[0]).endArrowhead,
      ).not.toBeNull();
      const cleared = applyConnectorOperation(created.elements, {
        action: "update",
        target: { elementId: created.createdElementIds[0] },
        startArrowhead: null,
        endArrowhead: null,
      });
      expect(
        getLinear(cleared.elements, created.createdElementIds[0]),
      ).toMatchObject({ startArrowhead: null, endArrowhead: null });
    }
  });

  it("无DOM复用注入metrics，既有墓碑保留，实际无变更changed为空", () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    const initial = shape();
    const noChange = applyShapeOperation(initial.elements, {
      action: "update",
      target: { elementId: initial.createdElementIds[0] },
      text: "端点",
    });
    expect(noChange.changedElementIds).toEqual([]);
    const deleted = applyShapeOperation(noChange.elements, {
      action: "delete",
      target: { elementId: initial.createdElementIds[0] },
    });
    const line = applyConnectorOperation(deleted.elements, {
      action: "create",
      kind: "line",
      start: { point: { x: 0, y: 0 } },
      end: { point: { x: 100, y: 100 } },
      label: "Node标签",
    });
    expect(line.elements.slice(0, deleted.elements.length)).toEqual(
      deleted.elements,
    );
  });
});
