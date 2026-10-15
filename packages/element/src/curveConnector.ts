import {
  clamp,
  pointFrom,
  pointRotateRads,
  type LocalPoint,
  type Radians,
} from "@excalidraw/math";

import { updateBoundPoint } from "./binding";
import { LinearElementEditor } from "./linearElementEditor";
import { isBindableElement, isCurvedArrow } from "./typeChecks";

import type {
  ElementsMap,
  ExcalidrawArrowElement,
  ExcalidrawElement,
  NonDeleted,
} from "./types";

/**
 * 曲线连接线（3 点模型）。
 *
 * 曲线样式的连接线（方向手柄生成的、以及用箭头工具画出来的）只存 **3 个点**
 * `[A, K, D]`：两端附着点 + 一个中间点。控制点、转折线都由两端推出来，所以
 * 中间点只承担**一个自由度**（转折线在轴上的位置），两端切线因此严格轴对齐
 * ——箭头方向永远水平/竖直，拖动图形时整条曲线重算。
 *
 * 判据不看任何标记字段：元素自己就是判据（曲线样式 + 正好 3 个点）。这样用户
 * 手画的曲线与手柄生成的那条走同一条路，也不需要在元素上多存一个「轴向」。
 */

/** 轴向：`h` = 两端切线水平（转折线是竖直线），`v` = 竖直 */
export type CurveConnectorAxis = "h" | "v";

export type CurveConnectorPoint = { x: number; y: number };

/**
 * 附着端所在图形的几何。判断「附着点落在哪条边」只需要这几项，
 * 与 `quickCreate.ts` 的 `QuickCreateSourceGeometry` 同一口径。
 */
export type CurveConnectorAttachment = {
  center: CurveConnectorPoint;
  angle: Radians;
  width: number;
  height: number;
};

/** 默认转折比例：转折线落在两端正中间 */
export const CURVE_CONNECTOR_DEFAULT_RATIO = 0.5;

/** 轴上跨度为 0（两端在该轴上重合）时无从反推比例，退回默认值 */
const MIN_AXIS_SPAN = 1e-6;

/**
 * 三次贝塞尔的**切分点**（t 值）。注意这不是「采样」：切分只把同一条曲线拆成
 * 4 段，几何逐点相同（子区间控制点由端点与导数给出，就是 de Casteljau）。
 *
 * 为什么要切：**画出来的箭头方向**由形状 ops 的首末段弦决定（`bounds.ts` 的
 * `getArrowheadPoints` 取该段上 B(0.7) 与端点的连线），单段 C 时首末段就是整条
 * 曲线，箭头会歪出去几十度。首末段取 2% 这种小短段，弦方向就被钉在该端的切线
 * 上（误差 ≈ 该段内切线转角的一半，实测 < 3°），于是「两端切线轴对齐 → 箭头
 * 永远水平/竖直」在箭头本身上也成立；中间那段的大跨度只是多几个 ops，几何不变。
 */
const CUBIC_SPLIT_KNOTS = [0.02, 0.5, 0.98] as const;

/**
 * 命中 / 碰撞路径的切分点：只按**逻辑段**切（3 点 → 2 段）。
 *
 * `deconstructLinearOrFreeDrawElement` 把每个 `bcurveTo` 当成一段，而编辑态的
 * 「段中点」手柄（`LinearElementEditor.getEditorMidPoints` / `isSegmentTooShort`）
 * 按元素自己的点数取段：段数必须等于逻辑段数（2），否则手柄会与真实段错位——渲染
 * 用的首末 2% 短段在那套机制里会被当成两个独立段，中点手柄就跑到端点旁边去了。
 * 同一条曲线、两种切法，几何完全一致。
 */
const CUBIC_COLLISION_KNOTS = [0.5] as const;

/**
 * 曲线连接线判据：**元素自己就是判据**，不打标记字段。
 *
 * `isCurvedArrow`（arrow + 非折线 + roundness 非空）且**正好 3 个点**。
 * 其它一律不算：≥4 点的曲线（用户手加过中间点）、2 点的曲线（直线）、折线
 * 箭头、直箭头都保持原有行为。
 */
export const isDerivedCurveConnector = <T extends ExcalidrawElement>(
  element?: T | null,
): element is T & ExcalidrawArrowElement =>
  !!element && isCurvedArrow(element) && element.points.length === 3;

/** 归一化盒坐标（0..1，与 `binding.fixedPoint` 同口径）；图形在该轴没有厚度时取正中 */
const toNormal = (
  point: CurveConnectorPoint,
  attachment: CurveConnectorAttachment,
): CurveConnectorPoint => {
  const [localX, localY] = pointRotateRads(
    pointFrom(point.x, point.y),
    pointFrom(attachment.center.x, attachment.center.y),
    -attachment.angle as Radians,
  );
  const offsetX = localX - attachment.center.x;
  const offsetY = localY - attachment.center.y;
  return {
    x:
      attachment.width > 0
        ? 0.5 + offsetX / attachment.width
        : CURVE_CONNECTOR_DEFAULT_RATIO,
    y:
      attachment.height > 0
        ? 0.5 + offsetY / attachment.height
        : CURVE_CONNECTOR_DEFAULT_RATIO,
  };
};

/**
 * 附着点在本体坐标里落在哪条边上 → 绝对轴向：本地 ±x 边（|x|/半宽 更大）
 * → 水平，本地 ±y 边 → 竖直。归一化之后就是比较 |fx − 0.5| 与 |fy − 0.5|
 * （本体分量 = 2·(fx − 0.5)·半尺），所以这里对**归一化坐标**做判断，附着点
 * 与 `binding.fixedPoint` 两种来源共用同一个口径。正好打平时按水平。
 */
const axisFromNormal = (normal: CurveConnectorPoint): CurveConnectorAxis =>
  Math.abs(normal.x - CURVE_CONNECTOR_DEFAULT_RATIO) >=
  Math.abs(normal.y - CURVE_CONNECTOR_DEFAULT_RATIO)
    ? "h"
    : "v";

/** 两端连线的**主轴**（自由曲线用，同 mindmap 选 routeDirection 的启发式） */
const axisFromEndpoints = (
  A: CurveConnectorPoint,
  D: CurveConnectorPoint,
): CurveConnectorAxis =>
  Math.abs(D.x - A.x) >= Math.abs(D.y - A.y) ? "h" : "v";

/**
 * 轴向：起点 A 落在某个图形的本地边上时按那条边定；起点不绑定而终点绑定时
 * 看 D 的边（同一套判断）；两端都不绑定（自由曲线）取两端连线的主轴。
 *
 * A、D 与附着图形必须在**同一个坐标系**里（调用方给场景坐标）。
 */
export const getCurveConnectorAxis = ({
  A,
  D,
  start,
  end,
}: {
  A: CurveConnectorPoint;
  D: CurveConnectorPoint;
  /** 起点 A 所附着的图形；不绑定时为 null/undefined */
  start?: CurveConnectorAttachment | null;
  /** 终点 D 所附着的图形；不绑定时为 null/undefined */
  end?: CurveConnectorAttachment | null;
}): CurveConnectorAxis => {
  if (start) {
    return axisFromNormal(toNormal(A, start));
  }
  if (end) {
    return axisFromNormal(toNormal(D, end));
  }
  return axisFromEndpoints(A, D);
};

/**
 * 附着点的归一化盒坐标，口径与 `binding.fixedPoint` 完全一致
 * （见 binding.ts 的 `calculateFixedPointForNonElbowArrowBinding`：把点按
 * `R(−angle)·(点 − 中心)` 折进本体、再除以宽高）。
 */
export const getCurveConnectorAttachmentFixedPoint = (
  point: CurveConnectorPoint,
  attachment: CurveConnectorAttachment,
) => {
  const normal = toNormal(point, attachment);
  return [normal.x, normal.y] as [number, number];
};

/**
 * 渲染路径专用：`shape.ts` 的两个形状函数拿不到 `elementsMap`，只能读元素
 * 自带的绑定。`binding.fixedPoint` **就是**附着点的归一化盒坐标（绑定建立时
 * 由端点算出来的），与「用 A 做本体归一」是同一个判断，所以渲染与重算解出的
 * 轴向一致。两端都没绑定时同样退回主轴。
 */
export const getCurveConnectorAxisFromBindings = (
  element: ExcalidrawArrowElement,
): CurveConnectorAxis => {
  const binding = element.startBinding ?? element.endBinding;
  if (binding) {
    const [fx, fy] = binding.fixedPoint;
    return axisFromNormal({ x: fx, y: fy });
  }
  const [A, , D] = element.points;
  return axisFromEndpoints({ x: A[0], y: A[1] }, { x: D[0], y: D[1] });
};

/**
 * 由两端 + 轴向 + 比例解出转折线与两个控制点。
 *
 * 设 `turn = A 轴 + ratio × (D 轴 − A 轴)`（转折线在该轴上的位置），则
 * - `c1 = {turn, A.y}` / `c2 = {turn, D.y}`（水平，竖直时整体转置）
 * - `K = B(0.5) = ((A + 3c1 + 3c2 + D) / 8)`：两个控制点与两端都落在
 *   `{turn × 该轴}` 这条线上，所以轴上的分量只剩转弯那一项
 *   —— 水平时 `K = {(A.x + D.x + 6·turn) / 8, (A.y + D.y) / 2}`。
 *
 * 恒等式（都写进测试）：
 * 1. `c1 − A` 与 `D − c2` 都平行于轴向 → 两端切线永远轴对齐，箭头方向永远
 *    水平/竖直。
 * 2. K **恒等于**曲线 t = 0.5 的点——它就是用户拖的那个手柄，必须贴在曲线上
 *    （不是只在默认比例下贴）。所以比例要由 K 反推（见 getCurveConnectorRatio），
 *    而不是反过来解 K。
 */
export const getCurveConnectorGeometry = ({
  A,
  D,
  axis,
  ratio,
}: {
  A: CurveConnectorPoint;
  D: CurveConnectorPoint;
  axis: CurveConnectorAxis;
  ratio: number;
}): {
  c1: CurveConnectorPoint;
  c2: CurveConnectorPoint;
  K: CurveConnectorPoint;
} => {
  const turn =
    axis === "h" ? A.x + ratio * (D.x - A.x) : A.y + ratio * (D.y - A.y);
  return axis === "h"
    ? {
        c1: { x: turn, y: A.y },
        c2: { x: turn, y: D.y },
        K: { x: (A.x + D.x + 6 * turn) / 8, y: (A.y + D.y) / 2 },
      }
    : {
        c1: { x: A.x, y: turn },
        c2: { x: D.x, y: turn },
        K: { x: (A.x + D.x) / 2, y: (A.y + D.y + 6 * turn) / 8 },
      };
};

/**
 * 由 K 的当前位置**反推**转折比例。因为存的 K 是曲线 t = 0.5 的点，先把转折线
 * 还原出来（`B(0.5)` 的轴上分量 = `(A 轴 + D 轴 + 6·turn) / 8`，解出
 * `turn = (8·K 轴 − A 轴 − D 轴) / 6`），再取它相对两端的比例。
 *
 * 不额外存字段——用户拖 K 就是在改这个比例；拖 δ 会让转折线移动 4/3·δ（线性、
 * 稳定）。跨度为零时退回默认值，比例仍 clamp 到 [0, 1]。
 */
export const getCurveConnectorRatio = ({
  A,
  D,
  axis,
  K,
}: {
  A: CurveConnectorPoint;
  D: CurveConnectorPoint;
  axis: CurveConnectorAxis;
  K: CurveConnectorPoint;
}): number => {
  const span = axis === "h" ? D.x - A.x : D.y - A.y;
  if (Math.abs(span) < MIN_AXIS_SPAN) {
    return CURVE_CONNECTOR_DEFAULT_RATIO;
  }
  const [k, start, end] = axis === "h" ? [K.x, A.x, D.x] : [K.y, A.y, D.y];
  const turn = (8 * k - start - end) / 6;
  return clamp((turn - start) / span, 0, 1);
};

/**
 * 默认比例下的中间点 K。比例取 0.5 时转折线落在两端中点，代入
 * `K = B(0.5)` 正好化简成 A–D 弦中点，所以创建时不必先解轴向就能落出 3 个点
 * （方向手柄的**占位三点**就是用它：源中心 / 副本中心的中点，重算反推出的比例
 * 因此正好是默认的 0.5）。
 */
export const getCurveConnectorDefaultK = (
  A: CurveConnectorPoint,
  D: CurveConnectorPoint,
): CurveConnectorPoint => ({
  x: (A.x + D.x) / 2,
  y: (A.y + D.y) / 2,
});

const toAttachment = (
  element: ExcalidrawElement,
): CurveConnectorAttachment => ({
  center: {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  },
  angle: element.angle,
  width: element.width,
  height: element.height,
});

/**
 * 按两端绑定算出 A、D 落在各自图形**轮廓**上的点（走现成的轮廓交点工具
 * `updateBoundPoint`，旋转图形因此也贴真实轮廓），保留原比例后返回新的
 * `[A, K, D]`（元素局部坐标）。
 *
 * 两端都解析不出来时返回 null——调用方保持原样不动。
 */
export const recomputeCurveConnector = (
  element: NonDeleted<ExcalidrawArrowElement>,
  elementsMap: ElementsMap,
): LocalPoint[] | null => {
  if (!isDerivedCurveConnector(element)) {
    return null;
  }
  const [A0, K0, D0] = element.points;

  const resolve = (field: "startBinding" | "endBinding") => {
    const binding = element[field];
    const target = binding ? elementsMap.get(binding.elementId) : undefined;
    if (!binding || !target || !isBindableElement(target)) {
      return null;
    }
    const point = updateBoundPoint(
      element,
      field,
      binding,
      target,
      elementsMap,
    );
    return point ? { point, attachment: toAttachment(target) } : null;
  };

  const start = resolve("startBinding");
  const end = resolve("endBinding");
  if (!start && !end) {
    return null;
  }

  const A = start
    ? { x: start.point[0], y: start.point[1] }
    : { x: A0[0], y: A0[1] };
  const D = end ? { x: end.point[0], y: end.point[1] } : { x: D0[0], y: D0[1] };

  // 附着边的判断要拿**场景坐标**（附着端图形的中心/角度都是场景里的量），
  // 而 points 是元素局部坐标；比例只用同一条轴上的差值，与坐标系无关。
  const toScene = (point: CurveConnectorPoint) => {
    const [x, y] = LinearElementEditor.getPointGlobalCoordinates(
      element,
      pointFrom<LocalPoint>(point.x, point.y),
      elementsMap,
    );
    return { x, y };
  };
  const axis = getCurveConnectorAxis({
    A: toScene(A),
    D: toScene(D),
    start: start?.attachment,
    end: end?.attachment,
  });
  // 比例要从**旧**三点反推（用户拖 K 就是在改它），再按新的两端解出 K：反推
  // 用的是旧 A/D，所以端点随后落到轮廓外一个 binding gap 上也不会让比例漂移。
  const ratio = getCurveConnectorRatio({
    A: { x: A0[0], y: A0[1] },
    D: { x: D0[0], y: D0[1] },
    axis,
    K: { x: K0[0], y: K0[1] },
  });
  const { K } = getCurveConnectorGeometry({ A, D, axis, ratio });

  return [
    pointFrom<LocalPoint>(A.x, A.y),
    pointFrom<LocalPoint>(K.x, K.y),
    pointFrom<LocalPoint>(D.x, D.y),
  ];
};

type CubicPoints = [
  CurveConnectorPoint,
  CurveConnectorPoint,
  CurveConnectorPoint,
  CurveConnectorPoint,
];

const cubicAt = ([p0, p1, p2, p3]: CubicPoints, t: number) => {
  const u = 1 - t;
  return {
    x:
      u * u * u * p0.x +
      3 * t * u * u * p1.x +
      3 * t * t * u * p2.x +
      t ** 3 * p3.x,
    y:
      u * u * u * p0.y +
      3 * t * u * u * p1.y +
      3 * t * t * u * p2.y +
      t ** 3 * p3.y,
  };
};

const cubicDerivativeAt = ([p0, p1, p2, p3]: CubicPoints, t: number) => {
  const u = 1 - t;
  return {
    x:
      3 *
      (u * u * (p1.x - p0.x) +
        2 * t * u * (p2.x - p1.x) +
        t * t * (p3.x - p2.x)),
    y:
      3 *
      (u * u * (p1.y - p0.y) +
        2 * t * u * (p2.y - p1.y) +
        t * t * (p3.y - p2.y)),
  };
};

/** [t0, t1] 这一段子曲线仍是三次贝塞尔：端点 + 按导数缩放的两个控制点 */
const cubicSegment = (
  points: CubicPoints,
  t0: number,
  t1: number,
): CubicPoints => {
  const span = t1 - t0;
  const start = cubicAt(points, t0);
  const end = cubicAt(points, t1);
  const startDerivative = cubicDerivativeAt(points, t0);
  const endDerivative = cubicDerivativeAt(points, t1);
  return [
    start,
    {
      x: start.x + (span / 3) * startDerivative.x,
      y: start.y + (span / 3) * startDerivative.y,
    },
    {
      x: end.x - (span / 3) * endDerivative.x,
      y: end.y - (span / 3) * endDerivative.y,
    },
    end,
  ];
};

/** 3 点曲线的控制点（元素局部坐标）；元素不是新模型时返回 null */
const getCurveConnectorControlPoints = (
  element: ExcalidrawArrowElement,
): CubicPoints | null => {
  if (!isDerivedCurveConnector(element)) {
    return null;
  }
  const [A, K, D] = element.points;
  const start = { x: A[0], y: A[1] };
  const end = { x: D[0], y: D[1] };
  const axis = getCurveConnectorAxisFromBindings(element);
  const ratio = getCurveConnectorRatio({
    A: start,
    D: end,
    axis,
    K: { x: K[0], y: K[1] },
  });
  const { c1, c2 } = getCurveConnectorGeometry({
    A: start,
    D: end,
    axis,
    ratio,
  });
  return [start, c1, c2, end];
};

/** 把同一条三次贝塞尔按给定 t 切分，拼成一条 SVG 路径（元素局部坐标） */
const buildCurveConnectorPath = (
  element: ExcalidrawElement,
  knots: readonly number[],
): string | null => {
  if (!isDerivedCurveConnector(element)) {
    return null;
  }
  const controlPoints = getCurveConnectorControlPoints(element);
  if (!controlPoints) {
    return null;
  }
  const [A] = controlPoints;
  const cuts: number[] = [0, ...knots, 1];
  const segments: string[] = [];
  for (let index = 0; index < cuts.length - 1; index++) {
    const [, c1, c2, end] = cubicSegment(
      controlPoints,
      cuts[index],
      cuts[index + 1],
    );
    segments.push(`C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`);
  }
  return `M ${A.x} ${A.y} ${segments.join(" ")}`;
};

/**
 * **渲染**用的曲线连接线路径（元素局部坐标，未旋转）：按 `CUBIC_SPLIT_KNOTS`
 * 切成 4 段，首末段足够短，画出来的箭头方向才贴得住切线（见该常量的注释）。
 *
 * 包围盒（`bounds.ts` 读这里的 ops）与两端切线都由它推导。
 */
export const getCurveConnectorPath = (element: ExcalidrawElement) =>
  buildCurveConnectorPath(element, CUBIC_SPLIT_KNOTS);

/**
 * **命中 / 碰撞**用的路径：同一条曲线，但按逻辑段切（`CUBIC_COLLISION_KNOTS`），
 * 让 `deconstructLinearOrFreeDrawElement` 拆出的段数与元素的逻辑段数一致。
 * 两处形状函数因此输出**同一条曲线**（只是 ops 粒度不同，各自服务各自的消费者，
 * 见两个常量的注释）。
 */
export const getCurveConnectorCollisionPath = (element: ExcalidrawElement) =>
  buildCurveConnectorPath(element, CUBIC_COLLISION_KNOTS);
