import { arrayToMap, getUpdatedTimestamp, randomId } from "@excalidraw/common";

import {
  bumpVersion,
  deepCopyElement,
  fixDuplicatedBindingsAfterDuplication,
  getNewGroupIdsForDuplication,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  isTableElement,
  parseTextRegionKey,
  regenerateTableIds,
  remapTableTexts,
  syncInvalidIndices,
  textRegionKey,
  withTextBlock,
} from "@excalidraw/element";

import type {
  TextBlockMap,
  TextRegionKey,
} from "@excalidraw/element/text/types";
import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

export type RegeneratedImportIdentities = {
  elements: readonly ExcalidrawElement[];
  /** 旧元素 id → 新元素 id，仅含本次导入元素 */
  elementIdMap: ReadonlyMap<string, string>;
};

/**
 * 表格文本区域的身份重写：单元格 key 复用复制语义（只保留落到新表的可见格），
 * 行 key 随行 id 重建，`body`/`title`/`label` 等非结构 key 原样保留。
 */
const remapTableTextsForImport = (
  texts: TextBlockMap | undefined,
  cellIdMap: ReadonlyMap<string, string>,
  rowIdMap: ReadonlyMap<string, string>,
): TextBlockMap | undefined => {
  if (!texts) {
    return undefined;
  }
  let next = remapTableTexts(texts, cellIdMap);
  for (const key of Object.keys(texts) as TextRegionKey[]) {
    const block = texts[key];
    const parsed = parseTextRegionKey(key);
    if (!block || !parsed || parsed.kind === "cell") {
      continue;
    }
    if (parsed.kind === "row") {
      const nextRowId = rowIdMap.get(parsed.rowId);
      if (nextRowId) {
        next = withTextBlock(next, textRegionKey.row(nextRowId), block);
      }
      continue;
    }
    next = withTextBlock(next, key, block);
  }
  return next;
};

/**
 * 为一批导入元素重建身份：元素、分组、表格结构 id 全新，所有内部引用按新 id
 * 重写，`index`/`version`/`versionNonce` 重新生成。位置、样式、用户文本、
 * `customData`、墓碑与 `fileId` 保持不变。
 *
 * `targetElements` 只用于判断无新 id 可指向的引用目标是否已存在于目标场景，
 * 不参与 id 分配。
 */
export const regenerateImportIdentities = (
  elements: readonly ExcalidrawElement[],
  targetElements: readonly ExcalidrawElement[],
): RegeneratedImportIdentities => {
  const elementIdMap = new Map(
    elements.map((element) => [element.id, randomId()]),
  );
  const groupIdMap = new Map<string, string>();

  const copies = elements.map((element) => {
    const copy = deepCopyElement(element);
    copy.id = elementIdMap.get(element.id)!;
    copy.groupIds = getNewGroupIdsForDuplication(
      copy.groupIds,
      null,
      (groupId) => {
        let nextGroupId = groupIdMap.get(groupId);
        if (!nextGroupId) {
          nextGroupId = randomId();
          groupIdMap.set(groupId, nextGroupId);
        }
        return nextGroupId;
      },
    );
    // 先置空，最后统一按数组顺序生成合法且可合并的 fractional index
    copy.index = null;
    copy.created = copy.updated = getUpdatedTimestamp();
    bumpVersion(copy);
    return copy;
  });

  // 表格结构：行、列、单元格 id 全部重建，单元格文本 key 跟着结构 id 走
  const tableCellIdMap = new Map<string, string>();
  for (let index = 0; index < copies.length; index++) {
    const original = elements[index];
    const copy = copies[index];
    if (!isTableElement(original) || !isTableElement(copy)) {
      continue;
    }
    const { table, cellIdMap } = regenerateTableIds(copy.table);
    const rowIdMap = new Map(
      table.rows.map((row, rowIndex) => [
        original.table.rows[rowIndex].id,
        row.id,
      ]),
    );
    copy.table = table;
    copy.texts = remapTableTextsForImport(copy.texts, cellIdMap, rowIdMap);
    for (const [originalCellId, nextCellId] of cellIdMap) {
      tableCellIdMap.set(originalCellId, nextCellId);
    }
  }

  // 直接容器引用：父元素不在本批次时解除，避免指向源文档的元素
  for (const copy of copies) {
    const ref = copy.containerRef;
    if (!ref) {
      continue;
    }
    const nextContainerId = elementIdMap.get(ref.elementId);
    if (!nextContainerId) {
      copy.containerRef = undefined;
      continue;
    }
    if (ref.kind === "tableCell") {
      copy.containerRef = {
        ...ref,
        elementId: nextContainerId,
        cellId: tableCellIdMap.get(ref.cellId) ?? ref.cellId,
      };
    } else {
      copy.containerRef = { ...ref, elementId: nextContainerId };
    }
  }

  // 绑定关系与时序激活条链接沿用复制语义：批次内的目标改写，批次外解除
  fixDuplicatedBindingsAfterDuplication(
    copies,
    elementIdMap,
    arrayToMap(copies) as unknown as NonDeletedSceneElementsMap,
  );

  // 脑图关系存在显式 id 上，需要按图与节点分别重建
  const importedNodeIds = new Set(
    elements.filter(isMindmapNodeElement).map((element) => element.id),
  );
  const targetNodeIds = new Set(
    targetElements.filter(isMindmapNodeElement).map((element) => element.id),
  );
  const isAvailableParent = (parentId: string | null) =>
    !!parentId &&
    (importedNodeIds.has(parentId) || targetNodeIds.has(parentId));

  const graphIdMap = new Map<string, string>();
  const nodeIdMap = new Map<string, string>();
  const importedRoots = new Map<string, ExcalidrawMindmapNodeElement>();
  for (const element of elements) {
    if (isMindmapNodeElement(element) && element.role === "root") {
      importedRoots.set(element.graphId, element);
    }
  }

  for (let index = 0; index < copies.length; index++) {
    const original = elements[index];
    const copy = copies[index];
    if (!isMindmapNodeElement(original) || !isMindmapNodeElement(copy)) {
      continue;
    }
    let graphId = graphIdMap.get(original.graphId);
    if (!graphId) {
      graphId = randomId();
      graphIdMap.set(original.graphId, graphId);
    }
    nodeIdMap.set(original.id, copy.id);

    // 父节点既不在批次内也不在目标场景时，节点提升为副本图的根
    const isRoot =
      original.role === "root" || !isAvailableParent(original.parentId);
    Object.assign(copy, {
      graphId,
      role: isRoot ? "root" : "node",
      parentId: isRoot ? null : original.parentId,
      order: isRoot ? null : original.order,
    });
    if (isRoot && original.role !== "root") {
      const sourceRoot = importedRoots.get(original.graphId);
      if (sourceRoot) {
        Object.assign(copy, {
          layoutDirection: sourceRoot.layoutDirection,
          defaultNodeShape: sourceRoot.defaultNodeShape,
          defaultEdgeRouting: sourceRoot.defaultEdgeRouting,
          defaultEdgeStrokeColor: sourceRoot.defaultEdgeStrokeColor,
          defaultEdgeStrokeWidth: sourceRoot.defaultEdgeStrokeWidth,
          defaultEdgeStrokeStyle: sourceRoot.defaultEdgeStrokeStyle,
        });
      }
    }
  }

  for (let index = 0; index < copies.length; index++) {
    const original = elements[index];
    const copy = copies[index];
    if (!isMindmapNodeElement(original) || !isMindmapNodeElement(copy)) {
      continue;
    }
    if (copy.role !== "node") {
      continue;
    }
    // 批次内的父节点改写；目标场景中的父节点保留原 id
    const nextParentId = original.parentId
      ? nodeIdMap.get(original.parentId)
      : undefined;
    if (nextParentId) {
      Object.assign(copy, { parentId: nextParentId });
    }
  }

  for (let index = 0; index < copies.length; index++) {
    const original = elements[index];
    const copy = copies[index];
    if (!isMindmapEdgeElement(original) || !isMindmapEdgeElement(copy)) {
      continue;
    }
    const graphId = graphIdMap.get(original.graphId);
    const parentId = nodeIdMap.get(original.parentId);
    const childId = nodeIdMap.get(original.childId);
    if (graphId && parentId && childId) {
      Object.assign(copy, { graphId, parentId, childId });
    }
  }

  syncInvalidIndices(copies);

  return { elements: copies, elementIdMap };
};

const remapSelectedElementIds = (
  value: unknown,
  elementIdMap: ReadonlyMap<string, string>,
): Record<string, unknown> => {
  if (!value || typeof value !== "object") {
    return {};
  }
  const next: Record<string, unknown> = {};
  for (const [elementId, selected] of Object.entries(value)) {
    const nextElementId = elementIdMap.get(elementId);
    if (nextElementId) {
      next[nextElementId] = selected;
    }
  }
  return next;
};

/** 无法从元素 id 映射推出的元素引用，清除时使用 null。 */
const NULLED_ELEMENT_REFERENCES = [
  "editingGroupId",
  "editingElement",
  "editingElementTitle",
  "editingTextElement",
  "editingTextRegion",
  "selectedLinearElement",
  "croppingElementId",
  "activeLockedId",
  "elementsToHighlight",
  "searchMatches",
  "hoveredElementId",
  "newElement",
  "multiElement",
  "resizingElement",
  "selectionElement",
  "tableRowColSelection",
  "fragmentRowSelection",
] as const;

/** 以 id 集合承载的元素引用，清除时置为空集合。 */
const EMPTIED_ELEMENT_REFERENCES = [
  "selectedGroupIds",
  "previousSelectedElementIds",
  "lockedMultiSelections",
  "hoveredElementIds",
] as const;

/**
 * 文件导入携带的 appState 中，元素引用随身份重置同步：可映射的选中集合改写，
 * 其余元素引用一律清空，保证不悬挂。
 */
export const remapImportedAppState = (
  appState: Record<string, unknown> | undefined,
  elementIdMap: ReadonlyMap<string, string>,
): Record<string, unknown> | undefined => {
  if (!appState) {
    return undefined;
  }
  const next: Record<string, unknown> = { ...appState };
  if ("selectedElementIds" in next) {
    next.selectedElementIds = remapSelectedElementIds(
      next.selectedElementIds,
      elementIdMap,
    );
  }
  for (const key of NULLED_ELEMENT_REFERENCES) {
    if (key in next) {
      next[key] = null;
    }
  }
  for (const key of EMPTIED_ELEMENT_REFERENCES) {
    if (key in next) {
      next[key] = {};
    }
  }
  return next;
};
