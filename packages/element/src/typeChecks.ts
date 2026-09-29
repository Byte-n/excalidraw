import { ROUNDNESS, assertNever } from "@excalidraw/common";

import { pointsEqual } from "@excalidraw/math";

import type { ElementOrToolType } from "@excalidraw/excalidraw/types";

import type { MarkNonNullable } from "@excalidraw/common/utility-types";

import { assertBaseShapeData } from "./compositeShape";
import { assertMindmapShapeData } from "./mindmap";
import { assertValidTableData } from "./tableStruct";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTextElement,
  ExcalidrawEmbeddableElement,
  ExcalidrawLinearElement,
  ExcalidrawBindableElement,
  ExcalidrawFreeDrawElement,
  InitializedExcalidrawImageElement,
  ExcalidrawImageElement,
  ExcalidrawTextElementWithContainer,
  ExcalidrawTextContainer,
  ExcalidrawFrameElement,
  RoundnessType,
  ExcalidrawFrameLikeElement,
  ExcalidrawElementType,
  ExcalidrawIframeElement,
  ExcalidrawIframeLikeElement,
  ExcalidrawMagicFrameElement,
  ExcalidrawArrowElement,
  ExcalidrawElbowArrowElement,
  ExcalidrawLineElement,
  ExcalidrawFlowchartNodeElement,
  ExcalidrawLinearElementSubType,
  ExcalidrawStickyNoteElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawMindmapEdgeElement,
  DirectContainerRef,
  TableCellContainerRef,
  ExcalidrawTableElement,
} from "./types";

export const isInitializedImageElement = <T extends ExcalidrawElement>(
  element: T | null,
): element is T & InitializedExcalidrawImageElement => {
  return !!element && element.type === "image" && !!element.fileId;
};

export const isImageElement = <T extends ExcalidrawElement>(
  element: T | null,
): element is T & ExcalidrawImageElement => {
  return !!element && element.type === "image";
};

export const isEmbeddableElement = <T extends ExcalidrawElement>(
  element: T | null | undefined,
): element is T & ExcalidrawEmbeddableElement => {
  return !!element && element.type === "embeddable";
};

export const isIframeElement = <T extends ExcalidrawElement>(
  element: T | null,
): element is T & ExcalidrawIframeElement => {
  return !!element && element.type === "iframe";
};

export const isIframeLikeElement = <T extends ExcalidrawElement>(
  element: T | null,
): element is T & ExcalidrawIframeLikeElement => {
  return (
    !!element && (element.type === "iframe" || element.type === "embeddable")
  );
};

export const isTextElement = <T extends ExcalidrawElement>(
  element: T | null,
): element is T & ExcalidrawTextElement => {
  return element != null && element.type === "text";
};

export const isStickyNoteElement = <T extends ExcalidrawElement>(
  element: T | null | undefined,
): element is T & ExcalidrawStickyNoteElement => {
  return element != null && element.type === "stickynote";
};

export const isMindmapNodeElement = <T extends ExcalidrawElement>(
  element: T | null | undefined,
): element is T & ExcalidrawMindmapNodeElement =>
  element?.type === "mindmap-node";

export const isMindmapEdgeElement = <T extends ExcalidrawElement>(
  element: T | null | undefined,
): element is T & ExcalidrawMindmapEdgeElement =>
  element?.type === "mindmap-edge";

export const isFrameElement = <T extends ExcalidrawElement>(
  element: T | null,
): element is T & ExcalidrawFrameElement => {
  return element != null && element.type === "frame";
};

export const isMagicFrameElement = <T extends ExcalidrawElement>(
  element: T | null,
): element is T & ExcalidrawMagicFrameElement => {
  return element != null && element.type === "magicframe";
};

export const isFrameLikeElement = <T extends ExcalidrawElement>(
  element: T | null,
): element is T & ExcalidrawFrameLikeElement => {
  return (
    element != null &&
    (element.type === "frame" || element.type === "magicframe")
  );
};

export const isTableElement = <T extends ExcalidrawElement>(
  element: T | null | undefined,
): element is T & ExcalidrawTableElement => {
  return element?.type === "table";
};

/**
 * A cell's background text. Outside of its editor it is chrome, not a canvas
 * object: hit-testing, box/lasso selection and dragging pass through it so it
 * never blocks the cell's other content (phase-1.md:67, :141).
 */
export const isTableCellBackgroundText = <T extends ExcalidrawElement>(
  element: T | null | undefined,
): boolean =>
  element?.containerRef?.kind === "tableCell" &&
  element.containerRef.role === "backgroundText";

export const frameLikeContainerRef = (elementId: string | null | undefined) => {
  if (elementId == null) {
    return undefined;
  }
  if (typeof elementId !== "string" || elementId.length === 0) {
    throw new Error("Invalid frame-like container ID");
  }
  return { kind: "frameLike", elementId } as const;
};

const assertValidTableCellRef = (
  element: ExcalidrawElement,
  containerRef: TableCellContainerRef,
  parent: ExcalidrawElement,
): void => {
  if (!isTableElement(parent)) {
    throw new Error(
      `Invalid table cell container reference on ${element.id}: ${containerRef.elementId}`,
    );
  }
  if (
    typeof containerRef.cellId !== "string" ||
    containerRef.cellId.length === 0 ||
    !parent.table.cells.some((cell) => cell.id === containerRef.cellId)
  ) {
    throw new Error(
      `Invalid table cell container reference on ${element.id}: ${containerRef.cellId}`,
    );
  }
  if (containerRef.role === "backgroundText") {
    if (!isTextElement(element)) {
      throw new Error(
        `Table cell background text ${element.id} must be a text element`,
      );
    }
    if (element.containerId) {
      throw new Error(`Bound text ${element.id} cannot have a containerRef`);
    }
    return;
  }
  if (containerRef.role !== "content") {
    throw new Error(
      `Unsupported table cell role: ${String(containerRef.role)}`,
    );
  }
};

/**
 * Single-element container reference check against a scene snapshot.
 * The scene-wide counterpart is `assertValidContainerRefs`.
 */
export const validateContainerRef = (
  element: ExcalidrawElement,
  containerRef: DirectContainerRef | null | undefined,
  elementsMap: ElementsMap,
): void => {
  if (!containerRef || typeof containerRef !== "object") {
    throw new Error(`Invalid container reference on ${element.id}`);
  }
  if (
    typeof containerRef.elementId !== "string" ||
    containerRef.elementId.length === 0
  ) {
    throw new Error(`Invalid container reference on ${element.id}`);
  }
  if (isTextElement(element) && element.containerId) {
    throw new Error(`Bound text ${element.id} cannot have a containerRef`);
  }
  // A frame-like may sit in a table cell (a `tableCell` ref names its direct
  // parent, phase-1.md:60); what stays forbidden is a frame-like nesting in
  // another frame-like (P0 semantics).
  if (isFrameLikeElement(element) && containerRef.kind === "frameLike") {
    throw new Error(
      `Frame-like element ${element.id} cannot have a frame-like parent`,
    );
  }
  const parent = elementsMap.get(containerRef.elementId);
  if (containerRef.kind === "frameLike") {
    if (!parent || parent.isDeleted || !isFrameLikeElement(parent)) {
      throw new Error(
        `Invalid frame-like container reference on ${element.id}: ${containerRef.elementId}`,
      );
    }
    return;
  }
  if (containerRef.kind === "tableCell") {
    if (!parent || parent.isDeleted) {
      throw new Error(
        `Invalid container reference on ${element.id}: ${containerRef.elementId}`,
      );
    }
    assertValidTableCellRef(element, containerRef, parent);
    return;
  }
  // untrusted data can carry any kind; the known ones are handled above
  throw new Error(
    `Unsupported container kind: ${String(
      (containerRef as { kind: unknown }).kind,
    )}`,
  );
};

const assertSingleBackgroundTextPerCell = (
  elements: readonly ExcalidrawElement[],
) => {
  const seen = new Set<string>();
  for (const element of elements) {
    const containerRef = element.containerRef;
    if (
      element.isDeleted ||
      containerRef?.kind !== "tableCell" ||
      containerRef.role !== "backgroundText"
    ) {
      continue;
    }
    const key = `${containerRef.elementId}\u0000${containerRef.cellId}`;
    if (seen.has(key)) {
      throw new Error(
        `Cell ${containerRef.cellId} of table ${containerRef.elementId} already has background text`,
      );
    }
    seen.add(key);
  }
};

/**
 * The parent chain must stay acyclic. Every `containerRef` edge participates,
 * including a frame-like's `tableCell` edge (a frame may sit in a cell);
 * tableCell and frameLike edges alike are followed until a parentless
 * element closes the walk. Cycles are only detectable scene-wide, which is
 * why this stays a scene-level assertion.
 */
const assertAcyclicContainerRefs = (
  elementsById: Map<string, ExcalidrawElement>,
) => {
  for (const element of elementsById.values()) {
    if (!element.containerRef) {
      continue;
    }
    const visited = new Set<string>([element.id]);
    let current = elementsById.get(element.containerRef.elementId);
    while (current) {
      if (visited.has(current.id)) {
        throw new Error(`Container reference cycle detected at ${element.id}`);
      }
      visited.add(current.id);
      current = current.containerRef
        ? elementsById.get(current.containerRef.elementId)
        : undefined;
    }
  }
};

export const assertValidContainerRefs = (
  elements: readonly ExcalidrawElement[],
) => {
  const elementsById = new Map(
    elements.map((element) => [element.id, element]),
  );

  for (const element of elements) {
    if (element.isDeleted || element.containerRef === undefined) {
      continue;
    }
    validateContainerRef(element, element.containerRef, elementsById);
  }

  assertSingleBackgroundTextPerCell(elements);
  assertAcyclicContainerRefs(elementsById);
};

export const isFreeDrawElement = <T extends ExcalidrawElement>(
  element?: T | null,
): element is T & ExcalidrawFreeDrawElement => {
  return element != null && isFreeDrawElementType(element.type);
};

export const isFreeDrawElementType = (
  elementType: ExcalidrawElementType,
): boolean => {
  return elementType === "freedraw";
};

export const isLinearElement = <T extends ExcalidrawElement>(
  element?: T | null,
): element is T & ExcalidrawLinearElement => {
  return element != null && isLinearElementType(element.type);
};

export const isLineElement = <T extends ExcalidrawElement>(
  element?: T | null,
): element is T & ExcalidrawLineElement => {
  return element != null && element.type === "line";
};

export const isArrowElement = <T extends ExcalidrawElement>(
  element?: T | null,
): element is T & ExcalidrawArrowElement => {
  return element != null && element.type === "arrow";
};

export const isElbowArrow = <T extends ExcalidrawElement>(
  element?: T,
): element is T & ExcalidrawElbowArrowElement => {
  return isArrowElement(element) && element.elbowed;
};

/**
 * sharp or curved arrow, but not elbow
 */
export const isSimpleArrow = <T extends ExcalidrawElement>(
  element?: T,
): element is T & ExcalidrawArrowElement => {
  return isArrowElement(element) && !element.elbowed;
};

export const isSharpArrow = <T extends ExcalidrawElement>(
  element?: T,
): element is T & ExcalidrawArrowElement => {
  return isArrowElement(element) && !element.elbowed && !element.roundness;
};

export const isCurvedArrow = <T extends ExcalidrawElement>(
  element?: T,
): element is T & ExcalidrawArrowElement => {
  return (
    isArrowElement(element) && !element.elbowed && element.roundness !== null
  );
};

export const isLinearElementType = (
  elementType: ElementOrToolType,
): boolean => {
  return (
    elementType === "arrow" || elementType === "line" // || elementType === "freedraw"
  );
};

export const isBindingElement = <T extends ExcalidrawElement>(
  element?: T | null,
  includeLocked = true,
): element is T & ExcalidrawArrowElement => {
  return (
    element != null &&
    (!element.locked || includeLocked === true) &&
    isBindingElementType(element.type)
  );
};

export const isBindingElementType = (
  elementType: ElementOrToolType,
): boolean => {
  return elementType === "arrow";
};

export const isBindableElement = <T extends ExcalidrawElement>(
  element: T | null | undefined,
  includeLocked = true,
): element is T & ExcalidrawBindableElement => {
  return (
    element != null &&
    (!element.locked || includeLocked === true) &&
    (element.type === "composite_shape" ||
      element.type === "stickynote" ||
      element.type === "mindmap-node" ||
      element.type === "image" ||
      element.type === "iframe" ||
      element.type === "embeddable" ||
      element.type === "frame" ||
      element.type === "magicframe" ||
      (element.type === "text" && !element.containerId))
  );
};

export const isRectanguloidElement = <T extends ExcalidrawElement>(
  element?: T | null,
): element is T & ExcalidrawBindableElement => {
  return (
    element != null &&
    ((element.type === "composite_shape" && element.shape.id !== "ellipse") ||
      element.type === "stickynote" ||
      element.type === "image" ||
      element.type === "iframe" ||
      element.type === "embeddable" ||
      element.type === "frame" ||
      element.type === "magicframe" ||
      (element.type === "text" && !element.containerId))
  );
};

// TODO: Remove this when proper distance calculation is introduced
// @see binding.ts:distanceToBindableElement()
export const isRectangularElement = <T extends ExcalidrawElement>(
  element?: T | null,
): element is T & ExcalidrawBindableElement => {
  return (
    element != null &&
    ((element.type === "composite_shape" && element.shape.id === "rectangle") ||
      element.type === "stickynote" ||
      element.type === "image" ||
      element.type === "text" ||
      element.type === "iframe" ||
      element.type === "embeddable" ||
      element.type === "frame" ||
      element.type === "magicframe" ||
      element.type === "freedraw")
  );
};

export const isTextBindableContainer = <T extends ExcalidrawElement>(
  element: T | null,
  includeLocked = true,
): element is T & ExcalidrawTextContainer => {
  return (
    element != null &&
    (!element.locked || includeLocked === true) &&
    (element.type === "composite_shape" ||
      element.type === "stickynote" ||
      element.type === "mindmap-node" ||
      isArrowElement(element))
  );
};

export const isExcalidrawElement = (
  element: any,
): element is ExcalidrawElement => {
  const type: ExcalidrawElementType | undefined = element?.type;
  if (!type) {
    return false;
  }
  switch (type) {
    case "composite_shape":
      assertBaseShapeData(element.shape);
      return true;
    case "mindmap-node":
      assertMindmapShapeData(element.shape);
      return true;
    case "table":
      assertValidTableData(element.table);
      return true;
    case "text":
    case "stickynote":
    case "mindmap-edge":
    case "iframe":
    case "embeddable":
    case "arrow":
    case "freedraw":
    case "line":
    case "frame":
    case "magicframe":
    case "image":
    case "selection": {
      return true;
    }
    default: {
      assertNever(type, null);
      return false;
    }
  }
};

export const isFlowchartNodeElement = <T extends ExcalidrawElement>(
  element: T,
): element is T & ExcalidrawFlowchartNodeElement => {
  return element.type === "composite_shape" || element.type === "stickynote";
};

export const hasBoundTextElement = <T extends ExcalidrawElement>(
  element: T | null,
): element is T &
  MarkNonNullable<ExcalidrawBindableElement, "boundElements"> => {
  return (
    isTextBindableContainer(element) &&
    !!element.boundElements?.some(({ type }) => type === "text")
  );
};

export const isBoundToContainer = <T extends ExcalidrawElement>(
  element: T | null,
): element is T & ExcalidrawTextElementWithContainer => {
  return (
    element !== null &&
    "containerId" in element &&
    element.containerId !== null &&
    isTextElement(element)
  );
};

export const isArrowBoundToElement = (element: ExcalidrawArrowElement) => {
  return !!element.startBinding || !!element.endBinding;
};

export const isUsingAdaptiveRadius = (type: string) =>
  type === "rectangle" ||
  type === "embeddable" ||
  type === "iframe" ||
  type === "image";

export const isUsingProportionalRadius = (type: string) =>
  type === "line" ||
  type === "arrow" ||
  type === "diamond" ||
  type === "stickynote";

const getRoundnessShapeType = (element: ExcalidrawElement) =>
  element.type === "composite_shape" ? element.shape.id : element.type;

export const canApplyRoundnessTypeToElement = (
  roundnessType: RoundnessType,
  element: ExcalidrawElement,
) => {
  if (
    (roundnessType === ROUNDNESS.ADAPTIVE_RADIUS ||
      // if legacy roundness, it can be applied to elements that currently
      // use adaptive radius
      roundnessType === ROUNDNESS.LEGACY) &&
    isUsingAdaptiveRadius(getRoundnessShapeType(element))
  ) {
    return true;
  }
  if (
    roundnessType === ROUNDNESS.PROPORTIONAL_RADIUS &&
    isUsingProportionalRadius(getRoundnessShapeType(element))
  ) {
    return true;
  }

  return false;
};

export const getDefaultRoundnessTypeForElement = (
  element: ExcalidrawElement,
) => {
  if (isUsingProportionalRadius(getRoundnessShapeType(element))) {
    return {
      type: ROUNDNESS.PROPORTIONAL_RADIUS,
    };
  }

  if (isUsingAdaptiveRadius(getRoundnessShapeType(element))) {
    return {
      type: ROUNDNESS.ADAPTIVE_RADIUS,
    };
  }

  return null;
};

export const getLinearElementSubType = (
  element: ExcalidrawLinearElement,
): ExcalidrawLinearElementSubType => {
  if (isSharpArrow(element)) {
    return "sharpArrow";
  }
  if (isCurvedArrow(element)) {
    return "curvedArrow";
  }
  if (isElbowArrow(element)) {
    return "elbowArrow";
  }
  return "line";
};

/**
 * Checks if current element points meet all the conditions for polygon=true
 * (this isn't a element type check, for that use isLineElement).
 *
 * If you want to check if points *can* be turned into a polygon, use
 *  canBecomePolygon(points).
 */
export const isValidPolygon = (
  points: ExcalidrawLineElement["points"],
): boolean => {
  return points.length > 3 && pointsEqual(points[0], points[points.length - 1]);
};

export const canBecomePolygon = (
  points: ExcalidrawLineElement["points"],
): boolean => {
  return (
    points.length > 3 ||
    // 3-point polygons can't have all points in a single line
    (points.length === 3 && !pointsEqual(points[0], points[points.length - 1]))
  );
};

export const isEligibleFrameChildType = (type: ElementOrToolType) => {
  switch (type) {
    case "composite_shape":
    case "rectangle":
    case "stickynote":
    case "diamond":
    case "ellipse":
    case "arrow":
    case "line":
    case "freedraw":
    case "text":
    case "image":
    case "frame":
    case "embeddable": {
      return true;
    }
    default: {
      return false;
    }
  }
};
