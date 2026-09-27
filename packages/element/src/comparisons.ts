import type { ElementOrToolType } from "@excalidraw/excalidraw/types";

import { isBaseShapeId, isCompositeShapeOpen } from "./compositeShape";

import type { BaseShapeId, ExcalidrawElement } from "./types";

type FillTarget = ElementOrToolType | BaseShapeId | ExcalidrawElement;

export const supportsFill = (target: FillTarget) => {
  if (typeof target !== "string" && target.type === "composite_shape") {
    return !isCompositeShapeOpen(target.shape.id);
  }
  const type = typeof target === "string" ? target : target.type;
  if (isBaseShapeId(type)) {
    return !isCompositeShapeOpen(type);
  }
  return (
    type === "composite_shape" ||
    type === "mindmap-node" ||
    type === "stickynote" ||
    type === "iframe" ||
    type === "embeddable" ||
    type === "line" ||
    type === "freedraw" ||
    type === "autoshape" ||
    // tool-only type; makes the `G` background shortcut work for bucket fill
    type === "bucketfill"
  );
};

export const hasBackground = supportsFill;

export const hasFillStyle = (target: FillTarget) =>
  hasBackground(target) &&
  (typeof target === "string" ? target : target.type) !== "stickynote";

export const hasStrokeColor = (type: ElementOrToolType) =>
  type === "composite_shape" ||
  type === "rectangle" ||
  type === "mindmap-node" ||
  type === "stickynote" ||
  type === "ellipse" ||
  type === "diamond" ||
  type === "freedraw" ||
  type === "arrow" ||
  type === "line" ||
  type === "text" ||
  type === "embeddable" ||
  type === "autoshape";

export const hasStrokeWidth = (type: ElementOrToolType) =>
  type === "composite_shape" ||
  type === "rectangle" ||
  type === "mindmap-node" ||
  type === "iframe" ||
  type === "embeddable" ||
  type === "ellipse" ||
  type === "diamond" ||
  type === "freedraw" ||
  type === "arrow" ||
  type === "line" ||
  type === "autoshape";

export const hasStrokeStyle = (type: ElementOrToolType) =>
  type === "composite_shape" ||
  type === "rectangle" ||
  type === "mindmap-node" ||
  type === "iframe" ||
  type === "embeddable" ||
  type === "ellipse" ||
  type === "diamond" ||
  type === "arrow" ||
  type === "line" ||
  type === "autoshape";

export const hasRoughness = (type: ElementOrToolType) =>
  hasStrokeStyle(type) || type === "stickynote";

export const hasFreedrawMode = (type: ElementOrToolType) => type === "freedraw";

export const canChangeRoundness = (type: ElementOrToolType | BaseShapeId) =>
  type === "rectangle" ||
  type === "mindmap-node" ||
  type === "iframe" ||
  type === "embeddable" ||
  type === "line" ||
  type === "diamond" ||
  type === "stickynote" ||
  type === "image";

export const toolIsArrow = (type: ElementOrToolType) => type === "arrow";

export const canHaveArrowheads = (type: ElementOrToolType) => type === "arrow";
