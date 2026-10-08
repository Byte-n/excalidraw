import {
  createSceneElement,
  type ExcalidrawSceneElement,
} from "@excalidraw/yjs";
import * as Y from "yjs";
import { z } from "zod";
import { vi } from "vitest";

import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";

import { createHocuspocusHeadlessSession } from "@excalidraw/yjs-hocuspocus-client";

import type { SceneSnapshot } from "@excalidraw/yjs";
import type { HocuspocusHeadlessSession } from "@excalidraw/yjs-hocuspocus-client";

const element = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    index: z.string().min(1),
    version: z.number().int().safe().positive(),
    versionNonce: z.number().int(),
    isDeleted: z.boolean(),
    x: z.number().finite(),
    y: z.number().finite(),
    angle: z.number().finite(),
    updated: z.number().finite(),
  })
  .passthrough();

/** 测试模拟外部连接管理器发布认证和同步事件。 */
class TestProvider extends HocuspocusProvider {
  synchronize() {
    this.emit("authenticated", { scope: "read-write" });
    this.emit("synced", { state: true });
  }
}

/** 使用真实 headless 会话与场景校验；测试不建立网络连接。 */
export const sessionFixture = () => {
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url: "ws://localhost:1234",
    autoConnect: false,
    WebSocketPolyfill: globalThis.WebSocket,
  });
  const provider = new TestProvider({
    name: "agent-tool-test",
    document: doc,
    websocketProvider: socket,
  });
  const session = createHocuspocusHeadlessSession<
    ExcalidrawSceneElement,
    unknown
  >({
    url: "ws://localhost:1234",
    room: "agent-tool-test",
    token: () => "test-token",
    document: doc,
    provider,
    ownership: "borrowed",
    connectionManagedExternally: true,
    validateScene: (scene) => {
      for (const value of scene.elements) {
        element.parse(value);
      }
    },
  });
  provider.synchronize();
  let disposed = false;
  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    await session.close();
    provider.destroy();
    socket.destroy();
    doc.destroy();
  };
  return {
    doc,
    binding: session.binding,
    session,
    dispose,
    synchronize: () => provider.synchronize(),
  };
};
export const rectangle = () =>
  createSceneElement({
    type: "composite_shape",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    shape: { id: "rectangle", schemaVersion: 1 },
  });

/** 替换底层 canonical 数据，保留真实 session 的快照校验路径。 */
export const withScene = (
  session: HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>,
  scene: SceneSnapshot<ExcalidrawSceneElement, unknown>,
) => {
  vi.spyOn(session.binding, "getCanonical").mockReturnValue(scene);
  return session;
};
