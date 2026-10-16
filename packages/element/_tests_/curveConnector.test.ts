import { ROUNDNESS } from "@excalidraw/common";
import {
  pointFrom,
  pointRotateRads,
  type LocalPoint,
  type Radians,
} from "@excalidraw/math";

import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";

import { getElementAbsoluteCoords } from "../src/bounds";
import {
  getCurvedConnectorEndNormal,
  getCurvedConnectorPath,
  traceCurvedConnectorPath,
} from "../src/curveConnector";
import { LinearElementEditor } from "../src/linearElementEditor";
import { isCurvedArrow } from "../src/typeChecks";

import type {
  ElementsMap,
  ExcalidrawArrowElement,
  NonDeleted,
} from "../src/types";

type Point = { x: number; y: number };

/** 解析出来的三次贝塞尔段：`p0 / c1 / c2 / p1` 与 SVG 的一个 `C` 一一对应 */
type CubicSegment = { p0: Point; c1: Point; c2: Point; p1: Point };

type ArrowOverrides = {
  x?: number;
  y?: number;
  angle?: Radians;
  points?: readonly LocalPoint[];
  elbowed?: boolean;
  roundness?: ExcalidrawArrowElement["roundness"];
  startBinding?: ExcalidrawArrowElement["startBinding"];
  endBinding?: ExcalidrawArrowElement["endBinding"];
};

const DEFAULT_POINTS: readonly LocalPoint[] = [
  pointFrom<LocalPoint>(0, 0),
  pointFrom<LocalPoint>(240, -300),
];

const binding = (elementId: string, attachPoint: [number, number]) => ({
  elementId,
  attachPoint,
});

/** 起点挂右边缘、终点挂左边缘：端切线水平且反向 */
const horizontalBindings = () => ({
  startBinding: binding("source", [1, 0.5]),
  endBinding: binding("target", [0, 0.5]),
});

const createArrow = (
  overrides: ArrowOverrides = {},
): NonDeleted<ExcalidrawArrowElement> => {
  const {
    x = 0,
    y = 0,
    angle = 0 as Radians,
    points = DEFAULT_POINTS,
    elbowed = false,
    roundness = { type: ROUNDNESS.PROPORTIONAL_RADIUS },
    startBinding = null,
    endBinding = null,
  } = overrides;
  const element = API.createElement({
    type: "arrow",
    x,
    y,
    width: 240,
    height: 300,
    points,
    elbowed,
    roundness,
    startBinding,
    endBinding,
  });
  return {
    ...element,
    type: "arrow",
    elbowed,
    roundness,
    angle,
  };
};

/**
 * 占位绑定：`attachPoint` 在类型上不可为空（`ElementBinding` 只有 `elementId` 与
 * `attachPoint` 两项），但「绑定已建立、附着点尚未解出」的中间态在运行时就是
 * null。用 defineProperty 注入这个状态，而不是用类型断言把类型系统的洞遮住。
 */
const injectPlaceholderBinding = (
  element: NonDeleted<ExcalidrawArrowElement>,
  end: "start" | "end",
) => {
  Object.defineProperty(
    element,
    end === "start" ? "startBinding" : "endBinding",
    {
      value: { elementId: "placeholder", attachPoint: null },
      configurable: true,
      writable: true,
    },
  );
};

/** 路径里的数字（`M x y` + 每段 `C x y, x y, x y`），逐个转成段 */
const parsePath = (path: string): CubicSegment[] => {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const segments: CubicSegment[] = [];
  let cursor = 2;
  let current: Point = { x: numbers[0], y: numbers[1] };
  while (cursor + 6 <= numbers.length) {
    const c1 = { x: numbers[cursor], y: numbers[cursor + 1] };
    const c2 = { x: numbers[cursor + 2], y: numbers[cursor + 3] };
    const p1 = { x: numbers[cursor + 4], y: numbers[cursor + 5] };
    segments.push({ p0: current, c1, c2, p1 });
    current = p1;
    cursor += 6;
  }
  return segments;
};

const cubicAt = ({ p0, c1, c2, p1 }: CubicSegment, t: number): Point => {
  const u = 1 - t;
  return {
    x:
      u ** 3 * p0.x +
      3 * t * u ** 2 * c1.x +
      3 * t ** 2 * u * c2.x +
      t ** 3 * p1.x,
    y:
      u ** 3 * p0.y +
      3 * t * u ** 2 * c1.y +
      3 * t ** 2 * u * c2.y +
      t ** 3 * p1.y,
  };
};

const segmentCount = (path: string) => parsePath(path).length;

/** 采样整条曲线，返回相对弦的有向距离的极值（正负号即弦的两侧） */
const chordDeviationRange = (
  segments: CubicSegment[],
  A: Point,
  D: Point,
  samples = 40,
) => {
  const length = Math.hypot(D.x - A.x, D.y - A.y);
  const ux = (D.x - A.x) / length;
  const uy = (D.y - A.y) / length;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    for (let step = 0; step <= samples; step++) {
      const point = cubicAt(segment, step / samples);
      const signed = ux * (point.y - A.y) - uy * (point.x - A.x);
      min = Math.min(min, signed);
      max = Math.max(max, signed);
    }
  }
  return { min, max, length };
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

describe("the curve model's predicate", () => {
  it("is roundness + non-elbow, and never the point count", () => {
    // 全局唯一判据：一个圆角非折线箭头就是曲线，不论它是哪个入口建的、有几个点
    const twoPoint = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(240, -300)],
    });
    const threePoint = createArrow({
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(120, -150),
        pointFrom<LocalPoint>(240, -300),
      ],
    });
    expect(isCurvedArrow(twoPoint)).toBe(true);
    expect(isCurvedArrow(threePoint)).toBe(true);
    expect(getCurvedConnectorPath(twoPoint)).not.toBeNull();
    expect(getCurvedConnectorPath(threePoint)).not.toBeNull();

    // 折线箭头与直箭头不走这条曲线
    expect(isCurvedArrow(createArrow({ elbowed: true }))).toBe(false);
    expect(isCurvedArrow(createArrow({ roundness: null }))).toBe(false);
  });

  it("rejects undefined and non-arrow elements", () => {
    expect(isCurvedArrow(undefined)).toBe(false);
    expect(isCurvedArrow(API.createElement({ type: "rectangle" }))).toBe(false);
  });

  it("returns null from the path builder for everything else", () => {
    expect(getCurvedConnectorPath(createArrow({ roundness: null }))).toBeNull();
    expect(getCurvedConnectorPath(createArrow({ elbowed: true }))).toBeNull();
    expect(
      getCurvedConnectorPath(API.createElement({ type: "rectangle" })),
    ).toBeNull();
    // `line` 元素自带圆角也不走这条曲线（判据要求是箭头）
    expect(
      getCurvedConnectorPath(
        API.createElement({
          type: "line",
          points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
        }),
      ),
    ).toBeNull();
  });
});

describe("getCurvedConnectorEndNormal", () => {
  it("reads the outer normal of the edge each end is bound to", () => {
    const arrow = createArrow(horizontalBindings());
    expect(getCurvedConnectorEndNormal(arrow, "start")).toEqual({ x: 1, y: 0 });
    expect(getCurvedConnectorEndNormal(arrow, "end")).toEqual({ x: -1, y: 0 });
  });

  it("lets each end keep its own axis", () => {
    // 起点在右边缘（+x）、终点在上边缘（−y）：旧模型办不到，两端切线各管各的
    const arrow = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, -140)],
      startBinding: binding("source", [1, 0.5]),
      endBinding: binding("target", [0.5, 0]),
    });
    expect(getCurvedConnectorEndNormal(arrow, "start")).toEqual({ x: 1, y: 0 });
    expect(getCurvedConnectorEndNormal(arrow, "end")).toEqual({ x: 0, y: -1 });
  });

  it("falls back to the chord main axis for corners and point targets", () => {
    const corner = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 100)],
      startBinding: binding("source", [0, 0]),
      endBinding: binding("target", [1, 1]),
    });
    expect(getCurvedConnectorEndNormal(corner, "start")).toEqual({
      x: 1,
      y: 0,
    });
    expect(getCurvedConnectorEndNormal(corner, "end")).toEqual({ x: -1, y: 0 });

    const pointTarget = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 100)],
      startBinding: binding("source", [0.5, 0.5]),
      endBinding: binding("target", [0.5, 0.5]),
    });
    expect(getCurvedConnectorEndNormal(pointTarget, "start")).toEqual({
      x: 1,
      y: 0,
    });
    expect(getCurvedConnectorEndNormal(pointTarget, "end")).toEqual({
      x: -1,
      y: 0,
    });
  });

  it("falls back when the binding carries no fixed point", () => {
    const arrow = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 100)],
    });
    injectPlaceholderBinding(arrow, "start");
    injectPlaceholderBinding(arrow, "end");
    expect(getCurvedConnectorEndNormal(arrow, "start")).toEqual({ x: 1, y: 0 });
    expect(getCurvedConnectorEndNormal(arrow, "end")).toEqual({ x: -1, y: 0 });
    expect(getCurvedConnectorPath(arrow)).toBe(
      "M 0 0 C 74.54 0, 125.46 100, 200 100",
    );
  });

  it("takes the chord main axis for a free two-point arrow", () => {
    // 情况 2：没有控制点，弦就是拖拽方向 —— 两端切线取它的主轴
    const shallow = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 100)],
    });
    expect(getCurvedConnectorEndNormal(shallow, "start")).toEqual({
      x: 1,
      y: 0,
    });
    expect(getCurvedConnectorEndNormal(shallow, "end")).toEqual({
      x: -1,
      y: 0,
    });

    const steep = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 300)],
    });
    expect(getCurvedConnectorEndNormal(steep, "start")).toEqual({ x: 0, y: 1 });
    expect(getCurvedConnectorEndNormal(steep, "end")).toEqual({ x: 0, y: -1 });
  });

  it("takes the adjacent segment for a free multi-point arrow", () => {
    // 情况 3：有控制点就按控制点走。L 形（先向右再向下）的末端走向是竖直的，
    // 若按弦主轴回落会取成水平，末端箭头会歪 45°
    const elbowish = createArrow({
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(100, 0),
        pointFrom<LocalPoint>(100, 100),
      ],
    });
    expect(getCurvedConnectorEndNormal(elbowish, "start")).toEqual({
      x: 1,
      y: 0,
    });
    expect(getCurvedConnectorEndNormal(elbowish, "end")).toEqual({
      x: 0,
      y: -1,
    });

    // 斜向的相邻段按真实方向回落，不做主轴量化
    const diagonal = createArrow({
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(100, 0),
        pointFrom<LocalPoint>(200, 100),
      ],
    });
    const end = getCurvedConnectorEndNormal(diagonal, "end");
    expect(end.x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(end.y).toBeCloseTo(-Math.SQRT1_2, 6);
  });
});

describe("automatic curve (two points, no control points)", () => {
  it("emits a single cubic with both tangents on the edge normals", () => {
    const arrow = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 40)],
      ...horizontalBindings(),
    });
    const path = getCurvedConnectorPath(arrow)!;
    expect(path).toBe("M 0 0 C 67.99 0, 132.01 40, 200 40");
    expect(segmentCount(path)).toBe(1);

    const [segment] = parsePath(path);
    const length = distance(segment.p0, segment.p1);
    // 每段一个 C：控制点是 A + (|D−A|/3)·t̂_A 与 D + (|D−A|/3)·t̂_D
    expect(segment.c1.x).toBeCloseTo(segment.p0.x + length / 3, 2);
    expect(segment.c1.y).toBeCloseTo(segment.p0.y, 6);
    expect(segment.c2.x).toBeCloseTo(segment.p1.x - length / 3, 2);
    expect(segment.c2.y).toBeCloseTo(segment.p1.y, 6);
    // 两端切线水平
    expect(segment.c1.y).toBe(segment.p0.y);
    expect(segment.c2.y).toBe(segment.p1.y);
  });

  it("produces an S shape when the two ends are offset", () => {
    const arrow = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(240, -300)],
      ...horizontalBindings(),
    });
    const path = getCurvedConnectorPath(arrow)!;
    expect(segmentCount(path)).toBe(1);

    const segments = parsePath(path);
    const A = segments[0].p0;
    const D = segments[0].p1;

    // 曲线中点在弦中点的邻域（对称配置下恰好重合）
    const midpoint = cubicAt(segments[0], 0.5);
    expect(midpoint.x).toBeCloseTo((A.x + D.x) / 2, 2);
    expect(midpoint.y).toBeCloseTo((A.y + D.y) / 2, 2);

    // 但整条曲线明显鼓出弦外，且两侧都鼓（S 形）
    const { min, max, length } = chordDeviationRange(segments, A, D);
    expect(Math.max(-min, max)).toBeGreaterThan(0.05 * length);
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(0);
  });

  it("degenerates to a straight line when the ends are aligned", () => {
    const arrow = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
      ...horizontalBindings(),
    });
    const path = getCurvedConnectorPath(arrow)!;
    expect(path).toBe("M 0 0 C 66.67 0, 133.33 0, 200 0");

    const [segment] = parsePath(path);
    // 控制点共线 ⇒ 曲线就是那条直线
    expect(segment.c1.y).toBe(0);
    expect(segment.c2.y).toBe(0);
    expect(cubicAt(segment, 0.5)).toEqual({ x: 100, y: 0 });
    const { min, max } = chordDeviationRange([segment], segment.p0, segment.p1);
    expect(Math.max(-min, max)).toBe(0);
  });
});

describe("default bow (free two-point arrow, no attached edge)", () => {
  it("bows when the chord is neither horizontal nor vertical", () => {
    const arrow = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 100)],
    });
    const segments = parsePath(getCurvedConnectorPath(arrow)!);
    const A = segments[0].p0;
    const D = segments[0].p1;

    // 两端切线都水平 ⇒ 起点手柄水平引出、终点手柄水平引入（尖端正水平）
    expect(segments[0].c1.y).toBe(A.y);
    expect(segments[0].c2.y).toBe(D.y);
    // 于是整条曲线鼓出弦外，且两侧都鼓（S 形）
    const { min, max, length } = chordDeviationRange(segments, A, D);
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(0);
    expect(Math.max(-min, max)).toBeGreaterThan(0.02 * length);
  });

  it("stays a straight line when the chord is exactly horizontal or vertical", () => {
    for (const D of [
      pointFrom<LocalPoint>(200, 0),
      pointFrom<LocalPoint>(0, 200),
      pointFrom<LocalPoint>(-200, 0),
      pointFrom<LocalPoint>(0, -200),
    ]) {
      const arrow = createArrow({
        points: [pointFrom<LocalPoint>(0, 0), D],
      });
      const segments = parsePath(getCurvedConnectorPath(arrow)!);
      const { min, max } = chordDeviationRange(
        segments,
        segments[0].p0,
        segments[0].p1,
      );
      expect(Math.max(-min, max)).toBe(0);
    }
  });

  it("gives a multi-point arrow vertical arrival when its last segment is vertical", () => {
    // 先向右再向下的 L 形：末端手柄必须在终点正上方（走向竖直），
    // 若按弦主轴回落则会变成水平，尖端会歪 45°
    const arrow = createArrow({
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(100, 0),
        pointFrom<LocalPoint>(100, 100),
      ],
    });
    const segments = parsePath(getCurvedConnectorPath(arrow)!);
    const last = segments[segments.length - 1];
    expect(last.c2.x).toBe(last.p1.x);
    expect(last.c2.y).toBeLessThan(last.p1.y);
  });

  it("keeps the seam smooth when the polyline closes back on its start", () => {
    // 闭合回路：首尾点重合，弦长 0。端切线必须取相邻段（竖直），
    // 老的主轴兜底会在这里取到 ±x，接缝处冒出一个折角
    const arrow = createArrow({
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(100, 0),
        pointFrom<LocalPoint>(100, 100),
        pointFrom<LocalPoint>(0, 100),
        pointFrom<LocalPoint>(0, 0),
      ],
    });
    const segments = parsePath(getCurvedConnectorPath(arrow)!);
    expect(segments.length).toBe(4);
    const last = segments[segments.length - 1];
    expect(last.c2.x).toBe(last.p1.x);
    expect(last.c2.y).toBeCloseTo(last.p1.y + 100 / 3, 2);
    for (const segment of segments) {
      for (const value of [
        segment.c1.x,
        segment.c1.y,
        segment.c2.x,
        segment.c2.y,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("keeps the default bow out of `line` elements", () => {
    const line = API.createElement({
      type: "line",
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 100)],
    });
    expect(getCurvedConnectorPath(line)).toBeNull();
  });
});

describe("manual curve (control points in points[])", () => {
  it("draws one cubic per segment and passes through every control point", () => {
    const control = pointFrom<LocalPoint>(120, -400);
    const arrow = createArrow({
      points: [
        pointFrom<LocalPoint>(0, 0),
        control,
        pointFrom<LocalPoint>(240, 0),
      ],
      ...horizontalBindings(),
    });
    const path = getCurvedConnectorPath(arrow)!;
    // 3 点 → 2 段
    expect(segmentCount(path)).toBe(2);

    const segments = parsePath(path);
    expect(segments[0].p0).toEqual({ x: 0, y: 0 });
    expect(segments[0].p1).toEqual({ x: control[0], y: control[1] });
    expect(segments[1].p0).toEqual({ x: control[0], y: control[1] });
    expect(segments[1].p1).toEqual({ x: 240, y: 0 });
    // 控制点被拖到离弦很远（弦在 y = 0）仍然成立
    expect(path).toContain("120 -400");
  });

  it("keeps segment count == points.length - 1 for four points", () => {
    const arrow = createArrow({
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(60, -120),
        pointFrom<LocalPoint>(120, 200),
        pointFrom<LocalPoint>(240, 0),
      ],
      ...horizontalBindings(),
    });
    const path = getCurvedConnectorPath(arrow)!;
    expect(segmentCount(path)).toBe(3);

    const segments = parsePath(path);
    expect(segments.map((segment) => segment.p1)).toEqual([
      { x: 60, y: -120 },
      { x: 120, y: 200 },
      { x: 240, y: 0 },
    ]);
  });

  it("stays valid when a control point coincides with an end", () => {
    for (const points of [
      [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(240, 0),
      ],
      [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(240, 0),
        pointFrom<LocalPoint>(240, 0),
      ],
    ]) {
      const arrow = createArrow({
        points,
        ...horizontalBindings(),
      });
      const path = getCurvedConnectorPath(arrow)!;
      expect(segmentCount(path)).toBe(2);
      for (const segment of parsePath(path)) {
        for (const value of [
          segment.c1.x,
          segment.c1.y,
          segment.c2.x,
          segment.c2.y,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });
});

/** 记录 canvas 调用的最小假 context；只实现描边路径需要的成员 */
type TraceCall =
  | { type: "beginPath" }
  | { type: "moveTo"; point: Point }
  | { type: "lineTo"; point: Point }
  | { type: "bezierCurveTo"; c1: Point; c2: Point; to: Point }
  | { type: "stroke" };

const createTraceRecorder = () => {
  const calls: TraceCall[] = [];
  const context = {
    beginPath: () => calls.push({ type: "beginPath" }),
    moveTo: (x: number, y: number) =>
      calls.push({ type: "moveTo", point: { x, y } }),
    lineTo: (x: number, y: number) =>
      calls.push({ type: "lineTo", point: { x, y } }),
    bezierCurveTo: (
      c1x: number,
      c1y: number,
      c2x: number,
      c2y: number,
      toX: number,
      toY: number,
    ) =>
      calls.push({
        type: "bezierCurveTo",
        c1: { x: c1x, y: c1y },
        c2: { x: c2x, y: c2y },
        to: { x: toX, y: toY },
      }),
    stroke: () => calls.push({ type: "stroke" }),
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
};

const elementsMapOf = (element: NonDeleted<ExcalidrawArrowElement>) =>
  new Map([[element.id, element]]) as ElementsMap;

/** 把 `moveTo` / `bezierCurveTo` 调用还原成三次贝塞尔段 */
const tracedSegments = (calls: TraceCall[]): CubicSegment[] => {
  const segments: CubicSegment[] = [];
  let current: Point | null = null;
  for (const call of calls) {
    if (call.type === "moveTo") {
      current = call.point;
    } else if (call.type === "bezierCurveTo" && current) {
      segments.push({ p0: current, c1: call.c1, c2: call.c2, p1: call.to });
      current = call.to;
    }
  }
  return segments;
};

describe("traceCurvedConnectorPath", () => {
  it("traces the curve, not the chord, for an automatic two-point connector", () => {
    const arrow = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(240, -300)],
      ...horizontalBindings(),
    });
    const { context, calls } = createTraceRecorder();
    traceCurvedConnectorPath(context, arrow, elementsMapOf(arrow));

    // 恰好一次 beginPath + moveTo + 一个 bezierCurveTo；旧行为是折线（会多出
    // lineTo 且没有贝塞尔），这正是缺陷的判据
    expect(calls.map((call) => call.type)).toEqual([
      "beginPath",
      "moveTo",
      "bezierCurveTo",
    ]);
    expect(calls.some((call) => call.type === "lineTo")).toBe(false);

    const segments = tracedSegments(calls);
    const A = segments[0].p0;
    const D = segments[segments.length - 1].p1;
    const { min, max, length } = chordDeviationRange(segments, A, D);
    // 曲线明显鼓出弦外；若描的是弦，极值必为 0
    expect(Math.max(-min, max)).toBeGreaterThan(0.05 * length);
  });

  it("offsets the midpoint from the chord when the end normals differ", () => {
    // 起点右边缘（+x）、终点上边缘（−y）：S 形不再关于弦中点对称，于是可以用
    // 最直白的「中点离轴量」把弦与曲线分开
    const arrow = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(240, -300)],
      startBinding: binding("source", [1, 0.5]),
      endBinding: binding("target", [0.5, 0]),
    });
    const { context, calls } = createTraceRecorder();
    traceCurvedConnectorPath(context, arrow, elementsMapOf(arrow));

    const [segment] = tracedSegments(calls);
    const mid = cubicAt(segment, 0.5);
    const chordMid = {
      x: (segment.p0.x + segment.p1.x) / 2,
      y: (segment.p0.y + segment.p1.y) / 2,
    };
    expect(distance(mid, chordMid)).toBeGreaterThan(1);
  });

  it("maps local points to scene coords exactly like getPointsGlobalCoordinates", () => {
    const map = (element: NonDeleted<ExcalidrawArrowElement>) =>
      elementsMapOf(element);

    // angle = 0：描出的点就是元素原点 + 局部路径点
    const flat = createArrow({
      x: 40,
      y: -25,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 40)],
      ...horizontalBindings(),
    });
    const flatTrace = createTraceRecorder();
    traceCurvedConnectorPath(flatTrace.context, flat, map(flat));
    const flatSegments = tracedSegments(flatTrace.calls);
    expect(flatSegments[0].p0).toEqual({ x: flat.x + 0, y: flat.y + 0 });
    expect(flatSegments[0].p1).toEqual({
      x: flat.x + flat.points[1][0],
      y: flat.y + flat.points[1][1],
    });

    // angle ≠ 0：曲线必过端点，所以两端点与 getPointsGlobalCoordinates 首尾相等
    const angle = (Math.PI / 6) as Radians;
    const rotated = createArrow({
      x: 40,
      y: -25,
      angle,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 40)],
      ...horizontalBindings(),
    });
    const rotatedTrace = createTraceRecorder();
    traceCurvedConnectorPath(rotatedTrace.context, rotated, map(rotated));
    const rotatedSegments = tracedSegments(rotatedTrace.calls);
    const global = LinearElementEditor.getPointsGlobalCoordinates(
      rotated,
      map(rotated),
    );
    expect(rotatedSegments[0].p0.x).toBeCloseTo(global[0][0], 6);
    expect(rotatedSegments[0].p0.y).toBeCloseTo(global[0][1], 6);
    expect(rotatedSegments[0].p1.x).toBeCloseTo(
      global[global.length - 1][0],
      6,
    );
    expect(rotatedSegments[0].p1.y).toBeCloseTo(
      global[global.length - 1][1],
      6,
    );

    // 旋转中心必须是绝对坐标中心：绕原点旋转会得到明显不同的点
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(rotated, map(rotated));
    const aboutCenter = pointRotateRads(
      pointFrom<LocalPoint>(
        rotated.x + rotated.points[0][0],
        rotated.y + rotated.points[0][1],
      ),
      pointFrom<LocalPoint>((x1 + x2) / 2, (y1 + y2) / 2),
      rotated.angle,
    );
    const aboutOrigin = pointRotateRads(
      pointFrom<LocalPoint>(
        rotated.x + rotated.points[0][0],
        rotated.y + rotated.points[0][1],
      ),
      pointFrom<LocalPoint>(0, 0),
      rotated.angle,
    );
    expect(rotatedSegments[0].p0.x).toBeCloseTo(aboutCenter[0], 6);
    expect(rotatedSegments[0].p0.y).toBeCloseTo(aboutCenter[1], 6);
    expect(
      distance(rotatedSegments[0].p0, {
        x: aboutOrigin[0],
        y: aboutOrigin[1],
      }),
    ).toBeGreaterThan(1);
  });

  it("touches nothing for elements that are not round arrows", () => {
    const others = [
      // 直箭头（roundness 为 null）
      createArrow({ roundness: null }),
      // 普通直线
      API.createElement({
        type: "line",
        x: 0,
        y: 0,
        width: 200,
        height: 0,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
      }),
      // elbow 箭头
      createArrow({ elbowed: true }),
    ];
    for (const element of others) {
      const { context, calls } = createTraceRecorder();
      const map = new Map([[element.id, element]]) as ElementsMap;
      traceCurvedConnectorPath(context, element, map);
      expect(calls).toEqual([]);
    }
  });

  it("keeps getCurvedConnectorPath byte-identical after the geometry extraction", () => {
    // 守卫抽取几何时的重构：同一组 fixture 下路径串不得变
    const manual = createArrow({
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(120, -400),
        pointFrom<LocalPoint>(240, 0),
      ],
      ...horizontalBindings(),
    });
    expect(getCurvedConnectorPath(manual)).toBe(
      "M 0 0 C 139.2 0, 80 -400, 120 -400 C 160 -400, 100.8 0, 240 0",
    );

    const automatic = createArrow({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 40)],
      ...horizontalBindings(),
    });
    expect(getCurvedConnectorPath(automatic)).toBe(
      "M 0 0 C 67.99 0, 132.01 40, 200 40",
    );
  });
});
