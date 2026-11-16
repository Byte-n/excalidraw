import {
  TABLE_CELL_TEXT_FONT_SIZE,
  VERTICAL_ALIGN,
  getLineHeight,
} from "@excalidraw/common";

import type { TextBlock, TextBlockStyle } from "@excalidraw/element";

import type App from "../App";

/**
 * 单元格文本块的装配：只造 `texts` 块，不造元素、不入场景。字号、对齐取
 * 表格自己的默认值，字体族跟随当前画布工具状态——建表预设与双击编辑因此
 * 同源。
 */
export type TableCellTextApp = Pick<App, "state">;

export const buildTableCellTextBlock = (
  app: TableCellTextApp,
  {
    text,
    fontSize = TABLE_CELL_TEXT_FONT_SIZE,
    textAlign = "left",
    verticalAlign = VERTICAL_ALIGN.MIDDLE,
  }: {
    text: string;
    fontSize?: number;
    textAlign?: TextBlockStyle["textAlign"];
    verticalAlign?: TextBlockStyle["verticalAlign"];
  },
): TextBlock => {
  const fontFamily = app.state.currentItemFontFamily;
  const style: TextBlockStyle = {
    fontFamily,
    fontSize,
    lineHeight: getLineHeight(fontFamily),
    textAlign,
    verticalAlign,
  };
  return { text, style };
};
