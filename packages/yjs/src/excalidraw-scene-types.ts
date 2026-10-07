import type {
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";

import type * as Y from "yjs";

import type { AssetCoordinator } from "./assets";
import type { SceneBinding, SceneSnapshot } from "./types";

/** JSON 场景仅声明协作算法读取的结构；业务字段由宿主校验并完整保留。 */
export type ExcalidrawSceneElement = {
  id: string;
  type: string;
  index: string;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  x: number;
  y: number;
  /** 文本 canonical 可延迟到浏览器显示/编辑时补齐；其他元素仍由宿主 schema 强制。 */
  width?: number;
  height?: number;
  angle: number;
  updated: number;
  fileId?: string | null;
  status?: string;
  containerId?: string | null;
  containerRef?:
    | { kind: "frameLike"; elementId: string }
    | { kind: "tableTitle"; elementId: string }
    | {
        kind: "tableCell";
        elementId: string;
        cellId: string;
        role: "content" | "backgroundText";
      };
  boundElements?: readonly { id: string; type: string }[] | null;
  startBinding?: {
    elementId: string;
    fixedPoint: [number, number];
    mode: "inside" | "orbit" | "skip";
  } | null;
  endBinding?: {
    elementId: string;
    fixedPoint: [number, number];
    mode: "inside" | "orbit" | "skip";
  } | null;
  table?: {
    cells: readonly { id: string; [key: string]: unknown }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ExcalidrawSceneCommand<TElement, TAsset> = {
  elements: readonly TElement[];
  assets?: Readonly<Record<string, TAsset>>;
  deleteIds?: readonly string[];
};

export type ExcalidrawSceneState = {
  canEdit: boolean;
  synced: boolean;
  online: boolean;
};

export type ExcalidrawSceneControllerOptions<
  TElement extends ExcalidrawSceneElement,
  TAsset extends { size: number; mimeType: string },
> = {
  document: Y.Doc;
  /** 借用 binding 时由拥有者写 gate 并最终释放，controller 只订阅场景。 */
  borrowedBinding?: SceneBinding<TElement, TAsset>;
  /** 未同步的新空文档可等待首次远端场景；已同步场景仍立即校验。 */
  deferInitialSceneValidation?: boolean;
  state: ExcalidrawSceneState;
  assets?: AssetCoordinator<TAsset>;
  validateScene(scene: SceneSnapshot<TElement, TAsset>): void;
  onError(error: unknown, operation: "restore" | "publish" | "command"): void;
};

/** 内部场景控制器由完整协作入口组合，尚不代表 Presence 接入接口。 */
export type ExcalidrawSceneController<
  TElement extends ExcalidrawSceneElement,
  TAsset extends { size: number; mimeType: string },
> = {
  attach(api: ExcalidrawImperativeAPI): () => void;
  onChange: NonNullable<ExcalidrawProps["onChange"]>;
  getReadOnly(): boolean;
  subscribe(listener: () => void): () => void;
  updateState(state: Partial<ExcalidrawSceneState>): void;
  applyCommand(command: ExcalidrawSceneCommand<TElement, TAsset>): string[];
  prepareImportCommand(command: ExcalidrawSceneCommand<TElement, TAsset>): {
    commit(): string[];
  };
  getScene(): SceneSnapshot<TElement, TAsset>;
  getApi(): ExcalidrawImperativeAPI | null;
  refreshScene(): void;
  retryFiles(): void;
  dispose(): void;
};
