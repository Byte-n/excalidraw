import clsx from "clsx";
import debounce from "lodash.debounce";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";

import {
  CLASSES,
  EVENT,
  FONT_FAMILY,
  FRAME_STYLE,
  getLineHeight,
} from "@excalidraw/common";

import {
  getCommonBounds,
  isElementCompletelyInViewport,
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

import { getDefaultFrameName } from "@excalidraw/element/frame";

import type {
  ExcalidrawFrameLikeElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { atom, useAtom } from "../editor-jotai";

import { useStable } from "../hooks/useStable";
import { useSceneNonce } from "../hooks/useSceneNonce";
import { t } from "../i18n";

import { useApp, useExcalidrawSetAppState } from "./App";
import { Button } from "./Button";
import { TextField } from "./TextField";
import { getMindmapOutlines, getMindmapPath } from "./mindmapOutlineModel";
import {
  collapseDownIcon,
  upIcon,
  searchIcon,
  frameToolIcon,
  TextIcon,
} from "./icons";

import "./SearchMenu.scss";

import type { AppClassProperties, SearchMatch } from "../types";

const searchQueryAtom = atom<string>("");
export const searchItemInFocusAtom = atom<number | null>(null);

const SEARCH_DEBOUNCE = 350;

type SearchMatchItem = {
  element: ExcalidrawTextElement | ExcalidrawFrameLikeElement;
  searchQuery: SearchQuery;
  index: number;
  preview: {
    indexInSearchQuery: number;
    previewText: string;
    moreBefore: boolean;
    moreAfter: boolean;
  };
  matchedLines: SearchMatch["matchedLines"];
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

type SearchQuery = string & { _brand: "SearchQuery" };

export const SearchMenu = () => {
  const app = useApp();
  const setAppState = useExcalidrawSetAppState();

  const searchInputRef = useRef<HTMLInputElement>(null);

  const [inputValue, setInputValue] = useAtom(searchQueryAtom);
  const searchQuery = inputValue.trim() as SearchQuery;

  const [isSearching, setIsSearching] = useState(false);

  const [searchMatches, setSearchMatches] = useState<SearchMatches>({
    nonce: null,
    items: [],
  });
  const searchedQueryRef = useRef<SearchQuery | null>(null);
  const lastSceneNonceRef = useRef<number | undefined>(undefined);
  const focusedMatchRef = useRef<string | null>(null);

  const [focusIndex, setFocusIndex] = useAtom(searchItemInFocusAtom);
  const sceneNonce = useSceneNonce(app.scene);
  const elementsMap = app.scene.getNonDeletedElementsMap();

  useEffect(() => {
    if (isSearching) {
      return;
    }
    if (
      searchQuery !== searchedQueryRef.current ||
      sceneNonce !== lastSceneNonceRef.current
    ) {
      searchedQueryRef.current = null;
      handleSearch(searchQuery, app, (matchItems, index) => {
        const retainedIndex = focusedMatchRef.current
          ? matchItems.findIndex(
              (item) => item.element.id === focusedMatchRef.current,
            )
          : -1;
        setSearchMatches({
          nonce: randomInteger(),
          items: matchItems,
        });
        searchedQueryRef.current = searchQuery;
        lastSceneNonceRef.current = app.scene.getSceneNonce();
        setFocusIndex(retainedIndex >= 0 ? retainedIndex : null);
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
      });
    }
  }, [
    isSearching,
    searchQuery,
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
  }, [focusIndex, setAppState]);

  useEffect(() => {
    focusedMatchRef.current =
      focusIndex !== null
        ? searchMatches.items[focusIndex]?.element.id ?? null
        : null;
  }, [focusIndex, searchMatches]);

  useEffect(() => {
    if (searchMatches.items.length > 0 && focusIndex !== null) {
      const match = searchMatches.items[focusIndex];

      if (match) {
        const currentElement = app.scene.getNonDeletedElement(match.element.id);
        if (
          !currentElement ||
          (!isTextElement(currentElement) &&
            !isFrameLikeElement(currentElement))
        ) {
          return;
        }
        const focusedNode = match.mindmap
          ? app.scene.getNonDeletedElement(match.mindmap.nodeId)
          : null;
        if (
          match.mindmap &&
          (!focusedNode ||
            app.scene.getMindmapHiddenElementIds().has(focusedNode.id))
        ) {
          return;
        }
        const zoomValue = app.state.zoom.value;

        const matchAsElement = newTextElement({
          text: match.searchQuery,
          x: currentElement.x + (match.matchedLines[0]?.offsetX ?? 0),
          y: currentElement.y + (match.matchedLines[0]?.offsetY ?? 0),
          width: match.matchedLines[0]?.width,
          height: match.matchedLines[0]?.height,
          fontSize: isFrameLikeElement(currentElement)
            ? FRAME_STYLE.nameFontSize
            : currentElement.fontSize,
          fontFamily: isFrameLikeElement(currentElement)
            ? FONT_FAMILY.Assistant
            : currentElement.fontFamily,
        });

        const FONT_SIZE_LEGIBILITY_THRESHOLD = 14;

        const fontSize = matchAsElement.fontSize;
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
  }, [focusIndex, searchMatches, app]);

  useEffect(() => {
    return () => {
      setFocusIndex(null);
      searchedQueryRef.current = null;
      lastSceneNonceRef.current = undefined;
      setAppState({
        searchMatches: null,
      });
      setIsSearching(false);
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
  }, [setAppState, stableState, app]);

  const matchCount = `${searchMatches.items.length} ${
    searchMatches.items.length === 1
      ? t("search.singleResult")
      : t("search.multipleResults")
  }`;

  return (
    <div className="layer-ui__search">
      <div className="layer-ui__search-header">
        <TextField
          className={CLASSES.SEARCH_MENU_INPUT_WRAPPER}
          value={inputValue}
          ref={searchInputRef}
          placeholder={t("search.placeholder")}
          icon={searchIcon}
          onChange={(value) => {
            setInputValue(value);
            setIsSearching(true);
            focusedMatchRef.current = null;
            const searchQuery = value.trim() as SearchQuery;
            handleSearch(searchQuery, app, (matchItems, index) => {
              setSearchMatches({
                nonce: randomInteger(),
                items: matchItems,
              });
              setFocusIndex(index);
              searchedQueryRef.current = searchQuery;
              lastSceneNonceRef.current = app.scene.getSceneNonce();
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
            });
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
            const text = app.scene.getNonDeletedElement(match.element.id);
            if (
              !node ||
              !isMindmapNodeElement(node) ||
              !text ||
              text.type !== "text" ||
              text.containerId !== node.id ||
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
        searchQuery={searchQuery}
      />
    </div>
  );
};

const ListItem = (props: {
  preview: SearchMatchItem["preview"];
  searchQuery: SearchQuery;
  highlighted: boolean;
  mindmap?: SearchMatchItem["mindmap"];
  onClick?: () => void;
}) => {
  const preview = [
    props.preview.moreBefore ? "..." : "",
    props.preview.previewText.slice(0, props.preview.indexInSearchQuery),
    props.preview.previewText.slice(
      props.preview.indexInSearchQuery,
      props.preview.indexInSearchQuery + props.searchQuery.length,
    ),
    props.preview.previewText.slice(
      props.preview.indexInSearchQuery + props.searchQuery.length,
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
  searchQuery: SearchQuery;
}

const MatchListBase = (props: MatchListProps) => {
  const frameNameMatches = useMemo(
    () =>
      props.matches.items.filter((match) => isFrameLikeElement(match.element)),
    [props.matches],
  );

  const textMatches = useMemo(
    () => props.matches.items.filter((match) => isTextElement(match.element)),
    [props.matches],
  );

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
              key={searchMatch.element.id + searchMatch.index}
              searchQuery={props.searchQuery}
              preview={searchMatch.preview}
              mindmap={searchMatch.mindmap}
              highlighted={index === props.focusIndex}
              onClick={() => props.onItemClick(index)}
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
              key={searchMatch.element.id + searchMatch.index}
              searchQuery={props.searchQuery}
              preview={searchMatch.preview}
              mindmap={searchMatch.mindmap}
              highlighted={index + frameNameMatches.length === props.focusIndex}
              onClick={() => props.onItemClick(index + frameNameMatches.length)}
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

const getMatchPreview = (
  text: string,
  index: number,
  searchQuery: SearchQuery,
) => {
  const WORDS_BEFORE = 2;
  const WORDS_AFTER = 5;

  const substrBeforeQuery = text.slice(0, index);
  const wordsBeforeQuery = substrBeforeQuery.split(/\s+/);
  // text = "small", query = "mall", not complete before
  // text = "small", query = "smal", complete before
  const isQueryCompleteBefore = substrBeforeQuery.endsWith(" ");
  const startWordIndex =
    wordsBeforeQuery.length -
    WORDS_BEFORE -
    1 -
    (isQueryCompleteBefore ? 0 : 1);
  let wordsBeforeAsString =
    wordsBeforeQuery.slice(startWordIndex <= 0 ? 0 : startWordIndex).join(" ") +
    (isQueryCompleteBefore ? " " : "");

  const MAX_ALLOWED_CHARS = 20;

  wordsBeforeAsString =
    wordsBeforeAsString.length > MAX_ALLOWED_CHARS
      ? wordsBeforeAsString.slice(-MAX_ALLOWED_CHARS)
      : wordsBeforeAsString;

  const substrAfterQuery = text.slice(index + searchQuery.length);
  const wordsAfter = substrAfterQuery.split(/\s+/);
  // text = "small", query = "mall", complete after
  // text = "small", query = "smal", not complete after
  const isQueryCompleteAfter = !substrAfterQuery.startsWith(" ");
  const numberOfWordsToTake = isQueryCompleteAfter
    ? WORDS_AFTER + 1
    : WORDS_AFTER;
  const wordsAfterAsString =
    (isQueryCompleteAfter ? "" : " ") +
    wordsAfter.slice(0, numberOfWordsToTake).join(" ");

  return {
    indexInSearchQuery: wordsBeforeAsString.length,
    previewText: wordsBeforeAsString + searchQuery + wordsAfterAsString,
    moreBefore: startWordIndex > 0,
    moreAfter: wordsAfter.length > numberOfWordsToTake,
  };
};

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

const getMatchedLines = (
  textElement: ExcalidrawTextElement,
  searchQuery: SearchQuery,
  index: number,
) => {
  const normalizedText = normalizeWrappedText(
    textElement.text,
    textElement.originalText,
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
  let remainingQuery = textElement.originalText.slice(
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

      const offset = measureText(
        textToStart,
        getFontString(textElement),
        textElement.lineHeight,
      );

      // measureText returns a non-zero width for the empty string
      // which is not what we're after here, hence the check and the correction
      if (textToStart === "") {
        offset.width = 0;
      }

      if (textElement.textAlign !== "left" && lineIndexRange.line.length > 0) {
        const lineLength = measureText(
          lineIndexRange.line,
          getFontString(textElement),
          textElement.lineHeight,
        );

        const spaceToStart =
          textElement.textAlign === "center"
            ? (textElement.width - lineLength.width) / 2
            : textElement.width - lineLength.width;
        offset.width += spaceToStart;
      }

      const { width, height } = measureText(
        matchedWord,
        getFontString(textElement),
        textElement.lineHeight,
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

const getMatchInFrame = (
  frame: ExcalidrawFrameLikeElement,
  searchQuery: SearchQuery,
  index: number,
  zoomValue: number,
): SearchMatch["matchedLines"] => {
  const text = frame.name ?? getDefaultFrameName(frame);
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
      showOnCanvas: offsetX + width <= frame.width * zoomValue,
    },
  ];
};

const escapeSpecialCharacters = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
};

const handleSearch = debounce(
  (
    searchQuery: SearchQuery,
    app: AppClassProperties,
    cb: (matchItems: SearchMatchItem[], focusIndex: number | null) => void,
  ) => {
    if (!searchQuery || searchQuery === "") {
      cb([], null);
      return;
    }

    const elements = app.scene.getNonDeletedElements();
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const hiddenIds = app.scene.getMindmapHiddenElementIds();
    const outlines = getMindmapOutlines(elements);
    const outlinesByGraphId = new Map(
      outlines.map((outline) => [outline.graphId, outline]),
    );
    const texts = elements.filter((el) =>
      isTextElement(el),
    ) as ExcalidrawTextElement[];

    const frames = elements.filter((el) =>
      isFrameLikeElement(el),
    ) as ExcalidrawFrameLikeElement[];

    texts.sort((a, b) => a.y - b.y);
    frames.sort((a, b) => a.y - b.y);

    const textMatches: SearchMatchItem[] = [];

    const regex = new RegExp(escapeSpecialCharacters(searchQuery), "gi");

    for (const textEl of texts) {
      let match = null;
      const text = textEl.originalText;
      const container = textEl.containerId
        ? elementsMap.get(textEl.containerId)
        : null;
      const node =
        container && isMindmapNodeElement(container) ? container : null;
      const outline = node ? outlinesByGraphId.get(node.graphId) : null;

      while ((match = regex.exec(text)) !== null) {
        const preview = getMatchPreview(text, match.index, searchQuery);
        const matchedLines = getMatchedLines(textEl, searchQuery, match.index);

        if (matchedLines.length > 0) {
          if (node && hiddenIds.has(node.id)) {
            matchedLines.forEach((line) => {
              line.showOnCanvas = false;
            });
          }
          textMatches.push({
            element: textEl,
            searchQuery,
            preview,
            index: match.index,
            matchedLines,
            mindmap:
              node && outline
                ? {
                    nodeId: node.id,
                    graphTitle: outline.title,
                    graphNumber: outline.number,
                    path: getMindmapPath(outline, node),
                  }
                : undefined,
          });
          if (node) {
            break;
          }
        }
      }
    }

    const frameMatches: SearchMatchItem[] = [];

    for (const frame of frames) {
      let match = null;
      const name = frame.name ?? getDefaultFrameName(frame);

      while ((match = regex.exec(name)) !== null) {
        const preview = getMatchPreview(name, match.index, searchQuery);
        const matchedLines = getMatchInFrame(
          frame,
          searchQuery,
          match.index,
          app.state.zoom.value,
        );

        if (matchedLines.length > 0) {
          frameMatches.push({
            element: frame,
            searchQuery,
            preview,
            index: match.index,
            matchedLines,
          });
        }
      }
    }

    const visibleIds = new Set(
      app.visibleElements.map((visibleElement) => visibleElement.id),
    );

    // putting frame matches first
    const matchItems: SearchMatchItem[] = [...frameMatches, ...textMatches];

    const visibleIndex = matchItems.findIndex((matchItem) =>
      visibleIds.has(matchItem.element.id),
    );
    const focusIndex = visibleIndex >= 0 ? visibleIndex : null;

    cb(matchItems, focusIndex);
  },
  SEARCH_DEBOUNCE,
);
