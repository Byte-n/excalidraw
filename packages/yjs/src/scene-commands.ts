import { getUpdatedTimestamp, randomInteger } from "@excalidraw/common";

import type { ExcalidrawSceneElement } from "./excalidraw-scene-types";
import type { SceneBinding, SceneSnapshot } from "./types";

export type SceneConnectionEndpoint = {
  elementId: string;
  fixedPoint: [number, number];
  mode: "inside" | "orbit" | "skip";
};

export type SceneMutation<TElement extends ExcalidrawSceneElement> =
  | { type: "add"; element: TElement }
  | {
      type: "update";
      id: string;
      expectedVersion?: number;
      patch: Partial<TElement>;
    }
  | { type: "delete"; id: string; expectedVersion?: number }
  | {
      type: "connect";
      id: string;
      expectedVersion?: number;
      start: SceneConnectionEndpoint | null;
      end: SceneConnectionEndpoint | null;
    };

export interface ExcalidrawSceneCommands<
  TElement extends ExcalidrawSceneElement,
  TAsset,
> {
  /** 整批命令先纯计算并校验，再一次发布；返回本地变更 ID 而非远端 ACK。 */
  apply(input: {
    mutations: readonly SceneMutation<TElement>[];
    assets?: Readonly<Record<string, TAsset>>;
    generation?: number;
  }): string[];
}

const reserved = new Set([
  "id",
  "type",
  "version",
  "versionNonce",
  "updated",
  "isDeleted",
  "startBinding",
  "endBinding",
  "boundElements",
]);

/** 只约束显式命令的目标关系，已有 canonical 软关系不在此升格为硬约束。 */
export const createExcalidrawSceneCommands = <
  TElement extends ExcalidrawSceneElement,
  TAsset,
>({
  binding,
  validateScene,
}: {
  binding: SceneBinding<TElement, TAsset>;
  validateScene?: (scene: SceneSnapshot<TElement, TAsset>) => undefined;
}): ExcalidrawSceneCommands<TElement, TAsset> => ({
  apply: ({ mutations, assets = {}, generation }) => {
    const before = binding.getCanonical();
    const elements = new Map(
      before.elements.map((element) => [element.id, structuredClone(element)]),
    );
    const changed = new Set<string>();
    const get = (id: string, version?: number): TElement => {
      const element = elements.get(id);
      if (!element || element.isDeleted) {
        throw new Error(`scene command target not found: ${id}`);
      }
      if (version !== undefined && version !== element.version) {
        throw new Error(`scene command version conflict: ${id}`);
      }
      return element;
    };
    const bump = (element: TElement) => {
      const nonce = randomInteger();
      element.version++;
      element.versionNonce =
        nonce === element.versionNonce ? (nonce + 1) & 0x7fffffff : nonce;
      element.updated = getUpdatedTimestamp();
      changed.add(element.id);
    };
    for (const mutation of mutations) {
      if (mutation.type === "add") {
        const element = structuredClone(mutation.element);
        if (!element.id || elements.has(element.id) || element.isDeleted) {
          throw new Error(
            `scene command duplicate or invalid add: ${element.id}`,
          );
        }
        if (
          element.startBinding ||
          element.endBinding ||
          element.boundElements?.length
        ) {
          throw new Error("add relationships through a connect command");
        }
        elements.set(element.id, element);
        changed.add(element.id);
        continue;
      }
      const element = get(mutation.id, mutation.expectedVersion);
      if (mutation.type === "update") {
        for (const key of Object.keys(mutation.patch)) {
          if (reserved.has(key)) {
            throw new Error(`scene command reserved update field: ${key}`);
          }
        }
        Object.assign(element, structuredClone(mutation.patch));
        bump(element);
      } else if (mutation.type === "delete") {
        element.isDeleted = true;
        bump(element);
      } else {
        if (!["line", "arrow"].includes(element.type)) {
          throw new Error("scene connection requires line or arrow");
        }
        const endpoints = [mutation.start, mutation.end].filter(
          (endpoint) => endpoint !== null,
        );
        for (const endpoint of endpoints) {
          if (
            endpoint.elementId === element.id ||
            endpoint.fixedPoint.length !== 2 ||
            !endpoint.fixedPoint.every(Number.isFinite) ||
            !["inside", "orbit", "skip"].includes(endpoint.mode)
          ) {
            throw new Error("scene connection endpoint is invalid");
          }
          get(endpoint.elementId);
        }
        // 只修订此连接线的反向引用，保留不相关关系和既有软关系。
        const targets = new Set(
          endpoints.map((endpoint) => endpoint.elementId),
        );
        for (const target of elements.values()) {
          if (target.id === element.id) {
            continue;
          }
          const prior = target.boundElements ?? [];
          const next = prior.filter((bound) => bound.id !== element.id);
          if (targets.has(target.id)) {
            next.push({ id: element.id, type: element.type });
          }
          if (JSON.stringify(prior) !== JSON.stringify(next)) {
            target.boundElements = next;
            bump(target);
          }
        }
        element.startBinding = structuredClone(mutation.start);
        element.endBinding = structuredClone(mutation.end);
        bump(element);
      }
    }
    const candidate = {
      elements: [...elements.values()],
      assets: { ...before.assets, ...structuredClone(assets) },
    };
    for (const element of candidate.elements) {
      if (
        !element.id ||
        !element.type ||
        !element.index ||
        !Number.isSafeInteger(element.version) ||
        element.version < 1 ||
        !Number.isSafeInteger(element.versionNonce) ||
        typeof element.isDeleted !== "boolean" ||
        ![element.x, element.y, element.angle, element.updated].every(
          Number.isFinite,
        ) ||
        (element.type === "text"
          ? !(
              (element.width === undefined && element.height === undefined) ||
              (typeof element.width === "number" &&
                Number.isFinite(element.width) &&
                typeof element.height === "number" &&
                Number.isFinite(element.height))
            )
          : ![element.width, element.height].every(Number.isFinite))
      ) {
        throw new Error(
          "scene command candidate has invalid element identity or geometry",
        );
      }
    }
    const validation: unknown = validateScene?.(structuredClone(candidate));
    if (validation !== undefined) {
      throw new Error(
        "scene command validation must be synchronous and return undefined",
      );
    }
    return binding.applyCommand(
      {
        elements: [...changed].map((id) => elements.get(id)!),
        assets,
      },
      generation,
    );
  },
});
