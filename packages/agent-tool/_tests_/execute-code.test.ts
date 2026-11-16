// Test doubles intentionally expose partial canvas capabilities.
// @ts-nocheck
import { SHAPE_IDS } from "@excalidraw/yjs";

import {
  CanvasSdkError,
  createCanvasExecuteCodeTool,
  createCanvasSdk,
} from "../src";

import { sessionFixture } from "./helpers";

const createTool = (hooks: any) => createCanvasExecuteCodeTool(hooks);

const fixture = sessionFixture();
const { session } = fixture;
afterAll(() => fixture.dispose());
const canvasId = "00000000-0000-4000-8000-000000000001";
const input = (code: string) => ({ canvasId, code, mode: "write" });

test("注入 canvas SDK 并收集 apply 回执", async () => {
  const receipt = {
    changedElementIds: ["a"],
    createdElementIds: ["a"],
    deletedElementIds: [],
  };
  const tool = createTool({
    sessionFactory: () => session,
    sdkFactory: (_session, context) => {
      expect(context.canvasId).toBe(canvasId);
      expect(context.mode).toBe("write");
      expect(context.signal).toBeInstanceOf(AbortSignal);
      return {
        apply: async (value: unknown) => {
          expect(value).toEqual({
            ops: [{ op: "addShape", kind: "rectangle", x: 0, y: 0 }],
          });
          return receipt;
        },
      };
    },
  });
  const result = await tool.execute(
    input(
      "const r = await canvas.apply({ ops: [{ op: 'addShape', kind: 'rectangle', x: 0, y: 0 }] }); return { id: r.createdElementIds[0] };",
    ),
  );
  expect(result).toEqual({
    ok: true,
    status: "local_applied",
    result: { id: "a" },
    receipts: [{ method: "apply", receipt }],
  });
});

test("嵌套 layout.apply 回执使用完整方法名", async () => {
  const receipt = {
    affectedElementIds: ["a"],
    elements: [],
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    warnings: [],
    layoutToken: "token",
  };
  const tool = createTool({
    sessionFactory: () => session,
    sdkFactory: () => ({
      layout: {
        apply: async () => receipt,
      },
    }),
  });
  const result = await tool.execute(
    input(
      "await canvas.layout.apply({ ids: ['a'], algorithm: 'layered' }); return null;",
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.receipts).toEqual([{ method: "layout.apply", receipt }]);
});

test("自定义执行器获得注入对象且完全替代默认执行", async () => {
  const canvas = { apply: async () => ({ changedElementIds: ["a"] }) };
  const tool = createTool({
    sessionFactory: () => session,
    sdkFactory: () => canvas,
    executor: {
      execute: async ({ code, canvas: injected }) => {
        expect(code).toBe("不应直接执行的文本");
        expect(injected).toBe(canvas);
        return { ok: true, status: "read", result: 7 };
      },
    },
  });
  expect(await tool.execute(input("不应直接执行的文本"))).toEqual({
    ok: true,
    status: "read",
    result: 7,
  });
});

test("不 await 的写调用在工具返回前完成且登记真实回执", async () => {
  let complete = false;
  const tool = createTool({
    sessionFactory: () => session,
    sdkFactory: () => ({
      apply: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        complete = true;
        return { changedElementIds: ["a"] };
      },
    }),
  });
  const result = await tool.execute(
    input("canvas.apply({ ops: [] }); return 1;"),
  );
  expect(complete).toBe(true);
  expect(result.ok && result.status).toBe("local_applied");
  expect(result.receipts).toHaveLength(1);
});

test("SDK 拒绝即使不 await 也收敛为稳定失败并报告错误码", async () => {
  const error = new CanvasSdkError("not_editable", "会话不可编辑");
  const errors: unknown[] = [];
  const tool = createTool({
    sessionFactory: () => session,
    sdkFactory: () => ({
      apply: async () => {
        throw error;
      },
    }),
    onError: (value) => errors.push(value),
  });
  const result = await tool.execute(
    input("canvas.apply({ ops: [] }); return 1;"),
  );
  expect(result.ok).toBe(false);
  expect(result.ok ? undefined : result.error.code).toBe("not_editable");
  expect(
    errors.some(
      (value) =>
        value instanceof Error &&
        (value as { code?: unknown }).code === "not_editable",
    ),
  ).toBe(true);
});

test("canvas.apply 参数校验失败时回传合法图形类型", async () => {
  const tool = createCanvasExecuteCodeTool({
    sessionFactory: () => session,
    sdkFactory: (target) =>
      createCanvasSdk(target, { canvasId, code: "", mode: "write" }),
  });
  const result = await tool.execute(
    input(
      'return await canvas.apply({ ops: [{ op: "addShape", kind: "nope", x: 0, y: 0 }] });',
    ),
  );
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  expect(result.error.code).toBe("invalid_input");
  const details = result.error.details as { legalValues?: string[] };
  expect(details.legalValues).toContain("ellipse");
  expect(details.legalValues).toEqual(expect.arrayContaining([...SHAPE_IDS]));
});

test("提前取消不执行 SDK，结束释放工厂 signal", async () => {
  const controller = new AbortController();
  controller.abort();
  let executed = false;
  let executionSignal: AbortSignal | undefined;
  const tool = createTool({
    sessionFactory: () => session,
    sdkFactory: (_session, { signal }) => {
      executionSignal = signal;
      return {
        apply: () => {
          executed = true;
        },
      };
    },
  });
  const result = await tool.execute(input("await canvas.apply({ ops: [] });"), {
    signal: controller.signal,
  });
  expect(result.ok ? undefined : result.error.code).toBe("execution_cancelled");
  expect(executed).toBe(false);
  expect(executionSignal?.aborted).toBe(true);
});

test("直接执行只接受完整 JSON 结果，不静默丢弃不合法值", async () => {
  const tool = createTool({
    sessionFactory: () => session,
    sdkFactory: () => ({}),
  });
  expect(await tool.execute(input("return undefined;"))).toEqual({
    ok: true,
    status: "read",
    result: null,
    receipts: [],
  });
  for (const code of [
    "return { bad: undefined };",
    "return new Date();",
    "return [1,,2];",
    "return { get secret() { throw new Error('不能调用getter'); } };",
    "return NaN;",
  ]) {
    const result = await tool.execute(input(code));
    expect(result.ok ? undefined : result.error.code).toBe("invalid_result");
  }
});
