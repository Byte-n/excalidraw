import {
  getElementAbsoluteCoords,
  getContainingFrame,
  hasBoundingBox,
  hitElementBoundText,
  hitElementBoundingBox,
  hitElementItself,
  isArrowElement,
  isFrameLikeElement,
  isIframeLikeElement,
  isNonDeletedElement,
  isTextBindableContainer,
  isTextElement,
  isCursorInFrame,
} from "@excalidraw/element";

import { DEFAULT_COLLISION_THRESHOLD } from "@excalidraw/common";

import { pointFrom } from "@excalidraw/math";

import type { Scene } from "@excalidraw/element";
import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  ExcalidrawIframeLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
  Ordered,
} from "@excalidraw/element/types";
import type { EditorInterface } from "@excalidraw/common";

import type { AppState, FrameNameBoundsCache } from "../../types";

/** Narrow dependency surface for the high-frequency hit testing path. */
export type HitTestApp = {
  state: AppState;
  scene: Pick<
    Scene,
    | "getNonDeletedElements"
    | "getNonDeletedElementsMap"
    | "getMindmapHiddenElementIds"
    | "getSelectedElements"
  >;
  editorInterface: EditorInterface;
  frameNameBoundsCache: FrameNameBoundsCache;
  hitElement: (
    x: number,
    y: number,
    element: NonDeletedExcalidrawElement,
    considerBoundingBox?: boolean,
  ) => boolean;
};

export const getElementHitThreshold = (
  app: Pick<HitTestApp, "state">,
  element: ExcalidrawElement,
) =>
  Math.max(
    element.strokeWidth / 2 + 0.1,
    0.85 * (DEFAULT_COLLISION_THRESHOLD / app.state.zoom.value),
  );

export const hitElement = (
  app: HitTestApp,
  x: number,
  y: number,
  element: NonDeletedExcalidrawElement,
  considerBoundingBox = true,
) => {
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const threshold = getElementHitThreshold(app, element);

  if (
    considerBoundingBox &&
    app.state.selectedElementIds[element.id] &&
    hasBoundingBox([element], app.state, app.editorInterface) &&
    hitElementBoundingBox(pointFrom(x, y), element, elementsMap, threshold)
  ) {
    return true;
  }

  if (hitElementBoundText(pointFrom(x, y), element, elementsMap)) {
    return true;
  }

  return hitElementItself({
    point: pointFrom(x, y),
    element,
    threshold,
    elementsMap,
    frameNameBound: isFrameLikeElement(element)
      ? app.frameNameBoundsCache.get(element)
      : null,
  });
};

export const getElementsAtPosition = (
  app: HitTestApp,
  x: number,
  y: number,
  opts?: {
    includeBoundTextElement?: boolean;
    includeLockedElements?: boolean;
  },
): NonDeleted<ExcalidrawElement>[] => {
  const iframeLikes: Ordered<NonDeleted<ExcalidrawIframeLikeElement>>[] = [];
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const hiddenMindmapElementIds = app.scene.getMindmapHiddenElementIds();

  const elements = (
    opts?.includeBoundTextElement && opts?.includeLockedElements
      ? app.scene.getNonDeletedElements()
      : app.scene
          .getNonDeletedElements()
          .filter(
            (element) =>
              (opts?.includeLockedElements || !element.locked) &&
              (opts?.includeBoundTextElement ||
                !(isTextElement(element) && element.containerId)),
          )
  )
    .filter(
      (element) =>
        !hiddenMindmapElementIds.has(element.id) &&
        app.hitElement(x, y, element),
    )
    .filter((element) => {
      const containingFrame = getContainingFrame(element, elementsMap);
      if (containingFrame && !isNonDeletedElement(containingFrame)) {
        console.error("[NONDELETED][INVARIANT] Containing frame is deleted");
      }
      return containingFrame &&
        app.state.frameRendering.enabled &&
        app.state.frameRendering.clip &&
        !isIframeLikeElement(element)
        ? isCursorInFrame(
            { x, y },
            containingFrame as NonDeleted<ExcalidrawFrameLikeElement>,
            elementsMap,
          )
        : true;
    })
    .filter((element) => {
      if (isIframeLikeElement(element)) {
        iframeLikes.push(element);
        return false;
      }
      return true;
    })
    .concat(iframeLikes) as NonDeleted<ExcalidrawElement>[];

  return elements;
};

export const getElementAtPosition = (
  app: HitTestApp,
  x: number,
  y: number,
  opts?:
    | (
        | {
            includeBoundTextElement?: boolean;
            includeLockedElements?: boolean;
          }
        | { allHitElements: NonDeleted<ExcalidrawElement>[] }
      ) & {
        preferSelected?: boolean;
      },
): NonDeleted<ExcalidrawElement> | null => {
  const allHitElements =
    opts && "allHitElements" in opts
      ? opts.allHitElements || []
      : getElementsAtPosition(app, x, y, {
          includeBoundTextElement: opts?.includeBoundTextElement,
          includeLockedElements: opts?.includeLockedElements,
        });

  if (allHitElements.length > 1) {
    if (opts?.preferSelected) {
      for (let index = allHitElements.length - 1; index > -1; index--) {
        if (app.state.selectedElementIds[allHitElements[index].id]) {
          return allHitElements[index];
        }
      }
    }
    const elementWithHighestZIndex = allHitElements[allHitElements.length - 1];
    return hitElementItself({
      point: pointFrom(x, y),
      element: elementWithHighestZIndex,
      threshold: getElementHitThreshold(app, elementWithHighestZIndex) / 2,
      elementsMap: app.scene.getNonDeletedElementsMap(),
      frameNameBound: isFrameLikeElement(elementWithHighestZIndex)
        ? app.frameNameBoundsCache.get(elementWithHighestZIndex)
        : null,
    })
      ? elementWithHighestZIndex
      : allHitElements[allHitElements.length - 2];
  }
  return allHitElements.length === 1 ? allHitElements[0] : null;
};

export const getTextBindableContainerAtPosition = (
  app: HitTestApp,
  x: number,
  y: number,
) => {
  const elements = app.scene.getNonDeletedElements();
  const selectedElements = app.scene.getSelectedElements(app.state);
  if (selectedElements.length === 1) {
    return isTextBindableContainer(selectedElements[0], false)
      ? selectedElements[0]
      : null;
  }

  let hitElement: NonDeleted<ExcalidrawElement> | null = null;
  for (let index = elements.length - 1; index >= 0; --index) {
    const element = elements[index];
    if (element.isDeleted) {
      continue;
    }
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(
      element,
      app.scene.getNonDeletedElementsMap(),
    );
    if (
      isArrowElement(element) &&
      hitElementItself({
        point: pointFrom(x, y),
        element,
        elementsMap: app.scene.getNonDeletedElementsMap(),
        threshold: getElementHitThreshold(app, element),
      })
    ) {
      hitElement = element;
      break;
    } else if (x1 < x && x < x2 && y1 < y && y < y2) {
      if (isFrameLikeElement(element)) {
        continue;
      }
      hitElement = element;
      break;
    }
  }

  return isTextBindableContainer(hitElement, false) ? hitElement : null;
};
