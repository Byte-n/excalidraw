// @ts-nocheck
import { createWorkerExecutor } from "../src";

const canvas = () => ({
  apply: async (input: unknown) => ({
    changedElementIds: ["a"],
    createdElementIds: ["a"],
    deletedElementIds: [],
    input,
  }),
});

test("在 vm 上下文执行脚本，注入 canvas 并收集回执", async () => {
  const executor = createWorkerExecutor({ timeoutMs: 5_000 });
  const result = await executor.execute({
    code: `
      const receipt = await canvas.apply({ op: "addShape" });
      return {
        id: receipt.createdElementIds[0],
        process: typeof process,
        require: typeof require,
        eval: (() => {
          try {
            eval("1 + 1");
            return "allowed";
          } catch {
            return "blocked";
          }
        })(),
      };
    `,
    canvas: canvas(),
  });
  expect(result).toMatchObject({
    ok: true,
    status: "local_applied",
    result: {
      id: "a",
      process: "undefined",
      require: "undefined",
      eval: "blocked",
    },
    receipts: [
      {
        method: "apply",
        receipt: {
          changedElementIds: ["a"],
          createdElementIds: ["a"],
          deletedElementIds: [],
          input: { op: "addShape" },
        },
      },
    ],
  });
});

test("同步死循环按超时终止", async () => {
  const executor = createWorkerExecutor({ timeoutMs: 80 });
  const result = await executor.execute({
    code: "while (true) {}",
    canvas: canvas(),
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "execution_timeout" },
  });
});

test("Web AbortSignal 取消正在执行的脚本", async () => {
  const executor = createWorkerExecutor({ timeoutMs: 5_000 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 60);
  const result = await executor.execute({
    code: "await new Promise((resolve) => setTimeout(resolve, 1000)); return 1;",
    canvas: canvas(),
    signal: controller.signal,
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "execution_cancelled" },
  });
});

test("调用次数与结果大小受配额限制", async () => {
  const limited = createWorkerExecutor({
    timeoutMs: 5_000,
    maxCalls: 2,
  });
  const calls = await limited.execute({
    code: `
      await canvas.apply({ op: "a" });
      await canvas.apply({ op: "b" });
      await canvas.apply({ op: "c" });
      return null;
    `,
    canvas: canvas(),
  });
  expect(calls).toMatchObject({
    ok: false,
    error: { code: "quota_exceeded" },
  });
  expect((calls as { receipts: unknown[] }).receipts).toHaveLength(2);

  const smallResult = createWorkerExecutor({
    timeoutMs: 5_000,
    maxResultBytes: 8,
  });
  const result = await smallResult.execute({
    code: "return 'x'.repeat(100);",
    canvas: canvas(),
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "quota_exceeded" },
  });
});
