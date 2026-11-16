import { Worker } from "node:worker_threads";

import {
  assertJson,
  describeFailure,
  isReceipt,
  readErrorCode,
  readErrorExtras,
} from "./script-support.js";

import type { CanvasCodeExecutor } from "./port.js";

export type WorkerExecutorOptions = Readonly<{
  /** 墙钟超时；0 表示不限制。默认 30s。 */
  timeoutMs?: number;
  /** V8 老生代上限；0 表示不限制。默认 256MB。 */
  memoryLimitMb?: number;
  /** 单次执行允许的 canvas RPC 调用数，默认 10000。 */
  maxCalls?: number;
  /** 最终 JSON 结果上限（字节），默认 4MB。 */
  maxResultBytes?: number;
}>;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_LIMIT_MB = 256;
const DEFAULT_MAX_CALLS = 10_000;
const DEFAULT_MAX_RESULT_BYTES = 4 * 1024 * 1024;

const WORKER_SOURCE = `
const { parentPort, workerData } = process.getBuiltinModule(
  "node:worker_threads",
);
const vm = process.getBuiltinModule("node:vm");

const { code, manifest } = workerData;
let nextCallId = 0;
const calls = new Map();
const pending = [];

const serializeError = (error) => {
  const data = {
    message: error instanceof Error ? error.message : String(error),
  };
  if (error && typeof error === "object") {
    for (const key of ["code", "details", "retryable", "hint"]) {
      if (key in error) {
        data[key] = error[key];
      }
    }
  }
  if (data.message === "invalid_result" && !data.code) {
    data.code = "invalid_result";
  }
  try {
    structuredClone(data);
    return data;
  } catch {
    return { message: data.message };
  }
};

const restoreError = (data) => {
  const error = new Error(
    data && typeof data.message === "string" ? data.message : "script_error",
  );
  if (data && typeof data === "object") {
    for (const key of ["code", "details", "retryable", "hint"]) {
      if (key in data) {
        error[key] = data[key];
      }
    }
  }
  return error;
};

const assertJson = (value, seen = new Set()) => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return;
  }
  if (typeof value !== "object" || seen.has(value)) {
    throw new Error("invalid_result");
  }
  if (
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) !== "[object Object]"
  ) {
    const error = new Error("invalid_result");
    error.code = "invalid_result";
    throw error;
  }
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
    const error = new Error("invalid_result");
    error.code = "invalid_result";
    throw error;
  }
  seen.add(value);
  const keys = Array.isArray(value)
    ? Array.from({ length: value.length }, (_, index) => String(index))
    : Object.keys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      const error = new Error("invalid_result");
      error.code = "invalid_result";
      throw error;
    }
    assertJson(descriptor.value, seen);
  }
  seen.delete(value);
};

const freeze = (value) => {
  if (!value || typeof value !== "object") {
    return value;
  }
  for (const key of Object.keys(value)) {
    freeze(value[key]);
  }
  return Object.freeze(value);
};

const createCanvas = (paths) => {
  const root = {};
  for (const path of paths) {
    const parts = path.split(".");
    let target = root;
    for (let index = 0; index < parts.length - 1; index++) {
      if (!target[parts[index]] || typeof target[parts[index]] !== "object") {
        target[parts[index]] = {};
      }
      target = target[parts[index]];
    }
    const method = parts[parts.length - 1];
    target[method] = (...args) => {
      const promise = new Promise((resolve, reject) => {
        const id = nextCallId++;
        calls.set(id, { resolve, reject });
        try {
          parentPort.postMessage({ type: "call", id, path, args });
        } catch (error) {
          calls.delete(id);
          reject(error);
        }
      });
      promise.catch(() => {});
      pending.push(promise);
      return promise;
    };
  }
  return freeze(root);
};

parentPort.on("message", (message) => {
  if (!message || (message.type !== "result" && message.type !== "error")) {
    return;
  }
  const call = calls.get(message.id);
  if (!call) {
    return;
  }
  calls.delete(message.id);
  if (message.type === "result") {
    call.resolve(message.value);
  } else {
    call.reject(restoreError(message.error));
  }
});

const sandbox = {
  canvas: createCanvas(manifest),
  console,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  TextEncoder,
  TextDecoder,
  URL,
  URLSearchParams,
  structuredClone,
};
const context = vm.createContext(sandbox, {
  codeGeneration: { strings: false, wasm: false },
});

(async () => {
  try {
    const script = new vm.Script(
      '(async (canvas) => { "use strict";\\n' + code + '\\n})',
      { filename: "execute_code.js" },
    );
    const fn = script.runInContext(context);
    const value = await fn(sandbox.canvas);
    const settled = await Promise.allSettled(pending);
    const rejected = settled.find((item) => item.status === "rejected");
    if (rejected && rejected.status === "rejected") {
      throw rejected.reason;
    }
    const result = value === undefined ? null : value;
    assertJson(result);
    parentPort.postMessage({ type: "done", value: result });
  } catch (error) {
    await Promise.allSettled(pending);
    parentPort.postMessage({ type: "error", error: serializeError(error) });
  }
})();
`;

type ReceiptEntry = { method: string; receipt: Record<string, unknown> };

const collectMethods = (canvas: unknown) => {
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  const visit = (value: unknown, prefix: string, depth: number) => {
    if (
      depth > 3 ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return;
    }
    for (const [key, member] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof member === "function") {
        methods.set(path, member.bind(value));
      } else if (member && typeof member === "object") {
        visit(member, path, depth + 1);
      }
    }
  };
  visit(canvas, "", 0);
  return methods;
};

const serializeError = (error: unknown) => {
  const data: Record<string, unknown> = {
    message: error instanceof Error ? error.message : String(error),
  };
  if (error && typeof error === "object") {
    for (const key of ["code", "details", "retryable", "hint"]) {
      if (key in error) {
        data[key] = (error as Record<string, unknown>)[key];
      }
    }
  }
  try {
    return structuredClone(data);
  } catch {
    return { message: data.message };
  }
};

const failure = (
  receipts: readonly ReceiptEntry[],
  code: string,
  message: string,
  extras: { details?: unknown; retryable?: boolean; hint?: string } = {},
  onError?: (error: unknown) => void,
) => {
  const error = Object.assign(new Error(message), { code, ...extras });
  onError?.(error);
  return {
    ok: false as const,
    error: {
      code,
      message,
      ...(extras.details !== undefined ? { details: extras.details } : {}),
      ...(extras.retryable !== undefined
        ? { retryable: extras.retryable }
        : {}),
      ...(extras.hint !== undefined ? { hint: extras.hint } : {}),
    },
    receipts: [...receipts],
  };
};

export const createWorkerExecutor = (
  options: WorkerExecutorOptions = {},
): CanvasCodeExecutor => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryLimitMb = options.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;
  const maxCalls = options.maxCalls ?? DEFAULT_MAX_CALLS;
  const maxResultBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;

  return {
    execute: ({ code, canvas, signal, onError }) =>
      new Promise((resolve) => {
        const receipts: ReceiptEntry[] = [];
        const methods = collectMethods(canvas);
        let settled = false;
        let callCount = 0;
        let worker: Worker | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          signal?.removeEventListener("abort", onAbort);
        };
        const finish = (output: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          if (worker) {
            void worker.terminate().catch(() => {});
            worker = null;
          }
          resolve(output);
        };
        const fail = (
          code: string,
          message: string,
          extras: {
            details?: unknown;
            retryable?: boolean;
            hint?: string;
          } = {},
        ) => finish(failure(receipts, code, message, extras, onError));
        const onAbort = () => {
          fail("execution_cancelled", "脚本执行已取消");
        };

        if (signal?.aborted) {
          fail("execution_cancelled", "脚本执行已取消");
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });

        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            fail("execution_timeout", "脚本执行超时", {
              details: { timeoutMs },
            });
          }, timeoutMs);
        }

        try {
          worker = new Worker(WORKER_SOURCE, {
            eval: true,
            workerData: { code, manifest: [...methods.keys()] },
            ...(memoryLimitMb > 0
              ? {
                  resourceLimits: {
                    maxOldGenerationSizeMb: memoryLimitMb,
                  },
                }
              : {}),
          });
        } catch (error) {
          fail("script_error", describeFailure("script_error", error));
          return;
        }

        worker.on("message", async (message: unknown) => {
          if (
            !message ||
            typeof message !== "object" ||
            (message as { type?: unknown }).type !== "call"
          ) {
            const type = (message as { type?: unknown } | null)?.type;
            if (type === "done") {
              const value =
                (message as { value?: unknown }).value === undefined
                  ? null
                  : (message as { value?: unknown }).value;
              try {
                assertJson(value);
                const bytes = Buffer.byteLength(JSON.stringify(value));
                if (bytes > maxResultBytes) {
                  fail(
                    "quota_exceeded",
                    `脚本结果超过上限 ${maxResultBytes} 字节`,
                  );
                  return;
                }
              } catch (error) {
                fail(
                  "invalid_result",
                  describeFailure("invalid_result", error),
                );
                return;
              }
              finish({
                ok: true,
                status: receipts.length ? "local_applied" : "read",
                result: value,
                receipts,
              });
              return;
            }
            if (type === "error") {
              const serialized =
                (message as { error?: Record<string, unknown> }).error ?? {};
              const error = Object.assign(
                new Error(
                  typeof serialized.message === "string"
                    ? serialized.message
                    : "script_error",
                ),
                serialized,
              );
              const errorCode =
                readErrorCode(error) ??
                (error.message === "invalid_result"
                  ? "invalid_result"
                  : "script_error");
              onError?.(error);
              finish({
                ok: false,
                error: {
                  code: errorCode,
                  message: describeFailure(errorCode, error),
                  ...readErrorExtras(error),
                },
                receipts,
              });
            }
            return;
          }

          const call = message as {
            id: number;
            path: string;
            args: unknown[];
          };
          callCount += 1;
          if (callCount > maxCalls) {
            fail("quota_exceeded", `脚本调用超过上限 ${maxCalls}`);
            return;
          }
          const method = methods.get(call.path);
          if (!method) {
            worker?.postMessage({
              type: "error",
              id: call.id,
              error: {
                code: "invalid_operation",
                message: `未知 canvas 方法: ${call.path}`,
              },
            });
            return;
          }
          try {
            const result = await method(...call.args);
            if (isReceipt(result)) {
              receipts.push({ method: call.path, receipt: result });
            }
            try {
              worker?.postMessage({
                type: "result",
                id: call.id,
                value: result,
              });
            } catch {
              worker?.postMessage({
                type: "error",
                id: call.id,
                error: {
                  code: "invalid_result",
                  message: "canvas 返回值不是可克隆的 JSON",
                },
              });
            }
          } catch (error) {
            worker?.postMessage({
              type: "error",
              id: call.id,
              error: serializeError(error),
            });
          }
        });

        worker.on("error", (error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            (error as { code?: unknown }).code === "ERR_WORKER_OUT_OF_MEMORY" ||
            /memory limit/i.test(message)
          ) {
            fail("quota_exceeded", `脚本超出内存上限: ${message}`);
            return;
          }
          fail("script_error", describeFailure("script_error", error));
        });

        worker.on("exit", (code) => {
          if (!settled && code !== 0) {
            fail("script_error", `脚本执行线程退出: ${code}`);
          }
        });
      }),
  };
};

export const workerExecutor: CanvasCodeExecutor = createWorkerExecutor();
