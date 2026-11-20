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

/** 场景容量计量项；与宿主门槛字段一一对应。 */
export type SceneCapacityMetric =
  | "elements"
  | "assets"
  | "elementBytes"
  | "sceneBytes"
  | "textChars"
  | "contentUnits"
  | "tableRows"
  | "tableColumns"
  | "tableCells"
  | "assetBytes";

/** 容量拒绝的结构化字段；宿主据此映射错误码与用户文案。 */
export type SceneCapacityLimit = Readonly<{
  metric: SceneCapacityMetric;
  actual: number;
  allowed: number;
}>;

/** yjs 对外稳定错误；不携带底层异常或堆栈。 */
export class YjsSceneError extends Error {
  readonly code: YjsSceneErrorCode;
  /** 仅容量拒绝携带；结构与输入非法时缺省。 */
  readonly capacity?: SceneCapacityLimit;

  constructor(
    code: YjsSceneErrorCode,
    message: string,
    capacity?: SceneCapacityLimit,
  ) {
    super(message);
    this.name = "YjsSceneError";
    this.code = code;
    this.capacity = capacity;
  }
}
