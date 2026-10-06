import { assertSceneValue, equalSceneValue } from "./scene-value";

import { createYjsSceneBinding } from "./index";

import type * as Y from "yjs";
import type {
  BindingGate,
  SceneBinding,
  SceneBindingOptions,
  SceneElement,
  SceneSnapshot,
} from "./types";

const clone = <T>(value: T): T => structuredClone(value);
const nextVersionNonce = (current: number | undefined): number => {
  const candidate =
    typeof globalThis.crypto?.getRandomValues === "function"
      ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff
      : Math.floor(Math.random() * 0x80000000);
  return candidate === current ? (candidate + 1) & 0x7fffffff : candidate;
};

export const createSceneBinding = <
  TElement extends SceneElement,
  TAsset = unknown,
>({
  doc,
  adapter = {},
  elementsName = "elements",
  assetsName = "assets",
  origin = Symbol("excalidraw-yjs-local"),
  onRemoteChange,
  onRemoteSceneChange,
  observeRemote = true,
}: SceneBindingOptions<TElement, TAsset>): SceneBinding<TElement, TAsset> => {
  const elementBinding = createYjsSceneBinding<TElement>({
    doc,
    mapName: elementsName,
    origin,
  });
  const assets = doc.getMap<unknown>(assetsName);
  const elementClone = adapter.cloneElement ?? clone;
  let gate: BindingGate = {
    initialized: false,
    synced: false,
    canEdit: false,
    generation: 0,
  };
  let disposed = false;
  const listener = (transaction: Y.Transaction) => {
    if (disposed || transaction.origin === origin || gate.generation < 0) {
      return;
    }
    const changed = [...transaction.changed.keys()].some(
      (type) =>
        Object.is(type, doc.getMap(elementsName)) || Object.is(type, assets),
    );
    if (changed) {
      const scene = getCanonical();
      if (onRemoteChange) {
        if (onRemoteChange.length >= 2) {
          (
            onRemoteChange as (
              elements: readonly TElement[],
              assets: Readonly<Record<string, TAsset>>,
            ) => void
          )(scene.elements, scene.assets);
        } else {
          (onRemoteChange as (scene: SceneSnapshot<TElement, TAsset>) => void)(
            scene,
          );
        }
      }
      onRemoteSceneChange?.(scene);
    }
  };
  if (observeRemote) {
    doc.on("afterTransaction", listener);
  }
  const getElements = () => elementBinding.getElements();
  const getAssets = () => clone(assets.toJSON() as Record<string, TAsset>);
  const getCanonical = (): SceneSnapshot<TElement, TAsset> => ({
    elements: (adapter.sort?.(getElements()) ?? getElements()).map(
      elementClone,
    ),
    assets: getAssets(),
  });
  const assertWritable = () => {
    if (disposed || doc.isDestroyed) {
      throw new Error("Yjs scene binding is disposed");
    }
    if (!gate.initialized || !gate.synced || !gate.canEdit) {
      throw new Error("Yjs scene binding is not writable");
    }
  };
  const isCurrent = (generation: number) =>
    !disposed && generation === gate.generation;
  const transact = (run: () => void) => {
    assertWritable();
    doc.transact(run, origin);
  };
  // 比较、克隆和资产冲突检测都在写入前完成，Yjs 事务不会回滚异常。
  const prepareAssets = (nextAssets: Readonly<Record<string, TAsset>>) => {
    const prepared: [string, TAsset][] = [];
    for (const [id, input] of Object.entries(nextAssets)) {
      const asset = clone(input);
      assertSceneValue(asset);
      const existing = assets.get(id);
      if (existing !== undefined && !equalSceneValue(existing, asset)) {
        throw new Error("asset cannot be rebound");
      }
      if (existing === undefined) {
        prepared.push([id, asset]);
      }
    }
    return prepared;
  };
  const applyLocal = (
    elements: readonly TElement[],
    nextAssets: Readonly<Record<string, TAsset>> = {},
  ) => {
    assertWritable();
    const next = elements.map(elementClone);
    const validation: unknown = adapter.validate?.(next, nextAssets);
    if (validation !== undefined) {
      throw new Error(
        "scene validation must be synchronous and return undefined",
      );
    }
    const preparedElements = next.map(clone);
    const preparedAssets = prepareAssets(nextAssets);
    assertSceneValue(preparedElements);
    assertSceneValue(preparedAssets);
    transact(() => {
      elementBinding.transact(preparedElements);
      for (const [id, asset] of preparedAssets) {
        assets.set(id, asset);
      }
    });
  };
  const applyCommand = (
    command: {
      elements: readonly TElement[];
      assets?: Readonly<Record<string, TAsset>>;
      deleteIds?: readonly string[];
    },
    generation = gate.generation,
  ): string[] => {
    if (!isCurrent(generation)) {
      if (disposed || doc.isDestroyed) {
        throw new Error("白板场景会话已销毁");
      }
      throw new Error("Yjs scene binding generation is stale");
    }
    assertWritable();
    const current = new Map(
      getElements().map((element) => [element.id, elementClone(element)]),
    );
    const changed = new Map<string, TElement>();
    for (const input of command.elements) {
      const id = adapter.getId?.(input) ?? input.id;
      const value =
        adapter.normalizePersistent?.(elementClone(input)) ??
        elementClone(input);
      if (JSON.stringify(current.get(id)) !== JSON.stringify(value)) {
        current.set(id, value);
        changed.set(id, value);
      }
    }
    for (const id of command.deleteIds ?? []) {
      const existing = current.get(id);
      if (!existing || (existing as { isDeleted?: boolean }).isDeleted) {
        continue;
      }
      const value =
        adapter.tombstone?.(existing) ??
        ({
          ...elementClone(existing),
          isDeleted: true,
          version: (existing.version ?? 0) + 1,
          versionNonce: nextVersionNonce(
            (existing as { versionNonce?: number }).versionNonce,
          ),
        } as TElement);
      if (
        (value as { isDeleted?: boolean }).isDeleted &&
        (value as { versionNonce?: number }).versionNonce ===
          (existing as { versionNonce?: number }).versionNonce
      ) {
        (value as { versionNonce?: number }).versionNonce = nextVersionNonce(
          (existing as { versionNonce?: number }).versionNonce,
        );
      }
      current.set(id, value);
      changed.set(id, value);
    }
    const nextAssets = command.assets ?? {};
    const scene: SceneSnapshot<TElement, TAsset> = {
      elements: [...current.values()],
      assets: { ...getAssets(), ...nextAssets },
    };
    const validation: unknown = adapter.validateCanonical?.(scene);
    if (validation !== undefined) {
      throw new Error(
        "scene validation must be synchronous and return undefined",
      );
    }
    const preparedElements = [...changed].map(
      ([id, value]) => [id, clone(elementClone(value))] as const,
    );
    const preparedAssets = prepareAssets(nextAssets);
    assertSceneValue(preparedElements);
    assertSceneValue(preparedAssets);
    if (!preparedElements.length && !preparedAssets.length) {
      return [];
    }
    doc.transact(() => {
      const elements = doc.getMap<unknown>(elementsName);
      for (const [id, value] of preparedElements) {
        elements.set(id, value);
      }
      for (const [id, asset] of preparedAssets) {
        assets.set(id, asset);
      }
    }, origin);
    return [...changed.keys()];
  };
  const prepareImportCommand = (
    command: {
      elements: readonly TElement[];
      assets?: Readonly<Record<string, TAsset>>;
      deleteIds?: readonly string[];
    },
    generation = gate.generation,
  ) => {
    const snapshot = {
      elements: command.elements.map(elementClone),
      assets: command.assets ? clone(command.assets) : undefined,
      deleteIds: command.deleteIds ? [...command.deleteIds] : undefined,
    };
    let committed = false;
    return {
      commit: () => {
        if (committed) {
          throw new Error("scene import command already committed");
        }
        committed = true;
        return applyCommand(snapshot, generation);
      },
    };
  };
  return {
    origin,
    document: doc,
    getElements,
    getAssets,
    getCanonical,
    getAdapter: () => adapter,
    setGate: (next) => {
      gate = { ...gate, ...next };
    },
    getGate: () => ({ ...gate }),
    applyLocal,
    applyCommand,
    prepareImportCommand,
    transact,
    isCurrent,
    runIfCurrent: (generation, run) =>
      generation === gate.generation && !disposed ? run() : undefined,
    dispose: () => {
      if (!disposed) {
        disposed = true;
        if (observeRemote) {
          doc.off("afterTransaction", listener);
        }
        elementBinding.dispose();
      }
    },
  };
};
