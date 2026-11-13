export type {
  ConnectionCtx,
  ConnectionHit,
  ConnectionQuery,
  OutlinePath,
} from "./types";

export {
  ANCHOR_RADIUS_PX,
  OUTLINE_INSIDE_BAND_PX,
  SEQUENCE_CONNECTION_INSIDE_TOLERANCE,
  SEQUENCE_CONNECTION_SNAP_DISTANCE,
  SEQUENCE_MESSAGE_SNAP_DISTANCE,
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

export type { BuildConnectionQueryArgs } from "./query";
export { buildConnectionQuery, snapBoundPointToGrid } from "./query";

export type { RayProjector } from "./resolve";
export {
  pickConnectionTarget,
  pickConnectionTargetForPoint,
  resolveConnectionHit,
} from "./resolve";

export {
  clearConnectionPreviewFrame,
  setConnectionPreviewFrame,
} from "./preview";
