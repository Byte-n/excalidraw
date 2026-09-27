import {
  baseShapeData,
  compositeShapePathToSvg,
  getCompositeShapeGeometry,
  getCompositeShapePoints,
  isCompositeShapeOpen,
} from "@excalidraw/element/compositeShape";

import type { BaseShapeId } from "@excalidraw/element/types";

import { createIcon } from "./icons";

type ShapeIconId = BaseShapeId | "right-triangle" | "left-triangle";

export const getCompositeShapeIcon = (id: ShapeIconId) => {
  const shapeId =
    id === "right-triangle" || id === "left-triangle" ? "triangle" : id;
  const shape =
    shapeId === "triangle" && id !== "triangle"
      ? {
          ...baseShapeData("triangle"),
          triangle: { apexX: id === "right-triangle" ? 0 : 1 },
        }
      : baseShapeData(shapeId);
  const width = id === "pill" || id === "round-rect" ? 18 : 16;
  const height = id === "pill" || id === "round-rect" ? 12 : 16;
  const x = (24 - width) / 2;
  const y = (24 - height) / 2;
  const outline =
    shapeId === "cloud" || isCompositeShapeOpen(shapeId)
      ? compositeShapePathToSvg(
          getCompositeShapeGeometry({ width, height, shape }).outline,
        )
      : getCompositeShapePoints({ width, height, shape })
          .map(
            ([px, py], index) =>
              `${index === 0 ? "M" : "L"}${x + px} ${y + py}`,
          )
          .join(" ");
  const cubeDetails =
    shapeId === "cube"
      ? getCompositeShapeGeometry({ width, height, shape })
          .details.map(compositeShapePathToSvg)
          .join(" ")
      : null;

  return createIcon(
    <>
      <path
        d={`${outline}${
          shapeId === "cloud" || isCompositeShapeOpen(shapeId) ? "" : " Z"
        }`}
        transform={
          shapeId === "cloud" || isCompositeShapeOpen(shapeId)
            ? `translate(${x} ${y})`
            : undefined
        }
      />
      {cubeDetails && (
        <path fill="none" d={cubeDetails} transform={`translate(${x} ${y})`} />
      )}
      {shapeId === "cylinder" && <path fill="none" d="M4 6.24 Q12 3 20 6.24" />}
    </>,
    {
      width: 24,
      height: 24,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  );
};
