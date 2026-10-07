import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import * as Y from "yjs";

import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { createSceneBinding } from "../src/binding";

import { createExcalidrawSceneController } from "../src/excalidraw-scene-controller";

import { element, validateScene } from "./helpers";

import type {
  ExcalidrawSceneElement,
  ExcalidrawSceneState,
} from "../src/excalidraw-scene-types";

afterEach(() => cleanup());

const mount = async (
  state: Partial<ExcalidrawSceneState> = {},
  loading?: Promise<null>,
  borrowed = false,
  initialElement: ExcalidrawSceneElement = element(),
) => {
  const doc = new Y.Doc();
  doc.getMap("elements").set(initialElement.id, initialElement);
  const errors = vi.fn();
  const binding = borrowed
    ? createSceneBinding<
        ExcalidrawSceneElement,
        { size: number; mimeType: string }
      >({ doc, adapter: { validateCanonical: validateScene } })
    : undefined;
  binding?.setGate({
    initialized: true,
    synced: true,
    canEdit: true,
    generation: 42,
  });
  const controller = createExcalidrawSceneController({
    document: doc,
    borrowedBinding: binding,
    state: { canEdit: true, synced: true, online: true, ...state },
    validateScene,
    onError: errors,
  });
  let detach: (() => void) | undefined;
  let editor: ExcalidrawImperativeAPI | null = null;
  const mounted = render(
    createElement(Excalidraw, {
      initialData: loading,
      onExcalidrawAPI: (api) => {
        detach?.();
        editor = api;
        detach = api ? controller.attach(api) : undefined;
      },
      onChange: controller.onChange,
    }),
  );
  await waitFor(() => expect(editor).not.toBeNull());
  const api = controller.getApi()!;
  if (!loading) {
    await waitFor(() => expect(api.getAppState().isLoading).toBe(false));
  }
  onTestFinished(() => {
    mounted.unmount();
    controller.dispose();
    binding?.dispose();
    doc.destroy();
  });
  return { doc, controller, api, errors, mounted, binding };
};

test("缺省独立文本首次 restore 只在 display 副本测量，不写回 canonical", async () => {
  const text = element("lazy-text", 0, {
    type: "text",
    text: "第一行\n第二行",
    originalText: "第一行\n第二行",
    fontSize: 20,
    fontFamily: 1,
    baseFontSize: null,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  });
  delete text.width;
  delete text.height;
  const { doc, api } = await mount({}, undefined, false, text);
  const displayed = api.getSceneElements()[0]!;
  expect(Number.isFinite(displayed.width) && displayed.width > 0).toBe(true);
  expect(Number.isFinite(displayed.height) && displayed.height > 0).toBe(true);
  const canonical = doc.getMap<ExcalidrawSceneElement>("elements").get("lazy-text")!;
  expect(Object.hasOwn(canonical, "width")).toBe(false);
  expect(Object.hasOwn(canonical, "height")).toBe(false);
});

const edit = (
  api: ExcalidrawImperativeAPI,
  values: { x?: number; version?: number },
) => {
  const elements = api
    .getSceneElementsIncludingDeleted()
    .map((value) => ({ ...value, ...values }));
  act(() =>
    api.updateScene({
      elements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
};

test("API ready 和首次同步仍等待非 loading 初始化及首次回灌，不发布空场景", async () => {
  let release!: (value: null) => void;
  const loading = new Promise<null>((resolve) => {
    release = resolve;
  });
  const { doc, controller, api } = await mount({}, loading);
  const updates = vi.fn();
  doc.on("update", updates);
  expect(controller.getReadOnly()).toBe(true);
  expect(api.getAppState().isLoading).toBe(true);
  act(() => controller.updateState({ synced: true }));
  expect(updates).not.toHaveBeenCalled();
  await act(async () => {
    release(null);
  });
  await waitFor(() => expect(controller.getReadOnly()).toBe(false));
  expect(api.getSceneElements()[0].id).toBe("a");
  expect(updates).not.toHaveBeenCalled();
});

test("权限与首次同步独立门控，首次同步后断网保留离线编辑", async () => {
  const { doc, controller, api } = await mount({
    canEdit: false,
    synced: false,
  });
  expect(controller.getReadOnly()).toBe(true);
  expect(() =>
    controller.applyCommand({ elements: [element("blocked")] }),
  ).toThrow("尚未就绪");
  act(() => controller.updateState({ canEdit: true }));
  expect(controller.getReadOnly()).toBe(true);
  act(() => controller.updateState({ synced: true }));
  expect(controller.getReadOnly()).toBe(false);
  act(() => controller.updateState({ synced: false, online: false }));
  edit(api, { x: 8, version: 3 });
  await waitFor(() =>
    expect(doc.getMap<ExcalidrawSceneElement>("elements").get("a")?.x).toBe(8),
  );
  act(() => controller.updateState({ canEdit: false }));
  expect(controller.getReadOnly()).toBe(true);
  expect(() =>
    controller.applyCommand({ elements: [element("blocked")] }),
  ).toThrow("尚未就绪");
});

test("远端低版本回灌和迟到本地回调不回声，真实修改只写受影响元素", async () => {
  const { doc, controller, api } = await mount();
  const stale = api.getSceneElementsIncludingDeleted();
  const changed: string[][] = [];
  doc
    .getMap("elements")
    .observe((event) => changed.push([...event.keysChanged]));
  act(() =>
    doc.transact(() => {
      doc
        .getMap("elements")
        .set("a", element("a", 90, { version: 1, versionNonce: 9 }));
      doc
        .getMap("elements")
        .set("remote", element("remote", 80, { index: "a1" }));
    }),
  );
  expect(changed).toEqual([["a", "remote"]]);
  expect(api.getSceneElements().map((value) => value.id)).toEqual([
    "a",
    "remote",
  ]);
  act(() => controller.onChange(stale, api.getAppState(), api.getFiles()));
  expect(changed).toHaveLength(1);
  act(() =>
    api.updateScene({
      elements: api
        .getSceneElements()
        .map((value) =>
          value.id === "a"
            ? { ...value, x: 95, version: value.version + 1 }
            : value,
        ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
  await waitFor(() => expect(changed).toEqual([["a", "remote"], ["a"]]));
  expect(
    controller.getScene().elements.find((value) => value.id === "remote")?.x,
  ).toBe(80);
});

test("拖拽仅保护所选元素，交互结束先发布最终位置再接纳远端胜者", async () => {
  const { doc, controller, api } = await mount();
  act(() =>
    api.updateScene({
      appState: {
        selectedElementIds: { a: true },
        selectedElementsAreBeingDragged: true,
      },
    }),
  );
  edit(api, { x: 10, version: 3 });
  act(() =>
    doc
      .getMap("elements")
      .set("a", element("a", 90, { version: 1, versionNonce: 9 })),
  );
  expect(api.getSceneElements()[0].x).toBe(10);
  act(() =>
    api.updateScene({ appState: { selectedElementsAreBeingDragged: false } }),
  );
  await waitFor(() => expect(api.getSceneElements()[0].x).toBe(90));
  expect(controller.getScene().elements[0].x).toBe(90);
});

test("命令原子墓碑保留远端新增，校验失败不留下半提交", async () => {
  const { doc, controller, api, errors } = await mount();
  const updates = vi.fn();
  doc.on("update", updates);
  act(() =>
    controller.applyCommand({
      elements: [element("import", 8, { index: "a1" })],
      deleteIds: ["a"],
    }),
  );
  expect(updates).toHaveBeenCalledTimes(1);
  expect(api.getSceneElements().map((value) => value.id)).toEqual(["import"]);
  expect(
    controller.getScene().elements.find((value) => value.id === "a")?.isDeleted,
  ).toBe(true);
  expect(() =>
    controller.applyCommand({
      elements: [element("invalid", 3, { index: "" })],
    }),
  ).toThrow("校验失败");
  expect(updates).toHaveBeenCalledTimes(1);
  expect(errors).toHaveBeenLastCalledWith(expect.any(Error), "command");
});

test("重复绑定与解除幂等，旧代际导入不能提交且文档不被销毁", async () => {
  const { doc, controller, api, mounted } = await mount();
  const prepared = controller.prepareImportCommand({
    elements: [element("late", 3)],
  });
  const duplicate = controller.attach(api);
  duplicate();
  duplicate();
  expect(controller.getApi()).toBeNull();
  expect(controller.getReadOnly()).toBe(true);
  act(() => {
    controller.attach(api);
  });
  expect(() => prepared.commit()).toThrow("会话已变化");
  mounted.unmount();
  controller.dispose();
  controller.dispose();
  expect(doc.isDestroyed).toBe(false);
  expect(() => controller.getScene()).toThrow("已销毁");
});

test("远端业务校验失败收紧只读并上报原异常，不清空既有显示", async () => {
  const { doc, controller, api, errors } = await mount();
  act(() =>
    doc.getMap("elements").set("invalid", element("invalid", 1, { index: "" })),
  );
  expect(errors).toHaveBeenLastCalledWith(expect.any(Error), "restore");
  expect(controller.getReadOnly()).toBe(true);
  expect(api.getSceneElements()[0].id).toBe("a");
  expect(doc.getMap("elements").has("invalid")).toBe(true);
});

test("资产不可重绑先预检，失败不发布元素或任何 update", async () => {
  const { doc, controller } = await mount();
  act(() =>
    controller.applyCommand({
      elements: [],
      assets: { file: { size: 3, mimeType: "image/png" } },
    }),
  );
  const updates = vi.fn();
  doc.on("update", updates);
  expect(() =>
    controller.applyCommand({
      elements: [element("partial", 1)],
      assets: { file: { size: 4, mimeType: "image/png" } },
    }),
  ).toThrow("cannot be rebound");
  expect(updates).not.toHaveBeenCalled();
  expect(doc.getMap("elements").has("partial")).toBe(false);
});

test("借用 binding 复用场景监听与命令，gate 和最终释放始终由 session 拥有者管理", async () => {
  const { doc, controller, api, binding } = await mount({}, undefined, true);
  const gate = binding!.getGate();
  expect(gate.generation).toBe(42);
  await waitFor(() => expect(controller.getReadOnly()).toBe(false));
  const prepared = controller.prepareImportCommand({
    elements: [element("b", 33)],
  });
  act(() => prepared.commit());
  expect(doc.getMap("elements").has("b")).toBe(true);
  act(() => doc.getMap("elements").set("a", element("a", 90, { version: 2 })));
  await waitFor(() =>
    expect(api.getSceneElements().find((value) => value.id === "a")?.x).toBe(
      90,
    ),
  );
  const disposal = vi.spyOn(binding!, "dispose");
  controller.dispose();
  controller.dispose();
  expect(disposal).not.toHaveBeenCalled();
  expect(binding!.getGate()).toEqual(gate);
  binding!.applyCommand({ elements: [element("c", 17)] });
  expect(doc.getMap("elements").has("c")).toBe(true);
});
