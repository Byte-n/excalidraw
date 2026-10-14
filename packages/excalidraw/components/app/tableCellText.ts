import {
  TABLE_CELL_TEXT_FONT_SIZE,
  VERTICAL_ALIGN,
  getLineHeight,
} from "@excalidraw/common";
import {
  getCellBackgroundTextLayout,
  getTableCellBounds,
  newElementWith,
  newTextElement,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import type App from "../App";

/**
 * 单元格背景文字元素的装配：**只造元素，不入场景**。位置、换行、尺寸全由
 * 单元格几何算出（`getCellBackgroundTextLayout`），字体族与颜色则取当前的
 * 画布工具状态——双击单元格敲出来的文字与建表时预设自带的标签因此同源。
 *
 * 单独一个模块是为了让两个调用方共用它而不互相依赖：`app/table` 的交互编辑
 * （造好就插进场景）与 `app/createPresets` 的表格预设（表格还没进场景，标签
 * 与表格随后一次进入）。插场景、算插入位置仍留在各自调用方。
 */

/** 装配用到的 App 切片（与其它 pointer 控制器同一套窄 shim 风格） */
export type TableCellTextApp = Pick<App, "state" | "getCurrentItemStrokeWidth">;

export const buildTableCellBackgroundText = (
  app: TableCellTextApp,
  table: NonDeleted<ExcalidrawTableElement>,
  cellId: string,
  {
    text: content,
    elementsMap,
    fontSize = TABLE_CELL_TEXT_FONT_SIZE,
    textAlign = "left",
    verticalAlign = VERTICAL_ALIGN.MIDDLE,
    identity,
  }: {
    text: string;
    /** 布局要查行列样式：场景里那张表，或只含自己这一张表的映射（建表时） */
    elementsMap: ElementsMap;
    fontSize?: number;
    textAlign?: ExcalidrawTextElement["textAlign"];
    verticalAlign?: ExcalidrawTextElement["verticalAlign"];
    /** 显式身份（离屏预览必须传，见 `CreationIdentity`） */
    identity?: { id?: string; seed?: number };
  },
): NonDeleted<ExcalidrawTextElement> => {
  const bounds = getTableCellBounds(table.table, cellId);
  if (!bounds) {
    throw new Error(`Unknown table cell: ${cellId}`);
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
    // the cell text's factory defaults are table-owned (phase-6): 13px and
    // left-aligned, not whatever the canvas tool last used
    fontSize,
    fontFamily,
    lineHeight: getLineHeight(fontFamily),
    // The row grows for wrapped text; the column width stays table-controlled.
    textAlign,
    verticalAlign,
    containerId: null,
    autoResize: false,
    locked: false,
    containerRef: {
      kind: "tableCell",
      elementId: table.id,
      cellId,
      role: "backgroundText",
    },
    ...identity,
  });

  const layout = getCellBackgroundTextLayout(text, table, bounds, elementsMap);
  text = newElementWith(text, {
    ...layout,
  });

  return text;
};
