export type {
  ConnectionCtx,
  ConnectionHit,
  ConnectionQuery,
  OutlinePath,
} from "./types";

export {
  ANCHOR_RADIUS_PX,
  OUTLINE_INSIDE_BAND_PX,
  getAnchorRadius,
  getInsideBand,
  getOutsideBand,
} from "./thresholds";

export type { ConnectionSpec } from "./spec";
export { getConnectionSpec } from "./spec";

export type { ConnectionOutline } from "./outline";
export {
  buildConnectionOutline,
  buildConnectionPaths,
  nearestPointOnOutline,
} from "./outline";
