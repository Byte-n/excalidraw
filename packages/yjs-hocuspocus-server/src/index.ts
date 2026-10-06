import type { ExcalidrawSceneElement, SceneSnapshot } from "@excalidraw/yjs";

import type { Connection, Extension } from "@hocuspocus/server";

import type * as Y from "yjs";

export type CanvasHocuspocusHooks<TContext> = Pick<
  Extension<TContext>,
  | "onLoadDocument"
  | "beforeSync"
  | "beforeHandleAwareness"
  | "beforeHandleMessage"
  | "afterHandleMessage"
  | "onChange"
  | "onStoreDocument"
  | "beforeUnloadDocument"
  | "afterUnloadDocument"
> & {
  flush(room: string): Promise<void>;
  snapshot(room: string): Promise<void>;
  release(room: string): Promise<void>;
  /** 旧 epoch 不再接纳或落盘；不能替代 repository 的原子 fence 检查。 */
  invalidate(room: string): void;
};

export interface CanvasRoom<TFence = unknown> {
  name: string;
  /** epoch、多实例锁和共享传播由宿主提供；本包仅串行化本进程更新。 */
  fence: TFence;
}

export interface CanvasPersistenceUpdate {
  sequence: number;
  update: Uint8Array;
  origin: unknown;
}

export interface CanvasRepository<TFence = unknown> {
  load(room: CanvasRoom<TFence>): Promise<readonly Uint8Array[]>;
  /** 成功后方可移除待写队列；宿主应原子检查 fence。 */
  append(
    room: CanvasRoom<TFence>,
    updates: readonly CanvasPersistenceUpdate[],
  ): Promise<void>;
  /** 仅压缩 snapshot 已包含的增量，不能删除 throughSequence 之后的 WAL。 */
  snapshot(
    room: CanvasRoom<TFence>,
    input: { update: Uint8Array; throughSequence: number },
  ): Promise<void>;
  release(room: CanvasRoom<TFence>): Promise<void>;
}

export interface CanvasUpdateContext<TContext, TActor, TFence = unknown> {
  room: CanvasRoom<TFence>;
  /** 远端身份由已认证连接解析，不从 Yjs transaction origin 读取。 */
  actor: TActor;
  connection: Connection<TContext>;
  origin: unknown;
  update: Uint8Array;
}

export interface CanvasValidator<
  TElement extends ExcalidrawSceneElement,
  TAsset,
  TContext,
  TActor,
  TFence = unknown,
> {
  /** 场景 schema、版本、预算和关系政策由宿主定义。 */
  validateScene(scene: SceneSnapshot<TElement, TAsset>): void;
  validateTransition(input: {
    before: SceneSnapshot<TElement, TAsset>;
    candidate: SceneSnapshot<TElement, TAsset>;
    context: CanvasUpdateContext<TContext, TActor, TFence>;
  }): void | Promise<void>;
  authorizeAssets(input: {
    candidate: SceneSnapshot<TElement, TAsset>;
    context: CanvasUpdateContext<TContext, TActor, TFence>;
  }): void | Promise<void>;
}

export interface CanvasHocuspocusHooksOptions<
  TElement extends ExcalidrawSceneElement,
  TAsset,
  TContext,
  TActor,
  TFence = unknown,
> {
  resolveRoom(name: string): CanvasRoom<TFence> | Promise<CanvasRoom<TFence>>;
  repository: CanvasRepository<TFence>;
  /** 额外持久化根仍必须为 Map，字段内容由宿主 validateDocument 校验。 */
  extraRootMaps?: readonly string[];
  initialize?(document: Y.Doc, room: CanvasRoom<TFence>): void | Promise<void>;
  validateDocument?(document: Y.Doc, room: CanvasRoom<TFence>): void;
  readScene?(document: Y.Doc): SceneSnapshot<TElement, TAsset>;
  /** 空闲 WAL 刷新定时器只负责本进程；失败保队列等待下一次 flush/store/release。 */
  flushIntervalMs?: number;
  validator: CanvasValidator<TElement, TAsset, TContext, TActor, TFence>;
  resolveActor(connection: Connection<TContext>): TActor;
  /** 每次接纳前重新检查，异步资产授权完成后再次检查避免失权窗口。 */
  authorize(
    context: CanvasUpdateContext<TContext, TActor, TFence>,
  ): void | Promise<void>;
  validateAwareness(input: {
    room: CanvasRoom<TFence>;
    connection: Connection<TContext> | undefined;
    states: Map<number, Record<string, unknown>>;
    origin: unknown;
  }): void | Promise<void>;
  /** 拒绝协议及可观察日志由宿主处理；回调不替代 hook 抛错。 */
  onRejected?(input: {
    context: CanvasUpdateContext<TContext, TActor, TFence>;
    error: unknown;
  }): void | Promise<void>;
  onAccepted?(input: {
    room: CanvasRoom<TFence>;
    document: Y.Doc;
    update: Uint8Array;
    origin: unknown;
  }): void | Promise<void>;
  onError?(input: {
    room: string;
    operation: "change" | "accepted" | "flush" | "snapshot" | "release";
    error: unknown;
  }): void;
  /** 宿主可转换为自身可识别的 hook 错误；原始业务错误传给 onRejected。 */
  mapError?(error: unknown, reason: string): Error;
}

export type CreateCanvasHocuspocusHooks = <
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
) => CanvasHocuspocusHooks<TContext>;

export { createCanvasHocuspocusHooks, CanvasHookError } from "./hooks";
