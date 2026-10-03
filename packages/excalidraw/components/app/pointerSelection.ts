import { flushSync } from "react-dom";
import { pointFrom, pointDistance } from "@excalidraw/math";
import {
  CURSOR_TYPE,
  DEFAULT_STROKE_STREAMLINE,
  DEFAULT_STROKE_STREAMLINE_PRECISE,
  DEFAULT_TRANSFORM_HANDLE_SPACING,
  FRAME_STYLE,
  LINE_CONFIRM_THRESHOLD,
  ROUNDNESS,
  DEFAULT_COLLISION_THRESHOLD,
  ARROW_TYPE,
  viewportCoordsToSceneCoords,
  invariant,
  getFeatureFlag,
} from "@excalidraw/common";
import {
  getHoveredElementForBinding,
  isBindingEnabled,
  newFrameElement,
  newFreeDrawElement,
  newEmbeddableElement,
  newMagicFrameElement,
  newStickyNoteElement,
  newArrowElement,
  newElement,
  newLinearElement,
  hasBoundTextElement,
  isPathALoop,
  bindOrUnbindBindingElement,
  isPointInElement,
  getSnapOutlineMidPoint,
  getBindingStrategyForDraggingBindingElementEndpoints,
} from "@excalidraw/element";

import { TOOL_TYPE, distance } from "@excalidraw/common";
import { dragNewElement, isTableElement } from "@excalidraw/element";

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
  isCompositeShapeElement,
  LinearElementEditor,
  selectGroupsForSelectedElements,
} from "@excalidraw/element";

import { tupleToCoors } from "@excalidraw/common";

import type {
  ExcalidrawFreeDrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTableElement,
  NonDeleted,
  ExcalidrawTextContainer,
  BaseShapeId,
} from "@excalidraw/element/types";
import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { actionFinalize } from "../../actions";

import { snapNewElement } from "../../snapping";

import { getSelectedElements } from "../../scene";
import { snapResizingElements } from "../../snapping";

import * as tableController from "./table";

import {
  getCompositeControlPointGlobal,
  hitCompositeControlPoint,
} from "./compositeShapeControls";

import type { ToolType } from "../../types";

import type App from "../App";

import type { PointerDownState } from "../../types";

import type React from "react";

type PointerApp = Pick<App, keyof App> & Record<string, any>;

/** Selection state transitions used by pointer down/up handlers. */
export const clearSelectionIfNotUsingSelection = (app: PointerApp): void => {
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
  app: PointerApp,
  hitElement: { id: string } | null,
): boolean => !!hitElement && !!app.state.selectedElementIds[hitElement.id];

/** Restores selection tool state after a completed pointer gesture. */
export const restoreSelectionTool = (app: PointerApp) => {
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
  app: PointerApp,
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
  app: PointerApp,
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
  app: PointerApp,
  event: React.PointerEvent<HTMLElement>,
  pointerDownState: PointerDownState,
): boolean => {
  if (isSelectionLikeTool(app.state.activeTool.type)) {
    const elements = app.scene.getNonDeletedElements();
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const selectedElements: any[] = app.scene.getSelectedElements(app.state);

    if (
      selectedElements.length === 1 &&
      isCompositeShapeElement(selectedElements[0]) &&
      !selectedElements[0].locked &&
      !app.state.viewModeEnabled &&
      !app.state.editingTextElement &&
      !app.state.croppingElementId &&
      !event.shiftKey &&
      !event[KEYS.CTRL_OR_CMD]
    ) {
      const element = selectedElements[0];
      const point = hitCompositeControlPoint(
        element,
        pointerDownState.origin.x,
        pointerDownState.origin.y,
        app.state.zoom.value,
        event.pointerType,
      );
      if (point) {
        const [x, y] = getCompositeControlPointGlobal(element, point);
        pointerDownState.compositeControl.active = {
          elementId: element.id,
          kind: point.kind,
          offset: {
            x: pointerDownState.origin.x - x,
            y: pointerDownState.origin.y - y,
          },
          hasChanged: false,
        };
        pointerDownState.hit.element = element;
        pointerDownState.hit.allHitElements = [element];
        return false;
      }
    }

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
            isMindmapNodeElement(element) ||
            isMindmapEdgeElement(element) ||
            isTableElement(element),
        )
      ) {
        pointerDownState.resize.handleType = false;
      }
    }
    let tableScaleGestureArmed = false;
    if (pointerDownState.resize.handleType) {
      const handleType = pointerDownState.resize.handleType;
      if (
        selectedElements.length === 1 &&
        isTableElement(selectedElements[0])
      ) {
        // 接管为整表缩放手势：四角等比缩放、四边单轴拉伸（phase-1.md:99）。
        // 每帧从 originalElements 快照 × 指针倍率重算预览，释放时一次性
        // 持久化文字模式并捕获一次。多选含表格不走这里：通用 resize 的
        // table 分支已能保持网格不变量与语义子树同步（phase-1.2.md）。
        tableScaleGestureArmed = tableController.maybeArmTableScaleGesture(
          app,
          pointerDownState,
          selectedElements[0] as NonDeleted<ExcalidrawTableElement>,
          handleType,
        );
        // The table's frame scaling owns every handle; its side borders
        // belong to the row/column gesture.
        pointerDownState.resize.handleType = false;
      } else {
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
      }
    } else if (!tableScaleGestureArmed) {
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
      const selectedTableContainsHitElement =
        hitElement?.containerRef?.kind === "tableCell" &&
        app.state.selectedElementIds[hitElement.containerRef.elementId] &&
        !event.shiftKey &&
        !event[KEYS.CTRL_OR_CMD];
      const someHitElementIsSelected =
        pointerDownState.hit.allHitElements.some((element) =>
          app.isASelectedElement(element) &&
          (!selectedTableContainsHitElement ||
            element.id !== hitElement?.containerRef?.elementId),
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
              } else if (hitElement.containerRef?.elementId) {
                // if hitElement is in a frame and its frame has been selected
                // disable selection for the given element
                if (
                  nextSelectedElementIds[hitElement.containerRef?.elementId]
                ) {
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
                      element.containerRef?.elementId &&
                      framesInGroups.has(element.containerRef?.elementId)
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
                    // a selected table stands for its subtree: members
                    // shift-clicked alongside it merge away (P01.2)
                    selectedElementIds: tableController.normalizeTableSelection(
                      app,
                      nextSelectedElementIds,
                    ),
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

export const maybeDragNewGenericElement = (
  app: PointerApp,
  pointerDownState: PointerDownState,
  event: MouseEvent | KeyboardEvent,
  informMutation = true,
): void => {
  const selectionElement = app.state.selectionElement;
  const pointerCoords = pointerDownState.lastCoords;
  if (
    selectionElement &&
    pointerDownState.boxSelection.hasOccurred &&
    app.state.activeTool.type !== "eraser"
  ) {
    dragNewElement({
      newElement: selectionElement,
      elementType: app.state.activeTool.type,
      originX: pointerDownState.origin.x,
      originY: pointerDownState.origin.y,
      x: pointerCoords.x,
      y: pointerCoords.y,
      width: distance(pointerDownState.origin.x, pointerCoords.x),
      height: distance(pointerDownState.origin.y, pointerCoords.y),
      shouldMaintainAspectRatio: shouldMaintainAspectRatio(event),
      shouldResizeFromCenter: false,
      scene: app.scene,
      zoom: app.state.zoom.value,
      informMutation: false,
    });
    return;
  }

  const newElement = app.state.newElement;
  if (!newElement) {
    return;
  }

  // tables split the drag evenly across rows/columns and must keep the
  // size invariant (`width`/`height` = row/column sums), so they cannot go
  // through the generic `dragNewElement`
  if (isTableElement(newElement)) {
    tableController.maybeDragNewTableElement(
      app,
      pointerDownState,
      event,
      informMutation,
    );
    return;
  }

  if (app.arrowText.maybeDragNewText(newElement, pointerCoords)) {
    return;
  }

  let [gridX, gridY] = getGridPoint(
    pointerCoords.x,
    pointerCoords.y,
    event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
  );

  const image =
    isInitializedImageElement(newElement) &&
    app.imageCache.get(newElement.fileId)?.image;
  const aspectRatio =
    image && !(image instanceof Promise) ? image.width / image.height : null;

  app.maybeCacheReferenceSnapPoints(event, [newElement]);

  const { snapOffset, snapLines } = snapNewElement(
    newElement,
    app,
    event,
    {
      x: pointerDownState.originInGrid.x + (app.state.originSnapOffset?.x ?? 0),
      y: pointerDownState.originInGrid.y + (app.state.originSnapOffset?.y ?? 0),
    },
    {
      x: gridX - pointerDownState.originInGrid.x,
      y: gridY - pointerDownState.originInGrid.y,
    },
    app.scene.getNonDeletedElementsMap(),
  );

  gridX += snapOffset.x;
  gridY += snapOffset.y;

  app.setState({
    snapLines,
  });

  if (!isBindingElement(newElement)) {
    dragNewElement({
      newElement,
      elementType: app.state.activeTool.type,
      originX: pointerDownState.originInGrid.x,
      originY: pointerDownState.originInGrid.y,
      x: gridX,
      y: gridY,
      width: distance(pointerDownState.originInGrid.x, gridX),
      height: distance(pointerDownState.originInGrid.y, gridY),
      // images and sticky notes are proportional by default — Shift frees
      // them; every other shape is free by default and Shift constrains it
      shouldMaintainAspectRatio:
        isImageElement(newElement) || isStickyNoteElement(newElement)
          ? !shouldMaintainAspectRatio(event)
          : shouldMaintainAspectRatio(event),
      shouldResizeFromCenter: shouldResizeFromCenter(event),
      zoom: app.state.zoom.value,
      scene: app.scene,
      widthAspectRatio: aspectRatio,
      originOffset: app.state.originSnapOffset,
      informMutation,
    });
  }

  app.setState({
    newElement,
  });

  // highlight elements that are to be added to frames on frames creation
  if (
    app.state.activeTool.type === TOOL_TYPE.frame ||
    app.state.activeTool.type === TOOL_TYPE.magicframe
  ) {
    app.setState({
      elementsToHighlight: getElementsInResizingFrame(
        app.scene.getNonDeletedElements(),
        newElement as ExcalidrawFrameLikeElement,
        app.state,
        app.scene.getNonDeletedElementsMap(),
      ) as NonDeletedExcalidrawElement[], // Obvious typecast, no need to runtime typecheck
    });
  }
};

export const isHittingCommonBoundingBoxOfSelectedElements = (
  app: PointerApp,
  point: Readonly<{ x: number; y: number }>,
  selectedElements: readonly ExcalidrawElement[],
): boolean => {
  const visibleSelectedElements = selectedElements.filter(
    (element) => !app.scene.getMindmapHiddenElementIds().has(element.id),
  );
  if (visibleSelectedElements.length < 2) {
    return false;
  }

  // How many pixels off the shape boundary we still consider a hit
  const threshold = Math.max(
    DEFAULT_COLLISION_THRESHOLD / app.state.zoom.value,
    1,
  );
  const boundsPadding =
    (DEFAULT_TRANSFORM_HANDLE_SPACING * 2) / app.state.zoom.value;
  const [x1, y1, x2, y2] = getCommonBounds(visibleSelectedElements);
  return (
    point.x > x1 - boundsPadding - threshold &&
    point.x < x2 + boundsPadding + threshold &&
    point.y > y1 - boundsPadding - threshold &&
    point.y < y2 + boundsPadding + threshold
  );
};

export const handleTextOnPointerDown = (
  app: PointerApp,
  event: React.PointerEvent<HTMLElement>,
  pointerDownState: PointerDownState,
): void => {
  // if we're currently still editing text, clicking outside
  // should only finalize it, not create another (irrespective
  // of state.activeTool.locked)
  if (app.state.editingTextElement) {
    return;
  }
  let sceneX = pointerDownState.origin.x;
  let sceneY = pointerDownState.origin.y;

  // the click transitions into text editing either way, consuming (or
  // bypassing) whatever anchor was highlighted — don't leave it lingering
  // under the editor, which outlives the hover when the tool is locked
  app.setState({ hoveredArrowTextAnchor: null });

  // a free arrow endpoint takes precedence over adding a label *to* the
  // arrow — it's the smaller, more deliberate target
  const arrowEndpoint = app.arrowText.getBindableEndpointAtPosition(
    sceneX,
    sceneY,
  );

  if (arrowEndpoint) {
    app.startTextEditing({
      sceneX,
      sceneY,
      // the binding fixes the position, but the width is still the user's
      // to drag out (see `getEndpointBoundTextDragAnchor`)
      autoEdit: false,
      arrowEndpoint,
    });
  } else {
    const element = app.getElementAtPosition(sceneX, sceneY, {
      includeBoundTextElement: true,
    });

    // FIXME
    let container = app.getTextBindableContainerAtPosition(sceneX, sceneY);

    if (hasBoundTextElement(element)) {
      container = element as NonDeleted<ExcalidrawTextContainer>;
      const labelCenter = app.arrowText.getLabelCenter(element);
      if (labelCenter) {
        sceneX = labelCenter.x;
        sceneY = labelCenter.y;
      } else {
        sceneX = element.x + element.width / 2;
        sceneY = element.y + element.height / 2;
      }
    }
    app.startTextEditing({
      sceneX,
      sceneY,
      insertAtParentCenter: !event.altKey,
      container,
      autoEdit: false,
      initialCaretSceneCoords: { x: sceneX, y: sceneY },
    });
  }

  if (!app.isToolLocked()) {
    app.setState(
      {
        activeTool: updateActiveTool(app.state, {
          type: app.state.preferredSelectionTool.type,
        }),
      },
      // reset once the tool revert has settled
      () => app.cursor.reset(),
    );
  } else {
    app.cursor.reset();
  }
};

export const handleFreeDrawElementOnPointerDown = (
  app: PointerApp,
  event: React.PointerEvent<HTMLElement>,
  elementType: ExcalidrawFreeDrawElement["type"],
  pointerDownState: PointerDownState,
) => {
  // Begin a mark capture. This does not have to update state yet.
  const [gridX, gridY] = getGridPoint(
    pointerDownState.origin.x,
    pointerDownState.origin.y,
    null,
  );

  const containerRef = app.getContainerRefForDropAt({ x: gridX, y: gridY });

  const simulatePressure = event.pressure === 0.5;

  const strokeVariability = app.state.currentItemStrokeVariability;

  const element = newFreeDrawElement({
    type: elementType,
    x: gridX,
    y: gridY,
    strokeColor: app.state.currentItemStrokeColor,
    backgroundColor: app.state.currentItemBackgroundColor,
    fillStyle: app.state.currentItemFillStyle,
    strokeWidth: app.getCurrentItemStrokeWidth("freedraw"),
    strokeStyle: app.state.currentItemStrokeStyle,
    roughness: app.state.currentItemRoughness,
    opacity: app.state.currentItemOpacity,
    roundness: null,
    simulatePressure,
    strokeOptions: {
      variability: strokeVariability,
      streamline:
        event.pointerType !== "mouse"
          ? DEFAULT_STROKE_STREAMLINE_PRECISE
          : DEFAULT_STROKE_STREAMLINE,
    },
    locked: false,
    containerRef,
    points: [pointFrom<LocalPoint>(0, 0)],
    // pressures are only consumed when rendering a real-pressure stroke, so
    // skip persisting them while pressure is being simulated
    pressures: simulatePressure ? [] : [event.pressure],
  });

  app.insertNewElement(element);

  app.setState((prevState) => {
    const nextSelectedElementIds = {
      ...prevState.selectedElementIds,
    };
    delete nextSelectedElementIds[element.id];
    return {
      selectedElementIds: makeNextSelectedElementIds(
        nextSelectedElementIds,
        prevState,
      ),
    };
  });

  app.setState({
    newElement: element,
    suggestedBinding: null,
  });
};

export const handleLinearElementOnPointerDown = (
  app: PointerApp,
  event: React.PointerEvent<HTMLElement>,
  elementType: ExcalidrawLinearElement["type"],
  pointerDownState: PointerDownState,
): void => {
  if (event.ctrlKey) {
    flushSync(() => {
      app.setState({
        isBindingEnabled: app.state.bindingPreference !== "enabled",
      });
    });
  }

  if (app.state.multiElement) {
    const { multiElement, selectedLinearElement } = app.state;

    invariant(
      selectedLinearElement,
      "selectedLinearElement is expected to be set",
    );

    // finalize if completing a loop
    if (
      multiElement.type === "line" &&
      isPathALoop(multiElement.points, app.state.zoom.value)
    ) {
      flushSync(() => {
        app.setState({
          selectedLinearElement: {
            ...selectedLinearElement,
            lastCommittedPoint:
              multiElement.points[multiElement.points.length - 1],
            initialState: {
              ...selectedLinearElement.initialState,
              lastClickedPoint: -1, // Disable dragging
            },
          },
        });
      });
      app.actionManager.executeAction(actionFinalize);
      return;
    }

    // Elbow arrows cannot be created by putting down points
    // only the start and end points can be defined
    if (isElbowArrow(multiElement) && multiElement.points.length > 1) {
      app.actionManager.executeAction(actionFinalize, "ui", {
        event: event.nativeEvent,
        sceneCoords: {
          x: pointerDownState.origin.x,
          y: pointerDownState.origin.y,
        },
      });
      return;
    }

    const { x: rx, y: ry } = multiElement;
    const { lastCommittedPoint } = selectedLinearElement;
    const sceneCoords = viewportCoordsToSceneCoords(event, app.state);
    const { start, end } =
      isBindingElement(multiElement) && isBindingEnabled(app.state)
        ? getBindingStrategyForDraggingBindingElementEndpoints(
            multiElement,
            new Map([
              [
                multiElement.points.length - 1,
                {
                  point: multiElement.points[multiElement.points.length - 1],
                  isDragging: false,
                },
              ],
            ]),
            sceneCoords.x,
            sceneCoords.y,
            app.scene.getNonDeletedElementsMap(),
            app.scene.getNonDeletedElements(),
            app.state,
            {
              newArrow: Boolean(app.state.newElement),
              zoom: app.state.zoom,
            },
          )
        : { end: { mode: undefined } };

    const elementsMap = app.scene.getNonDeletedElementsMap();
    // Auto-confirm when both ends bind to the SAME element and the end point
    // lands on the outline rather than inside it
    const endOutsideSameElement =
      start?.mode != null &&
      end.mode != null &&
      start.element.id === end.element.id &&
      !isPointInElement(end.focusPoint, end.element, elementsMap);
    const boundOutsideFromElsewhere =
      end.mode === "orbit" &&
      multiElement.startBinding?.elementId !== end.element?.id;
    const lastCommittedPointIsInsideCommitZone =
      lastCommittedPoint &&
      pointDistance(
        pointFrom(
          pointerDownState.origin.x - rx,
          pointerDownState.origin.y - ry,
        ),
        lastCommittedPoint,
      ) < LINE_CONFIRM_THRESHOLD;

    // clicking inside commit zone → finalize arrow
    if (
      boundOutsideFromElsewhere || // Outside -> orbit: Bind immediately
      endOutsideSameElement || // End outside the start's element: Bind immediately
      (multiElement.points.length > 1 && lastCommittedPointIsInsideCommitZone)
    ) {
      app.actionManager.executeAction(actionFinalize, "ui", {
        event: event.nativeEvent,
        sceneCoords: {
          x: pointerDownState.origin.x,
          y: pointerDownState.origin.y,
        },
      });
      return;
    }

    app.setState((prevState) => ({
      selectedElementIds: makeNextSelectedElementIds(
        {
          ...prevState.selectedElementIds,
          [multiElement.id]: true,
        },
        prevState,
      ),
    }));

    app.cursor.set(CURSOR_TYPE.POINTER);
  } else {
    const [gridX, gridY] = getGridPoint(
      pointerDownState.origin.x,
      pointerDownState.origin.y,
      event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
    );

    const containerRef = app.getContainerRefForDropAt({ x: gridX, y: gridY });

    /* If arrow is pre-arrowheads, it will have undefined for both start and end arrowheads.
      If so, we want it to be null for start and "arrow" for end. If the linear item is not
      an arrow, we want it to be null for both. Otherwise, we want it to use the
      values from appState. */

    const { currentItemStartArrowhead, currentItemEndArrowhead } = app.state;
    const [startArrowhead, endArrowhead] =
      elementType === "arrow"
        ? [currentItemStartArrowhead, currentItemEndArrowhead]
        : [null, null];

    const element =
      elementType === "arrow"
        ? newArrowElement({
            type: elementType,
            x: gridX,
            y: gridY,
            strokeColor: app.state.currentItemStrokeColor,
            backgroundColor: app.state.currentItemBackgroundColor,
            fillStyle: app.state.currentItemFillStyle,
            strokeWidth: app.getCurrentItemStrokeWidth(elementType),
            strokeStyle: app.state.currentItemStrokeStyle,
            roughness: app.state.currentItemRoughness,
            opacity: app.state.currentItemOpacity,
            roundness:
              app.state.currentItemArrowType === ARROW_TYPE.round
                ? { type: ROUNDNESS.PROPORTIONAL_RADIUS }
                : // note, roundness doesn't have any effect for elbow arrows,
                  // but it's best to set it to null as well
                  null,
            startArrowhead,
            endArrowhead,
            locked: false,
            containerRef,
            elbowed: app.state.currentItemArrowType === ARROW_TYPE.elbow,
            fixedSegments:
              app.state.currentItemArrowType === ARROW_TYPE.elbow ? [] : null,
          })
        : newLinearElement({
            type: elementType,
            x: gridX,
            y: gridY,
            strokeColor: app.state.currentItemStrokeColor,
            backgroundColor: app.state.currentItemBackgroundColor,
            fillStyle: app.state.currentItemFillStyle,
            strokeWidth: app.getCurrentItemStrokeWidth(elementType),
            strokeStyle: app.state.currentItemStrokeStyle,
            roughness: app.state.currentItemRoughness,
            opacity: app.state.currentItemOpacity,
            roundness:
              app.state.currentItemRoundness === "round"
                ? { type: ROUNDNESS.PROPORTIONAL_RADIUS }
                : null,
            locked: false,
            containerRef,
          });

    const point = pointFrom<GlobalPoint>(
      pointerDownState.origin.x,
      pointerDownState.origin.y,
    );
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const boundElement = isBindingEnabled(app.state)
      ? getHoveredElementForBinding(
          point,
          app.scene.getNonDeletedElements(),
          elementsMap,
        )
      : null;

    app.scene.mutateElement(element, {
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(0, 0)],
    });

    app.insertNewElement(element);

    if (isBindingElement(element)) {
      // Do the initial binding so the binding strategy has the initial state
      bindOrUnbindBindingElement(
        element,
        new Map([
          [
            0,
            {
              point: pointFrom<LocalPoint>(0, 0),
              isDragging: false,
            },
          ],
        ]),
        point[0],
        point[1],
        app.scene,
        app.state,
        {
          newArrow: true,
          altKey: event.altKey,
          initialBinding: true,
          angleLocked: shouldRotateWithDiscreteAngle(event.nativeEvent),
        },
      );
    }

    // NOTE: We need the flushSync here for the
    // delayed bind mode change to see the right state
    // (specifically the `newElement`)
    flushSync(() => {
      app.setState((prevState) => {
        let linearElementEditor = null;
        let nextSelectedElementIds = prevState.selectedElementIds;
        if (isLinearElement(element)) {
          linearElementEditor = new LinearElementEditor(
            element,
            app.scene.getNonDeletedElementsMap(),
          );

          const endIdx = element.points.length - 1;
          linearElementEditor = {
            ...linearElementEditor,
            selectedPointsIndices: [endIdx],
            initialState: {
              ...linearElementEditor.initialState,
              arrowStartIsInside: event.altKey,
              lastClickedPoint: endIdx,
              origin: pointFrom<GlobalPoint>(
                pointerDownState.origin.x,
                pointerDownState.origin.y,
              ),
            },
          };
        }

        nextSelectedElementIds = !app.isToolLocked()
          ? makeNextSelectedElementIds({ [element.id]: true }, prevState)
          : prevState.selectedElementIds;

        return {
          ...prevState,
          bindMode: "orbit",
          newElement: element,
          suggestedBinding:
            boundElement && isBindingElement(element)
              ? {
                  element: boundElement,
                  midPoint: getSnapOutlineMidPoint(
                    point,
                    boundElement,
                    elementsMap,
                    app.state.zoom,
                  ),
                }
              : null,
          selectedElementIds: nextSelectedElementIds,
          selectedLinearElement: linearElementEditor,
        };
      });
    });

    if (isBindingElement(element) && getFeatureFlag("COMPLEX_BINDINGS")) {
      app.handleDelayedBindModeChange(element, boundElement);
    }
  }
};

export const createGenericElementOnPointerDown = (
  app: PointerApp,
  elementType:
    | Extract<ToolType, "selection" | "rectangle" | "diamond" | "ellipse">
    | "embeddable"
    | "stickynote",
  pointerDownState: PointerDownState,
): void => {
  const [gridX, gridY] = getGridPoint(
    pointerDownState.origin.x,
    pointerDownState.origin.y,
    app.lastPointerDownEvent?.[KEYS.CTRL_OR_CMD]
      ? null
      : app.getEffectiveGridSize(),
  );

  const containerRef = app.getContainerRefForDropAt({ x: gridX, y: gridY });

  const baseElementAttributes = {
    x: gridX,
    y: gridY,
    strokeColor:
      elementType === "stickynote"
        ? app.state.currentItemStickynoteStrokeColor
        : app.state.currentItemStrokeColor,
    backgroundColor:
      elementType === "stickynote"
        ? app.state.currentItemStickynoteBackgroundColor
        : app.state.currentItemBackgroundColor,
    fillStyle: app.state.currentItemFillStyle,
    strokeWidth: app.getCurrentItemStrokeWidth(elementType),
    strokeStyle: app.state.currentItemStrokeStyle,
    roughness: app.state.currentItemRoughness,
    opacity: app.state.currentItemOpacity,
    roundness: app.getCurrentItemRoundness(elementType),
    locked: false,
    containerRef,
  } as const;

  let element;
  if (elementType === "embeddable") {
    element = newEmbeddableElement({
      type: "embeddable",
      ...baseElementAttributes,
    });
  } else if (elementType === "stickynote") {
    element = newStickyNoteElement({
      type: "stickynote",
      ...baseElementAttributes,
    });
  } else if (elementType === "selection") {
    element = newElement({
      type: "selection",
      ...baseElementAttributes,
    });
  } else {
    const preferredShape = app.state.preferredGenericShape;
    const genericShapeId: BaseShapeId =
      preferredShape === "right-triangle" || preferredShape === "left-triangle"
        ? "triangle"
        : elementType === "rectangle"
        ? preferredShape
        : elementType;
    if (
      preferredShape === "right-triangle" ||
      preferredShape === "left-triangle"
    ) {
      element = newElement({
        type: "composite_shape",
        shape: {
          id: "triangle",
          schemaVersion: 1,
          triangle: {
            apexX: preferredShape === "right-triangle" ? 0 : 1,
          },
        },
        ...baseElementAttributes,
      });
    } else {
      element = newElement({
        type: genericShapeId,
        ...baseElementAttributes,
      });
    }
  }

  if (element.type === "selection") {
    app.setState({
      selectionElement: element,
    });
  } else {
    app.insertNewElement(element);
    app.setState({
      multiElement: null,
      newElement: element,
    });
  }
};

export const createFrameElementOnPointerDown = (
  app: PointerApp,
  pointerDownState: PointerDownState,
  type: Extract<ToolType, "frame" | "magicframe">,
): void => {
  const [gridX, gridY] = getGridPoint(
    pointerDownState.origin.x,
    pointerDownState.origin.y,
    app.lastPointerDownEvent?.[KEYS.CTRL_OR_CMD]
      ? null
      : app.getEffectiveGridSize(),
  );

  const constructorOpts = {
    x: gridX,
    y: gridY,
    opacity: app.state.currentItemOpacity,
    locked: false,
    ...FRAME_STYLE,
  } as const;

  const frame =
    type === TOOL_TYPE.magicframe
      ? newMagicFrameElement(constructorOpts)
      : newFrameElement(constructorOpts);

  app.insertNewElement(frame);

  app.setState({
    multiElement: null,
    newElement: frame,
  });
};

export const clearSelection = (
  app: PointerApp,
  hitElement: ExcalidrawElement | null,
): void => {
  app.setState((prevState) => ({
    selectedElementIds: makeNextSelectedElementIds({}, prevState),
    activeEmbeddable: null,
    selectedGroupIds: {},
    // Continue editing the same group if the user selected a different
    // element from it
    editingGroupId:
      prevState.editingGroupId &&
      hitElement != null &&
      isElementInGroup(hitElement, prevState.editingGroupId)
        ? prevState.editingGroupId
        : null,
  }));
  app.setState({
    selectedElementIds: makeNextSelectedElementIds({}, app.state),
    activeEmbeddable: null,
    previousSelectedElementIds: app.state.selectedElementIds,
    selectedLinearElement: null,
  });
};
