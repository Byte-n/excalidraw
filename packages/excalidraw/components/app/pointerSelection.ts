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

import {
  editGroupForSelectedElement,
  getCommonBounds,
  getElementWithTransformHandleType,
  getElementsInGroup,
  getResizeArrowDirection,
  getResizeOffsetXY,
  getTransformHandleTypeFromCoords,
  handleFocusPointPointerDown,
  isBindingElement,
  isElementInGroup,
  isEmbeddableElement,
  isLinearElement,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  LinearElementEditor,
  selectGroupsForSelectedElements,
} from "@excalidraw/element";

import { tupleToCoors } from "@excalidraw/common";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getSelectedElements } from "../../scene";
import { snapResizingElements } from "../../snapping";

import type { PointerDownState } from "../../types";

import type React from "react";

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

export const handleSelectionOnPointerDown = (
  app: any,
  event: React.PointerEvent<HTMLElement>,
  pointerDownState: PointerDownState,
): boolean => {
  if (isSelectionLikeTool(app.state.activeTool.type)) {
    const elements = app.scene.getNonDeletedElements();
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const selectedElements: any[] = app.scene.getSelectedElements(app.state);

    if (
      selectedElements.length === 1 &&
      !app.state.selectedLinearElement?.isEditing &&
      !isElbowArrow(selectedElements[0]) &&
      !(
        isLinearElement(selectedElements[0]) &&
        (app.editorInterface.userAgent.isMobileDevice ||
          (selectedElements[0] as any).points.length === 2)
      ) &&
      !(
        app.state.selectedLinearElement &&
        app.state.selectedLinearElement.hoverPointIndex !== -1
      )
    ) {
      const elementWithTransformHandleType = getElementWithTransformHandleType(
        elements,
        app.state,
        pointerDownState.origin.x,
        pointerDownState.origin.y,
        app.state.zoom,
        event.pointerType,
        app.scene.getNonDeletedElementsMap(),
        app.editorInterface,
      );
      if (elementWithTransformHandleType != null) {
        if (elementWithTransformHandleType.transformHandleType === "rotation") {
          app.setState({
            resizingElement: elementWithTransformHandleType.element,
          });
          pointerDownState.resize.handleType =
            elementWithTransformHandleType.transformHandleType;
        } else if (app.state.croppingElementId) {
          pointerDownState.resize.handleType =
            elementWithTransformHandleType.transformHandleType;
        } else {
          app.setState({
            resizingElement: elementWithTransformHandleType.element,
          });
          pointerDownState.resize.handleType =
            elementWithTransformHandleType.transformHandleType;
        }
      }
    } else if (selectedElements.length > 1) {
      pointerDownState.resize.handleType = getTransformHandleTypeFromCoords(
        getCommonBounds(
          selectedElements.filter(
            (element: any) =>
              !app.scene.getMindmapHiddenElementIds().has(element.id),
          ),
        ),
        pointerDownState.origin.x,
        pointerDownState.origin.y,
        app.state.zoom,
        event.pointerType,
        app.editorInterface,
      );
      if (
        pointerDownState.resize.handleType === "rotation" &&
        selectedElements.some(
          (element: any) =>
            isMindmapNodeElement(element) || isMindmapEdgeElement(element),
        )
      ) {
        pointerDownState.resize.handleType = false;
      }
    }
    if (pointerDownState.resize.handleType) {
      pointerDownState.resize.isResizing = true;
      pointerDownState.resize.offset = tupleToCoors(
        getResizeOffsetXY(
          pointerDownState.resize.handleType,
          selectedElements,
          elementsMap,
          pointerDownState.origin.x,
          pointerDownState.origin.y,
        ),
      );
      if (
        selectedElements.length === 1 &&
        isLinearElement(selectedElements[0]) &&
        selectedElements[0].points.length === 2
      ) {
        pointerDownState.resize.arrowDirection = getResizeArrowDirection(
          pointerDownState.resize.handleType,
          selectedElements[0],
        );
      }
    } else {
      if (app.state.selectedLinearElement) {
        const linearElementEditor = app.state.selectedLinearElement;
        const ret = LinearElementEditor.handlePointerDown(
          event,
          app,
          app.store,
          pointerDownState.origin,
          linearElementEditor,
          app.scene,
        );

        if (ret.hitElement) {
          pointerDownState.hit.element = ret.hitElement;
        }
        pointerDownState.hit.arrowLabel = ret.hitBoundText;
        if (ret.linearElementEditor) {
          app.setState({ selectedLinearElement: ret.linearElementEditor });
        }
        if (ret.didAddPoint) {
          return true;
        }

        // Also check at current pointer position if focus point is being hovered
        // (in case we're clicking directly without a prior move event)
        const elementsMap = app.scene.getNonDeletedElementsMap();
        const arrow = LinearElementEditor.getElement(
          linearElementEditor.elementId,
          elementsMap,
        ) as any;

        if (arrow && isBindingElement(arrow)) {
          const {
            hitFocusPoint,
            pointerOffset,
            arrowOtherEndpointInitialBinding,
          } = handleFocusPointPointerDown(
            arrow,
            pointerDownState,
            elementsMap,
            app.state,
          );

          // If focus point is hit, update state and prevent element selection
          if (hitFocusPoint) {
            app.setState({
              selectedLinearElement: {
                ...linearElementEditor,
                hoveredFocusPointBinding: hitFocusPoint,
                draggedFocusPointBinding: hitFocusPoint,
                pointerOffset,
                initialState: {
                  ...linearElementEditor.initialState,
                  arrowOtherEndpointInitialBinding,
                },
              },
            });
            return false;
          }
        }
      }

      const allHitElements = app.getElementsAtPosition(
        pointerDownState.origin.x,
        pointerDownState.origin.y,
        {
          includeLockedElements: true,
        },
      );
      const unlockedHitElements = allHitElements.filter((e: any) => !e.locked);

      // Cannot set preferSelected in getElementAtPosition as we do in pointer move; consider:
      // A & B: both unlocked, A selected, B on top, A & B overlaps in some way
      // we want to select B when clicking on the overlapping area
      const hitElementMightBeLocked = app.getElementAtPosition(
        pointerDownState.origin.x,
        pointerDownState.origin.y,
        {
          allHitElements,
        },
      );

      if (
        !hitElementMightBeLocked ||
        hitElementMightBeLocked.id !== app.state.activeLockedId
      ) {
        app.setState({
          activeLockedId: null,
        });
      }

      if (
        hitElementMightBeLocked &&
        hitElementMightBeLocked.locked &&
        !unlockedHitElements.some(
          (el: any) => app.state.selectedElementIds[el.id],
        )
      ) {
        pointerDownState.hit.element = null;
      } else {
        // hitElement may already be set above, so check first
        pointerDownState.hit.element =
          pointerDownState.hit.element ??
          app.getElementAtPosition(
            pointerDownState.origin.x,
            pointerDownState.origin.y,
          );
      }

      app.hitLinkElement = app.getElementLinkAtPosition(
        pointerDownState.origin,
        hitElementMightBeLocked,
      );

      if (app.hitLinkElement) {
        return true;
      }

      if (
        app.state.croppingElementId &&
        pointerDownState.hit.element?.id !== app.state.croppingElementId
      ) {
        app.finishImageCropping();
      }

      if (pointerDownState.hit.element) {
        // Early return if pointer is hitting link icon
        const hitLinkElement = app.getElementLinkAtPosition(
          {
            x: pointerDownState.origin.x,
            y: pointerDownState.origin.y,
          },
          pointerDownState.hit.element,
        );
        if (hitLinkElement) {
          return false;
        }
      }

      // For overlapped elements one position may hit
      // multiple elements
      pointerDownState.hit.allHitElements = unlockedHitElements;

      const hitElement = pointerDownState.hit.element;
      const someHitElementIsSelected =
        pointerDownState.hit.allHitElements.some((element) =>
          app.isASelectedElement(element),
        ) ||
        // the selected linear element's point handles, midpoint knob and
        // label extend beyond its own hit area, so a hit reported by
        // `LinearElementEditor.handlePointerDown` counts even when the
        // position-based hit test above missed the element
        (hitElement !== null && app.isASelectedElement(hitElement));
      if (
        (hitElement === null || !someHitElementIsSelected) &&
        !event.shiftKey &&
        !pointerDownState.hit.hasHitCommonBoundingBoxOfSelectedElements &&
        (!app.state.selectedLinearElement?.isEditing ||
          (hitElement &&
            hitElement?.id !== app.state.selectedLinearElement?.elementId))
      ) {
        pointerDownState.hit.replacedSelection = true;
        app.clearSelection(hitElement);
      }

      if (app.state.selectedLinearElement?.isEditing) {
        app.setState((prevState: any) => ({
          selectedLinearElement: prevState.selectedLinearElement
            ? {
                ...prevState.selectedLinearElement,
                isEditing:
                  !!hitElement &&
                  hitElement.id === app.state.selectedLinearElement?.elementId,
              }
            : null,
          selectedElementIds: prevState.selectedLinearElement
            ? makeNextSelectedElementIds(
                {
                  [prevState.selectedLinearElement.elementId]: true,
                },
                app.state,
              )
            : makeNextSelectedElementIds({}, prevState),
        }));
        // If we click on something
      } else if (hitElement != null) {
        // == deep selection ==
        // on CMD/CTRL, drill down to hit element regardless of groups etc.
        if (event[KEYS.CTRL_OR_CMD]) {
          if (event.altKey) {
            // ctrl + alt means we're lasso selecting - start lasso trail and switch to lasso tool

            // Close any open dialogs that might interfere with lasso selection
            if (app.state.openDialog?.name === "elementLinkSelector") {
              app.setOpenDialog(null);
            }
            app.lassoTrail.startPath(
              pointerDownState.origin.x,
              pointerDownState.origin.y,
              event.shiftKey,
            );
            app.setActiveTool({ type: "lasso", fromSelection: true });
            return false;
          }
          if (!app.state.selectedElementIds[hitElement.id]) {
            pointerDownState.hit.wasAddedToSelection = true;
          }
          app.setState((prevState: any) => ({
            ...editGroupForSelectedElement(prevState, hitElement),
            previousSelectedElementIds: app.state.selectedElementIds,
          }));
          // mark as not completely handled so as to allow dragging etc.
          return false;
        }

        // deselect if item is selected
        // if shift is not clicked, app will always return true
        // otherwise, it will trigger selection based on current
        // state of the box
        if (!app.state.selectedElementIds[hitElement.id]) {
          // if we are currently editing a group, exiting editing mode and deselect the group.
          if (
            app.state.editingGroupId &&
            !isElementInGroup(hitElement, app.state.editingGroupId)
          ) {
            app.setState({
              selectedElementIds: makeNextSelectedElementIds({}, app.state),
              selectedGroupIds: {},
              editingGroupId: null,
              activeEmbeddable: null,
            });
          }

          // Add hit element to selection. At app point if we're not holding
          // SHIFT the previously selected element(s) were deselected above
          // (make sure you use setState updater to use latest state)
          // With shift-selection, we want to make sure that frames and their containing
          // elements are not selected at the same time.
          if (
            !someHitElementIsSelected &&
            !pointerDownState.hit.hasHitCommonBoundingBoxOfSelectedElements
          ) {
            app.setState((prevState: any) => {
              let nextSelectedElementIds: { [id: string]: true } = {
                ...prevState.selectedElementIds,
                [hitElement.id]: true,
              };

              const previouslySelectedElements: ExcalidrawElement[] = [];

              Object.keys(prevState.selectedElementIds).forEach((id) => {
                const element = app.scene.getElement(id);
                element && previouslySelectedElements.push(element);
              });

              // if hitElement is frame-like, deselect all of its elements
              // if they are selected
              if (isFrameLikeElement(hitElement)) {
                getFrameChildren(
                  previouslySelectedElements,
                  hitElement.id,
                ).forEach((element) => {
                  delete nextSelectedElementIds[element.id];
                });
              } else if (hitElement.frameId) {
                // if hitElement is in a frame and its frame has been selected
                // disable selection for the given element
                if (nextSelectedElementIds[hitElement.frameId]) {
                  delete nextSelectedElementIds[hitElement.id];
                }
              } else {
                // hitElement is neither a frame nor an element in a frame
                // but since hitElement could be in a group with some frames
                // app means selecting hitElement will have the frames selected as well
                // because we want to keep the invariant:
                // - frames and their elements are not selected at the same time
                // we deselect elements in those frames that were previously selected

                const groupIds = hitElement.groupIds;
                const framesInGroups = new Set(
                  groupIds
                    .flatMap((gid) =>
                      getElementsInGroup(
                        app.scene.getNonDeletedElements(),
                        gid,
                      ),
                    )
                    .filter((element) => isFrameLikeElement(element))
                    .map((frame) => frame.id),
                );

                if (framesInGroups.size > 0) {
                  previouslySelectedElements.forEach((element) => {
                    if (
                      element.frameId &&
                      framesInGroups.has(element.frameId)
                    ) {
                      // deselect element and groups containing the element
                      delete nextSelectedElementIds[element.id];
                      element.groupIds
                        .flatMap((gid) =>
                          getElementsInGroup(
                            app.scene.getNonDeletedElements(),
                            gid,
                          ),
                        )
                        .forEach((element) => {
                          delete nextSelectedElementIds[element.id];
                        });
                    }
                  });
                }
              }

              // Finally, in shape selection mode, we'd like to
              // keep only one shape or group selected at a time.
              // This means, if the hitElement is a different shape or group
              // than the previously selected ones, we deselect the previous ones
              // and select the hitElement
              if (prevState.openDialog?.name === "elementLinkSelector") {
                if (
                  !hitElement.groupIds.some(
                    (gid) => prevState.selectedGroupIds[gid],
                  )
                ) {
                  nextSelectedElementIds = {
                    [hitElement.id]: true,
                  };
                }
              }

              return {
                ...selectGroupsForSelectedElements(
                  {
                    editingGroupId: prevState.editingGroupId,
                    selectedElementIds: nextSelectedElementIds,
                  },
                  app.scene.getNonDeletedElements(),
                  prevState,
                  app,
                ),
                showHyperlinkPopup:
                  hitElement.link || isEmbeddableElement(hitElement)
                    ? "info"
                    : false,
              };
            });
            pointerDownState.hit.wasAddedToSelection = true;
          }
        }
      }

      app.setState({
        previousSelectedElementIds: app.state.selectedElementIds,
      });
    }
  }
  return false;
};
