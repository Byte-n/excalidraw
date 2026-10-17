import { getShapeRegistration, hasOnlyKeys, isShapeId } from "./registry";
import { shapeElementType } from "./family";

import type { ShapeData, ShapeElementType } from "../types";

/** Validates persisted shape data at file, library and clipboard boundaries. */
export const assertShapeData = (shape: unknown): ShapeData => {
  if (!shape || typeof shape !== "object") {
    throw new Error(
      `Unsupported composite shape data: ${JSON.stringify(shape)}`,
    );
  }
  const value = shape as Record<string, unknown>;
  const id = value.id;
  if (!isShapeId(id) || value.schemaVersion !== 1) {
    throw new Error(
      `Unsupported composite shape data: ${JSON.stringify(shape)}`,
    );
  }
  const param = getShapeRegistration(id).param;
  let valid = hasOnlyKeys(
    value,
    param ? ["id", "schemaVersion", param.key] : ["id", "schemaVersion"],
  );
  if (param) {
    valid = valid && param.validate(value[param.key]);
  }
  if (!valid) {
    throw new Error(
      `Unsupported composite shape data: ${JSON.stringify(shape)}`,
    );
  }
  return shape as ShapeData;
};

/**
 * Validates shape data plus the consistency between the element's top-level
 * `type` and the shape id's family. Use this at every boundary that already
 * knows the element type (restore, clipboard, `isExcalidrawElement`).
 */
export const assertShapeElementType = (
  type: string,
  shape: ShapeData,
): void => {
  assertShapeData(shape);
  if (shapeElementType(shape.id) !== (type as ShapeElementType)) {
    throw new Error(`Shape data does not belong to element type: ${type}`);
  }
};
