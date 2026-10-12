import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { getElementAbsoluteCoords } from "@excalidraw/element";

import type {
  ElementsMap,
  MindmapLayoutDirection,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { useExcalidrawAppState } from "../components/App";

import "./ElementCanvasButtons.scss";

import type { AppState } from "../types";

const CONTAINER_PADDING = 5;

/** 思维导图 + 按钮直径（CSS px，容器随缩放整体放大） */
export const MINDMAP_BUTTON_SIZE = 16;
/** 按钮中心相对节点边缘的外偏（场景单位，随缩放换算） */
const MINDMAP_BUTTON_OFFSET = 14;
/** 折叠徽标（r9，+12）外缘 + 间距 → 折叠时子侧 + 再外移 */
const MINDMAP_BUTTON_OFFSET_AFTER_BADGE = 36;
/** 「−」按钮（r7，+10）外缘 + 间距 → 有子节点展开时子侧 + 再外移 */
const MINDMAP_BUTTON_OFFSET_AFTER_MINUS = 32;

type ElementCanvasButtonsAnchor =
  | "top-right"
  | "bottom-right"
  | "mindmap-child"
  | "mindmap-sibling";

const getContainerCoords = (
  element: NonDeletedExcalidrawElement,
  appState: AppState,
  elementsMap: ElementsMap,
  layoutDirection?: MindmapLayoutDirection,
  anchor: ElementCanvasButtonsAnchor = "top-right",
  mindmapChildOffset: number = MINDMAP_BUTTON_OFFSET,
) => {
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
  if (anchor === "mindmap-child" || anchor === "mindmap-sibling") {
    const childOffset = mindmapChildOffset;
    const isVertical =
      layoutDirection === "top-to-bottom" ||
      layoutDirection === "bottom-to-top";
    const isReverse =
      layoutDirection === "right-to-left" ||
      layoutDirection === "bottom-to-top";
    let sceneX: number;
    let sceneY: number;
    if (anchor === "mindmap-child") {
      // 子侧：布局方向远边中点；有折叠 affordance 时外移让位
      sceneX = isVertical
        ? (x1 + x2) / 2
        : isReverse
        ? x1 - childOffset
        : x2 + childOffset;
      sceneY = isVertical
        ? isReverse
          ? y1 - childOffset
          : y2 + childOffset
        : (y1 + y2) / 2;
    } else {
      // 同级侧：垂直于布局方向的远边中点（横向布局取下方，纵向布局取右方）
      sceneX = isVertical ? x2 + MINDMAP_BUTTON_OFFSET : (x1 + x2) / 2;
      sceneY = isVertical ? (y1 + y2) / 2 : y2 + MINDMAP_BUTTON_OFFSET;
    }
    const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
      { sceneX, sceneY },
      appState,
    );
    return {
      x: viewportX - appState.offsetLeft,
      y: viewportY - appState.offsetTop,
      isVertical,
      isReverse,
      isMindmap: true,
    };
  }
  const isVertical =
    layoutDirection === "top-to-bottom" || layoutDirection === "bottom-to-top";
  const isReverse =
    layoutDirection === "right-to-left" || layoutDirection === "bottom-to-top";
  const sceneX = isVertical ? x1 : isReverse ? x1 : x2;
  const sceneY = isVertical
    ? isReverse
      ? y1
      : y2
    : anchor === "bottom-right"
    ? y2
    : y1;
  const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
    { sceneX, sceneY },
    appState,
  );
  const x = viewportX - appState.offsetLeft + 10;
  const y = viewportY - appState.offsetTop;
  return { x, y, isVertical, isReverse, isMindmap: false };
};

export const ElementCanvasButtons = ({
  children,
  element,
  elementsMap,
  layoutDirection,
  anchor,
}: {
  children: React.ReactNode;
  element: NonDeletedExcalidrawElement;
  elementsMap: ElementsMap;
  layoutDirection?: MindmapLayoutDirection;
  anchor?: ElementCanvasButtonsAnchor;
}) => {
  const appState = useExcalidrawAppState();

  if (
    appState.contextMenu ||
    appState.newElement ||
    appState.resizingElement ||
    appState.isRotating ||
    appState.openMenu ||
    appState.viewModeEnabled
  ) {
    return null;
  }

  // 子侧 + 让位折叠 affordance：折叠徽标（常驻）或悬停/选中时的「−」
  let mindmapChildOffset: number | undefined;
  if (element.type === "mindmap-node") {
    if (element.collapsed) {
      mindmapChildOffset = MINDMAP_BUTTON_OFFSET_AFTER_BADGE;
    } else if (
      [...elementsMap.values()].some(
        (candidate) =>
          candidate.type === "mindmap-node" &&
          candidate.parentId === element.id,
      )
    ) {
      mindmapChildOffset = MINDMAP_BUTTON_OFFSET_AFTER_MINUS;
    }
  }

  const { x, y, isVertical, isReverse, isMindmap } = getContainerCoords(
    element,
    appState,
    elementsMap,
    layoutDirection,
    anchor,
    mindmapChildOffset,
  );

  if (isMindmap) {
    // 16px 圆钮，按场景坐标缩放（与节点同比例）
    return (
      <div
        className="excalidraw-canvas-buttons excalidraw-canvas-buttons--mindmap"
        style={{
          top: `${y - MINDMAP_BUTTON_SIZE / 2}px`,
          left: `${x - MINDMAP_BUTTON_SIZE / 2}px`,
          transform: `scale(${appState.zoom.value})`,
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className="excalidraw-canvas-buttons"
      style={{
        top: `${y}px`,
        left: `${x}px`,
        flexDirection: isVertical ? "row" : "column",
        transform: isReverse
          ? isVertical
            ? "translateY(-100%)"
            : "translateX(-100%)"
          : undefined,
        // width: CONTAINER_WIDTH,
        padding: CONTAINER_PADDING,
      }}
    >
      {children}
    </div>
  );
};
