// 手写精简飞书节点子集，每类型 1~2 个节点，依据样例整理字段形状。
// 仅用于 parse 阶段单测，不复制大样例文件。

import type { LarkBoardNode } from "../../src/source.js";

// 基础图形：内嵌文本「开始」，z_index=1。
export function shapeNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "shape1",
    type: "composite_shape",
    x: 100,
    y: 50,
    width: 120,
    height: 80,
    angle: 0,
    z_index: 1,
    composite_shape: { type: "round_rect" },
    style: {
      border_color: "#000000",
      border_style: "solid",
      border_width: "narrow",
      fill_color: "#f0f4fc",
      h_flip: false,
      v_flip: false,
    },
    text: {
      font_size: 14,
      font_weight: "regular",
      horizontal_align: "center",
      vertical_align: "mid",
      text: "开始",
      text_color: "#1f2329",
    },
    ...overrides,
  };
}

// 顶层父画框（无 parent_id / locked）。
export function sectionNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "section1",
    type: "section",
    x: 93,
    y: -4382,
    width: 3432,
    height: 1931,
    angle: 0,
    z_index: 0,
    section: { title: "父画框" },
    children: ["child1"],
    style: {
      border_style: "solid",
      border_width: "extra_narrow",
      fill_color: "#f5f6f7",
      border_radius: {
        top_left: 4,
        top_right: 4,
        bottom_left: 4,
        bottom_right: 4,
      },
    },
    ...overrides,
  };
}

// 子画框：带 parent_id 与 locked，相对父坐标。
export function nestedSectionNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "section2",
    type: "section",
    parent_id: "section1",
    locked: false,
    x: 841,
    y: 360,
    width: 1218,
    height: 954,
    angle: 0,
    z_index: 0,
    section: { title: "子画框" },
    children: ["shapeA", "shapeB"],
    style: {
      border_style: "solid",
      border_width: "extra_narrow",
      fill_color: "#f5f6f7",
    },
    ...overrides,
  };
}

// 独立文本元素。
export function textShapeNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "text1",
    type: "text_shape",
    x: 514,
    y: 2582,
    width: 219,
    height: 258,
    angle: 0,
    z_index: 5,
    text: {
      font_size: 89,
      font_weight: "regular",
      horizontal_align: "left",
      text: "文本元素",
      text_color: "#1f2329",
    },
    ...overrides,
  };
}

// 带绑定 + 标签的曲线连线，退化高度。
export function connectorNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "conn1",
    type: "connector",
    parent_id: "section2",
    x: 135.9,
    y: 163.4,
    width: 189.86,
    height: 9.3e-15,
    angle: 0,
    z_index: 2,
    connector: {
      shape: "curve",
      specified_coordinate: true,
      caption_position: 0.447,
      caption_position_type: 1,
      caption_auto_direction: false,
      start: {
        arrow_style: "none",
        attached_object: {
          id: "shapeA",
          position: { x: 1, y: 0.5 },
          snap_to: "right",
        },
      },
      end: {
        arrow_style: "single_or_multi_arrow",
        attached_object: {
          id: "shapeB",
          position: { x: 0, y: 0.5 },
          snap_to: "left",
        },
      },
      turning_points: [],
      captions: {
        data: [
          {
            font_size: 14,
            font_weight: "regular",
            horizontal_align: "center",
            vertical_align: "mid",
            text: "连接线标签文本",
            text_color: "#1f2329",
          },
        ],
      },
    },
    ...overrides,
  };
}

// 纯坐标直线连线（无绑定）。
export function straightConnectorNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "conn2",
    type: "connector",
    x: 100,
    y: 200,
    width: 200,
    height: 0,
    angle: 0,
    z_index: 3,
    connector: {
      shape: "straight",
      specified_coordinate: true,
      start: {
        arrow_style: "none",
        position: { x: 733, y: 2063 },
      },
      end: {
        arrow_style: "line_arrow",
        position: { x: 934, y: 2063 },
      },
      turning_points: [
        { x: 800, y: 0 },
        { x: 850, y: 10 },
      ],
      captions: { data: [] },
    },
    ...overrides,
  };
}

// 折线连线（polyline + 折点）。
export function polylineConnectorNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "conn3",
    type: "connector",
    x: 10,
    y: 10,
    width: 100,
    height: 0,
    angle: 0,
    z_index: 4,
    connector: {
      shape: "polyline",
      start: { arrow_style: "none", position: { x: 0, y: 0 } },
      end: { arrow_style: "line_arrow", position: { x: 100, y: 0 } },
      turning_points: [
        { x: 30, y: 40 },
        { x: 70, y: 40 },
      ],
    },
    ...overrides,
  };
}

// 表格：2 列 3 行，含合并单元格。
export function tableNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "table1",
    type: "table",
    x: 200,
    y: 300,
    width: 689,
    height: 782,
    angle: 0,
    z_index: 6,
    table: {
      title: "表格标题",
      meta: {
        col_num: 2,
        col_sizes: [344.7, 344.7],
        row_num: 3,
        row_sizes: [64, 64, 654],
        style: {
          border_color: "#000000",
          border_style: "solid",
          border_width: "extra_narrow",
        },
        text: {
          font_size: 14,
          text: "表头",
        },
      },
      cells: [
        {
          col_index: 1,
          row_index: 1,
          merge_info: { col_span: 1, row_span: 1 },
          style: { fill_color: "#f5f5f5", theme_fill_color_code: 8 },
          text: {
            text: "A1",
            horizontal_align: "center",
            vertical_align: "top",
          },
        },
        {
          col_index: 2,
          row_index: 2,
          merge_info: { col_span: 2, row_span: 1 },
          style: { fill_color: "#f5f5f5" },
          text: {
            text: "合并",
            horizontal_align: "center",
            vertical_align: "top",
          },
        },
      ],
    },
    ...overrides,
  };
}

// 思维导图根节点：mind_map_root + 子树。
export function mindMapRootNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "mmRoot",
    type: "mind_map",
    parent_id: "section1",
    x: 400,
    y: 400,
    width: 160,
    height: 60,
    angle: 0,
    z_index: 0,
    mind_map: { parent_id: undefined },
    mind_map_root: {
      layout: "left_right",
      line_style: "round_angle",
      type: "mind_map_round_rect",
      left_children: ["mmL1"],
      right_children: ["mmR1"],
    },
    text: {
      font_size: 24,
      text: "中心主题",
      horizontal_align: "center",
      vertical_align: "mid",
    },
    ...overrides,
  };
}

// 思维导图子节点：mind_map_node + mind_map.parent_id 树关系。
export function mindMapChildNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "mmL1",
    type: "mind_map",
    parent_id: "section1",
    x: 200,
    y: 400,
    width: 120,
    height: 40,
    angle: 0,
    z_index: 2,
    mind_map: { parent_id: "mmRoot" },
    mind_map_node: {
      type: "mind_map_text",
      collapsed: false,
      layout_position: "left",
      parent_id: "mmRoot",
      z_index: 2,
    },
    text: {
      font_size: 18,
      text: "分支",
      horizontal_align: "center",
      vertical_align: "mid",
    },
    ...overrides,
  };
}

// 便签：填充色 + 非空文本。
export function stickyNoteNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "sticky1",
    type: "sticky_note",
    parent_id: "section2",
    x: 83,
    y: 382,
    width: 160,
    height: 160,
    angle: 0,
    z_index: 3,
    sticky_note: { show_author_info: true, user_id: "ou_x" },
    style: {
      fill_color: "#f6c8c8",
      fill_opacity: 100,
      theme_fill_color_code: 8,
    },
    text: {
      font_size: 14,
      text: "便签文本",
      horizontal_align: "center",
      vertical_align: "mid",
      text_color: "#1f2329",
    },
    ...overrides,
  };
}

// 自由书写：点序列。
export function paintNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "paint1",
    type: "paint",
    parent_id: "section2",
    x: 0,
    y: 0,
    width: 200,
    height: 220,
    angle: 0,
    z_index: 7,
    paint: {
      color: "#32a645",
      type: "highlight",
      width: 24,
      lines: [
        { x: 0, y: 88 },
        { x: 0, y: 153 },
        { x: 7, y: 154 },
        { x: 17, y: 146 },
      ],
    },
    ...overrides,
  };
}

// 图片：仅 token + 翻转标记。
export function imageNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "img1",
    type: "image",
    parent_id: "section2",
    x: 300,
    y: 100,
    width: 400,
    height: 300,
    angle: 0,
    z_index: 8,
    image: { token: "LRCNbkQxzo0c0zxz3zRcL93pnGe" },
    style: { border_style: "none", h_flip: true, v_flip: false },
    ...overrides,
  };
}

// 范围外类型：时序图 lifeline。
export function lifelineNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "ll1",
    type: "life_line",
    x: 0,
    y: 0,
    width: 40,
    height: 360,
    angle: 0,
    z_index: 0,
    lifeline: { type: "boundary", size: 360 },
    ...overrides,
  };
}

// 富文本节点：rich_text 两段落。
export function richTextNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "rich1",
    type: "composite_shape",
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    angle: 0,
    z_index: 0,
    composite_shape: { type: "round_rect" },
    text: {
      font_size: 14,
      horizontal_align: "center",
      vertical_align: "mid",
      text: "占位",
      rich_text: {
        paragraphs: [
          {
            elements: [
              {
                element_type: 0,
                text_element: {
                  text: "第一行",
                  text_style: { font_size: 7, font_weight: "regular" },
                },
              },
            ],
            indent: 0,
            paragraph_type: 0,
            quote: false,
            list_begin_index: 0,
          },
          {
            elements: [
              {
                element_type: 0,
                text_element: { text: "第二行" },
              },
            ],
            indent: 0,
            paragraph_type: 0,
          },
        ],
      },
    },
    ...overrides,
  };
}

// 未知类型节点。
export function unknownNode(
  overrides: Partial<LarkBoardNode> = {},
): LarkBoardNode {
  return {
    id: "unk1",
    type: "alien_shape",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    angle: 0,
    z_index: 0,
    ...overrides,
  };
}
