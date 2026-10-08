import type { CanvasCodeExecutor } from "./port.js";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  argument: string,
  body: string,
) => (collaboration: unknown) => Promise<unknown>;

const assertJson = (value: unknown, seen = new Set<object>()): void => {
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
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new Error("invalid_result");
  }
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
    throw new Error("invalid_result");
  }
  seen.add(value);
  const keys = Array.isArray(value)
    ? Array.from({ length: value.length }, (_, index) => String(index))
    : Object.keys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new Error("invalid_result");
    }
    assertJson(descriptor.value, seen);
  }
  seen.delete(value);
};

/** 未配置执行器时直接调用宿主异步函数；signal 仅支持合作取消。 */
export const directExecutor: CanvasCodeExecutor = {
  execute: async ({ code, collaboration, signal, onError }) => {
    const receipts: unknown[] = [];
    const pending: Promise<unknown>[] = [];
    const reported = new Set<unknown>();
    const report = (error: unknown) => {
      if (!reported.has(error)) {
        reported.add(error);
        onError?.(error);
      }
    };
    let accepting = true;
    const facade = Object.freeze(
      Object.fromEntries(
        Object.entries(collaboration).map(([method, invoke]) => [
          method,
          (...args: unknown[]) => {
            const call = (async () => {
              if (!accepting || signal?.aborted) {
                throw new Error("execution_cancelled");
              }
              const value = await Reflect.apply(invoke, collaboration, args);
              if (method === "mutate" || method === "execute") {
                receipts.push({ method, receipt: value });
              }
              return value;
            })();
            // 立即接管拒绝，脚本即使不 await 也不会产生未处理异常。
            void call.catch((error: unknown) => {
              report(error);
            });
            pending.push(call);
            return call;
          },
        ]),
      ),
    );
    const drain = async () => {
      accepting = false;
      return await Promise.allSettled(pending);
    };
    try {
      if (signal?.aborted) {
        throw new Error("execution_cancelled");
      }
      const value = await new AsyncFunction(
        "collaboration",
        `"use strict";\n${code}`,
      )(facade);
      const settled = await drain();
      if (signal?.aborted) {
        throw new Error("execution_cancelled");
      }
      if (settled.some((item) => item.status === "rejected")) {
        const rejected = settled.find((item) => item.status === "rejected");
        if (rejected?.status === "rejected") {
          throw rejected.reason;
        }
      }
      const result = value === undefined ? null : value;
      assertJson(result);
      return {
        ok: true,
        status: receipts.length ? "local_applied" : "read",
        result,
        receipts,
      };
    } catch (error) {
      await drain();
      report(error);
      const errorCode = signal?.aborted
        ? "execution_cancelled"
        : error instanceof Error && error.message === "invalid_result"
        ? "invalid_result"
        : "script_error";
      return {
        ok: false,
        error: {
          code: errorCode,
          message:
            errorCode === "execution_cancelled"
              ? "脚本执行已取消"
              : errorCode === "invalid_result"
              ? "脚本返回值不是有效 JSON"
              : "脚本执行失败",
        },
        receipts,
      };
    }
  },
};
