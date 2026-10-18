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

// 统计字段：parse 计 nodes / mapped / droppedNodes / richTextFlattened；
// render 计 elements；materialize 计 assetRequests 与 droppedAssets。downgraded
// 汇总被替换或压平的保真度损失（未知图形、箭头回落、rich_text 拼行）。
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

export type { ScenePolicy };
