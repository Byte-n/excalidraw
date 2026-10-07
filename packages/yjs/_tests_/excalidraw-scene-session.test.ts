import assert from "node:assert/strict";

import * as Y from "yjs";
import { onTestFinished, test } from "vitest";

import { projectExcalidrawDisplayElements } from "../src/scene-projection";
import { ExcalidrawSceneSession } from "../src/excalidraw-scene-session";

import { element, TestSceneBridge } from "./helpers";

function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.getMap("canvasMeta").set("sceneSchemaVersion", 2);
  const left = new TestSceneBridge(a);
  const right = new TestSceneBridge(b);
  left.applyCommand({
    elements: [element("a", 0), element("b", 0, { index: "a1" })],
  });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  onTestFinished(() => {
    left.dispose();
    right.dispose();
    a.destroy();
    b.destroy();
  });
  return { a, b, left, right };
}
function sync(a: Y.Doc, b: Y.Doc) {
  const ab = Y.encodeStateAsUpdate(a);
  const ba = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, ba);
  Y.applyUpdate(b, ab);
}

test("不同元素原子并发、乱序重复送达及重连不覆盖无关元素", () => {
  const { a, b, left, right } = pair();
  left.applyCommand({ elements: [element("a", 11)] });
  right.applyCommand({ elements: [element("b", 22, { index: "a1" })] });
  const first = Y.encodeStateAsUpdate(a);
  const second = Y.encodeStateAsUpdate(b);
  const late = new Y.Doc();
  onTestFinished(() => late.destroy());
  Y.applyUpdate(late, second);
  Y.applyUpdate(late, first);
  Y.applyUpdate(late, second);
  sync(a, b);
  assert.deepEqual(left.getScene(), right.getScene());
  assert.equal(left.getScene().elements[0]!.x, 11);
  assert.equal(left.getScene().elements[1]!.x, 22);
  const reopened = new TestSceneBridge(late);
  onTestFinished(() => reopened.dispose());
  assert.deepEqual(reopened.getScene(), left.getScene());
  assert.deepEqual([...a.share.keys()].sort(), [
    "assets",
    "canvasMeta",
    "elements",
  ]);
});

test("同元素及墓碑/离线编辑只取 Yjs 整值胜者，不用版本择胜或拼接字段", () => {
  const { a, b, left, right } = pair();
  left.applyCommand({ elements: [element("a", 10, { version: 100 })] });
  right.applyCommand({
    elements: [element("a", 20, { version: 3, strokeColor: "#ff0000" })],
  });
  sync(b, a);
  assert.deepEqual(left.getScene(), right.getScene());
  const winner = a.getMap("elements").get("a");
  assert.deepEqual(left.getScene().elements[0], winner);
  assert.ok([10, 20].includes(left.getScene().elements[0]!.x));
  left.removeElement("a");
  right.applyCommand({ elements: [element("a", 30)] });
  sync(a, b);
  assert.deepEqual(left.getScene(), right.getScene());
  assert.ok(a.getMap("elements").has("a"), "保留完整元素 key，不物理删除");
  assert.equal(left.getScene().elements[0]!.index, "a0");
});

test("增量回调、重复快照与遗漏远端新增不重写；资产不随移动发布", () => {
  const { a, left } = pair();
  const changes: string[][] = [];
  a.getMap("elements").observe((event) => changes.push([...event.keysChanged]));
  left.applyLocalScene({ elements: left.getScene().elements });
  changes.length = 0;
  left.applyLocalScene({ elements: [element("a", 9)] });
  left.applyLocalScene({ elements: [element("a", 9)] });
  assert.deepEqual(changes, [["a"]]);
  assert.equal(left.getScene().elements.length, 2);
  const scene = left.getScene();
  scene.elements[0]!.x = 999;
  assert.equal(left.getScene().elements[0]!.x, 9);
});

test("并发重排与批量粘贴按 index/id 收敛，普通移动保留显示修复前索引", () => {
  const { a, b, left, right } = pair();
  left.applyCommand({
    elements: [
      element("a", 0, { index: "a2" }),
      element("paste-a", 3, { index: "a3" }),
    ],
  });
  right.applyCommand({
    elements: [
      element("b", 0, { index: "a2" }),
      element("paste-b", 4, { index: "a3" }),
    ],
  });
  sync(a, b);
  assert.deepEqual(
    left.getScene().elements.map((entry) => entry.id),
    ["a", "b", "paste-a", "paste-b"],
  );
  const session = new ExcalidrawSceneSession(left.binding);
  const display = session.project();
  session.accept(display);
  assert.equal(display[0]!.index, "c000");
  session.publish(
    display.map((entry) =>
      entry.id === "a"
        ? { ...entry, x: 7, version: 9, versionNonce: 99 }
        : entry,
    ),
  );
  assert.equal(left.getScene().elements[0]!.index, "a2");
  assert.equal(left.getScene().elements[1]!.x, 0);
});

test("显示水位 v10→canonical v3→本地颜色→undo/redo 与同版本 nonce 变化无回声", () => {
  const { left } = pair();
  left.applyCommand({ elements: [element("a", 0, { version: 10 })] });
  const session = new ExcalidrawSceneSession(left.binding);
  let display = session.project();
  session.accept(display);
  left.applyCommand({
    elements: [element("a", 7, { version: 3, versionNonce: 3 })],
  });
  display = session.project();
  session.accept(display);
  assert.equal(display[0]!.version, 11);
  assert.deepEqual(session.publish(display), []);
  session.publish(
    display.map((entry) =>
      entry.id === "a"
        ? { ...entry, strokeColor: "#ff0000", version: 12, versionNonce: 12 }
        : entry,
    ),
  );
  assert.equal(left.getScene().elements[0]!.version, 4);
  const changed = {
    ...display[0]!,
    strokeColor: "#ff0000",
    version: 12,
    versionNonce: 12,
  };
  session.publish([
    { ...changed, strokeColor: "#1e1e1e", version: 13, versionNonce: 13 },
    display[1]!,
  ]);
  assert.equal(left.getScene().elements[0]!.strokeColor, "#1e1e1e");
  session.publish([{ ...changed, version: 14, versionNonce: 14 }, display[1]!]);
  assert.equal(left.getScene().elements[0]!.strokeColor, "#ff0000");
  const canonical = left.getScene().elements[0]!;
  left.applyCommand({ elements: [{ ...canonical, x: 77, versionNonce: 78 }] });
  display = session.project();
  session.accept(display);
  assert.ok(display[0]!.version > 14);
  assert.deepEqual(session.publish(display), []);
  assert.equal(session.project()[0]!.version, display[0]!.version);
});

test("原子命令保留准备期间远端新增，墓碑/新元素一次事务且预算失败无半提交", () => {
  const { a, left } = pair();
  const targets = left.getScene().elements.map((entry) => entry.id);
  left.applyCommand({ elements: [element("new-remote", 7, { index: "a2" })] });
  let updates = 0;
  a.on("update", () => updates++);
  left.applyCommand({
    elements: [element("import", 8, { index: "a3" })],
    deleteIds: targets,
  });
  assert.equal(updates, 1);
  assert.equal(
    left.getScene().elements.find((entry) => entry.id === "new-remote")!
      .isDeleted,
    false,
  );
  assert.equal(
    left.getScene().elements.filter((entry) => entry.isDeleted).length,
    2,
  );
  assert.throws(() =>
    left.applyCommand({ elements: [element("invalid", 9, { index: "" })] }),
  );
  assert.equal(updates, 1);
  left.dispose();
  assert.throws(() => left.removeElement("import"), /已销毁/);
});

test("纯图片加载状态/版本、选区和视口快照不写文档，移动仍保存 saved", () => {
  const { a, left } = pair();
  left.applyCommand({
    elements: [
      element("image", 0, {
        type: "image",
        fileId: "file",
        status: "saved",
        scale: [1, 1],
        crop: null,
        index: "a2",
      }),
    ],
    assets: {
      file: {
        storageFileId: "11111111-1111-4111-8111-111111111111",
        mimeType: "image/png",
        size: 10,
      },
    },
  });
  const session = new ExcalidrawSceneSession(left.binding);
  const display = session.project();
  session.accept(display);
  let updates = 0;
  a.on("update", () => updates++);
  const loaded = display.map((entry) =>
    entry.id === "image" ? { ...entry, status: "error", version: 99 } : entry,
  );
  session.publish(loaded);
  session.publish(loaded);
  assert.equal(updates, 0);
  session.publish(
    loaded.map((entry) =>
      entry.id === "image" ? { ...entry, x: 6, version: 100 } : entry,
    ),
  );
  assert.equal(updates, 1);
  assert.equal(
    left.getScene().elements.find((entry) => entry.id === "image")!.status,
    "saved",
  );
  assert.equal(Object.keys(left.getScene().assets).length, 1);
});

test("缺省文本尺寸只在文本或所属容器发生编辑时物化", () => {
  const { a, left } = pair();
  const text = element("lazy-text", 0, {
    type: "text",
    width: undefined,
    height: undefined,
    text: "原文",
    originalText: "原文",
    fontSize: 20,
    fontFamily: 1,
    baseFontSize: null,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    index: "a1",
  });
  const lazyText = { ...text };
  delete lazyText.width;
  delete lazyText.height;
  left.applyCommand({ elements: [lazyText] });
  const session = new ExcalidrawSceneSession(left.binding);
  const display = session
    .project()
    .map((value) =>
      value.id === "lazy-text" ? { ...value, width: 42, height: 25 } : value,
    );
  session.accept(display);
  let updates = 0;
  a.on("update", () => updates++);
  session.publish(display);
  assert.equal(updates, 0);
  const canonical = left
    .getScene()
    .elements.find((value) => value.id === "lazy-text")!;
  assert.equal(Object.hasOwn(canonical, "width"), false);
  session.publish(
    display.map((value) =>
      value.id === "lazy-text"
        ? {
            ...value,
            text: "修改后",
            originalText: "修改后",
            width: 70,
            height: 25,
          }
        : value,
    ),
  );
  assert.equal(updates, 1);
  const materialized = left
    .getScene()
    .elements.find((value) => value.id === "lazy-text")!;
  assert.equal(materialized.width, 70);
  assert.equal(materialized.height, 25);
});

test("合法软关系竞争确定性保留用户文字，普通移动不透传解除关系", () => {
  const { a, b, left, right } = pair();
  const text = (id: string) =>
    element(id, 10, {
      type: "text",
      text: id,
      originalText: id,
      fontSize: 20,
      fontFamily: 1,
      baseFontSize: null,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
      containerRef: { kind: "tableTitle", elementId: "table" },
      index: "a3",
    });
  const table = element("table", 0, {
    type: "table",
    width: 100,
    height: 80,
    table: {
      schemaVersion: 1,
      rows: [{ id: "r", height: 80 }],
      columns: [{ id: "c", width: 100 }],
      cells: [{ id: "cell", rowId: "r", columnId: "c", style: {} }],
    },
    index: "a2",
  });
  left.applyCommand({ elements: [table] });
  sync(a, b);
  left.applyCommand({ elements: [text("title-a")] });
  right.applyCommand({ elements: [text("title-b")] });
  sync(a, b);
  assert.deepEqual(
    projectExcalidrawDisplayElements(left.getScene().elements),
    projectExcalidrawDisplayElements(right.getScene().elements),
  );
  const session = new ExcalidrawSceneSession(left.binding);
  const display = session.project();
  session.accept(display);
  assert.equal(
    display.find((entry) => entry.id === "title-b")!.containerRef,
    undefined,
  );
  session.publish(
    display.map((entry) =>
      entry.id === "title-b" ? { ...entry, x: 50 } : entry,
    ),
  );
  assert.deepEqual(
    left.getScene().elements.find((entry) => entry.id === "title-b")!
      .containerRef,
    { kind: "tableTitle", elementId: "table" },
  );
  left.removeElement("table");
  sync(a, b);
  const detached = projectExcalidrawDisplayElements(right.getScene().elements);
  assert.equal(
    detached.find((entry) => entry.id === "title-a")!.text,
    "title-a",
  );
  assert.equal(
    detached.find((entry) => entry.id === "title-a")!.containerRef,
    undefined,
  );
});

test("restore 显示几何适配后的移动仅反向映射用户位移", () => {
  const { left } = pair();
  const session = new ExcalidrawSceneSession(left.binding);
  const projected = session.project();
  // 模拟 vendor 的容器/绑定规范化产生显示偏移。
  const display = projected.map((entry) =>
    entry.id === "a" ? { ...entry, x: entry.x + 20 } : entry,
  );
  session.accept(display);
  session.publish(
    display.map((entry) =>
      entry.id === "a" ? { ...entry, x: entry.x + 5, version: 2 } : entry,
    ),
  );
  assert.equal(left.getScene().elements[0]!.x, 5);
});

test("单元格删改、父容器删改及容器环并发不丢文本且不回写显示关系", () => {
  const { a, b, left, right } = pair();
  const frame = (id: string, parent: string) =>
    element(id, 0, {
      type: "table",
      width: 100,
      height: 80,
      table: {
        schemaVersion: 1,
        rows: [{ id: "r", height: 80 }],
        columns: [{ id: "c", width: 100 }],
        cells: [{ id: "cell", rowId: "r", columnId: "c", style: {} }],
      },
      containerRef: {
        kind: "tableCell",
        elementId: parent,
        cellId: "cell",
        role: "content",
      },
      index: "a2",
    });
  const text = element("text", 3, {
    type: "text",
    text: "保留文字",
    originalText: "保留文字",
    fontSize: 20,
    fontFamily: 1,
    baseFontSize: null,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    containerRef: {
      kind: "tableCell",
      elementId: "table-a",
      cellId: "cell",
      role: "backgroundText",
    },
    index: "a3",
  });
  left.applyCommand({
    elements: [frame("table-a", "table-b"), frame("table-b", "table-a"), text],
  });
  sync(a, b);
  let shown = projectExcalidrawDisplayElements(left.getScene().elements);
  assert.equal(
    shown.find((entry) => entry.id === "table-b")!.containerRef,
    undefined,
  );
  const table = left
    .getScene()
    .elements.find((entry) => entry.id === "table-a")!;
  left.applyCommand({
    elements: [
      {
        ...table,
        table: {
          schemaVersion: 1,
          rows: [{ id: "r", height: 80 }],
          columns: [{ id: "c", width: 100 }],
          cells: [
            { id: "replacement-cell", rowId: "r", columnId: "c", style: {} },
          ],
        },
      },
    ],
  });
  right.applyCommand({
    elements: [{ ...text, text: "并发修改", originalText: "并发修改", x: 30 }],
  });
  sync(a, b);
  shown = projectExcalidrawDisplayElements(left.getScene().elements);
  assert.equal(
    shown.find((entry) => entry.id === "text")!.containerRef,
    undefined,
  );
  assert.equal(shown.find((entry) => entry.id === "text")!.text, "并发修改");
  const session = new ExcalidrawSceneSession(left.binding);
  const display = session.project();
  session.accept(display);
  session.publish(
    display.map((entry) => (entry.id === "text" ? { ...entry, x: 31 } : entry)),
  );
  assert.deepEqual(
    left.getScene().elements.find((entry) => entry.id === "text")!.containerRef,
    text.containerRef,
  );
  sync(a, b);
  left.removeElement("table-a");
  right.applyCommand({
    elements: [
      {
        ...right.getScene().elements.find((entry) => entry.id === "text")!,
        text: "父删除期间文字",
        originalText: "父删除期间文字",
      },
    ],
  });
  sync(a, b);
  assert.deepEqual(
    projectExcalidrawDisplayElements(left.getScene().elements),
    projectExcalidrawDisplayElements(right.getScene().elements),
  );
  assert.equal(
    projectExcalidrawDisplayElements(left.getScene().elements).find(
      (entry) => entry.id === "text",
    )!.text,
    "父删除期间文字",
  );
});

test("显示重复索引后原生局部重排使用 canonical 邻域，不发布显示 c000 索引", () => {
  const { a, left } = pair();
  left.applyCommand({
    elements: [
      element("a", 0, { index: "a2" }),
      element("b", 0, { index: "a2" }),
      element("c", 0, { index: "a3" }),
    ],
  });
  const session = new ExcalidrawSceneSession(left.binding);
  const display = session.project();
  session.accept(display);
  const changed: string[][] = [];
  a.getMap("elements").observe((event) => changed.push([...event.keysChanged]));
  const reordered = [
    display[1]!,
    { ...display[0]!, index: "c001V", version: 2 },
    display[2]!,
  ];
  session.publish(reordered);
  const result = left.getScene().elements;
  assert.deepEqual(
    result.map((entry) => entry.id),
    ["b", "a", "c"],
  );
  assert.ok(result[1]!.index > "a2" && result[1]!.index < "a3");
  assert.deepEqual(changed, [["a"]]);
});

test("暂缓子元素时远端父删除仍得到合法显示，结束不持久化技术解除关系", () => {
  const { left } = pair();
  const parent = element("frame", 0, {
    type: "frame",
    name: null,
    index: "a2",
  });
  const child = element("child", 10, {
    containerRef: { kind: "frameLike", elementId: "frame" },
    index: "a3",
  });
  left.applyCommand({ elements: [parent, child] });
  const session = new ExcalidrawSceneSession(left.binding);
  let display = session.project();
  session.accept(display);
  const local = display.map((entry) =>
    entry.id === "child" ? { ...entry, x: 15 } : entry,
  );
  left.removeElement("frame");
  display = session.project(local, new Set(["child"]));
  session.accept(display, new Set(["child"]));
  assert.equal(
    display.find((entry) => entry.id === "child")!.containerRef,
    undefined,
  );
  session.publish(display);
  const canonical = left
    .getScene()
    .elements.find((entry) => entry.id === "child")!;
  assert.equal(canonical.x, 15);
  assert.deepEqual(canonical.containerRef, child.containerRef);
});

test("批量追加到重复索引邻域只扩展必要相邻元素，返回额外变更 ID", () => {
  const { left } = pair();
  left.applyCommand({
    elements: [
      element("a", 0, { index: "a2" }),
      element("b", 0, { index: "a2" }),
      element("c", 0, { index: "a3" }),
    ],
  });
  const session = new ExcalidrawSceneSession(left.binding);
  const display = session.project();
  session.accept(display);
  const pasted = [
    display[0]!,
    element("paste-1", 10, { index: "c000G" }),
    element("paste-2", 20, { index: "c000V" }),
    display[1]!,
    display[2]!,
  ];
  const ids = session.publish(pasted);
  assert.deepEqual(ids.sort(), ["b", "paste-1", "paste-2"]);
  assert.deepEqual(
    left.getScene().elements.map((entry) => entry.id),
    ["a", "paste-1", "paste-2", "b", "c"],
  );
  assert.equal(left.getScene().elements[0]!.index, "a2");
  assert.equal(left.getScene().elements.at(-1)!.index, "a3");
});

test("同一画板重复创建和销毁桥接 100 次，observer 数量回到基线且不留远端回调", () => {
  const doc = new Y.Doc();
  onTestFinished(() => doc.destroy());
  doc.getMap("canvasMeta").set("sceneSchemaVersion", 2);
  const observerCount = () => doc._observers.get("afterTransaction")?.size ?? 0;
  const baseline = observerCount();
  const callbacks = { count: 0 };
  for (let i = 0; i < 100; i++) {
    const bridge = new TestSceneBridge(doc, 2, () => callbacks.count++);
    assert.equal(observerCount(), baseline + 1);
    bridge.dispose();
    assert.equal(observerCount(), baseline);
    doc.getMap("elements").set("lifecycle", element("lifecycle", i));
  }
  assert.equal(callbacks.count, 0);
});
