import type {
  ExcalidrawCollaborationPresentation,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { createAssetCoordinator } from "./assets";
import { ExcalidrawPresence } from "./excalidraw-presence";
import { createExcalidrawSceneController } from "./excalidraw-scene-controller";

import type {
  CreateExcalidrawCollaborationOptions,
  ExcalidrawCollaborationController,
} from "./collaboration-types";
import type { ExcalidrawSceneElement } from "./excalidraw-scene-types";

/** 统一管理 editor 协作；传输、认证及文档所有权始终属于宿主。 */
export const createExcalidrawCollaboration = <
  TElement extends ExcalidrawSceneElement,
  TAsset extends { size: number; mimeType: string },
>(
  options: CreateExcalidrawCollaborationOptions<TElement, TAsset>,
): ExcalidrawCollaborationController<TElement, TAsset> => {
  const assetCoordinator = createAssetCoordinator(options.assets);
  const scene = createExcalidrawSceneController({
    ...options,
    assets: assetCoordinator,
  });
  const listeners = new Set<() => void>();
  let disposed = false;
  let state = { ...options.state };
  let snapshot: ExcalidrawCollaborationPresentation = {
    isCollaborating: state.isCollaborating,
    readOnly: true,
    userToFollow: null,
  };
  const notify = (next: ExcalidrawCollaborationPresentation) => {
    if (
      snapshot.readOnly === next.readOnly &&
      snapshot.isCollaborating === next.isCollaborating &&
      snapshot.userToFollow === next.userToFollow
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };
  const presence = new ExcalidrawPresence(options.presence, (userToFollow) =>
    notify({ ...snapshot, userToFollow }),
  );
  const unsubscribeScene = scene.subscribe(() =>
    notify({ ...snapshot, readOnly: scene.getReadOnly() }),
  );
  let binding: {
    api: ExcalidrawImperativeAPI;
    ownerDocument: Document;
    detach(): void;
  } | null = null;
  let generation = 0;
  const detach = () => {
    const previous = binding;
    binding = null;
    generation++;
    previous?.detach();
  };
  return {
    ...scene,
    assetCoordinator,
    attach: (api, { ownerDocument }) => {
      if (disposed) {
        throw new Error("画板协作会话已销毁");
      }
      if (binding?.api !== api || binding?.ownerDocument !== ownerDocument) {
        detach();
        const detachScene = scene.attach(api);
        const detachPresence = presence.attach(api, ownerDocument);
        const online = () => {
          state.online = true;
          scene.updateState({ online: true });
        };
        const offline = () => {
          state.online = false;
          scene.updateState({ online: false });
        };
        ownerDocument.defaultView?.addEventListener("online", online);
        ownerDocument.defaultView?.addEventListener("offline", offline);
        binding = {
          api,
          ownerDocument,
          detach: () => {
            detachScene();
            detachPresence();
            assetCoordinator.cancelPending();
            ownerDocument.defaultView?.removeEventListener("online", online);
            ownerDocument.defaultView?.removeEventListener("offline", offline);
          },
        };
      }
      const epoch = generation;
      return () => {
        if (epoch === generation) {
          detach();
        }
      };
    },
    onChange: (...args) => {
      if (disposed || !binding) {
        return;
      }
      presence.selection(args[1].selectedElementIds);
      scene.onChange(...args);
      presence.render();
    },
    onPointerUpdate: (payload) => presence.onPointerUpdate(payload),
    onScrollChange: (...args) => presence.onScrollChange(...args),
    onUserFollow: (payload) => presence.onUserFollow(payload),
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (disposed) {
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateState: (next) => {
      if (disposed) {
        return;
      }
      state = { ...state, ...next };
      scene.updateState(next);
      notify({
        ...snapshot,
        readOnly: scene.getReadOnly(),
        isCollaborating: state.isCollaborating,
      });
    },
    cancelFollow: () => presence.cancelFollow(),
    dispose: () => {
      if (disposed) {
        return;
      }
      detach();
      disposed = true;
      unsubscribeScene();
      scene.dispose();
      presence.dispose();
      assetCoordinator.dispose();
      listeners.clear();
    },
  };
};
