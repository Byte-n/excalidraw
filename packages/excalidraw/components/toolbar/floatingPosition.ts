import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import { clamp } from "@excalidraw/math";

import type { Bounds } from "@excalidraw/common";

import type { AppState } from "../../types";

/**
 * 浮动工具栏（tb-floatbar）定位规则，设计稿
 * docs/design-ui/excalidraw-canvas-toolbar.html §2「交互通则」：
 * 选区包围盒上方居中、间距 12px；上方空间不足翻到下方；左右出界时
 * 水平收敛（边距 8）；画布缩放 <50% 时按 50% 渲染保证可读。
 *
 * 坐标换算复用 ElementCanvasButtons/UnlockPopup 的既有路径：
 * sceneCoordsToViewportCoords 得到视口坐标，再减 offsetLeft/offsetTop
 * 换算到容器（.layer-ui__wrapper）坐标系。
 */

/** 浮动栏与选区包围盒的垂直间距 */
export const FLOATBAR_GAP = 12;
/** 浮动栏距视口边缘的最小边距 */
export const FLOATBAR_MARGIN = 8;
/** 缩放下限：画布 zoom 更小时浮动栏也按 50% 等效渲染 */
export const FLOATBAR_MIN_SCALE = 0.5;

export type FloatbarPlacement = "above" | "below";

export type FloatbarLayout = {
  /** 容器坐标（已按 scale 折算后的落点） */
  left: number;
  top: number;
  placement: FloatbarPlacement;
  /** transform: scale() 的取值（zoom 低于 50% 时钳制到 50%） */
  scale: number;
};

type Size = { width: number; height: number };

/** 容器坐标系下的矩形（如顶部主工具条占用区） */
export type ContainerRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** 浮动栏渲染缩放：跟随画布缩放，但钳制在 [50%, 100%] 保证可读 */
export const getFloatbarScale = (zoomValue: number) =>
  clamp(zoomValue, FLOATBAR_MIN_SCALE, 1);

const clampLeft = (left: number, width: number, containerWidth: number) =>
  clamp(
    left,
    FLOATBAR_MARGIN,
    Math.max(FLOATBAR_MARGIN, containerWidth - FLOATBAR_MARGIN - width),
  );

const rectsIntersect = (a: ContainerRect, b: ContainerRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * 选中态/模式条：锚定选区包围盒。barSize 为未缩放尺寸（transform: scale
 * 不影响 offsetWidth 量测），返回的 left/top 已按 scale 折算。
 */
export const getSelectionFloatbarLayout = ({
  selectionBounds,
  barSize,
  containerSize,
  appState,
  topUIRect,
}: {
  /** 选区包围盒（场景坐标） */
  selectionBounds: Bounds;
  /** 浮动栏未缩放尺寸 */
  barSize: Size;
  /** 容器（.layer-ui__wrapper）尺寸 */
  containerSize: Size;
  appState: Pick<
    AppState,
    "zoom" | "scrollX" | "scrollY" | "offsetLeft" | "offsetTop"
  >;
  /** 顶部 UI（主工具条）占用区（容器坐标），用于翻转避让；无则 null */
  topUIRect: ContainerRect | null;
}): FloatbarLayout => {
  const scale = getFloatbarScale(appState.zoom.value);
  const width = barSize.width * scale;
  const height = barSize.height * scale;

  const [x1, y1, x2, y2] = selectionBounds;
  const topLeft = sceneCoordsToViewportCoords(
    { sceneX: x1, sceneY: y1 },
    appState,
  );
  const bottomRight = sceneCoordsToViewportCoords(
    { sceneX: x2, sceneY: y2 },
    appState,
  );
  const containerX1 = topLeft.x - appState.offsetLeft;
  const containerY1 = topLeft.y - appState.offsetTop;
  const containerX2 = bottomRight.x - appState.offsetLeft;
  const containerY2 = bottomRight.y - appState.offsetTop;

  // 水平：包围盒上方居中，左右出界时向视口内收敛
  const centerX = (containerX1 + containerX2) / 2;
  const left = clampLeft(centerX - width / 2, width, containerSize.width);

  // 垂直：优先放在包围盒上方（间距 12）；上方不足（出视口或撞上顶部
  // 工具区）时翻到下方
  let placement: FloatbarPlacement = "above";
  let top = containerY1 - FLOATBAR_GAP - height;
  const collidesTopUI =
    topUIRect &&
    rectsIntersect(
      { left, top, right: left + width, bottom: top + height },
      topUIRect,
    );
  if (top < FLOATBAR_MARGIN || collidesTopUI) {
    placement = "below";
    top = containerY2 + FLOATBAR_GAP;
  }

  return { left, top, placement, scale };
};

/**
 * 无选中 · 工具配置态：固定于视口顶部居中（主工具条下方 12px）。
 */
export const getToolConfigFloatbarLayout = ({
  barSize,
  containerSize,
  zoomValue,
  topUIBottom,
}: {
  barSize: Size;
  containerSize: Size;
  zoomValue: number;
  /** 顶部主工具条下沿（容器坐标），未测得时为 0 */
  topUIBottom: number;
}): FloatbarLayout => {
  const scale = getFloatbarScale(zoomValue);
  const width = barSize.width * scale;

  const left = clampLeft(
    containerSize.width / 2 - width / 2,
    width,
    containerSize.width,
  );

  return { left, top: topUIBottom + FLOATBAR_GAP, placement: "below", scale };
};
