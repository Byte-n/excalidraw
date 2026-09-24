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

const getContainerCoords = (
  element: NonDeletedExcalidrawElement,
  appState: AppState,
  elementsMap: ElementsMap,
  layoutDirection?: MindmapLayoutDirection,
) => {
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
  const isVertical =
    layoutDirection === "top-to-bottom" || layoutDirection === "bottom-to-top";
  const isReverse =
    layoutDirection === "right-to-left" || layoutDirection === "bottom-to-top";
  const sceneX = isVertical ? x1 : isReverse ? x1 : x2;
  const sceneY = isVertical ? (isReverse ? y1 : y2) : y1;
  const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
    { sceneX, sceneY },
    appState,
  );
  const x = viewportX - appState.offsetLeft + 10;
  const y = viewportY - appState.offsetTop;
  return { x, y, isVertical, isReverse };
};

export const ElementCanvasButtons = ({
  children,
  element,
  elementsMap,
  layoutDirection,
}: {
  children: React.ReactNode;
  element: NonDeletedExcalidrawElement;
  elementsMap: ElementsMap;
  layoutDirection?: MindmapLayoutDirection;
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

  const { x, y, isVertical, isReverse } = getContainerCoords(
    element,
    appState,
    elementsMap,
    layoutDirection,
  );

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
