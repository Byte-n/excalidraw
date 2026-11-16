import {
  applyTableTextLayout,
  getPrimaryTextRegion,
  getSelectedElements,
  getTextBlock,
  getTextLayoutUpdates,
  isLinearElement,
  isMindmapNodeElement,
  isStickyNoteElement,
  isTableElement,
  relayoutMindmapScene,
  updateStickyNoteLayout,
  withTextBlock,
} from "@excalidraw/element";

import type {
  Scene,
  TextBlockMap,
  TextBlockStyle,
  TextRegionKey,
} from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { AppState } from "../../types";

/** 元素自身的一个文本区域：样式 action 的写入目标。 */
export type TextStyleTarget = Readonly<{
  elementId: string;
  region: TextRegionKey;
}>;

/**
 * 元素的正文目标：composite / flow / stickynote / mindmap-node / table /
 * 线性元素标签，且必须已注册主文本区域。
 */
export const getElementEmbeddedTextTarget = (
  element: ExcalidrawElement,
): TextStyleTarget | null => {
  if (
    element.type !== "composite" &&
    element.type !== "flow" &&
    element.type !== "dataflow" &&
    !isStickyNoteElement(element) &&
    !isMindmapNodeElement(element) &&
    !isTableElement(element) &&
    !isLinearElement(element)
  ) {
    return null;
  }
  const region = getPrimaryTextRegion(element);
  return region ? { elementId: element.id, region: region.key } : null;
};

/** 当前正在编辑的内嵌区域（若有）；旧编辑路径返回 null。 */
export const getEditingEmbeddedTextTarget = (
  appState: Pick<AppState, "editingTextRegion">,
): TextStyleTarget | null => appState.editingTextRegion?.target ?? null;

/** 选中元素中已内嵌正文、且存在对应区域的目标。 */
export const getSelectedEmbeddedTextTargets = (
  elements: readonly ExcalidrawElement[],
  appState: Pick<AppState, "selectedElementIds">,
): TextStyleTarget[] => {
  const targets: TextStyleTarget[] = [];
  const seen = new Set<string>();
  for (const element of getSelectedElements(elements, appState)) {
    const target = getElementEmbeddedTextTarget(element);
    if (!target) {
      continue;
    }
    const key = `${target.elementId}:${target.region}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push(target);
  }
  return targets;
};

/** 读取目标当前样式；没有文本 block 时返回 null。 */
export const getTextStyleTargetStyle = (
  element: ExcalidrawElement,
  region: TextRegionKey,
): TextBlockStyle | null =>
  getTextBlock(element.texts as TextBlockMap | undefined, region)?.style ??
  null;

/** 样式补丁是否真的改变了当前样式。 */
const hasTextStyleChange = (
  current: TextBlockStyle,
  next: Partial<TextBlockStyle>,
) =>
  (Object.keys(next) as (keyof TextBlockStyle)[]).some(
    (key) => next[key] !== undefined && current[key] !== next[key],
  );

/**
 * 批量写入样式：只更新已存在的 block，不创建空 block。
 * 返回是否至少更新了一个目标；有变化时由调用方负责 applyLayout。
 */
export const updateEmbeddedTextStyles = (
  scene: Scene,
  targetStyleUpdates: readonly {
    elementId: string;
    region: TextRegionKey;
    style: Partial<TextBlockStyle>;
  }[],
): boolean => {
  let didUpdate = false;

  for (const { elementId, region, style } of targetStyleUpdates) {
    const element = scene.getNonDeletedElement(elementId);
    const block = getTextBlock(
      element?.texts as TextBlockMap | undefined,
      region,
    );
    if (!element || !block) {
      continue;
    }
    if (!hasTextStyleChange(block.style, style)) {
      continue;
    }
    scene.mutateElement(element, {
      texts: withTextBlock(element.texts, region, {
        ...block,
        style: { ...block.style, ...style },
      }),
    });
    didUpdate = true;
  }

  return didUpdate;
};

/**
 * 样式写入后按正文重新求解尺寸与布局。
 * composite / flow / dataflow 正文记录 textFitMin*；便签只按 fit 调整高度，
 * 不写最小尺寸；脑图节点触发整图重排（位置与派生边）；数据流标题栏不参与
 * 尺寸求解。
 */
export const applyEmbeddedTextLayout = (
  scene: Scene,
  elementId: string,
  region?: TextRegionKey,
): void => {
  const element = scene.getNonDeletedElement(elementId);
  if (!element) {
    return;
  }
  if (isMindmapNodeElement(element)) {
    relayoutMindmapScene(scene, element.graphId);
    return;
  }
  if (isTableElement(element)) {
    // 表格样式只影响区域布局（字号/字重/对齐），行高按新文本撑开
    applyTableTextLayout(scene, element);
    return;
  }
  if (region === "title") {
    return;
  }
  if (isStickyNoteElement(element)) {
    // 便签正文的 fit 可能改变高度，绑定箭头必须跟着重锚
    updateStickyNoteLayout(element, scene);
    return;
  }
  const updates = getTextLayoutUpdates(element);
  if (!updates) {
    return;
  }
  if (
    element.type !== "composite" &&
    element.type !== "flow" &&
    element.type !== "dataflow"
  ) {
    return;
  }
  scene.mutateElement(element, {
    ...updates,
    textFitMinWidth: element.textFitMinWidth ?? element.width,
    textFitMinHeight: element.textFitMinHeight ?? element.height,
  });
};
