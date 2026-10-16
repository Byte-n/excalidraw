import { pointFrom, pointRotateRads, type GlobalPoint } from "@excalidraw/math";

import { getElementAbsoluteCoords } from "./bounds";
import { isCurvedArrow } from "./typeChecks";

import type {
  ElementsMap,
  ExcalidrawArrowElement,
  ExcalidrawElement,
} from "./types";

/**
 * 箭头曲线的纯几何模块 —— **全局唯一**的一份（不论箭头是箭头工具拖的、方向手柄建
 * 的、转换来的还是读回来的）：判据只看 `isCurvedArrow`（arrow + 非折线 +
 * roundness 非空），没有任何元素字段开关。
 *
 * 职责只有两件：把两端解成端切线（所依附边的轴对齐外法线；判不出边时，两点看弦的
 * 主轴、多点看相邻段方向），以及把 `points`（端点在数组首尾，中间是用户控制点）
 * 转成局部几何。渲染、包围盒、命中三处都读同一个 `getCurvedConnectorPath`（由
 * `getCurvedConnectorLocalPath` 拼出），交互层的悬停高亮则用同一份局部几何的
 * canvas 描边 `traceCurvedConnectorPath`——四条消费路径不存在第二套口径。
 *
 * 边界：
 * - 不解析 `elementsMap`：端切线只读元素自己的 `binding.fixedPoint`（只有把局部
 *   点搬到场景坐标的 `traceCurvedConnectorPath` 才需要它）。
 * - 不改 `points`：控制点的增删与端点的重投影分别归上游编辑与绑定机制。
 * - 不切分、不采样：`points` 有几段就输出几个 `C` / 一段 `bezierCurveTo`，箭头
 *   方向由解析出的切线决定，不需要靠短段近似。
 */

/**
 * 该端的**单位**方向。所依附边解出来的外法线天然轴对齐（分量 -1 / 0 / 1）；回落
 * 取到相邻段或弦的方向时是任意单位向量。
 */
export type CurveNormal = Readonly<{ x: number; y: number }>;

/** 局部坐标点 */
type Point = { x: number; y: number };

/**
 * 判定「附着点落在某条边上」的容差：归一化盒坐标两轴偏离中心的量之差超过
 * 它才算有确定边，否则视为正角点 / 点状目标 / 内部锚点，没有确定边。
 */
const EDGE_AXIS_EPSILON = 1e-6;

/** 输出精度：收敛到小数点后两位，避免浮点长尾进路径字符串 */
const round = (value: number) => Number(value.toFixed(2));

const axisNormal = (axis: "x" | "y", sign: -1 | 1): CurveNormal =>
  axis === "x" ? { x: sign, y: 0 } : { x: 0, y: sign };

const oppositeSign = (sign: -1 | 1): -1 | 1 => (sign === 1 ? -1 : 1);

/**
 * 弦的主轴：`A → D` 上绝对值更大的那根轴，符号指向 D。两端点重合（`dx = dy = 0`）
 * 时取 +x 与 −x 这对兜底。
 *
 * 这一支只服务「两点、未绑定」——那时弦就是拖拽方向，而拖拽方向正是用户唯一表达
 * 过的走向，所以两端切线取它的主轴：完全水平或垂直时与弦共线（于是是直线），其余
 * 角度都是默认弓形，尖端因此正水平或正竖直。
 */
const chordMainAxis = (
  A: readonly [number, number],
  D: readonly [number, number],
): { axis: "x" | "y"; sign: -1 | 1 } => {
  const dx = D[0] - A[0];
  const dy = D[1] - A[1];
  return Math.abs(dx) >= Math.abs(dy)
    ? { axis: "x", sign: dx >= 0 ? 1 : -1 }
    : { axis: "y", sign: dy >= 0 ? 1 : -1 };
};

/** 单位方向；零向量（两端重合）返回 null，交回调用方继续往下级回落 */
const unitDirection = (
  from: readonly [number, number],
  to: readonly [number, number],
): CurveNormal | null => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  return length > 0 ? { x: dx / length, y: dy / length } : null;
};

/**
 * 由归一化盒坐标（0..1，与 `binding.fixedPoint` 同口径）判定所依附的边：偏离
 * 中心更大的那根轴胜出，方向取该轴上 `f − 0.5` 的符号（即该边的外法线）。两轴
 * 打平（正角点、点状目标、内部锚点）时没有确定边，返回 null 交给调用方回落。
 *
 * 曲线档的端切线与端点落点（`binding.ts`）共用它：切线指向哪条边，端点就沿
 * 那条边的外法线外移。
 */
export const normalFromFixedPoint = (
  fixedPoint: readonly [number, number],
): CurveNormal | null => {
  const [fx, fy] = fixedPoint;
  const offsetX = Math.abs(fx - 0.5);
  const offsetY = Math.abs(fy - 0.5);
  if (offsetX - offsetY > EDGE_AXIS_EPSILON) {
    return axisNormal("x", fx > 0.5 ? 1 : -1);
  }
  if (offsetY - offsetX > EDGE_AXIS_EPSILON) {
    return axisNormal("y", fy > 0.5 ? 1 : -1);
  }
  return null;
};

/**
 * 该端的端切线方向，按三种情况决定：
 *
 * 1. **该端绑在图形上**（`binding.fixedPoint` 判得出确定的边）→ 那条边的轴对齐
 *    外法线，于是曲线垂直出/入边。手柄建的、复制图形出来的连线都走这一支。
 * 2. **没绑、且只有两个点**（没有控制点）→ 弦的**主轴**：水平与垂直里更长的
 *    那根轴，符号由起点指向终点。弦完全水平或垂直时两端切线与弦共线，曲线自然
 *    退化成直线；其余任何角度都是默认弓形，尖端因此正水平或正竖直。
 * 3. **没绑、但有控制点** → 按控制点走：端切线取贴着这一端的**相邻段方向**
 *    （起点段 `P0→P1`、终点段 `P_{n−1}→P_n` 反向），不做主轴量化——手画的斜段
 *    不该被凭空加一道弓。与 `arrowEndpointText` 取标签朝向的取源一致。
 *
 * 相邻段退化成零长（相邻两点重合）时回落弦方向，全都不成立时落 ±x 轴；
 * 点数不足两点（元素刚创建、`points` 还空着）直接落 ±x 轴。
 *
 * 两个消费方对方向的用法不同，三支的符号约定因此统一成「指向另一端所在的一侧」：
 * 起点处曲线沿它离开（`c1 = P0 + t/3`），终点处它是接近方向的反向
 * （`c2 = P_last + endNormal · 段长/3`，见 `getCurvedConnectorLocalPath`）。
 */
export const getCurvedConnectorEndNormal = (
  element: ExcalidrawArrowElement,
  end: "start" | "end",
): CurveNormal => {
  const binding = end === "start" ? element.startBinding : element.endBinding;
  const fixedPoint = binding?.fixedPoint;
  if (fixedPoint) {
    const normal = normalFromFixedPoint(fixedPoint);
    if (normal) {
      return normal;
    }
  }
  const points = element.points;
  const last = points.length - 1;
  if (last === 1) {
    // 情况 2：只有弦，没有走向信息 → 默认弓形
    const { axis, sign } = chordMainAxis(points[0], points[1]);
    return axisNormal(axis, end === "start" ? sign : oppositeSign(sign));
  }
  if (last > 1) {
    // 情况 3：按控制点走
    const own = end === "start" ? points[0] : points[last];
    const adjacent = end === "start" ? points[1] : points[last - 1];
    const other = end === "start" ? points[last] : points[0];
    return (
      unitDirection(own, adjacent) ??
      unitDirection(own, other) ??
      axisNormal("x", end === "start" ? 1 : -1)
    );
  }
  return axisNormal("x", end === "start" ? 1 : -1);
};

/**
 * 曲线连接线的局部几何（元素局部坐标、未旋转）：起点 + 每段的三次贝塞尔控制点
 * 与终点。SVG 串与 canvas 描边都从它拼，保证两处逐字节/逐点同源。
 */
type CurvedConnectorLocalPath = Readonly<{
  start: Point;
  segments: readonly Readonly<{ c1: Point; c2: Point; to: Point }>[];
}>;

/**
 * 渲染 / 包围盒 / 命中 / 悬停高亮共用的局部几何；非圆角箭头（或点数不足）返回
 * null。
 *
 * `points` 的相邻两项是每段的端点，段在端点的切线方向取端法线（起点沿该端方向、
 * 终点取其反向），内部点取相邻点中心差分（Catmull-Rom）；切线大小取相邻段长，
 * 于是「相邻两点重合」也不会产生零长手柄。曲线必然经过每个 `points` 项，
 * `points.length − 1` 就是段数。
 */
const getCurvedConnectorLocalPath = (
  element: ExcalidrawElement,
): CurvedConnectorLocalPath | null => {
  if (!isCurvedArrow(element)) {
    return null;
  }
  const points = element.points;
  if (points.length < 2) {
    return null;
  }
  const P: Point[] = points.map(([x, y]) => ({ x, y }));
  const last = P.length - 1;

  const startNormal = getCurvedConnectorEndNormal(element, "start");
  const endNormal = getCurvedConnectorEndNormal(element, "end");
  const firstSpan = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y);
  const lastSpan = Math.hypot(
    P[last].x - P[last - 1].x,
    P[last].y - P[last - 1].y,
  );

  // m_i：段在 P_i 处的切线（未除以 3）
  const tangent: Point[] = [
    { x: startNormal.x * firstSpan, y: startNormal.y * firstSpan },
  ];
  for (let i = 1; i < last; i++) {
    tangent.push({
      x: (P[i + 1].x - P[i - 1].x) / 2,
      y: (P[i + 1].y - P[i - 1].y) / 2,
    });
  }
  tangent.push({ x: -endNormal.x * lastSpan, y: -endNormal.y * lastSpan });

  const segments: { c1: Point; c2: Point; to: Point }[] = [];
  for (let i = 0; i < last; i++) {
    segments.push({
      c1: {
        x: P[i].x + tangent[i].x / 3,
        y: P[i].y + tangent[i].y / 3,
      },
      c2: {
        x: P[i + 1].x - tangent[i + 1].x / 3,
        y: P[i + 1].y - tangent[i + 1].y / 3,
      },
      to: { x: P[i + 1].x, y: P[i + 1].y },
    });
  }
  return { start: P[0], segments };
};

/**
 * SVG 路径（元素局部坐标，未旋转）；非曲线连接线返回 null。输出格式固定为
 * `M x y` + 每段 ` C c1x c1y, c2x c2y, tx ty`，精度收敛到两位小数。
 */
export const getCurvedConnectorPath = (
  element: ExcalidrawElement,
): string | null => {
  const geometry = getCurvedConnectorLocalPath(element);
  if (!geometry) {
    return null;
  }
  let path = `M ${round(geometry.start.x)} ${round(geometry.start.y)}`;
  for (const { c1, c2, to } of geometry.segments) {
    path += ` C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(
      c2.y,
    )}, ${round(to.x)} ${round(to.y)}`;
  }
  return path;
};

/**
 * 在 Canvas 上描出曲线连接线的路径（场景坐标，调用方负责平移与样式）。
 *
 * 局部点 → 场景坐标的口径与 `LinearElementEditor.getPointsGlobalCoordinates`
 * 完全一致：先加元素原点，再绕绝对坐标中心旋转 `element.angle`。只做
 * `beginPath` / `moveTo` / 每段一个 `bezierCurveTo`，不 stroke / fill / translate；
 * 非曲线连接线直接返回，不碰 context。
 */
export const traceCurvedConnectorPath = (
  context: CanvasRenderingContext2D,
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
) => {
  const geometry = getCurvedConnectorLocalPath(element);
  if (!geometry) {
    return;
  }
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
  const center = pointFrom<GlobalPoint>((x1 + x2) / 2, (y1 + y2) / 2);
  const toScene = (point: Point): GlobalPoint =>
    pointRotateRads(
      pointFrom<GlobalPoint>(element.x + point.x, element.y + point.y),
      center,
      element.angle,
    );

  const start = toScene(geometry.start);
  context.beginPath();
  context.moveTo(start[0], start[1]);
  for (const { c1, c2, to } of geometry.segments) {
    const [c1x, c1y] = toScene(c1);
    const [c2x, c2y] = toScene(c2);
    const [tx, ty] = toScene(to);
    context.bezierCurveTo(c1x, c1y, c2x, c2y, tx, ty);
  }
};
