import { updateBoundElements } from "../binding";
import { getCompositeShapeTextFitMode, isShapeElement } from "../compositeShape";
import {
  fitSequenceFragmentOperatorFromTexts,
  refitSequenceFragmentRowBackgroundTexts,
} from "../compositeShape/sequenceFragmentScene";
import {
  getSequenceLifelineTextBlockHeight,
  isSequenceFragmentElement,
  isSequenceLifelineElement,
} from "../compositeShape/sequenceOutline";
import { relayoutMindmapScene } from "../mindmapScene";
import { updateStickyNoteLayout } from "../stickyNote";
import { applyTableTextLayout } from "../tableSceneGeometry";
import { getSequenceLifelineTextFitUpdates } from "../textElement";
import { normalizeText } from "../textMeasurements";
import {
  isLinearElement,
  isMindmapNodeElement,
  isStickyNoteElement,
  isTableElement,
} from "../typeChecks";

import { getTextLayoutUpdates } from "./applyLayout";
import { parseTextRegionKey } from "./keys";
import { getLinearLabelPosition } from "./labelLayout";
import { normalizeSingleLineText } from "./layout";
import { getTextBlock, withTextBlock, withoutTextBlock } from "./ops";
import { getTextRegion } from "./regions";

import type { Scene } from "../Scene";
import type { ExcalidrawElement } from "../types";

import type {
  TextBlock,
  TextBlockMap,
  TextBlockStyle,
  TextRegionKey,
} from "./types";

const FIT_EPSILON = 1e-6;

export type TextRegionChange = Readonly<{
  text: string;
  style?: TextBlockStyle;
  placement?: TextBlock["placement"];
}>;

export type ApplyTextRegionOptions = Readonly<{
  /** false 只写文本，跳过几何反馈（程序化只想改内容时使用）。 */
  reflow?: boolean;
}>;

const isSameStyle = (left: TextBlockStyle, right: TextBlockStyle) =>
  left.fontFamily === right.fontFamily &&
  left.fontSize === right.fontSize &&
  (left.fontWeight ?? null) === (right.fontWeight ?? null) &&
  left.lineHeight === right.lineHeight &&
  left.textAlign === right.textAlign &&
  left.verticalAlign === right.verticalAlign &&
  (left.color ?? null) === (right.color ?? null);

const isSamePlacement = (
  left: TextBlock["placement"],
  right: TextBlock["placement"],
) =>
  (left?.labelPosition ?? null) === (right?.labelPosition ?? null) &&
  (left?.baseFontSize ?? null) === (right?.baseFontSize ?? null);

const isSameBlock = (left: TextBlock | undefined, right: TextBlock) =>
  !!left &&
  left.text === right.text &&
  isSameStyle(left.style, right.style) &&
  isSamePlacement(left.placement, right.placement);

/** 清空所有区域时整体替换元素：`mutateElement` 会忽略 undefined。 */
const removeTextsProperty = (scene: Scene, element: ExcalidrawElement) => {
  scene.captureTransactionPreImage(element);
  scene.replaceAllElements(
    scene
      .getElementsIncludingDeleted()
      .map((candidate) =>
        candidate.id === element.id
          ? (Object.fromEntries(
              Object.entries(candidate).filter(([key]) => key !== "texts"),
            ) as ExcalidrawElement)
          : candidate,
      ),
  );
};

/** 写入区域文本；内容与样式都未变化时跳过，避免每次输入都递增版本。 */
const writeTextBlock = (
  scene: Scene,
  element: ExcalidrawElement,
  region: TextRegionKey,
  block: TextBlock,
): boolean => {
  const current = getTextBlock(element.texts, region);
  if (isSameBlock(current, block) || (!block.text && !current)) {
    return false;
  }

  const nextTexts: TextBlockMap | undefined = block.text
    ? withTextBlock(element.texts, region, block)
    : withoutTextBlock(element.texts, region);

  if (nextTexts === undefined) {
    removeTextsProperty(scene, element);
  } else {
    scene.mutateElement(element, { texts: nextTexts });
  }
  return true;
};

/** 页面级几何反馈：形状尺寸、便签高度、脑图整图、表格/片段行高、生命线头部。 */
export const reflowTextRegion = (
  scene: Scene,
  elementId: string,
  region: TextRegionKey,
): boolean => {
  const element = scene.getNonDeletedElement(elementId);
  if (!element) {
    return false;
  }
  const definition = getTextRegion(element, region);
  if (!definition || definition.reflow === "none") {
    return false;
  }

  if (definition.reflow === "graph") {
    if (isMindmapNodeElement(element)) {
      relayoutMindmapScene(scene, element.graphId);
      return true;
    }
    return false;
  }

  if (definition.reflow === "rows") {
    if (isTableElement(element)) {
      return applyTableTextLayout(scene, element);
    }
    if (isSequenceFragmentElement(element)) {
      const parsed = parseTextRegionKey(region);
      if (parsed?.kind === "row") {
        refitSequenceFragmentRowBackgroundTexts(scene, element, {
          rowIds: [parsed.rowId],
          grow: true,
        });
      } else {
        fitSequenceFragmentOperatorFromTexts(scene, element);
      }
      return true;
    }
    return false;
  }

  if (isStickyNoteElement(element)) {
    updateStickyNoteLayout(element, scene);
    return true;
  }

  if (isSequenceLifelineElement(element)) {
    const body = element.texts?.body;
    if (!body?.text || getCompositeShapeTextFitMode(element) !== "auto") {
      return false;
    }
    const fit = getSequenceLifelineTextFitUpdates(
      element,
      getSequenceLifelineTextBlockHeight(element, body),
    );
    if (!fit) {
      return false;
    }
    scene.mutateElement(element, fit);
    const latest = scene.getNonDeletedElement(elementId);
    if (latest) {
      updateBoundElements(latest, scene);
    }
    return true;
  }

  if (!isShapeElement(element) || region !== "body") {
    return false;
  }

  // 正文清空后缩回用户设定的最小尺寸；最小尺寸本身保留。
  if (!element.texts?.body?.text) {
    const width = element.textFitMinWidth ?? element.width;
    const height = element.textFitMinHeight ?? element.height;
    if (
      Math.abs(width - element.width) <= FIT_EPSILON &&
      Math.abs(height - element.height) <= FIT_EPSILON
    ) {
      return false;
    }
    scene.mutateElement(element, { width, height });
    const latest = scene.getNonDeletedElement(elementId);
    if (latest) {
      updateBoundElements(latest, scene);
    }
    return true;
  }

  const updates = getTextLayoutUpdates(element);
  if (!updates) {
    return false;
  }
  scene.mutateElement(element, {
    ...updates,
    textFitMinWidth: element.textFitMinWidth ?? element.width,
    textFitMinHeight: element.textFitMinHeight ?? element.height,
  });
  // 尺寸变化后绑定箭头需要重锚，与手工缩放保持同一语义。
  const latest = scene.getNonDeletedElement(elementId);
  if (latest) {
    updateBoundElements(latest, scene);
  }
  return true;
};

/**
 * 区域文本的唯一写入入口：写 `texts[region]`，再按区域的 `reflow` 声明
 * 跑一遍几何反馈。编辑输入、提交、程序化写文本、样式变更共用它。
 */
export const applyTextRegionChange = (
  scene: Scene,
  elementId: string,
  region: TextRegionKey,
  change: TextRegionChange,
  options?: ApplyTextRegionOptions,
): boolean => {
  const element = scene.getNonDeletedElement(elementId);
  if (!element) {
    return false;
  }
  const definition = getTextRegion(element, region);
  if (!definition) {
    return false;
  }

  const block = getTextBlock(element.texts, region);
  const style = change.style ?? block?.style;
  if (!style) {
    return false;
  }

  const rawText =
    definition.wrap === "single-line"
      ? normalizeSingleLineText(change.text)
      : normalizeText(change.text);
  // 纯空白等价于清空区域，与提交语义保持一致。
  const text = rawText.trim() ? rawText : "";
  const placement =
    change.placement ??
    block?.placement ??
    (region === "label" && isLinearElement(element)
      ? { labelPosition: getLinearLabelPosition(element) }
      : undefined);
  const nextBlock: TextBlock = {
    text,
    style,
    ...(placement ? { placement } : {}),
  };

  const didWrite = writeTextBlock(scene, element, region, nextBlock);
  if (!didWrite) {
    return false;
  }
  if (options?.reflow !== false) {
    reflowTextRegion(scene, elementId, region);
  }
  return true;
};
