import { getLineHeight, sceneCoordsToViewportCoords } from "@excalidraw/common";

import {
  applyTextRegionChange,
  getMindmapNodeTextStyle,
  getTableCellTextBaseStyle,
  getTextBlock,
  getTextRegion,
  getVisibleTableCell,
  isLinearElement,
  isMindmapNodeElement,
  isSequenceFragmentElement,
  isSequenceLifelineElement,
  isStickyNoteElement,
  isTableElement,
  parseTextRegionKey,
  resolveTableCellTextStyle,
} from "@excalidraw/element";

import type {
  TextBlockStyle,
  TextEditingSession,
  TextRegionKey,
} from "@excalidraw/element";
import type {
  ExcalidrawCompositeElement,
  ExcalidrawDataflowElement,
  ExcalidrawElement,
  ExcalidrawFlowElement,
  ExcalidrawLinearElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawSequenceElement,
  ExcalidrawStickyNoteElement,
  ExcalidrawTableElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { textRegionEditor } from "../../wysiwyg/textRegionEditor";

import type App from "../App";

/** 已内嵌正文的元素家族（composite / flow / dataflow / stickynote / mindmap-node / table / sequence fragment / sequence 生命线） */
export const isEmbeddedTextElement = (
  element: ExcalidrawElement | null,
): element is
  | ExcalidrawCompositeElement
  | ExcalidrawFlowElement
  | ExcalidrawDataflowElement
  | ExcalidrawStickyNoteElement
  | ExcalidrawMindmapNodeElement
  | ExcalidrawTableElement
  | ExcalidrawSequenceElement =>
  !!element &&
  (element.type === "composite" ||
    element.type === "flow" ||
    element.type === "dataflow" ||
    element.type === "stickynote" ||
    isMindmapNodeElement(element) ||
    isTableElement(element) ||
    isSequenceFragmentElement(element) ||
    isSequenceLifelineElement(element));

/** 区域文本目标：内嵌正文家族之外，线性元素的标签也走同一编辑流程。 */
type RegionTextElement = NonDeleted<
  | ExcalidrawCompositeElement
  | ExcalidrawFlowElement
  | ExcalidrawDataflowElement
  | ExcalidrawStickyNoteElement
  | ExcalidrawMindmapNodeElement
  | ExcalidrawTableElement
  | ExcalidrawSequenceElement
  | ExcalidrawLinearElement
>;

const isRegionTextElement = (
  element: ExcalidrawElement | null,
): element is RegionTextElement =>
  isEmbeddedTextElement(element) || (!!element && isLinearElement(element));

/** 区域没有文本时使用的默认样式：脑图按节点主题，表格按格默认值，其余跟随当前绘制工具 */
const getDefaultTextBlockStyle = (
  app: App,
  element: ExcalidrawElement,
): TextBlockStyle => {
  if (isMindmapNodeElement(element)) {
    return getMindmapNodeTextStyle(element);
  }
  if (isTableElement(element)) {
    return getTableCellTextBaseStyle(app.state.currentItemFontFamily);
  }
  const fontFamily = app.state.currentItemFontFamily;
  const lineHeight = getLineHeight(fontFamily);
  if (isLinearElement(element)) {
    // 沿路径标签始终居中，颜色跟随元素 ink
    return {
      fontFamily,
      fontSize: app.state.currentItemFontSize,
      lineHeight,
      textAlign: "center",
      verticalAlign: "middle",
      color: app.state.currentItemStrokeColor,
    };
  }
  if (isSequenceFragmentElement(element)) {
    // 页签与行文本固定左上对齐；颜色跟随片段 ink
    return {
      fontFamily,
      fontSize: app.state.currentItemFontSize,
      lineHeight,
      textAlign: "left",
      verticalAlign: "top",
    };
  }
  return {
    fontFamily,
    fontSize: app.state.currentItemFontSize,
    lineHeight,
    textAlign: "center",
    verticalAlign: "middle",
    // 便签的正文颜色跟随便签 ink，不落到绘制工具的颜色上
    ...(isStickyNoteElement(element)
      ? {}
      : { color: app.state.currentItemStrokeColor }),
  };
};

/**
 * 进入元素正文编辑：开启可回滚事务，输入时实时写回 `texts` 并跑几何反馈，
 * 提交时只捕获一次历史，取消时整体回滚。
 */
export const startRegionTextEditing = (
  app: App,
  element: RegionTextElement,
  region: TextRegionKey,
  opts?: {
    initialCaretSceneCoords?: { x: number; y: number } | null;
    autoSelect?: boolean;
  },
): void => {
  // 同一时刻只允许一个编辑会话：先收尾旧会话，避免遗留覆盖层
  app.textWysiwygSubmitHandler?.();

  const latest = app.scene.getNonDeletedElement(element.id);
  const target = isRegionTextElement(latest) ? latest : element;

  if (!getTextRegion(target, region)?.editable) {
    return;
  }

  const block = getTextBlock(target.texts, region);
  const baseStyle = block?.style ?? getDefaultTextBlockStyle(app, target);
  // 表格的行/列覆盖与表头权重只在布局期派生，编辑框要与画布一致；
  // 写回时仍使用未套用覆盖的基础样式。
  const parsedRegion = parseTextRegionKey(region);
  const tableCell =
    isTableElement(target) && parsedRegion?.kind === "cell"
      ? getVisibleTableCell(target.table, parsedRegion.cellId)
      : null;
  const style =
    tableCell && isTableElement(target)
      ? resolveTableCellTextStyle(target.table, tableCell, baseStyle)
      : baseStyle;
  const session: TextEditingSession = {
    target: { elementId: target.id, region },
    initialText: block?.text ?? "",
    style,
  };

  app.scene.beginTransaction();
  app.setState({
    editingTextRegion: session,
    selectedElementIds: { [target.id]: true },
  });

  let isFinished = false;
  let submit: () => void = () => {};
  // 编辑期间样式可能被 Stats/属性面板改掉，写回时优先沿用块上的最新样式
  let liveStyle = baseStyle;

  const releaseSubmitHandler = () => {
    if (app.textWysiwygSubmitHandler === submit) {
      app.textWysiwygSubmitHandler = null;
    }
  };

  /** 输入即写回：文本与几何都进 scene，覆盖层再从新元素派生位置。 */
  const applyText = (nextText: string) => {
    const current = app.scene.getNonDeletedElement(target.id);
    const currentBlock = current
      ? getTextBlock(current.texts, region)
      : undefined;
    if (currentBlock) {
      liveStyle = currentBlock.style;
    }
    applyTextRegionChange(app.scene, target.id, region, {
      text: nextText,
      style: liveStyle,
    });
  };

  const commit = (nextText: string) => {
    if (isFinished) {
      return;
    }
    isFinished = true;
    releaseSubmitHandler();

    const current = app.scene.getNonDeletedElement(target.id);
    if (isRegionTextElement(current)) {
      applyText(nextText);
      // 新建节点提交空正文时没有文本差异，但创建本身仍待捕获：
      // 这里统一触发捕获，避免其与后续文字修改合并成同一条历史。
      app.store.scheduleCapture();
    }
    app.scene.commitTransaction();
    app.setState({ editingTextRegion: null });
  };

  const cancel = () => {
    if (isFinished) {
      return;
    }
    isFinished = true;
    releaseSubmitHandler();
    app.scene.rollbackTransaction();
    app.setState({ editingTextRegion: null });
  };

  try {
    submit = textRegionEditor({
      app,
      element: target,
      session,
      canvas: app.canvas,
      excalidrawContainer: app.excalidrawContainerRef.current,
      getViewportCoords: (x: number, y: number) => {
        const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
          { sceneX: x, sceneY: y },
          app.state,
        );
        return [
          viewportX - app.state.offsetLeft,
          viewportY - app.state.offsetTop,
        ];
      },
      onChange: applyText,
      onCommit: commit,
      onCancel: cancel,
      autoSelect: opts?.autoSelect ?? true,
    });
  } catch (error) {
    // 编辑器没能挂载时不要遗留事务，否则后续编辑会带着旧的快照回滚
    app.scene.rollbackTransaction();
    app.setState({ editingTextRegion: null });
    throw error;
  }
  app.textWysiwygSubmitHandler = submit;
};