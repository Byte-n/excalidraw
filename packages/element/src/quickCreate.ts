import { DEFAULT_SHAPE_PRESET_SIZE } from "@excalidraw/common";
import {
  bezierEquation,
  curve,
  pointFrom,
  pointRotateRads,
} from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import { getElementAbsoluteCoords } from "./bounds";
import { isBaseShapeId, isCompositeShapeElement } from "./compositeShape";
import { isMindmapNodeElement } from "./typeChecks";

import type {
  ElementsMap,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "./types";

export type QuickCreateDirection = "top" | "right" | "bottom" | "left";

export const QUICK_CREATE_DIRECTIONS: readonly QuickCreateDirection[] = [
  "top",
  "right",
  "bottom",
  "left",
];

/**
 * 常态与悬停**共用**的圆心外移距离（屏幕 px）：两种状态圆心必须重合，
 * 否则悬停时手柄会跑位，所以这个值由放大后的 ⌀20 决定，而不是由圆点决定。
 */
export const QUICK_CREATE_HANDLE_OFFSET = 22;
/** 常态圆点直径（屏幕 px） */
export const QUICK_CREATE_HANDLE_SIZE = 8;
/** 悬停（以及触屏常态）的手柄直径（屏幕 px） */
export const QUICK_CREATE_HANDLE_SIZE_HOVER = 20;
/** 按下时略缩，给一次触感 */
export const QUICK_CREATE_HANDLE_SIZE_DOWN = 18;
/** 悬停加号**总长**（屏幕 px） */
export const QUICK_CREATE_PLUS_SIZE = 9;
/** 按下态加号总长（屏幕 px） */
export const QUICK_CREATE_PLUS_SIZE_DOWN = 8;
/** 紧凑档悬停加号总长（屏幕 px） */
export const QUICK_CREATE_PLUS_SIZE_COMPACT = 7;
/** 紧凑档悬停的描边宽度（屏幕 px）：常规档是 1.5，紧凑档细一档 */
export const QUICK_CREATE_RING_HOVER_COMPACT = 1.25;
/** 命中热区直径（屏幕 px），口径同 transformHandleSizes */
export const QUICK_CREATE_HIT_SIZE = 20;
/** 触屏命中热区直径（屏幕 px） */
export const QUICK_CREATE_HIT_SIZE_TOUCH = 32;
/** 元素在**屏幕**上的最小边低于此值即走紧凑档（用屏幕尺寸，小图形与低缩放同一条规则） */
export const QUICK_CREATE_COMPACT_THRESHOLD = 40;
/** 紧凑档常态点直径（屏幕 px） */
export const QUICK_CREATE_HANDLE_SIZE_COMPACT = 6;
/** 紧凑档悬停直径（屏幕 px） */
export const QUICK_CREATE_HANDLE_SIZE_HOVER_COMPACT = 16;
/** 紧凑档按下直径（屏幕 px） */
export const QUICK_CREATE_HANDLE_SIZE_DOWN_COMPACT = 14;
/** 紧凑档的圆心外移距离（屏幕 px） */
export const QUICK_CREATE_OFFSET_COMPACT = 18;
/**
 * 结果预演的整体不透明度。预演画的就是**真实的**线条、箭头与图形样式
 * （`renderElement` 同一套渲染），只把整层压到一半表示尚未提交。
 */
export const QUICK_CREATE_GHOST_ALPHA = 0.5;
/** 常态圆点的不透明度：安静地提示方向，悬停才转实 */
export const QUICK_CREATE_HANDLE_REST_ALPHA = 0.4;
/** 新图形与源图形的边缘间隙补偿 */
export const QUICK_CREATE_GAP_EXTRA = 10;

/**
 * 新图形与源图形的**最近边缘间隙**（场景单位）：预设尺寸 + 补偿，
 * 与源图形的实际大小无关。
 */
export const QUICK_CREATE_GAP = {
  horizontal: DEFAULT_SHAPE_PRESET_SIZE.width + QUICK_CREATE_GAP_EXTRA,
  vertical: DEFAULT_SHAPE_PRESET_SIZE.height + QUICK_CREATE_GAP_EXTRA,
} as const;

export const getQuickCreateGap = (direction: QuickCreateDirection) =>
  direction === "left" || direction === "right"
    ? QUICK_CREATE_GAP.horizontal
    : QUICK_CREATE_GAP.vertical;

/**
 * 让位档位之间的步长 = 1.75 × 副本在**扩散轴**上的尺寸，也就是「1 个自身尺寸
 * 走位 + 0.75 个自身尺寸留缝」：相邻两档之间边缘正好空出 0.75 尺寸，副本在
 * 落位上不会跟旁边那档的副本贴死。
 */
export const QUICK_CREATE_SPILL_STEP_RATIO = 1.75;
/** 每侧试 5 档（k = 1..5，正负交替），即 10 个候选位，试完就回落基准位 */
export const QUICK_CREATE_SPILL_MAX_STEPS = 5;
/**
 * 圆角曲线连线的采样节点（t 值，非均匀）。
 *
 * 非折线箭头带 roundness 时，渲染走的是 roughjs 的 `generator.curve(points)`
 * ——一条**穿过每个给定点**的 Catmull-Rom 样条（见 shape.ts 的 renderArrow），
 * 所以真三次贝塞尔只能靠采样逼近，点数就是用户要拖的中间手柄数。
 *
 * 为什么是这 5 个节点（都在真实渲染路径上量过，默认几何的最大偏差）：
 * - 3 点做不到扇形：B、C 都在转折线上，扇形曲线在 t = 0.5 处**恒等**于 A–D
 *   弦的中点，而单个中间点若落在弦上，Catmull-Rom 画出来就是直线（自由单点
 *   二维搜索的最优解就是那条直线，差 13.75）。「1 个手柄」换不来扇形。
 * - 5 点（t = 0、0.2、0.5、0.8、1）几乎免费：偏差 1.44（≈图形宽的 0.8%）。
 * - 更多点收益很小：7 点 1.60、9 点 0.89 —— 手柄却要多一倍。
 * - 均匀 5 点（0.25/0.5/0.75）反而差：3.65；均匀 4 点 6.45 —— Catmull-Rom
 *   喜欢接近均匀的参数间距，但首尾要略密，所以取 0.2 / 0.5 / 0.8。
 * - 也别按弧长取节点：弧长四分位更差（默认几何 4.67、让位 3 档 10.87）。
 * - t = 0.5 是其中一个节点，所以曲线经过转折段中点是恒等式、不是近似。
 * 跨几何抽查（1 档 / 3 档 / 400×80 / 80×300 / 下手柄横移 2 档）：这组 5 点
 * 最大偏差 1.44–3.59，相对跨度都在 2% 以内。
 */
export const QUICK_CREATE_CURVE_KNOTS = [0, 0.2, 0.5, 0.8, 1] as const;

/** 出线轴上的对齐容差：只是兜住浮点噪声（如 angle = π 时 sin 不是 0） */
const AXIAL_ALIGNMENT_EPSILON = 1e-9;

export type QuickCreatePoint = { x: number; y: number };

/** 落点与连线几何只需要源的这几项，调用方不必造一个完整元素 */
export type QuickCreateSourceGeometry = {
  center: QuickCreatePoint;
  angle: Radians;
  width: number;
  height: number;
};

/** 方向的未旋转单位向量（+x 右、+y 下，与画布坐标同向） */
const DIRECTION_VECTORS: Record<QuickCreateDirection, [number, number]> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

/**
 * 方向单位向量按元素 angle 旋转后的场景方向：旋转元素的手柄与新图形都沿它
 * 落位，与随 angle 旋转的指示框一致。
 */
export const getQuickCreateDirectionVector = (
  direction: QuickCreateDirection,
  angle: Radians,
): { x: number; y: number } => {
  const [x, y] = DIRECTION_VECTORS[direction];
  const [rx, ry] = pointRotateRads<GlobalPoint>(
    pointFrom<GlobalPoint>(x, y),
    pointFrom<GlobalPoint>(0, 0),
    angle,
  );
  return { x: rx, y: ry };
};

/** 方向手柄只对 basic ∪ fc-* 的未锁定图形出现 */
export const isQuickCreateTargetElement = (
  element: ExcalidrawElement | null | undefined,
): element is NonDeletedExcalidrawElement =>
  !!element &&
  !element.isDeleted &&
  !element.locked &&
  isCompositeShapeElement(element) &&
  isBaseShapeId(element.shape.id);

/**
 * 几何与命中只需要这几个字段，用结构类型收口，避免几何模块依赖 App 本体。
 */
export type QuickCreateApp = {
  state: {
    selectedElementIds: Readonly<Record<string, true>>;
    zoom: { value: number };
    viewModeEnabled: boolean;
    editingTextElement: Readonly<ExcalidrawElement> | null | undefined;
  };
  scene: {
    getNonDeletedElement: (id: string) => NonDeletedExcalidrawElement | null;
    getNonDeletedElementsMap: () => ElementsMap;
  };
};

export type QuickCreateHandle = {
  direction: QuickCreateDirection;
  elementId: string;
  /** 场景坐标，已按 zoom 换算、并绕元素中心旋转过 angle */
  center: { x: number; y: number };
  /** 命中热区直径（场景单位） */
  hitSize: number;
  /** 常态直径（场景单位），渲染的起点尺寸 */
  size: number;
  /** 圆心外移距离（场景单位），两种状态共用 */
  offset: number;
  /** 该元素是否走紧凑档（屏幕最小边 < QUICK_CREATE_COMPACT_THRESHOLD） */
  compact: boolean;
};

/** 恰好单选的图形目标；其余情况（多选/便签/画框/表格/箭头/文本/锁定）返回 null */
export const getQuickCreateTargetElement = (
  app: QuickCreateApp,
): NonDeletedExcalidrawElement | null => {
  if (app.state.viewModeEnabled || app.state.editingTextElement) {
    return null;
  }
  const selectedIds = Object.keys(app.state.selectedElementIds);
  if (selectedIds.length !== 1) {
    return null;
  }
  const element = app.scene.getNonDeletedElement(selectedIds[0]);
  return isQuickCreateTargetElement(element) ? element : null;
};

/**
 * 圆点中心：元素本地框（`getElementAbsoluteCoords` 返回的 `x, y, x+w, y+h`，
 * 不含 angle）四条边的中点沿外法线偏移 `offset`（场景单位），再绕元素中心按
 * angle 旋转——指示框与变换手柄都是随 angle 旋转的，圆点跟随才不会跑到所见框外。
 */
const getHandleCenters = (
  bounds: readonly [number, number, number, number, ...number[]],
  angle: Radians,
  offset: number,
) => {
  const [x1, y1, x2, y2] = bounds;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const local: Record<QuickCreateDirection, { x: number; y: number }> = {
    top: { x: midX, y: y1 - offset },
    right: { x: x2 + offset, y: midY },
    bottom: { x: midX, y: y2 + offset },
    left: { x: x1 - offset, y: midY },
  };
  if (!angle) {
    return local;
  }
  const center = pointFrom<GlobalPoint>(midX, midY);
  return Object.fromEntries(
    QUICK_CREATE_DIRECTIONS.map((direction) => {
      const [rx, ry] = pointRotateRads<GlobalPoint>(
        pointFrom<GlobalPoint>(local[direction].x, local[direction].y),
        center,
        angle,
      );
      return [direction, { x: rx, y: ry }];
    }),
  ) as Record<QuickCreateDirection, { x: number; y: number }>;
};

/**
 * 渲染与命中共用：全部手柄（场景坐标）。没有目标、或按住修饰键（`suppressed`）
 * 时返回空数组，保证「看到的」与「点得到的」一致——这是整组不渲染的唯一入口。
 */
export const getQuickCreateHandles = (
  app: QuickCreateApp,
  pointerType: string = "mouse",
  suppressed: boolean = false,
): QuickCreateHandle[] => {
  if (suppressed) {
    return [];
  }
  const element = getQuickCreateTargetElement(app);
  if (!element) {
    return [];
  }
  const zoom = app.state.zoom.value;
  const bounds = getElementAbsoluteCoords(
    element,
    app.scene.getNonDeletedElementsMap(),
  );
  // 紧凑档按**屏幕**尺寸判定，小图形与低缩放走同一条规则
  const compact =
    Math.min(element.width, element.height) * zoom <
    QUICK_CREATE_COMPACT_THRESHOLD;
  const offset =
    (compact ? QUICK_CREATE_OFFSET_COMPACT : QUICK_CREATE_HANDLE_OFFSET) / zoom;
  const centers = getHandleCenters(bounds, element.angle, offset);
  const hitSize =
    (pointerType === "touch"
      ? QUICK_CREATE_HIT_SIZE_TOUCH
      : QUICK_CREATE_HIT_SIZE) / zoom;
  return QUICK_CREATE_DIRECTIONS.map((direction) => ({
    direction,
    elementId: element.id,
    center: centers[direction],
    hitSize,
    size:
      (compact ? QUICK_CREATE_HANDLE_SIZE_COMPACT : QUICK_CREATE_HANDLE_SIZE) /
      zoom,
    offset,
    compact,
  }));
};

export const hitTestQuickCreateHandle = (
  app: QuickCreateApp,
  sceneX: number,
  sceneY: number,
  pointerType: string = "mouse",
  suppressed: boolean = false,
): { direction: QuickCreateDirection; elementId: string } | null => {
  if (suppressed) {
    return null;
  }
  const element = getQuickCreateTargetElement(app);
  if (!element) {
    return null;
  }
  const handles = getQuickCreateHandles(app, pointerType, suppressed);
  let hit: QuickCreateDirection | null = null;
  let hitDistance = Infinity;
  for (const handle of handles) {
    const distance = Math.hypot(
      sceneX - handle.center.x,
      sceneY - handle.center.y,
    );
    if (distance <= handle.hitSize / 2 && distance < hitDistance) {
      hitDistance = distance;
      hit = handle.direction;
    }
  }
  return hit ? { direction: hit, elementId: element.id } : null;
};

/**
 * 新图形中心：源中心沿**旋转后的方向向量**偏移「源在该轴的半尺寸 + 间隙 +
 * 副本在该轴的半尺寸」。副本 angle 与源一致，所以同一轴上的半尺寸就是
 * `width / 2`（左右）或 `height / 2`（上下）；angle=0 时另一轴自然与源中点对齐
 * （连线水平/垂直），angle≠0 时连线沿旋转方向。
 */
export const getQuickCreateTargetCenter = (
  source: QuickCreateSourceGeometry,
  direction: QuickCreateDirection,
  newSize: { width: number; height: number },
) => {
  const horizontal = direction === "left" || direction === "right";
  const distance =
    (horizontal ? source.width : source.height) / 2 +
    getQuickCreateGap(direction) +
    (horizontal ? newSize.width : newSize.height) / 2;
  const vector = getQuickCreateDirectionVector(direction, source.angle);
  return {
    x: source.center.x + vector.x * distance,
    y: source.center.y + vector.y * distance,
  };
};

/**
 * 旋转矩形的轴对齐包围盒（AABB）。副本保持源图形的角度，所以占用判定用的是
 * 它的旋转 AABB——判得比看上去保守一点，但方向是绝对的，与「不随旋转改变」
 * 这条一致。
 */
const getRotatedAABB = (
  center: QuickCreatePoint,
  size: { width: number; height: number },
  angle: Radians,
): [number, number, number, number] => {
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const halfWidth = (size.width * cos + size.height * sin) / 2;
  const halfHeight = (size.width * sin + size.height * cos) / 2;
  return [
    center.x - halfWidth,
    center.y - halfHeight,
    center.x + halfWidth,
    center.y + halfHeight,
  ];
};

/** 零容差：包围盒只要相交就算占用 */
const aabbOverlap = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * 占用判定只认**图形类**元素：普通图形 / 流程图图形（`isCompositeShapeElement`，
 * 也就是方向手柄的同类目标）与脑图节点。**含锁定元素**——让位规则里锁定元素
 * 不算「指针压着」，但落点上它仍然占着地方，副本不该叠到它身上。
 *
 * 排除项与 `App.quickCreate.ts` 的让位规则同一套口径：源自身、源自己的绑定
 * 元素（出边箭头、绑定文字）、箭头与线条、画框、文本、手绘。候选位就落在源
 * 图形边上那一圈里，出边连线、画框边框、绑定文字必然经过——算占用会把整条
 * 扩散路径堵死，让位也就永远落回基准位叠在一起。
 */
const isQuickCreateObstacle = (
  element: ExcalidrawElement,
  source: {
    id: string;
    boundElements?: readonly { id: string }[] | null;
  },
) =>
  !element.isDeleted &&
  (isCompositeShapeElement(element) || isMindmapNodeElement(element)) &&
  element.id !== source.id &&
  !source.boundElements?.some((bound) => bound.id === element.id);

/** 扩散档步长：左右手柄沿场景竖向让位、按副本**高度**；上下手柄沿横向、按宽度 */
export const getQuickCreateSpillStep = (
  direction: QuickCreateDirection,
  newSize: { width: number; height: number },
) =>
  (direction === "left" || direction === "right"
    ? newSize.height
    : newSize.width) * QUICK_CREATE_SPILL_STEP_RATIO;

/**
 * 候选位：基准位沿**绝对轴**（左右手柄 → 场景竖向，上下手柄 → 场景横向）
 * 平移 ±k × 步长，k = 1..5 正反交替（上 1、下 1、上 2、下 2…）。
 *
 * 每一档都从基准位直接算，不逐档累加：任何一档都能单算，也不会因为中间某档
 * 恰好空了就整体漂移。扩散轴与 angle 无关——旋转只影响手柄与基准位（老规则），
 * 不让位方向跟着转。
 */
export const getQuickCreateSpillCandidates = (
  base: QuickCreatePoint,
  direction: QuickCreateDirection,
  newSize: { width: number; height: number },
): QuickCreatePoint[] => {
  const step = getQuickCreateSpillStep(direction, newSize);
  const alongY = direction === "left" || direction === "right";
  const candidates: QuickCreatePoint[] = [];
  for (let k = 1; k <= QUICK_CREATE_SPILL_MAX_STEPS; k++) {
    for (const sign of [-1, 1]) {
      const offset = sign * k * step;
      candidates.push(
        alongY
          ? { x: base.x, y: base.y + offset }
          : { x: base.x + offset, y: base.y },
      );
    }
  }
  return candidates;
};

/**
 * 落点：基准位没被占就用基准位（老行为）；被占就沿绝对轴交替试探候选位，
 * 命中第一个空位即落。10 个候选全被占满则**回落基准位**——副本照建、照连、
 * 照选中，宁可叠在别人身上也好过「点了没反应」。
 */
export const getQuickCreateResolvedTargetCenter = (
  source: QuickCreateSourceGeometry & {
    id: string;
    boundElements?: readonly { id: string }[] | null;
  },
  direction: QuickCreateDirection,
  newSize: { width: number; height: number },
  elementsMap: ElementsMap,
): QuickCreatePoint => {
  const base = getQuickCreateTargetCenter(source, direction, newSize);
  const obstacles: [number, number, number, number][] = [];
  for (const element of elementsMap.values()) {
    if (isQuickCreateObstacle(element, source)) {
      obstacles.push(
        getRotatedAABB(
          {
            x: element.x + element.width / 2,
            y: element.y + element.height / 2,
          },
          { width: element.width, height: element.height },
          element.angle,
        ),
      );
    }
  }
  const fits = (center: QuickCreatePoint) => {
    const bounds = getRotatedAABB(center, newSize, source.angle);
    return !obstacles.some((obstacle) => aabbOverlap(bounds, obstacle));
  };
  if (fits(base)) {
    return base;
  }
  for (const candidate of getQuickCreateSpillCandidates(
    base,
    direction,
    newSize,
  )) {
    if (fits(candidate)) {
      return candidate;
    }
  }
  return base;
};

/**
 * 副本轮廓上、过副本中心的那条**轴向**线（左右手柄取水平线、上下手柄取竖直线）
 * 与轮廓的交点，取朝出口那一侧的那个。
 *
 * 朝哪一侧不按 direction 判而按坐标比：旋转 180° 的源，右手柄的副本落在源的
 * 左侧、出口反而在副本右侧。旋转副本必须落在**真实轮廓**上——拿 AABB 当轮廓，
 * 交点会悬在图形外的半空中。
 *
 * 到边的距离：世界方向 u 在本体坐标里是 R(-angle)·u，沿它走到矩形边界的距离
 * 是 `1 / max(|u_local.x| / 半宽, |u_local.y| / 半高)`。
 */
const getAxialOutlinePoint = (
  center: QuickCreatePoint,
  size: { width: number; height: number },
  angle: Radians,
  horizontal: boolean,
  towards: number,
): QuickCreatePoint => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [localX, localY] = horizontal ? [cos, -sin] : [sin, cos];
  const distance =
    1 /
    Math.max(
      Math.abs(localX) / (size.width / 2),
      Math.abs(localY) / (size.height / 2),
    );
  const sign = towards < (horizontal ? center.x : center.y) ? -1 : 1;
  return horizontal
    ? { x: center.x + sign * distance, y: center.y }
    : { x: center.x, y: center.y + sign * distance };
};

export type QuickCreateConnector = {
  /** 出口 A：源在出发方向上的边缘中点（沿旋转后的方向向量） */
  exit: QuickCreatePoint;
  /** 入口 D：副本朝源一侧的轮廓交点，落在副本的轴向中线高度/宽度上 */
  entry: QuickCreatePoint;
  /** 转折点 [B, C]；出口与副本在出线轴上对齐时为 null（两点直线） */
  bend: [QuickCreatePoint, QuickCreatePoint] | null;
};

/**
 * 悬停预演与真实创建共用的连线路径：出口 A、入口 D，以及错开时的两个转折点。
 *
 * - 副本中心与出口在出线轴上对齐（没让位、且源没转）：仍是两点直线（老行为）。
 *   旋转过但没让位的源也不满足这一条，同样走折线——那时连线本来就是斜的。
 * - 错开时：转折点在出线轴上的**中点**（左右手柄取 x 的中点、上下手柄取 y 的
 *   中点），B / C 就是这条转折线上的两个拐角，A→B→C→D 每段都轴对齐，入口
 *   贴在副本朝源那一侧的轮廓上，两个拐点落在两图形之间的空档里、不穿过任何
 *   一方。中间两点同样可以当三次贝塞尔的控制点用（脑图连线就是这个画法，
 *   见 mindmap.ts 的 getMindmapEdgeGeometry / getMindmapEdgePath）：t = 0.5
 *   恰好落在 B–C 的中点，所以曲线严格经过转折段的正中。
 */
export const getQuickCreateConnector = (
  source: QuickCreateSourceGeometry,
  direction: QuickCreateDirection,
  target: QuickCreatePoint,
  copySize: { width: number; height: number },
): QuickCreateConnector => {
  const horizontal = direction === "left" || direction === "right";
  const vector = getQuickCreateDirectionVector(direction, source.angle);
  const exitHalf = (horizontal ? source.width : source.height) / 2;
  const exit = {
    x: source.center.x + vector.x * exitHalf,
    y: source.center.y + vector.y * exitHalf,
  };
  const offset = horizontal ? target.y - exit.y : target.x - exit.x;
  if (Math.abs(offset) < AXIAL_ALIGNMENT_EPSILON) {
    const entryHalf = (horizontal ? copySize.width : copySize.height) / 2;
    return {
      exit,
      entry: {
        x: target.x - vector.x * entryHalf,
        y: target.y - vector.y * entryHalf,
      },
      bend: null,
    };
  }
  const entry = getAxialOutlinePoint(
    target,
    copySize,
    source.angle,
    horizontal,
    horizontal ? exit.x : exit.y,
  );
  const turn = horizontal ? (exit.x + entry.x) / 2 : (exit.y + entry.y) / 2;
  return {
    exit,
    entry,
    bend: horizontal
      ? [
          { x: turn, y: exit.y },
          { x: turn, y: entry.y },
        ]
      : [
          { x: exit.x, y: turn },
          { x: entry.x, y: turn },
        ],
  };
};

/**
 * 把转折点当控制点采样三次贝塞尔，给圆角曲线样式用：非折线箭头带 roundness
 * 时 roughjs 只画「穿过给定点」的样条，真曲线只能这么逼近（节点见
 * QUICK_CREATE_CURVE_KNOTS）。首尾两个采样点就是出口与入口，中间的 t = 0.5
 * 仍落在转折段中点。
 */
export const getQuickCreateCurvePoints = (
  exit: QuickCreatePoint,
  bend: [QuickCreatePoint, QuickCreatePoint],
  entry: QuickCreatePoint,
): QuickCreatePoint[] => {
  const cubic = curve(
    pointFrom<GlobalPoint>(exit.x, exit.y),
    pointFrom<GlobalPoint>(bend[0].x, bend[0].y),
    pointFrom<GlobalPoint>(bend[1].x, bend[1].y),
    pointFrom<GlobalPoint>(entry.x, entry.y),
  );
  return QUICK_CREATE_CURVE_KNOTS.map((t) => {
    const [x, y] = bezierEquation(cubic, t);
    return { x, y };
  });
};
