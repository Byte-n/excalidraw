import {
  DEFAULT_FRAME_PRESET_SIZE,
  DEFAULT_SHAPE_PRESET_SIZE,
  DEFAULT_STICKY_NOTE_SIZE,
  FRAME_STYLE,
  getGridPoint,
  KEYS,
} from "@excalidraw/common";

import {
  getStickyNoteCreationInk,
  newElement,
  newEmbeddableElement,
  newFrameElement,
  newMagicFrameElement,
  newStickyNoteElement,
  newTableElement,
} from "@excalidraw/element";

import type {
  BaseShapeId,
  DirectContainerRef,
  ExcalidrawFrameLikeElement,
  ExcalidrawNonSelectionElement,
  ExcalidrawSelectionElement,
  ExcalidrawTableElement,
  NonDeleted,
} from "@excalidraw/element/types";

import type { MindmapTreeSpec } from "@excalidraw/element";

import { t } from "../../i18n";

import type App from "../App";
import type { KeyboardModifiersObject, ToolType } from "../../types";

/**
 * 创建工具的**预设**：选中工具后跟随光标的半透明预览，以及「单击落地」用的
 * 尺寸与元素装配。
 *
 * 这里是 `newCreationDraft` 的唯一实现——按下即建的元素、跟随光标的预览元素
 * 都由它装配，两者因此逐项一致（样式、容器归属、形状分支）；预设尺寸表也只
 * 有一份。任何一处漂移都会表现为「预览和落地不一样」。
 *
 * 锚点：**鼠标点即元素左上角**，与按下拖拽的起点一致（拖拽时按下点就是左上角），
 * 所以同一个手势从悬停到落地不会跳。
 */

/** 只用到 App 的这几项，其余按需扩展（与其它 pointer 控制器同一套 shim 风格） */
type PresetApp = Pick<
  App,
  | "state"
  | "getContainerRefForDropAt"
  | "getCurrentItemStrokeWidth"
  | "getCurrentItemRoundness"
  | "getEffectiveGridSize"
>;

/** 可以「按下即建」的元素类型——`selection` 也在内，它走的是框选不是预设 */
export type CreationDraftType =
  | "selection"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "embeddable"
  | "stickynote"
  | "frame"
  | "magicframe"
  | "table";

/**
 * 有预设的工具 → 预设尺寸。缺省的（表格）用元素自带的默认尺寸——表格的
 * 默认 3×3 就是它的预设，不在这里重复推导。
 */
export const PRESET_SIZES: Partial<
  Record<ToolType, { width: number; height: number }>
> = {
  rectangle: DEFAULT_SHAPE_PRESET_SIZE,
  diamond: DEFAULT_SHAPE_PRESET_SIZE,
  ellipse: DEFAULT_SHAPE_PRESET_SIZE,
  stickynote: {
    width: DEFAULT_STICKY_NOTE_SIZE,
    height: DEFAULT_STICKY_NOTE_SIZE,
  },
  frame: DEFAULT_FRAME_PRESET_SIZE,
};

/**
 * 草稿的返回类型，与 `AppState["newElement"]` 对齐：`selection` 走
 * `selectionElement`，其余走 `newElement`。分成两支是为了让调用方按 `type`
 * 收窄（`ExcalidrawElement & { isDeleted: false }` 这种交叉类型收窄不了）。
 */
export type CreationDraft =
  | NonDeleted<ExcalidrawSelectionElement>
  | NonDeleted<ExcalidrawNonSelectionElement>;

/** 该工具是否「跟随鼠标预览预设 + 单击落地」（拖拽自定大小不受影响） */
export const isPresetCreationTool = (type: ToolType | "custom"): boolean =>
  type === "rectangle" ||
  type === "diamond" ||
  type === "ellipse" ||
  type === "stickynote" ||
  type === "frame" ||
  type === "table";

/** 草稿是不是「选区元素」那一支（收窄用；交叉类型上 `type` 判定收窄不了） */
export const isSelectionDraft = (
  draft: CreationDraft,
): draft is NonDeleted<ExcalidrawSelectionElement> =>
  draft.type === "selection";

/**
 * 该工具是否跟随鼠标预览。思维导图只在这里——它的预览是整张图、落地走
 * `AppMindmap.createRoot`（`isPresetCreationTool` 是「单元素 + 复用按下即建
 * 的草稿」那一类，不含它）。
 */
export const hasCreationPreview = (type: ToolType | "custom"): boolean =>
  isPresetCreationTool(type) || type === "mindmap";

/**
 * 显式身份：**离屏预览必须传**。预览元素不入场景，却会消耗共享的 id 计数器
 * 与随机序列（`newElement` 内部生成），把同一会话里后续元素的 id/seed 推后，
 * 预览因此会「隔空」改变真实元素的身份。
 */
export type CreationIdentity = { id?: string; seed?: number };

/** 预览元素的固定身份：一次构建一个，平移时复用（见 `AppCreatePreview`） */
export const PREVIEW_ELEMENT_ID = "preview:preset";
export const PREVIEW_ELEMENT_SEED = 1;

/**
 * 装配一个「还没定位好」的创建草稿：样式、形状分支、容器归属都在这里，
 * `at` 只决定 x/y。按下即建传指针（等价于元素左上角），预览传预设的左上角。
 */

export function newCreationDraft(
  app: PresetApp,
  elementType: Extract<CreationDraftType, "frame" | "magicframe">,
  at: { x: number; y: number },
  containerRef?: DirectContainerRef,
  identity?: CreationIdentity,
): NonDeleted<ExcalidrawFrameLikeElement>;
export function newCreationDraft(
  app: PresetApp,
  elementType: Extract<CreationDraftType, "table">,
  at: { x: number; y: number },
  containerRef?: DirectContainerRef,
  identity?: CreationIdentity,
): NonDeleted<ExcalidrawTableElement>;
export function newCreationDraft(
  app: PresetApp,
  elementType: CreationDraftType,
  at: { x: number; y: number },
  containerRef?: DirectContainerRef,
  identity?: CreationIdentity,
): CreationDraft;
export function newCreationDraft(
  app: PresetApp,
  elementType: CreationDraftType,
  at: { x: number; y: number },
  containerRef?: DirectContainerRef,
  identity?: CreationIdentity,
): CreationDraft {
  const { state } = app;

  if (elementType === "frame" || elementType === "magicframe") {
    const constructorOpts = {
      x: at.x,
      y: at.y,
      opacity: state.currentItemOpacity,
      locked: false,
      ...FRAME_STYLE,
      ...identity,
    } as const;
    return elementType === "magicframe"
      ? newMagicFrameElement(constructorOpts)
      : newFrameElement(constructorOpts);
  }

  if (elementType === "table") {
    return newTableElement({
      type: "table",
      x: at.x,
      y: at.y,
      opacity: state.currentItemOpacity,
      locked: false,
      containerRef,
      ...identity,
    });
  }

  const baseElementAttributes = {
    x: at.x,
    y: at.y,
    strokeColor:
      elementType === "stickynote"
        ? // the default yellow paper pairs with its own ink
          getStickyNoteCreationInk(
            state.currentItemStickynoteBackgroundColor,
            state.currentItemStickynoteStrokeColor,
          )
        : state.currentItemStrokeColor,
    backgroundColor:
      elementType === "stickynote"
        ? state.currentItemStickynoteBackgroundColor
        : state.currentItemBackgroundColor,
    fillStyle: state.currentItemFillStyle,
    strokeWidth: app.getCurrentItemStrokeWidth(elementType),
    strokeStyle: state.currentItemStrokeStyle,
    opacity: state.currentItemOpacity,
    roundness: app.getCurrentItemRoundness(elementType),
    locked: false,
    containerRef,
    ...identity,
  } as const;

  if (elementType === "embeddable") {
    return newEmbeddableElement({
      type: "embeddable",
      ...baseElementAttributes,
    });
  }
  if (elementType === "stickynote") {
    return newStickyNoteElement({
      type: "stickynote",
      ...baseElementAttributes,
    });
  }
  if (elementType === "selection") {
    return newElement({
      type: "selection",
      ...baseElementAttributes,
    });
  }

  const preferredShape = state.preferredGenericShape;
  const genericShapeId: BaseShapeId =
    preferredShape === "right-triangle" || preferredShape === "left-triangle"
      ? "triangle"
      : elementType === "rectangle"
      ? preferredShape
      : elementType;
  if (
    preferredShape === "right-triangle" ||
    preferredShape === "left-triangle"
  ) {
    return newElement({
      type: "composite_shape",
      shape: {
        id: "triangle",
        schemaVersion: 1,
        triangle: {
          apexX: preferredShape === "right-triangle" ? 0 : 1,
        },
      },
      ...baseElementAttributes,
    });
  }
  return newElement({
    type: genericShapeId,
    ...baseElementAttributes,
  });
}

/**
 * 预览元素：与「按下即建」同源装配，再落到预设尺寸上。**鼠标点即元素左上角**
 * ——与按下拖拽的锚点一致，所以悬停、拖拽、单击三者的落点不会互相跳。表格用
 * 元素自带的 3×3 默认尺寸，其余读 `PRESET_SIZES`。
 */
export const buildPresetPreview = (
  app: PresetApp,
  tool: ToolType,
  at: { x: number; y: number },
): NonDeleted<ExcalidrawNonSelectionElement> | null => {
  const draft = newCreationDraft(
    app,
    tool as CreationDraftType,
    at,
    app.getContainerRefForDropAt(at),
    // 固定身份：预览不得推进共享的 id / 随机序列（见 CreationIdentity）
    { id: PREVIEW_ELEMENT_ID, seed: PREVIEW_ELEMENT_SEED },
  ) as NonDeleted<ExcalidrawNonSelectionElement>;
  const size = PRESET_SIZES[tool] ?? {
    width: draft.width,
    height: draft.height,
  };
  return { ...draft, x: at.x, y: at.y, width: size.width, height: size.height };
};

/**
 * 单击落地时元素该落在哪：预设尺寸，**左上角在按下点**，按网格吸附（与拖拽
 * 的起点处理完全相同）。思维导图传的是根节点尺寸——根节点左上角即按下点。
 */
export const getPresetPlacement = (
  app: PresetApp,
  tool: ToolType | "custom",
  element: { width: number; height: number },
  origin: { x: number; y: number },
  event: KeyboardModifiersObject,
): { x: number; y: number; width: number; height: number } => {
  const size = (tool === "custom" ? undefined : PRESET_SIZES[tool]) ?? {
    width: element.width,
    height: element.height,
  };
  const [x, y] = getGridPoint(
    origin.x,
    origin.y,
    event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
  );
  return { x, y, ...size };
};

/**
 * 思维导图工具的预设内容：中心主题 → 3 个分支主题 → 每支 2 个子主题
 * （7 个节点）。占位文字走 i18n 且**按调用时求值**——语言可以在会话中切换，
 * 模块级常量会把当时的语言冻住。
 */
export const getMindmapPresetTree = (): MindmapTreeSpec => {
  const leaf = () => ({ text: t("mindmapPreset.leaf"), children: [] });
  return {
    text: t("mindmapPreset.root"),
    children: [0, 1, 2].map(() => ({
      text: t("mindmapPreset.branch"),
      children: [leaf(), leaf()],
    })),
  };
};
