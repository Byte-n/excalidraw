import { maxBindingDistance_simple } from "../bindingGap";

/**
 * Connection thresholds (screen pixels, converted to scene units via `zoom`).
 *
 * All functions are pure; `zoom <= 0` is treated as `1` (the scene is not
 * rendered at a valid scale in that case).
 */
export const ANCHOR_RADIUS_PX = 14;
export const OUTLINE_INSIDE_BAND_PX = 10;

const normalizeZoom = (zoom: number): number => (zoom > 0 ? zoom : 1);

/**
 * Outer outline band = the existing bindable range. The band must at least
 * cover `gap`: every point on Γ is exactly one `gap` away from the outline, so
 * a narrower band would make the outline tier unreachable at Γ points (thick
 * strokes / large gaps).
 */
export const getOutsideBand = (zoom: number, gap: number): number =>
  Math.max(
    maxBindingDistance_simple({
      value: normalizeZoom(zoom),
    } as Parameters<typeof maxBindingDistance_simple>[0]),
    gap,
  );

/** Inner outline band, capped so it never swallows the whole element. */
export const getInsideBand = (
  element: { width: number; height: number },
  zoom: number,
): number =>
  Math.min(
    OUTLINE_INSIDE_BAND_PX / normalizeZoom(zoom),
    0.25 * Math.min(element.width, element.height),
  );

/**
 * Anchor snap radius. Capped by the outer band and by a quarter of the
 * element's shorter side so anchors never cover a whole edge of a small or
 * zoomed-out element.
 */
export const getAnchorRadius = (
  element: { width: number; height: number },
  zoom: number,
  gap: number,
): number =>
  Math.min(
    ANCHOR_RADIUS_PX / normalizeZoom(zoom),
    getOutsideBand(zoom, gap),
    0.25 * Math.min(element.width, element.height),
  );
