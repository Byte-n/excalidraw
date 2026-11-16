import { createCanvasSdk } from "../src";

import { rectangle, sessionFixture, withScene } from "./helpers";

const canvasId = "00000000-0000-4000-8000-000000000001";

let fixture: ReturnType<typeof sessionFixture>;

beforeEach(() => {
  fixture = sessionFixture();
});
afterEach(async () => {
  await fixture.dispose();
});

const makeSdk = (mode: "read" | "write" = "write") =>
  createCanvasSdk(fixture.session, { canvasId, code: "", mode });

const area = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) => {
  const width =
    Math.min(left.x + left.width, right.x + right.width) -
    Math.max(left.x, right.x);
  const height =
    Math.min(left.y + left.height, right.y + right.height) -
    Math.max(left.y, right.y);
  return width > 0 && height > 0 ? width * height : 0;
};

const summaryTotal = async (sdk: ReturnType<typeof makeSdk>) => {
  const view = await sdk.scene.get();
  return view.view === "summary" ? view.total : -1;
};

const readElement = async (sdk: ReturnType<typeof makeSdk>, id: string) => {
  const [element] = await sdk.scene.getElements([id]);
  return element as {
    id: string;
    type: string;
    version: number;
    x: number;
    y: number;
    width: number;
    height: number;
    texts?: Record<string, { text: string }>;
    startBinding?: { elementId: string } | null;
    endBinding?: { elementId: string } | null;
  };
};

test("apply 创建带 label 的图形与连线，并回填 tempId、绑定与回执", async () => {
  const sdk = makeSdk();
  const receipt = await sdk.apply({
    ops: [
      {
        op: "addShape",
        tempId: "a",
        kind: "rectangle",
        x: 0,
        y: 0,
        width: 160,
        height: 80,
        label: "服务 A",
      },
      {
        op: "addShape",
        tempId: "b",
        kind: "rectangle",
        x: 400,
        y: 0,
        label: { text: "服务 B", fit: "auto" },
      },
      {
        op: "connect",
        tempId: "edge",
        from: "a",
        to: "b",
        label: "调用",
      },
    ],
  });
  expect(receipt.createdElementIds).toHaveLength(3);
  expect(Object.keys(receipt.tempIds).sort()).toEqual(["a", "b", "edge"]);
  expect(receipt.warnings.some((w) => w.code === "input_corrected")).toBe(true);
  expect(receipt.elements).toHaveLength(3);
  expect(receipt.bounds.width).toBeGreaterThan(0);

  const a = receipt.tempIds.a;
  const b = receipt.tempIds.b;
  const edge = receipt.tempIds.edge;
  expect(receipt.elements.find((element) => element.id === a)?.tempId).toBe(
    "a",
  );
  expect(receipt.elements.find((element) => element.id === a)?.label).toBe(
    "服务 A",
  );

  const shapeA = await readElement(sdk, a);
  const shapeB = await readElement(sdk, b);
  const connector = await readElement(sdk, edge);
  expect(shapeA.texts?.body.text).toBe("服务 A");
  expect(shapeB.texts?.body.text).toBe("服务 B");
  expect(connector.startBinding?.elementId).toBe(a);
  expect(connector.endBinding?.elementId).toBe(b);
  expect(connector.texts?.label.text).toBe("调用");
});

test("一次 apply 内用 tempId 创建脑图并挂接子节点", async () => {
  const sdk = makeSdk();
  const receipt = await sdk.apply({
    ops: [
      {
        op: "mindmap",
        action: "createRoot",
        tempId: "root",
        x: 0,
        y: 0,
        text: "根",
      },
      {
        op: "mindmap",
        action: "addChild",
        nodeId: "root",
        tempId: "a",
        text: "A",
      },
      { op: "mindmap", action: "addChild", nodeId: "a", text: "A1" },
    ],
  });
  expect(Object.keys(receipt.tempIds).sort()).toEqual(["a", "root"]);
  const rootId = receipt.tempIds.root;
  const aId = receipt.tempIds.a;
  expect(rootId).toBeTruthy();
  expect(aId).toBeTruthy();
  // 3 个节点 + 2 次 addChild 各派生的 1 条连线
  expect(receipt.createdElementIds).toHaveLength(5);
  expect(
    receipt.elements.filter((element) => element.type === "mindmap-node"),
  ).toHaveLength(3);

  const view = await sdk.scene.get({ view: "full" });
  const nodes =
    view.view === "full"
      ? (view.elements.filter(
          (element) => element.type === "mindmap-node",
        ) as Array<{
          id: string;
          parentId: string | null;
          texts?: { body?: { text?: string } };
        }>)
      : [];
  expect(nodes).toHaveLength(3);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  expect(byId.get(rootId)?.parentId).toBeNull();
  expect(byId.get(aId)?.parentId).toBe(rootId);
  const a1 = nodes.find((node) => node.texts?.body?.text === "A1");
  expect(a1?.parentId).toBe(aId);
});

test("一次 apply 内 table.create 用 tempId 继续操作", async () => {
  const sdk = makeSdk();
  const receipt = await sdk.apply({
    ops: [
      {
        op: "table",
        action: "create",
        tempId: "t",
        position: { x: 0, y: 0 },
        rowCount: 2,
        columnCount: 2,
      },
      { op: "table", action: "setName", tableId: "t", name: "预算" },
    ],
  });
  const tableId = receipt.tempIds.t;
  expect(tableId).toBeTruthy();
  expect(receipt.createdElementIds).toContain(tableId);

  const [element] = (await sdk.scene.getElements([tableId])) as Array<{
    name?: string | null;
    table?: { rows: unknown[]; columns: unknown[]; cells: unknown[] };
  }>;
  expect(element.name).toBe("预算");
  expect(element.table?.rows).toHaveLength(2);
  expect(element.table?.columns).toHaveLength(2);
  expect(element.table?.cells).toHaveLength(4);
});

test("label.fit fixed 不改变宽高，auto 随文本增长", async () => {
  const sdk = makeSdk();
  const text = "这是一个非常长的标签文本，需要在固定尺寸内进行换行和截断处理";
  const fixed = await sdk.apply({
    ops: [
      {
        op: "addShape",
        tempId: "fixed",
        kind: "rectangle",
        x: 0,
        y: 0,
        width: 120,
        height: 60,
        label: { text, fit: "fixed" },
      },
    ],
  });
  const auto = await sdk.apply({
    ops: [
      {
        op: "addShape",
        tempId: "auto",
        kind: "rectangle",
        x: 300,
        y: 0,
        width: 120,
        height: 60,
        label: { text, fit: "auto" },
      },
    ],
  });
  const fixedElement = await readElement(sdk, fixed.tempIds.fixed);
  const autoElement = await readElement(sdk, auto.tempIds.auto);
  expect(fixedElement.width).toBe(120);
  expect(fixedElement.height).toBe(60);
  expect(autoElement.height).toBeGreaterThan(60);
});

test("dryRun 不写入，非法操作整批回滚", async () => {
  const sdk = makeSdk();
  const dry = await sdk.apply({
    dryRun: true,
    ops: [{ op: "addShape", kind: "rectangle", x: 0, y: 0 }],
  });
  expect(dry.createdElementIds).toHaveLength(1);
  expect(await summaryTotal(sdk)).toBe(0);

  await expect(
    sdk.apply({
      ops: [
        { op: "addShape", kind: "rectangle", x: 0, y: 0 },
        { op: "move", id: "missing", x: 10 },
      ],
    }),
  ).rejects.toMatchObject({ code: "target_not_found" });
  expect(await summaryTotal(sdk)).toBe(0);
});

test("expectedVersions 冲突抛出 version_conflict 且不写入", async () => {
  const sdk = makeSdk();
  const created = await sdk.apply({
    ops: [{ op: "addShape", tempId: "a", kind: "rectangle", x: 0, y: 0 }],
  });
  const id = created.tempIds.a;
  const before = await readElement(sdk, id);
  await expect(
    sdk.apply({
      ops: [{ op: "updateShape", id, label: "改名" }],
      expectedVersions: { [id]: before.version + 1 },
    }),
  ).rejects.toMatchObject({ code: "version_conflict" });
  const after = await readElement(sdk, id);
  expect(after.version).toBe(before.version);
  expect(after.texts?.body?.text ?? "").not.toBe("改名");
});

test("layout.apply layered 完成布局且 dryRun 不写入", async () => {
  const sdk = makeSdk();
  const created = await sdk.apply({
    ops: [
      { op: "addShape", tempId: "a", kind: "rectangle", x: 0, y: 0 },
      { op: "addShape", tempId: "b", kind: "rectangle", x: 0, y: 0 },
      { op: "addShape", tempId: "c", kind: "rectangle", x: 0, y: 0 },
      { op: "connect", from: "a", to: "b" },
      { op: "connect", from: "b", to: "c" },
    ],
  });
  const ids = [created.tempIds.a, created.tempIds.b, created.tempIds.c];
  const before = await Promise.all(ids.map((id) => readElement(sdk, id)));
  const receipt = await sdk.layout.apply({
    ids,
    algorithm: "layered",
  });
  expect(receipt.layoutToken).toBeTruthy();
  expect(receipt.bounds.width).toBeGreaterThan(0);
  expect(receipt.affectedElementIds.length).toBeGreaterThan(0);
  const after = await Promise.all(ids.map((id) => readElement(sdk, id)));
  expect(after.map((element) => [element.x, element.y])).not.toEqual(
    before.map((element) => [element.x, element.y]),
  );
  for (let left = 0; left < after.length; left++) {
    for (let right = left + 1; right < after.length; right++) {
      expect(area(after[left], after[right])).toBe(0);
    }
  }

  const dry = await sdk.layout.apply({
    ids,
    algorithm: "layered",
    dryRun: true,
  });
  expect(dry.layoutToken).toBeTruthy();
  expect(dry.affectedElementIds).toEqual([]);
  const afterDry = await Promise.all(ids.map((id) => readElement(sdk, id)));
  expect(afterDry.map((element) => [element.x, element.y])).toEqual(
    after.map((element) => [element.x, element.y]),
  );
});

test("text.measure/fit 返回合理度量与截断结果", async () => {
  const sdk = makeSdk("read");
  const measure = await sdk.text.measure({
    text: "hello\nworld",
    style: { fontSize: 20 },
  });
  expect(measure.width).toBeGreaterThan(0);
  expect(measure.lines).toBe(2);
  expect(measure.height).toBeCloseTo(measure.lineHeight * 20 * 2);

  const fit = await sdk.text.fit({
    text: "hello world hello world",
    style: { fontSize: 20 },
    maxWidth: 40,
  });
  expect(fit.lines.length).toBeGreaterThan(1);
  expect(fit.width).toBeLessThanOrEqual(40);
  expect(fit.truncated).toBe(false);

  const truncated = await sdk.text.fit({
    text: "a\na\na\na",
    style: { fontSize: 20 },
    maxWidth: 100,
    maxHeight: 30,
  });
  expect(truncated.truncated).toBe(true);
  expect(truncated.lines.length).toBe(1);
});

test("validate 检出重叠与文本溢出", async () => {
  const sdk = makeSdk();
  await sdk.apply({
    ops: [
      {
        op: "addShape",
        kind: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        label: "A",
      },
      {
        op: "addShape",
        kind: "rectangle",
        x: 10,
        y: 10,
        width: 100,
        height: 60,
        label: "B",
      },
    ],
  });
  const overlap = await sdk.validate({ checks: ["overlap"] });
  expect(overlap.ok).toBe(false);
  expect(overlap.issues[0]).toMatchObject({
    code: "overlap",
    severity: "warning",
  });
  expect(overlap.issues[0].elementIds).toHaveLength(2);

  const overflowFixture = sessionFixture();
  try {
    const shape = rectangle() as unknown as Record<string, unknown>;
    shape.texts = {
      body: {
        text: Array.from({ length: 10 }, () => "line").join("\n"),
        style: {
          fontFamily: 6,
          fontSize: 20,
          lineHeight: 1.25,
          textAlign: "center",
          verticalAlign: "middle",
        },
      },
    };
    withScene(overflowFixture.session, {
      elements: [shape] as never,
      assets: {},
    });
    const overflowSdk = createCanvasSdk(overflowFixture.session, {
      canvasId,
      code: "",
      mode: "read",
    });
    const overflow = await overflowSdk.validate({ checks: ["overflow"] });
    expect(overflow.issues).toHaveLength(1);
    expect(overflow.issues[0]).toMatchObject({
      code: "overflow",
      elementIds: [shape.id],
    });
  } finally {
    await overflowFixture.dispose();
  }
});

test("read 模式写操作抛出 not_editable", async () => {
  const sdk = makeSdk("read");
  await expect(
    sdk.apply({
      ops: [{ op: "addShape", kind: "rectangle", x: 0, y: 0 }],
    }),
  ).rejects.toMatchObject({ code: "not_editable" });
  await expect(
    sdk.layout.apply({ ids: ["a"], algorithm: "grid" }),
  ).rejects.toMatchObject({ code: "not_editable" });
});

test("schema.get 生成 JSON Schema，export 仅接受 JSON", async () => {
  const sdk = makeSdk("read");
  const schema = await sdk.schema.get({ type: "apply" });
  expect(schema).toMatchObject({ type: "object" });
  expect(JSON.stringify(schema)).toContain("addShape");
  await expect(sdk.export({ format: "png" as never })).rejects.toMatchObject({
    code: "unsupported_format",
  });
  const snapshot = await sdk.export({ format: "json" });
  expect(snapshot.schemaVersion).toBe(2);
});
