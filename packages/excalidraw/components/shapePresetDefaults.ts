import {
  COLOR_PALETTE,
  DEFAULT_NEW_ELEMENT_STROKE_COLOR,
  STROKE_WIDTH,
} from "@excalidraw/common";

import type { GenericShapeId } from "./presetCatalog";

/**
 * 预设图形的**默认填充色与默认尺寸**表（43 行：29 个基础图形 + 14 个流程图图形）。
 *
 * 取值来源是平台样本（Lark 侧 `composite_shape`）——
 * `docs/lark-exmples/flow-chart/lark-examples-data.json` 与
 * `docs/lark-exmples/composite-shape/lark-examples-data.json`：
 * `fill_color` 逐条映射到本项目色板，尺寸取样本值，**小数一律取整**——与
 * `packages/element/src/tableStruct.ts:213-218` 的先例同理，样本里的小数是铺满
 * 容器留下的零头（`120.01591→120`、`67.23313→67`、`104.01379→104`），预设是
 * 创建起点不是格式约束，整数让落点、网格吸附和尺寸断言都干净。
 *
 * 填色映射规则是**保色相、族内取最近档**，不是 RGB 全局最近。特别提醒：
 * `#f0f4fc` 的 RGB 最近色其实是 `gray[0]`（d≈8.9）而非 `blue[0]`（d≈9.8），
 * `#d6dcf3` 的 RGB 最近色是 `violet[1]` 而非 `blue[1]` —— 但它们显然是蓝系，
 * 故取蓝族。**不要因为「更近」就顺手把这几个值修正成灰/紫**。
 *
 * `#d6dcf3` 刻意取 `blue[1]` 而非 `blue[0]`：样本里它与 `#f0f4fc` 是同一蓝系
 * 的深浅两级（浅档给 rect/round-rect/step，深档给 star/octagon/pentagon/
 * bubble/文档/跨页引用），取 `blue[0]` 会把这两级压成同色；代价是偏离「背景
 * 一律取各族 index 0」的既有约定。
 *
 * 深色主题**不特殊处理**：色板色在渲染期统一过 `applyDarkModeFilter`。
 *
 * 这张表放在 app 包是刻意的、也是结构性的约束——`packages/element` 不允许反向
 * 依赖 app 包，所以元素层的 `newElement` / `duplicateElement` 物理上读不到它，
 * 复制、转换（`ConvertElementTypePopup`）、方向手柄 quick create 因此**不可能**
 * 被套上默认样式。放 `components/` 而非 `components/app/`，是为了让
 * `presetCatalog.tsx` 不必反向 import `app/`。
 */

/** 单个预设图形的默认填充色与默认尺寸 */
export type ShapePresetDefault = {
  backgroundColor: string;
  width: number;
  height: number;
};

/**
 * 全部 43 个预设共用的**规范样式**（除 shape / 填色 / 尺寸外完全一致，
 * 文本为空）。逐项对应样本：`strokeColor` = `DEFAULT_NEW_ELEMENT_STROKE_COLOR`
 * （`#1f2329` 既是 `#000000` 的最近色板色也是项目墨色）、`strokeWidth` =
 * `STROKE_WIDTH.thin`（1，对应样本 `narrow`）、`strokeStyle` = `solid`、
 * `fillStyle` = `solid`、`opacity` = 100（对应样本 `border_opacity`/`fill_opacity`
 * 100）。圆角、字号、文本不动。
 */
export const SHAPE_PRESET_STYLE = {
  strokeColor: DEFAULT_NEW_ELEMENT_STROKE_COLOR, // #1f2329
  strokeWidth: STROKE_WIDTH.thin, // 1
  strokeStyle: "solid",
  fillStyle: "solid",
  opacity: 100,
} as const;

/**
 * 43 行默认值：key 用 `GenericShapeId`（`import type` 自 `./presetCatalog`），
 * 目录里加预设而忘配默认值会直接 typecheck 失败。顺序为基础组（`BASIC_SHAPE_IDS`
 * 顺序）在前，14 个 `fc-*` 在后。
 */
export const SHAPE_PRESET_DEFAULTS: Readonly<
  Record<GenericShapeId, ShapePresetDefault>
> = {
  // —— 基础图形（29）——
  rectangle: {
    backgroundColor: COLOR_PALETTE.blue[0],
    width: 120,
    height: 120,
  },
  diamond: {
    backgroundColor: COLOR_PALETTE.yellow[0],
    width: 120,
    height: 120,
  },
  ellipse: { backgroundColor: COLOR_PALETTE.violet[0], width: 80, height: 80 },
  cross: { backgroundColor: COLOR_PALETTE.violet[0], width: 120, height: 120 },
  // 括号系样本本身无 fill_color → 透明，与既有 isCompositeShapeOpen 的强制
  // transparent 一致，无需特判
  "brace-reverse": {
    backgroundColor: COLOR_PALETTE.transparent,
    width: 164,
    height: 120,
  },
  brace: {
    backgroundColor: COLOR_PALETTE.transparent,
    width: 164,
    height: 120,
  },
  cloud: { backgroundColor: COLOR_PALETTE.violet[0], width: 120, height: 100 },
  "double-arrow": {
    backgroundColor: COLOR_PALETTE.violet[0],
    width: 208,
    height: 96,
  },
  "forward-arrow": {
    backgroundColor: COLOR_PALETTE.violet[0],
    width: 168,
    height: 96,
  },
  "backward-arrow": {
    backgroundColor: COLOR_PALETTE.violet[0],
    width: 168,
    height: 96,
  },
  octagon: { backgroundColor: COLOR_PALETTE.blue[1], width: 120, height: 120 },
  pentagon: { backgroundColor: COLOR_PALETTE.blue[1], width: 88, height: 86 },
  hexagon: { backgroundColor: COLOR_PALETTE.violet[0], width: 98, height: 88 },
  star: { backgroundColor: COLOR_PALETTE.blue[1], width: 104, height: 100 },
  // 三个三角形是三个独立的 `shape.id`，默认尺寸各自不同：
  // triangle 108×76、right-triangle / left-triangle 120×80
  triangle: { backgroundColor: COLOR_PALETTE.gray[0], width: 108, height: 76 },
  "right-triangle": {
    backgroundColor: COLOR_PALETTE.gray[0],
    width: 120,
    height: 80,
  },
  "left-triangle": {
    backgroundColor: COLOR_PALETTE.gray[0],
    width: 120,
    height: 80,
  },
  "round-rect": {
    backgroundColor: COLOR_PALETTE.blue[0],
    width: 120,
    height: 80,
  },
  "rectangle-bubble": {
    backgroundColor: COLOR_PALETTE.blue[1],
    width: 120,
    height: 72,
  },
  pill: { backgroundColor: COLOR_PALETTE.violet[0], width: 120, height: 80 },
  bubble: { backgroundColor: COLOR_PALETTE.blue[1], width: 120, height: 80 },
  trapezoid: { backgroundColor: COLOR_PALETTE.gray[0], width: 120, height: 80 },
  parallelogram: {
    backgroundColor: COLOR_PALETTE.green[0],
    width: 120,
    height: 80,
  },
  "right-pentagon": {
    backgroundColor: COLOR_PALETTE.blue[0],
    width: 160,
    height: 80,
  },
  step: { backgroundColor: COLOR_PALETTE.blue[0], width: 160, height: 80 },
  cube: { backgroundColor: COLOR_PALETTE.violet[0], width: 148, height: 106 },
  cylinder: { backgroundColor: COLOR_PALETTE.green[0], width: 80, height: 67 },
  pie: { backgroundColor: COLOR_PALETTE.violet[0], width: 110, height: 110 },
  "circular-ring": {
    backgroundColor: COLOR_PALETTE.violet[0],
    width: 110,
    height: 110,
  },

  // —— 流程图图形（14）——
  "fc-round-rect": {
    backgroundColor: COLOR_PALETTE.blue[0],
    width: 120,
    height: 80,
  },
  "fc-terminator": {
    backgroundColor: COLOR_PALETTE.violet[0],
    width: 120,
    height: 80,
  },
  "fc-diamond": {
    backgroundColor: COLOR_PALETTE.yellow[0],
    width: 120,
    height: 80,
  },
  "fc-document": {
    backgroundColor: COLOR_PALETTE.blue[1],
    width: 120,
    height: 80,
  },
  "fc-parallelogram": {
    backgroundColor: COLOR_PALETTE.green[0],
    width: 120,
    height: 80,
  },
  "fc-cylinder": {
    backgroundColor: COLOR_PALETTE.green[0],
    width: 80,
    height: 100,
  },
  "fc-horiz-cylinder": {
    backgroundColor: COLOR_PALETTE.green[0],
    width: 120,
    height: 80,
  },
  "fc-predefined-process": {
    backgroundColor: COLOR_PALETTE.violet[0],
    width: 120,
    height: 80,
  },
  "fc-manual-input": {
    backgroundColor: COLOR_PALETTE.gray[0],
    width: 120,
    height: 80,
  },
  "fc-trapezoid": {
    backgroundColor: COLOR_PALETTE.gray[0],
    width: 120,
    height: 80,
  },
  "fc-delay": {
    backgroundColor: COLOR_PALETTE.violet[0],
    width: 120,
    height: 80,
  },
  "fc-hexagon": {
    backgroundColor: COLOR_PALETTE.violet[0],
    width: 130,
    height: 80,
  },
  "fc-off-page-connector": {
    backgroundColor: COLOR_PALETTE.blue[1],
    width: 120,
    height: 100,
  },
  "fc-circle": {
    backgroundColor: COLOR_PALETTE.green[0],
    width: 80,
    height: 80,
  },
};

/**
 * 查表用的宽松视图：运行时按字符串查，未命中返回 `undefined`（调用点会回落到
 * `PRESET_SIZES` 或元素自带尺寸）。索引签名让 `string` 键查表通过类型检查。
 */
const PRESET_DEFAULTS_BY_ID: Readonly<
  Record<string, ShapePresetDefault | undefined>
> = SHAPE_PRESET_DEFAULTS;

/** 按预设 id 取默认填充色与尺寸，未命中返回 `undefined` */
export const getShapePresetDefaults = (
  presetId: string | undefined,
): ShapePresetDefault | undefined =>
  presetId === undefined ? undefined : PRESET_DEFAULTS_BY_ID[presetId];
