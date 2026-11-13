import type { GlobalPoint } from "@excalidraw/math";

import { getRegisteredConnectionSpec } from "./specs";

import type { ExcalidrawBindableElement } from "../types";
import type { ConnectionCtx, OutlinePath } from "./types";

export interface ConnectionSpec {
  /** Recommended points: points on the outline (no gap), in global space. */
  anchors(
    element: ExcalidrawBindableElement,
    ctx: ConnectionCtx,
  ): GlobalPoint[];
  /** Connectable parts of the element's existing outline. */
  connectableOutline(
    element: ExcalidrawBindableElement,
    ctx: ConnectionCtx,
  ): OutlinePath[];
  /** Pointer deep inside: `ray` = directional ray, `nearest` = nearest point, `none` = not a candidate. */
  interior: "ray" | "nearest" | "none";
}

export const getConnectionSpec = (
  element: ExcalidrawBindableElement,
): ConnectionSpec => getRegisteredConnectionSpec(element);
