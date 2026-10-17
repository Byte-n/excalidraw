import {
  STICKY_NOTE_PRESETS,
  TABLE_PRESET_IDS,
  supportsFill,
} from "@excalidraw/element";

import type { StickyNotePreset, TablePresetId } from "@excalidraw/element";
import type { MindmapLayoutDirection, Theme } from "@excalidraw/element/types";

import { getCompositeShapeIcon } from "./CompositeShapeIcon";
import { getStickyNotePresetIcon } from "./StickyNotePresetIcon";
import { getTablePresetIcon } from "./TablePresetIcon";
import {
  DiamondIcon,
  EllipseIcon,
  RectangleIcon,
  frameToolIcon,
  mindmapIcon,
} from "./icons";

import type { TranslationKeys } from "../i18n";
import type { ReactNode } from "react";

/**
 * 一组预设的装配说明。目录只声明「放下的是什么」，具体怎么建元素交给
 * `app/presetPlacement`（见图形抽屉设计）：目录与渲染、放置链路解耦，
 * 新增一组预设只加数据。
 */
export type CreationSpec =
  | {
      kind: "shape";
      /** 落定时激活的工具：复合图形走 rectangle，菱形/椭圆各自独立 */
      tool: "rectangle" | "diamond" | "ellipse";
      /** 元素的 `shape.id`（矩形工具的当前图形，或菱形/椭圆/预设图形各自的 id） */
      shapeId: string;
    }
  | { kind: "sticky"; preset: StickyNotePreset }
  | { kind: "frame" }
  | { kind: "table"; preset: TablePresetId }
  | { kind: "mindmap"; direction: MindmapLayoutDirection };

export type PresetCatalogItem = {
  id: string;
  titleKey: TranslationKeys;
  /** 形状可填充 —— 决定图标/触发按钮的 fillable 样式 */
  fillable?: boolean;
  /** 图标在抽屉里额外旋转的角度（脑图四方向共用一张图标） */
  iconRotation?: number;
  /** 缩略图（便签、表格随主题换色），因此按主题求值 */
  getIcon: (theme: Theme) => ReactNode;
  creation: CreationSpec;
};

export type PresetCatalogGroupId =
  | "basic"
  | "flowchart"
  | "sticky"
  | "frame"
  | "table"
  | "mindmap";

export type PresetCatalogGroup = {
  id: PresetCatalogGroupId;
  titleKey: TranslationKeys;
  items: readonly PresetCatalogItem[];
};

/**
 * 基础图形 id（原 `Tools.tsx` 的 `SHAPE_TOOLS`），每一项都是一个元素的
 * `shape.id`。
 */
const BASIC_SHAPE_IDS = [
  "rectangle",
  "diamond",
  "ellipse",
  "cross",
  "brace-reverse",
  "brace",
  "cloud",
  "double-arrow",
  "forward-arrow",
  "backward-arrow",
  "octagon",
  "pentagon",
  "hexagon",
  "star",
  "triangle",
  "right-triangle",
  "left-triangle",
  "round-rect",
  "rectangle-bubble",
  "pill",
  "bubble",
  "trapezoid",
  "parallelogram",
  "right-pentagon",
  "step",
  "cube",
  "cylinder",
  "pie",
  "circular-ring",
] as const;

export type BasicShapeId = typeof BASIC_SHAPE_IDS[number];

/** 流程图（Lark）图形 id（原 `FLOWCHART_SHAPE_IDS`） */
const FLOWCHART_SHAPE_IDS = [
  "fc-round-rect",
  "fc-terminator",
  "fc-diamond",
  "fc-document",
  "fc-parallelogram",
  "fc-cylinder",
  "fc-horiz-cylinder",
  "fc-predefined-process",
  "fc-manual-input",
  "fc-trapezoid",
  "fc-delay",
  "fc-hexagon",
  "fc-off-page-connector",
  "fc-circle",
] as const;

export type FlowchartShapeId = typeof FLOWCHART_SHAPE_IDS[number];

/** 普通图形 popover 认可的全部形状 id（基础 + 流程图） */
export type GenericShapeId = BasicShapeId | FlowchartShapeId;

const GENERIC_SHAPE_ID_SET: ReadonlySet<string> = new Set([
  ...BASIC_SHAPE_IDS,
  ...FLOWCHART_SHAPE_IDS,
]);

const FLOWCHART_SHAPE_ID_SET: ReadonlySet<string> = new Set(
  FLOWCHART_SHAPE_IDS,
);

export const isGenericShapeId = (type: string): type is GenericShapeId =>
  GENERIC_SHAPE_ID_SET.has(type);

export const isFlowchartShapeId = (type: string): type is FlowchartShapeId =>
  FLOWCHART_SHAPE_ID_SET.has(type);

/** 基础图形的缩略图：矩形/菱形/椭圆走各自工具图标，其余走复合图形图标 */
const getBasicShapeIcon = (id: BasicShapeId): ReactNode =>
  id === "diamond"
    ? DiamondIcon
    : id === "ellipse"
    ? EllipseIcon
    : id === "rectangle"
    ? RectangleIcon
    : getCompositeShapeIcon(id);

const BASIC_ITEMS: readonly PresetCatalogItem[] = BASIC_SHAPE_IDS.map(
  (id): PresetCatalogItem => ({
    id,
    titleKey: `toolBar.${id}`,
    fillable: supportsFill(id),
    getIcon: () => getBasicShapeIcon(id),
    creation: {
      kind: "shape",
      tool:
        id === "diamond"
          ? "diamond"
          : id === "ellipse"
          ? "ellipse"
          : "rectangle",
      shapeId: id,
    },
  }),
);

const FLOWCHART_ITEMS: readonly PresetCatalogItem[] = FLOWCHART_SHAPE_IDS.map(
  (id): PresetCatalogItem => ({
    id,
    titleKey: `toolBar.${id}`,
    fillable: supportsFill(id),
    getIcon: () => getCompositeShapeIcon(id),
    creation: { kind: "shape", tool: "rectangle", shapeId: id },
  }),
);

const STICKY_ITEMS: readonly PresetCatalogItem[] = STICKY_NOTE_PRESETS.map(
  (preset): PresetCatalogItem => ({
    id: preset.id,
    // 预设由纸色唯一确定，配色族的既有译名（colors.*）就是它的名字
    titleKey: `colors.${preset.id}`,
    getIcon: (theme) =>
      getStickyNotePresetIcon(
        preset.backgroundColor,
        preset.strokeColor,
        theme,
      ),
    creation: { kind: "sticky", preset },
  }),
);

const FRAME_ITEMS: readonly PresetCatalogItem[] = [
  {
    id: "frame",
    titleKey: "shapeDrawer.frame",
    getIcon: () => frameToolIcon,
    creation: { kind: "frame" },
  },
];

/**
 * 表格预设的标题：`plain` 就是工具名本身，两条泳道用各自的预设名（也正是
 * 新建出来的表里标题带上那行字）。
 */
const TABLE_PRESET_TITLES: Record<TablePresetId, TranslationKeys> = {
  plain: "toolBar.table",
  "swimlane-horizontal": "toolBar.swimlaneHorizontal",
  "swimlane-vertical": "toolBar.swimlaneVertical",
};

const TABLE_ITEMS: readonly PresetCatalogItem[] = TABLE_PRESET_IDS.map(
  (preset): PresetCatalogItem => ({
    id: preset,
    titleKey: TABLE_PRESET_TITLES[preset],
    getIcon: (theme) => getTablePresetIcon(preset, theme),
    creation: { kind: "table", preset },
  }),
);

/**
 * 脑图四个生长方向：共用 `mindmapIcon`，以 `iconRotation` 供抽屉用 CSS
 * 旋转区分；落地写根节点的 `layoutDirection`。
 */
const MINDMAP_ITEMS: readonly PresetCatalogItem[] = [
  {
    id: "mindmap-right",
    titleKey: "mindmapPreset.directionRight",
    iconRotation: 0,
    getIcon: () => mindmapIcon,
    creation: { kind: "mindmap", direction: "left-to-right" },
  },
  {
    id: "mindmap-left",
    titleKey: "mindmapPreset.directionLeft",
    iconRotation: 180,
    getIcon: () => mindmapIcon,
    creation: { kind: "mindmap", direction: "right-to-left" },
  },
  {
    id: "mindmap-down",
    titleKey: "mindmapPreset.directionDown",
    iconRotation: 90,
    getIcon: () => mindmapIcon,
    creation: { kind: "mindmap", direction: "top-to-bottom" },
  },
  {
    id: "mindmap-up",
    titleKey: "mindmapPreset.directionUp",
    iconRotation: -90,
    getIcon: () => mindmapIcon,
    creation: { kind: "mindmap", direction: "bottom-to-top" },
  },
];

/**
 * 形状/预设的**唯一**目录，六个分组按抽屉的展示顺序排列。顶部 popover 与
 * 抽屉都从这里取数，禁止各渲染点自维护清单。
 */
export const SHAPE_CATALOG: readonly PresetCatalogGroup[] = [
  { id: "basic", titleKey: "shapeDrawer.basic", items: BASIC_ITEMS },
  {
    id: "flowchart",
    titleKey: "shapeDrawer.flowchart",
    items: FLOWCHART_ITEMS,
  },
  { id: "sticky", titleKey: "shapeDrawer.sticky", items: STICKY_ITEMS },
  { id: "frame", titleKey: "shapeDrawer.frame", items: FRAME_ITEMS },
  { id: "table", titleKey: "shapeDrawer.table", items: TABLE_ITEMS },
  { id: "mindmap", titleKey: "shapeDrawer.mindmap", items: MINDMAP_ITEMS },
];

/** 六个分组的全部条目，按目录顺序展平 —— 放置/拖拽按 id 查项时用 */
export const ALL_PRESET_ITEMS: readonly PresetCatalogItem[] =
  SHAPE_CATALOG.flatMap((group) => group.items);

const GROUP_BY_ID = new Map(
  SHAPE_CATALOG.map((group) => [group.id, group] as const),
);

export const getCatalogGroup = (
  id: PresetCatalogGroupId,
): PresetCatalogGroup => {
  const group = GROUP_BY_ID.get(id);
  if (!group) {
    throw new Error(`Unknown preset catalog group: ${id}`);
  }
  return group;
};

/** 按选项 id 取条目（id 在目录内唯一），未知 id 返回 `undefined` */
export const getCatalogItem = (id: string): PresetCatalogItem | undefined =>
  ALL_PRESET_ITEMS.find((item) => item.id === id);
