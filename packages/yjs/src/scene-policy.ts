import { YjsSceneError } from "./errors";

import type { SceneElement, SceneSnapshot } from "./types";

/**
 * 宿主提供的场景门槛与持久化禁用项；vendor 不提供默认值。
 * 数值与策略由调用端（浏览器会话、协作 runtime、离线读取方）传入同一份配置。
 */
export type ScenePolicy = {
  /** 单个场景允许的元素数量。 */
  maxElements: number;
  /** 单个场景允许的资产引用数量。 */
  maxAssets: number;
  /** 单个元素的序列化字节上限。 */
  maxElementBytes: number;
  /** 整个场景的序列化字节上限。 */
  maxSceneBytes: number;
  /** 单个文本节点文本内容的字节上限。 */
  maxTextBytes: number;
  /** 单个资产的字节上限（资产通道在关联前拒绝）。 */
  maxAssetBytes: number;
  /** 资产允许的类型（资产通道在关联前拒绝）。 */
  assetMimeTypes: readonly string[];
  /** 禁止持久化的运行时字段名；出现在元素任意层级即拒绝。 */
  forbiddenPersistentFields: readonly string[];
  /** 宿主的“资产已就绪”判定；缺省视为存在引用即就绪。 */
  isAssetPersistable?: (asset: unknown) => boolean;
};

/** 资产通道的字节与类型限制，取自场景门槛的对应项。 */
export type AssetPolicy = Pick<ScenePolicy, "maxAssetBytes" | "assetMimeTypes">;

const numericLimits = [
  "maxElements",
  "maxAssets",
  "maxElementBytes",
  "maxSceneBytes",
  "maxTextBytes",
  "maxAssetBytes",
] as const;

export const jsonBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** 文本内容按 UTF-8 字节计量；非字符串文本不作为文本节点计量。 */
const textBytes = (element: SceneElement): number | null =>
  element.type === "text" && typeof element.text === "string"
    ? new TextEncoder().encode(element.text).byteLength
    : null;

const assertPolicyShape = (policy: ScenePolicy): void => {
  for (const key of numericLimits) {
    const value = policy[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new YjsSceneError(
        "invalid_input",
        `scene policy ${key} must be provided by the host`,
      );
    }
  }
  if (!policy.assetMimeTypes.length) {
    throw new YjsSceneError(
      "invalid_input",
      "scene policy assetMimeTypes must be provided by the host",
    );
  }
};

/** 运行时字段与内联二进制不得进入持久化场景。 */
const assertPersistableFields = (
  element: SceneElement,
  policy: ScenePolicy,
): void => {
  const forbidden = new Set(policy.forbiddenPersistentFields);
  const visit = (value: unknown, field = ""): boolean => {
    if (typeof value === "string") {
      return !["text", "originalText"].includes(field) && /^data:/i.test(value);
    }
    if (!value || typeof value !== "object") {
      return false;
    }
    return Object.entries(value).some(
      ([key, nested]) => forbidden.has(key) || visit(nested, key),
    );
  };
  if (visit(element)) {
    throw new YjsSceneError(
      "invalid_scene",
      "scene elements must not persist runtime fields",
    );
  }
};

/**
 * 场景级门槛与语义不变量；宿主 schema 不再镜像 vendor 元素模型。
 * 计数与字节超限抛 `scene_limit_exceeded`，结构与引用非法抛 `invalid_scene`。
 */
export const assertScenePolicy = <
  TElement extends SceneElement,
  TAsset = unknown,
>(
  scene: SceneSnapshot<TElement, TAsset>,
  policy: ScenePolicy,
): void => {
  assertPolicyShape(policy);
  if (scene.elements.length > policy.maxElements) {
    throw new YjsSceneError(
      "scene_limit_exceeded",
      "scene exceeds the element count limit",
    );
  }
  if (Object.keys(scene.assets).length > policy.maxAssets) {
    throw new YjsSceneError(
      "scene_limit_exceeded",
      "scene exceeds the asset count limit",
    );
  }
  const ids = new Set<string>();
  for (const element of scene.elements) {
    if (typeof element.id !== "string" || !element.id || ids.has(element.id)) {
      throw new YjsSceneError(
        "invalid_scene",
        "scene elements require unique identities",
      );
    }
    ids.add(element.id);
    if (jsonBytes(element) > policy.maxElementBytes) {
      throw new YjsSceneError(
        "scene_limit_exceeded",
        "scene element exceeds the byte limit",
      );
    }
    const text = textBytes(element);
    if (text !== null && text > policy.maxTextBytes) {
      throw new YjsSceneError(
        "scene_limit_exceeded",
        "scene text exceeds the byte limit",
      );
    }
    assertPersistableFields(element, policy);
    if (element.type === "image") {
      const fileId = element.fileId;
      if (typeof fileId !== "string" || !Object.hasOwn(scene.assets, fileId)) {
        throw new YjsSceneError(
          "invalid_scene",
          "scene images must reference a ready asset",
        );
      }
      if (
        policy.isAssetPersistable &&
        !policy.isAssetPersistable(scene.assets[fileId])
      ) {
        throw new YjsSceneError(
          "invalid_scene",
          "scene images must reference a ready asset",
        );
      }
    }
  }
  if (jsonBytes(scene) > policy.maxSceneBytes) {
    throw new YjsSceneError(
      "scene_limit_exceeded",
      "scene exceeds the byte limit",
    );
  }
};

/** 资产关联前判定类型与字节；由资产通道在执行上传前调用。 */
export const assertAssetPolicy = (
  policy: AssetPolicy,
  input: { mimeType: string; bytes: number },
): void => {
  if (!policy.assetMimeTypes.includes(input.mimeType)) {
    throw new YjsSceneError(
      "invalid_asset",
      "asset type is not allowed by the scene policy",
    );
  }
  if (input.bytes > policy.maxAssetBytes) {
    throw new YjsSceneError(
      "scene_limit_exceeded",
      "asset exceeds the byte limit",
    );
  }
};
