import { randomInteger } from "@excalidraw/common";

import { generateNKeysBetween } from "@excalidraw/fractional-indexing";

import {
  applyConnectorOperation,
  applyMindmapOperation,
  applyShapeOperation,
  applyTableOperation,
  CanvasSceneError,
} from "@excalidraw/element";

import type {
  CanvasElementOperationResult,
  ConnectorOperation,
  MindmapOperation,
  ShapeOperation,
  TableOperation,
} from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { YjsSceneError } from "./errors";
import { equalSceneValue } from "./scene-value";

import type { ExcalidrawSceneElement } from "./excalidraw-scene-types";
import type { SceneBinding, SceneSnapshot } from "./types";

/** yjs 负责提交边界；操作语义和字段由 element 纯操作定义。 */
export type CanvasSceneOperation =
  | Readonly<{
      domain: "shape";
      operation: ShapeOperation;
      expectedVersion?: number;
    }>
  | Readonly<{
      domain: "connector";
      operation: ConnectorOperation;
      expectedVersion?: number;
    }>
  | Readonly<{
      domain: "mindmap";
      operation: MindmapOperation;
      expectedVersion?: number;
    }>
  | Readonly<{
      domain: "table";
      operation: TableOperation;
      expectedVersion?: number;
    }>;

export type CanvasOperationResult = CanvasElementOperationResult;
export type CanvasLocalReceipt = Readonly<{
  changedElementIds: readonly string[];
  createdElementIds: readonly string[];
  deletedElementIds: readonly string[];
  result: CanvasOperationResult;
}>;
export type CanvasSceneCommandInput<TAsset = unknown> = Readonly<{
  operation: CanvasSceneOperation;
  assets?: Readonly<Record<string, TAsset>>;
  generation?: number;
}>;
export type CanvasSceneCommands<TAsset = unknown> = Readonly<{
  execute(
    operation: CanvasSceneOperation,
    options?: Readonly<{
      assets?: Readonly<Record<string, TAsset>>;
      generation?: number;
    }>,
  ): CanvasLocalReceipt;
  apply(input: CanvasSceneCommandInput<TAsset>): CanvasLocalReceipt;
}>;

const nextVersionNonce = (current: number): number => {
  const candidate = randomInteger();
  return candidate === current ? (candidate + 1) & 0x7fffffff : candidate;
};

const targetId = (operation: CanvasSceneOperation): string | null => {
  const value = operation.operation;
  if (value.action === "create" || value.action === "createRoot") {
    return null;
  }
  if ("nodeId" in value.target) {
    return value.target.nodeId;
  }
  if ("tableId" in value.target) {
    return value.target.tableId;
  }
  return value.target.elementId;
};

const assertExpectedVersion = (
  operation: CanvasSceneOperation,
  elements: readonly ExcalidrawElement[],
): void => {
  if (operation.expectedVersion === undefined) {
    return;
  }
  if (
    !Number.isSafeInteger(operation.expectedVersion) ||
    operation.expectedVersion < 1
  ) {
    throw new YjsSceneError("invalid_input", "expectedVersion 必须为正整数");
  }
  const id = targetId(operation);
  if (!id) {
    throw new YjsSceneError(
      "invalid_input",
      "创建操作不能携带 expectedVersion",
    );
  }
  const target = elements.find((element) => element.id === id);
  if (!target || target.isDeleted) {
    throw new YjsSceneError("target_not_found", "操作目标不存在");
  }
  if (target.version !== operation.expectedVersion) {
    throw new YjsSceneError("version_conflict", "操作目标版本冲突");
  }
};

const applyElementOperation = (
  elements: readonly ExcalidrawElement[],
  operation: CanvasSceneOperation,
): CanvasElementOperationResult => {
  switch (operation.domain) {
    case "shape":
      return applyShapeOperation(elements, operation.operation);
    case "connector":
      return applyConnectorOperation(elements, operation.operation);
    case "mindmap":
      return applyMindmapOperation(elements, operation.operation);
    case "table":
      return applyTableOperation(elements, operation.operation);
  }
};

const normalizeCandidate = (
  before: readonly ExcalidrawElement[],
  result: CanvasElementOperationResult,
): {
  elements: readonly ExcalidrawElement[];
  changedElementIds: readonly string[];
  createdElementIds: readonly string[];
  deletedElementIds: readonly string[];
} => {
  const previous = new Map(before.map((element) => [element.id, element]));
  const now = Date.now();
  const ordered = [...before].sort(
    (left, right) =>
      (left.index ?? "").localeCompare(right.index ?? "") ||
      left.id.localeCompare(right.id),
  );
  let left = ordered.at(-1)?.index ?? null;
  const candidate = result.elements.map((element) => {
    const old = previous.get(element.id);
    let next = element;
    if (!old && !next.index) {
      const generated = generateNKeysBetween(left, null, 1)[0]! as NonNullable<
        ExcalidrawElement["index"]
      >;
      next = { ...next, index: generated };
      left = generated;
    }
    if (old && !equalSceneValue(old, next)) {
      next = {
        ...next,
        version: old.version + 1,
        versionNonce: nextVersionNonce(old.versionNonce),
        updated: now,
        created: old.created,
        index: old.index,
      };
    }
    return next;
  });
  const candidateById = new Map(
    candidate.map((element) => [element.id, element]),
  );
  const changed = before
    .filter(
      (element) => !equalSceneValue(element, candidateById.get(element.id)),
    )
    .map((element) => element.id)
    .concat(
      candidate
        .filter((element) => !previous.has(element.id))
        .map((element) => element.id),
    );
  const changedElementIds = [...new Set(changed)];
  return {
    elements: candidate,
    changedElementIds,
    createdElementIds: candidate
      .filter((element) => !previous.has(element.id))
      .map((element) => element.id),
    deletedElementIds: candidate
      .filter(
        (element) => element.isDeleted && !previous.get(element.id)?.isDeleted,
      )
      .map((element) => element.id),
  };
};

/** canonical scene 经宿主 validator 确认完整 Excalidraw 联合后进入纯操作。 */
const asElements = (
  elements: readonly ExcalidrawSceneElement[],
): readonly ExcalidrawElement[] =>
  elements as unknown as readonly ExcalidrawElement[];
const asSceneElements = (
  elements: readonly ExcalidrawElement[],
): readonly ExcalidrawSceneElement[] =>
  elements as unknown as readonly ExcalidrawSceneElement[];

const validateCandidate = <TAsset>(
  binding: SceneBinding<ExcalidrawSceneElement, TAsset>,
  scene: SceneSnapshot<ExcalidrawSceneElement, TAsset>,
): void => {
  const validate = binding.getAdapter().validateCanonical;
  if (validate) {
    try {
      const result = validate(structuredClone(scene));
      if (result !== undefined) {
        throw new YjsSceneError("invalid_scene", "场景校验必须同步完成");
      }
    } catch (error) {
      if (error instanceof YjsSceneError) {
        throw error;
      }
      throw new YjsSceneError("invalid_scene", "场景候选校验失败");
    }
  }
};

const mapElementError = (error: unknown): YjsSceneError => {
  if (error instanceof YjsSceneError) {
    return error;
  }
  if (error instanceof CanvasSceneError) {
    return new YjsSceneError(error.code, error.message);
  }
  return new YjsSceneError("invalid_scene", "场景提交校验失败");
};

export const createCanvasSceneCommands = <TAsset = unknown>({
  binding,
}: {
  binding: SceneBinding<ExcalidrawSceneElement, TAsset>;
}): CanvasSceneCommands<TAsset> => {
  const execute = (
    operation: CanvasSceneOperation,
    options: Readonly<{
      assets?: Readonly<Record<string, TAsset>>;
      generation?: number;
    }> = {},
  ): CanvasLocalReceipt => {
    const gate = binding.getGate();
    const generation = options.generation ?? gate.generation;
    if (!gate.initialized || !gate.synced) {
      throw new YjsSceneError("session_unavailable", "白板场景尚未同步");
    }
    if (!gate.canEdit) {
      throw new YjsSceneError("not_editable", "白板当前不可编辑");
    }
    if (!binding.isCurrent(generation)) {
      throw new YjsSceneError("session_unavailable", "白板场景会话已失效");
    }
    const canonical = binding.getCanonical();
    const before = asElements(canonical.elements);
    assertExpectedVersion(operation, before);
    let result: CanvasElementOperationResult;
    try {
      result = applyElementOperation(before, operation);
    } catch (error) {
      throw mapElementError(error);
    }
    const normalized = normalizeCandidate(before, result);
    const assets = options.assets ?? {};
    const candidate: SceneSnapshot<ExcalidrawSceneElement, TAsset> = {
      elements: asSceneElements(normalized.elements),
      assets: { ...canonical.assets, ...structuredClone(assets) },
    };
    validateCandidate(binding, candidate);
    let committed: readonly string[];
    try {
      committed = binding.applyCommand(
        {
          elements: asSceneElements(normalized.elements),
          assets,
        },
        generation,
      );
    } catch (error) {
      throw mapElementError(error);
    }
    if (committed.length !== normalized.changedElementIds.length) {
      throw new YjsSceneError("invalid_scene", "场景提交结果与候选不一致");
    }
    return {
      changedElementIds: normalized.changedElementIds,
      createdElementIds: normalized.createdElementIds,
      deletedElementIds: normalized.deletedElementIds,
      result: {
        ...result,
        elements: normalized.elements,
        changedElementIds: normalized.changedElementIds,
        createdElementIds: normalized.createdElementIds,
        deletedElementIds: normalized.deletedElementIds,
      },
    };
  };
  return {
    execute,
    apply: ({ operation, assets, generation }) =>
      execute(operation, { assets, generation }),
  };
};
