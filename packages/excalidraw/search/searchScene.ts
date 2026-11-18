import {
  getElementTitle,
  getTextBlock,
  getTextRegions,
  isTitledElement,
} from "@excalidraw/element";

import type { TextRegionKey } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { formatMatchPreview, getMatchPreview } from "./preview";

import type {
  SceneSearchQuery,
  SceneSearchResult,
  SearchSceneOptions,
} from "../types";

export interface SceneSearchHit {
  element: ExcalidrawElement;
  regionKey: TextRegionKey | "title";
  text: string;
  index: number;
  length: number;
  term: string;
}

export interface SceneSearchElementMatches {
  element: ExcalidrawElement;
  result: SceneSearchResult;
}

const DEFAULT_LIMIT = 100;
const TITLE_MAX_LENGTH = 80;

type SearchMode = "any" | "all";

type TextFragment = {
  regionKey: TextRegionKey | "title";
  text: string;
};

/** 大小写不敏感的字面量匹配，转义后按全局正则推进。 */
const escapeSpecialCharacters = (string: string) =>
  string.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

const normalizeTerms = (query: SceneSearchQuery): string[] => {
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

const resolveLimit = (limit: number | undefined) => {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isSafeInteger(limit) || limit < 0) {
    return DEFAULT_LIMIT;
  }
  return limit;
};

const resolveMode = (mode: SearchSceneOptions["match"]): SearchMode =>
  mode === "all" ? "all" : "any";

/** 元素文本片段的聚合顺序：标题、区域顺序、未被区域覆盖的剩余 key。 */
const getTextFragments = (element: ExcalidrawElement): TextFragment[] => {
  const fragments: TextFragment[] = [];

  if (isTitledElement(element)) {
    const title = getElementTitle(element);
    if (title.trim()) {
      fragments.push({ regionKey: "title", text: title });
    }
  }

  const regionKeys = new Set<TextRegionKey>();
  for (const region of getTextRegions(element)) {
    regionKeys.add(region.key);
    const block = getTextBlock(element.texts, region.key);
    if (block?.text.trim()) {
      fragments.push({ regionKey: region.key, text: block.text });
    }
  }

  for (const key of Object.keys(element.texts ?? {}) as TextRegionKey[]) {
    if (regionKeys.has(key)) {
      continue;
    }
    const block = getTextBlock(element.texts, key);
    if (block?.text.trim()) {
      fragments.push({ regionKey: key, text: block.text });
    }
  }

  return fragments;
};

const getElementGroup = (
  element: ExcalidrawElement,
): SceneSearchResult["group"] => {
  if (element.type === "frame" || element.type === "magicframe") {
    return "frame";
  }
  if (element.type === "table") {
    return "table";
  }
  if (element.type === "mindmap-node") {
    return "mindmap";
  }
  if (element.type === "text") {
    return "text";
  }
  return "other";
};

const getCollapsedTitle = (text: string) => {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > TITLE_MAX_LENGTH
    ? `${collapsed.slice(0, TITLE_MAX_LENGTH)}…`
    : collapsed;
};

/** 沿 frameLike 容器链由外到内收集父画框标题，带环保护。 */
const getBreadcrumb = (
  element: ExcalidrawElement,
  elementsById: ReadonlyMap<string, ExcalidrawElement>,
): string[] => {
  const titles: string[] = [];
  const visited = new Set<string>([element.id]);
  let parentId =
    element.containerRef?.kind === "frameLike"
      ? element.containerRef.elementId
      : null;

  while (parentId) {
    if (visited.has(parentId)) {
      break;
    }
    visited.add(parentId);
    const parent = elementsById.get(parentId);
    if (!parent) {
      break;
    }
    if (isTitledElement(parent)) {
      titles.unshift(getElementTitle(parent));
    }
    parentId =
      parent.containerRef?.kind === "frameLike"
        ? parent.containerRef.elementId
        : null;
  }

  return titles;
};

/**
 * 在给定元素集合上做字面量文本检索。返回全部命中（供面板逐条渲染）与
 * 元素级去重结果（供公开 API），两者顺序都跟随场景元素顺序。
 */
export const searchSceneElements = (
  elements: readonly ExcalidrawElement[],
  query: SceneSearchQuery,
  options?: SearchSceneOptions,
  context?: { hiddenIds?: ReadonlySet<string> },
): { hits: SceneSearchHit[]; results: SceneSearchElementMatches[] } => {
  const terms = normalizeTerms(query);
  if (terms.length === 0) {
    return { hits: [], results: [] };
  }

  const mode = resolveMode(options?.match);
  const includeHidden = options?.includeHidden === true;
  const limit = resolveLimit(options?.limit);
  const hiddenIds = context?.hiddenIds;

  const elementsById = new Map(
    elements.map((element) => [element.id, element]),
  );

  const hits: SceneSearchHit[] = [];
  const results: SceneSearchElementMatches[] = [];
  const seenElementIds = new Set<string>();

  for (const element of elements) {
    if (seenElementIds.has(element.id)) {
      continue;
    }
    seenElementIds.add(element.id);

    const isHidden = hiddenIds?.has(element.id) === true;
    if (isHidden && !includeHidden) {
      continue;
    }

    const fragments = getTextFragments(element);
    if (fragments.length === 0) {
      continue;
    }

    const elementHits: SceneSearchHit[] = [];
    const matchedTermKeys = new Set<string>();

    for (const fragment of fragments) {
      const fragmentHits: {
        index: number;
        length: number;
        term: string;
        termKey: string;
        termIndex: number;
      }[] = [];

      terms.forEach((term, termIndex) => {
        const termKey = term.toLowerCase();
        const regex = new RegExp(escapeSpecialCharacters(term), "gi");
        let match: RegExpExecArray | null = null;
        while ((match = regex.exec(fragment.text)) !== null) {
          if (match[0] === "") {
            regex.lastIndex += 1;
            continue;
          }
          fragmentHits.push({
            index: match.index,
            length: match[0].length,
            term,
            termKey,
            termIndex,
          });
        }
      });

      fragmentHits.sort(
        (a, b) => a.index - b.index || a.termIndex - b.termIndex,
      );

      for (const hit of fragmentHits) {
        matchedTermKeys.add(hit.termKey);
        elementHits.push({
          element,
          regionKey: fragment.regionKey,
          text: fragment.text,
          index: hit.index,
          length: hit.length,
          term: hit.term,
        });
      }
    }

    if (elementHits.length === 0) {
      continue;
    }
    if (mode === "all" && matchedTermKeys.size < terms.length) {
      continue;
    }

    const matchedTerms = terms.filter((term) =>
      matchedTermKeys.has(term.toLowerCase()),
    );
    const firstHit = elementHits[0];

    results.push({
      element,
      result: {
        elementId: element.id,
        elementType: element.type,
        title: isTitledElement(element)
          ? getElementTitle(element)
          : getCollapsedTitle(fragments[0].text),
        preview: formatMatchPreview(
          getMatchPreview(firstHit.text, firstHit.index, firstHit.term),
          firstHit.length,
        ),
        matchedTermCount: matchedTerms.length,
        matchCount: elementHits.length,
        matchedTerms,
        group: getElementGroup(element),
        breadcrumb: getBreadcrumb(element, elementsById),
        ...(isHidden ? { hidden: true } : {}),
      },
    });

    hits.push(...elementHits);
  }

  return {
    hits,
    results: limit === 0 ? [] : results.slice(0, limit),
  };
};
