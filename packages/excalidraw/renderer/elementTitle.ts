/**
 * Element-title layout shared by the canvas renderer and hit testing.
 *
 * Titles are screen-fixed chrome: the DOM implementation drew them at 12 CSS
 * px regardless of zoom, so the layout divides every length by zoom and the
 * canvas runs under the scene transform.
 */
import {
  FONT_FAMILY,
  FRAME_STYLE,
  TABLE_TITLE_OFFSET_Y,
  getFontString,
} from "@excalidraw/common";
import { getElementTitle, getLineWidth } from "@excalidraw/element";

import type {
  ExcalidrawTitledElement,
  FontString,
} from "@excalidraw/element/types";

/** Board glyph left of an element title (design: 10px box). */
export const ELEMENT_TITLE_GLYPH_SIZE = 10;
/** Gap between the glyph and the title text (design: 5px). */
export const ELEMENT_TITLE_GLYPH_GAP = 5;

export type ElementTitleLayout = {
  /** Scene x of the glyph's left edge. */
  x: number;
  /** Scene y of the title's top edge. */
  y: number;
  /** Glyph + gap + text width, in scene units. */
  width: number;
  /** Line height, in scene units. */
  height: number;
  glyphSize: number;
  glyphGap: number;
  text: string;
  font: FontString;
};

const getElementTitleFont = (zoom: number): FontString =>
  getFontString({
    fontSize: FRAME_STYLE.nameFontSize / zoom,
    fontFamily: FONT_FAMILY.Assistant,
    fontWeight: 500,
  });

const truncateToWidth = (text: string, font: FontString, maxWidth: number) => {
  if (getLineWidth(text, font) <= maxWidth) {
    return text;
  }
  const ellipsis = "…";
  for (let index = text.length - 1; index >= 0; index--) {
    const candidate = `${text.slice(0, index)}${ellipsis}`;
    if (getLineWidth(candidate, font) <= maxWidth) {
      return candidate;
    }
  }
  return ellipsis;
};

export const getElementTitleOffsetY = (element: ExcalidrawTitledElement) =>
  element.type === "table" ? TABLE_TITLE_OFFSET_Y : FRAME_STYLE.nameOffsetY;

export const getElementTitleLayout = (
  element: ExcalidrawTitledElement,
  {
    zoom,
    focused = false,
  }: {
    zoom: number;
    /** Search focus expands the title past the element width, like the DOM. */
    focused?: boolean;
  },
): ElementTitleLayout => {
  const font = getElementTitleFont(zoom);
  const glyphSize = ELEMENT_TITLE_GLYPH_SIZE / zoom;
  const glyphGap = ELEMENT_TITLE_GLYPH_GAP / zoom;
  const height = (FRAME_STYLE.nameFontSize * FRAME_STYLE.nameLineHeight) / zoom;
  const maxTextWidth = Math.max(0, element.width - glyphSize - glyphGap);
  const text = getElementTitle(element);
  const fitted = focused ? text : truncateToWidth(text, font, maxTextWidth);
  const textWidth = getLineWidth(fitted, font);
  return {
    x: element.x,
    y: element.y - getElementTitleOffsetY(element) / zoom - height,
    width: glyphSize + glyphGap + textWidth,
    height,
    glyphSize,
    glyphGap,
    text: fitted,
    font,
  };
};
