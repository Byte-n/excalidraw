import {
  createExcalidrawSceneCommands,
  createSceneBinding,
  orderExcalidrawSceneElements,
} from "@excalidraw/yjs";

import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import * as Y from "yjs";

import type { ExcalidrawSceneElement } from "@excalidraw/yjs";

import type {
  onAuthenticatedParameters,
  onAuthenticationFailedParameters,
  onStatusParameters,
  onSyncedParameters,
} from "@hocuspocus/provider";

import type {
  HocuspocusHeadlessSession,
  HocuspocusHeadlessSessionOptions,
  HocuspocusSessionError,
  HocuspocusSessionState,
} from "./index";

export const createHocuspocusHeadlessSession = <
  TElement extends ExcalidrawSceneElement,
  TAsset,
>(
  options: HocuspocusHeadlessSessionOptions<TElement, TAsset>,
): HocuspocusHeadlessSession<TElement, TAsset> => {
  if (!options.room || !options.url) {
    throw new Error("Hocuspocus session requires room and url");
  }
  if (
    options.provider &&
    (options.provider.document !== options.document ||
      options.provider.configuration.name !== options.room)
  ) {
    throw new Error("borrowed provider must match session document and room");
  }
  if (options.connectionManagedExternally && !options.provider) {
    throw new Error(
      "externally managed connection requires a borrowed provider",
    );
  }
  const externallyManaged = !!options.connectionManagedExternally;
  if (externallyManaged && (options.persistence || options.prepare)) {
    throw new Error(
      "externally managed connection prepares document and persistence in host",
    );
  }
  const document = options.document ?? new Y.Doc();
  const ownDocument = !options.document;
  const ownProvider = !options.provider;
  const controller = new AbortController();
  let state: HocuspocusSessionState = {
    status: "idle",
    synced: false,
    canEdit: false,
    generation: 0,
  };
  let authorized = false;
  let initiallySynced = false;
  let suspended = false;
  let permission = true;
  let closed = false;
  let settled = false;
  let closing: Promise<void> | undefined;
  let tokenRefresh: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: HocuspocusSessionError) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // 调用者仍可观察原始 rejection，内部处理避免未订阅 ready 的宿主产生未处理异常。
  void ready.catch(() => {});
  const binding = createSceneBinding<TElement, TAsset>({
    doc: document,
    adapter: {
      validateCanonical: options.validateScene,
      sort: orderExcalidrawSceneElements,
      tombstone: (element) => ({
        ...structuredClone(element),
        isDeleted: true,
        version: element.version + 1,
        versionNonce: element.versionNonce + 1,
      }),
    },
  });
  const commands = createExcalidrawSceneCommands({ binding });
  const listeners = new Set<(next: HocuspocusSessionState) => void>();
  const update = (next: Partial<HocuspocusSessionState>) => {
    state = { ...state, ...next };
    binding.setGate({
      initialized: true,
      synced: state.synced,
      canEdit: state.canEdit,
      generation: state.generation,
    });
    for (const listener of listeners) {
      listener(state);
    }
  };
  const report = (error: HocuspocusSessionError) => {
    options.onError?.(error);
  };
  const failReady = (error: HocuspocusSessionError) => {
    if (!settled) {
      settled = true;
      rejectReady(error);
    }
  };
  const socket = ownProvider
    ? (() => {
        try {
          return new HocuspocusProviderWebsocket({
            url: options.url,
            autoConnect: false,
            ...(options.WebSocketPolyfill
              ? { WebSocketPolyfill: options.WebSocketPolyfill }
              : {}),
          });
        } catch (error) {
          binding.dispose();
          if (ownDocument) {
            document.destroy();
          }
          throw error;
        }
      })()
    : undefined;
  const provider = (() => {
    try {
      return (
        options.provider ??
        new HocuspocusProvider({
          name: options.room,
          document,
          websocketProvider: socket!,
          token: async () => {
            try {
              const result = await options.token({
                room: options.room,
                signal: controller.signal,
              });
              controller.signal.throwIfAborted();
              clearTimeout(tokenRefresh);
              if (
                typeof result !== "string" &&
                result.expiresAtMs !== undefined
              ) {
                if (
                  !Number.isFinite(result.expiresAtMs) ||
                  result.expiresAtMs <= Date.now()
                ) {
                  throw new Error("token expiry must be in the future");
                }
                tokenRefresh = setTimeout(() => {
                  void session.refreshToken().catch((cause) => {
                    if (!closed) {
                      report({
                        code: "authentication",
                        message: "token refresh failed",
                        cause,
                      });
                    }
                  });
                }, Math.max(1000, result.expiresAtMs - Date.now() - 30_000));
              }
              return typeof result === "string" ? result : result.token;
            } catch (cause) {
              if (!closed) {
                const error: HocuspocusSessionError = {
                  code: "authentication",
                  message: "token provider failed",
                  cause,
                };
                failReady(error);
                report(error);
                void session.close();
              }
              return "";
            }
          },
        })
      );
    } catch (error) {
      socket?.destroy();
      binding.dispose();
      if (ownDocument) {
        document.destroy();
      }
      throw error;
    }
  })();
  const cleanups: (() => void)[] = [];
  const listen = <T>(event: string, listener: (value: T) => void) => {
    provider.on(event, listener);
    cleanups.push(() => provider.off(event, listener));
  };
  listen<onAuthenticatedParameters>("authenticated", ({ scope }) => {
    if (externallyManaged && !closed && state.status !== "rejected") {
      session.resume();
    }
    if (!closed && !suspended && state.status !== "rejected") {
      authorized = scope === "read-write";
      update({
        canEdit: authorized && permission && state.synced,
      });
    }
  });
  listen<onAuthenticationFailedParameters>(
    "authenticationFailed",
    ({ reason }) => {
      if (!closed) {
        const error: HocuspocusSessionError = {
          code: "authentication",
          message: reason,
        };
        if (externallyManaged) {
          session.suspend();
          report(error);
          return;
        }
        update({ status: "rejected", canEdit: false, synced: false });
        const action = options.onAuthenticationFailed?.(reason) ?? "close";
        if (action === "retry") {
          report(error);
          update({ status: "connected", synced: provider.synced });
          void session.refreshToken().catch((cause) => {
            failReady({ ...error, cause });
            void session.close();
          });
        } else if (action === "pause") {
          session.suspend();
          report(error);
        } else if (action === "reject") {
          session.reject(error);
        } else {
          report(error);
          failReady(error);
          void session.close();
        }
      }
    },
  );
  listen<onStatusParameters>("status", ({ status }) => {
    if (!closed && state.status !== "rejected") {
      update({
        status,
        ...(status !== "connected"
          ? {
              synced:
                initiallySynced && !suspended && !!options.allowOfflineEditing,
              canEdit:
                initiallySynced &&
                !suspended &&
                !!options.allowOfflineEditing &&
                authorized &&
                permission,
            }
          : {}),
      });
    }
  });
  listen<onSyncedParameters>("synced", ({ state: synced }) => {
    if (closed || suspended || state.status === "rejected") {
      return;
    }
    if (synced) {
      initiallySynced = true;
      try {
        const validation: unknown = options.validateScene(
          binding.getCanonical(),
        );
        if (validation !== undefined) {
          throw new Error("scene validation must be synchronous");
        }
      } catch (cause) {
        session.reject({
          code: "rejected",
          message: "synchronized scene rejected",
          cause,
        });
        return;
      }
    }
    update({ synced, canEdit: synced && authorized && permission });
    if (synced && !settled) {
      settled = true;
      resolveReady();
    }
  });
  listen<{ payload: string }>("stateless", ({ payload }) => {
    if (!closed) {
      options.onStateless?.(payload);
    }
  });
  listen<unknown>("disconnect", () => {
    if (!closed && state.status !== "rejected") {
      const offlineEditable =
        !!options.allowOfflineEditing && initiallySynced && !suspended;
      if (!offlineEditable) {
        authorized = false;
      }
      update({
        status: "disconnected",
        canEdit: offlineEditable && authorized && permission,
        synced: offlineEditable,
        generation: state.generation + 1,
      });
      if (provider.hasUnsyncedChanges) {
        report({
          code: "transport",
          message: "connection lost with local changes",
          outcome: "unknown",
        });
      }
    }
  });
  listen<unknown>("destroy", () => {
    if (!closed) {
      const error: HocuspocusSessionError = {
        code: "transport",
        message: "session provider destroyed",
      };
      failReady(error);
      report(error);
      void session.close();
    }
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    const error: HocuspocusSessionError = {
      code: "cancelled",
      message: "session cancelled",
    };
    failReady(error);
    void session.close();
  };
  const session: HocuspocusHeadlessSession<TElement, TAsset> = {
    document,
    provider,
    binding,
    ready,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getScene: () => binding.getCanonical(),
    applyCommand: (command) => binding.applyCommand(command),
    mutate: (input) => commands.apply(input),
    setPermission: (canEdit) => {
      if (!closed) {
        permission = canEdit;
        update({
          canEdit:
            authorized &&
            permission &&
            state.synced &&
            state.status !== "rejected",
        });
      }
    },
    reject: (error) => {
      if (closed) {
        return;
      }
      clearTimeout(timeout);
      update({
        status: "rejected",
        canEdit: false,
        synced: false,
        generation: state.generation + 1,
      });
      if (ownProvider) {
        socket?.disconnect();
        provider.detach();
      }
      failReady(error);
      report(error);
    },
    suspend: () => {
      if (closed) {
        return;
      }
      suspended = true;
      authorized = false;
      update({
        status: "disconnected",
        synced: false,
        canEdit: false,
        generation: state.generation + 1,
      });
      if (ownProvider) {
        socket?.disconnect();
        provider.detach();
      }
    },
    disconnect: () => {
      if (!closed && ownProvider) {
        socket?.disconnect();
      }
    },
    resume: () => {
      if (closed || state.status === "rejected") {
        return;
      }
      suspended = false;
      authorized =
        provider.isAuthenticated && provider.authorizedScope === "read-write";
      const synced = initiallySynced && provider.synced;
      update({
        status:
          provider.isAuthenticated &&
          provider.configuration.websocketProvider.status === "connected"
            ? "connected"
            : state.status,
        synced,
        canEdit: synced && authorized && permission,
      });
    },
    reconnect: async () => {
      if (externallyManaged) {
        throw new Error("connection is managed externally");
      }
      if (closed) {
        throw new Error("Hocuspocus session is closed");
      }
      if (state.status === "rejected") {
        throw new Error("rejected session requires a fresh document");
      }
      suspended = false;
      update({ status: "connecting", synced: false, canEdit: false });
      provider.synced = false;
      provider.attach();
      await provider.configuration.websocketProvider.connect();
      if (!closed) {
        provider.forceSync();
      }
    },
    refreshToken: async () => {
      if (externallyManaged) {
        throw new Error("connection is managed externally");
      }
      if (closed) {
        throw new Error("Hocuspocus session is closed");
      }
      await provider.sendToken();
    },
    close: (closeOptions) => {
      if (closing) {
        return closing;
      }
      let finish!: () => void;
      let fail!: (error: unknown) => void;
      closing = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      closed = true;
      controller.abort();
      clearTimeout(timeout);
      clearTimeout(tokenRefresh);
      options.signal?.removeEventListener("abort", abort);
      update({
        status: "closed",
        synced: false,
        canEdit: false,
        generation: state.generation + 1,
      });
      listeners.clear();
      cleanups.forEach((cleanup) => cleanup());
      binding.dispose();
      failReady({
        code: "cancelled",
        message: "session closed before initial sync",
      });
      void (async () => {
        try {
          if (ownProvider) {
            socket?.destroy();
            provider.destroy();
          }
        } finally {
          try {
            await options.persistence?.close();
          } finally {
            // 保存失败时保留原文档，宿主可继续导出或重试隔离。
            if (closeOptions?.preserve) {
              await closeOptions.preserve(document);
            }
            if (ownDocument) {
              document.destroy();
            }
          }
        }
      })().then(finish, fail);
      // 自动关闭与主动关闭共享同一 rejection，避免事件回调产生未处理 Promise。
      void closing.catch((cause) =>
        report({
          code: "transport",
          message: "session cleanup failed",
          cause,
        }),
      );
      return closing;
    },
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) {
    abort();
  }
  void (async () => {
    try {
      if (closed) {
        return;
      }
      if (!externallyManaged) {
        timeout = setTimeout(() => {
          const error: HocuspocusSessionError = {
            code: "timeout",
            message: "initial synchronization timed out",
          };
          failReady(error);
          report(error);
          void session.close();
        }, options.syncTimeoutMs ?? 30_000);
      }
      await options.persistence?.load(document, controller.signal);
      controller.signal.throwIfAborted();
      await options.prepare?.({
        document,
        provider,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (provider.synced && provider.isAuthenticated) {
        options.validateScene(binding.getCanonical());
        initiallySynced = true;
        authorized = provider.authorizedScope === "read-write";
        update({
          status: "connected",
          synced: true,
          canEdit: authorized && permission,
        });
        settled = true;
        resolveReady();
      } else if (!externallyManaged) {
        await session.reconnect();
      }
      await ready;
      clearTimeout(timeout);
    } catch (cause) {
      if (!closed && state.status !== "rejected") {
        const error: HocuspocusSessionError = {
          code: "transport",
          message: "session initialization failed",
          cause,
        };
        failReady(error);
        report(error);
        await session.close().catch(() => {});
      }
    }
  })();
  return session;
};
