import type {
  AppState,
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";

import { createSceneBinding } from "./binding";
import { ExcalidrawSceneSession } from "./excalidraw-scene-session";
import { orderExcalidrawSceneElements } from "./scene-projection";

import type {
  ExcalidrawSceneController,
  ExcalidrawSceneControllerOptions,
  ExcalidrawSceneElement,
} from "./excalidraw-scene-types";

const interactionIds = <TElement extends ExcalidrawSceneElement>(
  state: AppState,
  elements: readonly TElement[],
) => {
  const ids = new Set<string>();
  if (
    state.selectedElementsAreBeingDragged ||
    state.isResizing ||
    state.isRotating
  ) {
    for (const [id, selected] of Object.entries(state.selectedElementIds)) {
      if (selected) {
        ids.add(id);
      }
    }
  }
  if (state.editingTextElement) {
    ids.add(state.editingTextElement.id);
  }
  // 容器成员和绑定文字随所选元素一起变化，同属交互保护集合。
  let expanded = true;
  while (expanded && ids.size) {
    expanded = false;
    for (const element of elements) {
      const parent = element.containerRef?.elementId ?? element.containerId;
      if (!ids.has(element.id) && parent && ids.has(parent)) {
        ids.add(element.id);
        expanded = true;
      }
      if (ids.has(element.id)) {
        for (const bound of element.boundElements ?? []) {
          if (bound.type === "text" && !ids.has(bound.id)) {
            ids.add(bound.id);
            expanded = true;
          }
        }
      }
    }
  }
  return ids;
};

/** 场景控制器只持有编辑器绑定和自己的显示状态，不拥有外部文档或资源服务。 */
export const createExcalidrawSceneController = <
  TElement extends ExcalidrawSceneElement,
  TAsset extends { size: number; mimeType: string },
>(
  options: ExcalidrawSceneControllerOptions<TElement, TAsset>,
): ExcalidrawSceneController<TElement, TAsset> => {
  const document = options.document;
  let state = { ...options.state };
  let hasSynced = state.synced;
  let api: ExcalidrawImperativeAPI | null = null;
  let disposed = false;
  let failed = false;
  let initialized = false;
  let sceneApplied = false;
  let applyingScene = false;
  let receivedScene: string | null = null;
  let generation = 0;
  let attachmentGeneration = 0;
  let editorModule: typeof import("@excalidraw/excalidraw") | null = null;
  let editorModulePromise: Promise<
    typeof import("@excalidraw/excalidraw")
  > | null = null;
  let protectedIds = new Set<string>();
  const overlay = new Map<string, TElement>();
  const listeners = new Set<() => void>();
  let readOnly = true;

  if (
    options.borrowedBinding &&
    options.borrowedBinding.document !== document
  ) {
    throw new Error("borrowed binding must match controller document");
  }
  const ownBinding = !options.borrowedBinding;
  const binding =
    options.borrowedBinding ??
    createSceneBinding<TElement, TAsset>({
      doc: document,
      adapter: {
        sort: orderExcalidrawSceneElements,
        validateCanonical: options.validateScene,
        tombstone: (element) => ({
          ...structuredClone(element),
          isDeleted: true,
          version: element.version + 1,
          versionNonce: element.versionNonce + 1,
        }),
      },
      onRemoteSceneChange: () => refreshScene(),
    });
  const unsubscribeBinding =
    options.borrowedBinding?.subscribeRemoteSceneChange(() => refreshScene());
  const session = new ExcalidrawSceneSession(binding);
  const writable = () =>
    !disposed &&
    !failed &&
    !!api &&
    state.canEdit &&
    hasSynced &&
    initialized &&
    sceneApplied;
  const refreshGate = () => {
    const next = !writable();
    if (ownBinding) {
      binding.setGate({
        initialized: initialized && sceneApplied && !failed && !!api,
        canEdit: state.canEdit,
        synced: hasSynced,
        generation,
      });
    }
    if (readOnly !== next) {
      readOnly = next;
      for (const listener of listeners) {
        listener();
      }
    }
  };
  const fail = (error: unknown, operation: "restore" | "publish") => {
    failed = true;
    refreshGate();
    options.onError(error, operation);
  };
  const getScene = () => {
    if (disposed || document.isDestroyed) {
      throw new Error("画板场景会话已销毁");
    }
    const scene = binding.getCanonical();
    options.validateScene(scene);
    return scene;
  };
  // 宿主验证过的 JSON 与 editor 的内部品牌/联合类型无法结构对齐，转换仅限该边界。
  const editorElements = (editor: ExcalidrawImperativeAPI) =>
    editor.getSceneElementsIncludingDeleted() as unknown as readonly TElement[];
  const fingerprint = (editor: ExcalidrawImperativeAPI) =>
    JSON.stringify({
      elements: editor.getSceneElementsIncludingDeleted(),
      files: editor.getFiles(),
    });
  const current = (editor: ExcalidrawImperativeAPI, epoch: number) =>
    !disposed && api === editor && generation === epoch;

  const resolveSceneFiles = () => {
    const editor = api;
    const coordinator = options.assets;
    const primitives = editorModule;
    if (!editor || !coordinator || !primitives) {
      return;
    }
    const epoch = generation;
    const scene = getScene();
    const ids = new Set(
      scene.elements
        .filter((element) => element.type === "image" && !element.isDeleted)
        .map((element) => element.fileId),
    );
    ids.forEach((id) => {
      if (!id || !scene.assets[id]) {
        return;
      }
      const setStatus = (status: "saved" | "error") => {
        if (!current(editor, epoch)) {
          return;
        }
        const elements = editor.getSceneElementsIncludingDeleted();
        const changed = elements.map((element) =>
          element.type === "image" &&
          element.fileId === id &&
          element.status !== status
            ? { ...element, status, version: element.version + 1 }
            : element,
        );
        if (changed.every((element, index) => element === elements[index])) {
          return;
        }
        applyingScene = true;
        try {
          editor.updateScene({
            elements: changed,
            captureUpdate: primitives.CaptureUpdateAction.NEVER,
          });
        } finally {
          applyingScene = false;
        }
        receivedScene = fingerprint(editor);
      };
      void coordinator
        .resolve(id, scene.assets[id])
        .then((file) => {
          if (!current(editor, epoch)) {
            return;
          }
          // 文件服务已验证 MIME 和标识，资源协调器的普通字符串对应 editor 内部品牌。
          editor.addFiles([file as BinaryFileData]);
          setStatus("saved");
        })
        .catch((error: unknown) => {
          if (!current(editor, epoch)) {
            return;
          }
          try {
            setStatus("error");
          } catch (restoreError) {
            fail(restoreError, "restore");
          }
        });
    });
  };

  const applyScene = (immediately = false) => {
    const editor = api;
    const primitives = editorModule;
    if (!editor || !initialized || disposed || !primitives) {
      return;
    }
    getScene();
    const projected = [
      ...session.project(editorElements(editor), protectedIds),
      ...structuredClone([...overlay.values()]),
    ];
    applyingScene = true;
    sceneApplied = false;
    try {
      // 场景 JSON 保留完整元素字段，由公开 restore 生成 editor 的品牌结构。
      const elements = primitives.restoreElements(
        projected as unknown as Parameters<
          typeof primitives.restoreElements
        >[0],
        null,
        // 缺省尺寸的文本只在显示副本中测量；applyScene 受 applyingScene
        // 保护，不会因首次渲染触发 canonical 写回。
        { repairBindings: true, refreshDimensions: true },
      );
      editor.updateScene({
        elements,
        captureUpdate: immediately
          ? primitives.CaptureUpdateAction.IMMEDIATELY
          : primitives.CaptureUpdateAction.NEVER,
      });
      session.accept(editorElements(editor), protectedIds);
      receivedScene = fingerprint(editor);
      sceneApplied = true;
    } finally {
      applyingScene = false;
      refreshGate();
    }
    resolveSceneFiles();
  };
  function refreshScene() {
    if (disposed || !api || !initialized || failed) {
      return;
    }
    try {
      applyScene();
    } catch (error) {
      fail(error, "restore");
    }
  }
  const assertWritable = () => {
    if (!writable()) {
      throw new Error("画板尚未就绪");
    }
  };
  const uploadOverlay = () => {
    const editor = api;
    const coordinator = options.assets;
    if (!editor || !coordinator || !writable() || !state.online) {
      return;
    }
    const epoch = generation;
    for (const element of overlay.values()) {
      if (element.isDeleted || !element.fileId) {
        continue;
      }
      const fileId = element.fileId;
      const file = editor.getFiles()[fileId];
      if (!file) {
        continue;
      }
      void coordinator
        .ensureUploaded(fileId, file.dataURL)
        .then((asset) => {
          if (!current(editor, epoch) || !writable()) {
            return;
          }
          const latest = [...overlay.values()].filter(
            (value) => value.fileId === fileId && !value.isDeleted,
          );
          if (!latest.length) {
            return;
          }
          binding.applyCommand({
            elements: latest.map((value) => ({ ...value, status: "saved" })),
            assets: { [fileId]: asset },
          });
          for (const value of latest) {
            overlay.delete(value.id);
          }
          refreshScene();
        })
        .catch((error: unknown) => {
          if (!current(editor, epoch)) {
            return;
          }
          const status =
            error instanceof DOMException && error.name === "AbortError"
              ? "pending"
              : "error";
          for (const value of overlay.values()) {
            if (value.fileId === fileId && !value.isDeleted) {
              value.status = status;
            }
          }
          refreshScene();
        });
    }
  };
  const onChange: NonNullable<ExcalidrawProps["onChange"]> = (
    elements,
    appState,
    files,
  ) => {
    const editor = api;
    if (!editor || disposed || failed || appState.isLoading || applyingScene) {
      return;
    }
    try {
      if (!initialized) {
        initialized = true;
        applyScene();
        uploadOverlay();
        return;
      }
      const incoming = JSON.stringify({ elements, files });
      if (incoming !== fingerprint(editor)) {
        return;
      }
      // editor 完整元素与宿主已接纳 JSON 仅有品牌类型差异，内部入口保持相同字段。
      const values = elements as unknown as readonly TElement[];
      const nextProtected = interactionIds(appState, values);
      if (
        incoming === receivedScene &&
        [...protectedIds].every((id) => nextProtected.has(id))
      ) {
        protectedIds = nextProtected;
        return;
      }
      if (!writable()) {
        return;
      }
      receivedScene = incoming;
      const previousProtected = protectedIds;
      const scene = getScene();
      for (const element of values) {
        if (
          element.type === "image" &&
          element.fileId &&
          !scene.assets[element.fileId]
        ) {
          overlay.set(element.id, structuredClone(element));
        }
      }
      session.publish(values);
      protectedIds = nextProtected;
      uploadOverlay();
      // 最终本地快照先发布，再让暂缓的远端值进入显示。
      if ([...previousProtected].some((id) => !nextProtected.has(id))) {
        applyScene();
      }
    } catch (error) {
      fail(error, "publish");
    }
  };
  try {
    if (!options.deferInitialSceneValidation || hasSynced) {
      getScene();
    }
  } catch (error) {
    // 初始副本非法时停止 owned 监听，保留原场景并由宿主呈现领域失败。
    unsubscribeBinding?.();
    if (ownBinding) {
      binding.dispose();
    }
    session.dispose();
    options.assets?.cancelPending();
    fail(error, "restore");
  }

  return {
    attach: (editor) => {
      if (disposed) {
        throw new Error("画板场景会话已销毁");
      }
      if (api !== editor) {
        generation++;
        attachmentGeneration++;
        api = editor;
        // 新文档绑定以自身 canonical 重建撤销边界，避免旧画板历史跨会话。
        editor.history.clear();
        initialized = false;
        sceneApplied = false;
        receivedScene = null;
        protectedIds.clear();
        refreshGate();
        if (!editor.getAppState().isLoading) {
          initialized = true;
          refreshScene();
        }
      }
      const epoch = attachmentGeneration;
      if (!editorModule) {
        editorModulePromise ??= import("@excalidraw/excalidraw");
        void editorModulePromise
          .then((module) => {
            if (disposed || api !== editor || attachmentGeneration !== epoch) {
              return;
            }
            editorModule = module;
            refreshScene();
            uploadOverlay();
          })
          .catch((error: unknown) => {
            if (!disposed && api === editor && attachmentGeneration === epoch) {
              fail(error, "restore");
            }
          });
      }
      let attached = true;
      return () => {
        if (!attached) {
          return;
        }
        attached = false;
        if (disposed || api !== editor || attachmentGeneration !== epoch) {
          return;
        }
        generation++;
        attachmentGeneration++;
        api = null;
        initialized = false;
        sceneApplied = false;
        protectedIds.clear();
        refreshGate();
      };
    },
    onChange,
    getReadOnly: () => readOnly,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateState: (next) => {
      if (disposed) {
        return;
      }
      const firstSync = !hasSynced && next.synced === true;
      hasSynced ||= next.synced === true;
      const wasOnline = state.online;
      const couldEdit = state.canEdit;
      state = { ...state, ...next };
      if (couldEdit && !state.canEdit) {
        generation++;
        options.assets?.cancelPending();
      }
      if (!state.online && wasOnline) {
        options.assets?.cancelPending();
      }
      refreshGate();
      if (firstSync) {
        refreshScene();
      }
      if (state.online && (!wasOnline || (!couldEdit && state.canEdit))) {
        uploadOverlay();
      }
    },
    applyCommand: (command) => {
      assertWritable();
      try {
        const ids = binding.applyCommand(command);
        for (const id of command.deleteIds ?? []) {
          overlay.delete(id);
        }
        applyScene(true);
        return ids;
      } catch (error) {
        options.onError(error, "command");
        throw error;
      }
    },
    prepareImportCommand: (command) => {
      assertWritable();
      const epoch = generation;
      const prepared = binding.prepareImportCommand(
        command,
        ownBinding ? epoch : binding.getGate().generation,
      );
      return {
        commit: () => {
          assertWritable();
          if (generation !== epoch) {
            throw new Error("画板导入会话已变化");
          }
          const ids = prepared.commit();
          for (const id of command.deleteIds ?? []) {
            overlay.delete(id);
          }
          applyScene(true);
          return ids;
        },
      };
    },
    getScene,
    getApi: () => api,
    refreshScene,
    retryFiles: () => {
      uploadOverlay();
      refreshScene();
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      generation++;
      api = null;
      refreshGate();
      unsubscribeBinding?.();
      if (ownBinding) {
        binding.dispose();
      }
      session.dispose();
      overlay.clear();
      listeners.clear();
    },
  };
};
