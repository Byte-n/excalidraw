import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import { clamp } from "@excalidraw/math";

import type { Bounds } from "@excalidraw/common";

import type { AppState } from "../../types";

/**
 * 浮动工具栏（tb-floatbar）定位规则，设计稿
 * docs/design-ui/excalidraw-canvas-toolbar.html §2「交互通则」：
 * 选区包围盒上方居中（设计稿为 12px，实测偏近，此处取 16px，见
 * FLOATBAR_GAP）；上方空间不足翻到下方；左右出界时
 * 水平收敛（边距 8）；尺寸固定不随画布缩放变化（始终按 100% 渲染），
 * 仅位置随缩放/滚动换算。
 *
 * 坐标换算复用 ElementCanvasButtons/UnlockPopup 的既有路径：
 * sceneCoordsToViewportCoords 得到视口坐标，再减 offsetLeft/offsetTop
 * 换算到容器（.layer-ui__wrapper）坐标系。
 */

/** 浮动栏与选区包围盒的垂直间距（上/下方翻置同值） */
export const FLOATBAR_GAP = 16;
/** 工具配置态（无作用对象）浮动栏与顶部主工具条的间距 */
export const FLOATBAR_TOP_UI_GAP = 12;
/** 浮动栏距视口边缘的最小边距 */
export const FLOATBAR_MARGIN = 8;

export type FloatbarPlacement = "above" | "below";

export type FloatbarLayout = {
  /** 容器坐标 */
  left: number;
  top: number;
  placement: FloatbarPlacement;
};

type Size = { width: number; height: number };

/** 容器坐标系下的矩形（如顶部主工具条占用区） */
export type ContainerRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const clampLeft = (left: number, width: number, containerWidth: number) =>
  clamp(
    left,
    FLOATBAR_MARGIN,
    Math.max(FLOATBAR_MARGIN, containerWidth - FLOATBAR_MARGIN - width),
  );

const rectsIntersect = (a: ContainerRect, b: ContainerRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * 选中态/模式条：锚定选区包围盒。
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
  /** 浮动栏尺寸（固定 100%） */
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
  const { width, height } = barSize;

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

  // 垂直：优先放在包围盒上方（间距 FLOATBAR_GAP）；上方不足（出视口或
  // 撞上顶部工具区）时翻到下方
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

  return { left, top, placement };
};

/**
 * 无选中 · 工具配置态：固定于视口顶部居中（主工具条下方 12px）。
 */
export const getToolConfigFloatbarLayout = ({
  barSize,
  containerSize,
  topUIBottom,
}: {
  barSize: Size;
  containerSize: Size;
  /** 顶部主工具条下沿（容器坐标），未测得时为 0 */
  topUIBottom: number;
}): FloatbarLayout => {
  const { width } = barSize;

  const left = clampLeft(
    containerSize.width / 2 - width / 2,
    width,
    containerSize.width,
  );

  return { left, top: topUIBottom + FLOATBAR_TOP_UI_GAP, placement: "below" };
};
