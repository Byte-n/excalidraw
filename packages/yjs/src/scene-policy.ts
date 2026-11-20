import { YjsSceneError } from "./errors";

import type { SceneCapacityMetric } from "./errors";
import type { SceneElement, SceneSnapshot } from "./types";

/**
 * 宿主提供的场景门槛与持久化禁用项；vendor 不提供默认值。
 * 数值与策略由调用端（浏览器会话、协作 runtime、离线读取方）传入同一份配置。
 */
export type ScenePolicy = {
  /** 单个场景允许的结构元素数量；表格内部元素不计。 */
  maxElements: number;
  /** 单个场景允许的资产引用数量。 */
  maxAssets: number;
  /** 单个元素的序列化字节上限。 */
  maxElementBytes: number;
  /** 整个场景的序列化字节上限。 */
  maxSceneBytes: number;
  /** 单个文本区域的 Unicode 码点上限。 */
  maxTextChars: number;
  /** 单个场景允许的内容当量。 */
  maxContentUnits: number;
  /** 带非空文本区域的非表格元素占用的内容当量。 */
  textElementUnits: number;
  /** 单个表格允许的行数。 */
  maxTableRows: number;
  /** 单个表格允许的列数。 */
  maxTableColumns: number;
  /** 全场景允许的表格单元格总数。 */
  maxTableCells: number;
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

/** 场景容量计量快照；阈值比较与增长判断由宿主完成。 */
export type SceneCapacityMetrics = {
  /** 结构元素数；表格内部元素不计。 */
  structuralElements: number;
  assetCount: number;
  /** 全部文本区域中的最大码点数。 */
  maxTextChars: number;
  contentUnits: number;
  /** 单个表格的最大行数与列数。 */
  maxTableRows: number;
  maxTableColumns: number;
  /** 全场景表格单元格总数。 */
  tableCells: number;
};

const numericLimits = [
  "maxElements",
  "maxAssets",
  "maxElementBytes",
  "maxSceneBytes",
  "maxTextChars",
  "maxContentUnits",
  "textElementUnits",
  "maxTableRows",
  "maxTableColumns",
  "maxTableCells",
  "maxAssetBytes",
] as const;

export const jsonBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** 元素全部带字符串正文的文本区域；区域键不参与容量口径。 */
const textRegionsOf = (element: SceneElement): string[] => {
  const texts = element.texts;
  if (!isRecord(texts)) {
    return [];
  }
  const regions: string[] = [];
  for (const block of Object.values(texts)) {
    if (!isRecord(block)) {
      continue;
    }
    const text = block.text;
    if (typeof text === "string") {
      regions.push(text);
    }
  }
  return regions;
};

/** 文本按 Unicode 码点计量；代理对与 emoji 各计 1。 */
const countTextChars = (value: string): number => Array.from(value).length;

/** 表格内部元素由表格结构上限单独约束，不占用结构元素与内容当量。 */
const isTableInternal = (element: SceneElement): boolean => {
  const containerRef = element.containerRef;
  return isRecord(containerRef) && containerRef.kind === "tableCell";
};

const arrayLengthOf = (value: unknown): number =>
  Array.isArray(value) ? value.length : 0;

const tableShapeOf = (
  element: SceneElement,
): { rows: number; columns: number; cells: number } | null => {
  const table = element.table;
  if (!isRecord(table)) {
    return null;
  }
  return {
    rows: arrayLengthOf(table.rows),
    columns: arrayLengthOf(table.columns),
    cells: arrayLengthOf(table.cells),
  };
};

/**
 * 按场景策略计量容量：表格元素 1 当量、表格内部元素 0 当量、
 * 其他元素带任一非空文本区域计 `textElementUnits`，否则计 1；墓碑照常计入。
 */
export const measureSceneCapacity = <
  TElement extends SceneElement,
  TAsset = unknown,
>(
  scene: SceneSnapshot<TElement, TAsset>,
  policy: Pick<ScenePolicy, "textElementUnits">,
): SceneCapacityMetrics => {
  const metrics: SceneCapacityMetrics = {
    structuralElements: 0,
    assetCount: Object.keys(scene.assets).length,
    maxTextChars: 0,
    contentUnits: 0,
    maxTableRows: 0,
    maxTableColumns: 0,
    tableCells: 0,
  };
  for (const element of scene.elements) {
    const regions = textRegionsOf(element);
    for (const text of regions) {
      metrics.maxTextChars = Math.max(
        metrics.maxTextChars,
        countTextChars(text),
      );
    }
    if (element.type === "table") {
      const table = tableShapeOf(element);
      if (table) {
        metrics.maxTableRows = Math.max(metrics.maxTableRows, table.rows);
        metrics.maxTableColumns = Math.max(
          metrics.maxTableColumns,
          table.columns,
        );
        metrics.tableCells += table.cells;
      }
    }
    if (isTableInternal(element)) {
      continue;
    }
    metrics.structuralElements += 1;
    if (element.type === "table") {
      metrics.contentUnits += 1;
      continue;
    }
    metrics.contentUnits += regions.some((text) => text.length > 0)
      ? policy.textElementUnits
      : 1;
  }
  return metrics;
};

const capacityError = (
  message: string,
  metric: SceneCapacityMetric,
  actual: number,
  allowed: number,
): YjsSceneError =>
  new YjsSceneError("scene_limit_exceeded", message, {
    metric,
    actual,
    allowed,
  });

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
 * 计数与字节超限抛 `scene_limit_exceeded` 并携带计量项，结构与引用非法抛 `invalid_scene`。
 */
export const assertScenePolicy = <
  TElement extends SceneElement,
  TAsset = unknown,
>(
  scene: SceneSnapshot<TElement, TAsset>,
  policy: ScenePolicy,
): void => {
  assertPolicyShape(policy);
  const metrics = measureSceneCapacity(scene, policy);
  if (metrics.structuralElements > policy.maxElements) {
    throw capacityError(
      "scene exceeds the element count limit",
      "elements",
      metrics.structuralElements,
      policy.maxElements,
    );
  }
  if (metrics.assetCount > policy.maxAssets) {
    throw capacityError(
      "scene exceeds the asset count limit",
      "assets",
      metrics.assetCount,
      policy.maxAssets,
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
    const elementBytes = jsonBytes(element);
    if (elementBytes > policy.maxElementBytes) {
      throw capacityError(
        "scene element exceeds the byte limit",
        "elementBytes",
        elementBytes,
        policy.maxElementBytes,
      );
    }
    for (const text of textRegionsOf(element)) {
      const chars = countTextChars(text);
      if (chars > policy.maxTextChars) {
        throw capacityError(
          "scene text exceeds the character limit",
          "textChars",
          chars,
          policy.maxTextChars,
        );
      }
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
  if (metrics.maxTableRows > policy.maxTableRows) {
    throw capacityError(
      "scene table exceeds the row limit",
      "tableRows",
      metrics.maxTableRows,
      policy.maxTableRows,
    );
  }
  if (metrics.maxTableColumns > policy.maxTableColumns) {
    throw capacityError(
      "scene table exceeds the column limit",
      "tableColumns",
      metrics.maxTableColumns,
      policy.maxTableColumns,
    );
  }
  if (metrics.tableCells > policy.maxTableCells) {
    throw capacityError(
      "scene table exceeds the cell limit",
      "tableCells",
      metrics.tableCells,
      policy.maxTableCells,
    );
  }
  if (metrics.contentUnits > policy.maxContentUnits) {
    throw capacityError(
      "scene exceeds the content unit limit",
      "contentUnits",
      metrics.contentUnits,
      policy.maxContentUnits,
    );
  }
  const sceneBytes = jsonBytes(scene);
  if (sceneBytes > policy.maxSceneBytes) {
    throw capacityError(
      "scene exceeds the byte limit",
      "sceneBytes",
      sceneBytes,
      policy.maxSceneBytes,
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
      {
        metric: "assetBytes",
        actual: input.bytes,
        allowed: policy.maxAssetBytes,
      },
    );
  }
};
