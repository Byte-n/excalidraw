import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type {
  ExcalidrawCollaboration,
  ExcalidrawCollaborationPresentation,
  ExcalidrawImperativeAPI,
} from "./types";

/** 绑定与订阅分开处理，兼容 API 先于父组件 effect 到达及 StrictMode 重挂载。 */
export const useExcalidrawCollaboration = (
  collaboration: ExcalidrawCollaboration | undefined,
  ownerDocument: Document,
) => {
  const current = useRef({ collaboration, ownerDocument });
  current.current = { collaboration, ownerDocument };
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const binding = useRef<{
    collaboration: ExcalidrawCollaboration;
    api: ExcalidrawImperativeAPI;
    ownerDocument: Document;
    detach: () => void;
  } | null>(null);
  const [presentation, setPresentation] = useState<{
    collaboration: ExcalidrawCollaboration;
    snapshot: ExcalidrawCollaborationPresentation;
  } | null>(null);

  const detach = useCallback(() => {
    const previous = binding.current;
    binding.current = null;
    previous?.detach();
  }, []);

  const attach = useCallback(() => {
    const options = current.current;
    const previous = binding.current;
    if (
      previous?.collaboration === options.collaboration &&
      previous?.api === api.current &&
      previous?.ownerDocument === options.ownerDocument
    ) {
      return;
    }
    detach();
    if (options.collaboration && api.current) {
      binding.current = {
        collaboration: options.collaboration,
        api: api.current,
        ownerDocument: options.ownerDocument,
        detach: options.collaboration.attach(api.current, {
          ownerDocument: options.ownerDocument,
        }),
      };
    }
  }, [detach]);

  const onApi = useCallback(
    (value: ExcalidrawImperativeAPI | null) => {
      api.current = value;
      attach();
    },
    [attach],
  );

  useLayoutEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active || !collaboration) {
        return;
      }
      const snapshot = collaboration.getSnapshot();
      setPresentation((previous) =>
        previous?.collaboration === collaboration &&
        previous.snapshot === snapshot
          ? previous
          : { collaboration, snapshot },
      );
    };
    const unsubscribe = collaboration?.subscribe(refresh);
    attach();
    refresh();
    return () => {
      active = false;
      unsubscribe?.();
      detach();
    };
  }, [collaboration, ownerDocument, attach, detach]);

  return {
    onApi,
    presentation: collaboration
      ? presentation?.collaboration === collaboration
        ? presentation.snapshot
        : collaboration.getSnapshot()
      : null,
  };
};
