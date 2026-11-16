import { getLineHeight, sceneCoordsToViewportCoords } from "@excalidraw/common";

import {
  applyTableTextLayout,
  fitSequenceFragmentOperatorFromTexts,
  getCompositeShapeTextFitMode,
  getLinearLabelPosition,
  getMindmapNodeTextStyle,
  getSequenceLifelineTextBlockHeight,
  getSequenceLifelineTextFitUpdates,
  getTableCellTextBaseStyle,
  getTextBlock,
  getTextLayoutUpdates,
  getVisibleTableCell,
  isLinearElement,
  isMindmapNodeElement,
  isSequenceFragmentElement,
  isSequenceLifelineElement,
  isStickyNoteElement,
  isTableElement,
  newElementWith,
  normalizeText,
  parseTextRegionKey,
  refitSequenceFragmentRowBackgroundTexts,
  relayoutMindmapScene,
  resolveTableCellTextStyle,
  updateStickyNoteLayout,
  withoutTextBlock,
  withTextBlock,
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
 * 进入元素正文编辑：创建编辑会话与轻量覆盖层，提交时一次性写回 `texts`。
 * 不创建绑定文字元素，也不写入 `editingTextElement`。
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

  const block = getTextBlock(target.texts, region);
  const baseStyle = block?.style ?? getDefaultTextBlockStyle(app, target);
  // 表格的行/列覆盖与表头权重只在布局期派生，编辑框要与画布一致；
  // 提交时仍写回未套用覆盖的基础样式。
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

  app.setState({
    editingTextRegion: session,
    selectedElementIds: { [target.id]: true },
  });

  let isFinished = false;
  let submit: () => void = () => {};

  const clearSession = () => {
    isFinished = true;
    if (app.textWysiwygSubmitHandler === submit) {
      app.textWysiwygSubmitHandler = null;
    }
    app.setState({ editingTextRegion: null });
  };

  const commit = (nextText: string) => {
    if (isFinished) {
      return;
    }
    isFinished = true;
    if (app.textWysiwygSubmitHandler === submit) {
      app.textWysiwygSubmitHandler = null;
    }

    const current = app.scene.getNonDeletedElement(target.id);
    if (isRegionTextElement(current)) {
      const text = normalizeText(nextText);
      const hasText = !!text.trim();
      const didChange =
        text !== (getTextBlock(current.texts, region)?.text ?? "");

      if (didChange) {
        // 沿路径标签的位置持久化在 block.placement 中；缺失时回到默认位置
        const placement =
          region === "label" && isLinearElement(current)
            ? { labelPosition: getLinearLabelPosition(current) }
            : getTextBlock(current.texts, region)?.placement;
        const nextTexts = hasText
          ? withTextBlock(current.texts, region, {
              text,
              style: baseStyle,
              ...(placement ? { placement } : {}),
            })
          : withoutTextBlock(current.texts, region);
        if (nextTexts === undefined) {
          // `mutateElement` 忽略 undefined，清空 texts 需要整体替换元素
          app.scene.replaceAllElements(
            app.scene.getElementsIncludingDeleted().map((element) => {
              if (element.id !== current.id) {
                return element;
              }
              const next = Object.fromEntries(
                Object.entries(element).filter(([key]) => key !== "texts"),
              ) as ExcalidrawElement;
              return newElementWith(next, {}, true);
            }),
          );
        } else {
          app.scene.mutateElement(current, { texts: nextTexts });
        }
      }

      const updated = app.scene.getNonDeletedElement(target.id);
      if (isRegionTextElement(updated)) {
        if (isSequenceFragmentElement(updated)) {
          // 页签提交后按文本适配页签宽度/表头行高；行提交后撑高该行
          const parsed = parseTextRegionKey(region);
          if (parsed?.kind === "row") {
            refitSequenceFragmentRowBackgroundTexts(app.scene, updated, {
              rowIds: [parsed.rowId],
              grow: true,
            });
          } else {
            fitSequenceFragmentOperatorFromTexts(app.scene, updated);
          }
        } else if (isTableElement(updated)) {
          // 表格：只按新文本撑高行，不动宽度
          applyTableTextLayout(app.scene, updated);
        } else if (isMindmapNodeElement(updated)) {
          // 脑图：正文尺寸、兄弟位置与派生边一起重排
          if (didChange) {
            relayoutMindmapScene(app.scene, updated.graphId);
          }
        } else if (isSequenceLifelineElement(updated) && region === "body") {
          // 生命线的头部随正文增长，宽度与杆长保持不变；
          // 固定模式保留用户设定的头部，只做显示截断
          const body = updated.texts?.body;
          if (
            hasText &&
            body &&
            getCompositeShapeTextFitMode(updated) === "auto"
          ) {
            const fit = getSequenceLifelineTextFitUpdates(
              updated,
              getSequenceLifelineTextBlockHeight(updated, body),
            );
            if (fit) {
              app.scene.mutateElement(updated, fit);
            }
          }
        } else if (
          !isLinearElement(updated) &&
          !(updated.type === "dataflow" && region === "title")
        ) {
          // 数据流标题栏固定单行，只写文本；其余区域按正文求解尺寸
          const updates = getTextLayoutUpdates(updated);
          // 便签：正文 fit 决定高度，绑定箭头随高度重锚
          if (isStickyNoteElement(updated)) {
            updateStickyNoteLayout(updated, app.scene);
          } else if (hasText) {
            // auto-fit：尺寸随正文增长，同时记住用户设定的最小尺寸
            if (updates) {
              app.scene.mutateElement(updated, {
                ...updates,
                textFitMinWidth: updated.textFitMinWidth ?? updated.width,
                textFitMinHeight: updated.textFitMinHeight ?? updated.height,
              });
            }
          } else {
            // 正文清空后缩回最小尺寸；最小尺寸本身保留
            const minWidth = updated.textFitMinWidth;
            const minHeight = updated.textFitMinHeight;
            if (
              (minWidth !== undefined && minWidth !== updated.width) ||
              (minHeight !== undefined && minHeight !== updated.height)
            ) {
              app.scene.mutateElement(updated, {
                ...(minWidth !== undefined ? { width: minWidth } : {}),
                ...(minHeight !== undefined ? { height: minHeight } : {}),
              });
            }
          }
        }
      }

      // 新建节点提交空正文时没有文本差异，但创建本身仍待捕获：
      // 这里统一触发捕获，避免其与后续文字修改合并成同一条历史。
      app.store.scheduleCapture();
    }

    app.setState({ editingTextRegion: null });
  };

  const cancel = () => {
    if (isFinished) {
      return;
    }
    clearSession();
  };

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
    onCommit: commit,
    onCancel: cancel,
    autoSelect: opts?.autoSelect ?? true,
  });
  app.textWysiwygSubmitHandler = submit;
};
