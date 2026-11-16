import { getLineHeight } from "@excalidraw/common";
import {
  generateKeyBetween,
  generateNKeysBetween,
} from "@excalidraw/fractional-indexing";

import {
  applyMindmapBranchTheme,
  applyMindmapTreeCommand,
  buildMindmapGraphIndex,
  getMindmapSubtreeIds,
  getMindmapNodeTextStyle,
  getMindmapLayoutConfig,
  getMindmapEdgeGeometry,
  isMindmapLayoutFrozen,
  layoutMindmap,
  reparentMindmapNode,
  repairMindmapElements,
} from "./mindmap";
import { newMindmapNodeElement } from "./newElement";
import { isMindmapNodeElement, isMindmapEdgeElement } from "./typeChecks";
import { normalizeText } from "./textMeasurements";
import { getTextLayoutUpdates } from "./text/applyLayout";
import { withTextBlock } from "./text/ops";
import {
  CanvasSceneError,
  finishSceneOperation,
  createCalculationScene,
  deleteSceneElements,
} from "./sceneOperations";

import type { ElementUpdate } from "./mutateElement";
import type {
  CanvasElementOperationReferences,
  CanvasElementOperationResult,
  ScenePoint,
} from "./sceneOperations";
import type { MindmapGraphIndex } from "./mindmap";
import type { Scene } from "./Scene";
import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  FontFamilyValues,
  FractionalIndex,
  MindmapLayoutDirection,
} from "./types";

export type MindmapNodeTarget = Readonly<{ graphId: string; nodeId: string }>;

/**
 * 一棵纯文字的树：「从文本树建整图」的输入（`buildMindmapGraphFromTree`）。
 * 与 excalidraw 包的 `MindmapTextNode`（Markdown/Outline/OPML 导入）结构一致，
 * 但这里不依赖那个包，任何层级的调用方都能用。
 */
export type MindmapTreeSpec = {
  text: string;
  children: readonly MindmapTreeSpec[];
};

export type MindmapOperation =
  | Readonly<{
      action: "createRoot";
      position: ScenePoint;
      text: string;
      direction?: MindmapLayoutDirection;
    }>
  | Readonly<{
      action: "addChild" | "addSibling" | "rename";
      target: MindmapNodeTarget;
      text: string;
    }>
  | Readonly<{
      action: "move";
      target: MindmapNodeTarget;
      position: ScenePoint;
    }>
  | Readonly<{
      action: "reparent";
      target: MindmapNodeTarget;
      parentNodeId: string;
      beforeNodeId?: string;
    }>
  | Readonly<{ action: "deleteSubtree"; target: MindmapNodeTarget }>;
export type MindmapOperationReferences = Extract<
  CanvasElementOperationReferences,
  { domain: "mindmap" }
>;

// 浏览器交互与无 DOM 场景命令共用文字、派生边和布局计算。
// pinnedNodeIds：瞬态锚定（如 resize 手势进行中），这些节点保持当前
// 位置，布局只让兄弟/子孙围绕它们重排——与持久化的 layoutFrozen 同机制。
export const layoutMindmapScene = (
  elements: readonly ExcalidrawElement[],
  graphIds: readonly string[],
  pinnedNodeIds?: ReadonlySet<string>,
): readonly ExcalidrawElement[] => {
  const selected = new Set(graphIds);
  const affected = elements.filter(
    (element) =>
      (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
      selected.has(element.graphId),
  );
  const repairedGraph = repairMindmapElements(affected);
  const replacements = new Map(
    repairedGraph.map((element) => [element.id, element]),
  );
  const existingIds = new Set(elements.map((element) => element.id));
  const repaired = [
    ...elements.map((element) => replacements.get(element.id) ?? element),
    ...repairedGraph.filter((element) => !existingIds.has(element.id)),
  ];
  const updated = new Map(repaired.map((element) => [element.id, element]));
  for (const graphId of graphIds) {
    const graph = repaired.filter(
      (element) =>
        !element.isDeleted &&
        (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
        element.graphId === graphId,
    );
    if (!graph.some(isMindmapNodeElement)) {
      continue;
    }
    // 正文尺寸变化后再次布局，保证兄弟间距与边端点采用最终几何。
    for (let pass = 0; pass < 2; pass++) {
      const currentGraph = [...updated.values()].filter(
        (element) =>
          !element.isDeleted &&
          (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
          element.graphId === graphId,
      );
      const layout = layoutMindmap(
        buildMindmapGraphIndex(currentGraph, graphId),
        {},
        pinnedNodeIds,
      );
      for (const element of [...layout.elements, ...layout.edges]) {
        updated.set(element.id, element);
      }
      let resized = false;
      for (const node of layout.elements) {
        // 冻结节点保持现有几何，live resize 期间被 pin 的节点尺寸由手势
        // 决定，二者都不能被正文重测改写。
        if (isMindmapLayoutFrozen(node) || pinnedNodeIds?.has(node.id)) {
          continue;
        }
        const updates = getTextLayoutUpdates(node);
        if (!updates) {
          continue;
        }
        resized ||=
          (updates.width ?? node.width) !== node.width ||
          (updates.height ?? node.height) !== node.height;
        updated.set(node.id, { ...node, ...updates });
      }
      if (!resized) {
        break;
      }
    }
  }
  return repaired.map((element) => updated.get(element.id) ?? element);
};

/**
 * 按正文与结构重排整张图并写回场景：文本编辑、样式变更等交互路径唯一
 * 的图级重布局入口。有差异的元素逐个走 `mutateElement`，版本因此正常递增。
 */
export const relayoutMindmapScene = (scene: Scene, graphId: string): void => {
  const relaid = layoutMindmapScene(scene.getElementsIncludingDeleted(), [
    graphId,
  ]);
  const existing = scene.getElementsMapIncludingDeleted();
  for (const next of relaid) {
    const previous = existing.get(next.id);
    if (!previous || previous === next) {
      continue;
    }
    const updates: Record<string, unknown> = {};
    for (const key of Object.keys(next) as (keyof ExcalidrawElement)[]) {
      if (key === "version" || key === "versionNonce" || key === "updated") {
        continue;
      }
      if (next[key] !== previous[key]) {
        updates[key] = next[key];
      }
    }
    scene.mutateElement(previous, updates as ElementUpdate<typeof previous>);
  }
};

/**
 * 从一棵文本树直接建出整张、已布局的脑图（节点 + 正文 + 连线），
 * 不接触 App/scene/store —— 调用方拿到元素后自行落地。文字树的导入
 * （excalidraw 包的 `importTextTree`）与创建工具的预设预览共用它，导入结果
 * 与预设所见因此同源。
 *
 * `position` 是**根节点的左上角**（与 `createRoot` 的语义一致），其余节点
 * 先与根同点、再由 `layoutMindmapScene` 排出层级位置。
 */
export const buildMindmapGraphFromTree = (
  tree: MindmapTreeSpec,
  position: ScenePoint,
  font: { fontFamily?: FontFamilyValues; fontSize?: number } = {},
  /**
   * 每个节点的显式身份。缺省（导入路径）由构造函数生成 id/seed；
   * **离屏预览必须传**——预览元素不入场景，却会消耗共享的 id 计数器与随机
   * 序列，把同一会话里后续元素的 id/seed 全部推后一位。
   */
  identity: (index: number) => { id?: string; seed?: number } = () => ({}),
  /**
   * 根节点的生长方向。必须**在建根时就写死**（`newMindmapNodeElement` 只在
   * role === "root" 时落该字段），因为随后的 `layoutMindmapScene` 直接按它
   * 排布整张图——布局之后再改方向不会重排。缺省 `undefined` 走元素默认
   * （`left-to-right`），导入路径行为不变。
   */
  layoutDirection?: MindmapLayoutDirection,
): {
  elements: readonly ExcalidrawElement[];
  rootId: string;
  graphId: string;
} => {
  validatePoint(position);
  const root = newMindmapNodeElement({
    ...position,
    graphId: "",
    role: "root",
    parentId: null,
    order: null,
    ...(layoutDirection === undefined ? {} : { layoutDirection }),
    ...identity(0),
  });
  const graphId = `mindmap:${root.id}`;

  let elements: readonly ExcalidrawElement[] = [];
  let created = 1;
  const add = (item: MindmapTreeSpec, node: ExcalidrawMindmapNodeElement) => {
    elements = appendNode(elements, node, item.text, font);
    const orders = generateNKeysBetween(null, null, item.children.length);
    item.children.forEach((child, index) => {
      add(
        child,
        newMindmapNodeElement({
          x: node.x,
          y: node.y,
          graphId,
          role: "node",
          parentId: node.id,
          order: orders[index] as FractionalIndex,
          ...identity(created++),
        }),
      );
    });
  };
  add(tree, { ...root, graphId });

  const nodeIds = elements
    .filter(isMindmapNodeElement)
    .map((element) => element.id);
  // 布局会补建缺失的入边，主题因此在布局后再派发一次（幂等）
  const laidOut = layoutMindmapScene(
    applyMindmapBranchTheme(elements, graphId, nodeIds),
    [graphId],
  );
  return {
    elements: applyMindmapBranchTheme(laidOut, graphId, nodeIds),
    rootId: root.id,
    graphId,
  };
};

const validatePoint = (point: ScenePoint) => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new CanvasSceneError("invalid_input", "脑图位置必须是有限坐标");
  }
};

const appendNode = (
  elements: readonly ExcalidrawElement[],
  node: ExcalidrawMindmapNodeElement,
  value: string,
  font: { fontFamily?: FontFamilyValues; fontSize?: number } = {},
) => {
  const text = normalizeText(value);
  return [...elements, withNodeBody(node, text, font)];
};

/** 把正文挂到节点自身：空文本不落 texts 键。 */
const withNodeBody = (
  node: ExcalidrawMindmapNodeElement,
  text: string,
  font: { fontFamily?: FontFamilyValues; fontSize?: number } = {},
): ExcalidrawMindmapNodeElement => {
  const style = getMindmapNodeTextStyle(node);
  const fontFamily = font.fontFamily ?? style.fontFamily;
  return {
    ...node,
    texts: withTextBlock(node.texts, "body", {
      text,
      style: {
        ...style,
        fontFamily,
        ...(font.fontSize === undefined ? {} : { fontSize: font.fontSize }),
        ...(font.fontFamily === undefined
          ? {}
          : { lineHeight: getLineHeight(fontFamily) }),
      },
    }),
  };
};

export const applyMindmapOperation = (
  input: readonly ExcalidrawElement[],
  operation: MindmapOperation,
): CanvasElementOperationResult => {
  if ("text" in operation && typeof operation.text !== "string") {
    throw new CanvasSceneError("invalid_input", "脑图文字必须是字符串");
  }
  if ("position" in operation) {
    validatePoint(operation.position);
  }
  if (operation.action === "createRoot") {
    const root = newMindmapNodeElement({
      ...operation.position,
      graphId: "",
      role: "root",
      parentId: null,
      order: null,
      ...(operation.direction === undefined
        ? {}
        : { layoutDirection: operation.direction }),
    });
    const graphId = `mindmap:${root.id}`;
    // 新建无基线，直接派生根节点主题
    const themed = applyMindmapBranchTheme(
      appendNode(input, { ...root, graphId }, operation.text),
      graphId,
      [root.id],
    );
    const elements = layoutMindmapScene(themed, [graphId]);
    return finishSceneOperation(input, elements, {
      domain: "mindmap",
      action: operation.action,
      graphId,
      nodeId: root.id,
      rootNodeId: root.id,
    });
  }
  const node = input.find(
    (element): element is ExcalidrawMindmapNodeElement =>
      element.id === operation.target.nodeId &&
      !element.isDeleted &&
      isMindmapNodeElement(element) &&
      element.graphId === operation.target.graphId,
  );
  if (!node) {
    throw new CanvasSceneError("target_not_found", "脑图节点不存在");
  }
  const index = buildMindmapGraphIndex(input, node.graphId);
  let elements = input;
  let nodeId = node.id;
  let rootNodeId: string | null = index.rootId;
  let needsLayout = true;
  /** 结构命令直接触及、需要派生分支主题的子树节点（新建节点无基线） */
  let themedNodeIds: readonly string[] | null = null;
  let themeBefore:
    | {
        index: MindmapGraphIndex;
        elements: ReadonlyMap<string, ExcalidrawElement>;
      }
    | undefined;
  switch (operation.action) {
    case "addChild":
    case "addSibling": {
      const parentId =
        operation.action === "addChild" ? node.id : node.parentId;
      if (!parentId) {
        throw new CanvasSceneError("invalid_operation", "根节点没有兄弟节点");
      }
      const siblings = index.childrenById.get(parentId) ?? [];
      const position =
        operation.action === "addChild"
          ? siblings.length
          : siblings.indexOf(node.id) + 1;
      const order = generateKeyBetween(
        position > 0 ? index.nodes.get(siblings[position - 1])!.order : null,
        position < siblings.length
          ? index.nodes.get(siblings[position])!.order
          : null,
      );
      const created = newMindmapNodeElement({
        x: node.x + node.width + 80,
        y: node.y,
        graphId: node.graphId,
        role: "node",
        parentId,
        order: order as FractionalIndex,
        shape: index.nodes.get(index.rootId)?.defaultNodeShape ?? "rectangle",
      });
      elements = appendNode(input, created, operation.text);
      nodeId = created.id;
      themedNodeIds = [created.id];
      break;
    }
    case "rename": {
      const value = normalizeText(operation.text);
      const body = node.texts?.body;
      if ((body?.text ?? "") === value) {
        break;
      }
      const texts = withTextBlock(node.texts, "body", {
        text: value,
        style: body?.style ?? getMindmapNodeTextStyle(node),
      });
      elements = input.map((element) =>
        element.id === node.id ? { ...node, texts } : element,
      );
      break;
    }
    case "reparent": {
      const parent = index.nodes.get(operation.parentNodeId);
      const subtree = new Set(getMindmapSubtreeIds(index, node.id));
      if (
        node.role === "root" ||
        !parent ||
        subtree.has(parent.id) ||
        (operation.beforeNodeId !== undefined &&
          (index.nodes.get(operation.beforeNodeId)?.parentId !== parent.id ||
            subtree.has(operation.beforeNodeId)))
      ) {
        throw new CanvasSceneError(
          "invalid_operation",
          "脑图换父关系或插入位置无效",
        );
      }
      const updates = new Map(
        reparentMindmapNode(
          index,
          node.id,
          parent.id,
          operation.beforeNodeId ?? null,
        ).map((item) => [item.id, item]),
      );
      if (parent.collapsed) {
        updates.set(parent.id, { ...parent, collapsed: false });
      }
      elements = input.map((element) => updates.get(element.id) ?? element);
      // 纯重排（父节点不变）不动样式；重挂/落位才触及被移动子树
      if (node.parentId !== parent.id) {
        themedNodeIds = getMindmapSubtreeIds(index, node.id);
        themeBefore = {
          index,
          elements: new Map(input.map((element) => [element.id, element])),
        };
      }
      break;
    }
    case "move": {
      const subtree = new Set(getMindmapSubtreeIds(index, node.id));
      const dx = operation.position.x - node.x;
      const dy = operation.position.y - node.y;
      elements = input.map((element) =>
        !element.isDeleted && subtree.has(element.id)
          ? { ...element, x: element.x + dx, y: element.y + dy }
          : element,
      );
      const moved = buildMindmapGraphIndex(elements, node.graphId);
      const direction = getMindmapLayoutConfig(
        moved.nodes.get(moved.rootId),
      ).direction;
      elements = elements.map((element) => {
        if (
          !element.isDeleted &&
          isMindmapEdgeElement(element) &&
          element.graphId === node.graphId &&
          (subtree.has(element.childId) || subtree.has(element.parentId))
        ) {
          return {
            ...element,
            ...getMindmapEdgeGeometry(
              moved.nodes.get(element.parentId)!,
              moved.nodes.get(element.childId)!,
              element.routing,
              direction,
            ),
          };
        }
        return element;
      });
      needsLayout = false;
      break;
    }
    case "deleteSubtree": {
      const graph = input.filter(
        (element) =>
          (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
          element.graphId === node.graphId,
      );
      const result = applyMindmapTreeCommand(graph, node.id, {
        type: "delete",
      });
      if (!result) {
        throw new CanvasSceneError("invalid_operation", "脑图删除失败");
      }
      const deletedIds = new Set(
        result.elements
          .filter(
            (element) =>
              element.isDeleted &&
              !graph.find((old) => old.id === element.id)?.isDeleted,
          )
          .map((element) => element.id),
      );
      const scene = createCalculationScene(input);
      try {
        // 共享删除边界清理反向关系，墓碑保留全部历史元素。
        deleteSceneElements(deletedIds, scene);
        elements = scene.getElementsIncludingDeleted();
      } finally {
        scene.destroy();
      }
      if (node.role === "root") {
        rootNodeId = null;
        needsLayout = false;
      }
      break;
    }
  }
  if (themedNodeIds) {
    // 先修复（补/正入边）再派生，保证索引可建、入边随子树一并着色；
    // 随后的重布局/测量自然使用最终字号
    elements = applyMindmapBranchTheme(
      repairMindmapElements(elements),
      node.graphId,
      themedNodeIds,
      themeBefore,
    );
  }
  if (needsLayout) {
    elements = layoutMindmapScene(elements, [node.graphId]);
  }
  return finishSceneOperation(input, elements, {
    domain: "mindmap",
    action: operation.action,
    graphId: node.graphId,
    nodeId,
    rootNodeId,
  });
};
