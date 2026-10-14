import { describe, expect, test } from "vitest";

import {
  assertAssetPolicy,
  assertScenePolicy,
  jsonBytes,
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

const text = (id: string, content: string) =>
  element(id, 0, { type: "text", text: content, originalText: content });
const image = (id: string, fileId: string) =>
  element(id, 0, {
    type: "image",
    fileId,
    status: "saved",
    scale: [1, 1],
    crop: null,
  });

describe("场景门槛", () => {
  test("元素数、资产数、单元素与整场景字节超限抛 scene_limit_exceeded", () => {
    expect(
      failure(() =>
        assertScenePolicy(
          scene([element("a"), element("b")]),
          scenePolicy({ maxElements: 1 }),
        ),
      ).code,
    ).toBe("scene_limit_exceeded");
    expect(
      failure(() =>
        assertScenePolicy(
          scene([element("a")], { f: { size: 3, mimeType: "image/png" } }),
          scenePolicy({ maxAssets: 0 }),
        ),
      ).code,
    ).toBe("scene_limit_exceeded");
    expect(
      failure(() =>
        assertScenePolicy(
          scene([element("a")]),
          scenePolicy({ maxElementBytes: 10 }),
        ),
      ).code,
    ).toBe("scene_limit_exceeded");
    expect(
      failure(() =>
        assertScenePolicy(
          scene([element("a")]),
          scenePolicy({ maxSceneBytes: 10 }),
        ),
      ).code,
    ).toBe("scene_limit_exceeded");
  });

  test("重复元素 ID 抛 invalid_scene", () => {
    expect(
      failure(() =>
        assertScenePolicy(scene([element("a"), element("a")]), scenePolicy()),
      ).code,
    ).toBe("invalid_scene");
  });

  test("文本节点按内容字节单独计量", () => {
    const policy = scenePolicy({ maxTextBytes: 4 });
    expect(() =>
      assertScenePolicy(scene([text("a", "abcd")]), policy),
    ).not.toThrow();
    const error = failure(() =>
      assertScenePolicy(scene([text("a", "abcde")]), policy),
    );
    expect(error.code).toBe("scene_limit_exceeded");
    // 元素整体字节上限与文本上限彼此独立，文本更短时仍受元素上限约束。
    expect(
      failure(() =>
        assertScenePolicy(
          scene([text("a", "ab")]),
          scenePolicy({ maxElementBytes: 10 }),
        ),
      ).code,
    ).toBe("scene_limit_exceeded");
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
    // 文本内容与 originalText 允许出现 data: 前缀，用户文本不参与该判定。
    expect(() =>
      assertScenePolicy(scene([text("a", "data:image/png")]), scenePolicy()),
    ).not.toThrow();
  });

  test("宿主未提供数值或资产类型时抛 invalid_input", () => {
    expect(
      failure(() =>
        assertScenePolicy(
          scene([element("a")]),
          scenePolicy({ maxElements: NaN }),
        ),
      ).code,
    ).toBe("invalid_input");
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
    expect(
      failure(() =>
        assertAssetPolicy(policy, { mimeType: "image/png", bytes: 5 }),
      ).code,
    ).toBe("scene_limit_exceeded");
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
