import { arrayToMap } from "@excalidraw/common";
import {
  isPointWithinBounds,
  pointFrom,
  segmentsIntersectAt,
} from "@excalidraw/math";

import type {
  AppClassProperties,
  AppState,
  StaticCanvasAppState,
} from "@excalidraw/excalidraw/types";

import type { ReadonlySetLike } from "@excalidraw/common/utility-types";

import { getElementsWithinSelection, getSelectedElements } from "./selection";
import { getElementsInGroup, selectGroupsFromGivenElements } from "./groups";

import {
  getElementLineSegments,
  getCommonBounds,
  getElementAbsoluteCoords,
  doBoundsIntersect,
  getElementBounds,
  boundsContainBounds,
} from "./bounds";
import { mutateElement } from "./mutateElement";
import { getBoundTextElement, getContainerElement } from "./textElement";
import { syncMovedIndices } from "./fractionalIndex";
import { getIndexedFrameChildren } from "./frameChildrenIndex";
import { tableCellContainerRef } from "./tableContainer";
import {
  frameLikeContainerRef,
  isBoundToContainer,
  isFrameElement,
  isFrameLikeElement,
  isTableElement,
  isTextElement,
} from "./typeChecks";

import { getNonDeletedElements } from ".";

import type { ExcalidrawElementsIncludingDeleted } from "./Scene";

import type {
  ElementsMap,
  ElementsMapOrArray,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "./types";

// --------------------------- Frame State ------------------------------------
export const bindElementsToFramesAfterDuplication = (
  nextElements: readonly ExcalidrawElement[],
  origElements: readonly ExcalidrawElement[],
  origIdToDuplicateId: Map<ExcalidrawElement["id"], ExcalidrawElement["id"]>,
  /** original table cell id -> duplicated table cell id */
  tableCellIdMap?: ReadonlyMap<string, string>,
) => {
  const nextElementMap = arrayToMap(nextElements) as Map<
    ExcalidrawElement["id"],
    ExcalidrawElement
  >;

  for (const element of origElements) {
    if (element.containerRef?.elementId && !isBoundToContainer(element)) {
      // Preserve the parent relationship when the containing frame is cloned.
      const nextElementId = origIdToDuplicateId.get(element.id);
      const nextParentId = origIdToDuplicateId.get(
        element.containerRef?.elementId,
      );
      const nextElement = nextElementId && nextElementMap.get(nextElementId);
      if (nextElement) {
        const containerRef = element.containerRef;
        if (!nextParentId) {
          // the direct parent was not part of the duplication: the duplicate
          // is placed at a new position and gets its membership re-judged
          // there (a copied cell graphic does not carry its source table)
          mutateElement(nextElement, nextElementMap, {
            containerRef: undefined,
          });
        } else if (containerRef.kind === "tableCell") {
          mutateElement(nextElement, nextElementMap, {
            containerRef: tableCellContainerRef(
              nextParentId,
              (tableCellIdMap?.get(containerRef.cellId) ??
                containerRef.cellId) as string,
              containerRef.role,
            ),
          });
        } else {
          mutateElement(nextElement, nextElementMap, {
            containerRef: frameLikeContainerRef(nextParentId),
          });
        }
      }
    }
  }
};

export function isElementIntersectingFrame(
  element: ExcalidrawElement,
  frame: ExcalidrawFrameLikeElement,
  elementsMap: ElementsMap,
) {
  const frameLineSegments = getElementLineSegments(frame, elementsMap);

  const elementLineSegments = getElementLineSegments(element, elementsMap);

  const intersecting = frameLineSegments.some((frameLineSegment) =>
    elementLineSegments.some((elementLineSegment) =>
      segmentsIntersectAt(frameLineSegment, elementLineSegment),
    ),
  );

  return intersecting;
}

export const getElementsCompletelyInFrame = (
  elements: readonly ExcalidrawElement[],
  frame: ExcalidrawFrameLikeElement,
  elementsMap: ElementsMap,
) =>
  omitGroupsContainingFrameLikes(
    getElementsWithinSelection(elements, frame, elementsMap, false),
  ).filter(
    (element) =>
      (!isFrameLikeElement(element) && !element.containerRef?.elementId) ||
      element.containerRef?.elementId === frame.id,
  );

export const isElementContainingFrame = (
  element: ExcalidrawElement,
  frame: ExcalidrawFrameLikeElement,
  elementsMap: ElementsMap,
) => {
  return boundsContainBounds(
    getElementBounds(element, elementsMap),
    getElementBounds(frame, elementsMap),
  );
};

export const getElementsIntersectingFrame = (
  elements: readonly ExcalidrawElement[],
  frame: ExcalidrawFrameLikeElement,
) => {
  const elementsMap = arrayToMap(elements);
  return elements.filter((element) =>
    isElementIntersectingFrame(element, frame, elementsMap),
  );
};

export const elementsAreInFrameBounds = (
  elements: readonly ExcalidrawElement[],
  frame: ExcalidrawFrameLikeElement,
  elementsMap: ElementsMap,
) => {
  const [frameX1, frameY1, frameX2, frameY2] = getElementAbsoluteCoords(
    frame,
    elementsMap,
  );

  const [elementX1, elementY1, elementX2, elementY2] =
    getCommonBounds(elements);

  return (
    frameX1 <= elementX1 &&
    frameY1 <= elementY1 &&
    frameX2 >= elementX2 &&
    frameY2 >= elementY2
  );
};

export const elementOverlapsWithFrame = (
  element: ExcalidrawElement,
  frame: ExcalidrawFrameLikeElement,
  elementsMap: ElementsMap,
) => {
  return (
    elementsAreInFrameBounds([element], frame, elementsMap) ||
    isElementIntersectingFrame(element, frame, elementsMap) ||
    isElementContainingFrame(element, frame, elementsMap)
  );
};

export const isCursorInFrame = (
  cursorCoords: {
    x: number;
    y: number;
  },
  frame: NonDeleted<ExcalidrawFrameLikeElement>,
  elementsMap: ElementsMap,
) => {
  const [fx1, fy1, fx2, fy2] = getElementAbsoluteCoords(frame, elementsMap);

  return isPointWithinBounds(
    pointFrom(fx1, fy1),
    pointFrom(cursorCoords.x, cursorCoords.y),
    pointFrom(fx2, fy2),
  );
};

export const groupsAreAtLeastIntersectingTheFrame = (
  elements: readonly NonDeletedExcalidrawElement[],
  groupIds: readonly string[],
  frame: ExcalidrawFrameLikeElement,
) => {
  const elementsMap = arrayToMap(elements);
  const elementsInGroup = groupIds.flatMap((groupId) =>
    getElementsInGroup(elements, groupId),
  );

  if (elementsInGroup.length === 0) {
    return true;
  }

  return !!elementsInGroup.find(
    (element) =>
      elementsAreInFrameBounds([element], frame, elementsMap) ||
      isElementIntersectingFrame(element, frame, elementsMap),
  );
};

export const groupsAreCompletelyOutOfFrame = (
  elements: readonly NonDeletedExcalidrawElement[],
  groupIds: readonly string[],
  frame: ExcalidrawFrameLikeElement,
) => {
  const elementsMap = arrayToMap(elements);
  const elementsInGroup = groupIds.flatMap((groupId) =>
    getElementsInGroup(elements, groupId),
  );

  if (elementsInGroup.length === 0) {
    return true;
  }

  return (
    elementsInGroup.find(
      (element) =>
        elementsAreInFrameBounds([element], frame, elementsMap) ||
        isElementIntersectingFrame(element, frame, elementsMap),
    ) === undefined
  );
};

// --------------------------- Frame Utils ------------------------------------

/** Returns frame-like element IDs mapped to direct children, including empty frames. */
export const groupByFrameLikes = (elements: readonly ExcalidrawElement[]) => {
  const frameElementsMap = new Map<
    ExcalidrawElement["id"],
    ExcalidrawElement[]
  >();

  for (const element of elements) {
    const frameId = isFrameLikeElement(element)
      ? element.id
      : element.containerRef?.elementId;
    if (frameId && !frameElementsMap.has(frameId)) {
      frameElementsMap.set(frameId, getFrameChildren(elements, frameId));
    }
  }

  return frameElementsMap;
};

export const getFrameChildren = (
  allElements: ElementsMapOrArray,
  frameId: string,
) => {
  const indexedChildren = getIndexedFrameChildren(allElements, frameId);
  if (indexedChildren) {
    return indexedChildren;
  }

  const frameChildren: ExcalidrawElement[] = [];
  for (const element of allElements.values()) {
    if (element.containerRef?.elementId === frameId) {
      frameChildren.push(element);
    }
  }
  return frameChildren;
};

export const getFrameLikeElements = (
  allElements: ExcalidrawElementsIncludingDeleted,
): ExcalidrawFrameLikeElement[] => {
  return allElements.filter((element): element is ExcalidrawFrameLikeElement =>
    isFrameLikeElement(element),
  );
};

/**
 * Returns ExcalidrawFrameElements and non-frame-children elements.
 *
 * Considers children as root elements if they point to a frame parent
 * non-existing in the elements set.
 *
 * Considers non-frame bound elements (container or arrow labels) as root.
 */
export const getRootElements = <T extends ExcalidrawElement>(
  allElements: readonly T[],
) => {
  const frameElements = arrayToMap(getFrameLikeElements(allElements));
  return allElements.filter(
    (element) =>
      frameElements.has(element.id) ||
      !element.containerRef?.elementId ||
      !frameElements.has(element.containerRef?.elementId),
  );
};

export const getElementsInResizingFrame = (
  allElements: ExcalidrawElementsIncludingDeleted,
  frame: ExcalidrawFrameLikeElement,
  appState: AppState,
  elementsMap: ElementsMap,
): ExcalidrawElement[] => {
  const prevElementsInFrame = getFrameChildren(allElements, frame.id);
  const nextElementsInFrame = new Set<ExcalidrawElement>(prevElementsInFrame);

  const elementsCompletelyInFrame = new Set([
    ...getElementsCompletelyInFrame(allElements, frame, elementsMap),
    ...prevElementsInFrame.filter((element) =>
      isElementContainingFrame(element, frame, elementsMap),
    ),
  ]);

  const elementsNotCompletelyInFrame = prevElementsInFrame.filter(
    (element) => !elementsCompletelyInFrame.has(element),
  );

  // for elements that are completely in the frame
  // if they are part of some groups, then those groups are still
  // considered to belong to the frame
  const groupsToKeep = new Set<string>(
    Array.from(elementsCompletelyInFrame).flatMap(
      (element) => element.groupIds,
    ),
  );

  for (const element of elementsNotCompletelyInFrame) {
    if (!isElementIntersectingFrame(element, frame, elementsMap)) {
      if (element.groupIds.length === 0) {
        nextElementsInFrame.delete(element);
      }
    } else if (element.groupIds.length > 0) {
      // group element intersects with the frame, we should keep the groups
      // that this element is part of
      for (const id of element.groupIds) {
        groupsToKeep.add(id);
      }
    }
  }

  for (const element of elementsNotCompletelyInFrame) {
    if (element.groupIds.length > 0) {
      let shouldRemoveElement = true;

      for (const id of element.groupIds) {
        if (groupsToKeep.has(id)) {
          shouldRemoveElement = false;
        }
      }

      if (shouldRemoveElement) {
        nextElementsInFrame.delete(element);
      }
    }
  }

  const individualElementsCompletelyInFrame = Array.from(
    elementsCompletelyInFrame,
  ).filter((element) => element.groupIds.length === 0);

  for (const element of individualElementsCompletelyInFrame) {
    nextElementsInFrame.add(element);
  }

  const newGroupElementsCompletelyInFrame = Array.from(
    elementsCompletelyInFrame,
  ).filter((element) => element.groupIds.length > 0);
  const nonDeletedNewGroupElementsCompletelyInFrame = getNonDeletedElements(
    newGroupElementsCompletelyInFrame,
  );

  const groupIds = selectGroupsFromGivenElements(
    nonDeletedNewGroupElementsCompletelyInFrame,
    appState,
  );

  // new group elements
  for (const [id, isSelected] of Object.entries(groupIds)) {
    if (isSelected) {
      const elementsInGroup = getElementsInGroup(allElements, id);

      if (elementsAreInFrameBounds(elementsInGroup, frame, elementsMap)) {
        for (const element of elementsInGroup) {
          nextElementsInFrame.add(element);
        }
      }
    }
  }

  return [...nextElementsInFrame].filter((element) => {
    return !(isTextElement(element) && element.containerId);
  });
};

export const getElementsInNewFrame = (
  elements: ExcalidrawElementsIncludingDeleted,
  frame: ExcalidrawFrameLikeElement,
  elementsMap: ElementsMap,
) => {
  return omitPartialGroups(
    omitGroupsContainingFrameLikes(
      elements,
      getElementsCompletelyInFrame(elements, frame, elementsMap),
    ),
    frame,
    elementsMap,
  );
};

export const omitPartialGroups = (
  elements: ExcalidrawElement[],
  frame: ExcalidrawFrameLikeElement,
  allElementsMap: ElementsMap,
) => {
  const elementsToReturn = [];
  const checkedGroups = new Map<string, boolean>();

  for (const element of elements) {
    let shouldOmit = false;
    if (element.groupIds.length > 0) {
      // if some partial group should be omitted, then all elements in that group should be omitted
      if (element.groupIds.some((gid) => checkedGroups.get(gid))) {
        shouldOmit = true;
      } else {
        const allElementsInGroup = new Set(
          element.groupIds.flatMap((gid) =>
            getElementsInGroup(allElementsMap, gid),
          ),
        );

        shouldOmit = !elementsAreInFrameBounds(
          Array.from(allElementsInGroup),
          frame,
          allElementsMap,
        );
      }

      element.groupIds.forEach((gid) => {
        checkedGroups.set(gid, shouldOmit);
      });
    }

    if (!shouldOmit) {
      elementsToReturn.push(element);
    }
  }

  return elementsToReturn;
};

export const getContainingFrame = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
) => {
  const owner = isBoundToContainer(element)
    ? elementsMap.get(element.containerId)
    : element;
  let parent = owner?.containerRef?.elementId
    ? elementsMap.get(owner.containerRef.elementId)
    : null;
  // Cells don't clip their descendants, so a tableCell parent resolves
  // through to the frame-like ancestor owning the chain: the walk ascends
  // through tableCell edges (a frame placed in a cell keeps its own
  // frameLike children below it) and stops at the first frame-like.
  // Container refs are asserted acyclic at the scene boundaries, so plain
  // ascent is safe.
  while (parent && !isFrameLikeElement(parent)) {
    parent = parent.containerRef?.elementId
      ? elementsMap.get(parent.containerRef.elementId)
      : null;
  }
  return (parent as ExcalidrawFrameLikeElement) || null;
};

// --------------------------- Frame Operations -------------------------------

/** */
export const filterElementsEligibleAsFrameChildren = (
  elements: readonly ExcalidrawElement[],
  frame: ExcalidrawFrameLikeElement,
) => {
  const otherFrames = new Set<ExcalidrawFrameLikeElement["id"]>();
  const elementsMap = arrayToMap(elements);
  elements = omitGroupsContainingFrameLikes(elements);

  for (const element of elements) {
    if (isFrameLikeElement(element) && element.id !== frame.id) {
      otherFrames.add(element.id);
    }
  }

  const processedGroups = new Set<ExcalidrawElement["id"]>();

  const eligibleElements: ExcalidrawElement[] = [];

  for (const element of elements) {
    // don't add frames or their children
    if (
      isFrameLikeElement(element) ||
      (element.containerRef?.elementId &&
        otherFrames.has(element.containerRef?.elementId))
    ) {
      continue;
    }

    if (element.groupIds.length) {
      const shallowestGroupId = element.groupIds.at(-1)!;
      if (!processedGroups.has(shallowestGroupId)) {
        processedGroups.add(shallowestGroupId);
        const groupElements = getElementsInGroup(elements, shallowestGroupId);
        if (
          groupElements.some((el) =>
            elementOverlapsWithFrame(el, frame, elementsMap),
          )
        ) {
          for (const child of groupElements) {
            eligibleElements.push(child);
          }
        }
      }
    } else {
      const overlaps = elementOverlapsWithFrame(element, frame, elementsMap);
      if (overlaps) {
        eligibleElements.push(element);
      }
    }
  }

  return eligibleElements;
};

export const getCommonFrameId = (elements: readonly ExcalidrawElement[]) => {
  let commonFrameId: string | undefined;

  for (const element of elements) {
    if (isFrameLikeElement(element) || !element.containerRef?.elementId) {
      return null;
    }

    if (commonFrameId === undefined) {
      commonFrameId = element.containerRef?.elementId;
    } else if (commonFrameId !== element.containerRef?.elementId) {
      return null;
    }
  }

  return commonFrameId ?? null;
};

export const getFrameChildrenInsertionIndex = (
  elements: readonly ExcalidrawElement[],
  frameId: ExcalidrawFrameLikeElement["id"],
): number | null => {
  const elementsMap = arrayToMap(elements);
  for (let index = elements.length - 1; index >= 0; index--) {
    const element = elements[index];

    if (element.id === frameId) {
      return index;
    } else if (getContainingFrame(element, elementsMap)?.id === frameId) {
      return index + 1;
    }
  }

  return null;
};

/**
 * Adds elements and their bound elements to frame. Reorders added elements to
 * be just below frame, or just above its highest child (whichever is higher).
 *
 * @returns mutated allElements (same data structure)
 */
export const addElementsToFrame = <T extends ElementsMapOrArray>(
  allElements: T,
  elementsToAdd: ExcalidrawElement[],
  frame: ExcalidrawFrameLikeElement,
): T => {
  const elementsMap = arrayToMap(allElements);
  const commonFrameId = getCommonFrameId(elementsToAdd);

  const finalElementsToAdd = new Set<ExcalidrawElement>();

  const otherFrames = new Set<ExcalidrawFrameLikeElement["id"]>();

  for (const element of elementsToAdd) {
    if (isFrameLikeElement(element) && element.id !== frame.id) {
      otherFrames.add(element.id);
    }
  }

  // - add bound text elements if not already in the array
  // - keep elements already in the frame so mixed selections can be reordered
  //   together
  for (const element of omitGroupsContainingFrameLikes(
    allElements,
    elementsToAdd,
  )) {
    // don't add frames or their children
    if (
      isFrameLikeElement(element) ||
      (element.containerRef?.elementId &&
        otherFrames.has(element.containerRef?.elementId))
    ) {
      continue;
    }

    finalElementsToAdd.add(element);

    const boundTextElement = getBoundTextElement(element, elementsMap);
    if (boundTextElement && !finalElementsToAdd.has(boundTextElement)) {
      finalElementsToAdd.add(boundTextElement);
    }
  }

  for (const element of finalElementsToAdd) {
    if (isBoundToContainer(element)) {
      continue;
    }
    // we don't always need to update the element if it's already in the frame,
    // but we still need to accumulate in finalElementsToAdd so we potentially
    // reorder them if added together
    if (element.containerRef?.elementId !== frame.id) {
      mutateElement(element, elementsMap, {
        containerRef: frameLikeContainerRef(frame.id),
      });
    }
  }

  // (re)order elements to be just below the frame,
  // or just above the highest child if that is higher
  // (latter case is denormalized order until we migrate)
  // ---------------------------------------------------------------------------

  if (
    !finalElementsToAdd.size ||
    // if all elements to add already belong to the frame, then we don't want to
    // reorder (case: we're dragging element children within the frame)
    commonFrameId === frame.id
  ) {
    return allElements;
  }

  const otherElements = Array.from(allElements.values()).filter(
    (element) => !finalElementsToAdd.has(element),
  );
  const insertionIndex = getFrameChildrenInsertionIndex(
    otherElements,
    frame.id,
  );

  if (insertionIndex === null) {
    return allElements;
  }

  const reorderedElements = [
    ...otherElements.slice(0, insertionIndex),
    ...finalElementsToAdd,
    ...otherElements.slice(insertionIndex),
  ];

  syncMovedIndices(reorderedElements, arrayToMap([...finalElementsToAdd]));

  return (
    Array.isArray(allElements)
      ? reorderedElements
      : new Map(reorderedElements.map((element) => [element.id, element]))
  ) as T;
};

export const removeElementsFromFrame = (
  elementsToRemove: ReadonlySetLike<ExcalidrawElement>,
  elementsMap: ElementsMap,
) => {
  const _elementsToRemove = new Map<
    ExcalidrawElement["id"],
    ExcalidrawElement
  >();

  const toRemoveElementsByFrame = new Map<
    ExcalidrawFrameLikeElement["id"],
    ExcalidrawElement[]
  >();

  for (const element of elementsToRemove) {
    if (element.containerRef?.elementId) {
      _elementsToRemove.set(element.id, element);

      const arr =
        toRemoveElementsByFrame.get(element.containerRef?.elementId) || [];
      arr.push(element);

      const boundTextElement = getBoundTextElement(element, elementsMap);
      if (boundTextElement) {
        _elementsToRemove.set(boundTextElement.id, boundTextElement);
        arr.push(boundTextElement);
      }

      toRemoveElementsByFrame.set(element.containerRef?.elementId, arr);
    }
  }

  for (const [, element] of _elementsToRemove) {
    if (isBoundToContainer(element)) {
      continue;
    }
    mutateElement(element, elementsMap, {
      containerRef: undefined,
    });
  }
};

export const removeAllElementsFromFrame = <T extends ExcalidrawElement>(
  allElements: readonly T[],
  frame: ExcalidrawFrameLikeElement,
) => {
  const elementsInFrame = getFrameChildren(allElements, frame.id);
  removeElementsFromFrame(elementsInFrame, arrayToMap(allElements));
  return allElements;
};

export const replaceAllElementsInFrame = <T extends ExcalidrawElement>(
  allElements: readonly T[],
  nextElementsInFrame: ExcalidrawElement[],
  frame: ExcalidrawFrameLikeElement,
): T[] => {
  return addElementsToFrame(
    removeAllElementsFromFrame(allElements, frame),
    nextElementsInFrame,
    frame,
  ).slice();
};

/** does not mutate elements, but returns new ones */
export const updateFrameMembershipOfSelectedElements = <
  T extends ElementsMapOrArray,
>(
  allElements: T,
  appState: AppState,
  app: AppClassProperties,
) => {
  const selectedElements = app.scene.getSelectedElements({
    selectedElementIds: appState.selectedElementIds,
    // supplying elements explicitly in case we're passed non-state elements
    elements: allElements,
  });
  const elementsToFilter = new Set<ExcalidrawElement>(selectedElements);

  if (appState.editingGroupId) {
    for (const element of selectedElements) {
      if (element.groupIds.length === 0) {
        elementsToFilter.add(element);
      } else {
        element.groupIds
          .flatMap((gid) => getElementsInGroup(allElements, gid))
          .forEach((element) => elementsToFilter.add(element));
      }
    }
  }

  const elementsToRemove = new Set<ExcalidrawElement>();

  const elementsMap = arrayToMap(allElements);

  elementsToFilter.forEach((element) => {
    if (
      // a tableCell ref names the direct parent cell: membership is
      // re-judged only by an explicit drop, handled by the cell commit in
      // the caller (`updateTableCellMembershipOfSelectedElements`). Frames
      // must not absorb tableCell chains via `getContainingFrame` ascent.
      element.containerRef?.kind === "tableCell"
    ) {
      return;
    }
    if (
      element.containerRef?.elementId &&
      !isFrameLikeElement(element) &&
      !isElementInFrame(element, elementsMap, appState)
    ) {
      elementsToRemove.add(element);
    }
  });

  if (elementsToRemove.size > 0) {
    removeElementsFromFrame(elementsToRemove, elementsMap);
  }
  return allElements;
};

/**
 * filters out elements that are inside groups that contain a frame element
 * anywhere in the group tree
 */
export const omitGroupsContainingFrameLikes = (
  allElements: ElementsMapOrArray,
  /** subset of elements you want to filter. Optional perf optimization so we
   * don't have to filter all elements unnecessarily
   */
  selectedElements?: readonly ExcalidrawElement[],
) => {
  const uniqueGroupIds = new Set<string>();
  const elements = selectedElements || allElements;

  for (const el of elements.values()) {
    const topMostGroupId = el.groupIds[el.groupIds.length - 1];
    if (topMostGroupId) {
      uniqueGroupIds.add(topMostGroupId);
    }
  }

  const rejectedGroupIds = new Set<string>();
  for (const groupId of uniqueGroupIds) {
    if (
      getElementsInGroup(allElements, groupId).some((el) =>
        isFrameLikeElement(el),
      )
    ) {
      rejectedGroupIds.add(groupId);
    }
  }

  const ret: ExcalidrawElement[] = [];

  for (const element of elements.values()) {
    if (!rejectedGroupIds.has(element.groupIds[element.groupIds.length - 1])) {
      ret.push(element);
    }
  }

  return ret;
};

/**
 * depending on the appState, return target frame, which is the frame the given element
 * is going to be added to or remove from
 */
export const getTargetFrame = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  appState: StaticCanvasAppState,
) => {
  const _element = isTextElement(element)
    ? getContainerElement(element, elementsMap) || element
    : element;

  // if the element and its containing frame are both selected, then
  // the containing frame is the target frame
  if (
    _element.containerRef?.elementId &&
    appState.selectedElementIds[_element.id] &&
    appState.selectedElementIds[_element.containerRef?.elementId]
  ) {
    return getContainingFrame(_element, elementsMap);
  }

  return appState.selectedElementIds[_element.id] &&
    appState.selectedElementsAreBeingDragged
    ? appState.frameToHighlight
    : getContainingFrame(_element, elementsMap);
};

// TODO: this a huge bottleneck for large scenes, optimise
// given an element, return if the element is in some frame
export const isElementInFrame = (
  element: ExcalidrawElement,
  allElementsMap: ElementsMap,
  appState: StaticCanvasAppState,
  opts?: {
    targetFrame?: ExcalidrawFrameLikeElement;
    checkedGroups?: Map<string, boolean>;
  },
) => {
  const frame =
    opts?.targetFrame ?? getTargetFrame(element, allElementsMap, appState);

  if (!frame) {
    return false;
  }

  const _element = isTextElement(element)
    ? getContainerElement(element, allElementsMap) || element
    : element;

  const setGroupsInFrame = (isInFrame: boolean) => {
    if (opts?.checkedGroups) {
      _element.groupIds.forEach((groupId) => {
        opts.checkedGroups?.set(groupId, isInFrame);
      });
    }
  };

  if (
    // if the element is not selected, or it is selected but not being dragged,
    // frame membership won't update, so return true
    !appState.selectedElementIds[_element.id] ||
    !appState.selectedElementsAreBeingDragged ||
    // if both frame and element are selected, won't update membership, so return true
    (appState.selectedElementIds[_element.id] &&
      appState.selectedElementIds[frame.id])
  ) {
    return true;
  }

  if (_element.groupIds.length === 0) {
    return elementOverlapsWithFrame(_element, frame, allElementsMap);
  }

  for (const gid of _element.groupIds) {
    if (opts?.checkedGroups?.has(gid)) {
      return opts.checkedGroups.get(gid)!!;
    }
  }

  const allElementsInGroup = new Set(
    _element.groupIds
      .filter((gid) => {
        if (opts?.checkedGroups) {
          return !opts.checkedGroups.has(gid);
        }
        return true;
      })
      .flatMap((gid) => getElementsInGroup(allElementsMap, gid)),
  );

  if (appState.editingGroupId && appState.selectedElementsAreBeingDragged) {
    const selectedElements = new Set(
      getSelectedElements(allElementsMap, appState),
    );

    const editingGroupOverlapsFrame = appState.frameToHighlight !== null;

    if (editingGroupOverlapsFrame) {
      return true;
    }

    selectedElements.forEach((selectedElement) => {
      allElementsInGroup.delete(selectedElement);
    });
  }

  for (const elementInGroup of allElementsInGroup) {
    if (isFrameLikeElement(elementInGroup)) {
      setGroupsInFrame(false);
      return false;
    }
  }

  for (const elementInGroup of allElementsInGroup) {
    if (elementOverlapsWithFrame(elementInGroup, frame, allElementsMap)) {
      setGroupsInFrame(true);
      return true;
    }
  }

  return false;
};

export const shouldApplyFrameClip = (
  element: ExcalidrawElement,
  frame: ExcalidrawFrameLikeElement,
  appState: StaticCanvasAppState,
  elementsMap: ElementsMap,
  checkedGroups?: Map<string, boolean>,
) => {
  if (!appState.frameRendering || !appState.frameRendering.clip) {
    return false;
  }

  // for individual elements, only clip when the element is
  // a. overlapping with the frame, or
  // b. containing the frame, for example when an element is used as a background
  //    and is therefore bigger than the frame and completely contains the frame
  const shouldClipElementItself =
    isElementIntersectingFrame(element, frame, elementsMap) ||
    isElementContainingFrame(element, frame, elementsMap);

  if (shouldClipElementItself) {
    for (const groupId of element.groupIds) {
      checkedGroups?.set(groupId, true);
    }

    return true;
  }

  // if an element is outside the frame, but is part of a group that has some elements
  // "in" the frame, we should clip the element
  if (
    !shouldClipElementItself &&
    element.groupIds.length > 0 &&
    !elementsAreInFrameBounds([element], frame, elementsMap)
  ) {
    let shouldClip = false;

    // if no elements are being dragged, we can skip the geometry check
    // because we know if the element is in the given frame or not
    if (!appState.selectedElementsAreBeingDragged) {
      shouldClip = element.containerRef?.elementId === frame.id;
      for (const groupId of element.groupIds) {
        checkedGroups?.set(groupId, shouldClip);
      }
    } else {
      shouldClip = isElementInFrame(element, elementsMap, appState, {
        targetFrame: frame,
        checkedGroups,
      });
    }

    for (const groupId of element.groupIds) {
      checkedGroups?.set(groupId, shouldClip);
    }

    return shouldClip;
  }

  return false;
};

const DEFAULT_FRAME_NAME = "Frame";
const DEFAULT_AI_FRAME_NAME = "AI Frame";

export const getDefaultFrameName = (element: ExcalidrawFrameLikeElement) => {
  // TODO name frames "AI" only if specific to AI frames
  return isFrameElement(element) ? DEFAULT_FRAME_NAME : DEFAULT_AI_FRAME_NAME;
};

export const getFrameLikeTitle = (element: ExcalidrawFrameLikeElement) => {
  return element.name === null ? getDefaultFrameName(element) : element.name;
};

export const getElementsOverlappingFrame = <T extends ExcalidrawElement>(
  elements: readonly T[],
  frame: ExcalidrawFrameLikeElement,
  elementsMap: ElementsMap,
) => {
  const frameBounds = getElementBounds(frame, elementsMap);
  return elements.filter((element) => {
    // An overlapping label inherits its host's frame even without its own ref.
    const containingFrame = getContainingFrame(element, elementsMap);
    return (
      (!containingFrame || containingFrame.id === frame.id) &&
      doBoundsIntersect(getElementBounds(element, elementsMap), frameBounds)
    );
  });
};

export const frameAndChildrenSelectedTogether = (
  selectedElements: readonly ExcalidrawElement[],
) => {
  const selectedElementsMap = arrayToMap(selectedElements);

  return (
    selectedElements.length > 1 &&
    selectedElements.some(
      (element) =>
        element.containerRef?.elementId &&
        selectedElementsMap.has(element.containerRef?.elementId),
    )
  );
};
