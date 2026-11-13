import type { GlobalPoint } from "@excalidraw/math";

import type { CompositeShapePath } from "../compositeShape";

import type {
  ElementsMap,
  ExcalidrawBindableElement,
  ExcalidrawLinearElement,
} from "../types";

export type ConnectionCtx = {
  /** The other endpoint of the arrow; absent while hovering a new arrow. */
  reference?: GlobalPoint;
  elementsMap: ElementsMap;
};

export type ConnectionQuery = {
  element: ExcalidrawBindableElement;
  /** Endpoint position (grid / Shift / sequence constraints already applied). */
  point: GlobalPoint;
  reference?: GlobalPoint;
  arrow?: ExcalidrawLinearElement | { elbowed: boolean };
  zoom: number;
  anchorsEnabled: boolean;
  angleLocked: boolean;
  elementsMap: ElementsMap;
  /** Which arrow endpoint is being resolved; only affects `rayProject`. */
  startOrEnd?: "start" | "end";
};

export type ConnectionHit = {
  tier: "anchor" | "outline" | "interior";
  /** Final endpoint on Γ. */
  point: GlobalPoint;
  anchorIndex?: number;
  /** Recommended points on the outline, for the hollow anchor rings. */
  anchors: GlobalPoint[];
};

export type OutlinePath = CompositeShapePath;
