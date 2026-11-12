import {
  COLOR_PALETTE,
  DEFAULT_NEW_ELEMENT_STROKE_COLOR,
  STROKE_WIDTH,
} from "@excalidraw/common";

import {
  SEQUENCE_ACTIVATION_HEIGHT,
  SEQUENCE_ACTIVATION_WIDTH,
  getSequenceLifelineDefaultSize,
} from "@excalidraw/element";

import type { GenericShapeId } from "./presetCatalog";

/**
 * 预设图形的**默认填充色、描边色与默认尺寸**表（53 行：29 个基础图形 + 14 个
 * 流程图图形 + 10 个时序图形）。
 *
 * 取值来源是平台样本（Lark 侧 `composite`）——
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
 * 时序图（10 个 `sc-*`）以 `docs/lark-exmples/sequence/lark-sequence.pdf` 为准：
 * 描边是纯黑 `#000000` → `black`（`#1e1e1e`）；fragment 只有 operator 页签
 * 有填充，样本 `#f5f5f5` → `gray[0]`（`#f4f4f4`），外框仍只描边。
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
  /**
   * 可选的描边色覆盖。缺省时用 `SHAPE_PRESET_STYLE.strokeColor`（项目墨色
   * `#1f2329`）；时序图的样本描边是纯黑 `#000000`，取色板里最近的 `black`
   * （`#1e1e1e`），因此 10 个 `sc-*` 预设显式覆盖它。
   */
  strokeColor?: string;
};

/**
 * 预设共用的**规范样式**（除 shape / 填色 / 尺寸外完全一致，文本为空）。
 * 逐项对应样本：`strokeColor` = `DEFAULT_NEW_ELEMENT_STROKE_COLOR`
 * （`#1f2329`，项目墨色）、`strokeWidth` = `STROKE_WIDTH.thin`（1，对应样本
 * `narrow`）、`strokeStyle` = `solid`、`fillStyle` = `solid`、`opacity` = 100
 * （对应样本 `border_opacity`/`fill_opacity` 100）。圆角、字号、文本不动。
 *
 * 单个预设可用 `ShapePresetDefault.strokeColor` 覆盖描边色；10 个 `sc-*`
 * 时序图形按样本 `#000000` 取 `COLOR_PALETTE.black`，其余 43 个沿用本表。
 */
export const SHAPE_PRESET_STYLE = {
  strokeColor: DEFAULT_NEW_ELEMENT_STROKE_COLOR, // #1f2329
  strokeWidth: STROKE_WIDTH.thin, // 1
  strokeStyle: "solid",
  fillStyle: "solid",
  opacity: 100,
} as const;

/**
 * 53 行默认值：key 用 `GenericShapeId`（`import type` 自 `./presetCatalog`），
 * 目录里加预设而忘配默认值会直接 typecheck 失败。顺序为基础组（`BASIC_SHAPE_IDS`
 * 顺序）在前，14 个 `fc-*`、10 个 `sc-*` 依次在后。
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

  // —— 时序图形（10）——
  // 描边统一取样本 `#000000` 的色板最近色 `COLOR_PALETTE.black`（`#1e1e1e`）：
  // 其余 43 个预设沿用 `SHAPE_PRESET_STYLE` 的墨色 `#1f2329`。
  //
  // 8 个生命线填色来自样本 `#f0f4fc`（蓝系浅档，与 round-rect 同源 → blue[0]）；
  // 尺寸 = 头部盒宽 ×（头部高 + 360 虚线杆），头部高逐 id 取自样本。
  "sc-lifeline-entity": {
    backgroundColor: COLOR_PALETTE.blue[0],
    strokeColor: COLOR_PALETTE.black,
    ...getSequenceLifelineDefaultSize("sc-lifeline-entity"),
  },
  "sc-lifeline-control": {
    backgroundColor: COLOR_PALETTE.blue[0],
    strokeColor: COLOR_PALETTE.black,
    ...getSequenceLifelineDefaultSize("sc-lifeline-control"),
  },
  "sc-lifeline-boundary": {
    backgroundColor: COLOR_PALETTE.blue[0],
    strokeColor: COLOR_PALETTE.black,
    ...getSequenceLifelineDefaultSize("sc-lifeline-boundary"),
  },
  "sc-lifeline-actor": {
    backgroundColor: COLOR_PALETTE.blue[0],
    strokeColor: COLOR_PALETTE.black,
    ...getSequenceLifelineDefaultSize("sc-lifeline-actor"),
  },
  "sc-lifeline-queue": {
    backgroundColor: COLOR_PALETTE.blue[0],
    strokeColor: COLOR_PALETTE.black,
    ...getSequenceLifelineDefaultSize("sc-lifeline-queue"),
  },
  "sc-lifeline-data-base": {
    backgroundColor: COLOR_PALETTE.blue[0],
    strokeColor: COLOR_PALETTE.black,
    ...getSequenceLifelineDefaultSize("sc-lifeline-data-base"),
  },
  "sc-lifeline-object": {
    backgroundColor: COLOR_PALETTE.blue[0],
    strokeColor: COLOR_PALETTE.black,
    ...getSequenceLifelineDefaultSize("sc-lifeline-object"),
  },
  "sc-lifeline-collection": {
    backgroundColor: COLOR_PALETTE.blue[0],
    strokeColor: COLOR_PALETTE.black,
    ...getSequenceLifelineDefaultSize("sc-lifeline-collection"),
  },
  // 激活条样本填 `#d6dcf3`（蓝系深档，与 fc 的 blue[1] 规则一致）
  "sc-activation": {
    backgroundColor: COLOR_PALETTE.blue[1],
    strokeColor: COLOR_PALETTE.black,
    width: SEQUENCE_ACTIVATION_WIDTH,
    height: SEQUENCE_ACTIVATION_HEIGHT,
  },
  // 组合片段外框无底色，只有 operator 页签有填充：样本页签是 `#f5f5f5`
  // （取色板最近色 `gray[0]` `#f4f4f4`）。`drawShadedFaces` 只把 fillFaces
  // （页签）涂成 backgroundColor，外框仍只描边。
  "sc-fragment": {
    backgroundColor: COLOR_PALETTE.gray[0],
    strokeColor: COLOR_PALETTE.black,
    width: 400,
    height: 240,
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
