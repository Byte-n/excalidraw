import { getShapeRegistration, hasOnlyKeys, isBaseShapeId } from "./registry";

import type { BaseShapeData } from "../types";

/** Validates persisted shape data at file, library and clipboard boundaries. */
export const assertBaseShapeData = (shape: unknown): BaseShapeData => {
  if (!shape || typeof shape !== "object") {
    throw new Error(
      `Unsupported composite shape data: ${JSON.stringify(shape)}`,
    );
  }
  const value = shape as Record<string, unknown>;
  const id = value.id;
  if (!isBaseShapeId(id) || value.schemaVersion !== 1) {
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
  return shape as BaseShapeData;
};
