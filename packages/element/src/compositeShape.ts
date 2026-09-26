import type {
  BaseShapeData,
  ExcalidrawCompositeShapeElement,
  ExcalidrawElement,
} from "./types";

export type BaseShapeId = BaseShapeData["id"];

export const isBaseShapeId = (id: unknown): id is BaseShapeId =>
  id === "rectangle" || id === "diamond" || id === "ellipse";

export const baseShapeData = (id: BaseShapeId): BaseShapeData => ({
  id,
  schemaVersion: 1,
});

export const assertBaseShapeData = (shape: unknown): BaseShapeData => {
  if (
    !shape ||
    typeof shape !== "object" ||
    !isBaseShapeId((shape as BaseShapeData).id) ||
    (shape as BaseShapeData).schemaVersion !== 1 ||
    Object.keys(shape).some((key) => key !== "id" && key !== "schemaVersion")
  ) {
    throw new Error(
      `Unsupported composite shape data: ${JSON.stringify(shape)}`,
    );
  }
  return shape as BaseShapeData;
};

export const isCompositeShapeId = <K extends BaseShapeId>(
  element: ExcalidrawElement | null | undefined,
  id: K,
): element is ExcalidrawCompositeShapeElement & {
  shape: Extract<BaseShapeData, { id: K }>;
} => element?.type === "composite_shape" && element.shape.id === id;
