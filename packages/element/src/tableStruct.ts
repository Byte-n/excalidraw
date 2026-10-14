import { randomId } from "@excalidraw/common";

import type {
  ExcalidrawTableElement,
  TableCellData,
  TableColumnData,
  TableDataV1,
  TableRowData,
} from "./types";

/**
 * Creation presets, not format constraints — row/column counts and sizes are
 * a starting point the product may tune, never a contract the data layer
 * enforces on persisted tables.
 */
export const DEFAULT_TABLE_ROW_COUNT = 3;
export const DEFAULT_TABLE_COLUMN_COUNT = 3;
// magnitude of the frame / sticky note / mindmap node family
export const DEFAULT_TABLE_ROW_HEIGHT = 56;
export const DEFAULT_TABLE_COLUMN_WIDTH = 160;

/** Cell styles are a closed set; unknown keys make the persisted data invalid. */
const TABLE_CELL_STYLE_KEYS = new Set<string>([
  "backgroundColor",
  "clipContent",
]);
const TABLE_STYLE_KEYS = new Set<string>([
  "backgroundColor",
  "opacity",
  "borderColor",
  "borderWidth",
  "borderStyle",
  "gridColor",
  "gridWidth",
  "gridStyle",
  "clipContent",
  "header",
  "title",
]);
const BACKGROUND_TEXT_STYLE_KEYS = new Set<string>([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "italic",
  "underline",
  "strikethrough",
  "color",
  "horizontalAlign",
  "verticalAlign",
  "padding",
]);

const assertStyle = (
  style: unknown,
  keys: ReadonlySet<string>,
  label: string,
): void => {
  if (!style || typeof style !== "object" || Array.isArray(style)) {
    throw new Error(`Invalid ${label} style`);
  }
  const values = style as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    if (!keys.has(key)) {
      throw new Error(`Unsupported ${label} style key: ${key}`);
    }
    if (key === "backgroundText") {
      assertStyle(value, BACKGROUND_TEXT_STYLE_KEYS, "background text");
    } else if (key === "title") {
      assertStyle(value, new Set(["gap", "align"]), "table title");
    } else if (
      [
        "backgroundColor",
        "borderColor",
        "gridColor",
        "color",
        "fontFamily",
      ].includes(key)
    ) {
      if (typeof value !== "string") {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (
      [
        "opacity",
        "borderWidth",
        "gridWidth",
        "fontSize",
        "fontWeight",
        "padding",
        "gap",
      ].includes(key)
    ) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        (key === "opacity" && value > 100)
      ) {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (
      [
        "clipContent",
        "italic",
        "underline",
        "strikethrough",
        "header",
      ].includes(key)
    ) {
      if (typeof value !== "boolean") {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (["borderStyle", "gridStyle"].includes(key)) {
      if (!["solid", "dashed", "dotted"].includes(value as string)) {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (key === "align") {
      if (!["start", "center", "end"].includes(value as string)) {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (key === "horizontalAlign") {
      if (!["left", "center", "right"].includes(value as string)) {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (key === "verticalAlign") {
      if (!["top", "middle", "bottom"].includes(value as string)) {
        throw new Error(`Invalid ${label} ${key}`);
      }
    }
  }
};

/**
 * Relative tolerance for the float drift between an element's `width`/
 * `height` and its row/column sums. Only bounded drift within this tolerance
 * is normalized on restore; anything larger is rejected instead of being
 * silently stretched.
 */
export const TABLE_SIZE_NORMALIZATION_TOLERANCE = 1e-10;

export type CreateTableDataOptions = {
  rowCount?: number;
  columnCount?: number;
  rowHeight?: number;
  columnWidth?: number;
  /** ID source, injectable for deterministic tests; defaults to `randomId`. */
  randomizer?: () => string;
};

const assertPositiveCount = (value: number, label: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid table ${label} count: ${value}`);
  }
};

const assertPositiveSize = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid table ${label} size: ${value}`);
  }
};

/** Builds a fresh grid: every (row, column) intersection gets exactly one cell. */
export const createTableData = ({
  rowCount = DEFAULT_TABLE_ROW_COUNT,
  columnCount = DEFAULT_TABLE_COLUMN_COUNT,
  rowHeight = DEFAULT_TABLE_ROW_HEIGHT,
  columnWidth = DEFAULT_TABLE_COLUMN_WIDTH,
  randomizer = randomId,
}: CreateTableDataOptions = {}): TableDataV1 => {
  assertPositiveCount(rowCount, "row");
  assertPositiveCount(columnCount, "column");
  assertPositiveSize(rowHeight, "row height");
  assertPositiveSize(columnWidth, "column width");

  const rows = Array.from({ length: rowCount }, () => ({
    id: randomizer(),
    height: rowHeight,
  }));
  const columns = Array.from({ length: columnCount }, () => ({
    id: randomizer(),
    width: columnWidth,
  }));
  const cells = rows.flatMap((row) =>
    columns.map((column) => ({
      id: randomizer(),
      rowId: row.id,
      columnId: column.id,
      style: {},
    })),
  );

  return { schemaVersion: 1, rows, columns, cells };
};

/**
 * 表格预设：`plain` 是工具默认的均匀 3×3，两条泳道预设照搬平台表格模板
 * （水平/垂直泳道）的结构与配色。
 */
export type TablePresetId =
  | "plain"
  | "swimlane-horizontal"
  | "swimlane-vertical";

export const TABLE_PRESET_IDS: readonly TablePresetId[] = [
  "plain",
  "swimlane-horizontal",
  "swimlane-vertical",
];

export const isTablePresetId = (value: unknown): value is TablePresetId =>
  typeof value === "string" && TABLE_PRESET_IDS.some((id) => id === value);

/**
 * 泳道预设的几何，取自平台样本（水平 `q21:4` / 垂直 `q21:6`）：整表
 * 782 × 689.44，两条泳道各 344.72，标题带与泳道名带各 64，内容区 654。
 * 样本里的小数是铺满容器留下的零头，这里一律取整——预设是创建起点不是格式
 * 约束，整数让落点、网格吸附和尺寸断言都干净（总量差 0.2%，看不出来）。
 */
const SWIMLANE_TITLE_BAND = 64;
const SWIMLANE_LABEL_BAND = 64;
const SWIMLANE_CONTENT = 654;
const SWIMLANE_LANE = 344;
const SWIMLANE_LANE_COUNT = 2;

/**
 * 泳道预设标题带的底色。借表头带的主题色（浅色 `#F5F6F7` / 深色 `#2A2B30`）
 * 而不是样本里写死的 `#f5f5f5`：两者几乎同色，但主题切换时跟着走，不会在深色
 * 画布上留下一块固定的浅灰。工具弹层里的缩略图也解析同一个值。
 */
export const TABLE_PRESET_TITLE_FILL = "token:header";

/**
 * 泳道预设标签的字号（样本里单元格文字 18 / 表格默认 14）。元素层只声明这个
 * 数并交给 app 层的装配读，标签文字的居中与竖排换行都由单元格布局算。
 */
export const TABLE_SWIMLANE_LABEL_FONT_SIZE = 18;

type TableSwimlaneTitle = Readonly<{
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
}>;

type TableSwimlaneSpec = Readonly<{
  /** 行/列轴上的尺寸，顺序即索引 */
  rows: readonly number[];
  columns: readonly number[];
  /** 标题带：合并区的左上角锚点与跨度 */
  title: TableSwimlaneTitle;
  /**
   * 泳道名格：每条泳道一格，**刻意不合并**——单条泳道被删掉或挪走时名字跟着
   * 它走（样本的合并也只用在标题带上）。
   */
  laneLabels: readonly Readonly<{ row: number; column: number }>[];
}>;

/**
 * 水平泳道：每条泳道是一**行**，标题带与泳道名带因此各占一**列**。
 * 垂直泳道是它严格转置（样本数据也是转置的），所以只写这一份、另一份现推
 * ——两份永远对得上，改一处不会漏改另一处。
 */
const SWIMLANE_HORIZONTAL: TableSwimlaneSpec = {
  rows: [SWIMLANE_LANE, SWIMLANE_LANE],
  columns: [SWIMLANE_TITLE_BAND, SWIMLANE_LABEL_BAND, SWIMLANE_CONTENT],
  title: {
    row: 0,
    column: 0,
    rowSpan: SWIMLANE_LANE_COUNT,
    columnSpan: 1,
  },
  laneLabels: [
    { row: 0, column: 1 },
    { row: 1, column: 1 },
  ],
};

const transposeSwimlaneSpec = (spec: TableSwimlaneSpec): TableSwimlaneSpec => ({
  rows: spec.columns,
  columns: spec.rows,
  title: {
    row: spec.title.column,
    column: spec.title.row,
    rowSpan: spec.title.columnSpan,
    columnSpan: spec.title.rowSpan,
  },
  laneLabels: spec.laneLabels.map(({ row, column }) => ({
    row: column,
    column: row,
  })),
});

const SWIMLANE_SPECS: Readonly<
  Record<"swimlane-horizontal" | "swimlane-vertical", TableSwimlaneSpec>
> = {
  "swimlane-horizontal": SWIMLANE_HORIZONTAL,
  "swimlane-vertical": transposeSwimlaneSpec(SWIMLANE_HORIZONTAL),
};

const isSwimlanePresetId = (
  presetId: TablePresetId,
): presetId is "swimlane-horizontal" | "swimlane-vertical" =>
  presetId !== "plain";

const isInsideTitle = (
  rowIndex: number,
  columnIndex: number,
  title: TableSwimlaneTitle,
): boolean =>
  rowIndex >= title.row &&
  rowIndex < title.row + title.rowSpan &&
  columnIndex >= title.column &&
  columnIndex < title.column + title.columnSpan;

/**
 * 预设的持久化网格。泳道预设带一个竖/横合并的标题带（底色 + 合并都是数据，
 * 不是渲染期推导）与两条泳道；`plain` 就是既有的均匀 3×3。
 */
export const createTablePresetData = (
  presetId: TablePresetId,
  randomizer: () => string = randomId,
): TableDataV1 => {
  if (!isSwimlanePresetId(presetId)) {
    return createTableData({ randomizer });
  }

  const spec = SWIMLANE_SPECS[presetId];
  const rows: TableRowData[] = spec.rows.map((height) => ({
    id: randomizer(),
    height,
  }));
  const columns: TableColumnData[] = spec.columns.map((width) => ({
    id: randomizer(),
    width,
  }));
  // 单元格 id 先全部取好：被覆盖格要指回锚点，锚点得先有身份
  const cellIds = rows.map(() => columns.map(() => randomizer()));
  const anchorId = cellIds[spec.title.row][spec.title.column];

  const cells: TableCellData[] = rows.flatMap((row, rowIndex) =>
    columns.map((column, columnIndex) => {
      const base = {
        id: cellIds[rowIndex][columnIndex],
        rowId: row.id,
        columnId: column.id,
        style: {},
      };
      if (rowIndex === spec.title.row && columnIndex === spec.title.column) {
        return {
          ...base,
          style: { backgroundColor: TABLE_PRESET_TITLE_FILL },
          rowSpan: spec.title.rowSpan,
          columnSpan: spec.title.columnSpan,
        };
      }
      if (isInsideTitle(rowIndex, columnIndex, spec.title)) {
        // 被盖住的格保留自己的 id 并指向锚点（见 `assertValidTableData`）
        return { ...base, mergedInto: anchorId };
      }
      return base;
    }),
  );

  return {
    schemaVersion: 1,
    // 首行表头带关掉：水平泳道的首行是一条普通泳道，垂直泳道的首行是标题带
    // （自带底色），都不该再叠一层派生出来的表头
    style: { header: false },
    rows,
    columns,
    cells,
  };
};

export type TablePresetLabelCell = Readonly<{
  /** `title` 是标题带（合并区锚点），`lane` 是泳道名格 */
  kind: "title" | "lane";
  rowIndex: number;
  columnIndex: number;
}>;

/**
 * 预设自带标签的**格位**：标题带一个 + 每条泳道一个。文案不在元素层——
 * 它是 i18n 的（见 `getMindmapPresetTree` 的同一处理）。`plain` 没有标签。
 */
export const getTablePresetLabelCells = (
  presetId: TablePresetId,
): readonly TablePresetLabelCell[] => {
  if (!isSwimlanePresetId(presetId)) {
    return [];
  }
  const { title, laneLabels } = SWIMLANE_SPECS[presetId];
  return [
    { kind: "title", rowIndex: title.row, columnIndex: title.column },
    ...laneLabels.map(({ row, column }) => ({
      kind: "lane" as const,
      rowIndex: row,
      columnIndex: column,
    })),
  ];
};

/**
 * 交点上的**可见**单元格 id（0-based 索引）。合并区的被覆盖格返回锚点 id，
 * 标签因此挂在用户双击时编辑的那一格里（同 `getTableCellAtPoint`）。
 */
export const getTableCellIdAt = (
  table: Pick<TableDataV1, "rows" | "columns" | "cells">,
  rowIndex: number,
  columnIndex: number,
): string | null => {
  const row = table.rows[rowIndex];
  const column = table.columns[columnIndex];
  if (!row || !column) {
    return null;
  }
  const cell = table.cells.find(
    (candidate) =>
      candidate.rowId === row.id && candidate.columnId === column.id,
  );
  return cell ? cell.mergedInto ?? cell.id : null;
};

export const getTableWidth = (table: Pick<TableDataV1, "columns">): number =>
  table.columns.reduce((acc, column) => acc + column.width, 0);

export const getTableHeight = (table: Pick<TableDataV1, "rows">): number =>
  table.rows.reduce((acc, row) => acc + row.height, 0);

type TableLookup = {
  rows: ReadonlyMap<string, number>;
  columns: ReadonlyMap<string, number>;
  cells: ReadonlyMap<string, TableCellData>;
  intersections: ReadonlyMap<string, TableCellData>;
  rowEnds: readonly number[];
  columnEnds: readonly number[];
};

const tableLookups = new WeakMap<TableDataV1, TableLookup>();

const getTableLookup = (table: TableDataV1): TableLookup => {
  const cached = tableLookups.get(table);
  if (cached) {
    return cached;
  }
  let rowEnd = 0;
  let columnEnd = 0;
  const lookup: TableLookup = {
    rows: new Map(table.rows.map((row, index) => [row.id, index])),
    columns: new Map(table.columns.map((column, index) => [column.id, index])),
    cells: new Map(table.cells.map((cell) => [cell.id, cell])),
    intersections: new Map(
      table.cells.map((cell) => [`${cell.rowId}\u0000${cell.columnId}`, cell]),
    ),
    rowEnds: table.rows.map((row) => (rowEnd += row.height)),
    columnEnds: table.columns.map((column) => (columnEnd += column.width)),
  };
  tableLookups.set(table, lookup);
  return lookup;
};

const indexAtOffset = (ends: readonly number[], offset: number): number => {
  let low = 0;
  let high = ends.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offset < ends[middle]) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
};

/** Table-local offset (x grows rightwards) accumulated over preceding columns. */
export const getTableColumnOffset = (
  table: TableDataV1,
  columnId: string,
): number | null => {
  const lookup = getTableLookup(table);
  const index = lookup.columns.get(columnId);
  return index === undefined ? null : index ? lookup.columnEnds[index - 1] : 0;
};

/** Table-local offset (y grows downwards) accumulated over preceding rows. */
export const getTableRowOffset = (
  table: TableDataV1,
  rowId: string,
): number | null => {
  const lookup = getTableLookup(table);
  const index = lookup.rows.get(rowId);
  return index === undefined ? null : index ? lookup.rowEnds[index - 1] : 0;
};

/**
 * Cell rectangle in the table's unrotated local coordinates. Returns `null`
 * when the cell (or its row/column) does not exist in the table.
 */
export const getTableCellBounds = (
  table: TableDataV1,
  cellId: string,
): { x: number; y: number; width: number; height: number } | null => {
  const cell = getVisibleTableCell(table, cellId);
  if (!cell) {
    return null;
  }
  const x = getTableColumnOffset(table, cell.columnId);
  const y = getTableRowOffset(table, cell.rowId);
  if (x === null || y === null) {
    return null;
  }
  const lookup = getTableLookup(table);
  const rowIndex = lookup.rows.get(cell.rowId)!;
  const columnIndex = lookup.columns.get(cell.columnId)!;
  const rowEnd = rowIndex + (cell.rowSpan ?? 1) - 1;
  const columnEnd = columnIndex + (cell.columnSpan ?? 1) - 1;
  return {
    x,
    y,
    width: lookup.columnEnds[columnEnd] - x,
    height: lookup.rowEnds[rowEnd] - y,
  };
};

export const getVisibleTableCell = (
  table: TableDataV1,
  cellId: string,
): TableCellData | null => {
  const byId = getTableLookup(table).cells;
  const cell = byId.get(cellId);
  return cell ? byId.get(cell.mergedInto ?? cell.id) ?? null : null;
};

export type TableCellRange = Readonly<{
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}>;

export const getTableCellRange = (
  table: TableDataV1,
  firstId: string,
  lastId: string,
): TableCellRange => {
  const byId = new Map(table.cells.map((cell) => [cell.id, cell]));
  const visible = (id: string) => {
    const cell = byId.get(id);
    return cell ? byId.get(cell.mergedInto ?? cell.id) : undefined;
  };
  const first = visible(firstId);
  const last = visible(lastId);
  if (!first || !last) {
    throw new Error("Table selection references an unknown cell");
  }
  const rowIndex = new Map(table.rows.map((row, index) => [row.id, index]));
  const columnIndex = new Map(
    table.columns.map((column, index) => [column.id, index]),
  );
  let startRow = Math.min(
    rowIndex.get(first.rowId)!,
    rowIndex.get(last.rowId)!,
  );
  let endRow = Math.max(
    rowIndex.get(first.rowId)! + (first.rowSpan ?? 1) - 1,
    rowIndex.get(last.rowId)! + (last.rowSpan ?? 1) - 1,
  );
  let startColumn = Math.min(
    columnIndex.get(first.columnId)!,
    columnIndex.get(last.columnId)!,
  );
  let endColumn = Math.max(
    columnIndex.get(first.columnId)! + (first.columnSpan ?? 1) - 1,
    columnIndex.get(last.columnId)! + (last.columnSpan ?? 1) - 1,
  );
  let changed: boolean;
  do {
    changed = false;
    for (const cell of table.cells) {
      const row = rowIndex.get(cell.rowId)!;
      const column = columnIndex.get(cell.columnId)!;
      if (
        row < startRow ||
        row > endRow ||
        column < startColumn ||
        column > endColumn
      ) {
        continue;
      }
      const anchor = visible(cell.id)!;
      const anchorRow = rowIndex.get(anchor.rowId)!;
      const anchorColumn = columnIndex.get(anchor.columnId)!;
      const next = {
        startRow: Math.min(startRow, anchorRow),
        endRow: Math.max(endRow, anchorRow + (anchor.rowSpan ?? 1) - 1),
        startColumn: Math.min(startColumn, anchorColumn),
        endColumn: Math.max(
          endColumn,
          anchorColumn + (anchor.columnSpan ?? 1) - 1,
        ),
      };
      changed ||=
        next.startRow !== startRow ||
        next.endRow !== endRow ||
        next.startColumn !== startColumn ||
        next.endColumn !== endColumn;
      ({ startRow, endRow, startColumn, endColumn } = next);
    }
  } while (changed);
  return { startRow, endRow, startColumn, endColumn };
};

/**
 * 单元格范围选区在表格局部坐标系下的矩形（起止单元格包围盒的并集）。
 * 合并单元格会把范围撑大（见 `getTableCellRange`），故按范围两端取并集。
 * 选区引用了未知单元格（如已失效的瞬态选区）时返回 `null`。
 */
export const getTableCellRangeBounds = (
  table: TableDataV1,
  firstId: string,
  lastId: string,
): { x: number; y: number; width: number; height: number } | null => {
  let range: TableCellRange;
  try {
    range = getTableCellRange(table, firstId, lastId);
  } catch {
    return null;
  }
  // 范围两端的行列坐标 → 落在该位置的单元格（可能是合并单元格的成员，
  // getTableCellBounds 会解析回合并后的可见单元格）
  const cellAt = (rowIndex: number, columnIndex: number) =>
    table.cells.find(
      (cell) =>
        cell.rowId === table.rows[rowIndex].id &&
        cell.columnId === table.columns[columnIndex].id,
    );
  const firstCell = cellAt(range.startRow, range.startColumn);
  const lastCell = cellAt(range.endRow, range.endColumn);
  const start = firstCell && getTableCellBounds(table, firstCell.id);
  const end = lastCell && getTableCellBounds(table, lastCell.id);
  if (!start || !end) {
    return null;
  }
  return {
    x: start.x,
    y: start.y,
    width: end.x + end.width - start.x,
    height: end.y + end.height - start.y,
  };
};

const assertUniqueIds = (
  entries: readonly { id: string }[],
  label: string,
): void => {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || entry.id.length === 0) {
      throw new Error(
        `Invalid table ${label} id: ${JSON.stringify(entry?.id)}`,
      );
    }
    if (seen.has(entry.id)) {
      throw new Error(`Duplicate table ${label} id: ${entry.id}`);
    }
    seen.add(entry.id);
  }
};

const assertDimensions = (
  entries: readonly { height?: unknown; width?: unknown }[],
  key: "height" | "width",
  label: string,
): void => {
  for (const entry of entries) {
    const value = entry[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid table ${label} ${key}: ${value}`);
    }
  }
};

const assertValidCell = (
  cell: unknown,
  rowIds: ReadonlySet<string>,
  columnIds: ReadonlySet<string>,
): void => {
  if (!cell || typeof cell !== "object") {
    throw new Error(`Invalid table cell: ${JSON.stringify(cell)}`);
  }
  const value = cell as Record<string, unknown>;
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`Invalid table cell id: ${JSON.stringify(value.id)}`);
  }
  if (
    typeof value.rowId !== "string" ||
    !rowIds.has(value.rowId) ||
    typeof value.columnId !== "string" ||
    !columnIds.has(value.columnId)
  ) {
    throw new Error(
      `Table cell ${value.id} references an unknown row or column`,
    );
  }
  assertStyle(value.style, TABLE_CELL_STYLE_KEYS, `table cell ${value.id}`);
  for (const key of ["rowSpan", "columnSpan"] as const) {
    if (
      value[key] !== undefined &&
      (!Number.isInteger(value[key]) || (value[key] as number) < 1)
    ) {
      throw new Error(`Invalid table cell ${key} on ${value.id}`);
    }
  }
  if (
    value.mergedInto !== undefined &&
    (typeof value.mergedInto !== "string" || !value.mergedInto)
  ) {
    throw new Error(`Invalid table cell mergedInto on ${value.id}`);
  }
  if (
    value.mergedInto &&
    (value.rowSpan !== undefined || value.columnSpan !== undefined)
  ) {
    throw new Error(`Covered table cell ${value.id} cannot have a span`);
  }
};

/**
 * Validates persisted table structure at file, library and clipboard
 * boundaries. Throws on the first violation, mirroring `assertBaseShapeData`.
 */
export const assertValidTableData = (table: unknown): TableDataV1 => {
  if (!table || typeof table !== "object") {
    throw new Error(`Unsupported table data: ${JSON.stringify(table)}`);
  }
  const value = table as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    !Array.isArray(value.rows) ||
    !Array.isArray(value.columns) ||
    !Array.isArray(value.cells)
  ) {
    throw new Error(`Unsupported table data: ${JSON.stringify(table)}`);
  }

  const rows = value.rows as TableDataV1["rows"];
  const columns = value.columns as TableDataV1["columns"];
  const cells = value.cells as TableDataV1["cells"];

  // at least 1 row and 1 column
  if (rows.length < 1 || columns.length < 1) {
    throw new Error("Table must have at least one row and one column");
  }

  assertUniqueIds(rows, "row");
  assertUniqueIds(columns, "column");
  assertDimensions(rows, "height", "row");
  assertDimensions(columns, "width", "column");
  if (value.style !== undefined) {
    assertStyle(value.style, TABLE_STYLE_KEYS, "table");
  }
  const axisStyleKeys = new Set(["backgroundColor", "backgroundText"]);
  for (const row of rows) {
    if (row.style !== undefined) {
      assertStyle(row.style, axisStyleKeys, `table row ${row.id}`);
    }
  }
  for (const column of columns) {
    if (column.style !== undefined) {
      assertStyle(column.style, axisStyleKeys, `table column ${column.id}`);
    }
  }

  const rowIds = new Set(rows.map((row) => row.id));
  const columnIds = new Set(columns.map((column) => column.id));

  const cellIds = new Set<string>();
  const intersections = new Set<string>();
  for (const cell of cells) {
    assertValidCell(cell, rowIds, columnIds);
    if (cellIds.has(cell.id)) {
      throw new Error(`Duplicate table cell id: ${cell.id}`);
    }
    cellIds.add(cell.id);
    const intersection = `${cell.rowId}\u0000${cell.columnId}`;
    if (intersections.has(intersection)) {
      throw new Error(
        `Duplicate table cell for row ${cell.rowId} and column ${cell.columnId}`,
      );
    }
    intersections.add(intersection);
  }

  // exactly one cell per (row, column) intersection — injective pairs with
  // the full cardinality leave no missing and no extra cells
  if (cells.length !== rows.length * columns.length) {
    throw new Error(
      `Table must have exactly one cell per intersection: expected ${
        rows.length * columns.length
      }, got ${cells.length}`,
    );
  }

  const lookup = getTableLookup(table as TableDataV1);
  const byIntersection = lookup.intersections;
  const ownership = new Map<string, string>();
  for (const cell of cells) {
    if (cell.mergedInto) {
      continue;
    }
    const row = lookup.rows.get(cell.rowId)!;
    const column = lookup.columns.get(cell.columnId)!;
    const rowSpan = cell.rowSpan ?? 1;
    const columnSpan = cell.columnSpan ?? 1;
    if (row + rowSpan > rows.length || column + columnSpan > columns.length) {
      throw new Error(`Table cell ${cell.id} span exceeds table bounds`);
    }
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = column; c < column + columnSpan; c++) {
        const covered = byIntersection.get(
          `${rows[r].id}\u0000${columns[c].id}`,
        )!;
        if (
          ownership.has(covered.id) ||
          (covered.id !== cell.id && covered.mergedInto !== cell.id)
        ) {
          throw new Error(
            `Overlapping or incomplete table merge at ${covered.id}`,
          );
        }
        ownership.set(covered.id, cell.id);
      }
    }
  }
  if (ownership.size !== cells.length) {
    throw new Error("Table has a covered cell without a valid merge anchor");
  }

  return table as TableDataV1;
};

const isBoundedSizeDrift = (value: number, expected: number): boolean =>
  Number.isFinite(value) &&
  Math.abs(value - expected) <=
    TABLE_SIZE_NORMALIZATION_TOLERANCE * Math.max(1, Math.abs(expected));

/**
 * Resolves the scene-space `sceneX`/`sceneY` to the id of the table cell
 * containing it, or `null` when the point lies outside the table. Points
 * exactly on the right or bottom outer edge are outside, mirroring the
 * half-open grid geometry.
 */
export const getTableCellAtPoint = (
  element: ExcalidrawTableElement,
  sceneX: number,
  sceneY: number,
): string | null => {
  const x = sceneX - element.x;
  const y = sceneY - element.y;
  if (x < 0 || y < 0 || x > element.width || y > element.height) {
    return null;
  }

  const { table } = element;
  const lookup = getTableLookup(table);
  const column = table.columns[indexAtOffset(lookup.columnEnds, x)];
  const row = table.rows[indexAtOffset(lookup.rowEnds, y)];
  if (!column || !row) {
    return null;
  }
  const cell = lookup.intersections.get(`${row.id}\u0000${column.id}`);
  return cell ? lookup.cells.get(cell.mergedInto ?? cell.id)?.id ?? null : null;
};

/**
 * Evenly divides a dragged extent across the current rows/columns, keeping
 * every id. The element's `width`/`height` must be set to the new sums (see
 * `getTableWidth`/`getTableHeight`) in the same update.
 */
export const evenlySplitTableSize = (
  table: TableDataV1,
  width: number,
  height: number,
): { rows: TableDataV1["rows"]; columns: TableDataV1["columns"] } => ({
  columns: table.columns.map((column) => ({
    ...column,
    width: width / table.columns.length,
  })),
  rows: table.rows.map((row) => ({
    ...row,
    height: height / table.rows.length,
  })),
});

/** The default creation preset sizes, keeping the row/column ids. */
export const tableDefaultSizes = (
  table: TableDataV1,
): { rows: TableDataV1["rows"]; columns: TableDataV1["columns"] } => ({
  columns: table.columns.map((column) => ({
    ...column,
    width: DEFAULT_TABLE_COLUMN_WIDTH,
  })),
  rows: table.rows.map((row) => ({
    ...row,
    height: DEFAULT_TABLE_ROW_HEIGHT,
  })),
});

/**
 * Element size invariant: `width`/`height` equal the row/column sums. Snap
 * bounded float drift (relative tolerance) back to the exact sums; reject
 * grossly inconsistent sizes instead of silently stretching the content.
 */
export const normalizeTableDimensions = <
  T extends Pick<ExcalidrawTableElement, "id" | "width" | "height" | "table">,
>(
  element: T,
): T => {
  const width = getTableWidth(element.table);
  const height = getTableHeight(element.table);
  if (!isBoundedSizeDrift(element.width, width)) {
    throw new Error(
      `Table ${element.id} width ${element.width} does not match its column sum ${width}`,
    );
  }
  if (!isBoundedSizeDrift(element.height, height)) {
    throw new Error(
      `Table ${element.id} height ${element.height} does not match its row sum ${height}`,
    );
  }
  if (element.width === width && element.height === height) {
    return element;
  }
  return { ...element, width, height };
};
