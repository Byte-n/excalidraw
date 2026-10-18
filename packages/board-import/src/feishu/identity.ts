// 元素身份与内部草稿的共享定义。
//
// 元素构造器产出的元素需显式补齐身份（id / seed / version / versionNonce /
// groupIds）；seed 与 versionNonce 由 id 派生，保证同一输入稳定复现且不消耗
// 全局随机序列。Draft 是转换过程中以 fork 元素形状承载的中间态，第二遍据此
// 补齐容器归属、绑定与分数索引。

import type { LocalPoint, Radians } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  FractionalIndex,
} from "@excalidraw/element/types";

// 内部草稿：fork 元素 + 排序键（由 zIndex 派生的浮点序）。
export interface Draft {
  el: ExcalidrawElement;
  zKey: number;
}

// 元素身份字段：全部显式给定。
export function identity(id: string, angle: number) {
  return {
    id,
    angle: angle as Radians,
    seed: hashToSeed(id),
    version: 1,
    versionNonce: hashToSeed(`${id}#nonce`),
    groupIds: [] as string[],
  };
}

// djb2 派生 32 位整数种子。
function hashToSeed(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
}

// 分数索引品牌化。
export function toFractionalIndex(value: string): FractionalIndex {
  return value as FractionalIndex;
}

// 局部点：飞书点序列 → fork 的 `LocalPoint` 品牌元组。
export function localPoint(x: number, y: number): LocalPoint {
  return [x, y] as LocalPoint;
}
