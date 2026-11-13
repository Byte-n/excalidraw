import { clamp } from "@excalidraw/math";

import type { AppState } from "@excalidraw/excalidraw/types";

import type {
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawLinearElement,
} from "./types";

/**
 * gaps exclude element strokeWidth
 *
 * IMPORTANT: currently must be > 0 (this also applies to the computed gap)
 */
export const BASE_BINDING_GAP = 5;
export const BASE_BINDING_GAP_ELBOW = 5;

export const getBindingGap = (
  // only the stroke width is needed, so the gap can also be computed for a
  // bind target that doesn't exist yet (see `getTextBindingForArrowEndpoint`)
  bindTarget: Pick<ExcalidrawBindableElement, "strokeWidth">,
  opts: Pick<ExcalidrawArrowElement, "elbowed"> | ExcalidrawLinearElement,
): number => {
  return (
    ("elbowed" in opts && opts.elbowed
      ? BASE_BINDING_GAP_ELBOW
      : BASE_BINDING_GAP) +
    bindTarget.strokeWidth / 2
  );
};

/**
 * 投影到绑定目标轮廓上时用的 gap。与 `getBindingGap` 的唯一区别：**文本作为绑定
 * 目标时不加 gap**，端点落在文本的绑定边上。
 *
 * 硬性理由：`attachPoint` 是归一化比例，而 gap 是固定像素。把 gap 烘进比例需要知道
 * 文本高度，而文本随输入增长时包围盒会变 —— 绑定边被钉住、比例不变，端点于是会漂
 * （每增长一行漂一个 gap）。文本工具那条入口一直如此（`getTextBindingForArrowEndpoint`
 * 直接把端点当锚点）；通用投影这一处曾漏掉，于是「拖端点上去」与
 * `convertToExcalidrawElements` 两条入口都多出一个 gap。折线档（
 * `bindPointToSnapToElementOutline` 的主/兜底求交、`avoidRectangularCorner`）也曾
 * 漏掉，同样是这一处补上的。
 *
 * 「文本不留 gap」这条判据只在这里一份：**决定端点落点**的投影一律走本函数（通用
 * 投影 `projectFocusPointOntoInflatedOutline`、`projectPointOntoBoundElementOutline`
 * 函数内的三处求交/外移 + 折线档那三处）。`getBindingGap` 仍然留在下面这些地方 ——
 * 它们**不是**「不影响落点」才不用本函数，而是本波显式保持不动：改这些的 gap 口径会
 * 牵动**非文本**的既有行为，或只是延续上游的常量口径：
 * - 吸附阈值：`hitElementItself` 的命中判定、`pointerSession` 与 `elbowArrow` 的悬停
 *   容差；
 * - 落点载体（非文本）：`snapToMid` 的返回值本身就是射线方向上的落点（gap 直接进
 *   坐标），「离中心太近就放弃吸附」只是它的另一半用途 —— 实测同一点只切
 *   `isMidpointSnappingEnabled`，24 个场景里 15 个落点不同；把它的 gap 换成投影 gap
 *   则有 6 条文本场景落点变化，最大约 60px。`snapBoundPointToGrid` 的网格吸附同样
 *   决定落点（网格档 27 条文本场景里 10 条会变，最大
 *   `[160.012,125] → [220,103.125]`；矩形档 0 条）；
 * - 除数下限：`calculateAttachPointFor*Binding` 的 `sizeFloor`（防小目标把比例炸掉，
 *   上面另有 `MIN_BINDABLE_SIZE` 兜着）；
 * - `reanchorBindingsToOutline`：721 行是**投影**（gap 传进
 *   `intersectElementWithLineSegment`，结果写成 `attachPoint`），710-715 行才是副
 *   作用判定（开路径的「是否已贴住」检查）。两处都到不了文本 —— 该函数唯一调用方
 *   `ConvertElementTypePopup.tsx`（556 行）只对 generic 转换后的元素调用，而
 *   `getGenericType` 只认 `composite` 与 `mindmap-node`（文本返回 null），
 *   所以文本不留 gap 的判据不受这两处影响。
 */
export const getProjectionBindingGap = (
  bindTarget: Pick<ExcalidrawBindableElement, "type" | "strokeWidth">,
  opts: Pick<ExcalidrawArrowElement, "elbowed"> | ExcalidrawLinearElement,
  /**
   * 覆盖基准 gap（同样不含 strokeWidth 补偿）。折线档兜底那一趟历来用常量
   * `BASE_BINDING_GAP_ELBOW` 而非 `getBindingGap` 作基准，那一处沿用它的数值 ——
   * 免得「接上文本判据」顺带挪动非文本的既有落点。
   */
  baseGap?: number,
): number =>
  bindTarget.type === "text" ? 0 : baseGap ?? getBindingGap(bindTarget, opts);

export const maxBindingDistance_simple = (zoom?: AppState["zoom"]): number => {
  const BASE_BINDING_DISTANCE = Math.max(BASE_BINDING_GAP, 15);
  const zoomValue = zoom?.value && zoom.value < 1 ? zoom.value : 1;
  return clamp(
    // reducing zoom impact so that the diff between binding distance and
    // binding gap is kept to minimum when possible
    BASE_BINDING_DISTANCE / (zoomValue * 1.5),
    BASE_BINDING_DISTANCE,
    BASE_BINDING_DISTANCE * 2,
  );
};
