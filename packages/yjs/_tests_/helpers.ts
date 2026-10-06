import { createSceneBinding } from "../src/binding";
import { orderExcalidrawSceneElements } from "../src/scene-projection";

import type * as Y from "yjs";

import type {
  ExcalidrawSceneCommand,
  ExcalidrawSceneElement,
} from "../src/excalidraw-scene-types";
import type {
  ExcalidrawPresenceChannel,
  ExcalidrawPresencePeer,
  ExcalidrawPresenceState,
} from "../src/collaboration-types";
import type { SceneSnapshot } from "../src/types";

export type TestAsset = {
  size: number;
  mimeType: string;
  storageFileId?: string;
};
export const element = (
  id = "a",
  x = 0,
  overrides: Partial<ExcalidrawSceneElement> = {},
): ExcalidrawSceneElement => ({
  id,
  type: "composite_shape",
  shape: { id: "rectangle", schemaVersion: 1 },
  x,
  y: 0,
  width: 100,
  height: 80,
  angle: 0,
  index: "a0",
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  seed: 1,
  groupIds: [],
  boundElements: null,
  updated: 0,
  created: 0,
  link: null,
  locked: false,
  roundness: null,
  ...overrides,
});

/** 测试模拟宿主业务接纳，只校验用例依赖的不变量，不复制业务 schema。 */
export const validateScene = (
  scene: SceneSnapshot<ExcalidrawSceneElement, TestAsset>,
) => {
  for (const value of scene.elements) {
    if (!value.id || !value.index || !Number.isFinite(value.x)) {
      throw new Error("场景校验失败");
    }
  }
};

export class TestSceneBridge {
  readonly binding;
  constructor(document: Y.Doc, _schemaVersion = 2, onRemote?: () => void) {
    this.binding = createSceneBinding<ExcalidrawSceneElement, TestAsset>({
      doc: document,
      adapter: {
        sort: orderExcalidrawSceneElements,
        validateCanonical: validateScene,
      },
      onRemoteSceneChange: onRemote,
    });
    this.binding.setGate({ initialized: true, synced: true, canEdit: true });
  }
  getScene() {
    return this.binding.getCanonical();
  }
  applyCommand(
    command: ExcalidrawSceneCommand<ExcalidrawSceneElement, TestAsset>,
  ) {
    return this.binding.applyCommand(command);
  }
  applyLocalScene({
    elements,
  }: {
    elements: readonly ExcalidrawSceneElement[];
  }) {
    return this.applyCommand({ elements });
  }
  removeElement(id: string) {
    this.applyCommand({ elements: [], deleteIds: [id] });
  }
  dispose() {
    this.binding.dispose();
  }
}

export const presenceChannel = (sessionId = "self") => {
  const published: (ExcalidrawPresenceState | null)[] = [];
  const listeners = new Set<
    (peers: readonly ExcalidrawPresencePeer[]) => void
  >();
  let remote: readonly ExcalidrawPresencePeer[] = [];
  const channel: ExcalidrawPresenceChannel = {
    sessionId,
    publish: vi.fn((state) => published.push(state)),
    subscribe: (listener) => {
      listeners.add(listener);
      listener(remote);
      return () => listeners.delete(listener);
    },
    dispose: vi.fn(() => listeners.clear()),
  };
  return {
    channel,
    published,
    listeners,
    receive: (peers: readonly ExcalidrawPresencePeer[]) => {
      remote = peers;
      for (const listener of listeners) {
        listener(peers);
      }
    },
  };
};

export const peer = (
  sessionId = "peer",
  next: Partial<ExcalidrawPresenceState> = {},
): ExcalidrawPresencePeer => ({
  sessionId,
  user: {
    id: "same-user",
    name: "协作者",
    color: {
      background: sessionId === "peer" ? "#ff0000" : "#0000ff",
      stroke: "#000000",
    },
  },
  state: {
    pointer: null,
    button: "up",
    selectedElementIds: [],
    idleState: "ACTIVE",
    followTarget: null,
    bounds: null,
    ...next,
  },
});
