import type * as Y from "yjs";

export type YjsSceneElement = Readonly<{ id: string }> &
  Readonly<Record<string, unknown>>;

export type YjsSceneBinding<TElement extends YjsSceneElement> = Readonly<{
  /** 按 map 顺序读取当前 canonical 元素快照。 */
  getElements(): readonly TElement[];
  /** 在一次 Y.Doc 事务中应用完整元素快照。 */
  transact(elements: readonly TElement[]): void;
  /** 释放绑定自身持有的监听。 */
  dispose(): void;
}>;

export type CreateYjsSceneBindingOptions<TElement extends YjsSceneElement> = {
  doc: Y.Doc;
  mapName?: string;
  origin?: unknown;
  encode?: (element: TElement) => unknown;
  decode?: (value: unknown) => TElement;
};

const defaultEncode = <TElement extends YjsSceneElement>(element: TElement) =>
  element;
const defaultDecode = <TElement extends YjsSceneElement>(value: unknown) =>
  value as TElement;

/**
 * 提供宿主无关的 Y.Doc 基础桥，供场景与会话能力消费。
 * 绑定只管理自身资源，不销毁宿主持有的文档。
 */
export const createYjsSceneBinding = <TElement extends YjsSceneElement>({
  doc,
  mapName = "elements",
  origin,
  encode = defaultEncode,
  decode = defaultDecode,
}: CreateYjsSceneBindingOptions<TElement>): YjsSceneBinding<TElement> => {
  const elements = doc.getMap<unknown>(mapName);
  let disposed = false;

  const getElements = (): readonly TElement[] =>
    [...elements.values()].map((value) => decode(value));

  const transact = (nextElements: readonly TElement[]) => {
    if (disposed) {
      throw new Error("Yjs scene binding is disposed");
    }
    doc.transact(() => {
      const nextIds = new Set(nextElements.map((element) => element.id));
      for (const id of elements.keys()) {
        if (!nextIds.has(id)) {
          elements.delete(id);
        }
      }
      for (const element of nextElements) {
        elements.set(element.id, encode(element));
      }
    }, origin);
  };

  return {
    getElements,
    transact,
    dispose: () => {
      disposed = true;
    },
  };
};

export type { Y };
export * from "./types";
export { createSceneBinding } from "./binding";
export { createSceneSession } from "./session";
export { createAssetCoordinator } from "./assets";
export {
  createFollowGraph,
  presenceViewportBounds,
  shouldUnfollow,
} from "./presence";
export { createPresenceThrottle } from "./presence-throttle";
export type { AssetBinary, AssetCoordinator, AssetTransport } from "./assets";
export {
  orderExcalidrawSceneElements,
  projectExcalidrawDisplayElements,
} from "./scene-projection";
export type {
  ExcalidrawSceneElement,
  ExcalidrawSceneCommand,
} from "./excalidraw-scene-types";
export { createExcalidrawCollaboration } from "./collaboration";
export type {
  CreateExcalidrawCollaborationOptions,
  ExcalidrawCollaborationController,
  ExcalidrawCollaborationState,
  ExcalidrawPresenceBounds,
  ExcalidrawPresenceChannel,
  ExcalidrawPresencePeer,
  ExcalidrawPresenceState,
} from "./collaboration-types";

export { createExcalidrawSceneCommands } from "./scene-commands";
export type {
  ExcalidrawSceneCommands,
  SceneMutation,
  SceneConnectionEndpoint,
} from "./scene-commands";
export { YjsSceneError } from "./errors";
export type { YjsSceneErrorCode } from "./errors";
export { createCanvasSceneCommands } from "./canvas-scene-commands";
export type {
  CanvasSceneOperation,
  CanvasOperationResult,
  CanvasLocalReceipt,
  CanvasSceneCommandInput,
  CanvasSceneCommands,
} from "./canvas-scene-commands";
export { BASE_SHAPE_IDS, ARROWHEAD_VALUES } from "@excalidraw/element";
export type { AnyArrowhead, BaseShapeId } from "@excalidraw/element/types";
export {
  createSceneElement,
  createSceneTextElement,
  createSceneLineElement,
  createSceneArrowElement,
  createSceneConnectionEndpoint,
  setCustomTextMetricsProvider,
} from "./element-factory";
