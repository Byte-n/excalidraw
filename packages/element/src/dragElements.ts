import {
  type Bounds,
  TEXT_AUTOWRAP_THRESHOLD,
  getGridPoint,
  getFontString,
  DRAGGING_THRESHOLD,
} from "@excalidraw/common";

import type {
  AppState,
  NormalizedZoomValue,
  NullableGridSize,
  PointerDownState,
} from "@excalidraw/excalidraw/types";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { unbindBindingElement, updateBoundElements } from "./binding";
import { getCommonBounds } from "./bounds";
import { getIndexedFrameChildren } from "./frameChildrenIndex";
import {
  detachSequenceActivation,
  getSequenceActivationLink,
  getSequenceActivationDragPlacement,
  syncLifelineBoundActivation,
  updateSequenceActivationsForLifeline,
} from "./sequenceActivation";
import {
  isActivationElement,
  isSequenceLifelineElement,
} from "./compositeShape";

import { getPerfectElementSize } from "./sizeHelpers";
import { getBoundTextElement } from "./textElement";
import { getMinTextElementWidth } from "./textMeasurements";
import {
  isArrowElement,
  isElbowArrow,
  isFrameLikeElement,
  isImageElement,
  isTableElement,
  isTextElement,
} from "./typeChecks";

import type { SequenceActivationElement } from "./sequenceActivation";

import type { Scene } from "./Scene";

import type { ExcalidrawElement, ExcalidrawTextElement } from "./types";

export const dragSelectedElements = (
  pointerDownState: PointerDownState,
  _selectedElements: NonDeletedExcalidrawElement[],
  offset: { x: number; y: number },
  scene: Scene,
  snapOffset: {
    x: number;
    y: number;
  },
  gridSize: NullableGridSize,
) => {
  if (
    _selectedElements.length === 1 &&
    isElbowArrow(_selectedElements[0]) &&
    (_selectedElements[0].startBinding || _selectedElements[0].endBinding)
  ) {
    return;
  }

  const selectedElements = _selectedElements.filter((element) => {
    if (isElbowArrow(element) && element.startBinding && element.endBinding) {
      const startElement = _selectedElements.find(
        (el) => el.id === element.startBinding?.elementId,
      );
      const endElement = _selectedElements.find(
        (el) => el.id === element.endBinding?.elementId,
      );

      return startElement && endElement;
    }

    return true;
  });

  // we do not want a frame and its elements to be selected at the same time
  // but when it happens (due to some bug), we want to avoid updating element
  // in the frame twice, hence the use of set
  const elementsToUpdate = new Set<NonDeletedExcalidrawElement>(
    selectedElements,
  );
  // frame-like containers and tables move their direct members with them;
  // tables and frames nest (a frame may sit in a table cell), so keep
  // descending until the subtree is closed — every element is still
  // transformed exactly once (phase-1.md:60)
  const containers = new Set(
    selectedElements
      .filter(
        (element) => isFrameLikeElement(element) || isTableElement(element),
      )
      .map((element) => element.id),
  );
  if (containers.size > 0) {
    const elementsMap = scene.getNonDeletedElementsMap();
    let frontier = [...containers];
    while (frontier.length > 0) {
      const nextFrontier: string[] = [];
      for (const containerId of frontier) {
        // the map is non-deleted, so the indexed members are non-deleted too
        const members = getIndexedFrameChildren(
          elementsMap,
          containerId,
        ) as NonDeletedExcalidrawElement[];
        for (const member of members) {
          if (elementsToUpdate.has(member)) {
            continue;
          }
          elementsToUpdate.add(member);
          if (isTableElement(member) || isFrameLikeElement(member)) {
            containers.add(member.id);
            nextFrontier.push(member.id);
          }
        }
      }
      frontier = nextFrontier;
    }
  }

  const origElements: ExcalidrawElement[] = [];

  for (const element of elementsToUpdate) {
    const origElement = pointerDownState.originalElements.get(element.id);
    // if original element is not set (e.g. when you duplicate during a drag
    // operation), exit to avoid undefined behavior
    if (!origElement) {
      return;
    }
    origElements.push(origElement);
  }

  const adjustedOffset = calculateOffset(
    getCommonBounds(origElements),
    offset,
    snapOffset,
    gridSize,
  );

  const elementsToUpdateIds = new Set(
    Array.from(elementsToUpdate, (el) => el.id),
  );

  elementsToUpdate.forEach((element) => {
    const isArrow = !isArrowElement(element);
    const isStartBoundElementSelected =
      isArrow ||
      (element.startBinding
        ? elementsToUpdateIds.has(element.startBinding.elementId)
        : false);
    const isEndBoundElementSelected =
      isArrow ||
      (element.endBinding
        ? elementsToUpdateIds.has(element.endBinding.elementId)
        : false);

    if (!isArrowElement(element)) {
      updateElementCoords(
        pointerDownState,
        element,
        scene,
        adjustedOffset,
        elementsToUpdateIds,
      );

      // skip arrow labels since we calculate its position during render
      const textElement = getBoundTextElement(
        element,
        scene.getNonDeletedElementsMap(),
      );
      if (textElement) {
        updateElementCoords(
          pointerDownState,
          textElement,
          scene,
          adjustedOffset,
          elementsToUpdateIds,
        );
      }
      updateBoundElements(element, scene, {
        simultaneouslyUpdatedElementIds: elementsToUpdateIds,
      });
    } else if (
      // NOTE: Add a little initial drag to the arrow dragging when the arrow
      // is the single element being dragged to avoid accidentally unbinding
      // the arrow when the user just wants to select it.

      elementsToUpdate.size > 1 ||
      Math.max(Math.abs(adjustedOffset.x), Math.abs(adjustedOffset.y)) >
        DRAGGING_THRESHOLD ||
      (!element.startBinding && !element.endBinding)
    ) {
      updateElementCoords(
        pointerDownState,
        element,
        scene,
        adjustedOffset,
        elementsToUpdateIds,
      );

      const shouldUnbindStart =
        element.startBinding && !isStartBoundElementSelected;
      const shouldUnbindEnd = element.endBinding && !isEndBoundElementSelected;
      if (shouldUnbindStart || shouldUnbindEnd) {
        // NOTE: Moving the bound arrow should unbind it, otherwise we would
        // have weird situations, like 0 lenght arrow when the user moves
        // the arrow outside a filled shape suddenly forcing the arrow start
        // and end point to jump "outside" the shape.
        if (shouldUnbindStart) {
          unbindBindingElement(element, "start", scene);
        }
        if (shouldUnbindEnd) {
          unbindBindingElement(element, "end", scene);
        }
      }
    }
  });

  // 收尾 pass：生命线与激活条同时被拖时，等所有元素都落位后统一重排一次，
  // 结果与「只拖生命线」完全一致（不受 Set 迭代顺序影响）。
  elementsToUpdate.forEach((element) => {
    const latest = scene.getNonDeletedElement(element.id);
    if (latest && isSequenceLifelineElement(latest)) {
      updateSequenceActivationsForLifeline(latest, scene);
    }
  });
};

const calculateOffset = (
  commonBounds: Bounds,
  dragOffset: { x: number; y: number },
  snapOffset: { x: number; y: number },
  gridSize: NullableGridSize,
): { x: number; y: number } => {
  const [x, y] = commonBounds;
  let nextX = x + dragOffset.x + snapOffset.x;
  let nextY = y + dragOffset.y + snapOffset.y;

  if (snapOffset.x === 0 || snapOffset.y === 0) {
    const [nextGridX, nextGridY] = getGridPoint(
      x + dragOffset.x,
      y + dragOffset.y,
      gridSize,
    );

    if (snapOffset.x === 0) {
      nextX = nextGridX;
    }

    if (snapOffset.y === 0) {
      nextY = nextGridY;
    }
  }
  return {
    x: nextX - x,
    y: nextY - y,
  };
};

const updateElementCoords = (
  pointerDownState: PointerDownState,
  element: ExcalidrawElement,
  scene: Scene,
  dragOffset: { x: number; y: number },
  simultaneouslyUpdatedElementIds?: ReadonlySet<string>,
) => {
  const originalElement =
    pointerDownState.originalElements.get(element.id) ?? element;

  const nextX = originalElement.x + dragOffset.x;
  const nextY = originalElement.y + dragOffset.y;

  // 激活条：靠近生命线杆时横向吸附到杆中心并建立 / 更新绑定；拖离阈值则解绑。
  if (isActivationElement(originalElement) && isActivationElement(element)) {
    const link = getSequenceActivationLink(originalElement);
    // 生命线与激活条同时被拖：让生命线的收尾 pass 统一重排，避免逐个更新时
    // 读到一半新一半旧的坐标。
    if (link && simultaneouslyUpdatedElementIds?.has(link.lifelineId)) {
      return;
    }
    const placement = getSequenceActivationDragPlacement(
      scene.getNonDeletedElementsMap(),
      nextX + element.width / 2,
      nextY + element.height / 2,
      element.height,
    );
    if (placement.snap) {
      const lifeline = placement.snap.lifeline;
      scene.mutateElement(element, {
        x: placement.center.x - element.width / 2,
        y: placement.center.y - element.height / 2,
        angle: placement.snap.angle,
        shape: {
          ...element.shape,
          link: {
            lifelineId: lifeline.id,
            localY: placement.snap.localY,
          },
        },
      });
      syncLifelineBoundActivation(
        element.id,
        lifeline,
        link?.lifelineId,
        scene,
      );
    } else {
      if (link) {
        detachSequenceActivation(element as SequenceActivationElement, scene);
      }
      scene.mutateElement(element, { x: nextX, y: nextY });
    }
    return;
  }

  scene.mutateElement(element, {
    x: nextX,
    y: nextY,
  });
};

export const getDragOffsetXY = (
  selectedElements: NonDeletedExcalidrawElement[],
  x: number,
  y: number,
): [number, number] => {
  const [x1, y1] = getCommonBounds(selectedElements);
  return [x - x1, y - y1];
};

/**
 * Sizes a text element as it is dragged out.
 *
 * A dragged text pins one point and grows away from it; `anchorRatio` says
 * where along the box that point sits — 0 for its left edge, 1 for its right,
 * 0.5 for its centre.
 *
 * A free text pins the point the drag started from and takes the ratio from
 * the drag direction, so it can be pulled either way. A text bound to an arrow
 * endpoint instead pins whatever the binding placed it against and takes the
 * ratio from its alignment — which is also what keeps it from growing back
 * over the arrow, since dragging that way makes no progress rather than
 * flipping the box around.
 */
export const dragNewTextElement = ({
  newElement,
  anchorX,
  anchorRatio,
  pointerX,
  nextY,
  zoom,
  scene,
  informMutation = true,
}: {
  newElement: ExcalidrawTextElement;
  anchorX: number;
  /** 0 = anchored by its left edge, 1 = by its right, 0.5 = by its centre */
  anchorRatio: number;
  pointerX: number;
  /** free text re-tops itself to the drag origin; a bound one must not move */
  nextY?: number;
  zoom: NormalizedZoomValue;
  scene: Scene;
  informMutation?: boolean;
}) => {
  const offset = pointerX - anchorX;

  // how far the pointer has travelled away from the anchor along the direction
  // the box may grow — negative once it heads back the other way
  const reach =
    anchorRatio === 0 ? offset : anchorRatio === 1 ? -offset : Math.abs(offset);

  const width = Math.max(
    // a centred box grows on both sides, so it widens at twice the reach
    anchorRatio === 0.5 ? reach * 2 : reach,
    getMinTextElementWidth(
      getFontString({
        fontSize: newElement.fontSize,
        fontFamily: newElement.fontFamily,
      }),
      newElement.lineHeight,
    ),
  );

  scene.mutateElement(
    newElement,
    {
      x: anchorX - width * anchorRatio,
      ...(nextY === undefined ? {} : { y: nextY }),
      width,
      ...(reach > TEXT_AUTOWRAP_THRESHOLD / zoom ? { autoResize: false } : {}),
    },
    { informMutation, isDragging: false },
  );
};

export const dragNewElement = ({
  newElement,
  elementType,
  originX,
  originY,
  x,
  y,
  width,
  height,
  shouldMaintainAspectRatio,
  shouldResizeFromCenter,
  zoom,
  scene,
  widthAspectRatio = null,
  originOffset = null,
  informMutation = true,
}: {
  newElement: NonDeletedExcalidrawElement;
  elementType: AppState["activeTool"]["type"];
  originX: number;
  originY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  shouldMaintainAspectRatio: boolean;
  shouldResizeFromCenter: boolean;
  zoom: NormalizedZoomValue;
  scene: Scene;
  /** whether to keep given aspect ratio when `isResizeWithSidesSameLength` is
      true */
  widthAspectRatio?: number | null;
  originOffset?: {
    x: number;
    y: number;
  } | null;
  informMutation?: boolean;
}) => {
  if (shouldMaintainAspectRatio && newElement.type !== "selection") {
    if (widthAspectRatio) {
      height = width / widthAspectRatio;
    } else {
      // Depending on where the cursor is at (x, y) relative to where the starting point is
      // (originX, originY), we use ONLY width or height to control size increase.
      // This allows the cursor to always "stick" to one of the sides of the bounding box.
      if (Math.abs(y - originY) > Math.abs(x - originX)) {
        ({ width, height } = getPerfectElementSize(
          elementType,
          height,
          x < originX ? -width : width,
        ));
      } else {
        ({ width, height } = getPerfectElementSize(
          elementType,
          width,
          y < originY ? -height : height,
        ));
      }

      if (height < 0) {
        height = -height;
      }
    }
  }

  if (isTextElement(newElement)) {
    // a text is only ever sized horizontally — its height follows the wrapped
    // content — so it grows away from the point the drag started at
    dragNewTextElement({
      newElement,
      anchorX: originX + (originOffset?.x ?? 0),
      anchorRatio: shouldResizeFromCenter ? 0.5 : x < originX ? 1 : 0,
      pointerX: x,
      nextY: originY + (originOffset?.y ?? 0),
      zoom,
      scene,
      informMutation,
    });
    return;
  }

  let newX = x < originX ? originX - width : originX;
  let newY = y < originY ? originY - height : originY;

  if (shouldResizeFromCenter) {
    width += width;
    height += height;
    newX = originX - width / 2;
    newY = originY - height / 2;
  }

  if (width !== 0 && height !== 0) {
    let imageInitialDimension = null;
    if (isImageElement(newElement)) {
      imageInitialDimension = {
        initialWidth: width,
        initialHeight: height,
      };
    }

    scene.mutateElement(
      newElement,
      {
        x: newX + (originOffset?.x ?? 0),
        y: newY + (originOffset?.y ?? 0),
        width,
        height,
        ...imageInitialDimension,
      },
      { informMutation, isDragging: false },
    );
  }
};
