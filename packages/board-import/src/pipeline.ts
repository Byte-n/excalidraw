// 画板导入管线编排：parse → render → materializeAssets → project。
//
// 四级纯函数各自独立可测；importBoard 负责翻页拉满、按 token 解析图片字节
// 与阶段串联。任一阶段抛错即整板失败（调用方负责零残留）。

import { assertBoardSkeleton } from "./skeleton.js";

import { materializeAssets } from "./assets.js";
import { parseBoard as parseFeishuBoard } from "./feishu/parse.js";
import { projectScene } from "./project.js";
import { renderSkeleton } from "./render.js";

import type {
  BoardImageResolver,
  BoardSource,
  LarkBoardNode,
} from "./source.js";
import type { BoardSkeleton } from "./skeleton.js";
import type { ParseResult } from "./feishu/parse.js";
import type { BoardAssetRequest, RenderResult } from "./render.js";
import type { MaterializeResult, ResolvedAssets } from "./assets.js";
import type { ProjectResult } from "./project.js";
import type {
  BoardImportAsset,
  BoardImportPolicy,
  BoardImportResult,
  BoardImportStats,
  ScenePolicy,
} from "./types.js";

// --- 阶段签名 ---

// parse：原始节点 → skeleton IR + parse 级统计。
export type ParseStage = (nodes: LarkBoardNode[]) => ParseResult;

// render：skeleton → 元素 + 资产请求清单。
export type RenderStage = (skeleton: BoardSkeleton) => RenderResult;

// materializeAssets：按请求注入调用方解析好的资产引用；放弃者计入 dropped。
export type MaterializeAssetsStage = <TAsset>(
  elements: RenderResult["elements"],
  requests: readonly BoardAssetRequest[],
  resolved: ResolvedAssets<TAsset>,
  onDropped: (request: BoardAssetRequest) => void,
) => MaterializeResult<TAsset>;

// project：校验 + 统计收敛，产出最终结果。
export type ProjectStage = <TAsset>(
  elements: RenderResult["elements"],
  assets: Record<string, TAsset>,
  stats: BoardImportStats,
  policy: ScenePolicy,
) => ProjectResult<TAsset>;

// --- 便携导出：阶段函数 ---

export { materializeAssets, projectScene, renderSkeleton };
export const parseBoard: ParseStage = (nodes) => parseFeishuBoard(nodes);

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

// 管线入口：翻页拉满 → parse → 校验 skeleton → render → 解析图片 → materialize
// → project。任一阶段抛错即整板失败（调用方负责零残留）。
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

  const { skeleton, droppedNodes, richTextFlattened } = parseBoard(allNodes);
  assertBoardSkeleton(skeleton);

  const {
    elements: rendered,
    assetRequests,
    downgraded: renderDowngraded,
  } = renderSkeleton(skeleton);

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
    mapped: skeleton.nodes.length,
    droppedNodes,
    droppedAssets: dropped,
    // render 的替换/回落 + rich_text 按段落压平，均为一次保真度损失。
    downgraded: renderDowngraded + richTextFlattened,
    elements: elements.length,
    assetRequests: assetRequests.length,
    richTextFlattened,
  };

  enforceLimits(policy, stats);

  return projectScene(elements, assets, stats, scenePolicy);
}
