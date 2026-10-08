import {
  BASE_SHAPE_IDS,
  createSceneElement,
  createCanvasSceneCommands,
  createExcalidrawSceneCommands,
} from "@excalidraw/yjs";

import { z } from "zod";

import type { HocuspocusHeadlessSession } from "@excalidraw/yjs-hocuspocus-client";

import type {
  CanvasSceneOperation,
  ExcalidrawSceneElement,
} from "@excalidraw/yjs";

import {
  CanvasQueryResultSchema,
  ShapeQueryInputSchema,
  ConnectorQueryInputSchema,
  MindmapQueryInputSchema,
  TableQueryInputSchema,
  CanvasReceiptSchema,
  ConnectorEditInputSchema,
  MindmapEditInputSchema,
  ShapeEditInputSchema,
  TableEditInputSchema,
} from "./schemas.js";

import type {
  CanvasCollaborationApi,
  CanvasExecutionContext,
  CanvasSceneSnapshot,
} from "./port.js";

const version = z.number().int().safe().positive();
export const ExecuteInputSchema = z.discriminatedUnion("domain", [
  z
    .object({
      domain: z.literal("shape"),
      operation: ShapeEditInputSchema,
      expectedVersion: version.optional(),
    })
    .strict(),
  z
    .object({
      domain: z.literal("connector"),
      operation: ConnectorEditInputSchema,
      expectedVersion: version.optional(),
    })
    .strict(),
  z
    .object({
      domain: z.literal("mindmap"),
      operation: MindmapEditInputSchema,
      expectedVersion: version.optional(),
    })
    .strict(),
  z
    .object({
      domain: z.literal("table"),
      operation: TableEditInputSchema,
      expectedVersion: version.optional(),
    })
    .strict(),
]);
/** 基础形状草稿；复杂领域结构使用 execute 创建。 */
export const CreateElementInputSchema = z
  .object({
    kind: z.enum(BASE_SHAPE_IDS),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    angle: z.number().finite().optional(),
  })
  .strict();
export const QueryInputSchema = z.discriminatedUnion("domain", [
  z
    .object({ domain: z.literal("shape"), operation: ShapeQueryInputSchema })
    .strict(),
  z
    .object({
      domain: z.literal("connector"),
      operation: ConnectorQueryInputSchema,
    })
    .strict(),
  z
    .object({
      domain: z.literal("mindmap"),
      operation: MindmapQueryInputSchema,
    })
    .strict(),
  z
    .object({ domain: z.literal("table"), operation: TableQueryInputSchema })
    .strict(),
]);
const sceneElement = z.custom<ExcalidrawSceneElement>(
  (value) => typeof value === "object" && value !== null && "id" in value,
  "新增元素必须是 canonical 元素",
);
const endpoint = z
  .object({
    elementId: z.string().min(1),
    fixedPoint: z.tuple([z.number().finite(), z.number().finite()]),
    mode: z.enum(["inside", "orbit", "skip"]),
  })
  .strict()
  .nullable();
export const MutateInputSchema = z
  .object({
    mutations: z
      .array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("add"), element: sceneElement }).strict(),
          z
            .object({
              type: z.literal("update"),
              id: z.string().min(1),
              expectedVersion: version.optional(),
              patch: z.record(z.string(), z.unknown()),
            })
            .strict(),
          z
            .object({
              type: z.literal("delete"),
              id: z.string().min(1),
              expectedVersion: version.optional(),
            })
            .strict(),
          z
            .object({
              type: z.literal("connect"),
              id: z.string().min(1),
              expectedVersion: version.optional(),
              start: endpoint,
              end: endpoint,
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(1000),
  })
  .strict();

/** 新增元素必须是完整 JSON 数据；拒绝访问器、隐藏属性及缺省值，不静默丢弃字段。 */
const cloneElementData = <T>(value: T): T => {
  const ancestors = new Set<object>();
  const copy = (input: unknown): unknown => {
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean" ||
      (typeof input === "number" && Number.isFinite(input))
    ) {
      return input;
    }
    if (
      typeof input !== "object" ||
      ancestors.has(input) ||
      (!Array.isArray(input) &&
        Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null)
    ) {
      throw new Error("invalid_scene");
    }
    ancestors.add(input);
    const entries: [string, unknown][] = [];
    for (const key of Reflect.ownKeys(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (typeof key === "symbol" || !descriptor || !("value" in descriptor)) {
        throw new Error("invalid_scene");
      }
      if (Array.isArray(input) && key === "length") {
        continue;
      }
      if (
        Array.isArray(input) &&
        (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= input.length)
      ) {
        throw new Error("invalid_scene");
      }
      if (!descriptor.enumerable) {
        throw new Error("invalid_scene");
      }
      entries.push([key, copy(descriptor.value)]);
    }
    let result: unknown;
    if (Array.isArray(input)) {
      if (entries.length !== input.length) {
        throw new Error("invalid_scene");
      }
      result = entries.map(([, entry]) => entry);
    } else {
      result = Object.fromEntries(entries);
    }
    ancestors.delete(input);
    return result;
  };
  // 复制保留全部 JSON 字段；新增元素仍须经过 binding 的完整候选场景校验。
  return copy(value) as T;
};
const SceneSnapshotSchema = z
  .object({
    schemaVersion: z.literal(2),
    elements: z.array(z.json()),
    assets: z.record(z.string(), z.json()),
  })
  .strict();
export const MutationReceiptSchema = z
  .object({ changedElementIds: z.array(z.string().min(1)) })
  .strict();

/** 读取能力捕获当前代际；取消、重连或失去同步后不得继续读取。 */
const createReadGuard = (
  session: HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>,
  context: Readonly<{ signal?: AbortSignal }>,
  generation = session.getState().generation,
) => {
  return () => {
    if (context.signal?.aborted) {
      throw new Error("execution_cancelled");
    }
    const gate = session.binding.getGate();
    if (
      !session.binding.isCurrent(generation) ||
      !gate.initialized ||
      !gate.synced
    ) {
      throw new Error("session_unavailable");
    }
  };
};

/** 脚本读取与导出共用 canonical 校验和复制边界，不应用显示投影。 */
export const createCanvasSceneReader = (
  session: HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>,
  context: Readonly<{ signal?: AbortSignal }>,
  generation = session.getState().generation,
) => {
  const assertActive = createReadGuard(session, context, generation);
  return (): CanvasSceneSnapshot => {
    assertActive();
    const copy = session.getSceneSnapshot();
    const parsed = SceneSnapshotSchema.parse({ schemaVersion: 2, ...copy });
    // session 已验证完整 canonical 场景，保留其元素类型和 JSON 副本。
    return { ...parsed, elements: [...copy.elements] };
  };
};

/** 从宿主 session 组装短生命周期协作对象；session 本身的所有权不发生转移。 */
export const createCanvasCollaboration = (
  session: HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>,
  context: CanvasExecutionContext,
): CanvasCollaborationApi => {
  const generation = session.getState().generation;
  const assertReadable = createReadGuard(session, context, generation);
  const assertActive = (write = false): void => {
    assertReadable();
    if (
      write &&
      (context.mode !== "write" || !session.binding.getGate().canEdit)
    ) {
      throw new Error("not_editable");
    }
  };
  const getScene = createCanvasSceneReader(session, context, generation);
  const getElements = (...args: unknown[]) => {
    const parsed = z
      .union([z.tuple([]), z.tuple([z.array(z.string().min(1)).max(10000)])])
      .parse(args);
    const scene = getScene();
    const ids = parsed[0];
    if (
      ids &&
      ids.some(
        (id) =>
          !scene.elements.some(
            (element) =>
              typeof element === "object" &&
              element !== null &&
              "id" in element &&
              element.id === id,
          ),
      )
    ) {
      throw new Error("target_not_found");
    }
    return structuredClone(
      ids
        ? scene.elements.filter((element) => {
            return (
              typeof element === "object" &&
              element !== null &&
              "id" in element &&
              typeof element.id === "string" &&
              ids.includes(element.id)
            );
          })
        : scene.elements,
    );
  };
  const read: CanvasCollaborationApi = {
    getScene: (...args) => {
      z.tuple([]).parse(args);
      return getScene();
    },
    getElements,
    query: (...args: unknown[]) => {
      assertActive();
      const [input] = z.tuple([QueryInputSchema]).parse(args);
      const operation = input.operation;
      let items: Record<string, unknown>[] = getScene().elements.filter(
        (element) => {
          if (element.isDeleted) {
            return false;
          }
          switch (input.domain) {
            case "shape":
              return (
                element.type === "composite_shape" ||
                BASE_SHAPE_IDS.some((kind) => kind === element.type)
              );
            case "connector":
              return element.type === "arrow" || element.type === "line";
            case "mindmap":
              return (
                element.type === "mindmap-node" ||
                element.type === "mindmap-edge"
              );
            case "table":
              return element.type === "table";
          }
          return false;
        },
      );
      if ("elementId" in operation && operation.elementId) {
        items = items.filter((element) => element.id === operation.elementId);
      }
      if ("graphId" in operation) {
        items = items.filter(
          (element) => element.graphId === operation.graphId,
        );
        if (operation.nodeId) {
          items = items.filter((element) => element.id === operation.nodeId);
        }
      }
      if ("tableId" in operation) {
        items = items.filter((element) => element.id === operation.tableId);
        if (operation.cellId) {
          items = items.flatMap(
            (element) =>
              (element.table as ExcalidrawSceneElement["table"])?.cells.filter(
                (cell) => cell.id === operation.cellId,
              ) ?? [],
          );
        }
      }
      if (operation.action === "get" && items.length === 0) {
        throw new Error("target_not_found");
      }
      if ("text" in operation && operation.text !== undefined) {
        const text = operation.text;
        items = items.filter((element) =>
          JSON.stringify(element).includes(text),
        );
      }
      const offset = "offset" in operation ? operation.offset : 0;
      const limit = "limit" in operation ? operation.limit : 1;
      return CanvasQueryResultSchema.parse({
        domain: input.domain,
        items: items.slice(offset, offset + limit),
        total: items.length,
        offset,
        limit,
        hasMore: offset + limit < items.length,
      });
    },
  };
  if (context.mode === "read") {
    return Object.freeze(read);
  }

  const canvasCommands = createCanvasSceneCommands({
    binding: session.binding,
  });
  const mutationCommands = createExcalidrawSceneCommands({
    binding: session.binding,
  });
  return Object.freeze({
    ...read,
    createElement: (...args: unknown[]) => {
      assertActive();
      const [input] = z.tuple([CreateElementInputSchema]).parse(args);
      const { kind, ...geometry } = input;
      // 工厂包含合法可选 undefined 字段，canonical JSON 草稿省略这些字段。
      return JSON.parse(
        JSON.stringify(
          createSceneElement({
            type: kind,
            ...geometry,
            angle: geometry.angle as Parameters<
              typeof createSceneElement
            >[0]["angle"],
          }),
        ),
      );
    },
    execute: (...args: unknown[]) => {
      const [operation] = z.tuple([ExecuteInputSchema]).parse(args);
      assertActive(true);
      // Zod 的 shapeKind/shapeOptions 联合不保留纯内核的按 kind 关联类型；领域内核仍验证匹配关系。
      const receipt = canvasCommands.execute(
        operation as CanvasSceneOperation,
        { generation },
      );
      return CanvasReceiptSchema.parse({
        changedElementIds: receipt.changedElementIds,
        createdElementIds: receipt.createdElementIds,
        deletedElementIds: receipt.deletedElementIds,
        result: {
          domain: operation.domain,
          action: operation.operation.action,
          references: receipt.result.references,
        },
      });
    },
    mutate: (...args: unknown[]) => {
      const [input] = z.tuple([MutateInputSchema]).parse(args);
      const mutations = input.mutations.map((mutation) =>
        mutation.type === "add"
          ? { ...mutation, element: cloneElementData(mutation.element) }
          : mutation,
      );
      assertActive(true);
      return MutationReceiptSchema.parse({
        changedElementIds: mutationCommands.apply({
          mutations,
          generation,
        }),
      });
    },
  });
};
