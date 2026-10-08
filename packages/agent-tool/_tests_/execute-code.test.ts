import { createCanvasExecuteCodeTool } from "../src";

import { sessionFixture } from "./helpers";

const fixture = sessionFixture();
const { session } = fixture;
afterAll(() => fixture.dispose());
const canvasId = "00000000-0000-4000-8000-000000000001";
const input = (code: string) => ({ canvasId, code, mode: "write" });

test("省略沙箱时直接执行异步函数，协作方法保留宿主对象与结果身份", async () => {
  const value = { count: 1 };
  const tool = createCanvasExecuteCodeTool({
    sessionFactory: () => session,
    collaborationFactory: (_session, context) => {
      expect(context.canvasId).toBe(canvasId);
      expect(context.mode).toBe("write");
      expect(context.signal).toBeInstanceOf(AbortSignal);
      return {
        getScene: () => value,
        execute: async () => {
          value.count++;
          return { changedElementIds: ["a"] };
        },
      };
    },
  });
  const result = await tool.execute(
    input(
      "const scene = await collaboration.getScene(); await collaboration.execute(); return { count: scene.count, host: typeof process !== 'undefined' };",
    ),
  );
  expect(result).toEqual({
    ok: true,
    status: "local_applied",
    result: { count: 2, host: true },
    receipts: [{ method: "execute", receipt: { changedElementIds: ["a"] } }],
  });
  expect(value.count).toBe(2);
});

test("自定义执行器获得工厂对象且完全替代默认执行", async () => {
  const api = { getScene: () => ({ elements: [] }) };
  const tool = createCanvasExecuteCodeTool({
    sessionFactory: () => session,
    collaborationFactory: () => api,
    executor: {
      execute: async ({ code, collaboration }) => {
        expect(code).toBe("不应直接执行的文本");
        expect(collaboration).toBe(api);
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
  const tool = createCanvasExecuteCodeTool({
    sessionFactory: () => session,
    collaborationFactory: () => ({
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        complete = true;
        return { changedElementIds: ["a"] };
      },
    }),
  });
  const result = await tool.execute(
    input("collaboration.execute(); return 1;"),
  );
  expect(complete).toBe(true);
  expect(result.ok && result.status).toBe("local_applied");
  expect(result.receipts).toHaveLength(1);
});

test("协作拒绝即使不 await 也收敛为稳定失败并报告原始异常", async () => {
  const error = new Error("宿主异常不得泄露");
  const errors: unknown[] = [];
  const tool = createCanvasExecuteCodeTool({
    sessionFactory: () => session,
    collaborationFactory: () => ({
      execute: async () => {
        throw error;
      },
    }),
    onError: (value) => errors.push(value),
  });
  const result = await tool.execute(
    input("collaboration.execute(); return 1;"),
  );
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain(error.message);
  expect(errors).toContain(error);
});

test("提前取消不执行协作能力，结束释放工厂signal", async () => {
  const controller = new AbortController();
  controller.abort();
  let executed = false;
  let executionSignal: AbortSignal | undefined;
  const tool = createCanvasExecuteCodeTool({
    sessionFactory: () => session,
    collaborationFactory: (_session, { signal }) => {
      executionSignal = signal;
      return {
        execute: () => {
          executed = true;
        },
      };
    },
  });
  const result = await tool.execute(input("await collaboration.execute();"), {
    signal: controller.signal,
  });
  expect(result.ok ? undefined : result.error.code).toBe("execution_cancelled");
  expect(executed).toBe(false);
  expect(executionSignal?.aborted).toBe(true);
});

test("直接执行只接受完整JSON结果，不静默丢弃不合法值", async () => {
  const tool = createCanvasExecuteCodeTool({
    sessionFactory: () => session,
    collaborationFactory: () => ({}),
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
