import type {
  ExcalidrawCollaboration,
  ExcalidrawCollaborationPresentation,
} from "@excalidraw/excalidraw/types";

import type { AssetCoordinator, AssetTransport } from "./assets";
import type {
  ExcalidrawSceneController,
  ExcalidrawSceneControllerOptions,
  ExcalidrawSceneElement,
  ExcalidrawSceneState,
} from "./excalidraw-scene-types";

export type ExcalidrawPresenceBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};
export type ExcalidrawPresenceState = {
  pointer: { x: number; y: number; tool: "pointer" | "laser" } | null;
  button: "up" | "down";
  selectedElementIds: string[];
  idleState: "ACTIVE" | "IDLE" | "AWAY";
  followTarget: string | null;
  bounds: ExcalidrawPresenceBounds | null;
};
export type ExcalidrawPresencePeer = {
  sessionId: string;
  user: {
    id: string;
    name: string;
    color: { background: string; stroke: string };
  };
  state: ExcalidrawPresenceState;
};

/** 身份和输入字段由宿主的协作服务入口校验，不传输编辑器内部结构。 */
export interface ExcalidrawPresenceChannel {
  readonly sessionId: string;
  publish(state: ExcalidrawPresenceState | null): void;
  subscribe(
    listener: (peers: readonly ExcalidrawPresencePeer[]) => void,
  ): () => void;
  dispose(): void;
}

export type ExcalidrawCollaborationState = ExcalidrawSceneState & {
  isCollaborating: boolean;
};
export type CreateExcalidrawCollaborationOptions<
  TElement extends ExcalidrawSceneElement,
  TAsset extends { size: number; mimeType: string },
> = Omit<
  ExcalidrawSceneControllerOptions<TElement, TAsset>,
  "assets" | "state"
> & {
  assets: AssetTransport<TAsset>;
  state: ExcalidrawCollaborationState;
  presence: ExcalidrawPresenceChannel;
};

export type ExcalidrawCollaborationController<
  TElement extends ExcalidrawSceneElement,
  TAsset extends { size: number; mimeType: string },
> = ExcalidrawCollaboration &
  Omit<
    ExcalidrawSceneController<TElement, TAsset>,
    "attach" | "updateState" | "subscribe"
  > & {
    updateState(state: Partial<ExcalidrawCollaborationState>): void;
    cancelFollow(): void;
    readonly assetCoordinator: AssetCoordinator<TAsset>;
    getSnapshot(): ExcalidrawCollaborationPresentation;
  };
