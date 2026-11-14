/**
 * Synchronous pointer interaction snapshot (02-frame-contract.md §4.6).
 *
 * One immutable record per frame: the resolved frame plus every transient
 * hover affordance derived from it. It lives in `AppPointerState`, never in
 * React state, so writers can compare against the previous committed snapshot
 * synchronously and replace it atomically.
 */
import type { TransformHandleType } from "@excalidraw/element";
import type {
  ExcalidrawFrameLikeElement,
  NonDeleted,
} from "@excalidraw/element/types";

import type {
  FragmentStructureHover,
  TableRowColStructureHover,
} from "../../types";
import type { PointerFrame } from "./pointerFrame";

/** Provider ids whose hover payloads live in the snapshot. */
export const TABLE_CONTAINER_PROVIDER = "table";
export const FRAGMENT_CONTAINER_PROVIDER = "fragment";
export const FRAME_CONTAINER_PROVIDER = "frame";

export type PointerTableCellHover = {
  tableId: string;
  cellId: string;
};

export type PointerArrowTextAnchor = {
  elementId: string;
  anchor: "start" | "end" | "label";
} | null;

export type PointerHoverSnapshot = {
  table: TableRowColStructureHover | null;
  fragment: FragmentStructureHover | null;
  /** Element under the pointer, including locked elements (canvas parity). */
  elementId: string | null;
  /** Multi-element hover: mindmap node or the link-selector group highlight. */
  elementIds: Readonly<Record<string, true>>;
  /** Frame that receives child hover / drop-target treatment. */
  frameToHighlight: NonDeleted<ExcalidrawFrameLikeElement> | null;
  cell: PointerTableCellHover | null;
  arrowTextAnchor: PointerArrowTextAnchor;
  linkElementId: string | null;
  embedElementId: string | null;
  transformHandle: TransformHandleType | null;
  /** Guards a hovered handle against a selection change without a move. */
  transformSelectionKey: string | null;
};

export type PointerSnapshot = {
  frame: PointerFrame | null;
  hover: PointerHoverSnapshot;
};

const EMPTY_ELEMENT_IDS: Readonly<Record<string, true>> = Object.freeze({});

export const EMPTY_POINTER_HOVER: PointerHoverSnapshot = Object.freeze({
  table: null,
  fragment: null,
  elementId: null,
  elementIds: EMPTY_ELEMENT_IDS,
  frameToHighlight: null,
  cell: null,
  arrowTextAnchor: null,
  linkElementId: null,
  embedElementId: null,
  transformHandle: null,
  transformSelectionKey: null,
});

const sameTableHover = (
  previous: TableRowColStructureHover,
  next: TableRowColStructureHover,
): boolean => {
  if (previous === next) {
    return true;
  }
  if (previous.kind !== next.kind || previous.tableId !== next.tableId) {
    return false;
  }
  switch (previous.kind) {
    case "table":
    case "titleBar":
    case "titleGrip":
      return true;
    case "rowGrip":
      return previous.rowId === (next as typeof previous).rowId;
    case "columnGrip":
      return previous.columnId === (next as typeof previous).columnId;
    case "rowResize":
      return (
        previous.rowId === (next as typeof previous).rowId &&
        previous.edge === (next as typeof previous).edge
      );
    case "columnResize":
      return (
        previous.columnId === (next as typeof previous).columnId &&
        previous.edge === (next as typeof previous).edge
      );
    case "rowInsert":
    case "columnInsert":
      return previous.boundaryIndex === (next as typeof previous).boundaryIndex;
    default:
      return false;
  }
};

const sameFragmentHover = (
  previous: FragmentStructureHover,
  next: FragmentStructureHover,
): boolean => {
  if (previous === next) {
    return true;
  }
  if (previous.kind !== next.kind || previous.elementId !== next.elementId) {
    return false;
  }
  switch (previous.kind) {
    case "body":
    case "rowGrip":
      return previous.rowId === (next as typeof previous).rowId;
    case "rowResize":
      return previous.rowId === (next as typeof previous).rowId;
    case "rowInsert":
      return previous.boundaryIndex === (next as typeof previous).boundaryIndex;
    case "rowMove":
      return (
        previous.boundaryIndex === (next as typeof previous).boundaryIndex &&
        previous.y === (next as typeof previous).y
      );
    default:
      return false;
  }
};

const sameElementIds = (
  previous: Readonly<Record<string, true>>,
  next: Readonly<Record<string, true>>,
) => {
  if (previous === next) {
    return true;
  }
  const previousKeys = Object.keys(previous);
  if (previousKeys.length !== Object.keys(next).length) {
    return false;
  }
  return previousKeys.every((key) => next[key]);
};

const sameCell = (
  previous: PointerTableCellHover | null,
  next: PointerTableCellHover | null,
) =>
  previous === next ||
  (previous !== null &&
    next !== null &&
    previous.tableId === next.tableId &&
    previous.cellId === next.cellId);

const sameArrowTextAnchor = (
  previous: PointerArrowTextAnchor,
  next: PointerArrowTextAnchor,
) =>
  previous === next ||
  (previous !== null &&
    next !== null &&
    previous.elementId === next.elementId &&
    previous.anchor === next.anchor);

const sameFrame = (
  previous: NonDeleted<ExcalidrawFrameLikeElement> | null,
  next: NonDeleted<ExcalidrawFrameLikeElement> | null,
) =>
  previous === next ||
  (previous !== null &&
    next !== null &&
    previous.id === next.id &&
    previous.versionNonce === next.versionNonce);

export const isSamePointerHover = (
  previous: PointerHoverSnapshot,
  next: PointerHoverSnapshot,
): boolean =>
  previous === next ||
  ((previous.table === next.table ||
    (previous.table !== null &&
      next.table !== null &&
      sameTableHover(previous.table, next.table))) &&
    (previous.fragment === next.fragment ||
      (previous.fragment !== null &&
        next.fragment !== null &&
        sameFragmentHover(previous.fragment, next.fragment))) &&
    previous.elementId === next.elementId &&
    sameElementIds(previous.elementIds, next.elementIds) &&
    sameFrame(previous.frameToHighlight, next.frameToHighlight) &&
    sameCell(previous.cell, next.cell) &&
    sameArrowTextAnchor(previous.arrowTextAnchor, next.arrowTextAnchor) &&
    previous.linkElementId === next.linkElementId &&
    previous.embedElementId === next.embedElementId &&
    previous.transformHandle === next.transformHandle &&
    previous.transformSelectionKey === next.transformSelectionKey);

/** Hover payloads expressible by a frame target alone. */
export const derivePointerHover = (
  frame: PointerFrame | null,
): PointerHoverSnapshot => {
  if (!frame || (frame.phase !== "hover" && frame.phase !== "armed")) {
    return EMPTY_POINTER_HOVER;
  }
  const { target } = frame;
  if (target.kind !== "containerControl" && target.kind !== "containerBody") {
    return EMPTY_POINTER_HOVER;
  }
  const { candidate } = target;
  if (candidate.providerId === TABLE_CONTAINER_PROVIDER) {
    return {
      ...EMPTY_POINTER_HOVER,
      table: candidate.data as TableRowColStructureHover,
    };
  }
  if (candidate.providerId === FRAGMENT_CONTAINER_PROVIDER) {
    return {
      ...EMPTY_POINTER_HOVER,
      fragment: candidate.data as FragmentStructureHover,
    };
  }
  return EMPTY_POINTER_HOVER;
};

export const derivePointerSnapshot = (
  frame: PointerFrame | null,
): PointerSnapshot => ({ frame, hover: derivePointerHover(frame) });
