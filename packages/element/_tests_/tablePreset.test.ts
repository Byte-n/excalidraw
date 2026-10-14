import { newTableElement } from "../src/newElement";
import {
  TABLE_PRESET_IDS,
  TABLE_PRESET_TITLE_FILL,
  assertValidTableData,
  createTablePresetData,
  createTableData,
  getTableCellIdAt,
  getTableHeight,
  getTablePresetLabelCells,
  getTableWidth,
  isTablePresetId,
} from "../src/tableStruct";

import type { TableDataV1 } from "../src/types";

/** 确定性 id：断言合并区的指向时不必先解出随机 id */
const ids = () => {
  let count = 0;
  return () => `id${count++}`;
};

const data = (presetId: Parameters<typeof createTablePresetData>[0]) =>
  createTablePresetData(presetId, ids());

/** (row, column) 交点上的格（0-based），且断言它确实存在 */
const cellAt = (table: TableDataV1, rowIndex: number, columnIndex: number) => {
  const id = getTableCellIdAt(table, rowIndex, columnIndex);
  expect(id).not.toBeNull();
  return table.cells.find((cell) => cell.id === id)!;
};

/** 交点上的格**本身**（不解析合并）——被覆盖格只能这样拿到 */
const rawCellAt = (
  table: TableDataV1,
  rowIndex: number,
  columnIndex: number,
) => {
  const row = table.rows[rowIndex];
  const column = table.columns[columnIndex];
  return table.cells.find(
    (cell) => cell.rowId === row.id && cell.columnId === column.id,
  )!;
};

describe("表格预设", () => {
  it("plain 就是既有的均匀 3×3", () => {
    const preset = createTablePresetData("plain", ids());
    const plain = createTableData({ randomizer: ids() });

    expect(preset.rows.map((row) => row.height)).toEqual(
      plain.rows.map((row) => row.height),
    );
    expect(preset.columns.map((column) => column.width)).toEqual(
      plain.columns.map((column) => column.width),
    );
    expect(preset.style).toBeUndefined();
  });

  it("水平泳道：标题带竖合并、两条泳道各一行，尺寸与样本一致", () => {
    const table = data("swimlane-horizontal");

    expect(table.rows.map((row) => row.height)).toEqual([344, 344]);
    expect(table.columns.map((column) => column.width)).toEqual([64, 64, 654]);
    expect(getTableWidth(table)).toBe(782);
    expect(getTableHeight(table)).toBe(688);

    // 标题带：左上角锚点 + 竖向跨度 + 主题色底纹。跨度两个都写（同
    // `mergeTableCells` 出来的人工合并，缺省值也显式落盘）
    const title = cellAt(table, 0, 0);
    expect(title).toMatchObject({
      rowSpan: 2,
      columnSpan: 1,
      style: { backgroundColor: TABLE_PRESET_TITLE_FILL },
    });
    // 被盖住的格保留自己的 id 并指回锚点（格式约束）
    const covered = rawCellAt(table, 1, 0);
    expect(covered.id).not.toBe(title.id);
    expect(covered).toMatchObject({ mergedInto: title.id });
    expect(covered.rowSpan).toBeUndefined();

    // 首行表头带关掉：水平泳道的首行是一条普通泳道
    expect(table.style).toEqual({ header: false });

    expect(() => assertValidTableData(table)).not.toThrow();
    // 每个交点恰好一格：3 列 × 2 行
    expect(table.cells).toHaveLength(6);
  });

  it("垂直泳道是水平泳道的转置", () => {
    const vertical = data("swimlane-vertical");

    expect(vertical.rows.map((row) => row.height)).toEqual([64, 64, 654]);
    expect(vertical.columns.map((column) => column.width)).toEqual([344, 344]);
    expect(getTableWidth(vertical)).toBe(688);
    expect(getTableHeight(vertical)).toBe(782);

    const title = cellAt(vertical, 0, 0);
    expect(title).toMatchObject({
      rowSpan: 1,
      columnSpan: 2,
      style: { backgroundColor: TABLE_PRESET_TITLE_FILL },
    });
    expect(rawCellAt(vertical, 0, 1)).toMatchObject({ mergedInto: title.id });

    expect(() => assertValidTableData(vertical)).not.toThrow();
  });

  it("标签格位：标题带一个 + 每条泳道一个，plain 没有", () => {
    expect(getTablePresetLabelCells("plain")).toEqual([]);

    expect(getTablePresetLabelCells("swimlane-horizontal")).toEqual([
      { kind: "title", rowIndex: 0, columnIndex: 0 },
      { kind: "lane", rowIndex: 0, columnIndex: 1 },
      { kind: "lane", rowIndex: 1, columnIndex: 1 },
    ]);

    expect(getTablePresetLabelCells("swimlane-vertical")).toEqual([
      { kind: "title", rowIndex: 0, columnIndex: 0 },
      { kind: "lane", rowIndex: 1, columnIndex: 0 },
      { kind: "lane", rowIndex: 1, columnIndex: 1 },
    ]);
  });

  it("标签指向**可见**的格：合并区的被覆盖格回锚点", () => {
    const table = data("swimlane-horizontal");

    expect(getTableCellIdAt(table, 0, 0)).toBe(cellAt(table, 0, 0).id);
    // (1, 0) 被标题带盖住，标签要挂在锚点上（用户双击编辑的也是那一格）
    expect(getTableCellIdAt(table, 1, 0)).toBe(cellAt(table, 0, 0).id);
    // 越界回 null，不抛
    expect(getTableCellIdAt(table, 9, 9)).toBeNull();
  });

  it("预设 id 收窄：只有这三个值", () => {
    expect(TABLE_PRESET_IDS).toEqual([
      "plain",
      "swimlane-horizontal",
      "swimlane-vertical",
    ]);
    expect(TABLE_PRESET_IDS.every(isTablePresetId)).toBe(true);
    expect(isTablePresetId("swimlane")).toBe(false);
    expect(isTablePresetId(undefined)).toBe(false);
  });

  it("newTableElement 按预设出表：尺寸取行列之和，预设数据原样保留", () => {
    const horizontal = newTableElement({
      type: "table",
      preset: "swimlane-horizontal",
      x: -43.59,
      y: -1507.72,
    });

    expect(horizontal).toMatchObject({ width: 782, height: 688 });
    expect(horizontal.table.style).toEqual({ header: false });
    expect(
      horizontal.table.cells.filter((cell) => cell.mergedInto),
    ).toHaveLength(1);
    // 数据随元素持久化，不是渲染期推导
    expect(() => assertValidTableData(horizontal.table)).not.toThrow();

    // 缺省（plain）仍是均匀 3×3 的默认尺寸
    const plain = newTableElement({ type: "table", x: 0, y: 0 });
    expect(plain).toMatchObject({ width: 480, height: 168 });
  });
});
