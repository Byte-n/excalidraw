import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { getElementAbsoluteCoords } from "@excalidraw/element";

import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { useExcalidrawAppState } from "../components/App";

import "./ElementCanvasButtons.scss";

import type { AppState } from "../types";

const CONTAINER_PADDING = 5;

type ElementCanvasButtonsAnchor = "top-right" | "bottom-right";

const getContainerCoords = (
  element: NonDeletedExcalidrawElement,
  appState: AppState,
  elementsMap: ElementsMap,
  anchor: ElementCanvasButtonsAnchor = "top-right",
) => {
  const [, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
  const sceneX = x2;
  const sceneY = anchor === "bottom-right" ? y2 : y1;
  const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
    { sceneX, sceneY },
    appState,
  );
  const x = viewportX - appState.offsetLeft + 10;
  const y = viewportY - appState.offsetTop;
  return { x, y };
};

export const ElementCanvasButtons = ({
  children,
  element,
  elementsMap,
  anchor,
}: {
  children: React.ReactNode;
  element: NonDeletedExcalidrawElement;
  elementsMap: ElementsMap;
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

  const { x, y } = getContainerCoords(element, appState, elementsMap, anchor);

  return (
    <div
      className="excalidraw-canvas-buttons"
      style={{
        top: `${y}px`,
        left: `${x}px`,
        // width: CONTAINER_WIDTH,
        padding: CONTAINER_PADDING,
      }}
    >
      {children}
    </div>
  );
};
