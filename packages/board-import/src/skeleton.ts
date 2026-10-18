// 与飞书解耦的中间表示（IR）：parse 阶段产出，render 阶段消费。
//
// skeleton 已完成「沿祖先链累加为场景绝对坐标」与「退化尺寸规整」，
// 但不携带 Excalidraw 元素语义；元素构造留给 T2 的 render 阶段。

import type {
  LarkNodeStyle,
  LarkPoint,
  LarkTableCell,
  LarkTableMeta,
} from "./source.js";

// 已建模的骨架节点种类。范围外或未知类型不产出 skeleton 节点，由 parse
// 阶段计入 droppedNodes，故此处不设 unknown 占位。
export type BoardSkeletonKind =
  | "shape"
  | "text"
  | "connector"
  | "section"
  | "table"
  | "mindMap"
  | "stickyNote"
  | "paint"
  | "image";

// 退化尺寸规整后保证非负的最小值。连线等无面积节点允许为 0，故取 0；
// parse 阶段会把 NaN / 负值 / 浮点噪声（如 9.3e-15）规整到该值。
export const MIN_DIMENSION = 0;

// 浮点噪声阈值：小于该值的正数视为退化，规整到 MIN_DIMENSION。
const DIMENSION_EPSILON = 1e-9;

// 节点内嵌 / 附属文本的归一化投影。扁平 text 对象字段直接进入；rich_text
// 按段落拼合为多行纯文本后填入 text，样式字段回落到节点级 text。
export interface BoardSkeletonText {
  text: string;
  fontSize?: number;
  fontWeight?: string;
  horizontalAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "mid" | "bottom";
  italic?: boolean;
  underline?: boolean;
  lineThrough?: boolean;
  textColor?: string;
  textBackgroundColorType?: number;
  richTextFlattened?: boolean;
}

// 基础图形（composite_shape）payload：飞书图形类型串 + 样式 + 内嵌文本。
export interface BoardSkeletonShapePayload {
  shapeType?: string;
  style?: LarkNodeStyle;
  text?: BoardSkeletonText;
}

// 连线端点：纯坐标端点（position）与绑定元素端点（attachedObjectId 等）
// 两态并存，render 阶段据此决定是否建 binding。
export interface BoardSkeletonConnectorEndpoint {
  arrowStyle?: string;
  position?: LarkPoint;
  attachedObjectId?: string;
  attachedPosition?: LarkPoint;
  attachedSnapTo?: string;
}

// 连线标签：文本 + 沿线比例位置；其余扁平文本字段在 textProps 内。
export interface BoardSkeletonConnectorCaption {
  textProps: BoardSkeletonText;
  position?: number;
  positionType?: number;
  autoDirection?: boolean;
}

// 连线 payload：走向 + 端点 + 折点 + 标签。`shape` 以字符串容纳飞书取值
// （已知的有 straight / polyline / curve / right_angled_polyline），未知走向
// 由 render 阶段按折线降级处理。
export interface BoardSkeletonConnectorPayload {
  shape: string;
  start: BoardSkeletonConnectorEndpoint;
  end: BoardSkeletonConnectorEndpoint;
  turningPoints: LarkPoint[];
  captions: BoardSkeletonConnectorCaption[];
  specifiedCoordinate?: boolean;
}

// 画框 payload：标题进 frame 名称；样式携带圆角与边框。
export interface BoardSkeletonSectionPayload {
  title?: string;
  style?: LarkNodeStyle;
}

// 表格 payload：meta（行列尺寸 + 表头文本）+ cells（含 merge_info）。
// cells 的 row_index / col_index 已在 parse 阶段归一为 0 基。顶层 children
// 字段在样例中可能为 null（内容落在 cells），parse 阶段不强制收编到 childIds。
export interface BoardSkeletonTablePayload {
  title?: string;
  meta?: LarkTableMeta;
  cells: LarkTableCell[];
}

// 思维导图 payload。画布归属走顶层 parentId，思维导图树关系走 treeParentId
// / root.leftChildren / root.rightChildren，两套层级互不混淆。
export interface BoardSkeletonMindMapPayload {
  // 思维导图树父节点（mind_map.parent_id），区别于画布 parent_id。
  treeParentId?: string;
  root?: {
    layout?: string;
    lineStyle?: string;
    type?: string;
    leftChildren?: string[];
    rightChildren?: string[];
  };
  node?: {
    type?: string;
    collapsed?: boolean;
    layoutPosition?: "left" | "right";
    zIndex?: number;
  };
  text?: BoardSkeletonText;
}

// 便签 payload：填充色等在 style；发起者身份信息不写入。
export interface BoardSkeletonStickyNotePayload {
  style?: LarkNodeStyle;
  text?: BoardSkeletonText;
}

// 自由书写 payload：点序列相对节点原点，render 阶段再做平移。
export interface BoardSkeletonPaintPayload {
  color?: string;
  type?: string;
  width?: number;
  points: LarkPoint[];
}

// 图片 payload：只有资产 token，字节由服务端按 token 拉取；翻转标记来自 style。
export interface BoardSkeletonImagePayload {
  token?: string;
  hFlip?: boolean;
  vFlip?: boolean;
}

export interface BoardSkeletonNode {
  // 原始飞书节点 id（保持引用自洽：parent / 绑定 / mind_map 树）。
  id: string;
  kind: BoardSkeletonKind;
  // 场景绝对坐标，已沿 parent_id 链累加。
  x: number;
  y: number;
  width: number;
  height: number;
  // 弧度，已由度数换算。
  angle: number;
  zIndex: number;
  parentId?: string;
  childIds?: string[];
  // 节点内嵌 / 附属文本（扁平字符串 + 样式）。多段落富文本由 parse 拼合。
  text?: BoardSkeletonText;
  // 各 kind 专属 payload；render 阶段按 kind 分派消费。
  shape?: BoardSkeletonShapePayload;
  connector?: BoardSkeletonConnectorPayload;
  section?: BoardSkeletonSectionPayload;
  table?: BoardSkeletonTablePayload;
  mindMap?: BoardSkeletonMindMapPayload;
  stickyNote?: BoardSkeletonStickyNotePayload;
  paint?: BoardSkeletonPaintPayload;
  image?: BoardSkeletonImagePayload;
  // 未建模键的统一容纳口，不擦除类型。
  [key: string]: unknown;
}

export interface BoardSkeleton {
  nodes: BoardSkeletonNode[];
}

// skeleton 不变量校验失败统一错误。
export class BoardSkeletonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardSkeletonError";
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// 规整退化尺寸：NaN / Infinity / 负值 / 浮点噪声 → MIN_DIMENSION。
export function normalizeDimension(value: unknown): number {
  if (!isFiniteNumber(value) || value < MIN_DIMENSION) {
    return MIN_DIMENSION;
  }
  if (value < DIMENSION_EPSILON) {
    return MIN_DIMENSION;
  }
  return value;
}

// 校验 skeleton 自洽：几何有限、尺寸非负、id 不重复、parent_id 指向存在
// 的节点。render / project 阶段据此假设输入已规范。
export function assertBoardSkeleton(skeleton: BoardSkeleton): void {
  const { nodes } = skeleton;
  const seen = new Set<string>();

  for (const node of nodes) {
    if (typeof node.id !== "string" || node.id.length === 0) {
      throw new BoardSkeletonError("skeleton 节点缺少合法 id");
    }
    if (seen.has(node.id)) {
      throw new BoardSkeletonError(`skeleton 节点 id 重复: ${node.id}`);
    }
    seen.add(node.id);

    for (const key of ["x", "y", "width", "height", "angle"] as const) {
      if (!isFiniteNumber(node[key])) {
        throw new BoardSkeletonError(
          `skeleton 节点 ${node.id} 的 ${key} 非有限数值`,
        );
      }
    }
    if (node.width < MIN_DIMENSION || node.height < MIN_DIMENSION) {
      throw new BoardSkeletonError(`skeleton 节点 ${node.id} 的尺寸为负`);
    }
    if (!Number.isInteger(node.zIndex)) {
      throw new BoardSkeletonError(`skeleton 节点 ${node.id} 的 zIndex 非整数`);
    }
    if (node.parentId !== undefined) {
      if (node.parentId === node.id) {
        throw new BoardSkeletonError(
          `skeleton 节点 ${node.id} 的 parentId 指向自身`,
        );
      }
      if (!nodes.some((other) => other.id === node.parentId)) {
        throw new BoardSkeletonError(
          `skeleton 节点 ${node.id} 的 parentId=${node.parentId} 不存在`,
        );
      }
    }
    if (node.childIds !== undefined) {
      for (const childId of node.childIds) {
        if (childId === node.id) {
          throw new BoardSkeletonError(
            `skeleton 节点 ${node.id} 的 childIds 含自身`,
          );
        }
      }
    }
  }
}
