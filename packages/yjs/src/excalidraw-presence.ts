import { UserIdleState } from "@excalidraw/common";

import type {
  Collaborator,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  SocketId,
  UserToFollow,
} from "@excalidraw/excalidraw/types";

import {
  createFollowGraph,
  presenceViewportBounds,
  shouldUnfollow,
} from "./presence";
import { createPresenceThrottle } from "./presence-throttle";

import type {
  ExcalidrawPresenceBounds,
  ExcalidrawPresenceChannel,
  ExcalidrawPresencePeer,
  ExcalidrawPresenceState,
} from "./collaboration-types";

type PresenceUserFollow = NonNullable<ExcalidrawProps["onUserFollow"]>;
type PresenceScrollChange = NonNullable<ExcalidrawProps["onScrollChange"]>;
type PresencePointerUpdate = NonNullable<ExcalidrawProps["onPointerUpdate"]>;
export type ExcalidrawPresenceEditor = {
  isDestroyed?: boolean;
  getAppState?: () => {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    zoom: { value: number };
  };
  setViewport?: ExcalidrawImperativeAPI["setViewport"];
  updateScene: (scene: { collaborators: Map<SocketId, Collaborator> }) => void;
  getSceneElements: () => readonly { id: string }[];
};
const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
const validBounds = (bounds: ExcalidrawPresenceBounds) => {
  const { minX, minY, maxX, maxY } = bounds;
  return (
    [
      minX,
      minY,
      maxX,
      maxY,
      maxX - minX,
      maxY - minY,
      maxX + minX,
      maxY + minY,
    ].every(Number.isFinite) &&
    minX < maxX &&
    minY < maxY
  );
};

/** 临时状态仅经 awareness 发布；编辑器选区和指针绝不进入场景写入通道。 */
export class ExcalidrawPresence {
  private readonly state: ExcalidrawPresenceState = {
    pointer: null,
    button: "up",
    selectedElementIds: [],
    idleState: "ACTIVE",
    followTarget: null,
    bounds: null,
  };
  private selectedElementIds: string[] = [];
  private remote: readonly ExcalidrawPresencePeer[] = [];
  private lastActivity = performance.now();
  private readonly throttle = createPresenceThrottle(33, () => this.flush());
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private rendering = false;
  private renderedApi: ExcalidrawPresenceEditor | null = null;
  private renderedState: string | null = null;

  private appliedViewport: string | null = null;
  private reconciling = false;
  private target: UserToFollow | null = null;
  private followGeneration = 0;

  private api: ExcalidrawPresenceEditor | null = null;
  private ownerDocument: Document | null = null;
  private ownerWindow: Window | null = null;
  private attachmentGeneration = 0;

  constructor(
    private readonly channel: ExcalidrawPresenceChannel,
    private readonly changed: (target: UserToFollow | null) => void,
  ) {}

  attach(api: ExcalidrawPresenceEditor, ownerDocument: Document): () => void {
    if (this.disposed) {
      throw new Error("画板 Presence 已销毁");
    }
    this.detach();
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) {
      throw new Error("画板 ownerDocument 缺少窗口");
    }
    this.api = api;
    this.ownerDocument = ownerDocument;
    this.ownerWindow = ownerWindow;
    const generation = ++this.attachmentGeneration;
    this.unsubscribe = this.channel.subscribe((peers) => {
      if (this.api !== api || generation !== this.attachmentGeneration) {
        return;
      }
      this.remote = peers;
      this.render();
    });
    ownerDocument.addEventListener("visibilitychange", this.visibility);
    ownerWindow.addEventListener("keydown", this.activity);
    this.visibility();
    return () => {
      if (generation === this.attachmentGeneration) {
        this.detach();
      }
    };
  }

  private getApi() {
    return this.api;
  }

  readonly onUserFollow: PresenceUserFollow = ({ action, userToFollow }) => {
    if (this.disposed || !this.api) {
      return;
    }
    if (action === "UNFOLLOW") {
      if (
        shouldUnfollow(this.state.followTarget, userToFollow.socketId, "manual")
      ) {
        this.setFollow(null);
      }
    } else {
      const remote = this.validRemote();
      const entry = remote.get(userToFollow.socketId);
      if (!entry || !this.validChain(userToFollow.socketId, remote)) {
        return;
      }
      this.setFollow({
        socketId: userToFollow.socketId,
        username: entry.user.name,
      });
    }
    // UserList 的 action 还会提交点击前的 appState；待其完成后再导航。
    const generation = this.followGeneration;
    const target = this.state.followTarget;
    queueMicrotask(() => {
      if (
        !this.disposed &&
        this.api &&
        generation === this.followGeneration &&
        target === this.state.followTarget
      ) {
        this.render();
      }
    });
  };

  /** vendor 只在真实用户导航时发出 UNFOLLOW；滚动回调本身不能判断来源。 */
  readonly onScrollChange: PresenceScrollChange = () => {
    this.reconcileFollow();
  };

  cancelFollow(): void {
    if (!this.disposed) {
      this.setFollow(null);
    }
  }

  private validRemote() {
    return new Map(this.remote.map((peer) => [peer.sessionId, peer]));
  }

  private validChain(
    target: string,
    remote: ReturnType<ExcalidrawPresence["validRemote"]>,
  ): boolean {
    return createFollowGraph(this.channel.sessionId).validChain(
      target,
      new Map(
        [...remote].map(([id, entry]) => [
          id,
          { followTarget: entry.state.followTarget },
        ]),
      ),
    );
  }

  private setFollow(target: UserToFollow | null): void {
    if (this.state.followTarget === (target?.socketId ?? null)) {
      return;
    }
    this.followGeneration++;
    this.target = target;
    this.state.followTarget = target?.socketId ?? null;
    this.appliedViewport = null;
    this.changed(target);
    this.flush();
  }

  private reconcileFollow(): void {
    if (this.disposed || this.reconciling || !this.api) {
      return;
    }
    this.reconciling = true;
    try {
      const remote = this.validRemote();
      if (this.target && !this.validChain(this.target.socketId, remote)) {
        this.setFollow(null);
      }
      const api = this.getApi();
      const state = api?.getAppState?.();
      if (!api || !state || state.width <= 0 || state.height <= 0) {
        return;
      }
      const bounds = this.target
        ? remote.get(this.target.socketId)?.state.bounds
        : null;
      const key = bounds
        ? JSON.stringify([
            this.target?.socketId,
            bounds,
            state.width,
            state.height,
          ])
        : null;
      if (bounds && key !== this.appliedViewport && api.setViewport) {
        this.appliedViewport = key;
        api.setViewport({
          target: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY],
          fit: "contain",
          animation: false,
          offsets: { left: 0, top: 0, right: 0, bottom: 0 },
        });
      }
      const current = api.getAppState?.();
      const hasFollowers = [...remote.values()].some(
        (entry) => entry.state.followTarget === this.channel.sessionId,
      );
      const candidate =
        hasFollowers && current ? presenceViewportBounds(current) : null;
      const next = candidate && validBounds(candidate) ? candidate : null;
      if (JSON.stringify(next) !== JSON.stringify(this.state.bounds)) {
        const immediate = this.state.bounds === null || next === null;
        this.state.bounds = next;
        if (immediate) {
          this.flush();
        } else {
          this.throttledFlush();
        }
      }
    } finally {
      this.reconciling = false;
    }
  }

  readonly onPointerUpdate: PresencePointerUpdate = ({
    pointer,
    button,
    pointersMap,
  }) => {
    if (this.disposed || !this.api) {
      return;
    }
    this.activity();
    if (
      pointersMap.size > 1 &&
      this.state.pointer === null &&
      this.state.button === "up"
    ) {
      return;
    }
    const released = this.state.button === "down" && button === "up";
    this.state.pointer = pointersMap.size > 1 ? null : pointer;
    this.state.button = pointersMap.size > 1 ? "up" : button;
    if (released || pointersMap.size > 1) {
      this.flush();
    } else {
      this.throttledFlush();
    }
  };

  /** 选区从本地编辑器读取；远端选区只用于 collaborators 投影。 */
  selection(selected: Readonly<Record<string, boolean>> = {}): void {
    if (this.disposed || !this.api || this.rendering) {
      return;
    }
    const next = Object.keys(selected)
      .filter((id) => selected[id])
      .sort()
      .slice(0, 200);
    if (
      next.length === this.selectedElementIds.length &&
      next.every((id, index) => id === this.selectedElementIds[index])
    ) {
      return;
    }
    this.selectedElementIds = next;
    this.activity();
    this.flush();
  }

  render(): void {
    this.reconcileFollow();
    const api = this.getApi();
    if (!api || this.disposed || this.rendering) {
      return;
    }
    const visible = new Set(
      api.getSceneElements().map((element) => element.id),
    );
    const collaborators = new Map<SocketId, Collaborator>();
    for (const peer of this.remote) {
      // SocketId 是 editor 的字符串品牌；宿主传入已校准的 client ID。
      const socketId = peer.sessionId as SocketId;
      const presence = peer.state;
      collaborators.set(socketId, {
        id: peer.user.id,
        socketId,
        username: peer.user.name,
        color: peer.user.color,
        userState: UserIdleState[presence.idleState],
        ...(presence.pointer && presence.idleState !== "AWAY"
          ? { pointer: presence.pointer }
          : {}),
        button: presence.button,
        selectedElementIds: Object.fromEntries(
          presence.selectedElementIds
            .filter((id) => visible.has(id))
            .map((id) => [id, true]),
        ),
      });
    }
    const serialized = JSON.stringify([...collaborators]);
    if (this.renderedApi === api && this.renderedState === serialized) {
      return;
    }
    this.renderedApi = api;
    this.renderedState = serialized;
    this.rendering = true;
    try {
      api.updateScene({ collaborators });
    } finally {
      this.rendering = false;
    }
  }

  private detach(): void {
    if (!this.api) {
      return;
    }
    const editor = this.api;
    this.attachmentGeneration++;
    this.followGeneration++;
    this.api = null;
    this.target = null;
    this.state.followTarget = null;
    this.state.bounds = null;
    this.state.pointer = null;
    this.state.button = "up";
    this.selectedElementIds = [];
    this.state.selectedElementIds = [];
    this.changed(null);
    this.throttle.cancel();
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = null;
    this.ownerDocument?.removeEventListener(
      "visibilitychange",
      this.visibility,
    );
    this.ownerWindow?.removeEventListener("keydown", this.activity);
    this.ownerDocument = null;
    this.ownerWindow = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.remote = [];
    this.renderedApi = null;
    this.renderedState = null;
    this.appliedViewport = null;
    this.channel.publish(null);
    if (!editor.isDestroyed) {
      editor.updateScene({ collaborators: new Map() });
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.detach();
    this.disposed = true;
    this.channel.dispose();
  }

  private readonly activity = (): void => {
    if (this.disposed || this.ownerDocument?.hidden) {
      return;
    }
    this.lastActivity = performance.now();
    if (this.state.idleState !== "ACTIVE") {
      this.state.idleState = "ACTIVE";
      this.flush();
    }
    if (this.idleTimer === null) {
      this.scheduleIdle();
    }
  };

  private readonly visibility = (): void => {
    if (this.disposed || !this.api) {
      return;
    }
    if (this.ownerDocument?.hidden) {
      this.state.idleState = "AWAY";
      this.state.pointer = null;
      this.state.button = "up";
      if (this.idleTimer !== null) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
    } else {
      this.state.idleState = "ACTIVE";
      this.lastActivity = performance.now();
      if (this.idleTimer === null) {
        this.scheduleIdle();
      }
    }
    this.flush();
  };

  private scheduleIdle(delay: number = 60_000): void {
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.disposed || !this.api) {
        return;
      }
      const elapsed = performance.now() - this.lastActivity;
      if (elapsed < 60_000) {
        this.scheduleIdle(60_000 - elapsed);
      } else if (
        !this.ownerDocument?.hidden &&
        this.state.idleState !== "IDLE"
      ) {
        this.state.idleState = "IDLE";
        this.flush();
      }
    }, delay);
  }

  private throttledFlush(): void {
    this.throttle.schedule();
  }

  private flush(): void {
    if (this.disposed || !this.api) {
      return;
    }
    this.throttle.markSent();
    // 每次发送按完整状态计量，动态指针、活跃状态及视口字段优先于选区展示。
    const selected: string[] = [];
    let bytes = jsonBytes({ ...this.state, selectedElementIds: [] });
    for (const id of this.selectedElementIds) {
      const added = jsonBytes(id) + (selected.length ? 1 : 0);
      if (bytes + added > 16 * 1024) {
        break;
      }
      selected.push(id);
      bytes += added;
    }
    this.state.selectedElementIds = selected;
    this.channel.publish(structuredClone(this.state));
  }
}
