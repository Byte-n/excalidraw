import { DEFAULT_SHAPE_PRESET_SIZE } from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import { getElementAbsoluteCoords } from "./bounds";
import { isBaseShapeId, isCompositeShapeElement } from "./compositeShape";

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
/** 结果预演的整体不透明度 */
export const QUICK_CREATE_GHOST_ALPHA = 0.5;
/** 结果预演中幽灵副本的填充不透明度 */
export const QUICK_CREATE_GHOST_FILL_ALPHA = 0.08;
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
  source: {
    center: { x: number; y: number };
    angle: Radians;
    width: number;
    height: number;
  },
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
