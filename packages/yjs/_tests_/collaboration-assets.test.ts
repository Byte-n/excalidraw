import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import * as Y from "yjs";

import {
  Excalidraw,
  CaptureUpdateAction,
  restoreElements,
} from "@excalidraw/excalidraw";

import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { createExcalidrawCollaboration } from "../src";

import { element, presenceChannel, validateScene } from "./helpers";

import type { AssetTransport } from "../src";
import type { TestAsset } from "./helpers";

const asset = { size: 3, mimeType: "image/png" };
const gate = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const image = () =>
  element("image", 0, {
    type: "image",
    fileId: "file",
    status: "pending",
    scale: [1, 1],
    crop: null,
  });
// BinaryFileData 的标识和 DataURL 使用 editor 字符串品牌，fixture 保持合法公开值。
const file = {
  id: "file",
  dataURL: "data:image/png;base64,YWJj",
  mimeType: "image/png",
  created: 0,
} as BinaryFileData;
const make = (
  transport: Partial<AssetTransport<TestAsset>> = {},
  document = new Y.Doc(),
) => {
  const errors = vi.fn();
  const controller = createExcalidrawCollaboration({
    document,
    presence: presenceChannel().channel,
    state: { canEdit: true, synced: true, online: true, isCollaborating: true },
    assets: {
      upload: async () => asset,
      authorize: async () => "signed",
      fetch: async () => new Blob(["abc"], { type: "image/png" }),
      ...transport,
    },
    validateScene,
    onError: errors,
  });
  onTestFinished(() => {
    controller.dispose();
    document.destroy();
  });
  return { document, controller, errors };
};
const mount = async (fixture: ReturnType<typeof make>) => {
  const mounted = render(
    createElement(Excalidraw, {
      collaboration: fixture.controller,
      handleKeyboardGlobally: true,
    }),
  );
  await waitFor(() =>
    expect(fixture.controller.getSnapshot().readOnly).toBe(false),
  );
  return { mounted, api: fixture.controller.getApi()! };
};
const insert = (api: ExcalidrawImperativeAPI) =>
  act(() => {
    api.addFiles([file]);
    // 宿主场景 JSON 在公开 restore 边界转换为 editor 品牌元素。
    api.updateScene({
      elements: [
        ...api.getSceneElements(),
        ...restoreElements(
          [image()] as unknown as Parameters<typeof restoreElements>[0],
          null,
        ),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  });
const move = (api: ExcalidrawImperativeAPI, x: number) =>
  act(() =>
    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((value) =>
          value.id === "image"
            ? { ...value, x, version: value.version + 1 }
            : value,
        ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
afterEach(cleanup);

test("本地图片 overlay 经远端回灌及移动保留，成功原子发布最新位置且移动不重传", async () => {
  const pending = gate<TestAsset>();
  const upload = vi.fn(async () => pending.promise);
  const fixture = make({ upload });
  fixture.document.getMap("elements").set("remote", element("remote"));
  const { api } = await mount(fixture);
  insert(api);
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  expect(fixture.document.getMap("elements").has("image")).toBe(false);
  act(() =>
    fixture.document.getMap("elements").set("remote", element("remote", 500)),
  );
  expect(api.getSceneElements().some((value) => value.id === "image")).toBe(
    true,
  );
  move(api, 750);
  const updates = vi.fn();
  fixture.document.on("update", updates);
  await act(async () => pending.resolve(asset));
  await waitFor(() =>
    expect(
      fixture.controller
        .getScene()
        .elements.find((value) => value.id === "image")?.x,
    ).toBe(750),
  );
  expect(updates).toHaveBeenCalledTimes(1);
  expect(fixture.document.getMap("assets").size).toBe(1);
  move(api, 800);
  await waitFor(() =>
    expect(
      fixture.controller
        .getScene()
        .elements.find((value) => value.id === "image")?.x,
    ).toBe(800),
  );
  expect(upload).toHaveBeenCalledTimes(1);
  expect(fixture.errors).not.toHaveBeenCalled();
});

test("上传中删除后迟到成功不复活，真实 undo 删除使用已上传缓存且不重复上传", async () => {
  const pending = gate<TestAsset>();
  const upload = vi.fn(async () => pending.promise);
  const fixture = make({ upload });
  const { api } = await mount(fixture);
  insert(api);
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  act(() =>
    api.updateScene({
      elements: api.getSceneElements().map((value) => ({
        ...value,
        isDeleted: true,
        version: value.version + 1,
      })),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
  await act(async () => pending.resolve(asset));
  expect(fixture.document.getMap("elements").size).toBe(0);
  expect(api.getSceneElements()).toHaveLength(0);
  // 删除完成后通过公开 editor API 恢复同一元素，模拟 Excalidraw undo 产生的完整快照。
  act(() =>
    api.updateScene({
      // 宿主场景 JSON 通过公开恢复边界生成合法 editor 元素。
      elements: restoreElements(
        [image()] as unknown as Parameters<typeof restoreElements>[0],
        null,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
  await waitFor(() => expect(api.getSceneElements()).toHaveLength(1));
  await waitFor(() =>
    expect(fixture.document.getMap("elements").has("image")).toBe(true),
  );
  expect(api.getSceneElements()).toHaveLength(1);
  expect(upload).toHaveBeenCalledTimes(1);
});

test("已发布图片下载失败/重试/成功不写 document，error 下移动保持 canonical saved", async () => {
  let allowed = false;
  const fixture = make({
    authorize: async () => {
      if (!allowed) {
        throw new Error("403");
      }
      return "signed";
    },
  });
  fixture.document
    .getMap("elements")
    .set("image", { ...image(), status: "saved" });
  fixture.document.getMap("assets").set("file", asset);
  const updates = vi.fn();
  fixture.document.on("update", updates);
  const { api } = await mount(fixture);
  await waitFor(() =>
    expect(api.getSceneElements()[0]).toMatchObject({ status: "error" }),
  );
  expect(updates).not.toHaveBeenCalled();
  move(api, 200);
  await waitFor(() =>
    expect(fixture.controller.getScene().elements[0]).toMatchObject({
      x: 200,
      status: "saved",
    }),
  );
  expect(updates).toHaveBeenCalledTimes(1);
  allowed = true;
  act(() => fixture.controller.retryFiles());
  await waitFor(() => expect(api.getFiles().file?.dataURL).toBe(file.dataURL));
  expect(updates).toHaveBeenCalledTimes(1);
  expect(fixture.errors).not.toHaveBeenCalled();
});

test("切换文档后旧上传晚到不写旧新画板且新 editor 无旧图片", async () => {
  const pending = gate<TestAsset>();
  const upload = vi.fn(async () => pending.promise);
  const first = make({ upload });
  const second = make();
  const { api, mounted } = await mount(first);
  insert(api);
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  mounted.rerender(
    createElement(Excalidraw, { collaboration: second.controller }),
  );
  await waitFor(() =>
    expect(second.controller.getSnapshot().readOnly).toBe(false),
  );
  await act(async () => pending.resolve(asset));
  expect(first.document.getMap("elements").size).toBe(0);
  expect(second.document.getMap("elements").size).toBe(0);
  expect(second.controller.getApi()!.getSceneElements()).toHaveLength(0);
  expect(first.document.getMap("assets").size).toBe(0);
  expect(second.document.getMap("assets").size).toBe(0);
});

test("显式图片命令补 BinaryFiles 单事务并形成一次真实 undo/redo", async () => {
  const authorize = vi.fn(async () => {
    throw new Error("本地已上传图片不应下载");
  });
  const fixture = make({ authorize });
  const { api } = await mount(fixture);
  await fixture.controller.assetCoordinator.ensureUploaded(
    "file",
    file.dataURL,
  );
  const updates = vi.fn();
  fixture.document.on("update", updates);
  act(() =>
    fixture.controller.applyCommand({
      elements: [{ ...image(), status: "saved" }],
      assets: { file: asset },
    }),
  );
  await waitFor(() => expect(api.getFiles().file?.dataURL).toBe(file.dataURL));
  expect(updates).toHaveBeenCalledTimes(1);
  expect(authorize).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "z", ctrlKey: true });
  await waitFor(() => expect(api.getSceneElements()).toHaveLength(0));
  expect(fixture.controller.getScene().elements[0].isDeleted).toBe(true);
  fireEvent.keyDown(document, { key: "z", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(api.getSceneElements()).toHaveLength(1));
  expect(updates).toHaveBeenCalledTimes(3);
  expect(authorize).not.toHaveBeenCalled();
});

test("权限撤销隔离旧上传，恢复权限后重试且旧成功不得覆盖新资产", async () => {
  const old = gate<TestAsset>();
  const fresh = gate<TestAsset>();
  const upload = vi
    .fn()
    .mockImplementationOnce(async () => old.promise)
    .mockImplementationOnce(async () => fresh.promise);
  const fixture = make({ upload });
  const { api } = await mount(fixture);
  insert(api);
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  act(() => fixture.controller.updateState({ canEdit: false }));
  expect(fixture.controller.getSnapshot().readOnly).toBe(true);
  act(() => fixture.controller.updateState({ canEdit: true }));
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  await act(async () => old.resolve({ size: 5, mimeType: "image/png" }));
  expect(fixture.document.getMap("assets").size).toBe(0);
  await act(async () => fresh.resolve(asset));
  await waitFor(() =>
    expect(fixture.controller.getScene().assets.file).toEqual(asset),
  );
  expect(fixture.controller.getSnapshot().readOnly).toBe(false);
  expect(fixture.errors).not.toHaveBeenCalled();
});
