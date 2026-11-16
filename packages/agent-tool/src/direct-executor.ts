import { CanvasSdkError } from "./sdk/errors.js";

import type { CanvasCodeExecutor } from "./port.js";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  argument: string,
  body: string,
) => (canvas: unknown) => Promise<unknown>;

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

const isReceipt = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  (Array.isArray(
    (value as { changedElementIds?: unknown }).changedElementIds,
  ) ||
    Array.isArray(
      (value as { affectedElementIds?: unknown }).affectedElementIds,
    ));

const readErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code ? code : undefined;
};

/** SDK 错误的细节对模型可操作：非法值、是否可重试与修复提示。 */
const readErrorExtras = (
  error: unknown,
): { details?: unknown; retryable?: boolean; hint?: string } => {
  if (!(error instanceof CanvasSdkError) && !readErrorCode(error)) {
    return {};
  }
  const source = error as {
    details?: unknown;
    retryable?: unknown;
    hint?: unknown;
  };
  return {
    ...(source.details !== undefined ? { details: source.details } : {}),
    ...(typeof source.retryable === "boolean"
      ? { retryable: source.retryable }
      : {}),
    ...(typeof source.hint === "string" ? { hint: source.hint } : {}),
  };
};

/** 未配置执行器时直接调用宿主 SDK；signal 仅支持合作取消。 */
export const directExecutor: CanvasCodeExecutor = {
  execute: async ({ code, canvas, signal, onError }) => {
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
    const wrapValue = (
      value: unknown,
      path: readonly string[],
      depth: number,
    ): unknown => {
      if (depth > 2 || !value || typeof value !== "object") {
        return value;
      }
      const entries = Object.entries(value).map(
        ([key, entry]): [string, unknown] => {
          const methodPath = [...path, key];
          if (typeof entry === "function") {
            return [
              key,
              (...args: unknown[]) => {
                const call = (async () => {
                  if (!accepting || signal?.aborted) {
                    throw new CanvasSdkError(
                      "execution_cancelled",
                      "脚本执行已取消",
                    );
                  }
                  const result = await Reflect.apply(entry, value, args);
                  if (isReceipt(result)) {
                    receipts.push({
                      method: methodPath.join("."),
                      receipt: result,
                    });
                  }
                  return result;
                })();
                // 立即接管拒绝，脚本即使不 await 也不会产生未处理异常。
                void call.catch((error: unknown) => {
                  report(error);
                });
                pending.push(call);
                return call;
              },
            ];
          }
          if (entry && typeof entry === "object") {
            return [key, wrapValue(entry, methodPath, depth + 1)];
          }
          return [key, entry];
        },
      );
      return Object.freeze(Object.fromEntries(entries));
    };
    const facade = wrapValue(canvas, [], 0);
    const drain = async () => {
      accepting = false;
      return await Promise.allSettled(pending);
    };
    try {
      if (signal?.aborted) {
        throw new CanvasSdkError("execution_cancelled", "脚本执行已取消");
      }
      const value = await new AsyncFunction("canvas", `"use strict";\n${code}`)(
        facade,
      );
      const settled = await drain();
      if (signal?.aborted) {
        throw new CanvasSdkError("execution_cancelled", "脚本执行已取消");
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
        : readErrorCode(error) ?? "script_error";
      return {
        ok: false,
        error: {
          code: errorCode,
          message: describeFailure(errorCode, error),
          ...readErrorExtras(error),
        },
        receipts,
      };
    }
  },
};

function describeFailure(code: string, error: unknown): string {
  const fallback =
    code === "execution_cancelled"
      ? "脚本执行已取消"
      : code === "invalid_result"
      ? "脚本返回值不是有效 JSON"
      : "脚本执行失败";
  const detail = error instanceof Error ? error.message.trim() : String(error);
  return detail && detail !== code ? `${fallback}: ${detail}` : fallback;
}
