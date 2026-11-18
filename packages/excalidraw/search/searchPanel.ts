import { atom, editorJotaiStore } from "../editor-jotai";

import type {
  AppClassProperties,
  SearchPanelItem,
  SearchPanelOptions,
  SceneSearchQuery,
} from "../types";

export interface SearchPanelQuery {
  terms: readonly string[];
  match: "any" | "all";
  /** 首次出结果时是否聚焦首项。 */
  focusFirst: boolean;
}

export interface SearchPanelLocateState {
  items: readonly SearchPanelItem[];
  activeElementId: string | null;
  focusFirst: boolean;
  filterable: boolean;
}

export interface SearchPanelState {
  mode: "search" | "locate";
  owner: "host" | null;
  title: string | null;
  search: SearchPanelQuery | null;
  locate: SearchPanelLocateState | null;
  /** 宿主每次打开都会递增，用于重复打开同内容时重置面板。 */
  requestId: number;
}

const INITIAL_STATE: SearchPanelState = {
  mode: "search",
  owner: null,
  title: null,
  search: null,
  locate: null,
  requestId: 0,
};

export const searchPanelStateAtom = atom<SearchPanelState>(INITIAL_STATE);

/** 面板输入框文本；搜索模式下宿主写入初始查询词。 */
export const searchPanelInputAtom = atom<string>("");

/** 搜索模式当前聚焦的结果索引。 */
export const searchItemInFocusAtom = atom<number | null>(null);

/** 统一把字符串或数组查询转成 trim、去空、小写去重后的词列表。 */
export const normalizeSearchTerms = (
  query: SceneSearchQuery | undefined,
): string[] => {
  if (query === undefined) {
    return [];
  }
  const rawTerms = typeof query === "string" ? [query] : query;
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const rawTerm of rawTerms) {
    const term = rawTerm.trim();
    if (!term) {
      continue;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push(term);
  }
  return terms;
};

/** 只保留仍可展示的场景元素：存在、未删除、非折叠脑图隐藏节点，并按 ID 去重。 */
const filterLocateItems = (
  app: AppClassProperties,
  items: readonly SearchPanelItem[],
): SearchPanelItem[] => {
  const elements = app.scene.getNonDeletedElementsMap();
  const hiddenIds = app.scene.getMindmapHiddenElementIds();
  const seen = new Set<string>();
  const kept: SearchPanelItem[] = [];

  for (const item of items) {
    const elementId = item.elementId;
    if (seen.has(elementId) || !elements.has(elementId)) {
      continue;
    }
    if (hiddenIds.has(elementId)) {
      continue;
    }
    seen.add(elementId);
    kept.push(item);
  }

  return kept;
};

/** 重置为初始面板状态，保留 requestId 以便区分先后打开。 */
export const resetSearchPanelState = () => {
  editorJotaiStore.set(searchPanelStateAtom, (state) => ({
    ...INITIAL_STATE,
    requestId: state.requestId,
  }));
};

/** 释放宿主所有权并切回搜索模式；用户输入框里的查询词保留。 */
export const releaseSearchPanelOwnership = () => {
  editorJotaiStore.set(searchPanelStateAtom, (state) => {
    if (
      state.owner === null &&
      state.mode === "search" &&
      state.locate === null
    ) {
      return state;
    }
    return {
      ...state,
      mode: "search",
      owner: null,
      title: null,
      locate: null,
    };
  });
};

/**
 * 宿主打开面板。locate 模式过滤后无可展示项时返回 false 且不改动面板；
 * search 模式始终允许打开，空查询只是等待用户输入。
 */
export const openHostSearchPanel = (
  app: AppClassProperties,
  options: SearchPanelOptions,
): boolean => {
  if (options.mode === "search") {
    const terms = normalizeSearchTerms(options.query);
    editorJotaiStore.set(searchPanelStateAtom, (state) => ({
      mode: "search",
      owner: "host",
      title: options.title ?? null,
      search: {
        terms,
        match: options.match === "all" ? "all" : "any",
        focusFirst: options.focusFirst !== false,
      },
      locate: null,
      requestId: state.requestId + 1,
    }));
    return true;
  }

  const items = filterLocateItems(app, options.items);
  if (items.length === 0) {
    return false;
  }
  const activeElementId =
    options.activeElementId &&
    items.some((item) => item.elementId === options.activeElementId)
      ? options.activeElementId
      : null;

  editorJotaiStore.set(searchPanelStateAtom, (state) => ({
    mode: "locate",
    owner: "host",
    title: options.title ?? null,
    search: null,
    locate: {
      items,
      activeElementId,
      focusFirst: options.focusFirst === true,
      filterable: options.filterable !== false,
    },
    requestId: state.requestId + 1,
  }));
  return true;
};

/** 宿主关闭请求：只有面板归宿主所有时才返回 true。 */
export const closeHostSearchPanel = (): boolean => {
  const state = editorJotaiStore.get(searchPanelStateAtom);
  if (state.owner !== "host") {
    return false;
  }
  editorJotaiStore.set(searchPanelStateAtom, {
    ...INITIAL_STATE,
    requestId: state.requestId,
  });
  editorJotaiStore.set(searchItemInFocusAtom, null);
  return true;
};
