import type { Radians } from "@excalidraw/math";

import {
  assertBaseShapeData,
  baseShapeData,
  isCompositeShapeElement,
} from "./compositeShape";
import { newElement } from "./newElement";
import { updateBoundElements } from "./binding";
import { isLinearElement } from "./typeChecks";
import {
  CanvasSceneError,
  applySceneElementStyle,
  createCalculationScene,
  deleteSceneElements,
  finishSceneOperation,
  updateSceneLabel,
} from "./sceneOperations";

import type { BaseShapeData, BaseShapeId } from "./types";
import type {
  CanvasElementOperationResult,
  NullableStyle,
  SceneElementTarget,
  SceneGeometry,
  SceneTextStyle,
  ShapeStyle,
} from "./sceneOperations";

export type TriangleShapeOptions = NullableStyle<{ apexX: number }>;
export type TrapezoidShapeOptions = NullableStyle<{
  narrowWidthRatio: number;
  narrowEdge: "top" | "bottom";
}>;
export type CubeShapeOptions = Readonly<{
  controlPoint?: NullableStyle<{ x: number; y: number }>;
}>;
export type CircularShapeOptions = NullableStyle<{
  centralAngle: number;
  radius: number;
  sectorRatio: number;
  startRadialLineAngle: number;
}>;
export type ShapeOptions =
  | TriangleShapeOptions
  | TrapezoidShapeOptions
  | CubeShapeOptions
  | CircularShapeOptions;
export type ShapeOptionsFor<T extends BaseShapeId> = T extends "triangle"
  ? TriangleShapeOptions
  : T extends "trapezoid"
  ? TrapezoidShapeOptions
  : T extends "cube"
  ? CubeShapeOptions
  : T extends "pie" | "circular-ring"
  ? CircularShapeOptions
  : never;

type ShapeCreateOperation = {
  [K in BaseShapeId]: Readonly<{
    action: "create";
    kind: K;
    geometry: SceneGeometry;
    text?: string;
    style?: ShapeStyle;
    textStyle?: SceneTextStyle;
    shapeOptions?: ShapeOptionsFor<K>;
  }>;
}[BaseShapeId];
export type ShapeOperation =
  | Readonly<{
      action: "create";
      kind: BaseShapeId;
      geometry: SceneGeometry;
      text?: string;
      style?: ShapeStyle;
      textStyle?: SceneTextStyle;
      shapeOptions?: never;
    }>
  | ShapeCreateOperation
  | Readonly<{
      action: "update";
      target: SceneElementTarget;
      geometry?: Partial<SceneGeometry>;
      text?: string;
      style?: ShapeStyle;
      textStyle?: SceneTextStyle;
      shapeOptions?: ShapeOptions;
    }>
  | Readonly<{ action: "delete"; target: SceneElementTarget }>;

const requireKeys = (options: ShapeOptions, keys: readonly string[]) => {
  if (
    !Object.keys(options).length ||
    Object.keys(options).some((key) => !keys.includes(key))
  ) {
    throw new CanvasSceneError("invalid_input", "图形参数与种类不匹配");
  }
};

export const applyShapeOptions = (
  shape: BaseShapeData,
  options: ShapeOptions | undefined,
): BaseShapeData => {
  if (!options) {
    return shape;
  }
  const defaults = baseShapeData(shape.id);
  let candidate: BaseShapeData;
  switch (shape.id) {
    case "triangle": {
      requireKeys(options, ["apexX"]);
      if (defaults.id !== "triangle") {
        throw new Error("图形默认值种类不匹配");
      }
      const patch = options as TriangleShapeOptions;
      candidate = {
        ...shape,
        triangle: {
          apexX:
            patch.apexX === undefined
              ? shape.triangle.apexX
              : patch.apexX ?? defaults.triangle.apexX,
        },
      };
      break;
    }
    case "trapezoid": {
      requireKeys(options, ["narrowWidthRatio", "narrowEdge"]);
      if (defaults.id !== "trapezoid") {
        throw new Error("图形默认值种类不匹配");
      }
      const patch = options as TrapezoidShapeOptions;
      candidate = {
        ...shape,
        trapezoid: {
          narrowWidthRatio:
            patch.narrowWidthRatio === undefined
              ? shape.trapezoid.narrowWidthRatio
              : patch.narrowWidthRatio ?? defaults.trapezoid.narrowWidthRatio,
          narrowEdge:
            patch.narrowEdge === undefined
              ? shape.trapezoid.narrowEdge
              : patch.narrowEdge ?? defaults.trapezoid.narrowEdge,
        },
      };
      break;
    }
    case "cube": {
      requireKeys(options, ["controlPoint"]);
      if (defaults.id !== "cube") {
        throw new Error("图形默认值种类不匹配");
      }
      const patch = (options as CubeShapeOptions).controlPoint;
      if (
        !patch ||
        !Object.keys(patch).length ||
        Object.keys(patch).some((key) => key !== "x" && key !== "y")
      ) {
        throw new CanvasSceneError(
          "invalid_input",
          "立方体参数必须包含控制点叶子",
        );
      }
      candidate = {
        ...shape,
        cube: {
          controlPoint: {
            x:
              patch.x === undefined
                ? shape.cube.controlPoint.x
                : patch.x ?? defaults.cube.controlPoint.x,
            y:
              patch.y === undefined
                ? shape.cube.controlPoint.y
                : patch.y ?? defaults.cube.controlPoint.y,
          },
        },
      };
      break;
    }
    case "pie":
    case "circular-ring": {
      requireKeys(options, [
        "centralAngle",
        "radius",
        "sectorRatio",
        "startRadialLineAngle",
      ]);
      const current = shape.id === "pie" ? shape.pie : shape.circularRing;
      if (defaults.id !== "pie" && defaults.id !== "circular-ring") {
        throw new Error("图形默认值种类不匹配");
      }
      const factory =
        defaults.id === "pie" ? defaults.pie : defaults.circularRing;
      const patch = options as CircularShapeOptions;
      const data = {
        centralAngle:
          patch.centralAngle === undefined
            ? current.centralAngle
            : patch.centralAngle ?? factory.centralAngle,
        radius:
          patch.radius === undefined
            ? current.radius
            : patch.radius ?? factory.radius,
        sectorRatio:
          patch.sectorRatio === undefined
            ? current.sectorRatio
            : patch.sectorRatio ?? factory.sectorRatio,
        startRadialLineAngle:
          patch.startRadialLineAngle === undefined
            ? current.startRadialLineAngle
            : patch.startRadialLineAngle ?? factory.startRadialLineAngle,
      };
      candidate =
        shape.id === "pie"
          ? { ...shape, pie: data }
          : { ...shape, circularRing: data };
      break;
    }
    default:
      throw new CanvasSceneError("invalid_input", "当前图形没有可编辑参数");
  }
  try {
    return assertBaseShapeData(candidate);
  } catch {
    throw new CanvasSceneError("invalid_input", "图形参数超出有效范围");
  }
};

export const applyShapeOperation = (
  elements: readonly import("./types").ExcalidrawElement[],
  operation: ShapeOperation,
): CanvasElementOperationResult => {
  const scene = createCalculationScene(elements);
  try {
    let shape;
    if (operation.action === "create") {
      const element = newElement({
        type: "composite_shape",
        shape: applyShapeOptions(
          baseShapeData(operation.kind),
          operation.shapeOptions,
        ),
        ...operation.geometry,
        angle: operation.geometry.angle as Radians | undefined,
      });
      if (!isCompositeShapeElement(element)) {
        throw new Error("图形工厂返回非法类型");
      }
      shape = element;
      scene.replaceAllElements(
        [...scene.getElementsIncludingDeleted(), shape],
        {
          skipValidation: true,
        },
      );
    } else {
      const element = scene
        .getNonDeletedElementsMap()
        .get(operation.target.elementId);
      if (!element || !isCompositeShapeElement(element)) {
        throw new CanvasSceneError("target_not_found", "图形不存在");
      }
      shape = element;
    }
    if (operation.action === "delete") {
      deleteSceneElements(new Set([shape.id]), scene);
    } else {
      if (operation.action === "update") {
        scene.mutateElement(shape, {
          ...operation.geometry,
          angle: operation.geometry?.angle as Radians | undefined,
          shape: applyShapeOptions(shape.shape, operation.shapeOptions),
        });
      }
      applySceneElementStyle(shape, operation.style, scene);
      updateSceneLabel(shape, operation.text, operation.textStyle, scene);
      updateBoundElements(shape, scene);
      for (const ref of shape.boundElements ?? []) {
        const incident = scene.getNonDeletedElementsMap().get(ref.id);
        if (isLinearElement(incident)) {
          updateSceneLabel(incident, undefined, undefined, scene);
        }
      }
    }
    return finishSceneOperation(elements, scene.getElementsIncludingDeleted(), {
      domain: "shape",
      action: operation.action,
      elementId: shape.id,
    });
  } finally {
    scene.destroy();
  }
};
