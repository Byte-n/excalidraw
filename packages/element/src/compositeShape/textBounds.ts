import type { ShapePoint } from "./outline";

/**
 * Text-safe rectangle primitives: the shared inset/inscribed algorithms that
 * shape registrations compose into per-id `textBounds`.
 */

export const TEXT_GAP = 2;

export type CompositeShapeTextBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export const insetRect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): CompositeShapeTextBounds => ({
  x: left,
  y: top,
  width: Math.max(0.01, right - left),
  height: Math.max(0.01, bottom - top),
});
/** Maximize a centered rectangle under the inset half-plane of each convex edge. */
export const getConvexTextBounds = (
  points: ShapePoint[],
  width: number,
  height: number,
): CompositeShapeTextBounds => {
  const centerX = width / 2;
  const centerY = height / 2;
  const constraints = points.map(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const normalX = dy;
    const normalY = -dx;
    const sign =
      normalX * (centerX - x1) + normalY * (centerY - y1) > 0 ? -1 : 1;
    return {
      x: Math.abs(normalX),
      y: Math.abs(normalY),
      limit:
        sign * (normalX * (x1 - centerX) + normalY * (y1 - centerY)) -
        TEXT_GAP * Math.hypot(dx, dy),
    };
  });
  let halfWidth = 0;
  let halfHeight = 0;
  const consider = (x: number, y: number) => {
    if (
      x >= 0 &&
      y >= 0 &&
      constraints.every(
        (edge) => edge.x * x + edge.y * y <= edge.limit + 1e-7,
      ) &&
      x * y > halfWidth * halfHeight
    ) {
      halfWidth = x;
      halfHeight = y;
    }
  };
  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      const a = constraints[i];
      const b = constraints[j];
      const determinant = a.x * b.y - b.x * a.y;
      if (Math.abs(determinant) > 1e-9) {
        consider(
          (a.limit * b.y - b.limit * a.y) / determinant,
          (a.x * b.limit - b.x * a.limit) / determinant,
        );
      }
    }
  }
  // The area maximum can also lie in the middle of a single active edge.
  for (const edge of constraints) {
    if (edge.x > 0 && edge.y > 0) {
      consider(edge.limit / (2 * edge.x), edge.limit / (2 * edge.y));
    }
  }
  return insetRect(
    centerX - halfWidth,
    centerY - halfHeight,
    centerX + halfWidth,
    centerY + halfHeight,
  );
};
