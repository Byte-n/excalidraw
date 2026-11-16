import {
  DEFAULT_FONT_FAMILY,
  TABLE_CELL_TEXT_FONT_SIZE,
  TABLE_CELL_TEXT_PADDING_X,
  TABLE_CELL_TEXT_PADDING_Y,
  getLineHeight,
} from "@excalidraw/common";

import { isTableHeaderRowCell } from "./tableRender";
import { cellKey, parseTextRegionKey } from "./text/keys";
import { withoutTextBlock, withTextBlock } from "./text/ops";

import type {
  BackgroundTextStyle,
  FontFamilyValues,
  TableCellData,
  TableDataV1,
} from "./types";
import type { TextBlockMap, TextBlockStyle } from "./text/types";

/** 表头带文字权重：没有显式覆盖时首行取 600。 */
export const TABLE_HEADER_ROW_FONT_WEIGHT = 600;

/** 单元格文本的默认样式：13px、左对齐、垂直居中。 */
export const getTableCellTextBaseStyle = (
  fontFamily: FontFamilyValues = DEFAULT_FONT_FAMILY,
): TextBlockStyle => ({
  fontFamily,
  fontSize: TABLE_CELL_TEXT_FONT_SIZE,
  lineHeight: getLineHeight(fontFamily),
  textAlign: "left",
  verticalAlign: "middle",
});

/**
 * 单元格文本的轴样式覆盖：行优先，行没有时取列。整份覆盖来自同一条轴，
 * 不按键合并两个级别。
 */
export const getTableCellBackgroundTextStyle = (
  table: TableDataV1,
  cell: Pick<TableCellData, "rowId" | "columnId">,
): BackgroundTextStyle | undefined =>
  table.rows.find((row) => row.id === cell.rowId)?.style?.backgroundText ??
  table.columns.find((column) => column.id === cell.columnId)?.style
    ?.backgroundText;

/** 单元格文本的有效内边距：轴覆盖优先，否则取表格默认值。 */
export const getTableCellTextPadding = (
  table: TableDataV1,
  cell: Pick<TableCellData, "rowId" | "columnId">,
): { x: number; y: number } => {
  const padding = getTableCellBackgroundTextStyle(table, cell)?.padding;
  return padding === undefined
    ? { x: TABLE_CELL_TEXT_PADDING_X, y: TABLE_CELL_TEXT_PADDING_Y }
    : { x: padding, y: padding };
};

/**
 * 单元格文本的最终样式：持久化的块样式为底，行/列覆盖字号、权重、对齐与
 * 颜色，表头带在没有显式权重时补 600。纯派生——样式变更不写回块。
 */
export const resolveTableCellTextStyle = (
  table: TableDataV1,
  cell: Pick<TableCellData, "rowId" | "columnId">,
  base: TextBlockStyle = getTableCellTextBaseStyle(),
): TextBlockStyle => {
  const override = getTableCellBackgroundTextStyle(table, cell);
  const fontWeight =
    override?.fontWeight ??
    base.fontWeight ??
    (isTableHeaderRowCell(table, cell)
      ? TABLE_HEADER_ROW_FONT_WEIGHT
      : undefined);
  const color = override?.color ?? base.color;
  return {
    fontFamily: base.fontFamily,
    fontSize: override?.fontSize ?? base.fontSize,
    ...(fontWeight !== undefined ? { fontWeight } : {}),
    lineHeight: base.lineHeight,
    textAlign: override?.horizontalAlign ?? base.textAlign,
    verticalAlign: override?.verticalAlign ?? base.verticalAlign,
    ...(color !== undefined ? { color } : {}),
  };
};

/**
 * 复制时按单元格 id 映射重写区域 key：只保留落到新表的可见单元格键，
 * 其余（被覆盖格、未知格）丢弃。
 */
export const remapTableTexts = (
  texts: TextBlockMap | undefined,
  cellIdMap: ReadonlyMap<string, string>,
): TextBlockMap | undefined => {
  if (!texts) {
    return texts;
  }
  let next: TextBlockMap | undefined;
  for (const key of Object.keys(texts) as (keyof TextBlockMap)[]) {
    const block = texts[key];
    const parsed = parseTextRegionKey(key);
    if (!block || parsed?.kind !== "cell") {
      continue;
    }
    const nextCellId = cellIdMap.get(parsed.cellId);
    if (nextCellId) {
      next = withTextBlock(next, cellKey(nextCellId), block);
    }
  }
  return next;
};

/** 清掉给定单元格的文本块；没有剩余区域时返回 undefined。 */
export const withoutTableTextCells = (
  texts: TextBlockMap | undefined,
  cellIds: readonly string[],
): TextBlockMap | undefined => {
  let next = texts;
  for (const cellId of cellIds) {
    next = withoutTextBlock(next, cellKey(cellId));
  }
  return next;
};
