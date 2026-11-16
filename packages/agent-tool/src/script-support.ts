import { CanvasSdkError } from "./sdk/errors.js";

export const assertJson = (value: unknown, seen = new Set<object>()): void => {
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

export const isReceipt = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  (Array.isArray(
    (value as { changedElementIds?: unknown }).changedElementIds,
  ) ||
    Array.isArray(
      (value as { affectedElementIds?: unknown }).affectedElementIds,
    ));

export const readErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code ? code : undefined;
};

/** SDK 错误的细节对模型可操作：非法值、是否可重试与修复提示。 */
export const readErrorExtras = (
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

export const describeFailure = (code: string, error: unknown): string => {
  const fallback =
    code === "execution_cancelled"
      ? "脚本执行已取消"
      : code === "execution_timeout"
      ? "脚本执行超时"
      : code === "quota_exceeded"
      ? "脚本超出执行配额"
      : code === "invalid_result"
      ? "脚本返回值不是有效 JSON"
      : "脚本执行失败";
  const detail = error instanceof Error ? error.message.trim() : String(error);
  return detail && detail !== code ? `${fallback}: ${detail}` : fallback;
};
