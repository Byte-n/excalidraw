import {
  getGridPoint,
  isSelectionLikeTool,
  KEYS,
  shouldMaintainAspectRatio,
  shouldResizeFromCenter,
  shouldRotateWithDiscreteAngle,
  updateActiveTool,
} from "@excalidraw/common";
import {
  cropElement,
  getElementsInResizingFrame,
  getFrameChildren,
  isElbowArrow,
  isFrameLikeElement,
  isImageElement,
  isInitializedImageElement,
  isNonDeletedElement,
  isStickyNoteElement,
  makeNextSelectedElementIds,
  transformElements,
  updateBoundElements,
} from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getSelectedElements } from "../../scene";
import { snapResizingElements } from "../../snapping";

import type { PointerDownState } from "../../types";

/** Selection state transitions used by pointer down/up handlers. */
export const clearSelectionIfNotUsingSelection = (app: any): void => {
  if (!isSelectionLikeTool(app.state.activeTool.type)) {
    app.setState({
      selectedElementIds: makeNextSelectedElementIds({}, app.state),
      selectedGroupIds: {},
      editingGroupId: null,
      activeEmbeddable: null,
    });
  }
};

export const isASelectedElement = (
  app: any,
  hitElement: { id: string } | null,
): boolean => !!hitElement && !!app.state.selectedElementIds[hitElement.id];

/** Restores selection tool state after a completed pointer gesture. */
export const restoreSelectionTool = (app: any) => {
  if (
    !app.isToolLocked() &&
    app.state.activeTool.type !== "freedraw" &&
    app.state.activeTool.type !== "bucketfill" &&
    (app.state.activeTool.type !== "lasso" ||
      app.state.activeTool.fromSelection)
  ) {
    app.setState(
      {
        newElement: null,
        suggestedBinding: null,
        activeTool: updateActiveTool(app.state, {
          type: app.state.preferredSelectionTool.type,
        }),
      },
      () => {
        app.cursor.reset();
        app.cursor.refreshHover();
      },
    );
  }
};

export const maybeHandleCrop = (
  app: any,
  pointerDownState: PointerDownState,
  event: MouseEvent | KeyboardEvent,
): boolean => {
  // to crop, we must already be in the cropping mode, where croppingElement has been set
  if (!app.state.croppingElementId) {
    return false;
  }

  const transformHandleType = pointerDownState.resize.handleType;
  const pointerCoords = pointerDownState.lastCoords;
  const [x, y] = getGridPoint(
    pointerCoords.x - pointerDownState.resize.offset.x,
    pointerCoords.y - pointerDownState.resize.offset.y,
    event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
  );

  const croppingElement = app.scene
    .getNonDeletedElementsMap()
    .get(app.state.croppingElementId);

  if (
    transformHandleType &&
    croppingElement &&
    isImageElement(croppingElement)
  ) {
    const croppingAtStateStart = pointerDownState.originalElements.get(
      croppingElement.id,
    );

    const image =
      isInitializedImageElement(croppingElement) &&
      app.imageCache.get(croppingElement.fileId)?.image;

    if (
      croppingAtStateStart &&
      isImageElement(croppingAtStateStart) &&
      image &&
      !(image instanceof Promise)
    ) {
      const [gridX, gridY] = getGridPoint(
        pointerCoords.x,
        pointerCoords.y,
        event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
      );

      const dragOffset = {
        x: gridX - pointerDownState.originInGrid.x,
        y: gridY - pointerDownState.originInGrid.y,
      };

      app.maybeCacheReferenceSnapPoints(event, [croppingElement]);

      const { snapOffset, snapLines } = snapResizingElements(
        [croppingElement],
        [croppingAtStateStart],
        app,
        event,
        dragOffset,
        transformHandleType,
      );

      app.scene.mutateElement(
        croppingElement,
        cropElement(
          croppingElement,
          app.scene.getNonDeletedElementsMap(),
          transformHandleType,
          image.naturalWidth,
          image.naturalHeight,
          x + snapOffset.x,
          y + snapOffset.y,
          event.shiftKey
            ? croppingAtStateStart.width / croppingAtStateStart.height
            : undefined,
        ),
      );

      updateBoundElements(croppingElement, app.scene);

      app.setState({
        isCropping: transformHandleType && transformHandleType !== "rotation",
        snapLines,
      });
    }

    return true;
  }

  return false;
};

export const maybeHandleResize = (
  app: any,
  pointerDownState: PointerDownState,
  event: MouseEvent | KeyboardEvent,
): boolean => {
  const selectedElements = app.scene.getSelectedElements(app.state);
  const selectedFrames = selectedElements.filter(isFrameLikeElement);

  const transformHandleType = pointerDownState.resize.handleType;

  if (
    // Frames cannot be rotated.
    (selectedFrames.length > 0 && transformHandleType === "rotation") ||
    // Elbow arrows cannot be transformed (resized or rotated).
    (selectedElements.length === 1 && isElbowArrow(selectedElements[0])) ||
    // Do not resize when in crop mode
    app.state.croppingElementId
  ) {
    return false;
  }

  app.activeResizeHandle =
    transformHandleType && transformHandleType !== "rotation"
      ? transformHandleType
      : null;
  app.setState({
    // TODO: rename app state field to "isScaling" to distinguish
    // it from the generic "isResizing" which includes scaling and
    // rotating
    isResizing: transformHandleType && transformHandleType !== "rotation",
    isRotating: transformHandleType === "rotation",
    activeEmbeddable: null,
  });
  const pointerCoords = pointerDownState.lastCoords;
  let [resizeX, resizeY] = getGridPoint(
    pointerCoords.x - pointerDownState.resize.offset.x,
    pointerCoords.y - pointerDownState.resize.offset.y,
    event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
  );

  const frameElementsOffsetsMap = new Map<
    string,
    {
      x: number;
      y: number;
    }
  >();

  selectedFrames.forEach((frame: any) => {
    const elementsInFrame = getFrameChildren(
      app.scene.getNonDeletedElements(),
      frame.id,
    );

    elementsInFrame.forEach((element: any) => {
      frameElementsOffsetsMap.set(frame.id + element.id, {
        x: element.x - frame.x,
        y: element.y - frame.y,
      });
    });
  });

  // check needed for avoiding flickering when a key gets pressed
  // during dragging
  if (!app.state.selectedElementsAreBeingDragged) {
    const [gridX, gridY] = getGridPoint(
      pointerCoords.x,
      pointerCoords.y,
      event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
    );

    const dragOffset = {
      x: gridX - pointerDownState.originInGrid.x,
      y: gridY - pointerDownState.originInGrid.y,
    };

    const originalElements = [...pointerDownState.originalElements.values()];

    app.maybeCacheReferenceSnapPoints(event, selectedElements);

    const { snapOffset, snapLines } = snapResizingElements(
      selectedElements,
      getSelectedElements(originalElements, app.state),
      app,
      event,
      dragOffset,
      transformHandleType,
    );

    resizeX += snapOffset.x;
    resizeY += snapOffset.y;

    app.setState({
      snapLines,
    });
  }

  // images are proportional by default, and so is a sticky note's corner
  // (its label's font ceiling scales with it); Shift frees them. A note's
  // edges stay free by default — Shift constrains them like any shape.
  const proportionalByDefault =
    selectedElements.some((element: any) => isImageElement(element)) ||
    (selectedElements.length === 1 &&
      isStickyNoteElement(selectedElements[0]) &&
      typeof transformHandleType === "string" &&
      transformHandleType.length === 2);

  if (
    transformElements(
      pointerDownState.originalElements,
      transformHandleType,
      selectedElements,
      app.scene,
      shouldRotateWithDiscreteAngle(event),
      shouldResizeFromCenter(event),
      proportionalByDefault
        ? !shouldMaintainAspectRatio(event)
        : shouldMaintainAspectRatio(event),
      resizeX,
      resizeY,
      pointerDownState.resize.center.x,
      pointerDownState.resize.center.y,
    )
  ) {
    const elementsToHighlight = new Set<NonDeletedExcalidrawElement>();
    selectedFrames.forEach((frame: any) => {
      getElementsInResizingFrame(
        app.scene.getNonDeletedElements(),
        frame,
        app.state,
        app.scene.getNonDeletedElementsMap(),
      ).forEach((element) => {
        if (isNonDeletedElement(element)) {
          elementsToHighlight.add(element);
        } else {
          // SAFETY: This should never happen, but log it just in case
          console.error(
            "[NONDELETED][INVARIANT] Skipped highlighting deleted element in resizing frame",
          );
        }
      });
    });

    app.setState({
      elementsToHighlight: [...elementsToHighlight],
    });

    return true;
  }
  return false;
};
