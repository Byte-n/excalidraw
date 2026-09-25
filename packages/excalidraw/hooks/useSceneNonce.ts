import { useCallback, useSyncExternalStore } from "react";

import type { Scene } from "@excalidraw/element";

export const useSceneNonce = (scene: Scene) => {
  const subscribe = useCallback(
    (onUpdate: () => void) => {
      const unsubscribe = scene.onUpdate(onUpdate);
      return () => {
        // Scene.destroy clears its callbacks before React unmounts the sidebar.
        try {
          unsubscribe();
        } catch {
          // Already removed by Scene.destroy.
        }
      };
    },
    [scene],
  );
  const getSnapshot = useCallback(() => scene.getSceneNonce(), [scene]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
