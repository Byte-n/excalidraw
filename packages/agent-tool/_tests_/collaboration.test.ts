import {
  createCanvasCollaboration,
  createCanvasExecuteCodeTool,
  type CanvasExecutionContext,
  type CanvasExecuteInput,
} from "../src";

import { rectangle, sessionFixture, withScene } from "./helpers";

const canvasId = "00000000-0000-4000-8000-000000000001";
const context = (
  mode: "read" | "write" = "write",
  signal?: AbortSignal,
): CanvasExecutionContext => ({ canvasId, mode, code: "return null;", signal });

test("默认工厂读取 schema 2 JSON 副本，省略合法可选字段并保留墓碑与原始文本尺寸", async () => {
  const f = sessionFixture();
  try {
    const value = {
      ...rectangle(),
      index: "a0",
      isDeleted: true,
      optional: undefined,
    };
    const text = {
      ...rectangle(),
      id: "text",
      index: "a1",
      type: "text",
      width: undefined,
      height: undefined,
    };
    const sizedText = {
      ...text,
      id: "sized-text",
      index: "a2",
      width: 40,
      height: 20,
    };
    f.binding.applyLocal([value, text, sizedText]);
    const api = createCanvasCollaboration(f.session, context());
    const scene = api.getScene!();
    expect(scene).toEqual({
      schemaVersion: 2,
      elements: JSON.parse(JSON.stringify([value, text, sizedText])),
      assets: {},
    });
    const elements = api.getElements!([value.id, value.id]);
    expect(elements).toHaveLength(1);
    if (!Array.isArray(elements)) {
      throw new Error("读取结果应为数组");
    }
    elements.length = 0;
    expect(f.binding.getElements()).toHaveLength(3);
    expect(api.getElements!([])).toEqual([]);
    expect(() => api.getElements!(["missing"])).toThrow("target_not_found");
  } finally {
    await f.dispose();
  }
});

test("默认工厂拒绝非法 canonical、新增输入和非数据快照，不调用 getter", async () => {
  const f = sessionFixture();
  try {
    const api = createCanvasCollaboration(f.session, context());
    expect(() =>
      // @ts-expect-error Deliberately incomplete canonical element.
      api.mutate!({ mutations: [{ type: "add", element: { id: "fake" } }] }),
    ).toThrow();
    expect(f.binding.getElements()).toHaveLength(0);
    let called = false;
    const bad = withScene(f.session, {
      elements: [rectangle()],
      assets: {
        get secret() {
          called = true;
          return {};
        },
      },
    });
    expect(() => createCanvasCollaboration(bad, context()).getScene!()).toThrow(
      "invalid_scene",
    );
    expect(called).toBe(false);
    const invalid = withScene(f.session, {
      elements: [{ ...rectangle(), version: 0 }],
      assets: {},
    });
    expect(() =>
      createCanvasCollaboration(invalid, context()).getElements!(),
    ).toThrow();
  } finally {
    await f.dispose();
  }
});

test("默认工厂在权限、取消、同步及 generation 翻转后拒绝旧能力", async () => {
  const f = sessionFixture();
  try {
    const controller = new AbortController();
    const api = createCanvasCollaboration(
      f.session,
      context("write", controller.signal),
    );
    const input: CanvasExecuteInput = {
      domain: "shape",
      operation: {
        action: "create",
        kind: "rectangle",
        geometry: { x: 0, y: 0, width: 100, height: 60 },
      },
    };
    expect(
      Object.keys(createCanvasCollaboration(f.session, context("read"))),
    ).toEqual(["getScene", "getElements", "query"]);
    f.binding.setGate({ canEdit: false });
    expect(() => api.execute!(input)).toThrow("not_editable");
    f.binding.setGate({ canEdit: true, synced: false });
    expect(() => api.getScene!()).toThrow("session_unavailable");
    f.binding.setGate({ synced: true, generation: 1 });
    expect(() => api.getElements!()).toThrow("session_unavailable");
    controller.abort();
    expect(() =>
      api.query!({ domain: "shape", operation: { action: "list" } }),
    ).toThrow("execution_cancelled");
    expect(f.binding.getElements()).toHaveLength(0);
  } finally {
    await f.dispose();
  }
});

test("每次执行 await 当前 session 并重新捕获 generation，传递 mode 与独立 signal", async () => {
  const f = sessionFixture();
  const signals: AbortSignal[] = [];
  try {
    const tool = createCanvasExecuteCodeTool({
      sessionFactory: async (value) => {
        await Promise.resolve();
        expect(value.canvasId).toBe(canvasId);
        expect(value.mode).toBe("read");
        if (!value.signal) {
          throw new Error("执行应提供 signal");
        }
        expect(value.signal.aborted).toBe(false);
        signals.push(value.signal);
        return f.session;
      },
    });
    const input = {
      canvasId,
      mode: "read",
      code: "return await collaboration.getScene();",
    };
    expect((await tool.execute(input)).ok).toBe(true);
    f.session.suspend();
    f.synchronize();
    expect((await tool.execute(input)).ok).toBe(true);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  } finally {
    await f.dispose();
  }
});

test("可选异步工厂获得当前 session 与上下文，严格输入在调用 sessionFactory 前拒绝", async () => {
  const f = sessionFixture();
  let calls = 0;
  try {
    const tool = createCanvasExecuteCodeTool({
      sessionFactory: async () => {
        calls++;
        return f.session;
      },
      collaborationFactory: async (session, value) => {
        expect(session).toBe(f.session);
        expect(value.mode).toBe("write");
        return { custom: () => 3 };
      },
    });
    expect(
      await tool.execute({
        canvasId,
        mode: "write",
        code: "return await collaboration.custom();",
      }),
    ).toMatchObject({ ok: true, result: 3 });
    await expect(
      tool.execute({
        canvasId,
        mode: "write",
        code: "return 1;",
        token: "private",
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  } finally {
    await f.dispose();
  }
});

test("默认执行器用真实领域写入生成回执，非法安全版本和受保护 patch 不改变场景", async () => {
  const f = sessionFixture();
  try {
    const operation: CanvasExecuteInput = {
      domain: "shape",
      operation: {
        action: "create",
        kind: "rectangle",
        geometry: { x: 0, y: 0, width: 100, height: 60 },
      },
    };
    const tool = createCanvasExecuteCodeTool({
      sessionFactory: () => f.session,
    });
    const result = await tool.execute({
      canvasId,
      mode: "write",
      code: `await collaboration.execute(${JSON.stringify(
        operation,
      )}); return await collaboration.getScene();`,
    });
    expect(result).toMatchObject({
      ok: true,
      status: "local_applied",
      result: { schemaVersion: 2 },
      receipts: [{ method: "execute" }],
    });
    const value = f.binding.getElements()[0];
    if (!value) {
      throw new Error("领域写入应创建元素");
    }
    const api = createCanvasCollaboration(f.session, context());
    expect(() =>
      api.execute!({
        ...operation,
        expectedVersion: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
    expect(() =>
      api.mutate!({
        mutations: [{ type: "update", id: value.id, patch: { id: "changed" } }],
      }),
    ).toThrow();
    expect(f.binding.getElements()).toEqual([value]);
    expect(
      api.query({ domain: "shape", operation: { action: "list" } }),
    ).toMatchObject({ total: 1 });
    expect(() => Reflect.apply(api.createElement!, api, [{}])).toThrow();
  } finally {
    await f.dispose();
  }
});

test("自定义宿主快照拒绝隐藏序列化 hook、非枚举 getter 与数组额外属性，始终不执行 hook", async () => {
  const f = sessionFixture();
  let calls = 0;
  try {
    const scene = () => ({ elements: [rectangle()], assets: {} });
    const hiddenHook = scene();
    Object.defineProperty(hiddenHook.elements[0], "toJSON", {
      value: () => {
        calls++;
        return { id: "forged" };
      },
    });
    const hiddenGetter = scene();
    Object.defineProperty(hiddenGetter.elements[0], "secret", {
      get: () => {
        calls++;
        return "private";
      },
    });
    const arrayHook = scene();
    Object.defineProperty(arrayHook.elements, "toJSON", {
      value: () => {
        calls++;
        return [];
      },
    });
    for (const value of [hiddenHook, hiddenGetter, arrayHook]) {
      const session = withScene(f.session, value);
      expect(() =>
        createCanvasCollaboration(session, context()).getScene!(),
      ).toThrow("invalid_scene");
    }
    expect(calls).toBe(0);
  } finally {
    await f.dispose();
  }
});

test("规范化后重新验证 canonical，非枚举必需字段与数组空洞不得变成成功快照", async () => {
  const f = sessionFixture();
  try {
    const value = rectangle();
    Object.defineProperty(value, "version", {
      value: value.version,
      enumerable: false,
    });
    const session = withScene(f.session, { elements: [value], assets: {} });
    expect(() =>
      createCanvasCollaboration(session, context()).getElements!(),
    ).toThrow();
    const sparse = withScene(f.session, {
      elements: Array<typeof value>(1),
      assets: {},
    });
    expect(() =>
      createCanvasCollaboration(sparse, context()).getScene!(),
    ).toThrow("invalid_scene");
  } finally {
    await f.dispose();
  }
});

test("新增元素拒绝无法完整保留的 JSON 字段且不产生事务", async () => {
  const f = sessionFixture();
  try {
    const updates = vi.fn();
    f.doc.on("update", updates);
    const api = createCanvasCollaboration(f.session, context());
    const valid: ReturnType<typeof rectangle> = JSON.parse(
      JSON.stringify(rectangle()),
    );
    const hiddenVersion = { ...valid };
    Object.defineProperty(hiddenVersion, "version", {
      value: hiddenVersion.version,
      enumerable: false,
    });
    expect(() =>
      api.mutate!({ mutations: [{ type: "add", element: hiddenVersion }] }),
    ).toThrow();
    const getter = vi.fn(() => "private");
    const accessor = { ...valid };
    Object.defineProperty(accessor, "secret", { get: getter });
    expect(() =>
      api.mutate!({ mutations: [{ type: "add", element: accessor }] }),
    ).toThrow("invalid_scene");
    expect(getter).not.toHaveBeenCalled();
    expect(updates).not.toHaveBeenCalled();
    expect(f.binding.getElements()).toHaveLength(0);
    for (const value of [
      { ...valid, unexpected: undefined },
      { ...valid, customData: { bad: undefined } },
    ]) {
      expect(() =>
        api.mutate!({ mutations: [{ type: "add", element: value }] }),
      ).toThrow("invalid_scene");
    }
    const hiddenOptional = { ...valid };
    Object.defineProperty(hiddenOptional, "link", {
      value: 42,
      enumerable: false,
    });
    expect(() =>
      api.mutate!({ mutations: [{ type: "add", element: hiddenOptional }] }),
    ).toThrow("invalid_scene");
    const sparse = Array<number>(1);
    Object.defineProperty(sparse, "4294967295", { value: 1, enumerable: true });
    expect(() =>
      api.mutate!({
        mutations: [
          { type: "add", element: { ...valid, customData: { sparse } } },
        ],
      }),
    ).toThrow("invalid_scene");
    expect(updates).not.toHaveBeenCalled();
    api.mutate!({ mutations: [{ type: "add", element: valid }] });
    expect(updates).toHaveBeenCalledTimes(1);
    expect(f.binding.getElements()[0]).toEqual(valid);
  } finally {
    await f.dispose();
  }
});

test("草稿不提交，add 后可分页查询，删除和返回副本不影响查询", async () => {
  const f = sessionFixture();
  try {
    const api = createCanvasCollaboration(f.session, context());
    const draft = await api.createElement!({
      kind: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    });
    expect(f.binding.getElements()).toHaveLength(0);
    await api.mutate!({ mutations: [{ type: "add", element: draft }] });
    const result = await api.query({
      domain: "shape",
      operation: { action: "list", limit: 1 },
    });
    expect(result).toMatchObject({ total: 1, hasMore: false });
    result.items[0].x = 999;
    expect(f.binding.getElements()[0].x).toBe(0);
    expect(
      await api.query({
        domain: "shape",
        operation: { action: "list", offset: 1 },
      }),
    ).toMatchObject({ total: 1, items: [] });
    await api.mutate!({ mutations: [{ type: "delete", id: draft.id }] });
    expect(
      await api.query({ domain: "shape", operation: { action: "list" } }),
    ).toMatchObject({ total: 0 });
    expect(() =>
      api.query({
        domain: "shape",
        operation: { action: "get", elementId: draft.id },
      }),
    ).toThrow("target_not_found");
  } finally {
    await f.dispose();
  }
});

test("四个领域查询均校验协议，草稿脚本只产生读取结果", async () => {
  const f = sessionFixture();
  try {
    const api = createCanvasCollaboration(f.session, context("read"));
    for (const domain of ["shape", "connector", "mindmap", "table"] as const) {
      expect(
        await api.query({ domain, operation: { action: "list" } }),
      ).toEqual({
        domain,
        items: [],
        total: 0,
        offset: 0,
        limit: 50,
        hasMore: false,
      });
      expect(() =>
        Reflect.apply(api.query, api, [
          { domain, operation: { action: "list", limit: 201 } },
        ]),
      ).toThrow();
    }
    const tool = createCanvasExecuteCodeTool({
      sessionFactory: () => f.session,
    });
    expect(
      await tool.execute({
        canvasId,
        mode: "write",
        code: 'return await collaboration.createElement({ kind: "rectangle", x: 0, y: 0, width: 10, height: 10 });',
      }),
    ).toMatchObject({
      ok: true,
      status: "read",
      result: { type: "composite_shape", width: 10 },
    });
    expect(f.binding.getElements()).toHaveLength(0);
  } finally {
    await f.dispose();
  }
});
