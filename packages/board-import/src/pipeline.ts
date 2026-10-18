// 画板导入管线编排：convertBoard → materializeAssets → project。
//
// 各阶段为纯函数、各自独立可测；importBoard 负责翻页拉满、按 token 解析图片
// 字节与阶段串联。任一阶段抛错即整板失败（调用方负责零残留）。

import { materializeAssets } from "./assets.js";
import { convertBoard } from "./feishu/convert.js";
import { assertLarkBoard } from "./feishu/validate.js";
import { projectScene } from "./project.js";

import type { MaterializeResult, ResolvedAssets } from "./assets.js";
import type { ProjectResult } from "./project.js";
import type {
  BoardAssetRequest,
  BoardImportAsset,
  BoardImportElement,
  BoardImportPolicy,
  BoardImportResult,
  BoardImportStats,
  ScenePolicy,
} from "./types.js";
import type {
  BoardImageResolver,
  BoardSource,
  LarkBoardNode,
} from "./source.js";

// --- 阶段签名 ---

// materializeAssets：按请求注入调用方解析好的资产引用；放弃者计入 dropped。
export type MaterializeAssetsStage = <TAsset>(
  elements: BoardImportElement[],
  requests: readonly BoardAssetRequest[],
  resolved: ResolvedAssets<TAsset>,
  onDropped: (request: BoardAssetRequest) => void,
) => MaterializeResult<TAsset>;

// project：校验 + 统计收敛，产出最终结果。
export type ProjectStage = <TAsset>(
  elements: BoardImportElement[],
  assets: Record<string, TAsset>,
  stats: BoardImportStats,
  policy: ScenePolicy,
) => ProjectResult<TAsset>;

// --- 便携导出：阶段函数 ---

export { materializeAssets, projectScene };

export interface BoardImportInput {
  whiteboardId: string;
  source: BoardSource;
  images: BoardImageResolver;
  /** 场景门槛策略由调用方提供；包内不硬编码平台策略。 */
  scenePolicy: ScenePolicy;
  /** 导入量级门槛（节点 / 元素 / 资产上限），缺省不限制。 */
  policy?: BoardImportPolicy;
}

// 导入量级超限。
export class BoardImportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardImportLimitError";
  }
}

function enforceLimits(
  policy: BoardImportPolicy | undefined,
  stats: BoardImportStats,
): void {
  if (!policy) {
    return;
  }
  if (policy.maxNodes !== undefined && stats.nodes > policy.maxNodes) {
    throw new BoardImportLimitError(
      `画板节点数 ${stats.nodes} 超过上限 ${policy.maxNodes}`,
    );
  }
  if (policy.maxElements !== undefined && stats.elements > policy.maxElements) {
    throw new BoardImportLimitError(
      `画板元素数 ${stats.elements} 超过上限 ${policy.maxElements}`,
    );
  }
  if (
    policy.maxAssets !== undefined &&
    stats.assetRequests > policy.maxAssets
  ) {
    throw new BoardImportLimitError(
      `画板资产数 ${stats.assetRequests} 超过上限 ${policy.maxAssets}`,
    );
  }
}

// 管线入口：翻页拉满 → convertBoard → 整板闸门 → 解析图片 → materialize →
// project。任一阶段抛错即整板失败（调用方负责零残留）。
export async function importBoard(
  input: BoardImportInput,
): Promise<BoardImportResult> {
  const { whiteboardId, source, images, scenePolicy, policy } = input;

  const allNodes: LarkBoardNode[] = [];
  let pageToken: string | undefined;
  // 防御性上限，避免分页接口异常时无限循环。
  const maxPages = 1000;
  for (let i = 0; i < maxPages; i++) {
    const page = await source.fetch(whiteboardId, pageToken);
    allNodes.push(...page.nodes);
    pageToken = page.nextPageToken;
    if (pageToken === undefined) {
      break;
    }
  }

  const {
    elements: rendered,
    assetRequests,
    downgraded: convertDowngraded,
    mapped,
    droppedNodes,
    richTextFlattened,
  } = convertBoard(allNodes);

  assertLarkBoard(allNodes);

  // 同一 token 只解析一次字节，避免重复 IO。
  const resolved = new Map<string, BoardImportAsset>();
  for (const request of assetRequests) {
    if (resolved.has(request.token)) {
      continue;
    }
    const result = await images.resolve(request.token);
    if (result.status === "ok") {
      resolved.set(request.token, {
        token: request.token,
        bytes: result.bytes,
        mimeType: result.mimeType,
      });
    }
  }

  const { elements, assets, dropped } = materializeAssets(
    rendered,
    assetRequests,
    resolved,
    () => {},
  );

  const stats: BoardImportStats = {
    nodes: allNodes.length,
    mapped,
    droppedNodes,
    droppedAssets: dropped,
    // 转换层回落 + rich_text 按段落压平，均为一次保真度损失。
    downgraded: convertDowngraded + richTextFlattened,
    elements: elements.length,
    assetRequests: assetRequests.length,
    richTextFlattened,
  };

  enforceLimits(policy, stats);

  return projectScene(elements, assets, stats, scenePolicy);
}
