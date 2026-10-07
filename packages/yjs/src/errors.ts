export type YjsSceneErrorCode =
  | "invalid_input"
  | "target_not_found"
  | "version_conflict"
  | "invalid_operation"
  | "invalid_scene"
  | "invalid_asset"
  | "scene_limit_exceeded"
  | "not_editable"
  | "session_unavailable"
  | "internal_error";

/** yjs 对外稳定错误；不携带底层异常或堆栈。 */
export class YjsSceneError extends Error {
  readonly code: YjsSceneErrorCode;

  constructor(code: YjsSceneErrorCode, message: string) {
    super(message);
    this.name = "YjsSceneError";
    this.code = code;
  }
}
