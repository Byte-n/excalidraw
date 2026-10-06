import type * as Y from "yjs";

export type SceneElement = Readonly<{ id: string; version?: number }> &
  Readonly<Record<string, unknown>>;

export type SceneAdapter<TElement extends SceneElement, TAsset = unknown> = {
  cloneElement?: (element: TElement) => TElement;
  compareElements?: (left: TElement, right: TElement) => number;
  validate?: (
    elements: readonly TElement[],
    assets: Readonly<Record<string, TAsset>>,
  ) => void;
  project?: (elements: readonly TElement[]) => readonly TElement[];
  getId?: (element: TElement) => string;
  validateCanonical?: (scene: SceneSnapshot<TElement, TAsset>) => void;
  sort?: (elements: readonly TElement[]) => readonly TElement[];
  projectDisplay?: (
    scene: SceneSnapshot<TElement, TAsset>,
  ) => readonly TElement[];
  normalizePersistent?: (element: TElement) => TElement;
  createPersistent?: (element: TElement) => TElement;
  reverseDisplay?: (input: {
    canonical: TElement;
    display: TElement;
  }) => TElement;
  tombstone?: (element: TElement) => TElement;
};

export type SceneSnapshot<TElement extends SceneElement, TAsset = unknown> = {
  elements: readonly TElement[];
  assets: Readonly<Record<string, TAsset>>;
};

export type BindingGate = {
  initialized: boolean;
  synced: boolean;
  canEdit: boolean;
  generation: number;
};

export type SceneBindingOptions<
  TElement extends SceneElement,
  TAsset = unknown,
> = {
  doc: Y.Doc;
  adapter?: SceneAdapter<TElement, TAsset>;
  elementsName?: string;
  assetsName?: string;
  origin?: unknown;
  onRemoteChange?:
    | ((scene: SceneSnapshot<TElement, TAsset>) => void)
    | ((
        elements: readonly TElement[],
        assets: Readonly<Record<string, TAsset>>,
      ) => void);
  onRemoteSceneChange?: (scene: SceneSnapshot<TElement, TAsset>) => void;
  observeRemote?: boolean;
};

export type SceneBinding<TElement extends SceneElement, TAsset = unknown> = {
  readonly origin: unknown;
  readonly document: Y.Doc;
  getElements(): readonly TElement[];
  getAssets(): Readonly<Record<string, TAsset>>;
  getCanonical(): SceneSnapshot<TElement, TAsset>;
  getAdapter(): SceneAdapter<TElement, TAsset>;
  setGate(gate: Partial<BindingGate>): void;
  getGate(): BindingGate;
  applyLocal(
    elements: readonly TElement[],
    assets?: Readonly<Record<string, TAsset>>,
  ): void;
  applyCommand(
    command: {
      elements: readonly TElement[];
      assets?: Readonly<Record<string, TAsset>>;
      deleteIds?: readonly string[];
    },
    generation?: number,
  ): string[];
  prepareImportCommand(
    command: {
      elements: readonly TElement[];
      assets?: Readonly<Record<string, TAsset>>;
      deleteIds?: readonly string[];
    },
    generation?: number,
  ): { commit: () => string[] };
  transact(run: () => void): void;
  isCurrent(generation: number): boolean;
  runIfCurrent<T>(generation: number, run: () => T): T | undefined;
  dispose(): void;
};
