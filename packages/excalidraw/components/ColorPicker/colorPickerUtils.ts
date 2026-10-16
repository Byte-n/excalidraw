import {
  isColorDark,
  isTransparent,
  MAX_CUSTOM_COLORS_USED_IN_CANVAS,
} from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { ColorPickerColor, ColorPaletteCustom } from "@excalidraw/common";

import { atom } from "../../editor-jotai";

export const getColorNameAndShadeFromColor = ({
  palette,
  color,
}: {
  palette: ColorPaletteCustom;
  color: string | null;
}): {
  colorName: ColorPickerColor;
  shade: number | null;
} | null => {
  if (!color) {
    return null;
  }
  for (const [colorName, colorVal] of Object.entries(palette)) {
    if (Array.isArray(colorVal)) {
      const shade = colorVal.indexOf(color);
      if (shade > -1) {
        return { colorName: colorName as ColorPickerColor, shade };
      }
    } else if (colorVal === color) {
      return { colorName: colorName as ColorPickerColor, shade: null };
    }
  }
  return null;
};

export const colorPickerHotkeyBindings = [
  ["q", "w", "e", "r", "t"],
  ["a", "s", "d", "f", "g"],
  ["z", "x", "c", "v", "b"],
].flat();

export const isCustomColor = ({
  color,
  palette,
  presetColors,
}: {
  color: string;
  palette: ColorPaletteCustom;
  /** 弹层预设行：预设色不算自定义色（不进「自定义」区） */
  presetColors?: readonly string[];
}) => {
  if (presetColors?.includes(color)) {
    return false;
  }
  const paletteValues = Object.values(palette).flat();
  return !paletteValues.includes(color);
};

export const getMostUsedCustomColors = (
  elements: readonly ExcalidrawElement[],
  type: "elementBackground" | "elementStroke",
  palette: ColorPaletteCustom,
  presetColors?: readonly string[],
) => {
  const elementColorTypeMap = {
    elementBackground: "backgroundColor",
    elementStroke: "strokeColor",
  };

  const colors = elements.filter((element) => {
    if (element.isDeleted) {
      return false;
    }

    const color =
      element[elementColorTypeMap[type] as "backgroundColor" | "strokeColor"];

    // fully-transparent colors are "no color", not a reusable custom color
    // (matters for palettes that exclude `transparent`, e.g. bucket fill)
    return (
      !isTransparent(color) && isCustomColor({ color, palette, presetColors })
    );
  });

  const colorCountMap = new Map<string, number>();
  colors.forEach((element) => {
    const color =
      element[elementColorTypeMap[type] as "backgroundColor" | "strokeColor"];
    if (colorCountMap.has(color)) {
      colorCountMap.set(color, colorCountMap.get(color)! + 1);
    } else {
      colorCountMap.set(color, 1);
    }
  });

  return [...colorCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((c) => c[0])
    .slice(0, MAX_CUSTOM_COLORS_USED_IN_CANVAS);
};

export type ActiveColorPickerSectionAtomType =
  | "custom"
  | "baseColors"
  | "shades"
  | "hex"
  | null;
export const activeColorPickerSectionAtom =
  atom<ActiveColorPickerSectionAtomType>(null);

export type ColorPickerType =
  | "canvasBackground"
  | "elementBackground"
  | "elementStroke"
  // the table grid picker needs its own popup identity: `openPopup` is keyed
  // by picker type, and sharing "elementStroke" with the table border picker
  // would open both popovers at once
  | "tableGrid"
  // the mindmap edge picker samples the stroke-color domain but, like the
  // table grid picker, needs its own popup identity
  | "mindmapEdgeColor";

// -----------------------------------------------------------------------------
// swatch label contrast
// -----------------------------------------------------------------------------

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** parse `#rgb[a]` / `#rrggbb[aa]` into RGB, or null when it isn't a hex color
 * or is fully transparent (alpha 0 — nothing to draw a legible label on) */
const parseHexColor = (
  color: string,
): { r: number; g: number; b: number } | null => {
  const match = HEX_COLOR_RE.exec(color.trim());
  if (!match) {
    return null;
  }
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (hex.length === 8 && parseInt(hex.slice(6, 8), 16) === 0) {
    return null;
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
};

/** sRGB channel (0–255) → linear-light value (WCAG 2.x) */
const channelToLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const relativeLuminance = (rgb: { r: number; g: number; b: number }): number =>
  0.2126 * channelToLinear(rgb.r) +
  0.7152 * channelToLinear(rgb.g) +
  0.0722 * channelToLinear(rgb.b);

/** WCAG contrast ratio between two relative luminances */
const contrastRatio = (a: number, b: number): number => {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Label (hotkey text) color to draw on top of a swatch: whichever of white /
 * black has the higher WCAG contrast ratio against the swatch color.
 *
 * `isColorDark`'s YIQ threshold (160) sits well above the equal-contrast point
 * (~116), so mid-tone swatches (e.g. cyan / purple / pink after the dark-mode
 * filter) were getting white text where black actually reads better. Here we
 * compare the real contrast ratios instead.
 *
 * Transparent / empty / unparseable input (e.g. host custom colors like `red`
 * or `rgba(...)`) falls back to the historical YIQ heuristic.
 */
export const getSwatchLabelColor = (swatchColor: string): string => {
  const rgb = parseHexColor(swatchColor);
  if (!rgb) {
    return isColorDark(swatchColor) ? "#fff" : "#000";
  }
  const luminance = relativeLuminance(rgb);
  const whiteContrast = contrastRatio(luminance, 1);
  const blackContrast = contrastRatio(luminance, 0);
  return whiteContrast >= blackContrast ? "#fff" : "#000";
};
