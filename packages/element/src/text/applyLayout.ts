import {
  STICKY_NOTE_BODY_INSET_Y,
  STICKY_NOTE_MIN_SIZE,
  STICKY_NOTE_PADDING,
} from "@excalidraw/common";

import { isShapeElement } from "../compositeShape";
import { getCompositeShapeDimensionsForText } from "../compositeShape/textLayout";
import { getMindmapShapeId, isMindmapLayoutFrozen } from "../mindmap";
import { getStickyNoteTextFit } from "../stickyNote";
import { computeTextContainerDimension } from "../textElement";
import { isMindmapNodeElement, isStickyNoteElement } from "../typeChecks";

import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawShapeElement,
  ExcalidrawStickyNoteElement,
} from "../types";

import {
  getLocalTextRegionLayout,
  layoutTextRegionsLocal,
} from "./regionLayout";
import { getTextRegion, getTextRegions } from "./regions";

/** auto-fit 形状根据当前文本区域布局需要的元素尺寸；无需变化时返回 null。 */
export const getShapeTextLayoutUpdates = (
  element: ExcalidrawShapeElement,
): Readonly<{ width: number; height: number }> | null => {
  const body = getTextRegions(element).find(
    (region) => region.key === "body" && region.fit === "auto",
  );
  if (!body) {
    return null;
  }

  // 无文本的区域不参与反向求解，否则空文本会把元素撑到最小尺寸。
  const text = element.texts?.body?.text;
  if (!text) {
    return null;
  }

  const layout = layoutTextRegionsLocal(element).find(
    (region) => region.key === "body",
  );
  if (!layout) {
    return null;
  }

  const next = getCompositeShapeDimensionsForText(
    element,
    layout.width,
    layout.height,
  );
  if (
    Math.abs(next.width - element.width) <= 1e-6 &&
    Math.abs(next.height - element.height) <= 1e-6
  ) {
    return null;
  }
  return next;
};

/**
 * 便签根据正文 fit 需要的元素高度：正文清空回到 `baseHeight`，
 * 放不下时向上增长。`baseHeight` 是用户设定的高度意图，这里不写。
 */
const getStickyNoteTextLayoutUpdates = (
  element: ExcalidrawStickyNoteElement,
): Readonly<{ height: number }> | null => {
  const baseWidth = Math.max(element.width, STICKY_NOTE_MIN_SIZE);
  const baseHeight = Math.max(
    element.baseHeight || element.height,
    STICKY_NOTE_MIN_SIZE,
  );
  const block = element.texts?.body;
  const height = block?.text
    ? Math.max(
        baseHeight,
        getStickyNoteTextFit(
          block.text,
          block.style,
          Math.max(baseWidth - STICKY_NOTE_PADDING * 2, 1),
          Math.max(baseHeight - STICKY_NOTE_BODY_INSET_Y, 0),
        ).height + STICKY_NOTE_BODY_INSET_Y,
      )
    : baseHeight;

  return Math.abs(height - element.height) > 1e-6 ? { height } : null;
};

/**
 * 脑图节点根据正文布局需要的尺寸：只放大放不下的那一维，不收缩。
 * 几何被冻结、无正文或区域缺失时返回 null。
 */
export const getMindmapNodeTextLayoutUpdates = (
  element: ExcalidrawMindmapNodeElement,
): Readonly<{ width: number; height: number }> | null => {
  if (isMindmapLayoutFrozen(element)) {
    return null;
  }
  if (!element.texts?.body?.text) {
    return null;
  }
  const region = getTextRegion(element, "body");
  const layout = getLocalTextRegionLayout(element, "body");
  if (!region || !layout) {
    return null;
  }
  const shapeId = getMindmapShapeId(element);
  // 胶囊按椭圆求解，文字形态按矩形求解
  const shape =
    shapeId === "pill" ? "ellipse" : shapeId === "text" ? "rectangle" : shapeId;

  let { width, height } = element;
  if (layout.width > region.bounds.width + 1e-6) {
    width = Math.max(
      width,
      computeTextContainerDimension(layout.width, shape),
    );
  }
  if (layout.height > region.bounds.height + 1e-6) {
    height = Math.max(
      height,
      computeTextContainerDimension(layout.height, shape),
    );
  }
  return Math.abs(width - element.width) > 1e-6 ||
    Math.abs(height - element.height) > 1e-6
    ? { width, height }
    : null;
};

/** auto-fit 元素根据正文需要的几何更新；无需变化时返回 null。 */
export const getTextLayoutUpdates = (
  element: ExcalidrawElement,
): Readonly<{ width?: number; height?: number }> | null => {
  if (isStickyNoteElement(element)) {
    return getStickyNoteTextLayoutUpdates(element);
  }
  if (isMindmapNodeElement(element)) {
    return getMindmapNodeTextLayoutUpdates(element);
  }
  if (isShapeElement(element)) {
    return getShapeTextLayoutUpdates(element);
  }
  return null;
};
