import { BOUND_TEXT_PADDING } from "@excalidraw/common";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { newElementWith } from "../src/mutateElement";
import {
  newElement,
  newFreeDrawElement,
  newImageElement,
  newMindmapNodeElement,
} from "../src/newElement";
import {
  getPrimaryTextRegion,
  getTextRegion,
  getTextRegionAtPosition,
  getTextRegions,
} from "../src/text/regions";

import type { TextRegionRect } from "../src/text/types";
import type { MindmapNodeShape } from "../src/types";

const SHAPE_SIZE = { width: 200, height: 100 } as const;

const makeShape = (
  type: "rectangle" | "ellipse" | "diamond",
  overrides: { textFitMode?: "auto" | "fixed" } = {},
) =>
  newElement({
    type,
    x: 0,
    y: 0,
    ...SHAPE_SIZE,
    ...overrides,
  });

const makeMindmapNode = (
  shape: MindmapNodeShape,
  role: "root" | "node" = "root",
) =>
  role === "root"
    ? newMindmapNodeElement({
        x: 0,
        y: 0,
        ...SHAPE_SIZE,
        graphId: "g",
        shape,
        role,
        parentId: null,
        order: null,
      })
    : newMindmapNodeElement({
        x: 0,
        y: 0,
        ...SHAPE_SIZE,
        graphId: "g",
        shape,
        role,
        parentId: "p",
        order: null,
      });

const areaOf = (bounds: TextRegionRect) => bounds.width * bounds.height;

const centerOf = (bounds: TextRegionRect): LocalPoint =>
  pointFrom<LocalPoint>(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );

describe("getTextRegions", () => {
  it("为矩形复合形状声明唯一的可编辑正文区域", () => {
    const rectangle = makeShape("rectangle");
    const regions = getTextRegions(rectangle);

    expect(regions).toHaveLength(1);
    const [body] = regions;
    expect(body.key).toBe("body");
    expect(body.editable).toBe(true);
    expect(body.wrap).toBe("wrap");
    expect(body.overflow).toBe("grow");
    expect(body.reflow).toBe("element");

    // 安全区必须落在元素局部坐标内
    expect(body.bounds.x).toBeGreaterThanOrEqual(0);
    expect(body.bounds.y).toBeGreaterThanOrEqual(0);
    expect(body.bounds.x + body.bounds.width).toBeLessThanOrEqual(
      SHAPE_SIZE.width,
    );
    expect(body.bounds.y + body.bounds.height).toBeLessThanOrEqual(
      SHAPE_SIZE.height,
    );

    expect(getTextRegion(rectangle, "body")).toEqual(body);
    expect(getTextRegion(rectangle, "title")).toBeNull();
    expect(getPrimaryTextRegion(rectangle)).toEqual(body);
  });

  it("椭圆与菱形的文本安全区都小于同尺寸矩形", () => {
    const rectangleArea = areaOf(
      getTextRegions(makeShape("rectangle"))[0].bounds,
    );

    expect(areaOf(getTextRegions(makeShape("ellipse"))[0].bounds)).toBeLessThan(
      rectangleArea,
    );
    expect(areaOf(getTextRegions(makeShape("diamond"))[0].bounds)).toBeLessThan(
      rectangleArea,
    );
  });

  it("文本适配模式跟随形状的 textFitMode", () => {
    const fixed = makeShape("rectangle", { textFitMode: "fixed" });

    expect(getTextRegions(fixed)[0].overflow).toBe("clip");
    expect(getTextRegions(fixed)[0].reflow).toBe("none");
  });

  it("非形状元素没有文本区域", () => {
    const freedraw = newFreeDrawElement({
      type: "freedraw",
      x: 0,
      y: 0,
      simulatePressure: true,
    });
    const image = newImageElement({
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    expect(getTextRegions(freedraw)).toEqual([]);
    expect(getTextRegions(image)).toEqual([]);
    expect(getPrimaryTextRegion(image)).toBeNull();
  });
});

describe("getTextRegions 脑图节点", () => {
  it("为根节点与子节点声明唯一的可编辑正文区域", () => {
    for (const role of ["root", "node"] as const) {
      const node = makeMindmapNode("rectangle", role);
      const regions = getTextRegions(node);

      expect(regions).toHaveLength(1);
      const [body] = regions;
      expect(body.key).toBe("body");
      expect(body.editable).toBe(true);
      expect(body.wrap).toBe("wrap");
      expect(body.overflow).toBe("grow");
      expect(body.reflow).toBe("graph");
      expect(getTextRegion(node, "body")).toEqual(body);
      expect(getPrimaryTextRegion(node)).toEqual(body);
    }
  });

  it("矩形与文字形态使用固定内边距的安全区", () => {
    const expected: TextRegionRect = {
      x: BOUND_TEXT_PADDING,
      y: BOUND_TEXT_PADDING,
      width: SHAPE_SIZE.width - BOUND_TEXT_PADDING * 2,
      height: SHAPE_SIZE.height - BOUND_TEXT_PADDING * 2,
    };

    expect(getTextRegions(makeMindmapNode("rectangle"))[0].bounds).toEqual(
      expected,
    );
    expect(getTextRegions(makeMindmapNode("text"))[0].bounds).toEqual(expected);
  });

  it("椭圆与胶囊形态使用内接矩形安全区", () => {
    const expected: TextRegionRect = {
      x: BOUND_TEXT_PADDING + (SHAPE_SIZE.width / 2) * (1 - Math.sqrt(2) / 2),
      y: BOUND_TEXT_PADDING + (SHAPE_SIZE.height / 2) * (1 - Math.sqrt(2) / 2),
      width:
        Math.round((SHAPE_SIZE.width / 2) * Math.sqrt(2)) -
        BOUND_TEXT_PADDING * 2,
      height:
        Math.round((SHAPE_SIZE.height / 2) * Math.sqrt(2)) -
        BOUND_TEXT_PADDING * 2,
    };

    expect(getTextRegions(makeMindmapNode("ellipse"))[0].bounds).toEqual(
      expected,
    );
    expect(getTextRegions(makeMindmapNode("pill"))[0].bounds).toEqual(expected);
  });

  it("菱形形态使用内接矩形安全区", () => {
    const expected: TextRegionRect = {
      x: BOUND_TEXT_PADDING + SHAPE_SIZE.width / 4,
      y: BOUND_TEXT_PADDING + SHAPE_SIZE.height / 4,
      width: Math.round(SHAPE_SIZE.width / 2) - BOUND_TEXT_PADDING * 2,
      height: Math.round(SHAPE_SIZE.height / 2) - BOUND_TEXT_PADDING * 2,
    };

    expect(getTextRegions(makeMindmapNode("diamond"))[0].bounds).toEqual(
      expected,
    );
  });

  it("几何被冻结时正文改为定高截断", () => {
    const node = newElementWith(makeMindmapNode("rectangle"), {
      layoutFrozen: true,
    });

    expect(getTextRegions(node)[0].overflow).toBe("clip");
    expect(getTextRegions(node)[0].reflow).toBe("none");
  });

  it("正文区域中心命中 body", () => {
    const node = makeMindmapNode("diamond");
    const body = getTextRegions(node)[0];

    expect(getTextRegionAtPosition(node, centerOf(body.bounds))).toBe("body");
  });
});

describe("getTextRegions 数据流处理图形", () => {
  const PROCESS_SIZE = { width: 152, height: 137 } as const;
  const makeProcess = () =>
    newElement({
      type: "df-process",
      x: 0,
      y: 0,
      ...PROCESS_SIZE,
    });

  it("标题栏在前、正文在后，两个区域都可编辑", () => {
    const process = makeProcess();
    const regions = getTextRegions(process);

    expect(regions.map((region) => region.key)).toEqual(["title", "body"]);

    const [title, body] = regions;
    expect(title).toMatchObject({
      key: "title",
      wrap: "single-line",
      overflow: "clip",
      reflow: "none",
      editable: true,
    });
    expect(title.bounds).toEqual({
      x: 2,
      y: 2,
      width: PROCESS_SIZE.width - 4,
      height: 24,
    });

    expect(body).toMatchObject({
      key: "body",
      wrap: "wrap",
      overflow: "grow",
      reflow: "element",
    });
    // 正文安全区从标题分隔线下方开始，不与标题栏重叠
    expect(body.bounds.y).toBeGreaterThanOrEqual(28);
    expect(body.bounds.y + body.bounds.height).toBeLessThanOrEqual(
      PROCESS_SIZE.height,
    );

    expect(getTextRegion(process, "title")).toEqual(title);
    expect(getTextRegion(process, "body")).toEqual(body);
    expect(getPrimaryTextRegion(process)).toEqual(body);
  });

  it("命中测试先落到标题栏，再落到正文", () => {
    const process = makeProcess();
    const [title, body] = getTextRegions(process);

    expect(getTextRegionAtPosition(process, centerOf(title.bounds))).toBe(
      "title",
    );
    expect(getTextRegionAtPosition(process, centerOf(body.bounds))).toBe(
      "body",
    );
  });

  it("其他数据流图形仍然只有正文区域", () => {
    const entity = newElement({
      type: "df-external-entity",
      x: 0,
      y: 0,
      ...PROCESS_SIZE,
    });

    expect(getTextRegions(entity).map((region) => region.key)).toEqual([
      "body",
    ]);
    expect(getTextRegion(entity, "title")).toBeNull();
  });
});

describe("getTextRegionAtPosition", () => {
  it("中心点命中正文区域，区域外返回 null", () => {
    const rectangle = makeShape("rectangle");
    const body = getTextRegions(rectangle)[0];

    expect(getTextRegionAtPosition(rectangle, centerOf(body.bounds))).toBe(
      "body",
    );

    expect(
      getTextRegionAtPosition(
        rectangle,
        pointFrom<LocalPoint>(-1, centerOf(body.bounds)[1]),
      ),
    ).toBeNull();
  });
});
