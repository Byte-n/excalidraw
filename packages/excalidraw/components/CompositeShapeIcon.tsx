import {
  buildShapeData,
  compositeShapePathToSvg,
  getCompositeShapeGeometry,
  getCompositeShapePoints,
  isCompositeShapeOpen,
} from "@excalidraw/element/compositeShape";

import type { ShapeId } from "@excalidraw/element/types";

import { createIcon } from "./icons";

type ShapeIconId = ShapeId;

export const getCompositeShapeIcon = (id: ShapeIconId) => {
  const shape = buildShapeData(id);
  const width = id === "pill" || id === "round-rect" ? 18 : 16;
  const height = id === "pill" || id === "round-rect" ? 12 : 16;
  const x = (24 - width) / 2;
  const y = (24 - height) / 2;
  const isOpenPath = id === "cloud" || isCompositeShapeOpen(id);
  const geometry = getCompositeShapeGeometry({ width, height, shape });
  const outline = isOpenPath
    ? compositeShapePathToSvg(geometry.outline)
    : getCompositeShapePoints({ width, height, shape })
        .map(
          ([px, py], index) => `${index === 0 ? "M" : "L"}${x + px} ${y + py}`,
        )
        .join(" ");
  // detail strokes (cube edges, fc-predefined-process verticals, fc cylinder
  // rims) render generically from the geometry; the classic cylinder keeps
  // its hand-drawn rim arc below
  const details =
    id === "cylinder" || geometry.details.length === 0
      ? null
      : geometry.details.map(compositeShapePathToSvg).join(" ");

  return createIcon(
    <>
      <path
        d={`${outline}${isOpenPath ? "" : " Z"}`}
        transform={isOpenPath ? `translate(${x} ${y})` : undefined}
      />
      {details && (
        <path fill="none" d={details} transform={`translate(${x} ${y})`} />
      )}
      {id === "cylinder" && <path fill="none" d="M4 6.24 Q12 3 20 6.24" />}
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
