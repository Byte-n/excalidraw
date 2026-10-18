// 飞书画板导入的可注入端口与原始输入类型。
//
// 本文件只描述「飞书节点树」与「外部拉取能力」的契约形状，不做任何坐标
// 换算或元素映射。端口刻意与厂商 SDK 解耦：HTTP 拉取与凭证由 api 侧实现，
// 管线只消费这两个纯函数式端口。

// 节点 `type` 字段以字符串容纳：样例中已知的类型在 `LARK_KNOWN_NODE_TYPES`
// 列出，未知类型由转换层按 unknown 丢弃计数，不在此处收窄。
export type LarkBoardNodeType = string;

// 已知节点类型枚举，供转换层分派表参考。
export const LARK_KNOWN_NODE_TYPES = [
  "composite_shape",
  "text_shape",
  "connector",
  "section",
  "table",
  "table_uml",
  "table_er",
  "mind_map",
  "mind_map_node",
  "mind_map_root",
  "sticky_note",
  "paint",
  "image",
  "life_line",
  "activation",
  "combined_fragment",
  "svg",
  "group",
] as const;

// 二维点。
export interface LarkPoint {
  x: number;
  y: number;
}

// 节点级样式对象。各类型携带的键不完全一致（如 image 只带 border_style /
// h_flip / v_flip，sticky_note 只带 fill_*），故全部字段可选并保留索引签名
// 容纳未建模键。
export interface LarkNodeStyle {
  border_color?: string;
  border_color_type?: number;
  border_opacity?: number;
  border_style?: "solid" | "dash" | "none";
  border_width?: "narrow" | "extra_narrow";
  border_radius?: {
    top_left: number;
    top_right: number;
    bottom_left: number;
    bottom_right: number;
  };
  fill_color?: string;
  fill_color_type?: number;
  fill_opacity?: number;
  theme_border_color_code?: number;
  theme_fill_color_code?: number;
  theme_text_color_code?: number;
  theme_text_background_color_code?: number;
  h_flip?: boolean;
  v_flip?: boolean;
  [key: string]: unknown;
}

// 节点级文本对象：扁平字段（font_size / font_weight / *_align / italic /
// underline / line_through / text / text_color / text_background_color_type）。
// rich_text 是可选增强（样例中仅个别节点携带），run 级样式不在本层建模。
export interface LarkNodeRichTextStyle {
  font_size?: number;
  font_weight?: string;
  italic?: boolean;
  underline?: boolean;
  line_through?: boolean;
  text_background_color?: string;
  [key: string]: unknown;
}

export interface LarkNodeRichTextElement {
  element_type?: number;
  text_element?: {
    text?: string;
    text_style?: LarkNodeRichTextStyle;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface LarkNodeRichTextParagraph {
  elements?: LarkNodeRichTextElement[];
  indent?: number;
  paragraph_type?: number;
  quote?: boolean;
  list_begin_index?: number;
  [key: string]: unknown;
}

export interface LarkNodeText {
  angle?: number;
  font_size?: number;
  font_weight?: string;
  horizontal_align?: "left" | "center" | "right";
  vertical_align?: "top" | "mid" | "bottom";
  italic?: boolean;
  underline?: boolean;
  line_through?: boolean;
  text?: string;
  text_color?: string;
  text_color_type?: number;
  text_background_color_type?: number;
  theme_text_color_code?: number;
  theme_text_background_color_code?: number;
  rich_text?: {
    paragraphs?: LarkNodeRichTextParagraph[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// 类型专属 payload。每个 payload 只建模样例中确定出现的键，其余键经索引签名
// 容纳，不做擦除。
export interface LarkCompositeShapePayload {
  type?: string;
  [key: string]: unknown;
}

export interface LarkConnectorEndpoint {
  arrow_style?: string;
  position?: LarkPoint;
  attached_object?: {
    id?: string;
    position?: LarkPoint;
    snap_to?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface LarkConnectorCaption extends LarkNodeText {}

export interface LarkConnectorPayload {
  // 走向以字符串容纳：已知 straight / polyline / curve / right_angled_polyline，
  // 未来新增取值由解析原样保留、转换层统一降级。
  shape?: string;
  specified_coordinate?: boolean;
  caption_position?: number;
  caption_position_type?: number;
  caption_auto_direction?: boolean;
  start?: LarkConnectorEndpoint;
  end?: LarkConnectorEndpoint;
  start_object?: {
    id?: string;
    position?: LarkPoint;
    snap_to?: string;
    [key: string]: unknown;
  };
  end_object?: {
    id?: string;
    position?: LarkPoint;
    snap_to?: string;
    [key: string]: unknown;
  };
  turning_points?: LarkPoint[];
  captions?: {
    data?: LarkConnectorCaption[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface LarkSectionPayload {
  title?: string;
  [key: string]: unknown;
}

export interface LarkTableCellStyle {
  fill_color?: string;
  fill_color_type?: number;
  fill_opacity?: number;
  theme_fill_color_code?: number;
  [key: string]: unknown;
}

export interface LarkTableCell {
  col_index?: number;
  row_index?: number;
  merge_info?: {
    col_span?: number;
    row_span?: number;
    [key: string]: unknown;
  };
  style?: LarkTableCellStyle;
  text?: LarkNodeText;
  [key: string]: unknown;
}

export interface LarkTableMeta {
  col_num?: number;
  col_sizes?: number[];
  row_num?: number;
  row_sizes?: number[];
  style?: LarkNodeStyle;
  text?: LarkNodeText;
  [key: string]: unknown;
}

export interface LarkTablePayload {
  meta?: LarkTableMeta;
  cells?: LarkTableCell[];
  title?: string;
  [key: string]: unknown;
}

export interface LarkMindMapPayload {
  parent_id?: string;
  [key: string]: unknown;
}

export interface LarkMindMapNodePayload {
  type?: string;
  collapsed?: boolean;
  layout_position?: "left" | "right";
  parent_id?: string;
  z_index?: number;
  [key: string]: unknown;
}

export interface LarkMindMapRootPayload {
  layout?: string;
  line_style?: string;
  type?: string;
  left_children?: string[];
  right_children?: string[];
  [key: string]: unknown;
}

export interface LarkStickyNotePayload {
  show_author_info?: boolean;
  // 发起者 open_id，属协作身份信息，不写入场景。
  user_id?: string;
  [key: string]: unknown;
}

export interface LarkPaintLine {
  x: number;
  y: number;
  [key: string]: unknown;
}

export interface LarkPaintPayload {
  color?: string;
  type?: string;
  width?: number;
  lines?: LarkPaintLine[];
  [key: string]: unknown;
}

export interface LarkImagePayload {
  // 资产拉取凭证，字节由服务端按 token 下载。
  token?: string;
  [key: string]: unknown;
}

export interface LarkLifelinePayload {
  type?: string;
  size?: number;
  [key: string]: unknown;
}

// 节点公共字段。parent_id / locked 等字段在顶层画框样例中可能缺失。
export interface LarkBoardNode {
  id: string;
  type: LarkBoardNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  z_index?: number;
  style?: LarkNodeStyle;
  text?: LarkNodeText;
  locked?: boolean;
  parent_id?: string;
  // 容器子节点 id 列表。表格等容器样例中可能显式为 null（内容落在
  // table.cells），故允许 null；闸门据此校验 childIds 不含自身。
  children?: string[] | null;
  composite_shape?: LarkCompositeShapePayload;
  connector?: LarkConnectorPayload;
  section?: LarkSectionPayload;
  table?: LarkTablePayload;
  mind_map?: LarkMindMapPayload;
  mind_map_node?: LarkMindMapNodePayload;
  mind_map_root?: LarkMindMapRootPayload;
  sticky_note?: LarkStickyNotePayload;
  paint?: LarkPaintPayload;
  image?: LarkImagePayload;
  lifeline?: LarkLifelinePayload;
  // 未建模类型 / 字段的统一容纳口，不擦除类型。
  [key: string]: unknown;
}

// 飞书节点列表接口的完整信封：{ code, data: { nodes }, msg }。
export interface LarkBoardEnvelope {
  code: number;
  data: {
    nodes: LarkBoardNode[];
    [key: string]: unknown;
  };
  msg?: string;
  [key: string]: unknown;
}

// 翻页结果：节点 + 下一页游标（缺失表示无更多页）。
export interface LarkBoardPage {
  nodes: LarkBoardNode[];
  nextPageToken?: string;
}

// 按画板 id 拉取原始节点树的可注入端口，支持翻页。
// 实现方负责限流退避与凭证；管线侧只做纯转换。
export interface BoardSource {
  fetch(whiteboardId: string, pageToken?: string): Promise<LarkBoardPage>;
}

// 图片字节拉取结果：成功给字节，放弃带原因（计入 dropped）。
export type BoardImageResolveResult =
  | { status: "ok"; bytes: Uint8Array; mimeType: string }
  | { status: "dropped"; reason: string };

// 按资产 token 取字节的端口；api 侧用既有凭证下载实现。
export interface BoardImageResolver {
  resolve(token: string): Promise<BoardImageResolveResult>;
}
