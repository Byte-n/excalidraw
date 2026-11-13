import { pointDistance } from "@excalidraw/math";

import type { AppState } from "@excalidraw/excalidraw/types";
import type { GlobalPoint } from "@excalidraw/math";

import { getConnectionSpec } from "./spec";

import type {
  ElementsMap,
  ExcalidrawBindableElement,
  NonDeleted,
} from "../types";
import type { ConnectionHit } from "./types";

/**
 * Field-level comparison of the `suggestedBinding` mirror
 * (03-connection-integration.md §4.6). Avoids a `setState` per pointermove when
 * the resolved hit did not change.
 */
export const isSameSuggestedBinding = (
  a: AppState["suggestedBinding"],
  b: AppState["suggestedBinding"],
): boolean => {
  if (!a || !b) {
    return a === b;
  }
  return (
    a.element.id === b.element.id &&
    a.hit.tier === b.hit.tier &&
    a.hit.anchorIndex === b.hit.anchorIndex &&
    a.hit.point[0] === b.hit.point[0] &&
    a.hit.point[1] === b.hit.point[1] &&
    a.hit.anchors.length === b.hit.anchors.length
  );
};

/**
 * Snapshot of the element's recommended points, used to keep the legacy elbow
 * preview (until PR3b) expressible as a `ConnectionHit`.
 */
export const getSuggestedBindingAnchors = (
  element: ExcalidrawBindableElement,
  elementsMap: ElementsMap,
): GlobalPoint[] =>
  getConnectionSpec(element).anchors(element, { elementsMap });

/**
 * Legacy elbow preview as a `ConnectionHit`. Elbow landing/binding is
 * intentionally untouched in 3a; this only adapts the preview payload to the
 * derived-mirror type so the renderer can read `hit`.
 */
export const suggestedBindingForElbow = (
  element: NonDeleted<ExcalidrawBindableElement>,
  point: GlobalPoint,
  midPoint: GlobalPoint | undefined,
  elementsMap: ElementsMap,
): NonNullable<AppState["suggestedBinding"]> => {
  const anchors = getSuggestedBindingAnchors(element, elementsMap);
  let anchorIndex: number | undefined;
  if (midPoint && anchors.length) {
    anchorIndex = anchors.reduce(
      (closest, anchor, index) =>
        pointDistance(anchor, midPoint) <
        pointDistance(anchors[closest] ?? anchor, midPoint)
          ? index
          : closest,
      0,
    );
  }
  const hit: ConnectionHit = {
    tier: midPoint ? "anchor" : "outline",
    point: midPoint ?? point,
    anchorIndex,
    anchors,
  };
  return { element, hit };
};
