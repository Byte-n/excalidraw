import * as Y from "yjs";

import type { ExcalidrawSceneElement, SceneSnapshot } from "@excalidraw/yjs";

import type { Connection } from "@hocuspocus/server";

import type {
  CanvasHocuspocusHooks,
  CanvasHocuspocusHooksOptions,
  CanvasPersistenceUpdate,
  CanvasRoom,
  CanvasUpdateContext,
} from "./index";

/** reason/code 可由 Hocuspocus 错误通道直接识别，不暴露输入内容。 */
export class CanvasHookError extends Error {
  constructor(
    readonly reason: string,
    readonly code = 4400,
    cause?: unknown,
    readonly kind: "scene" | "transition" = "scene",
  ) {
    super(reason, { cause });
    this.name = "CanvasHookError";
  }
}

const assertData = (value: unknown, parents = new Set<object>()): void => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return;
  }
  if (
    typeof value !== "object" ||
    value instanceof Y.AbstractType ||
    parents.has(value)
  ) {
    throw new CanvasHookError("canvas scene contains invalid data");
  }
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new CanvasHookError("canvas scene contains invalid data");
  }
  parents.add(value);
  Object.values(value).forEach((entry) => assertData(entry, parents));
  parents.delete(value);
};
const equal = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        equal(Reflect.get(left, key), Reflect.get(right, key)),
    )
  );
};

interface RoomState<TFence> {
  room: CanvasRoom<TFence>;
  document: Y.Doc;
  sequence: number;
  pending: CanvasPersistenceUpdate[];
  persistence: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  invalidated: boolean;
  loading: boolean;
}

export const createCanvasHocuspocusHooks = <
  TElement extends ExcalidrawSceneElement,
  TAsset,
  TContext,
  TActor,
  TFence = unknown,
>(
  options: CanvasHocuspocusHooksOptions<
    TElement,
    TAsset,
    TContext,
    TActor,
    TFence
  >,
): CanvasHocuspocusHooks<TContext> => {
  const rooms = new Map<string, RoomState<TFence>>();
  const serial = new Map<string, Promise<void>>();
  const locks = new Map<Connection<TContext>, () => void>();
  const error = (cause: unknown, reason: string): Error =>
    options.mapError?.(cause, reason) ??
    (cause instanceof CanvasHookError
      ? cause
      : new CanvasHookError(reason, 4400, cause));
  const get = (name: string): RoomState<TFence> => {
    const state = rooms.get(name);
    if (
      !state ||
      state.invalidated ||
      state.loading ||
      state.document.isDestroyed
    ) {
      throw new CanvasHookError("canvas room is unavailable", 4403);
    }
    return state;
  };
  const acquire = async (name: string): Promise<() => void> => {
    const previous = serial.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    serial.set(name, tail);
    await previous;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      release();
      void tail.then(() => {
        if (serial.get(name) === tail) {
          serial.delete(name);
        }
      });
    };
  };
  const read = (
    document: Y.Doc,
    room: CanvasRoom<TFence>,
  ): SceneSnapshot<TElement, TAsset> => {
    const allowed = new Set([
      "elements",
      "assets",
      ...(options.extraRootMaps ?? []),
    ]);
    for (const [name] of document.share) {
      if (!allowed.has(name)) {
        throw new CanvasHookError("canvas scene has an invalid root");
      }
      // Yjs 更新中的根最初为 AbstractType，仅在已声明名称上物化 Map。
      document.getMap(name);
    }
    for (const item of Y.decodeUpdate(Y.encodeStateAsUpdate(document))
      .structs) {
      if (
        item instanceof Y.Item &&
        typeof item.parent === "string" &&
        (!allowed.has(item.parent) || item.parentSub === null)
      ) {
        throw new CanvasHookError("canvas scene roots must be maps");
      }
    }
    if (
      !Y.snapshotContainsUpdate(
        Y.snapshot(document),
        Y.encodeStateAsUpdate(document),
      )
    ) {
      throw new CanvasHookError("canvas update has unresolved dependencies");
    }
    const elements = document.getMap<unknown>("elements");
    const assets = document.getMap<unknown>("assets");
    for (const [id, value] of elements) {
      assertData(value);
      if (
        !value ||
        typeof value !== "object" ||
        !("id" in value) ||
        value.id !== id ||
        !("version" in value) ||
        !Number.isSafeInteger(value.version) ||
        Number(value.version) < 1 ||
        !("isDeleted" in value) ||
        typeof value.isDeleted !== "boolean"
      ) {
        throw new CanvasHookError("canvas element identity is invalid");
      }
      const fields: Readonly<Record<string, unknown>> = value;
      if (
        typeof fields.type !== "string" ||
        !fields.type ||
        typeof fields.index !== "string" ||
        !fields.index ||
        !Number.isSafeInteger(fields.versionNonce) ||
        ![
          fields.x,
          fields.y,
          fields.angle,
          fields.updated,
        ].every((field) => typeof field === "number" && Number.isFinite(field)) ||
        (fields.type === "text"
          ? !(
              (fields.width === undefined && fields.height === undefined) ||
              (typeof fields.width === "number" &&
                Number.isFinite(fields.width) &&
                typeof fields.height === "number" &&
                Number.isFinite(fields.height))
            )
          : ![
              fields.width,
              fields.height,
            ].every(
              (field) => typeof field === "number" && Number.isFinite(field),
            ))
      ) {
        throw new CanvasHookError(
          "canvas element identity or geometry is invalid",
        );
      }
    }
    for (const value of assets.values()) {
      assertData(value);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new CanvasHookError("canvas assets must be complete objects");
      }
    }
    const result = options.readScene?.(document) ?? {
      // 泛型业务字段由宿主 validator 校验，通用结构已在上方完成运行时收窄。
      elements: [...elements.values()] as TElement[],
      assets: assets.toJSON() as Record<string, TAsset>,
    };
    const validation: unknown = options.validator.validateScene(result);
    const documentValidation: unknown = options.validateDocument?.(
      document,
      room,
    );
    if (validation !== undefined || documentValidation !== undefined) {
      throw new CanvasHookError("canvas scene validators must be synchronous");
    }
    return structuredClone(result);
  };
  const transition = (
    before: SceneSnapshot<TElement, TAsset>,
    candidate: SceneSnapshot<TElement, TAsset>,
  ) => {
    const ids = new Set(candidate.elements.map((element) => element.id));
    if (before.elements.some((element) => !ids.has(element.id))) {
      throw new CanvasHookError(
        "canvas elements require deletion tombstones",
        4400,
        undefined,
        "transition",
      );
    }
    for (const [id, asset] of Object.entries(before.assets)) {
      if (
        !Object.hasOwn(candidate.assets, id) ||
        !equal(asset, candidate.assets[id])
      ) {
        throw new CanvasHookError(
          "canvas assets cannot be deleted or rebound",
          4400,
          undefined,
          "transition",
        );
      }
    }
  };
  const persistence = <T>(
    state: RoomState<TFence>,
    run: () => Promise<T>,
  ): Promise<T> => {
    const result = state.persistence.then(run);
    // 失败不能毒化下一次重试；待写队列只在成功后删除。
    state.persistence = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const flushLocked = async (state: RoomState<TFence>) => {
    if (state.invalidated) {
      return;
    }
    const batch = state.pending.slice();
    if (!batch.length) {
      return;
    }
    try {
      await options.repository.append(state.room, batch);
    } catch (cause) {
      options.onError?.({
        room: state.room.name,
        operation: "flush",
        error: cause,
      });
      throw error(cause, "canvas WAL flush failed");
    }
    state.pending.splice(0, batch.length);
  };
  const flush = async (name: string) => {
    const state = get(name);
    await persistence(state, () => flushLocked(state));
  };
  const snapshot = async (name: string) => {
    const release = await acquire(name);
    try {
      const state = get(name);
      await persistence(state, async () => {
        read(state.document, state.room);
        const throughSequence = state.sequence;
        const update = Y.encodeStateAsUpdate(state.document);
        await flushLocked(state);
        if (state.invalidated) {
          throw new CanvasHookError("canvas room is unavailable", 4403);
        }
        try {
          await options.repository.snapshot(state.room, {
            update,
            throughSequence,
          });
        } catch (cause) {
          options.onError?.({
            room: name,
            operation: "snapshot",
            error: cause,
          });
          throw error(cause, "canvas snapshot failed");
        }
      });
    } finally {
      release();
    }
  };
  const releaseRoom = async (name: string) => {
    const release = await acquire(name);
    try {
      const state = rooms.get(name);
      if (!state) {
        return;
      }
      clearTimeout(state.timer);
      await persistence(state, async () => {
        await flushLocked(state);
        try {
          await options.repository.release(state.room);
        } catch (cause) {
          options.onError?.({ room: name, operation: "release", error: cause });
          throw error(cause, "canvas room release failed");
        }
      });
      rooms.delete(name);
    } finally {
      release();
    }
  };
  const hooks: CanvasHocuspocusHooks<TContext> = {
    flush,
    snapshot,
    release: releaseRoom,
    invalidate: (name) => {
      const state = rooms.get(name);
      if (state) {
        state.invalidated = true;
        state.pending.length = 0;
        clearTimeout(state.timer);
      }
    },
    onLoadDocument: async ({ documentName, document }) => {
      const release = await acquire(documentName);
      try {
        if (rooms.has(documentName)) {
          return;
        }
        const room = await options.resolveRoom(documentName);
        const state: RoomState<TFence> = {
          room,
          document,
          sequence: 0,
          pending: [],
          persistence: Promise.resolve(),
          invalidated: false,
          loading: true,
        };
        rooms.set(documentName, state);
        try {
          const updates = await options.repository.load(room);
          for (const update of updates) {
            Y.applyUpdate(document, update);
          }
          if (!updates.length) {
            await options.initialize?.(document, room);
          }
          read(document, room);
          state.loading = false;
        } catch (cause) {
          rooms.delete(documentName);
          throw error(cause, "canvas document load failed");
        }
      } finally {
        release();
      }
    },
    beforeHandleMessage: async ({ documentName, connection }) => {
      const release = await acquire(documentName);
      try {
        get(documentName);
        locks.set(connection, release);
      } catch (cause) {
        release();
        throw error(cause, "canvas room is unavailable");
      }
    },
    afterHandleMessage: async ({ connection }) => {
      locks.get(connection)?.();
      locks.delete(connection);
    },
    beforeSync: async ({
      documentName,
      document,
      connection,
      type,
      payload,
    }) => {
      if (type !== 1 && type !== 2) {
        return;
      }
      if (!locks.has(connection)) {
        throw new CanvasHookError(
          "canvas update requires a message critical section",
        );
      }
      const state = get(documentName);
      const context: CanvasUpdateContext<TContext, TActor, TFence> = {
        room: state.room,
        actor: options.resolveActor(connection),
        connection,
        origin: { source: "connection", connection },
        update: payload,
      };
      const candidate = new Y.Doc();
      try {
        Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
        const before = read(candidate, state.room);
        Y.applyUpdate(candidate, payload);
        const scene = read(candidate, state.room);
        const changes = !Y.snapshotContainsUpdate(
          Y.snapshot(document),
          payload,
        );
        if (!changes) {
          return;
        }
        if (connection.readOnly) {
          throw new CanvasHookError("canvas connection is read-only", 4403);
        }
        await options.authorize(context);
        transition(before, scene);
        await options.validator.validateTransition({
          before,
          candidate: scene,
          context,
        });
        await options.validator.authorizeAssets?.({
          candidate: scene,
          context,
        });
        await options.authorize(context);
        if (state.invalidated || document.isDestroyed || connection.readOnly) {
          throw new CanvasHookError(
            "canvas session is no longer writable",
            4403,
          );
        }
        // 返回后仅由 Hocuspocus 应用一次；不能在 beforeSync 手动 apply authoritative。
      } catch (cause) {
        try {
          await options.onRejected?.({ context, error: cause });
        } catch (registrationFailure) {
          throw error(
            registrationFailure,
            "canvas rejection registration failed",
          );
        }
        throw error(cause, "canvas update rejected");
      } finally {
        candidate.destroy();
      }
    },
    beforeHandleAwareness: async ({
      documentName,
      connection,
      states,
      transactionOrigin,
    }) => {
      const state = get(documentName);
      try {
        await options.validateAwareness({
          room: state.room,
          connection,
          states,
          origin: transactionOrigin,
        });
      } catch (cause) {
        throw error(cause, "canvas awareness rejected");
      }
    },
    onChange: async ({ documentName, document, update, transactionOrigin }) => {
      const state = rooms.get(documentName);
      if (state?.loading || state?.invalidated) {
        return;
      }
      try {
        if (!state || state.document !== document) {
          throw new CanvasHookError("canvas room is unavailable", 4403);
        }
        state.pending.push({
          sequence: ++state.sequence,
          update: update.slice(),
          origin: transactionOrigin,
        });
        if (!state.timer && options.flushIntervalMs !== undefined) {
          state.timer = setTimeout(() => {
            state.timer = undefined;
            void flush(documentName).catch(() => {});
          }, options.flushIntervalMs);
          state.timer.unref?.();
        }
        const accepted = options.onAccepted?.({
          room: state.room,
          document,
          update,
          origin: transactionOrigin,
        });
        if (accepted) {
          void Promise.resolve(accepted).catch((cause) =>
            options.onError?.({
              room: documentName,
              operation: "accepted",
              error: cause,
            }),
          );
        }
      } catch (cause) {
        options.onError?.({
          room: documentName,
          operation: "change",
          error: cause,
        });
      }
    },
    onStoreDocument: async ({ documentName }) => {
      if (!rooms.has(documentName) || rooms.get(documentName)?.invalidated) {
        return;
      }
      await snapshot(documentName);
    },
    beforeUnloadDocument: async ({ documentName }) => {
      if (!rooms.has(documentName) || rooms.get(documentName)?.invalidated) {
        return;
      }
      // 框架会在等待后再次检查连接数，新连接可能取消卸载，此处不能删除 room 状态。
      await flush(documentName);
    },
    afterUnloadDocument: async ({ documentName }) => {
      await releaseRoom(documentName);
    },
  };
  return hooks;
};
