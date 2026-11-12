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
  // 参数可以是可选的（如 activation 的 link）——缺省时只允许基础键；
  // 必选参数的校验函数会对 undefined 返回 false，所以这里不会误放行。
  if (!valid && param) {
    valid = hasOnlyKeys(value, ["id", "schemaVersion"]);
  }
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
