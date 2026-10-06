import { createExcalidrawCollaboration } from "@excalidraw/yjs";

import type { ExcalidrawSceneElement } from "@excalidraw/yjs";

import { createHocuspocusHeadlessSession } from "./session";

import type {
  ExcalidrawHocuspocusCollaborationController,
  ExcalidrawHocuspocusCollaborationOptions,
} from "./index";

export const createExcalidrawHocuspocusCollaboration = <
  TElement extends ExcalidrawSceneElement,
  TAsset extends { size: number; mimeType: string },
>(
  options: ExcalidrawHocuspocusCollaborationOptions<TElement, TAsset>,
): ExcalidrawHocuspocusCollaborationController<TElement, TAsset> => {
  const session = createHocuspocusHeadlessSession(options);
  const collaboration = (() => {
    try {
      return createExcalidrawCollaboration({
        document: session.document,
        state: {
          canEdit: false,
          synced: false,
          online: false,
          isCollaborating: true,
        },
        assets: options.assets,
        presence:
          typeof options.presence === "function"
            ? options.presence(session.provider)
            : options.presence,
        validateScene: options.validateScene,
        onError: (error, operation) => options.onSceneError?.(error, operation),
      });
    } catch (error) {
      void session.close();
      throw error;
    }
  })();
  const unsubscribe = session.subscribe((state) =>
    collaboration.updateState({
      canEdit: state.canEdit,
      synced: state.synced,
      online: state.status === "connected",
      isCollaborating: state.status !== "closed",
    }),
  );
  let closing: Promise<void> | undefined;
  const close: ExcalidrawHocuspocusCollaborationController<
    TElement,
    TAsset
  >["close"] = (options) => {
    if (!closing) {
      unsubscribe();
      collaboration.dispose();
      closing = session.close(options);
    }
    return closing;
  };
  return {
    ...collaboration,
    session,
    close,
    dispose: () => {
      void close();
    },
  };
};
