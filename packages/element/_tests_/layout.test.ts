import { beforeEach, describe, expect, it } from "vitest";

import { applyConnectorOperation } from "../src/connectorScene";
import { layoutElements } from "../src/layout";
import { buildMindmapGraphFromTree } from "../src/mindmapScene";
import { newElement } from "../src/newElement";
import { CanvasSceneError } from "../src/sceneOperations";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";
import { isLinearElement, isMindmapNodeElement } from "../src/typeChecks";

import type { ExcalidrawElement, FractionalIndex } from "../src/types";

beforeEach(() => {
  setCustomTextMetricsProvider({
    getLineWidth: (text, font) =>
      Array.from(text).length * parseFloat(font) * 0.5,
  });
});

const rect = (
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 60,
  index?: number,
): ExcalidrawElement => ({
  ...newElement({
    type: "rectangle",
    x,
    y,
    width,
    height,
  }),
  id,
  index: (index === undefined
    ? null
    : `a${String(index).padStart(4, "0")}`) as FractionalIndex | null,
});

const connect = (
  elements: readonly ExcalidrawElement[],
  from: string,
  to: string,
) => {
  const result = applyConnectorOperation(elements, {
    action: "create",
    kind: "arrow",
    start: { elementId: from },
    end: { elementId: to },
  });
  return { elements: result.elements, arrowId: result.createdElementIds[0] };
};

const byId = (elements: readonly ExcalidrawElement[], id: string) => {
  const element = elements.find((item) => item.id === id);
  if (!element) {
    throw new Error(`缺少元素 ${id}`);
  }
  return element;
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

const chain = () => {
  const first = connect(
    [
      rect("a", 0, 0, 100, 60, 1),
      rect("b", 300, 200, 100, 60, 2),
      rect("c", 600, 400, 100, 60, 3),
    ],
    "a",
    "b",
  );
  const second = connect(first.elements, "b", "c");
  return {
    elements: second.elements,
    arrowIds: [first.arrowId, second.arrowId],
  };
};

describe("layered 布局", () => {
  it("TB 按最长路径分层，层距与节点不重叠", () => {
    const { elements } = chain();
    const snapshot = structuredClone(elements);
    const result = layoutElements(elements, {
      ids: ["a", "b", "c"],
      algorithm: "layered",
      origin: { x: 0, y: 0 },
      options: { direction: "TB", rankGap: 80, nodeGap: 40 },
    });
    const a = byId(result.elements, "a");
    const b = byId(result.elements, "b");
    const c = byId(result.elements, "c");
    expect(a).toMatchObject({ x: 0, y: 0 });
    expect(b).toMatchObject({ x: 0, y: 140 });
    expect(c).toMatchObject({ x: 0, y: 280 });
    expect(elements).toEqual(snapshot);
    expect(result.affectedElementIds).toEqual(
      expect.arrayContaining(["b", "c"]),
    );
    expect(result.bounds.width).toBeGreaterThanOrEqual(100);
    expect(result.bounds.y).toBeLessThanOrEqual(140);
  });

  it("LR 横向分层，绑定箭头端点跟随节点", () => {
    const { elements, arrowIds } = chain();
    const beforeArrow = byId(elements, arrowIds[0]);
    if (!isLinearElement(beforeArrow)) {
      throw new Error("缺少连线");
    }
    const beforeLast = beforeArrow.points[beforeArrow.points.length - 1];
    const beforeEnd = {
      x: beforeArrow.x + beforeLast[0],
      y: beforeArrow.y + beforeLast[1],
    };
    const result = layoutElements(elements, {
      ids: ["a", "b", "c"],
      algorithm: "layered",
      origin: { x: 0, y: 0 },
      options: { direction: "LR" },
    });
    expect(byId(result.elements, "a")).toMatchObject({ x: 0, y: 0 });
    expect(byId(result.elements, "b")).toMatchObject({ x: 180, y: 0 });
    expect(byId(result.elements, "c")).toMatchObject({ x: 360, y: 0 });

    const arrow = byId(result.elements, arrowIds[0]);
    if (!isLinearElement(arrow)) {
      throw new Error("缺少连线");
    }
    const b = byId(result.elements, "b");
    const last = arrow.points[arrow.points.length - 1];
    const end = { x: arrow.x + last[0], y: arrow.y + last[1] };
    expect(end.x).toBeGreaterThanOrEqual(b.x - 10);
    expect(end.x).toBeLessThanOrEqual(b.x + b.width + 10);
    expect(end.y).toBeGreaterThanOrEqual(b.y - 10);
    expect(end.y).toBeLessThanOrEqual(b.y + b.height + 10);
    expect(end).not.toEqual(beforeEnd);
    expect(result.affectedElementIds).toContain(arrowIds[0]);
  });

  it("遇到环只记录 warning，不抛错", () => {
    const first = connect([rect("a", 0, 0), rect("b", 200, 0)], "a", "b");
    const second = connect(first.elements, "b", "a");
    const result = layoutElements(second.elements, {
      ids: ["a", "b"],
      algorithm: "layered",
      origin: { x: 0, y: 0 },
    });
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "layout_cycle_ignored",
    );
  });

  it("无连线时给出 warning 并仍按单行排列", () => {
    const elements = [
      rect("a", 0, 0, 100, 60, 1),
      rect("b", 200, 100, 80, 40, 2),
    ];
    const result = layoutElements(elements, {
      ids: ["a", "b"],
      algorithm: "layered",
      origin: { x: 0, y: 0 },
    });
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "layout_no_edges",
    );
    expect(byId(result.elements, "a").y).toBe(0);
    expect(byId(result.elements, "b").y).toBe(0);
    const a = byId(result.elements, "a");
    const b = byId(result.elements, "b");
    expect(b.x).toBe(a.x + a.width + 40);
  });

  it("空 ids 与不存在的 id 抛错", () => {
    expectSceneError(
      () => layoutElements([], { ids: [], algorithm: "grid" }),
      "invalid_input",
    );
    expectSceneError(
      () =>
        layoutElements([rect("a", 0, 0)], {
          ids: ["missing"],
          algorithm: "grid",
        }),
      "target_not_found",
    );
  });
});

describe("tree 布局", () => {
  it("按脑图 graphId 重排并平移到 origin", () => {
    const built = buildMindmapGraphFromTree(
      {
        text: "根",
        children: [{ text: "子", children: [] }],
      },
      { x: 0, y: 0 },
    );
    const nodeIds = built.elements
      .filter(isMindmapNodeElement)
      .map((element) => element.id);
    const childId = nodeIds[1];
    const moved = built.elements.map((element) =>
      element.id === childId
        ? { ...element, x: element.x + 300, y: element.y + 300 }
        : element,
    );
    const result = layoutElements(moved, {
      ids: nodeIds,
      algorithm: "tree",
      origin: { x: 40, y: 50 },
    });
    expect(result.affectedElementIds.length).toBeGreaterThan(0);
    expect(result.bounds.x).toBeCloseTo(40);
    expect(result.bounds.y).toBeCloseTo(50);
    expect(result.bounds.width).toBeGreaterThan(0);
    expect(result.bounds.height).toBeGreaterThan(0);
    expect(byId(result.elements, childId).x).not.toBe(byId(moved, childId).x);
  });

  it("没有脑图元素时给出 warning 且不改几何", () => {
    const elements = [rect("a", 0, 0), rect("b", 100, 100)];
    const result = layoutElements(elements, {
      ids: ["a", "b"],
      algorithm: "tree",
    });
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "layout_no_mindmap",
    );
    expect(result.affectedElementIds).toEqual([]);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(result.elements).toBe(elements);
  });
});

describe("grid / row / column / stack", () => {
  const boxes = () => [
    rect("g1", 0, 0, 100, 60, 1),
    rect("g2", 200, 100, 80, 40, 2),
    rect("g3", 400, 200, 120, 50, 3),
    rect("g4", 600, 300, 90, 70, 4),
  ];

  it("grid 按列宽与行高排列并尊重 origin", () => {
    const result = layoutElements(boxes(), {
      ids: ["g1", "g2", "g3", "g4"],
      algorithm: "grid",
      origin: { x: 10, y: 20 },
      options: { columns: 2, gap: 10 },
    });
    expect(byId(result.elements, "g1")).toMatchObject({ x: 10, y: 20 });
    expect(byId(result.elements, "g2")).toMatchObject({ x: 140, y: 20 });
    expect(byId(result.elements, "g3")).toMatchObject({ x: 10, y: 90 });
    expect(byId(result.elements, "g4")).toMatchObject({ x: 140, y: 90 });
  });

  it("columns 为 0 时使用默认值并给出 warning", () => {
    const result = layoutElements(boxes(), {
      ids: ["g1", "g2", "g3", "g4"],
      algorithm: "grid",
      options: { columns: 0 },
    });
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "layout_option_corrected",
    );
  });

  it("row 横向单行、column 纵向单列", () => {
    const row = layoutElements(boxes(), {
      ids: ["g1", "g2", "g3", "g4"],
      algorithm: "row",
      origin: { x: 0, y: 0 },
    });
    expect(byId(row.elements, "g1")).toMatchObject({ x: 0, y: 0 });
    expect(byId(row.elements, "g2")).toMatchObject({ x: 124, y: 0 });
    expect(byId(row.elements, "g3")).toMatchObject({ x: 228, y: 0 });
    expect(byId(row.elements, "g4")).toMatchObject({ x: 372, y: 0 });

    const column = layoutElements(boxes(), {
      ids: ["g1", "g2", "g3", "g4"],
      algorithm: "column",
      origin: { x: 0, y: 0 },
    });
    expect(byId(column.elements, "g1")).toMatchObject({ x: 0, y: 0 });
    expect(byId(column.elements, "g2")).toMatchObject({ x: 0, y: 84 });
    expect(byId(column.elements, "g3")).toMatchObject({ x: 0, y: 148 });
    expect(byId(column.elements, "g4")).toMatchObject({ x: 0, y: 222 });
  });

  it("stack 左上角对齐、宽高保持不变", () => {
    const result = layoutElements(boxes(), {
      ids: ["g1", "g2", "g3", "g4"],
      algorithm: "stack",
      origin: { x: 5, y: 7 },
      options: { gap: 0 },
    });
    expect(byId(result.elements, "g1")).toMatchObject({
      x: 5,
      y: 7,
      width: 100,
      height: 60,
    });
    expect(byId(result.elements, "g2")).toMatchObject({ x: 5, y: 67 });
    expect(byId(result.elements, "g3")).toMatchObject({ x: 5, y: 107 });
    expect(byId(result.elements, "g4")).toMatchObject({ x: 5, y: 157 });
  });

  it("未指定 origin 时使用选中元素包围盒左上角", () => {
    const elements = [
      rect("g1", 50, 60, 100, 60, 1),
      rect("g2", 0, 0, 80, 40, 2),
    ];
    const result = layoutElements(elements, {
      ids: ["g1", "g2"],
      algorithm: "row",
    });
    expect(byId(result.elements, "g1")).toMatchObject({ x: 0, y: 0 });
  });
});

describe("align / distribute", () => {
  const boxes = () => [
    rect("a", 0, 0, 100, 60, 1),
    rect("b", 200, 100, 80, 40, 2),
    rect("c", 500, 300, 120, 80, 3),
  ];

  it("align 默认在 x 轴上居中", () => {
    const result = layoutElements(boxes(), {
      ids: ["a", "b", "c"],
      algorithm: "align",
    });
    expect(byId(result.elements, "a").x).toBe(260);
    expect(byId(result.elements, "b").x).toBe(270);
    expect(byId(result.elements, "c").x).toBe(250);
  });

  it("align 支持 start / end", () => {
    const start = layoutElements(boxes(), {
      ids: ["a", "b", "c"],
      algorithm: "align",
      options: { axis: "x", position: "start" },
    });
    expect(byId(start.elements, "a").x).toBe(0);
    expect(byId(start.elements, "b").x).toBe(0);
    expect(byId(start.elements, "c").x).toBe(0);

    const end = layoutElements(boxes(), {
      ids: ["a", "b", "c"],
      algorithm: "align",
      options: { axis: "x", position: "end" },
    });
    expect(byId(end.elements, "a").x).toBe(520);
    expect(byId(end.elements, "b").x).toBe(540);
    expect(byId(end.elements, "c").x).toBe(500);
  });

  it("distribute 让中心等距且首尾不动", () => {
    const result = layoutElements(boxes(), {
      ids: ["a", "b", "c"],
      algorithm: "distribute",
    });
    expect(byId(result.elements, "a").x).toBe(0);
    expect(byId(result.elements, "b").x).toBe(265);
    expect(byId(result.elements, "c").x).toBe(500);
  });

  it("元素数量不足或参数非法时抛错", () => {
    expectSceneError(
      () =>
        layoutElements([rect("a", 0, 0)], {
          ids: ["a"],
          algorithm: "align",
        }),
      "invalid_input",
    );
    expectSceneError(
      () =>
        layoutElements([rect("a", 0, 0), rect("b", 100, 100)], {
          ids: ["a", "b"],
          algorithm: "distribute",
        }),
      "invalid_input",
    );
    expectSceneError(
      () =>
        layoutElements(boxes(), {
          ids: ["a"],
          algorithm: "row",
          options: { gap: -1 },
        }),
      "invalid_input",
    );
  });
});

describe("布局返回与身份", () => {
  it("未选中元素保持原始对象身份，bounds 只统计受影响元素", () => {
    const outside = rect("outside", 1000, 1000);
    const elements = [
      rect("a", 0, 0, 100, 60, 1),
      rect("b", 0, 0, 100, 60, 2),
      outside,
    ];
    const result = layoutElements(elements, {
      ids: ["a", "b"],
      algorithm: "row",
      origin: { x: 0, y: 0 },
    });
    expect(byId(result.elements, "outside")).toBe(outside);
    expect(result.bounds.width).toBeGreaterThan(0);
    expect(result.bounds.x).toBe(124);
  });
});
