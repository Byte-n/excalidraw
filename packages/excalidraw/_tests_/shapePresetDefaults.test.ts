import { COLOR_PALETTE } from "@excalidraw/common";

import { getPresetShapeId } from "../components/app/createPresets";
import { getCatalogGroup } from "../components/presetCatalog";
import {
  SHAPE_PRESET_DEFAULTS,
  SHAPE_PRESET_STYLE,
  getShapePresetDefaults,
} from "../components/shapePresetDefaults";

/**
 * 展平的色板：`transparent`/`black`/`white` 等单值项 + 六个色族的各档。
 * 用来兜住填色里的错别字 hex —— 写错一位就不在集合里。
 */
const PALETTE_COLORS = Object.values(COLOR_PALETTE).flatMap((value) =>
  Array.isArray(value) ? [...value] : [value],
);

describe("SHAPE_PRESET_DEFAULTS", () => {
  it("键集合 == 目录 basic + flowchart + sequence 的预设 id 集合（加预设忘配默认值会红）", () => {
    const catalogIds = [
      ...getCatalogGroup("basic").items,
      ...getCatalogGroup("flowchart").items,
      ...getCatalogGroup("sequence").items,
    ].map((item) => item.id);

    expect(Object.keys(SHAPE_PRESET_DEFAULTS).sort()).toEqual(
      [...catalogIds].sort(),
    );
  });

  it("每个填色要么透明、要么是色板里的颜色（防错别字 hex）", () => {
    // 收集完再断言：失败时 diff 会直接列出越界的 id 与色值（Vitest 的 expect
    // 不接受 Jest 那种「第二参数当消息」的写法）
    const offPalette = Object.entries(SHAPE_PRESET_DEFAULTS)
      .filter(
        ([, preset]) =>
          preset.backgroundColor !== COLOR_PALETTE.transparent &&
          !PALETTE_COLORS.includes(preset.backgroundColor),
      )
      .map(([id, preset]) => `${id} = ${preset.backgroundColor}`);

    expect(offPalette).toEqual([]);
  });

  it("SHAPE_PRESET_STYLE 是那五个规范样式字段", () => {
    expect(SHAPE_PRESET_STYLE).toEqual({
      strokeColor: "#1f2329",
      strokeWidth: 1,
      strokeStyle: "solid",
      fillStyle: "solid",
      opacity: 100,
    });
  });

  /**
   * 53 行逐条对照样本：填色为**映射后**的色板值、尺寸取样本取整。表里写的是
   * 字面量（不是 `COLOR_PALETTE.*`），所以有人悄悄改实现表会在这一条上红。
   */
  const ROWS: {
    id: string;
    backgroundColor: string;
    width: number;
    height: number;
  }[] = [
    // —— 基础图形（29）——
    { id: "rectangle", backgroundColor: "#e8f0f8", width: 120, height: 120 },
    { id: "diamond", backgroundColor: "#fff3dc", width: 120, height: 120 },
    { id: "ellipse", backgroundColor: "#f0ebfc", width: 80, height: 80 },
    { id: "cross", backgroundColor: "#f0ebfc", width: 120, height: 120 },
    {
      id: "brace-reverse",
      backgroundColor: "transparent",
      width: 164,
      height: 120,
    },
    { id: "brace", backgroundColor: "transparent", width: 164, height: 120 },
    { id: "cloud", backgroundColor: "#f0ebfc", width: 120, height: 100 },
    {
      id: "double-arrow",
      backgroundColor: "#f0ebfc",
      width: 208,
      height: 96,
    },
    {
      id: "forward-arrow",
      backgroundColor: "#f0ebfc",
      width: 168,
      height: 96,
    },
    {
      id: "backward-arrow",
      backgroundColor: "#f0ebfc",
      width: 168,
      height: 96,
    },
    { id: "octagon", backgroundColor: "#c5d7e9", width: 120, height: 120 },
    { id: "pentagon", backgroundColor: "#c5d7e9", width: 88, height: 86 },
    { id: "hexagon", backgroundColor: "#f0ebfc", width: 98, height: 88 },
    { id: "star", backgroundColor: "#c5d7e9", width: 104, height: 100 },
    { id: "triangle", backgroundColor: "#f4f4f4", width: 108, height: 76 },
    {
      id: "right-triangle",
      backgroundColor: "#f4f4f4",
      width: 120,
      height: 80,
    },
    {
      id: "left-triangle",
      backgroundColor: "#f4f4f4",
      width: 120,
      height: 80,
    },
    { id: "round-rect", backgroundColor: "#e8f0f8", width: 120, height: 80 },
    {
      id: "rectangle-bubble",
      backgroundColor: "#c5d7e9",
      width: 120,
      height: 72,
    },
    { id: "pill", backgroundColor: "#f0ebfc", width: 120, height: 80 },
    { id: "bubble", backgroundColor: "#c5d7e9", width: 120, height: 80 },
    { id: "trapezoid", backgroundColor: "#f4f4f4", width: 120, height: 80 },
    {
      id: "parallelogram",
      backgroundColor: "#ebfbee",
      width: 120,
      height: 80,
    },
    {
      id: "right-pentagon",
      backgroundColor: "#e8f0f8",
      width: 160,
      height: 80,
    },
    { id: "step", backgroundColor: "#e8f0f8", width: 160, height: 80 },
    { id: "cube", backgroundColor: "#f0ebfc", width: 148, height: 106 },
    { id: "cylinder", backgroundColor: "#ebfbee", width: 80, height: 67 },
    { id: "pie", backgroundColor: "#f0ebfc", width: 110, height: 110 },
    {
      id: "circular-ring",
      backgroundColor: "#f0ebfc",
      width: 110,
      height: 110,
    },

    // —— 流程图图形（14）——
    {
      id: "fc-round-rect",
      backgroundColor: "#e8f0f8",
      width: 120,
      height: 80,
    },
    {
      id: "fc-terminator",
      backgroundColor: "#f0ebfc",
      width: 120,
      height: 80,
    },
    { id: "fc-diamond", backgroundColor: "#fff3dc", width: 120, height: 80 },
    { id: "fc-document", backgroundColor: "#c5d7e9", width: 120, height: 80 },
    {
      id: "fc-parallelogram",
      backgroundColor: "#ebfbee",
      width: 120,
      height: 80,
    },
    { id: "fc-cylinder", backgroundColor: "#ebfbee", width: 80, height: 100 },
    {
      id: "fc-horiz-cylinder",
      backgroundColor: "#ebfbee",
      width: 120,
      height: 80,
    },
    {
      id: "fc-predefined-process",
      backgroundColor: "#f0ebfc",
      width: 120,
      height: 80,
    },
    {
      id: "fc-manual-input",
      backgroundColor: "#f4f4f4",
      width: 120,
      height: 80,
    },
    { id: "fc-trapezoid", backgroundColor: "#f4f4f4", width: 120, height: 80 },
    { id: "fc-delay", backgroundColor: "#f0ebfc", width: 120, height: 80 },
    { id: "fc-hexagon", backgroundColor: "#f0ebfc", width: 130, height: 80 },
    {
      id: "fc-off-page-connector",
      backgroundColor: "#c5d7e9",
      width: 120,
      height: 100,
    },
    { id: "fc-circle", backgroundColor: "#ebfbee", width: 80, height: 80 },

    // —— 时序图形（10）——
    // 生命线填色来自样本 `#f0f4fc` → blue[0]；尺寸 = 头部盒宽 ×（头部高 + 360）
    {
      id: "sc-lifeline-entity",
      backgroundColor: "#e8f0f8",
      width: 64,
      height: 428.272,
    },
    {
      id: "sc-lifeline-control",
      backgroundColor: "#e8f0f8",
      width: 64,
      height: 434.272,
    },
    {
      id: "sc-lifeline-boundary",
      backgroundColor: "#e8f0f8",
      width: 76,
      height: 428.272,
    },
    {
      id: "sc-lifeline-actor",
      backgroundColor: "#e8f0f8",
      width: 84,
      height: 478.272,
    },
    {
      id: "sc-lifeline-queue",
      backgroundColor: "#e8f0f8",
      width: 100,
      height: 420,
    },
    {
      id: "sc-lifeline-data-base",
      backgroundColor: "#e8f0f8",
      width: 68,
      height: 450,
    },
    {
      id: "sc-lifeline-object",
      backgroundColor: "#e8f0f8",
      width: 120,
      height: 420,
    },
    {
      id: "sc-lifeline-collection",
      backgroundColor: "#e8f0f8",
      width: 118,
      height: 428,
    },
    { id: "sc-activation", backgroundColor: "#c5d7e9", width: 30, height: 100 },
    { id: "sc-fragment", backgroundColor: "#f4f4f4", width: 400, height: 240 },
  ];

  it("恰好 53 行（29 基础 + 14 流程图 + 10 时序），与表本身逐条对照", () => {
    expect(ROWS).toHaveLength(53);
    expect(Object.keys(SHAPE_PRESET_DEFAULTS)).toHaveLength(53);
  });

  it.each(ROWS)(
    "$id 的默认填色与尺寸",
    ({ id, backgroundColor, width, height }) => {
      expect(
        SHAPE_PRESET_DEFAULTS[id as keyof typeof SHAPE_PRESET_DEFAULTS],
      ).toEqual({ backgroundColor, width, height });
    },
  );

  it("getShapePresetDefaults 未命中返回 undefined", () => {
    expect(getShapePresetDefaults(undefined)).toBeUndefined();
    expect(getShapePresetDefaults("not-a-preset")).toBeUndefined();
    expect(getShapePresetDefaults("fc-cylinder")).toEqual(
      SHAPE_PRESET_DEFAULTS["fc-cylinder"],
    );
  });
});

describe("getPresetShapeId", () => {
  it("三角形伪 id 原样返回（三角形分类三个预设持久化后同为 triangle）", () => {
    expect(getPresetShapeId("rectangle", "right-triangle")).toBe(
      "right-triangle",
    );
    expect(getPresetShapeId("rectangle", "left-triangle")).toBe(
      "left-triangle",
    );
  });

  it("菱形/椭圆工具各自成键，忽略当前图形", () => {
    expect(getPresetShapeId("diamond", "fc-diamond")).toBe("diamond");
    expect(getPresetShapeId("ellipse", undefined)).toBe("ellipse");
  });

  it("矩形工具用「当前图形」，缺省时用工具本身", () => {
    expect(getPresetShapeId("rectangle", "fc-cylinder")).toBe("fc-cylinder");
    expect(getPresetShapeId("rectangle", undefined)).toBe("rectangle");
    expect(getPresetShapeId("stickynote", undefined)).toBe("stickynote");
  });
});
