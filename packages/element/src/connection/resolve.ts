import { pointDistance } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";

import { getProjectionBindingGap } from "../bindingGap";
import { getAllHoveredElementAtPoint } from "../collision";

import {
  buildConnectionOutline,
  nearestPointOnOutline,
  pointInsideConnectableElement,
} from "./outline";
import { getConnectionSpec } from "./spec";
import { getAnchorRadius, getInsideBand, getOutsideBand } from "./thresholds";

import type {
  ElementsMap,
  ExcalidrawBindableElement,
  ExcalidrawLinearElement,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
  Ordered,
} from "../types";
import type { ConnectionCtx, ConnectionHit, ConnectionQuery } from "./types";

/**
 * Max distance between a ray-projected point and Γ that is treated as the same
 * landing (production offset paths use a coarser round-join tolerance).
 */
const RAY_LANDING_EPSILON = 0.5;

export type RayProjector = (args: {
  element: ExcalidrawBindableElement;
  point: GlobalPoint;
  reference?: GlobalPoint;
  arrow?: ExcalidrawLinearElement | { elbowed: boolean };
  elementsMap: ElementsMap;
  startOrEnd: "start" | "end";
}) => GlobalPoint | null;

/**
 * Three-tier connection resolution (anchor → outline → interior), first match
 * wins. Every returned landing point lies on Γ. The directional `rayProject` is
 * injected so this module never imports binding/cursor/App code.
 */
export const resolveConnectionHit = (
  query: ConnectionQuery,
  rayProject: RayProjector,
): ConnectionHit | null => {
  const { element, point } = query;
  const gap = getProjectionBindingGap(
    element,
    query.arrow ?? { elbowed: false },
  );
  const ctx: ConnectionCtx = {
    reference: query.reference,
    elementsMap: query.elementsMap,
  };
  const spec = getConnectionSpec(element);
  const anchors = spec.anchors(element, ctx);
  const outline = buildConnectionOutline(element, gap, spec, ctx);
  const startOrEnd = query.startOrEnd ?? "start";

  const rayArgs = {
    element,
    point,
    reference: query.reference,
    arrow: query.arrow,
    elementsMap: query.elementsMap,
    startOrEnd,
  } as const;

  if (query.angleLocked) {
    const projected = rayProject(rayArgs);
    return projected ? { tier: "interior", point: projected, anchors } : null;
  }

  if (!outline.inflated.length) {
    return null;
  }

  if (query.anchorsEnabled && anchors.length) {
    let anchorIndex = -1;
    let anchorDistance = Infinity;
    anchors.forEach((anchor, index) => {
      const distance = pointDistance(point, anchor);
      if (distance < anchorDistance) {
        anchorDistance = distance;
        anchorIndex = index;
      }
    });
    if (
      anchorIndex >= 0 &&
      anchorDistance <= getAnchorRadius(element, query.zoom, gap)
    ) {
      return {
        tier: "anchor",
        point: nearestPointOnOutline(outline.inflated, anchors[anchorIndex], {
          zoom: query.zoom,
        }).point,
        anchorIndex,
        anchors,
      };
    }
  }

  const distanceToOutline = outline.outline.length
    ? nearestPointOnOutline(outline.outline, point, { zoom: query.zoom })
        .distance
    : Infinity;
  const inside = pointInsideConnectableElement(
    element,
    point,
    query.elementsMap,
  );
  const outlineHit =
    distanceToOutline <= getOutsideBand(query.zoom, gap) ||
    (inside && distanceToOutline <= getInsideBand(element, query.zoom));

  /**
   * Keep a non-anchor landing stable when it happens to fall inside an anchor's
   * snap radius: otherwise re-resolving the landing point would switch to the
   * anchor tier and move the endpoint. `hit.anchors` still reports the tier's
   * own result; only the point is snapped.
   */
  const landingOnOutline = (
    landing = nearestPointOnOutline(outline.inflated, point, {
      zoom: query.zoom,
    }).point,
  ): GlobalPoint => {
    if (!query.anchorsEnabled || !anchors.length) {
      return landing;
    }
    const radius = getAnchorRadius(element, query.zoom, gap);
    let nearestAnchor = -1;
    let nearestDistance = Infinity;
    anchors.forEach((anchor, index) => {
      const distance = pointDistance(landing, anchor);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestAnchor = index;
      }
    });
    if (nearestAnchor >= 0 && nearestDistance <= radius) {
      return nearestPointOnOutline(outline.inflated, anchors[nearestAnchor], {
        zoom: query.zoom,
      }).point;
    }
    return landing;
  };

  if (outlineHit) {
    return {
      tier: "outline",
      point: landingOnOutline(),
      anchors,
    };
  }

  if (spec.interior === "none") {
    return null;
  }

  if (spec.interior === "nearest") {
    return {
      tier: "interior",
      point: landingOnOutline(),
      anchors,
    };
  }

  const projected = rayProject(rayArgs);
  if (projected) {
    // Production intersection geometry differs from Γ by at most its offset
    // chord tolerance; snap such a point back onto Γ so the landing invariant
    // (`hit.point ∈ Γ`) holds and re-resolving is stable.
    const nearest = nearestPointOnOutline(outline.inflated, projected, {
      zoom: query.zoom,
    });
    const landing =
      nearest.distance <= RAY_LANDING_EPSILON ? nearest.point : projected;
    return { tier: "interior", point: landingOnOutline(landing), anchors };
  }
  // Degenerate ray: fall back to the nearest Γ point.
  return { tier: "interior", point: landingOnOutline(), anchors };
};

/**
 * Candidate selection + resolution: prefer smaller shapes (same ordering as
 * `getHoveredElementForBinding`), first element that resolves wins.
 */
export const pickConnectionTarget = (
  point: GlobalPoint,
  elements: readonly Ordered<NonDeletedExcalidrawElement>[],
  query: Omit<ConnectionQuery, "element" | "point">,
  rayProject: RayProjector,
): { element: ExcalidrawBindableElement; hit: ConnectionHit } | null => {
  const elementsMap =
    query.elementsMap as unknown as NonDeletedSceneElementsMap;
  const candidates = getAllHoveredElementAtPoint(point, elements, elementsMap)
    .slice()
    .sort(
      (a, b) => a.width ** 2 + a.height ** 2 - (b.width ** 2 + b.height ** 2),
    );
  for (const element of candidates) {
    const hit = resolveConnectionHit({ ...query, element, point }, rayProject);
    if (hit) {
      return { element, hit };
    }
  }
  return null;
};
