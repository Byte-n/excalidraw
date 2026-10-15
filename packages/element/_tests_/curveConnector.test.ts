import { ROUNDNESS } from "@excalidraw/common";
import { pointFrom, type LocalPoint, type Radians } from "@excalidraw/math";
import { RoughGenerator } from "roughjs/bin/generator";

import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";

import {
  getCurveConnectorAxis,
  getCurveConnectorAxisFromBindings,
  getCurveConnectorCollisionPath,
  getCurveConnectorDefaultK,
  getCurveConnectorGeometry,
  getCurveConnectorPath,
  getCurveConnectorRatio,
  isDerivedCurveConnector,
  recomputeCurveConnector,
} from "../src/curveConnector";
import { deconstructLinearOrFreeDrawElement } from "../src/utils";
import { getElementBounds } from "../src/bounds";
import { ShapeCache } from "../src/shape";

import type {
  ElementsMap,
  ExcalidrawArrowElement,
  NonDeleted,
} from "../src/types";

/** 判断点是否在（可能旋转的）图形轮廓上：本体坐标归一后取两轴的最大值 */
const outlineRatio = (
  element: {
    x: number;
    y: number;
    width: number;
    height: number;
    angle: number;
  },
  point: { x: number; y: number },
) => {
  const cos = Math.cos(-element.angle);
  const sin = Math.sin(-element.angle);
  const dx = point.x - (element.x + element.width / 2);
  const dy = point.y - (element.y + element.height / 2);
  return Math.max(
    Math.abs(dx * cos - dy * sin) / (element.width / 2),
    Math.abs(dx * sin + dy * cos) / (element.height / 2),
  );
};

const attachment = (
  center: { x: number; y: number },
  size = { width: 120, height: 80 },
  angle = 0,
) => ({ center, angle: angle as Radians, ...size });

/** 三次贝塞尔求值，用来验证「K 落在曲线 t = 0.5 上」这条恒等式 */
const cubicAt = (
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
) => {
  const u = 1 - t;
  return {
    x:
      u ** 3 * p0.x +
      3 * t * u ** 2 * p1.x +
      3 * t ** 2 * u * p2.x +
      t ** 3 * p3.x,
    y:
      u ** 3 * p0.y +
      3 * t * u ** 2 * p1.y +
      3 * t ** 2 * u * p2.y +
      t ** 3 * p3.y,
  };
};

const createArrow = (overrides: Record<string, unknown> = {}) =>
  API.createElement({
    type: "arrow",
    x: 220,
    y: 140,
    width: 130,
    height: 140,
    points: [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(65, -70),
      pointFrom<LocalPoint>(130, -140),
    ],
    roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
    elbowed: false,
    ...overrides,
  }) as unknown as NonDeleted<ExcalidrawArrowElement>;

/** 源 120×80 @(100,100)、副本 120×80 @(350,-40)，连线 A(220,140) → D(350,0) */
const bindingsOf = (
  startId: string,
  endId: string,
  startFixedPoint: [number, number] = [1, 0.5],
  endFixedPoint: [number, number] = [0, 0.5],
) => ({
  startBinding: {
    elementId: startId,
    mode: "orbit" as const,
    fixedPoint: startFixedPoint,
  },
  endBinding: {
    elementId: endId,
    mode: "orbit" as const,
    fixedPoint: endFixedPoint,
  },
});

const elementMap = (...elements: ReturnType<typeof API.createElement>[]) =>
  new Map(elements.map((element) => [element.id, element])) as ElementsMap;

describe("isDerivedCurveConnector", () => {
  it("accepts a curved arrow with exactly three points", () => {
    expect(isDerivedCurveConnector(createArrow())).toBe(true);
  });

  it("rejects more than three points", () => {
    // 用户自己加过中间点的曲线保持现状
    expect(
      isDerivedCurveConnector(
        createArrow({
          points: [
            pointFrom<LocalPoint>(0, 0),
            pointFrom<LocalPoint>(40, -40),
            pointFrom<LocalPoint>(65, -70),
            pointFrom<LocalPoint>(130, -140),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("rejects a two-point curve (still a straight line)", () => {
    expect(
      isDerivedCurveConnector(
        createArrow({
          points: [
            pointFrom<LocalPoint>(0, 0),
            pointFrom<LocalPoint>(130, -140),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("rejects elbow arrows and sharp arrows", () => {
    expect(isDerivedCurveConnector(createArrow({ elbowed: true }))).toBe(false);
    expect(isDerivedCurveConnector(createArrow({ roundness: null }))).toBe(
      false,
    );
  });
});

describe("getCurveConnectorGeometry", () => {
  const A = { x: 0, y: 0 };
  const D = { x: 200, y: 100 };

  it("keeps both tangents on the axis (horizontal)", () => {
    const { c1, c2, K } = getCurveConnectorGeometry({
      A,
      D,
      axis: "h",
      ratio: 0.5,
    });

    // 控制点与两端同高 → 两端切线水平（箭头方向永远轴对齐）
    expect(c1.y).toBe(A.y);
    expect(c2.y).toBe(D.y);
    expect(c1.x).toBe(c2.x);
    expect(c1.x).toBeCloseTo((A.x + D.x) / 2, 6);
    expect(K).toEqual({ x: 100, y: 50 });
    // t = 0.5 处正是 K（默认比例下转折线落在两端中点）
    expect(cubicAt(A, c1, c2, D, 0.5)).toEqual(K);
  });

  it("is the exact transpose for the vertical axis", () => {
    const { c1, c2, K } = getCurveConnectorGeometry({
      A,
      D,
      axis: "v",
      ratio: 0.5,
    });

    expect(c1.x).toBe(A.x);
    expect(c2.x).toBe(D.x);
    expect(c1.y).toBe(c2.y);
    expect(c1.y).toBeCloseTo((A.y + D.y) / 2, 6);
    expect(K).toEqual({ x: 100, y: 50 });
    expect(cubicAt(A, c1, c2, D, 0.5)).toEqual(K);
  });

  it("keeps the tangents axial for a non-default ratio", () => {
    const { c1, c2, K } = getCurveConnectorGeometry({
      A,
      D,
      axis: "h",
      ratio: 0.25,
    });

    // 恒等式与比例无关：c1 − A 与 D − c2 都平行于轴向
    expect(c1.y).toBe(A.y);
    expect(c2.y).toBe(D.y);
    expect(c1.x).toBeCloseTo(A.x + 0.25 * (D.x - A.x), 6);
    // K 仍是 t = 0.5 的点：(A.x + D.x + 6·turn) / 8，另一轴是两端中点
    expect(K).toEqual({ x: 62.5, y: 50 });
  });

  it("puts K on the curve at t = 0.5 for every ratio", () => {
    // 硬要求：那个手柄必须**贴在曲线上**（不是只在默认比例下贴）
    for (const ratio of [0, 0.2, 0.3, 0.5, 0.7, 1]) {
      for (const axis of ["h", "v"] as const) {
        const { c1, c2, K } = getCurveConnectorGeometry({
          A,
          D,
          axis,
          ratio,
        });
        expect(cubicAt(A, c1, c2, D, 0.5).x).toBeCloseTo(K.x, 6);
        expect(cubicAt(A, c1, c2, D, 0.5).y).toBeCloseTo(K.y, 6);
      }
    }
  });
});

describe("getCurveConnectorRatio", () => {
  const A = { x: 0, y: 0 };
  const D = { x: 200, y: 100 };

  it("inverts the geometry (K ↔ ratio round trip)", () => {
    for (const ratio of [0, 0.25, 0.5, 0.8, 1]) {
      for (const axis of ["h", "v"] as const) {
        const { K } = getCurveConnectorGeometry({ A, D, axis, ratio });
        expect(getCurveConnectorRatio({ A, D, axis, K })).toBeCloseTo(ratio, 6);
      }
    }
  });

  it("clamps to [0, 1] and falls back to the default when the span is 0", () => {
    expect(
      getCurveConnectorRatio({ A, D, axis: "h", K: { x: 400, y: 50 } }),
    ).toBe(1);
    expect(
      getCurveConnectorRatio({ A, D, axis: "h", K: { x: -400, y: 50 } }),
    ).toBe(0);
    expect(
      getCurveConnectorRatio({
        A: { x: 10, y: 0 },
        D: { x: 10, y: 100 },
        axis: "h",
        K: { x: 10, y: 50 },
      }),
    ).toBe(0.5);
  });
});

describe("getCurveConnectorAxis", () => {
  const center = { x: 160, y: 140 };

  it("reads the local edge the attachment point sits on", () => {
    // 右/左边（本地 ±x）→ 绝对水平；上/下边（本地 ±y）→ 绝对竖直
    const A = { x: 220, y: 140 };
    expect(
      getCurveConnectorAxis({
        A,
        D: { x: 350, y: 0 },
        start: attachment(center),
      }),
    ).toBe("h");
    expect(
      getCurveConnectorAxis({
        A: { x: 160, y: 180 },
        D: { x: 370, y: 270 },
        start: attachment(center),
      }),
    ).toBe("v");
    expect(
      getCurveConnectorAxis({
        A: { x: 100, y: 140 },
        D: { x: -100, y: 140 },
        start: attachment(center),
      }),
    ).toBe("h");
    expect(
      getCurveConnectorAxis({
        A: { x: 160, y: 100 },
        D: { x: 160, y: -100 },
        start: attachment(center),
      }),
    ).toBe("v");
  });

  it("judges by the local edge even when the shape is rotated", () => {
    const angle = (Math.PI / 2) as Radians;
    // 本地 +x 边（旋转 90° 后落在世界竖向上）仍判水平：轴向是**绝对**的
    expect(
      getCurveConnectorAxis({
        A: { x: 160, y: 200 },
        D: { x: 260, y: 200 },
        start: attachment(center, { width: 120, height: 80 }, angle),
      }),
    ).toBe("h");
    expect(
      getCurveConnectorAxis({
        A: { x: 100, y: 140 },
        D: { x: 100, y: 240 },
        start: attachment(center, { width: 120, height: 80 }, angle),
      }),
    ).toBe("v");
  });

  it("falls back to the main axis of the two ends when nothing is bound", () => {
    // 自由曲线：同 mindmap 选 routeDirection 的启发式
    expect(
      getCurveConnectorAxis({ A: { x: 0, y: 0 }, D: { x: 200, y: 100 } }),
    ).toBe("h");
    expect(
      getCurveConnectorAxis({ A: { x: 0, y: 0 }, D: { x: 100, y: 300 } }),
    ).toBe("v");
  });

  it("prefers the start attachment, falls back to the end one", () => {
    const start = attachment({ x: 160, y: 140 });
    const end = attachment({ x: 410, y: 0 });
    expect(
      getCurveConnectorAxis({
        A: { x: 220, y: 140 },
        D: { x: 350, y: 0 },
        start,
        end,
      }),
    ).toBe("h");
    // 起点不绑定 → 看 D 的边（D 落在副本下边 → 竖直）
    expect(
      getCurveConnectorAxis({
        A: { x: 220, y: 140 },
        D: { x: 410, y: 40 },
        start: null,
        end,
      }),
    ).toBe("v");
  });
});

describe("getCurveConnectorAxisFromBindings", () => {
  it("derives the axis from the binding's fixed point", () => {
    // fixedPoint 就是附着点的归一化盒坐标（binding.ts 写入时的口径）
    const horizontal = createArrow(bindingsOf("a", "b"));
    expect(getCurveConnectorAxisFromBindings(horizontal)).toBe("h");
    const vertical = createArrow(bindingsOf("a", "b", [0.5, 1], [0.5, 0]));
    expect(getCurveConnectorAxisFromBindings(vertical)).toBe("v");
  });

  it("falls back to the main axis when there is no binding", () => {
    expect(getCurveConnectorAxisFromBindings(createArrow())).toBe("v");
  });
});

describe("getCurveConnectorDefaultK", () => {
  it("is the chord midpoint of the two ends", () => {
    expect(
      getCurveConnectorDefaultK({ x: 220, y: 140 }, { x: 350, y: 0 }),
    ).toEqual({ x: 285, y: 70 });
  });
});

describe("getCurveConnectorPath", () => {
  it("returns null for anything but the three-point curve model", () => {
    expect(getCurveConnectorPath(createArrow({ roundness: null }))).toBeNull();
    expect(getCurveConnectorPath(createArrow({ elbowed: true }))).toBeNull();
    expect(
      getCurveConnectorPath(
        createArrow({
          points: [
            pointFrom<LocalPoint>(0, 0),
            pointFrom<LocalPoint>(130, -140),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("emits one cubic bezier split into short end segments", () => {
    // 水平手柄（起点在源的右边）：切线水平 → 控制点与两端同高
    const element = createArrow(bindingsOf("a", "b"));
    const path = getCurveConnectorPath(element)!;
    expect(path.startsWith("M 0 0")).toBe(true);

    const ops = new RoughGenerator().path(path, {
      roughness: 0,
      disableMultiStroke: true,
    }).sets[0].ops;
    // 每段 C 之前 roughjs 都会补一个 move，所以 ops 是 move/bcurveTo 交替
    expect(ops.map((op) => op.op)).toEqual([
      "move",
      "bcurveTo",
      "move",
      "bcurveTo",
      "move",
      "bcurveTo",
      "move",
      "bcurveTo",
    ]);
    // 首末段短：箭头方向由该段弦决定（getArrowheadPoints 取段内 B(0.7)），
    // 单段时首端会拿整条曲线的点当「近端点」而歪掉
    const firstSegmentEnd = pointFrom<LocalPoint>(
      ops[1].data[4],
      ops[1].data[5],
    );
    const lastSegmentEnd = pointFrom<LocalPoint>(
      ops[7].data[4],
      ops[7].data[5],
    );

    const { A, c1, c2, D } = {
      A: { x: 0, y: 0 },
      c1: { x: 65, y: 0 },
      c2: { x: 65, y: -140 },
      D: { x: 130, y: -140 },
    };
    // 切分点就是 0.02 / 0.5 / 0.98：首段结束在 t = 0.02
    const expectedFirst = cubicAt(A, c1, c2, D, 0.02);
    expect(firstSegmentEnd[0]).toBeCloseTo(expectedFirst.x, 6);
    expect(firstSegmentEnd[1]).toBeCloseTo(expectedFirst.y, 6);
    expect(lastSegmentEnd).toEqual([D.x, D.y]);
    // 两端切线仍在轴上：首段第一个控制点与 A 同高、末段第二个控制点与 D 同高
    // （切分不改变几何，只把同一条曲线切成 4 段）
    expect(ops[1].data[1]).toBeCloseTo(0, 6);
    expect(ops[7].data[3]).toBeCloseTo(-140, 6);
    // **画出来的箭头方向**：首末段的弦已经贴着切线（近水平），这正是首末段要短
    // 的原因——单段时首端会拿整条曲线的 B(0.7) 当「近端点」，箭头会歪 20° 以上
    const firstChordSlope =
      (ops[1].data[5] - ops[0].data[1]) / (ops[1].data[4] - ops[0].data[0]);
    const lastChordSlope =
      (ops[7].data[5] - ops[6].data[1]) / (ops[7].data[4] - ops[6].data[0]);
    expect(Math.abs(firstChordSlope)).toBeLessThan(0.05);
    expect(Math.abs(lastChordSlope)).toBeLessThan(0.05);
  });

  it("splits the collision path by logical segment", () => {
    // 命中/碰撞那处的段数必须与元素的**逻辑段数**一致（3 点 → 2 段）：编辑态的
    // 「段中点」手柄与 isSegmentTooShort 都按段数取，错位后手柄会跑到端点旁边
    const element = createArrow(bindingsOf("a", "b"));
    const [lines, curves] = deconstructLinearOrFreeDrawElement(
      element,
      elementMap(element),
    );
    expect(lines).toHaveLength(0);
    expect(curves).toHaveLength(2);

    // 两种切法是同一条曲线：碰撞路径第二段的起点 = 渲染路径 t = 0.5 处的点
    const collisionPath = getCurveConnectorCollisionPath(element)!;
    const collisionOps = new RoughGenerator().path(collisionPath, {
      roughness: 0,
      disableMultiStroke: true,
    }).sets[0].ops;
    const renderOps = new RoughGenerator().path(
      getCurveConnectorPath(element)!,
      {
        roughness: 0,
        disableMultiStroke: true,
      },
    ).sets[0].ops;
    expect(collisionOps.map((op) => op.op)).toEqual([
      "move",
      "bcurveTo",
      "move",
      "bcurveTo",
    ]);
    // 渲染路径的第二段结束在 t = 0.5：与碰撞路径第二段的起点同一点
    expect(renderOps[3].data.slice(4)).toEqual(collisionOps[2].data);
  });
});

describe("bounds of the three-point curve", () => {
  it("follows the model curve, not the old through-points spline", () => {
    // 这条几何能把两种算法分开：3 点自由曲线 (0,0) → (50,200) → (100,0) 的
    // 主轴是水平，比例 0.5 → 两个控制点都落在 x 轴上 → 模型曲线就是那条直线；
    // 而「穿过三个点」的 roughjs 样条会一直鼓到 y = 200。
    const arrow = createArrow({
      x: 100,
      y: 100,
      width: 100,
      height: 200,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(50, 200),
        pointFrom<LocalPoint>(100, 0),
      ],
    });
    const elementsMap = elementMap(arrow);

    // 冷缓存（bounds.ts 的未缓存回退正是给这种时机准备的）
    ShapeCache.delete(arrow);
    const cold = getElementBounds(arrow, elementsMap);
    // 缓存路径
    ShapeCache.generateElementShape(arrow, null);
    const warm = getElementBounds(arrow, elementsMap);

    expect(cold).toEqual(warm);
    // 包围盒就是那条直线：y 方向不鼓、也不多留高度
    expect(cold[0]).toBeCloseTo(100, 3);
    expect(cold[1]).toBeCloseTo(100, 3);
    expect(cold[2]).toBeCloseTo(200, 3);
    expect(cold[3]).toBeCloseTo(100, 3);
  });
});

describe("recomputeCurveConnector", () => {
  const source = API.createElement({
    type: "rectangle",
    id: "source",
    x: 100,
    y: 100,
    width: 120,
    height: 80,
  });
  const copy = API.createElement({
    type: "rectangle",
    id: "copy",
    x: 350,
    y: -40,
    width: 120,
    height: 80,
  });
  const elementsMap = elementMap(source, copy);

  it("re-solves all three points from the two bindings", () => {
    const arrow = createArrow(bindingsOf(source.id, copy.id));
    const next = recomputeCurveConnector(arrow, elementsMap)!;
    const world = next.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }));

    // 出口贴源的右边中段、入口贴副本的左边中段（都用真实轮廓）
    // （几像素的出入来自 orbit 绑定把端点落到轮廓外一个 binding gap 上）
    expect(Math.abs(outlineRatio(source, world[0]) - 1)).toBeLessThan(0.15);
    expect(Math.abs(outlineRatio(copy, world[2]) - 1)).toBeLessThan(0.15);
    expect(Math.abs(world[0].x - 220)).toBeLessThan(10);
    expect(Math.abs(world[2].x - 350)).toBeLessThan(10);
    // K 落在新让位段（x = 285）的中点，比例仍是默认的 0.5
    expect(world[1].x).toBeCloseTo(285, 3);
    expect(world[1].y).toBeCloseTo((world[0].y + world[2].y) / 2, 3);
  });

  it("keeps a ratio the user dragged", () => {
    // K 拖到比例的 0.3 处（turn = 0.3 × 130 = 39 → K 落在曲线上的
    // x = (0 + 130 + 6 × 39) / 8 = 45.5）：
    // 重算后在新位置仍按 0.3 解（比例由 K 的当前位置反推）
    const arrow = createArrow({
      ...bindingsOf(source.id, copy.id),
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(45.5, -70),
        pointFrom<LocalPoint>(130, -140),
      ],
    });
    const next = recomputeCurveConnector(arrow, elementsMap)!;
    const [A, K, D] = next;
    const axis = "h" as const;
    expect(
      getCurveConnectorRatio({
        A: { x: A[0], y: A[1] },
        D: { x: D[0], y: D[1] },
        axis,
        K: { x: K[0], y: K[1] },
      }),
    ).toBeCloseTo(0.3, 3);
    // K 仍然贴在曲线上：它等于按新两端解出来的 t = 0.5 点，另一轴是两端中点
    expect(K[1]).toBeCloseTo((A[1] + D[1]) / 2, 6);
    const { c1, c2 } = getCurveConnectorGeometry({
      A: { x: A[0], y: A[1] },
      D: { x: D[0], y: D[1] },
      axis,
      ratio: 0.3,
    });
    expect(
      cubicAt({ x: A[0], y: A[1] }, c1, c2, { x: D[0], y: D[1] }, 0.5).x,
    ).toBeCloseTo(K[0], 3);
  });

  it("keeps the vertical axis when the handle is vertical", () => {
    // 上手柄：出口在源的上边中点、入口在副本的下边中点，K 在正中间
    const above = API.createElement({
      type: "rectangle",
      id: "above",
      x: 100,
      y: -180,
      width: 120,
      height: 80,
    });
    const verticalArrow = createArrow({
      ...bindingsOf(source.id, above.id, [0.5, 0], [0.5, 1]),
      x: 160,
      y: 100,
      width: 120,
      height: 240,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(0, -120),
        pointFrom<LocalPoint>(0, -240),
      ],
    });
    const next = recomputeCurveConnector(
      verticalArrow,
      elementMap(source, above),
    )!;
    const [A, K, D] = next;
    // K 落在两端中点上：一条竖着的曲线（转折线是水平线）
    expect((K[1] - A[1]) / (D[1] - A[1])).toBeCloseTo(0.5, 3);
    expect(K[0]).toBeCloseTo((A[0] + D[0]) / 2, 6);
  });

  it("returns null when neither end can be resolved", () => {
    // 绑定指向不存在的元素 → 调用方保持原样
    const arrow = createArrow(bindingsOf("missing-a", "missing-b"));
    expect(recomputeCurveConnector(arrow, elementsMap)).toBeNull();
    expect(recomputeCurveConnector(createArrow(), elementsMap)).toBeNull();
  });

  it("returns null for arrows outside the model", () => {
    const arrow = createArrow({
      ...bindingsOf(source.id, copy.id),
      roundness: null,
    });
    expect(recomputeCurveConnector(arrow, elementsMap)).toBeNull();
  });
});
