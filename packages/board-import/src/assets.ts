// materializeAssets 阶段：把调用方解析好的资产引用注入场景。
//
// 本阶段不做 IO：调用方按 token 解析字节或平台资产引用后传入 `resolved`，
// 这里只做 fileId 映射与「未解析 → 丢弃图片元素」的收敛。`resolved` 的值
// 是不透明类型，包内不绑定任何平台的资产引用形状。

import type { ExcalidrawSceneElement } from "@excalidraw/yjs";

import type { BoardAssetRequest } from "./types.js";

// 解析结果：token → 调用方持有的资产引用（字节或平台句柄）。
export type ResolvedAssets<TAsset> = ReadonlyMap<string, TAsset>;

export interface MaterializeResult<TAsset> {
  elements: ExcalidrawSceneElement[];
  assets: Record<string, TAsset>;
  /** 未解析成功、导致对应图片元素被丢弃的请求数。 */
  dropped: number;
}

// 按请求把解析结果写入 `assets[fileId]`；未命中的请求丢弃对应图片元素并回报。
export function materializeAssets<TAsset>(
  elements: readonly ExcalidrawSceneElement[],
  requests: readonly BoardAssetRequest[],
  resolved: ResolvedAssets<TAsset>,
  onDropped: (request: BoardAssetRequest) => void,
): MaterializeResult<TAsset> {
  const assets: Record<string, TAsset> = {};
  const droppedElementIds = new Set<string>();
  let dropped = 0;

  for (const request of requests) {
    const asset = resolved.get(request.token);
    if (asset === undefined) {
      dropped += 1;
      droppedElementIds.add(request.elementId);
      onDropped(request);
      continue;
    }
    assets[request.fileId] = asset;
  }

  const filtered = elements.filter(
    (element) => !droppedElementIds.has(element.id),
  );

  return { elements: filtered, assets, dropped };
}
