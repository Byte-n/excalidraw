import { arrayToMap, getUpdatedTimestamp, randomId } from "@excalidraw/common";

import { fixDuplicatedBindingsAfterDuplication } from "./binding";
import { deepCopyElement } from "./duplicate";
import { remapContainerRefAfterDuplication } from "./frame";
import { syncInvalidIndices } from "./fractionalIndex";
import { getNewGroupIdsForDuplication } from "./groups";
import { remapMindmapIdentity } from "./mindmapIdentity";
import { bumpVersion } from "./mutateElement";
import { regenerateTableIds } from "./tableContainer";
import { remapTableTexts } from "./tableTextStyle";
import { parseTextRegionKey, textRegionKey } from "./text/keys";
import { withTextBlock } from "./text/ops";
import { isMindmapNodeElement, isTableElement } from "./typeChecks";

import type { TextBlockMap, TextRegionKey } from "./text/types";
import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  NonDeletedSceneElementsMap,
} from "./types";

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
    if (!copy.containerRef) {
      continue;
    }
    copy.containerRef = remapContainerRefAfterDuplication(
      copy.containerRef,
      elementIdMap,
      tableCellIdMap,
    );
  }

  // 绑定关系与时序激活条链接沿用复制语义：批次内的目标改写，批次外解除
  fixDuplicatedBindingsAfterDuplication(
    copies,
    elementIdMap,
    arrayToMap(copies) as unknown as NonDeletedSceneElementsMap,
  );

  // 脑图关系：批次外父节点按目标场景判断是否可保留，根配置取本批次导入的根
  const importedRoots = new Map<string, ExcalidrawMindmapNodeElement>();
  for (const element of elements) {
    if (isMindmapNodeElement(element) && element.role === "root") {
      importedRoots.set(element.graphId, element);
    }
  }
  const retainedParentIds = new Set(
    targetElements.filter(isMindmapNodeElement).map((element) => element.id),
  );
  remapMindmapIdentity(copies, elements, {
    retainedParentIds,
    resolveRootDefaults: (graphId) => importedRoots.get(graphId),
  });

  syncInvalidIndices(copies);

  return { elements: copies, elementIdMap };
};
