// @excalidraw/board-import 入口：飞书画板节点树 → Excalidraw 场景的纯转换。
//
// 公开端口（BoardSource / BoardImageResolver）与 IR 类型给 api 侧装配，
// 管线入口 importBoard 与各阶段函数为纯函数。

export { LARK_KNOWN_NODE_TYPES } from "./source.js";
export type {
  LarkBoardEnvelope,
  LarkBoardNode,
  LarkBoardNodeType,
  LarkBoardPage,
  LarkCompositeShapePayload,
  LarkConnectorCaption,
  LarkConnectorEndpoint,
  LarkConnectorPayload,
  LarkImagePayload,
  LarkLifelinePayload,
  LarkMindMapNodePayload,
  LarkMindMapPayload,
  LarkMindMapRootPayload,
  LarkNodeRichTextElement,
  LarkNodeRichTextParagraph,
  LarkNodeRichTextStyle,
  LarkNodeStyle,
  LarkNodeText,
  LarkPaintLine,
  LarkPaintPayload,
  LarkPoint,
  LarkSectionPayload,
  LarkStickyNotePayload,
  LarkTableCell,
  LarkTableCellStyle,
  LarkTableMeta,
  LarkTablePayload,
  BoardImageResolveResult,
  BoardImageResolver,
  BoardSource,
} from "./source.js";
export {
  BoardSkeletonError,
  assertBoardSkeleton,
  MIN_DIMENSION,
  normalizeDimension,
} from "./skeleton.js";
export type {
  BoardSkeleton,
  BoardSkeletonConnectorCaption,
  BoardSkeletonConnectorEndpoint,
  BoardSkeletonConnectorPayload,
  BoardSkeletonImagePayload,
  BoardSkeletonKind,
  BoardSkeletonMindMapPayload,
  BoardSkeletonNode,
  BoardSkeletonPaintPayload,
  BoardSkeletonSectionPayload,
  BoardSkeletonShapePayload,
  BoardSkeletonStickyNotePayload,
  BoardSkeletonTablePayload,
  BoardSkeletonText,
} from "./skeleton.js";
export type { ParseResult } from "./feishu/parse.js";
export type {
  BoardImportAsset,
  BoardImportElement,
  BoardImportPolicy,
  BoardImportResult,
  BoardImportStats,
  ScenePolicy,
} from "./types.js";
export type { BoardAssetRequest, RenderResult } from "./render.js";
export type { MaterializeResult, ResolvedAssets } from "./assets.js";
export { BoardProjectionError } from "./project.js";
export type { ProjectResult } from "./project.js";
export {
  BoardImportLimitError,
  importBoard,
  materializeAssets,
  parseBoard,
  projectScene,
  renderSkeleton,
} from "./pipeline.js";
export type {
  BoardImportInput,
  MaterializeAssetsStage,
  ParseStage,
  ProjectStage,
  RenderStage,
} from "./pipeline.js";
