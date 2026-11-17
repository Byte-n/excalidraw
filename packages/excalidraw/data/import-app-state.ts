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
