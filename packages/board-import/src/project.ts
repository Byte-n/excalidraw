// project 阶段：最终校验与统计收敛。
//
// 元素 id 唯一、图片 fileId 与 assets 自洽由本阶段显式断言，随后交给 vendor
// 的场景门槛 `assertScenePolicy`（策略由调用方传入，包内不硬编码平台策略）。

import { assertScenePolicy } from "@excalidraw/yjs";

import type {
  BoardImportElement,
  BoardImportStats,
  ScenePolicy,
} from "./types.js";

// 场景收敛校验失败。
export class BoardProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardProjectionError";
  }
}

export interface ProjectResult<TAsset> {
  elements: BoardImportElement[];
  assets: Record<string, TAsset>;
  stats: BoardImportStats;
}

export function projectScene<TAsset>(
  elements: readonly BoardImportElement[],
  assets: Record<string, TAsset>,
  stats: BoardImportStats,
  policy: ScenePolicy,
): ProjectResult<TAsset> {
  const ids = new Set<string>();
  for (const element of elements) {
    if (typeof element.id !== "string" || element.id.length === 0) {
      throw new BoardProjectionError("场景元素缺少合法 id");
    }
    if (ids.has(element.id)) {
      throw new BoardProjectionError(`场景元素 id 重复: ${element.id}`);
    }
    ids.add(element.id);
  }

  for (const element of elements) {
    if (element.type !== "image") {
      continue;
    }
    const fileId = element.fileId;
    if (typeof fileId !== "string" || fileId.length === 0) {
      throw new BoardProjectionError(`图片元素 ${element.id} 缺少 fileId`);
    }
    if (!Object.hasOwn(assets, fileId)) {
      throw new BoardProjectionError(
        `图片元素 ${element.id} 的 fileId=${fileId} 未命中 assets`,
      );
    }
  }

  const finalElements = [...elements];
  assertScenePolicy({ elements: finalElements, assets }, policy);

  return { elements: finalElements, assets, stats };
}
