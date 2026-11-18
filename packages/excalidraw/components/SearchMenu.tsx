import clsx from "clsx";
import debounce from "lodash.debounce";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";

import {
  CLASSES,
  EVENT,
  FONT_FAMILY,
  FRAME_STYLE,
  getLineHeight,
  type Bounds,
} from "@excalidraw/common";

import {
  getCommonBounds,
  getElementTitle,
  getMindmapNodeTextStyle,
  getTableCellBounds,
  getTextElementDisplayText,
  getTextElementFont,
  getTextElementStyle,
  getTextElementText,
  getTextRegionLayout,
  isElementCompletelyInViewport,
  isSceneBoundsCompletelyInViewport,
  isTableElement,
} from "@excalidraw/element";

import { measureText } from "@excalidraw/element";

import {
  KEYS,
  randomInteger,
  addEventListener,
  getFontString,
} from "@excalidraw/common";

import { newTextElement } from "@excalidraw/element";
import {
  isTextElement,
  isFrameLikeElement,
  isMindmapNodeElement,
} from "@excalidraw/element";

import type { TextRegionKey } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { editorJotaiStore, useAtom } from "../editor-jotai";

import { useStable } from "../hooks/useStable";
import { useSceneNonce } from "../hooks/useSceneNonce";
import { t } from "../i18n";
import { getMatchPreview, searchSceneElements } from "../search";
import {
  releaseSearchPanelOwnership,
  resetSearchPanelState,
  searchItemInFocusAtom,
  searchPanelInputAtom,
  searchPanelStateAtom,
  type SearchPanelLocateState,
  type SearchPanelState,
} from "../search/searchPanel";

import { useApp, useExcalidrawSetAppState } from "./App";
import { Button } from "./Button";
import { TextField } from "./TextField";
import { getMindmapOutlines, getMindmapPath } from "./mindmapOutlineModel";
import {
  collapseDownIcon,
  upIcon,
  searchIcon,
  frameToolIcon,
  tableToolIcon,
  TextIcon,
} from "./icons";

import "./SearchMenu.scss";

import type {
  AppClassProperties,
  SearchMatch,
  SearchPanelItem,
} from "../types";
import type { MatchPreview } from "../search";

const SEARCH_DEBOUNCE = 350;

/** Below this on-screen size a match is too small to read, so focusing it is
 * allowed to zoom in (never past 100%). */
const FONT_SIZE_LEGIBILITY_THRESHOLD = 14;

type SearchMatchItem = {
  element: ExcalidrawElement;
  regionKey: TextRegionKey | "title";
  term: string;
  index: number;
  preview: MatchPreview;
  matchedLines: SearchMatch["matchedLines"];
  hidden?: boolean;
  mindmap?: {
    nodeId: string;
    graphTitle: string;
    graphNumber: number;
    path: string[];
  };
};

type SearchMatches = {
  nonce: number | null;
  items: SearchMatchItem[];
};

export const SearchMenu = () => {
  const app = useApp();
  const setAppState = useExcalidrawSetAppState();

  const searchInputRef = useRef<HTMLInputElement>(null);

  const [panelState, setPanelState] = useAtom(searchPanelStateAtom);
  const mode = panelState.mode;
  const panelSearch = panelState.search;

  const [inputValue, setInputValue] = useAtom(searchPanelInputAtom);
  const searchQuery = inputValue.trim();
  const searchTerms = useMemo<readonly string[]>(() => {
    if (panelSearch && panelSearch.terms.length > 0) {
      return panelSearch.terms;
    }
    return searchQuery ? [searchQuery] : [];
  }, [panelSearch, searchQuery]);
  const searchMatch = panelSearch?.match ?? "any";
  const queryKey = `${searchMatch}:${searchTerms.join("\u0000")}`;

  const [isSearching, setIsSearching] = useState(false);

  const [searchMatches, setSearchMatches] = useState<SearchMatches>({
    nonce: null,
    items: [],
  });
  const searchedQueryRef = useRef<string | null>(null);
  const lastSceneNonceRef = useRef<number | undefined>(undefined);
  const searchedRequestIdRef = useRef<number | null>(null);
  const focusedMatchRef = useRef<string | null>(null);
  const locateCleanupRef = useRef(false);

  const [focusIndex, setFocusIndex] = useAtom(searchItemInFocusAtom);
  const sceneNonce = useSceneNonce(app.scene);
  const elementsMap = app.scene.getNonDeletedElementsMap();

  useEffect(() => {
    if (mode !== "search") {
      // 切到 locate 时取消在途搜索，避免旧结果写入高亮；每次进入只清理一次
      if (!locateCleanupRef.current) {
        locateCleanupRef.current = true;
        handleSearch.cancel();
        setSearchMatches({ nonce: null, items: [] });
        setIsSearching(false);
        setAppState({ searchMatches: null });
      }
      // 旧搜索结果失效，回切搜索时重新计算
      searchedQueryRef.current = null;
      searchedRequestIdRef.current = null;
      return;
    }
    locateCleanupRef.current = false;
    if (isSearching) {
      return;
    }
    if (
      queryKey === searchedQueryRef.current &&
      sceneNonce === lastSceneNonceRef.current &&
      panelState.requestId === searchedRequestIdRef.current
    ) {
      return;
    }

    // 宿主刚写入查询词时按 focusFirst 决定是否聚焦首项
    const focusFirstResult =
      panelState.requestId !== searchedRequestIdRef.current &&
      panelSearch?.focusFirst === true;

    searchedQueryRef.current = null;
    handleSearch(
      searchTerms,
      searchMatch,
      app,
      focusFirstResult,
      (matchItems, firstVisibleIndex) => {
        const retainedIndex = focusedMatchRef.current
          ? matchItems.findIndex(
              (item) => item.element.id === focusedMatchRef.current,
            )
          : -1;
        setSearchMatches({
          nonce: randomInteger(),
          items: matchItems,
        });
        searchedQueryRef.current = queryKey;
        lastSceneNonceRef.current = app.scene.getSceneNonce();
        searchedRequestIdRef.current = panelState.requestId;
        setFocusIndex(retainedIndex >= 0 ? retainedIndex : firstVisibleIndex);
        setAppState({
          searchMatches: matchItems.length
            ? {
                focusedId: null,
                matches: matchItems.map((searchMatch) => ({
                  id: searchMatch.element.id,
                  focus: false,
                  matchedLines: searchMatch.matchedLines,
                })),
              }
            : null,
        });
      },
    );
  }, [
    mode,
    isSearching,
    queryKey,
    searchTerms,
    searchMatch,
    panelSearch,
    panelState.requestId,
    elementsMap,
    sceneNonce,
    app,
    setAppState,
    setFocusIndex,
    lastSceneNonceRef,
  ]);

  const goToNextItem = () => {
    if (searchMatches.items.length > 0) {
      setFocusIndex((focusIndex) => {
        if (focusIndex === null) {
          return 0;
        }

        return (focusIndex + 1) % searchMatches.items.length;
      });
    }
  };

  const goToPreviousItem = () => {
    if (searchMatches.items.length > 0) {
      setFocusIndex((focusIndex) => {
        if (focusIndex === null) {
          return 0;
        }

        return focusIndex - 1 < 0
          ? searchMatches.items.length - 1
          : focusIndex - 1;
      });
    }
  };

  useEffect(() => {
    if (mode !== "search") {
      return;
    }
    setAppState((state) => {
      if (!state.searchMatches) {
        return null;
      }

      const focusedId =
        focusIndex !== null
          ? state.searchMatches?.matches[focusIndex]?.id || null
          : null;

      return {
        searchMatches: {
          focusedId,
          matches: state.searchMatches.matches.map((match, index) => {
            if (index === focusIndex) {
              return { ...match, focus: true };
            }
            return { ...match, focus: false };
          }),
        },
      };
    });
  }, [focusIndex, setAppState, mode]);

  useEffect(() => {
    if (mode !== "search") {
      return;
    }
    focusedMatchRef.current =
      focusIndex !== null
        ? searchMatches.items[focusIndex]?.element.id ?? null
        : null;
  }, [focusIndex, searchMatches, mode]);

  useEffect(() => {
    if (mode !== "search") {
      return;
    }
    if (searchMatches.items.length > 0 && focusIndex !== null) {
      const match = searchMatches.items[focusIndex];

      if (match) {
        const currentElement = app.scene.getNonDeletedElement(match.element.id);
        if (!currentElement) {
          return;
        }

        if (
          match.hidden ||
          (isMindmapNodeElement(currentElement) &&
            app.scene.getMindmapHiddenElementIds().has(currentElement.id))
        ) {
          return;
        }

        if (match.matchedLines.length === 0) {
          app.revealElement(match.element.id, { select: false });
          return;
        }

        if (isTextElement(currentElement)) {
          // A match inside a table cell navigates to the cell, not to the
          // matched word. Cell text is 13px by default, so the word box below
          // would always read as "tiny" and be fit with `contain` — filling the
          // viewport with a single word, up to `MAX_ZOOM`. The cell rect fits
          // with `scale-down` instead, which never zooms past 100%.
          const cellBounds = getTableCellSceneBounds(
            currentElement,
            app.scene.getNonDeletedElementsMap(),
          );
          if (cellBounds) {
            const isCellTextTiny =
              getTextElementStyle(currentElement).fontSize *
                app.state.zoom.value <
              FONT_SIZE_LEGIBILITY_THRESHOLD;

            if (
              isCellTextTiny ||
              !isSceneBoundsCompletelyInViewport(
                cellBounds,
                app.canvas.width / app.ownerWindow.devicePixelRatio,
                app.canvas.height / app.ownerWindow.devicePixelRatio,
                {
                  offsetLeft: app.state.offsetLeft,
                  offsetTop: app.state.offsetTop,
                  scrollX: app.state.scrollX,
                  scrollY: app.state.scrollY,
                  zoom: app.state.zoom,
                },
                app.viewport.getOffsets(),
              )
            ) {
              app.viewport.setViewport({
                target: cellBounds,
                fit: "scale-down",
                animation: { duration: 300 },
                offsets: { ui: true },
              });
            }
            return;
          }
        }

        if (
          !isTextElement(currentElement) &&
          !isFrameLikeElement(currentElement) &&
          !isTableElement(currentElement) &&
          !isMindmapNodeElement(currentElement)
        ) {
          app.viewport.setViewport({
            target: currentElement,
            fit: "scale-down",
            animation: { duration: 300 },
            offsets: { ui: true },
          });
          return;
        }

        const zoomValue = app.state.zoom.value;
        const measureStyle = getSearchMeasureStyle(currentElement);

        const matchAsElement = newTextElement({
          text: match.term,
          x: currentElement.x + (match.matchedLines[0]?.offsetX ?? 0),
          y: currentElement.y + (match.matchedLines[0]?.offsetY ?? 0),
          width: match.matchedLines[0]?.width,
          height: match.matchedLines[0]?.height,
          fontSize: measureStyle.fontSize,
          fontFamily: measureStyle.fontFamily,
        });

        const fontSize = getTextElementStyle(matchAsElement).fontSize;
        const isTextTiny =
          fontSize * zoomValue < FONT_SIZE_LEGIBILITY_THRESHOLD;

        if (
          !isElementCompletelyInViewport(
            [matchAsElement],
            app.canvas.width / app.ownerWindow.devicePixelRatio,
            app.canvas.height / app.ownerWindow.devicePixelRatio,
            {
              offsetLeft: app.state.offsetLeft,
              offsetTop: app.state.offsetTop,
              scrollX: app.state.scrollX,
              scrollY: app.state.scrollY,
              zoom: app.state.zoom,
            },
            app.scene.getNonDeletedElementsMap(),
            app.viewport.getOffsets(),
          ) ||
          isTextTiny
        ) {
          // tiny, illegible text fills the viewport so it becomes readable;
          // otherwise just fit the match into view (capped at 100%)
          const behavior =
            isTextTiny && fontSize < FONT_SIZE_LEGIBILITY_THRESHOLD
              ? "contain"
              : "scale-down";

          app.viewport.setViewport({
            target: getCommonBounds([matchAsElement]),
            fit: behavior,
            animation: { duration: 300 },
            offsets: { ui: true },
          });
        }
      }
    }
  }, [focusIndex, searchMatches, app, mode]);

  useEffect(() => {
    return () => {
      handleSearch.cancel();
      setFocusIndex(null);
      searchedQueryRef.current = null;
      lastSceneNonceRef.current = undefined;
      searchedRequestIdRef.current = null;
      setAppState({
        searchMatches: null,
      });
      setIsSearching(false);
      // 卸载时面板仍归宿主所有则释放，避免宿主 close 误关用户面板
      if (editorJotaiStore.get(searchPanelStateAtom).owner === "host") {
        resetSearchPanelState();
      }
    };
  }, [setAppState, setFocusIndex]);

  const stableState = useStable({
    goToNextItem,
    goToPreviousItem,
    searchMatches,
  });

  useEffect(() => {
    const eventHandler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key === KEYS.ESCAPE &&
        !app.state.openDialog &&
        !app.state.openPopup
      ) {
        event.preventDefault();
        event.stopPropagation();
        setAppState({
          openSidebar: null,
        });
        return;
      }

      if (event[KEYS.CTRL_OR_CMD] && event.key === KEYS.F) {
        event.preventDefault();
        event.stopPropagation();

        if (app.state.openDialog) {
          return;
        }

        // 用户接管面板：释放宿主所有权并切回搜索模式
        releaseSearchPanelOwnership();

        if (!searchInputRef.current?.matches(":focus")) {
          if (app.state.openDialog) {
            setAppState({
              openDialog: null,
            });
          }
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      }

      if (mode !== "search") {
        return;
      }

      if (
        target instanceof app.ownerWindow.HTMLElement &&
        target.closest(".layer-ui__search")
      ) {
        if (stableState.searchMatches.items.length) {
          if (event.key === KEYS.ENTER) {
            event.stopPropagation();
            stableState.goToNextItem();
          }

          if (event.key === KEYS.ARROW_UP) {
            event.stopPropagation();
            stableState.goToPreviousItem();
          } else if (event.key === KEYS.ARROW_DOWN) {
            event.stopPropagation();
            stableState.goToNextItem();
          }
        }
      }
    };

    // `capture` needed to prevent firing on initial open from App.tsx,
    // as well as to handle events before App ones
    return addEventListener(app.ownerWindow, EVENT.KEYDOWN, eventHandler, {
      capture: true,
      passive: false,
    });
  }, [setAppState, stableState, app, mode]);

  if (mode === "locate") {
    return (
      <div className="layer-ui__search">
        <LocatePanel app={app} state={panelState} />
      </div>
    );
  }

  const matchCount = `${searchMatches.items.length} ${
    searchMatches.items.length === 1
      ? t("search.singleResult")
      : t("search.multipleResults")
  }`;

  return (
    <div className="layer-ui__search">
      {panelState.title !== null && (
        <div className="layer-ui__search-title">{panelState.title}</div>
      )}
      <div className="layer-ui__search-header">
        <TextField
          className={CLASSES.SEARCH_MENU_INPUT_WRAPPER}
          value={inputValue}
          ref={searchInputRef}
          placeholder={t("search.placeholder")}
          icon={searchIcon}
          onChange={(value) => {
            setInputValue(value);
            // 用户编辑后降级为单字符串字面查询
            setPanelState((state) =>
              state.search ? { ...state, search: null } : state,
            );
            setIsSearching(true);
            focusedMatchRef.current = null;
            const nextQuery = value.trim();
            // 记录调度时的请求，回调执行时据此判断面板是否已被宿主替换
            const scheduledRequestId = panelState.requestId;
            handleSearch(
              nextQuery ? [nextQuery] : [],
              "any",
              app,
              true,
              (matchItems, index) => {
                if (
                  editorJotaiStore.get(searchPanelStateAtom).requestId !==
                  scheduledRequestId
                ) {
                  // 宿主已替换查询：丢弃旧结果，交由主 effect 按新请求重新搜索
                  setIsSearching(false);
                  return;
                }
                setSearchMatches({
                  nonce: randomInteger(),
                  items: matchItems,
                });
                setFocusIndex(index);
                searchedQueryRef.current = `any:${nextQuery}`;
                lastSceneNonceRef.current = app.scene.getSceneNonce();
                searchedRequestIdRef.current = panelState.requestId;
                setAppState({
                  searchMatches: matchItems.length
                    ? {
                        focusedId: null,
                        matches: matchItems.map((searchMatch) => ({
                          id: searchMatch.element.id,
                          focus: false,
                          matchedLines: searchMatch.matchedLines,
                        })),
                      }
                    : null,
                });

                setIsSearching(false);
              },
            );
          }}
          selectOnRender
        />
      </div>

      <div className="layer-ui__search-count">
        {searchMatches.items.length > 0 && (
          <>
            {focusIndex !== null && focusIndex > -1 ? (
              <div>
                {focusIndex + 1} / {matchCount}
              </div>
            ) : (
              <div>{matchCount}</div>
            )}
            <div className="result-nav">
              <Button
                onSelect={() => {
                  goToNextItem();
                }}
                className="result-nav-btn"
              >
                {collapseDownIcon}
              </Button>
              <Button
                onSelect={() => {
                  goToPreviousItem();
                }}
                className="result-nav-btn"
              >
                {upIcon}
              </Button>
            </div>
          </>
        )}

        {searchMatches.items.length === 0 &&
          searchQuery &&
          searchedQueryRef.current && (
            <div style={{ margin: "1rem auto" }}>{t("search.noMatch")}</div>
          )}
      </div>

      <MatchList
        matches={searchMatches}
        onItemClick={(index) => {
          const match = searchMatches.items[index];
          if (!match) {
            return;
          }
          if (match.mindmap) {
            const node = app.scene.getNonDeletedElement(match.mindmap.nodeId);
            if (
              !node ||
              !isMindmapNodeElement(node) ||
              !app.mindmap.focusNode(node.id)
            ) {
              return;
            }
          } else if (!app.scene.getNonDeletedElement(match.element.id)) {
            return;
          }
          focusedMatchRef.current = match.element.id;
          setFocusIndex(index);
        }}
        focusIndex={focusIndex}
      />
    </div>
  );
};

const EMPTY_LOCATE_ITEMS: readonly SearchPanelItem[] = [];

const getInitialLocateFocusId = (
  locate: SearchPanelLocateState,
): string | null => {
  const enabledItems = locate.items.filter((item) => !item.disabled);
  if (
    locate.activeElementId &&
    enabledItems.some((item) => item.elementId === locate.activeElementId)
  ) {
    return locate.activeElementId;
  }
  return locate.focusFirst ? enabledItems[0]?.elementId ?? null : null;
};

const filterLocateItems = (
  items: readonly SearchPanelItem[],
  filterValue: string,
): SearchPanelItem[] => {
  const query = filterValue.trim().toLowerCase();
  if (!query) {
    return [...items];
  }
  return items.filter((item) =>
    [item.label, item.preview, item.detail].some((text) =>
      text?.toLowerCase().includes(query),
    ),
  );
};

const LocatePanel = ({
  app,
  state,
}: {
  app: AppClassProperties;
  state: SearchPanelState;
}) => {
  const locate = state.locate;
  const [filterValue, setFilterValue] = useState("");
  const [focusedElementId, setFocusedElementId] = useState<string | null>(() =>
    locate ? getInitialLocateFocusId(locate) : null,
  );

  const items = locate?.items ?? EMPTY_LOCATE_ITEMS;
  const filteredItems = useMemo(
    () => filterLocateItems(items, filterValue),
    [items, filterValue],
  );

  useEffect(() => {
    if (!locate) {
      return;
    }
    // 宿主重新打开/替换内容时重置筛选与焦点
    setFilterValue("");
    setFocusedElementId(getInitialLocateFocusId(locate));
  }, [state.requestId, locate]);

  useEffect(() => {
    if (focusedElementId === null) {
      return;
    }
    const current = filteredItems.find(
      (item) => item.elementId === focusedElementId,
    );
    if (current && !current.disabled) {
      return;
    }
    setFocusedElementId(null);
  }, [filteredItems, focusedElementId]);

  const groups = useMemo(() => {
    const byGroup = new Map<string | null, SearchPanelItem[]>();
    for (const item of filteredItems) {
      const key = item.group ? item.group : null;
      const bucket = byGroup.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        byGroup.set(key, [item]);
      }
    }
    return [...byGroup.entries()];
  }, [filteredItems]);

  const moveFocus = (delta: 1 | -1) => {
    const enabledItems = filteredItems.filter((item) => !item.disabled);
    if (enabledItems.length === 0) {
      return;
    }
    const index = enabledItems.findIndex(
      (item) => item.elementId === focusedElementId,
    );
    const nextIndex =
      index === -1
        ? delta > 0
          ? 0
          : enabledItems.length - 1
        : (index + delta + enabledItems.length) % enabledItems.length;
    setFocusedElementId(enabledItems[nextIndex].elementId);
  };

  const revealItem = (item: SearchPanelItem | undefined) => {
    if (!item || item.disabled) {
      return;
    }
    setFocusedElementId(item.elementId);
    app.revealElement(item.elementId);
  };

  const stableState = useStable({
    filteredItems,
    focusedElementId,
    moveFocus,
    revealItem,
  });

  useEffect(() => {
    const eventHandler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        !(target instanceof app.ownerWindow.HTMLElement) ||
        !target.closest(".layer-ui__search")
      ) {
        return;
      }
      if (event.key === KEYS.ENTER) {
        event.stopPropagation();
        stableState.revealItem(
          stableState.filteredItems.find(
            (item) => item.elementId === stableState.focusedElementId,
          ),
        );
      } else if (event.key === KEYS.ARROW_UP) {
        event.stopPropagation();
        stableState.moveFocus(-1);
      } else if (event.key === KEYS.ARROW_DOWN) {
        event.stopPropagation();
        stableState.moveFocus(1);
      }
    };

    return addEventListener(app.ownerWindow, EVENT.KEYDOWN, eventHandler, {
      capture: true,
      passive: false,
    });
  }, [app, stableState]);

  return (
    <>
      {state.title !== null && (
        <div className="layer-ui__search-title">{state.title}</div>
      )}

      {locate?.filterable && (
        <div className="layer-ui__search-header">
          <TextField
            value={filterValue}
            placeholder={t("search.placeholder")}
            icon={searchIcon}
            onChange={setFilterValue}
          />
        </div>
      )}

      <div className="layer-ui__search-count">
        {filteredItems.length > 0 ? (
          <div>
            {filteredItems.length}{" "}
            {filteredItems.length === 1
              ? t("search.singleResult")
              : t("search.multipleResults")}
          </div>
        ) : (
          <div style={{ margin: "1rem auto" }}>{t("search.noMatch")}</div>
        )}
      </div>

      <div>
        {groups.map(([group, groupItems]) => (
          <div
            className="layer-ui__search-result-container"
            key={group ?? "__ungrouped"}
          >
            {group !== null && (
              <div className="layer-ui__search-result-title">
                <div>{group}</div>
              </div>
            )}
            {groupItems.map((item) => {
              const active =
                item.elementId === focusedElementId && !item.disabled;
              return (
                <div
                  key={item.elementId}
                  tabIndex={item.disabled ? undefined : -1}
                  aria-disabled={item.disabled || undefined}
                  className={clsx("layer-ui__result-item", {
                    active,
                    disabled: item.disabled,
                  })}
                  onClick={() => revealItem(item)}
                  ref={(ref) => {
                    if (active) {
                      ref?.scrollIntoView({
                        behavior: "auto",
                        block: "nearest",
                      });
                    }
                  }}
                >
                  <div className="preview-text">{item.label}</div>
                  {item.preview && (
                    <div className="preview-text">{item.preview}</div>
                  )}
                  {item.detail && (
                    <div className="mindmap-search-path">{item.detail}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
};

const ListItem = (props: {
  preview: SearchMatchItem["preview"];
  term: string;
  highlighted: boolean;
  mindmap?: SearchMatchItem["mindmap"];
  onClick?: () => void;
}) => {
  const preview = [
    props.preview.moreBefore ? "..." : "",
    props.preview.previewText.slice(0, props.preview.indexInSearchQuery),
    props.preview.previewText.slice(
      props.preview.indexInSearchQuery,
      props.preview.indexInSearchQuery + props.term.length,
    ),
    props.preview.previewText.slice(
      props.preview.indexInSearchQuery + props.term.length,
    ),
    props.preview.moreAfter ? "..." : "",
  ];

  return (
    <div
      tabIndex={-1}
      className={clsx("layer-ui__result-item", {
        active: props.highlighted,
      })}
      onClick={props.onClick}
      ref={(ref) => {
        if (props.highlighted) {
          ref?.scrollIntoView({ behavior: "auto", block: "nearest" });
        }
      }}
    >
      <div className="preview-text">
        {preview.flatMap((text, idx) => (
          <Fragment key={idx}>{idx === 2 ? <b>{text}</b> : text}</Fragment>
        ))}
      </div>
      {props.mindmap && (
        <div className="mindmap-search-path">
          {t("outline.graph", { number: props.mindmap.graphNumber })}:{" "}
          {props.mindmap.graphTitle}
          <span>{props.mindmap.path.join(" / ")}</span>
        </div>
      )}
    </div>
  );
};

interface MatchListProps {
  matches: SearchMatches;
  onItemClick: (index: number) => void;
  focusIndex: number | null;
}

const MatchListBase = (props: MatchListProps) => {
  const frameNameMatches = useMemo(
    () =>
      props.matches.items.filter((match) => isFrameLikeElement(match.element)),
    [props.matches],
  );

  const tableNameMatches = useMemo(
    () => props.matches.items.filter((match) => isTableElement(match.element)),
    [props.matches],
  );

  const textMatches = useMemo(
    () =>
      props.matches.items.filter(
        (match) =>
          !isFrameLikeElement(match.element) && !isTableElement(match.element),
      ),
    [props.matches],
  );

  const tableOffset = frameNameMatches.length;
  const textOffset = tableOffset + tableNameMatches.length;

  return (
    <div>
      {frameNameMatches.length > 0 && (
        <div className="layer-ui__search-result-container">
          <div className="layer-ui__search-result-title">
            <div className="title-icon">{frameToolIcon}</div>
            <div>{t("search.frames")}</div>
          </div>
          {frameNameMatches.map((searchMatch, index) => (
            <ListItem
              key={
                searchMatch.element.id +
                searchMatch.regionKey +
                searchMatch.index
              }
              term={searchMatch.term}
              preview={searchMatch.preview}
              mindmap={searchMatch.mindmap}
              highlighted={index === props.focusIndex}
              onClick={() => props.onItemClick(index)}
            />
          ))}

          {tableNameMatches.length + textMatches.length > 0 && (
            <div className="layer-ui__divider" />
          )}
        </div>
      )}

      {tableNameMatches.length > 0 && (
        <div className="layer-ui__search-result-container">
          <div className="layer-ui__search-result-title">
            <div className="title-icon">{tableToolIcon}</div>
            <div>{t("search.tables")}</div>
          </div>
          {tableNameMatches.map((searchMatch, index) => (
            <ListItem
              key={
                searchMatch.element.id +
                searchMatch.regionKey +
                searchMatch.index
              }
              term={searchMatch.term}
              preview={searchMatch.preview}
              mindmap={searchMatch.mindmap}
              highlighted={index + tableOffset === props.focusIndex}
              onClick={() => props.onItemClick(index + tableOffset)}
            />
          ))}

          {textMatches.length > 0 && <div className="layer-ui__divider" />}
        </div>
      )}

      {textMatches.length > 0 && (
        <div className="layer-ui__search-result-container">
          <div className="layer-ui__search-result-title">
            <div className="title-icon">{TextIcon}</div>
            <div>{t("search.texts")}</div>
          </div>
          {textMatches.map((searchMatch, index) => (
            <ListItem
              key={
                searchMatch.element.id +
                searchMatch.regionKey +
                searchMatch.index
              }
              term={searchMatch.term}
              preview={searchMatch.preview}
              mindmap={searchMatch.mindmap}
              highlighted={index + textOffset === props.focusIndex}
              onClick={() => props.onItemClick(index + textOffset)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const areEqual = (prevProps: MatchListProps, nextProps: MatchListProps) => {
  return (
    prevProps.matches.nonce === nextProps.matches.nonce &&
    prevProps.focusIndex === nextProps.focusIndex
  );
};

const MatchList = memo(MatchListBase, areEqual);

const normalizeWrappedText = (
  wrappedText: string,
  originalText: string,
): string => {
  const wrappedLines = wrappedText.split("\n");
  const normalizedLines: string[] = [];
  let originalIndex = 0;

  for (let i = 0; i < wrappedLines.length; i++) {
    let currentLine = wrappedLines[i];
    const nextLine = wrappedLines[i + 1];

    if (nextLine) {
      const nextLineIndexInOriginal = originalText.indexOf(
        nextLine,
        originalIndex,
      );

      if (nextLineIndexInOriginal > currentLine.length + originalIndex) {
        let j = nextLineIndexInOriginal - (currentLine.length + originalIndex);

        while (j > 0) {
          currentLine += " ";
          j--;
        }
      }
    }

    normalizedLines.push(currentLine);
    originalIndex = originalIndex + currentLine.length;
  }

  return normalizedLines.join("\n");
};

/** Scene bounds of the table cell a cell member sits in, or `null` when the
 * element isn't a direct member of a cell. The box is the visible (merged)
 * cell, so a match in a merged cell navigates to the whole cell. */
const getTableCellSceneBounds = (
  element: ExcalidrawTextElement,
  elementsMap: ElementsMap,
): Bounds | null => {
  const containerRef = element.containerRef;
  if (containerRef?.kind !== "tableCell") {
    return null;
  }

  const table = elementsMap.get(containerRef.elementId);
  if (!isTableElement(table)) {
    return null;
  }

  const bounds = getTableCellBounds(table.table, containerRef.cellId);
  if (!bounds) {
    return null;
  }

  return [
    table.x + bounds.x,
    table.y + bounds.y,
    table.x + bounds.x + bounds.width,
    table.y + bounds.y + bounds.height,
  ];
};

const getMatchedLines = (
  textElement: ExcalidrawTextElement,
  searchQuery: string,
  index: number,
) => {
  const normalizedText = normalizeWrappedText(
    getTextElementDisplayText(textElement),
    getTextElementText(textElement),
  );

  const lines = normalizedText.split("\n");

  const lineIndexRanges = [];
  let currentIndex = 0;
  let lineNumber = 0;

  for (const line of lines) {
    const startIndex = currentIndex;
    const endIndex = startIndex + line.length - 1;

    lineIndexRanges.push({
      line,
      startIndex,
      endIndex,
      lineNumber,
    });

    // Move to the next line's start index
    currentIndex = endIndex + 1;
    lineNumber++;
  }

  let startIndex = index;
  let remainingQuery = getTextElementText(textElement).slice(
    index,
    index + searchQuery.length,
  );
  const matchedLines: SearchMatch["matchedLines"] = [];

  for (const lineIndexRange of lineIndexRanges) {
    if (remainingQuery === "") {
      break;
    }

    if (
      startIndex >= lineIndexRange.startIndex &&
      startIndex <= lineIndexRange.endIndex
    ) {
      const matchCapacity = lineIndexRange.endIndex + 1 - startIndex;
      const textToStart = lineIndexRange.line.slice(
        0,
        startIndex - lineIndexRange.startIndex,
      );

      const matchedWord = remainingQuery.slice(0, matchCapacity);
      remainingQuery = remainingQuery.slice(matchCapacity);

      const lineHeight = getTextElementStyle(textElement).lineHeight;
      const offset = measureText(
        textToStart,
        getTextElementFont(textElement),
        lineHeight,
      );

      // measureText returns a non-zero width for the empty string
      // which is not what we're after here, hence the check and the correction
      if (textToStart === "") {
        offset.width = 0;
      }

      const { textAlign } = getTextElementStyle(textElement);
      if (textAlign !== "left" && lineIndexRange.line.length > 0) {
        const lineLength = measureText(
          lineIndexRange.line,
          getTextElementFont(textElement),
          lineHeight,
        );

        const spaceToStart =
          textAlign === "center"
            ? (textElement.width - lineLength.width) / 2
            : textElement.width - lineLength.width;
        offset.width += spaceToStart;
      }

      const { width, height } = measureText(
        matchedWord,
        getTextElementFont(textElement),
        lineHeight,
      );

      const offsetX = offset.width;
      const offsetY = lineIndexRange.lineNumber * offset.height;

      matchedLines.push({
        offsetX,
        offsetY,
        width,
        height,
        showOnCanvas: true,
      });

      startIndex += matchCapacity;
    }
  }

  return matchedLines;
};

/** 聚焦时用于定位匹配词的度量样式：标题、脑图正文、普通文字各有来源。 */
const getSearchMeasureStyle = (
  element:
    | ExcalidrawTextElement
    | ExcalidrawFrameLikeElement
    | ExcalidrawTableElement
    | ExcalidrawMindmapNodeElement,
) => {
  if (isFrameLikeElement(element) || isTableElement(element)) {
    return {
      fontSize: FRAME_STYLE.nameFontSize,
      fontFamily: FONT_FAMILY.Assistant,
    };
  }
  if (isMindmapNodeElement(element)) {
    const style =
      element.texts?.body?.style ?? getMindmapNodeTextStyle(element);
    return { fontSize: style.fontSize, fontFamily: style.fontFamily };
  }
  return getTextElementStyle(element);
};

const getMatchInElementTitle = (
  element: ExcalidrawFrameLikeElement | ExcalidrawTableElement,
  searchQuery: string,
  index: number,
  zoomValue: number,
): SearchMatch["matchedLines"] => {
  const text = getElementTitle(element);
  const matchedText = text.slice(index, index + searchQuery.length);

  const prefixText = text.slice(0, index);
  const font = getFontString({
    fontSize: FRAME_STYLE.nameFontSize,
    fontFamily: FONT_FAMILY.Assistant,
  });

  const lineHeight = getLineHeight(FONT_FAMILY.Assistant);

  const offset = measureText(prefixText, font, lineHeight);

  // Correct non-zero width for empty string
  if (prefixText === "") {
    offset.width = 0;
  }

  const matchedMetrics = measureText(matchedText, font, lineHeight);

  const offsetX = offset.width;
  const offsetY = -offset.height - FRAME_STYLE.strokeWidth;
  const width = matchedMetrics.width;

  return [
    {
      offsetX,
      offsetY,
      width,
      height: matchedMetrics.height,
      showOnCanvas: offsetX + width <= element.width * zoomValue,
    },
  ];
};

/** 脑图正文按区域布局合成只读文字元素，仅用于逐行测量。 */
const getMindmapMatchedLines = (
  node: ExcalidrawMindmapNodeElement,
  term: string,
  index: number,
): SearchMatch["matchedLines"] => {
  const body = node.texts?.body;
  const layout = body ? getTextRegionLayout(node, "body") : null;
  if (!body || !layout) {
    return [];
  }
  const synthetic: ExcalidrawTextElement = {
    ...node,
    type: "text",
    texts: {
      body: {
        text: body.text,
        style: {
          fontFamily: layout.fontFamily,
          fontSize: layout.fontSize,
          ...(layout.fontWeight !== undefined
            ? { fontWeight: layout.fontWeight }
            : {}),
          lineHeight: layout.lineHeight,
          textAlign: layout.textAlign,
          verticalAlign: layout.verticalAlign,
          color: layout.color,
        },
      },
    },
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    autoResize: false,
  };
  // 区域布局是场景坐标：换算回节点原点的偏移，聚焦时再叠加节点位置
  return getMatchedLines(synthetic, term, index).map((line) => ({
    ...line,
    offsetX: line.offsetX + layout.x - node.x,
    offsetY: line.offsetY + layout.y - node.y,
  }));
};

const handleSearch = debounce(
  (
    terms: readonly string[],
    match: "any" | "all",
    app: AppClassProperties,
    focusFirst: boolean,
    cb: (matchItems: SearchMatchItem[], focusIndex: number | null) => void,
  ) => {
    if (!terms.length) {
      cb([], null);
      return;
    }

    const elements = app.scene.getNonDeletedElements();
    const hiddenIds = app.scene.getMindmapHiddenElementIds();
    const { hits } = searchSceneElements(
      elements,
      terms,
      { match, includeHidden: true },
      { hiddenIds },
    );

    const outlines = getMindmapOutlines(elements);
    const outlinesByGraphId = new Map(
      outlines.map((outline) => [outline.graphId, outline]),
    );

    const frameMatches: SearchMatchItem[] = [];
    const tableMatches: SearchMatchItem[] = [];
    const textMatches: SearchMatchItem[] = [];
    const seenMindmapNodeIds = new Set<string>();

    for (const hit of hits) {
      const element = hit.element;
      const hidden = hiddenIds.has(element.id);

      // 脑图节点按节点去重，同一节点的重复出现只保留第一处
      if (isMindmapNodeElement(element)) {
        if (seenMindmapNodeIds.has(element.id)) {
          continue;
        }
        seenMindmapNodeIds.add(element.id);
      }

      let matchedLines: SearchMatch["matchedLines"] = [];

      if (isTextElement(element) && hit.regionKey === "body") {
        matchedLines = getMatchedLines(element, hit.term, hit.index);
      } else if (
        (isFrameLikeElement(element) || isTableElement(element)) &&
        hit.regionKey === "title"
      ) {
        matchedLines = getMatchInElementTitle(
          element,
          hit.term,
          hit.index,
          app.state.zoom.value,
        );
      } else if (isMindmapNodeElement(element) && hit.regionKey === "body") {
        matchedLines = getMindmapMatchedLines(element, hit.term, hit.index);
      }

      if (hidden) {
        matchedLines = matchedLines.map((line) => ({
          ...line,
          showOnCanvas: false,
        }));
      }

      const outline = isMindmapNodeElement(element)
        ? outlinesByGraphId.get(element.graphId)
        : undefined;

      const item: SearchMatchItem = {
        element,
        regionKey: hit.regionKey,
        term: hit.term,
        index: hit.index,
        preview: getMatchPreview(hit.text, hit.index, hit.term),
        matchedLines,
        ...(hidden ? { hidden: true } : {}),
        mindmap:
          outline && isMindmapNodeElement(element)
            ? {
                nodeId: element.id,
                graphTitle: outline.title,
                graphNumber: outline.number,
                path: getMindmapPath(outline, element),
              }
            : undefined,
      };

      if (isFrameLikeElement(element)) {
        frameMatches.push(item);
      } else if (isTableElement(element)) {
        tableMatches.push(item);
      } else {
        textMatches.push(item);
      }
    }

    // 组内按 y 排序，同元素的多条命中保持命中顺序
    const byY = (a: SearchMatchItem, b: SearchMatchItem) =>
      a.element.y - b.element.y;
    frameMatches.sort(byY);
    tableMatches.sort(byY);
    textMatches.sort(byY);

    const visibleIds = new Set(
      app.visibleElements.map((visibleElement) => visibleElement.id),
    );

    const matchItems: SearchMatchItem[] = [
      ...frameMatches,
      ...tableMatches,
      ...textMatches,
    ];

    const visibleIndex = matchItems.findIndex((matchItem) =>
      visibleIds.has(matchItem.element.id),
    );
    const focusIndex = focusFirst && visibleIndex >= 0 ? visibleIndex : null;

    cb(matchItems, focusIndex);
  },
  SEARCH_DEBOUNCE,
);
