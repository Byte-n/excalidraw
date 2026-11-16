/** 对外稳定错误码的有序清单，文档与校验共用。 */
export const CANVAS_SDK_ERROR_CODES = [
  "execution_cancelled",
  "session_unavailable",
  "not_editable",
  "invalid_input",
  "invalid_operation",
  "invalid_scene",
  "invalid_asset",
  "scene_limit_exceeded",
  "target_not_found",
  "version_conflict",
  "unsupported_format",
  "internal_error",
] as const;

export type CanvasSdkErrorCode = typeof CANVAS_SDK_ERROR_CODES[number];

const ERROR_CODES: ReadonlySet<string> = new Set(CANVAS_SDK_ERROR_CODES);

/** SDK 对外稳定错误：只暴露错误码、消息与可选细节，不携带底层堆栈。 */
export class CanvasSdkError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly retryable?: boolean;
  readonly hint?: string;

  constructor(
    code: CanvasSdkErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options?: Readonly<{ retryable?: boolean; hint?: string }>,
  ) {
    super(message);
    this.name = "CanvasSdkError";
    this.code = code;
    this.details = details;
    this.retryable = options?.retryable;
    this.hint = options?.hint;
  }
}

/** 把内核的 CanvasSceneError/YjsSceneError 或读取守卫抛出的裸错误收敛为 SDK 错误。 */
export const toCanvasSdkError = (error: unknown): CanvasSdkError => {
  if (error instanceof CanvasSdkError) {
    return error;
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && ERROR_CODES.has(code)) {
      const message =
        error instanceof Error && error.message ? error.message : code;
      return new CanvasSdkError(code as CanvasSdkErrorCode, message);
    }
  }
  if (error instanceof Error && ERROR_CODES.has(error.message)) {
    return new CanvasSdkError(
      error.message as CanvasSdkErrorCode,
      error.message,
    );
  }
  return new CanvasSdkError(
    "internal_error",
    error instanceof Error && error.message ? error.message : "画布操作失败",
  );
};
