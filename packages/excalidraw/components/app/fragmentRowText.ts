import {
  TABLE_CELL_TEXT_FONT_SIZE,
  VERTICAL_ALIGN,
  getLineHeight,
} from "@excalidraw/common";
import {
  fragmentRowContainerRef,
  getSequenceFragmentRowBackgroundTextLayout,
  getSequenceFragmentRowBounds,
  isSequenceFragmentElement,
  newElementWith,
  newTextElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type App from "../App";

/**
 * 行背景文字的装配：**只造元素，不入场景**。位置、换行、尺寸由行几何算出
 * （`getSequenceFragmentRowBackgroundTextLayout`），字体族与颜色取当前画布
 * 工具状态——与表格单元格背景文本同源。单独一个模块让交互编辑与抽屉预设
 * 都能复用它而不互相依赖。
 */

export type FragmentRowTextApp = Pick<App, "state" | "getCurrentItemStrokeWidth">;

export const buildFragmentRowBackgroundText = (
  app: FragmentRowTextApp,
  fragment: NonDeleted<ExcalidrawElement>,
  rowId: string,
  {
    text: content,
    fontSize = TABLE_CELL_TEXT_FONT_SIZE,
    identity,
  }: {
    text: string;
    fontSize?: number;
    /** 显式身份（离屏预览必须传，见 `CreationIdentity`） */
    identity?: { id?: string; seed?: number };
  },
): NonDeleted<ExcalidrawTextElement> => {
  if (!isSequenceFragmentElement(fragment)) {
    throw new Error(`Not a sequence fragment: ${fragment.id}`);
  }
  const bounds = getSequenceFragmentRowBounds(
    fragment.width,
    fragment.height,
    fragment.shape.fragment,
    rowId,
  );
  if (!bounds) {
    throw new Error(`Unknown fragment row: ${rowId}`);
  }

  const fontFamily = app.state.currentItemFontFamily;

  let text = newTextElement({
    x: 0,
    y: 0,
    strokeColor: app.state.currentItemStrokeColor,
    backgroundColor: app.state.currentItemBackgroundColor,
    fillStyle: app.state.currentItemFillStyle,
    strokeWidth: app.getCurrentItemStrokeWidth("text"),
    strokeStyle: app.state.currentItemStrokeStyle,
    opacity: app.state.currentItemOpacity,
    text: content,
    fontSize,
    fontFamily,
    lineHeight: getLineHeight(fontFamily),
    // The row grows for wrapped text; the fragment width stays the owner of
    // the available line width. A fragment row text only supports top-left
    // alignment.
    textAlign: "left",
    verticalAlign: VERTICAL_ALIGN.TOP,
    containerId: null,
    autoResize: false,
    locked: false,
    containerRef: fragmentRowContainerRef(fragment.id, rowId),
    ...identity,
  });

  const layout = getSequenceFragmentRowBackgroundTextLayout(
    text,
    fragment,
    bounds,
  );
  text = newElementWith(text, {
    ...layout,
  });

  return text;
};

/**
 * Scene index for a pasted/imported row text: after the fragment's existing
 * row texts, else right after the fragment itself (background text sits just
 * above the row's other content, mirroring a table cell).
 */
export const getSequenceFragmentRowTextInsertionIndex = (
  elements: readonly ExcalidrawElement[],
  fragmentId: string,
): number | null => {
  for (let index = elements.length - 1; index >= 0; index--) {
    const ref = elements[index].containerRef;
    if (ref?.kind === "fragmentRow" && ref.elementId === fragmentId) {
      return index + 1;
    }
  }
  const fragmentIndex = elements.findIndex(
    (element) => element.id === fragmentId,
  );
  return fragmentIndex === -1 ? null : fragmentIndex + 1;
};
