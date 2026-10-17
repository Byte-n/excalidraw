import {
  DEFAULT_FRAME_PRESET_SIZE,
  DEFAULT_STICKY_NOTE_PRESET_SIZE,
  FRAME_STYLE,
  KEYS,
  VERTICAL_ALIGN,
  getGridPoint,
} from "@excalidraw/common";

import {
  TABLE_SWIMLANE_LABEL_FONT_SIZE,
  getStickyNoteCreationInk,
  getTableCellIdAt,
  getTablePresetLabelCells,
  newElement,
  newEmbeddableElement,
  newFrameElement,
  newMagicFrameElement,
  newStickyNoteElement,
  newTableElement,
} from "@excalidraw/element";

import type {
  ShapeId,
  DirectContainerRef,
  ExcalidrawFrameLikeElement,
  ExcalidrawNonSelectionElement,
  ExcalidrawSelectionElement,
  ExcalidrawTableElement,
  NonDeleted,
} from "@excalidraw/element/types";

import type { MindmapTreeSpec, TablePresetId } from "@excalidraw/element";

import { t } from "../../i18n";

import {
  SHAPE_PRESET_STYLE,
  getShapePresetDefaults,
} from "../shapePresetDefaults";

import { buildTableCellBackgroundText } from "./tableCellText";

import type { ShapePresetDefault } from "../shapePresetDefaults";
import type App from "../App";
import type { AppState, KeyboardModifiersObject, ToolType } from "../../types";

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
 * 有预设的**非复合图形**工具 → 预设尺寸。复合图形（矩形/菱形/椭圆及全部 43 个
 * 预设图形）的默认尺寸唯一来源是 `SHAPE_PRESET_DEFAULTS`，由 `getPresetSize`
 * 解析，不在这里重复推导；表格用元素自带的默认 3×3，也不在这里。
 */
export const PRESET_SIZES: Partial<
  Record<ToolType, { width: number; height: number }>
> = {
  stickynote: {
    width: DEFAULT_STICKY_NOTE_PRESET_SIZE,
    height: DEFAULT_STICKY_NOTE_PRESET_SIZE,
  },
  frame: DEFAULT_FRAME_PRESET_SIZE,
};

/**
 * 默认值表（`SHAPE_PRESET_DEFAULTS`）键的**唯一**计算处，与 `newCreationDraft`
 * 里 `genericShapeId` 的解析同源：矩形工具用「当前图形」（`preferredGenericShape`
 * 就是一个元素的 `shape.id`），菱形/椭圆及其余工具各自成键。
 */
export const getPresetShapeId = (
  elementType: ToolType | "custom",
  preferredShape: AppState["preferredGenericShape"] | undefined,
): string =>
  elementType === "rectangle" ? preferredShape ?? elementType : elementType;

/**
 * 预设尺寸的解析顺序：图形默认值表 → `PRESET_SIZES`（便签/画框；`custom` 无
 * 预设）→ 元素自带尺寸（表格、脑图根节点）。只服务「悬停预览」与「单击落地」
 * 两条路径；按住拖拽仍按拖出范围自定大小，因为 `dragNewElement` 只写几何、
 * 不碰样式。
 */
export const getPresetSize = (
  tool: ToolType | "custom",
  presetShapeId: string | undefined,
  element: { width: number; height: number },
): { width: number; height: number } => {
  const presetDefaults: ShapePresetDefault | undefined =
    getShapePresetDefaults(presetShapeId);
  if (presetDefaults) {
    return { width: presetDefaults.width, height: presetDefaults.height };
  }
  if (tool !== "custom") {
    const toolSize = PRESET_SIZES[tool];
    if (toolSize) {
      return toolSize;
    }
  }
  return { width: element.width, height: element.height };
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
 * 建草稿时**一次性**覆盖 `appState` 里的当前样式。缺省的每一项都回落到
 * `app.state` 的现值（现有调用点行为不变）。图形抽屉靠它放 `fc-diamond`、
 * 指定纸色的便签，而**不写 appState**（不动工具栏的「当前图形」/ 当前纸色）。
 */
export type CreationDraftOverrides = {
  preferredGenericShape?: AppState["preferredGenericShape"];
  stickyBackgroundColor?: string;
  stickyStrokeColor?: string;
};

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
  overrides?: CreationDraftOverrides,
): NonDeleted<ExcalidrawFrameLikeElement>;
export function newCreationDraft(
  app: PresetApp,
  elementType: Extract<CreationDraftType, "table">,
  at: { x: number; y: number },
  containerRef?: DirectContainerRef,
  identity?: CreationIdentity,
  overrides?: CreationDraftOverrides,
): NonDeleted<ExcalidrawTableElement>;
export function newCreationDraft(
  app: PresetApp,
  elementType: CreationDraftType,
  at: { x: number; y: number },
  containerRef?: DirectContainerRef,
  identity?: CreationIdentity,
  overrides?: CreationDraftOverrides,
): CreationDraft;
export function newCreationDraft(
  app: PresetApp,
  elementType: CreationDraftType,
  at: { x: number; y: number },
  containerRef?: DirectContainerRef,
  identity?: CreationIdentity,
  overrides?: CreationDraftOverrides,
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
    // 表格的草稿可能不止一个元素（泳道预设自带标签文字）——「按下即拖」只用
    // 表格本身，整份装配见 `createTablePresetDrafts`
    return createTablePresetDrafts(
      app,
      state.currentTablePreset,
      at,
      containerRef,
      identity,
    )[0] as NonDeleted<ExcalidrawTableElement>;
  }

  // 便签纸色/墨色：抽屉会按预设覆盖，其余调用点用 appState 现值
  const stickyBackgroundColor =
    overrides?.stickyBackgroundColor ??
    state.currentItemStickynoteBackgroundColor;
  const stickyStrokeColor =
    overrides?.stickyStrokeColor ?? state.currentItemStickynoteStrokeColor;

  const baseElementAttributes = {
    x: at.x,
    y: at.y,
    strokeColor:
      elementType === "stickynote"
        ? // the default yellow paper pairs with its own ink
          getStickyNoteCreationInk(stickyBackgroundColor, stickyStrokeColor)
        : state.currentItemStrokeColor,
    backgroundColor:
      elementType === "stickynote"
        ? stickyBackgroundColor
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

  // 抽屉放置会带上预设的图形 id，其余调用点用 appState 现值；两者都是元素的
  // `shape.id`（`preferredGenericShape` 亦然）
  const preferredShape =
    overrides?.preferredGenericShape ?? state.preferredGenericShape;
  const genericShapeId: ShapeId =
    elementType === "rectangle" ? preferredShape : elementType;
  // 预设图形的默认样式 + 该图形填色：命中默认值表则覆盖上面的 currentItem*
  // （描边色/线宽/线型/填充/不透明度/背景色），未命中（理论上不会）保持现状。
  const presetDefaults = getShapePresetDefaults(
    getPresetShapeId(elementType, preferredShape),
  );
  const presetStyle = presetDefaults
    ? { ...SHAPE_PRESET_STYLE, backgroundColor: presetDefaults.backgroundColor }
    : {};
  return newElement({
    type: genericShapeId,
    ...baseElementAttributes,
    ...presetStyle,
  });
}

/**
 * 行列与单元格的 id 来源：从元素的固定身份派生，同一次构建里稳定、跨构建也
 * 稳定。缺省（真实建表）不传，由构造函数生成随机 id。
 */
const gridRandomizer = (id: string) => {
  let index = 0;
  return () => `${id}:grid:${index++}`;
};

/** 泳道预设标题带的文案：预设名就是它的标题（样本里也是这么烘进去的） */
const TABLE_PRESET_TITLE_KEYS: Record<
  Exclude<TablePresetId, "plain">,
  Parameters<typeof t>[0]
> = {
  "swimlane-horizontal": "toolBar.swimlaneHorizontal",
  "swimlane-vertical": "toolBar.swimlaneVertical",
};

/**
 * 表格预设的完整装配：**表格 + 自带标签文字**（`plain` 只有表格本身）。
 *
 * 标签文案走 i18n 且按调用时求值——语言可以在会话中切换，模块级常量会把当时
 * 的语言冻住（同 `getMindmapPresetTree`）。格位来自元素层的
 * `getTablePresetLabelCells`，文字居中、竖排换行、竖向居中都由单元格布局算，
 * 因此标签与「双击单元格敲出来的文字」是同一类元素，落地点开就能改。
 *
 * `labelIdentity` 与表格的 `identity` 分开给：预览要求**每个**元素都有固定
 * 身份（一个都不能漏，否则照样推进共享的 id 序列），建表时一个都不给。
 *
 * 网格自己的 id 也从表格身份派生（`gridRandomizer`）——行列与单元格同样消耗
 * 共享的随机序列，只固定元素身份是不够的。
 */
export const createTablePresetDrafts = (
  app: PresetApp,
  presetId: TablePresetId,
  at: { x: number; y: number },
  containerRef?: DirectContainerRef,
  identity?: CreationIdentity,
  labelIdentity: (index: number) => CreationIdentity = () => ({}),
): NonDeleted<ExcalidrawNonSelectionElement>[] => {
  const table = newTableElement({
    type: "table",
    preset: presetId,
    x: at.x,
    y: at.y,
    opacity: app.state.currentItemOpacity,
    locked: false,
    containerRef,
    randomizer: identity?.id ? gridRandomizer(identity.id) : undefined,
    ...identity,
  });

  if (presetId === "plain") {
    return [table];
  }

  // 标签在表格进场景之前装配：布局只需要行列样式，给一份只含这张表的映射
  const elementsMap = new Map([[table.id, table]]);

  return [
    table,
    ...getTablePresetLabelCells(presetId).map((cell, index) => {
      const cellId = getTableCellIdAt(
        table.table,
        cell.rowIndex,
        cell.columnIndex,
      );
      if (!cellId) {
        throw new Error(
          `Table preset ${presetId} has no cell at (${cell.rowIndex}, ${cell.columnIndex})`,
        );
      }
      return buildTableCellBackgroundText(app, table, cellId, {
        text:
          cell.kind === "title"
            ? t(TABLE_PRESET_TITLE_KEYS[presetId])
            : t("toolBar.swimlane"),
        elementsMap,
        fontSize: TABLE_SWIMLANE_LABEL_FONT_SIZE,
        textAlign: "center",
        verticalAlign: VERTICAL_ALIGN.MIDDLE,
        identity: labelIdentity(index),
      });
    }),
  ];
};

/**
 * 预览元素：与「按下即建」同源装配，再落到预设尺寸上。**鼠标点即元素左上角**
 * ——与按下拖拽的锚点一致，所以悬停、拖拽、单击三者的落点不会互相跳。表格用
 * 元素自带的默认尺寸（`plain` 是 3×3，泳道预设是自带行列尺寸与标签的整张表），
 * 其余走 `getPresetSize`（图形默认值表 → `PRESET_SIZES`）。
 *
 * 表格可能不止一个元素：泳道预设自带标签文字，预览要把它们一起画出来，所以
 * 这里返回数组（调用方只有 `AppCreatePreview`，锚点取第一个元素）。
 */
export const buildPresetPreviewElements = (
  app: PresetApp,
  tool: ToolType,
  at: { x: number; y: number },
): NonDeleted<ExcalidrawNonSelectionElement>[] => {
  const containerRef = app.getContainerRefForDropAt(at);

  if (tool === "table") {
    // 固定身份：预览不得推进共享的 id / 随机序列（见 CreationIdentity）
    return createTablePresetDrafts(
      app,
      app.state.currentTablePreset,
      at,
      containerRef,
      { id: PREVIEW_ELEMENT_ID, seed: PREVIEW_ELEMENT_SEED },
      (index) => ({
        id: `${PREVIEW_ELEMENT_ID}:label:${index}`,
        seed: PREVIEW_ELEMENT_SEED + index + 1,
      }),
    );
  }

  const draft = newCreationDraft(
    app,
    tool as CreationDraftType,
    at,
    containerRef,
    {
      id: PREVIEW_ELEMENT_ID,
      seed: PREVIEW_ELEMENT_SEED,
    },
  ) as NonDeleted<ExcalidrawNonSelectionElement>;
  const size = getPresetSize(
    tool,
    getPresetShapeId(tool, app.state.preferredGenericShape),
    draft,
  );
  return [
    { ...draft, x: at.x, y: at.y, width: size.width, height: size.height },
  ];
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
  const size = getPresetSize(
    tool,
    getPresetShapeId(tool, app.state.preferredGenericShape),
    element,
  );
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
