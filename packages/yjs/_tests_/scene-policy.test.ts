import { describe, expect, test } from "vitest";

import {
  assertAssetPolicy,
  assertScenePolicy,
  jsonBytes,
  measureSceneCapacity,
} from "../src/scene-policy";

import { element, scenePolicy } from "./helpers";

import type { YjsSceneError } from "../src/errors";

import type { SceneSnapshot } from "../src/types";
import type { TestAsset } from "./helpers";

const scene = (
  elements: ReturnType<typeof element>[],
  assets: Record<string, TestAsset> = {},
): SceneSnapshot<ReturnType<typeof element>, TestAsset> => ({
  elements,
  assets,
});

const failure = (run: () => void) => {
  try {
    run();
  } catch (error) {
    return error as YjsSceneError;
  }
  throw new Error("expected the scene policy to reject");
};

const textBlock = (text: string) => ({
  text,
  style: {
    fontFamily: 1,
    fontSize: 20,
    lineHeight: 1.25,
    textAlign: "left",
    verticalAlign: "top",
  },
});

const region = (id: string, type: string, regions: Record<string, string>) =>
  element(id, 0, {
    type,
    texts: Object.fromEntries(
      Object.entries(regions).map(([key, content]) => [
        key,
        textBlock(content),
      ]),
    ),
  });

const text = (id: string, content: string) =>
  region(id, "text", { body: content });

const table = (id: string, rows: number, columns: number, cells: number) =>
  element(id, 0, {
    type: "table",
    table: {
      schemaVersion: 1,
      rows: Array.from({ length: rows }, (_, index) => ({
        id: `row-${index}`,
      })),
      columns: Array.from({ length: columns }, (_, index) => ({
        id: `column-${index}`,
      })),
      cells: Array.from({ length: cells }, (_, index) => {
        const row = index % Math.max(rows, 1);
        const column = Math.floor(index / Math.max(rows, 1));
        return {
          id: `cell-${index}`,
          rowId: `row-${row}`,
          columnId: `column-${column}`,
          style: {},
        };
      }),
    },
  });

const tableCell = (id: string, content: string) =>
  element(id, 0, {
    type: "text",
    containerRef: {
      kind: "tableCell",
      elementId: "table",
      cellId: id,
      role: "content",
    },
    texts: { body: textBlock(content) },
  });

const image = (id: string, fileId: string) =>
  element(id, 0, {
    type: "image",
    fileId,
    status: "saved",
    scale: [1, 1],
    crop: null,
  });

describe("场景门槛", () => {
  test("元素数、资产数、单元素与整场景字节超限抛 scene_limit_exceeded 并携带计量项", () => {
    const elements = failure(() =>
      assertScenePolicy(
        scene([element("a"), element("b")]),
        scenePolicy({ maxElements: 1 }),
      ),
    );
    expect(elements.code).toBe("scene_limit_exceeded");
    expect(elements.capacity).toEqual({
      metric: "elements",
      actual: 2,
      allowed: 1,
    });

    const assets = failure(() =>
      assertScenePolicy(
        scene([element("a")], { f: { size: 3, mimeType: "image/png" } }),
        scenePolicy({ maxAssets: 0 }),
      ),
    );
    expect(assets.code).toBe("scene_limit_exceeded");
    expect(assets.capacity).toEqual({
      metric: "assets",
      actual: 1,
      allowed: 0,
    });

    const elementBytes = failure(() =>
      assertScenePolicy(
        scene([element("a")]),
        scenePolicy({ maxElementBytes: 10 }),
      ),
    );
    expect(elementBytes.code).toBe("scene_limit_exceeded");
    expect(elementBytes.capacity?.metric).toBe("elementBytes");
    expect(elementBytes.capacity?.allowed).toBe(10);

    const sceneBytes = failure(() =>
      assertScenePolicy(
        scene([element("a")]),
        scenePolicy({ maxSceneBytes: 10 }),
      ),
    );
    expect(sceneBytes.code).toBe("scene_limit_exceeded");
    expect(sceneBytes.capacity?.metric).toBe("sceneBytes");
    expect(sceneBytes.capacity?.allowed).toBe(10);
  });

  test("重复元素 ID 抛 invalid_scene 且不携带容量字段", () => {
    const error = failure(() =>
      assertScenePolicy(scene([element("a"), element("a")]), scenePolicy()),
    );
    expect(error.code).toBe("invalid_scene");
    expect(error.capacity).toBeUndefined();
  });

  test("每个文本区域独立按码点限制", () => {
    for (const key of ["body", "title", "label", "cell:x", "row:y"]) {
      expect(() =>
        assertScenePolicy(
          scene([region("a", "text", { [key]: "x".repeat(1_500) })]),
          scenePolicy(),
        ),
      ).not.toThrow();
      const error = failure(() =>
        assertScenePolicy(
          scene([region("a", "text", { [key]: "x".repeat(1_501) })]),
          scenePolicy(),
        ),
      );
      expect(error.code).toBe("scene_limit_exceeded");
      expect(error.capacity).toEqual({
        metric: "textChars",
        actual: 1_501,
        allowed: 1_500,
      });
    }
    // 同一元素多个区域各自拥有独立预算，不按元素合计。
    expect(() =>
      assertScenePolicy(
        scene([
          region("a", "text", {
            body: "x".repeat(1_500),
            title: "x".repeat(1_500),
          }),
        ]),
        scenePolicy(),
      ),
    ).not.toThrow();
  });

  test("文本按 Unicode 码点计量", () => {
    expect(() =>
      assertScenePolicy(scene([text("a", "😀".repeat(1_500))]), scenePolicy()),
    ).not.toThrow();
    const error = failure(() =>
      assertScenePolicy(scene([text("a", "😀".repeat(1_501))]), scenePolicy()),
    );
    expect(error.capacity).toEqual({
      metric: "textChars",
      actual: 1_501,
      allowed: 1_500,
    });
  });

  test("非文本元素与表格元素的文本区域同样受限", () => {
    const shape = failure(() =>
      assertScenePolicy(
        scene([region("a", "composite", { body: "x".repeat(1_501) })]),
        scenePolicy(),
      ),
    );
    expect(shape.code).toBe("scene_limit_exceeded");
    expect(shape.capacity?.metric).toBe("textChars");

    const cell = failure(() =>
      assertScenePolicy(
        scene([region("table", "table", { "cell:x": "x".repeat(1_501) })]),
        scenePolicy(),
      ),
    );
    expect(cell.code).toBe("scene_limit_exceeded");
    expect(cell.capacity?.metric).toBe("textChars");
  });

  test("文本区域上限独立于元素字节上限", () => {
    const error = failure(() =>
      assertScenePolicy(
        scene([text("a", "ab")]),
        scenePolicy({ maxElementBytes: 10 }),
      ),
    );
    // 元素字节先于文本字符检查。
    expect(error.capacity?.metric).toBe("elementBytes");
  });

  test("内容当量：带文本元素 10、空文本元素 1、表格元素 1、表格内部元素 0", () => {
    const policy = scenePolicy();
    expect(
      measureSceneCapacity(
        scene([region("text", "text", { body: "x" })]),
        policy,
      ).contentUnits,
    ).toBe(10);
    expect(
      measureSceneCapacity(
        scene([region("empty", "text", { body: "" })]),
        policy,
      ).contentUnits,
    ).toBe(1);
    expect(
      measureSceneCapacity(
        scene([region("table", "table", { "cell:x": "x" })]),
        policy,
      ).contentUnits,
    ).toBe(1);
    expect(
      measureSceneCapacity(scene([tableCell("cell", "x")]), policy)
        .contentUnits,
    ).toBe(0);
    // 删除墓碑照常计入。
    expect(
      measureSceneCapacity(
        scene([
          element("deleted", 0, {
            isDeleted: true,
            type: "text",
            texts: { body: textBlock("x") },
          }),
        ]),
        policy,
      ).contentUnits,
    ).toBe(10);

    const error = failure(() =>
      assertScenePolicy(
        scene([region("text", "composite", { body: "x" })]),
        scenePolicy({ maxContentUnits: 9 }),
      ),
    );
    expect(error.code).toBe("scene_limit_exceeded");
    expect(error.capacity).toEqual({
      metric: "contentUnits",
      actual: 10,
      allowed: 9,
    });
  });

  test("表格结构：100×100 与 10,000 单元格通过，行、列与累计单元格分别拒绝", () => {
    const policy = scenePolicy({
      maxElementBytes: 4 * 1024 * 1024,
      maxSceneBytes: 32 * 1024 * 1024,
    });
    expect(() =>
      assertScenePolicy(scene([table("table", 100, 100, 10_000)]), policy),
    ).not.toThrow();

    const rows = failure(() =>
      assertScenePolicy(scene([table("table", 101, 100, 10_100)]), policy),
    );
    expect(rows.capacity).toEqual({
      metric: "tableRows",
      actual: 101,
      allowed: 100,
    });

    const columns = failure(() =>
      assertScenePolicy(scene([table("table", 100, 101, 10_100)]), policy),
    );
    expect(columns.capacity).toEqual({
      metric: "tableColumns",
      actual: 101,
      allowed: 100,
    });

    const cells = failure(() =>
      assertScenePolicy(
        scene([table("table-a", 100, 100, 10_000), table("table-b", 1, 1, 1)]),
        policy,
      ),
    );
    expect(cells.capacity).toEqual({
      metric: "tableCells",
      actual: 10_001,
      allowed: 10_000,
    });
  });

  test("结构元素数排除表格内部元素", () => {
    const policy = scenePolicy({ maxElements: 1 });
    expect(() =>
      assertScenePolicy(
        scene([
          table("table", 1, 1, 1),
          tableCell("cell-a", "a"),
          tableCell("cell-b", "b"),
        ]),
        policy,
      ),
    ).not.toThrow();
    const error = failure(() =>
      assertScenePolicy(
        scene([table("table", 1, 1, 1), element("shape")]),
        policy,
      ),
    );
    expect(error.capacity).toEqual({
      metric: "elements",
      actual: 2,
      allowed: 1,
    });
  });

  test("图片必须引用就绪资产，就绪判定由宿主给出", () => {
    const policy = scenePolicy();
    expect(
      failure(() => assertScenePolicy(scene([image("a", "f")]), policy)).code,
    ).toBe("invalid_scene");
    expect(() =>
      assertScenePolicy(
        scene([image("a", "f")], { f: { size: 3, mimeType: "image/png" } }),
        policy,
      ),
    ).not.toThrow();
    expect(
      failure(() =>
        assertScenePolicy(
          scene([image("a", "f")], { f: { size: 3, mimeType: "image/png" } }),
          scenePolicy({
            isAssetPersistable: (asset) => (asset as TestAsset).size > 3,
          }),
        ),
      ).code,
    ).toBe("invalid_scene");
  });

  test("运行时字段与内联二进制不得持久化", () => {
    expect(
      failure(() =>
        assertScenePolicy(
          scene([
            element("a", 0, {
              customData: { signedUrl: "https://example.com" },
            }),
          ]),
          scenePolicy(),
        ),
      ).code,
    ).toBe("invalid_scene");
    expect(
      failure(() =>
        assertScenePolicy(
          scene([
            element("a", 0, { customData: { nested: { dataURL: "data:," } } }),
          ]),
          scenePolicy(),
        ),
      ).code,
    ).toBe("invalid_scene");
    // 文本内容允许出现 data: 前缀，用户文本不参与该判定。
    expect(() =>
      assertScenePolicy(scene([text("a", "data:image/png")]), scenePolicy()),
    ).not.toThrow();
  });

  test("宿主未提供数值或资产类型时抛 invalid_input", () => {
    const invalid = failure(() =>
      assertScenePolicy(
        scene([element("a")]),
        scenePolicy({ maxElements: NaN }),
      ),
    );
    expect(invalid.code).toBe("invalid_input");
    expect(invalid.capacity).toBeUndefined();
    expect(
      failure(() =>
        assertScenePolicy(
          scene([element("a")]),
          scenePolicy({ assetMimeTypes: [] }),
        ),
      ).code,
    ).toBe("invalid_input");
  });

  test("资产通道按类型与字节拒绝", () => {
    const policy = { maxAssetBytes: 4, assetMimeTypes: ["image/png"] };
    expect(() =>
      assertAssetPolicy(policy, { mimeType: "image/png", bytes: 4 }),
    ).not.toThrow();
    const bytes = failure(() =>
      assertAssetPolicy(policy, { mimeType: "image/png", bytes: 5 }),
    );
    expect(bytes.code).toBe("scene_limit_exceeded");
    expect(bytes.capacity).toEqual({
      metric: "assetBytes",
      actual: 5,
      allowed: 4,
    });
    expect(
      failure(() =>
        assertAssetPolicy(policy, { mimeType: "image/svg+xml", bytes: 1 }),
      ).code,
    ).toBe("invalid_asset");
  });

  test("字节计量按 UTF-8 编码", () => {
    expect(jsonBytes("白板")).toBe(8);
  });
});
