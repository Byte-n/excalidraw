import type {
  AssetTransport,
  ExcalidrawCollaborationController,
  ExcalidrawPresenceChannel,
  ExcalidrawSceneCommand,
  ExcalidrawSceneElement,
  SceneSnapshot,
  SceneBinding,
  SceneMutation,
} from "@excalidraw/yjs";

import type {
  HocuspocusProvider,
  HocuspocusProviderWebsocketConfiguration,
} from "@hocuspocus/provider";

import type * as Y from "yjs";

export type HocuspocusConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "rejected"
  | "closed";

export type HocuspocusSessionState = Readonly<{
  status: HocuspocusConnectionStatus;
  synced: boolean;
  canEdit: boolean;
  generation: number;
}>;

export type HocuspocusSessionError = Readonly<{
  code: "authentication" | "rejected" | "timeout" | "cancelled" | "transport";
  message: string;
  cause?: unknown;
  /** 连接丢失后，已发布的本地写入是否被远端接纳可能未知。 */
  outcome?: "unknown";
}>;

export type HocuspocusSessionToken =
  | string
  | { token: string; expiresAtMs?: number };
export type HocuspocusTokenProvider = (input: {
  room: string;
  signal: AbortSignal;
}) => HocuspocusSessionToken | Promise<HocuspocusSessionToken>;

export interface HocuspocusLocalPersistence {
  /** 宿主控制副本政策，加载完成不代表首次远端同步完成。 */
  load(document: Y.Doc, signal: AbortSignal): Promise<void>;
  close(): void | Promise<void>;
}

export type HocuspocusSessionResource =
  | {
      document?: never;
      provider?: never;
      ownership?: "owned";
      connectionManagedExternally?: false;
    }
  | {
      document: Y.Doc;
      provider?: never;
      ownership: "borrowed";
      connectionManagedExternally?: false;
    }
  | {
      document: Y.Doc;
      provider: HocuspocusProvider;
      ownership: "borrowed";
      /** 连接生命周期由 provider 拥有者管理，本 session 只管理场景门控与监听。 */
      connectionManagedExternally?: boolean;
    };

export type HocuspocusHeadlessSessionOptions<
  TElement extends ExcalidrawSceneElement,
  TAsset,
> = HocuspocusSessionResource & {
  url: string;
  /** 完整 room 名由宿主解析，不解释页面、epoch 或业务命名。 */
  room: string;
  token: HocuspocusTokenProvider;
  WebSocketPolyfill?: HocuspocusProviderWebsocketConfiguration["WebSocketPolyfill"];
  signal?: AbortSignal;
  syncTimeoutMs?: number;
  persistence?: HocuspocusLocalPersistence;
  /** 首次同步后的普通断线允许本地编辑；暂停认证或拒绝仍关闭门控。 */
  allowOfflineEditing?: boolean;
  /** 仅新建且未同步的空文档延后 editor 初始接纳，首次同步仍完整校验。 */
  deferInitialSceneValidation?: boolean;
  validateScene(scene: SceneSnapshot<TElement, TAsset>): void;
  onError?(error: HocuspocusSessionError): void;
  /** 本地副本加载后、首次网络接入前的宿主初始化；不持有连接。 */
  prepare?(input: {
    document: Y.Doc;
    provider: HocuspocusProvider;
    signal: AbortSignal;
  }): void | Promise<void>;
  /** 宿主解析业务 stateless 协议，并调用 session 的权限/拒绝/恢复入口。 */
  onStateless?(payload: string): void;
  onAuthenticationFailed?(
    reason: string,
  ): "retry" | "pause" | "reject" | "close";
};

export interface HocuspocusHeadlessSession<
  TElement extends ExcalidrawSceneElement,
  TAsset,
> {
  readonly document: Y.Doc;
  readonly provider: HocuspocusProvider;
  /** 唯一场景 binding；session 管理 gate 与释放，browser controller 只借用。 */
  readonly binding: SceneBinding<TElement, TAsset>;
  /** 首次同步只解除本地编辑门控，不构成远端写入 ACK。 */
  ready: Promise<void>;
  getState(): HocuspocusSessionState;
  subscribe(listener: (state: HocuspocusSessionState) => void): () => void;
  getScene(): SceneSnapshot<TElement, TAsset>;
  applyCommand(command: ExcalidrawSceneCommand<TElement, TAsset>): string[];
  mutate(input: {
    mutations: readonly SceneMutation<TElement>[];
    assets?: Readonly<Record<string, TAsset>>;
  }): string[];
  setPermission(canEdit: boolean): void;
  reject(error: HocuspocusSessionError): void;
  /** 暂停发送及编辑，保留副本与资源，宿主恢复鉴权后 reconnect。 */
  suspend(): void;
  /** 普通网络断线，离线编辑政策由 allowOfflineEditing 控制。 */
  disconnect(): void;
  /** 恢复本地认证 gate；不连接、续签或改变借用 provider。 */
  resume(): void;
  reconnect(): Promise<void>;
  refreshToken(): Promise<void>;
  /** 幂等；仅销毁 owned 文档和 provider，释放自身监听与持久化适配。 */
  close(options?: {
    preserve?(document: Y.Doc): void | Promise<void>;
  }): Promise<void>;
}

export type CreateHocuspocusHeadlessSession = <
  TElement extends ExcalidrawSceneElement,
  TAsset,
>(
  options: HocuspocusHeadlessSessionOptions<TElement, TAsset>,
) => HocuspocusHeadlessSession<TElement, TAsset>;

export type ExcalidrawHocuspocusCollaborationOptions<
  TElement extends ExcalidrawSceneElement,
  TAsset extends { size: number; mimeType: string },
> = HocuspocusHeadlessSessionOptions<TElement, TAsset> & {
  assets: AssetTransport<TAsset>;
  presence:
    | ExcalidrawPresenceChannel
    | ((provider: HocuspocusProvider) => ExcalidrawPresenceChannel);
  onSceneError?(
    error: unknown,
    operation: "restore" | "publish" | "command",
  ): void;
};

export type ExcalidrawHocuspocusCollaborationController<
  TElement extends ExcalidrawSceneElement,
  TAsset extends { size: number; mimeType: string },
> = ExcalidrawCollaborationController<TElement, TAsset> & {
  readonly session: HocuspocusHeadlessSession<TElement, TAsset>;
  close(options?: {
    preserve?(document: Y.Doc): void | Promise<void>;
  }): Promise<void>;
};

export type CreateExcalidrawHocuspocusCollaboration = <
  TElement extends ExcalidrawSceneElement,
  TAsset extends { size: number; mimeType: string },
>(
  options: ExcalidrawHocuspocusCollaborationOptions<TElement, TAsset>,
) => ExcalidrawHocuspocusCollaborationController<TElement, TAsset>;

export { createHocuspocusHeadlessSession } from "./session";
export { createExcalidrawHocuspocusCollaboration } from "./collaboration";
