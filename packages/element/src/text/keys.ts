import type { TextRegionKey } from "./types";

/** 文本区域 key 的工厂；同一个结构 id 始终映射到同一个 key。 */
export const textRegionKey = {
  body: "body",
  title: "title",
  label: "label",
  cell: (cellId: string): `cell:${string}` => `cell:${cellId}`,
  row: (rowId: string): `row:${string}` => `row:${rowId}`,
} as const;

/** `textRegionKey.cell` 的简写，供表格文本读写使用。 */
export const cellKey = textRegionKey.cell;

export type ParsedTextRegionKey =
  | Readonly<{ kind: "body" }>
  | Readonly<{ kind: "title" }>
  | Readonly<{ kind: "label" }>
  | Readonly<{ kind: "cell"; cellId: string }>
  | Readonly<{ kind: "row"; rowId: string }>;

const CELL_PREFIX = "cell:";
const ROW_PREFIX = "row:";

/** 解析区域 key；无法识别时返回 null。 */
export const parseTextRegionKey = (key: string): ParsedTextRegionKey | null => {
  if (key === "body") {
    return { kind: "body" };
  }
  if (key === "title") {
    return { kind: "title" };
  }
  if (key === "label") {
    return { kind: "label" };
  }
  // 结构 id 内部允许再出现冒号，因此取第一个冒号之后的全部内容。
  if (key.startsWith(CELL_PREFIX)) {
    const cellId = key.slice(CELL_PREFIX.length);
    return cellId === "" ? null : { kind: "cell", cellId };
  }
  if (key.startsWith(ROW_PREFIX)) {
    const rowId = key.slice(ROW_PREFIX.length);
    return rowId === "" ? null : { kind: "row", rowId };
  }
  return null;
};

export const isTextRegionKey = (key: string): key is TextRegionKey =>
  parseTextRegionKey(key) !== null;
