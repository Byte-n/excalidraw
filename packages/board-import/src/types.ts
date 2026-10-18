// 管线共享类型：阶段间传递的元素、资产、统计与策略。
//
// 元素形状取 vendor 场景契约 `ExcalidrawSceneElement`；统计字段供 api 侧汇总。

import type { ScenePolicy } from "@excalidraw/yjs";

import type { ExcalidrawSceneElement } from "@excalidraw/yjs";

// Excalidraw 场景元素（公共字段与容器归属、绑定的形状以场景契约为准）。
export type BoardImportElement = ExcalidrawSceneElement;

// 图片资产：token + 字节 + mime，由 materializeAssets 收集后随场景写入。
export interface BoardImportAsset {
  token: string;
  bytes: Uint8Array;
  mimeType: string;
}

// 统计字段：转换层计 mapped / droppedNodes / richTextFlattened / downgraded 与
// elements；物化层计 assetRequests 与 droppedAssets。nodes 为原始节点总数。
// downgraded 汇总被替换或压平的保真度损失（未知图形、箭头回落、rich_text 拼行）。
export interface BoardImportStats {
  nodes: number;
  mapped: number;
  droppedNodes: number;
  droppedAssets: number;
  downgraded: number;
  elements: number;
  assetRequests: number;
  richTextFlattened: number;
}

export interface BoardImportResult {
  elements: BoardImportElement[];
  assets: Record<string, BoardImportAsset>;
  stats: BoardImportStats;
}

// 导入策略门槛（对应 CANVAS_LIMITS：元素 / 场景 / 资产上限）。
export interface BoardImportPolicy {
  maxNodes?: number;
  maxElements?: number;
  maxAssets?: number;
}

// 图片资产请求：飞书 image token + 确定性 fileId + 位置 / 尺寸。物化阶段据此
// 注入调用方解析好的资产引用。
export interface BoardAssetRequest {
  token: string;
  fileId: string;
  elementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// 转换层产出：场景元素 + 资产请求 + 统计增量（构建时计数，导入管线据此汇总）。
export interface BoardConversion {
  elements: BoardImportElement[];
  assetRequests: BoardAssetRequest[];
  /** 被替换 / 回落 / 丢弃内容的保真度损失次数（不含 rich_text 压平）。 */
  downgraded: number;
  /** 产出过至少一个元素的节点数。 */
  mapped: number;
  /** 非法 id 与范围外 / 未知类型节点数。 */
  droppedNodes: number;
  /** rich_text 按段落拼合为多行纯文本的发生次数。 */
  richTextFlattened: number;
}

export type { ScenePolicy };
