import { pointFrom, type GlobalPoint } from "@excalidraw/math";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { EVENT, HYPERLINK_TOOLTIP_DELAY, KEYS } from "@excalidraw/common";

import { getElementAbsoluteCoords } from "@excalidraw/element";

import { hitElementBoundingBox } from "@excalidraw/element";

import { isElementLink } from "@excalidraw/element";

import { getEmbedLink, embeddableURLValidator } from "@excalidraw/element";

import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
  wrapEvent,
  isLocalLink,
  normalizeLink,
} from "@excalidraw/common";

import { isEmbeddableElement } from "@excalidraw/element";

import type { Scene } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawEmbeddableElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { trackEvent } from "../../analytics";
import { getTooltipDiv, updateTooltipPosition } from "../../components/Tooltip";

import { t } from "../../i18n";

import { useAppProps, useEditorInterface, useExcalidrawAppState } from "../App";
import { LinkIcon, TrashIcon, chevronDownIcon, pencilIcon } from "../icons";
import { getSelectedElements } from "../../scene";
import { markPropertiesPopoverEscClose } from "../PropertiesPopover";

import { getLinkHandleFromCoords } from "./helpers";

import "./Hyperlink.scss";

import type { AppState, ExcalidrawProps, UIAppState } from "../../types";

// 元素锚定卡片（手机 / 只读·查看模式悬停）的定位与悬停隐藏量测常量；
// 桌面/平板的链接弹层锚定浮动栏「链接」按钮（Actions.tsx FloatbarLinkAction）
const POPUP_WIDTH = 252;
const POPUP_HEIGHT = 132;
const SPACE_BOTTOM = 140;
const AUTO_HIDE_TIMEOUT = 500;

let IS_HYPERLINK_TOOLTIP_VISIBLE = false;

const embeddableLinkCache = new Map<
  ExcalidrawEmbeddableElement["id"],
  string
>();

/** 访问态的链接显示文本：域名 + 路径（元素内链接显示「前往目标元素」） */
export const getDisplayLink = (link: string): string => {
  if (isElementLink(link)) {
    return t("labels.link.goToElement");
  }
  try {
    const url = new URL(normalizeLink(link));
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}${
      url.search
    }${url.hash}`;
  } catch {
    return link;
  }
};

type HyperlinkContentProps = {
  element: NonDeletedExcalidrawElement;
  scene: Scene;
  setAppState: React.Component<any, AppState>["setState"];
  onLinkOpen: ExcalidrawProps["onLinkOpen"];
  setToast: (
    toast: { message: string; closable?: boolean; duration?: number } | null,
  ) => void;
  updateEmbedValidationStatus: (
    element: ExcalidrawEmbeddableElement,
    status: boolean,
  ) => void;
  /** 只读/查看模式：访问态不显示「编辑」入口 */
  readOnly?: boolean;
};

/**
 * 链接弹层内容（设计稿「链接弹层与联动态」）：编辑态 = URL 输入 +
 * 「链接到元素…」+ 移除/保存；访问态 = 链接图标 + 域名文本 + 编辑/访问。
 * 桌面/平板由浮动栏「链接」按钮向下弹出（tb-pop），手机与只读/查看模式
 * 由元素锚定卡片（Hyperlink）承载，内容同源。
 */
export const HyperlinkContent = ({
  element,
  scene,
  setAppState,
  onLinkOpen,
  setToast,
  updateEmbedValidationStatus,
  readOnly = false,
}: HyperlinkContentProps) => {
  const appState = useExcalidrawAppState();
  const appProps = useAppProps();
  const editorInterface = useEditorInterface();

  const linkVal = element.link || "";

  const [inputVal, setInputVal] = useState(linkVal);
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditing = appState.showHyperlinkPopup === "editor";

  const handleSubmit = useCallback(() => {
    if (!inputRef.current) {
      return;
    }

    const link = normalizeLink(inputRef.current.value) || null;

    if (!element.link && link) {
      trackEvent("hyperlink", "create");
    }

    if (isEmbeddableElement(element)) {
      if (appState.activeEmbeddable?.element === element) {
        setAppState({ activeEmbeddable: null });
      }
      if (!link) {
        scene.mutateElement(element, {
          link: null,
        });
        updateEmbedValidationStatus(element, false);
        return;
      }

      if (!embeddableURLValidator(link, appProps.validateEmbeddable)) {
        if (link) {
          setToast({ message: t("toast.unableToEmbed"), closable: true });
        }
        element.link && embeddableLinkCache.set(element.id, element.link);
        scene.mutateElement(element, {
          link,
        });
        updateEmbedValidationStatus(element, false);
      } else {
        const { width, height } = element;
        const embedLink = getEmbedLink(link);
        if (embedLink?.error instanceof URIError) {
          setToast({
            message: t("toast.unrecognizedLinkFormat"),
            closable: true,
          });
        }
        const ar = embedLink
          ? embedLink.intrinsicSize.w / embedLink.intrinsicSize.h
          : 1;
        const hasLinkChanged =
          embeddableLinkCache.get(element.id) !== element.link;
        scene.mutateElement(element, {
          ...(hasLinkChanged
            ? {
                width:
                  embedLink?.type === "video"
                    ? width > height
                      ? width
                      : height * ar
                    : width,
                height:
                  embedLink?.type === "video"
                    ? width > height
                      ? width / ar
                      : height
                    : height,
              }
            : {}),
          link,
        });
        updateEmbedValidationStatus(element, true);
        if (embeddableLinkCache.has(element.id)) {
          embeddableLinkCache.delete(element.id);
        }
      }
    } else {
      scene.mutateElement(element, { link });
    }
  }, [
    element,
    scene,
    setToast,
    appProps.validateEmbeddable,
    appState.activeEmbeddable,
    setAppState,
    updateEmbedValidationStatus,
  ]);

  // 关闭/切换弹层时提交当前输入（保持既有「点击外部即保存」行为）
  useLayoutEffect(() => {
    return () => {
      handleSubmit();
    };
  }, [handleSubmit]);

  useEffect(() => {
    if (
      isEditing &&
      inputRef?.current &&
      !(editorInterface.formFactor === "phone" || editorInterface.isTouchScreen)
    ) {
      inputRef.current.select();
    }
  }, [isEditing, editorInterface.formFactor, editorInterface.isTouchScreen]);

  const handleRemove = useCallback(() => {
    trackEvent("hyperlink", "delete");
    scene.mutateElement(element, { link: null });
    setAppState({ showHyperlinkPopup: false });
  }, [setAppState, element, scene]);

  const onEdit = () => {
    trackEvent("hyperlink", "edit", "popup-ui");
    setAppState({ showHyperlinkPopup: "editor" });
  };

  const handleSave = () => {
    handleSubmit();
    const link = normalizeLink(inputRef.current?.value ?? inputVal) || null;
    // 保存后：有链接回访问态，无链接直接关闭
    setAppState({ showHyperlinkPopup: link ? "info" : false });
  };

  if (isEditing) {
    return (
      <>
        <div className="tb-pop-title">
          {isEmbeddableElement(element)
            ? t("labels.link.editEmbed")
            : t("labels.link.edit")}
        </div>
        <div className="excalidraw-hyperlink__row">
          <input
            className={clsx("tb-input", "excalidraw-hyperlink__input")}
            placeholder={t("labels.link.hint")}
            ref={inputRef}
            value={inputVal}
            onChange={(event) => setInputVal(event.target.value)}
            autoFocus
            onKeyDown={(event) => {
              event.stopPropagation();
              // prevent cmd/ctrl+k shortcut when editing link
              if (event[KEYS.CTRL_OR_CMD] && event.key === KEYS.K) {
                event.preventDefault();
              }
              if (event.key === KEYS.ENTER) {
                handleSave();
              }
              if (event.key === KEYS.ESCAPE) {
                // Esc 关闭弹层、焦点回「链接」按钮；输入经卸载提交保留
                markPropertiesPopoverEscClose();
                setAppState({ showHyperlinkPopup: false });
              }
            }}
          />
        </div>
        <div className="excalidraw-hyperlink__row">
          <button
            type="button"
            className="tb-select excalidraw-hyperlink__linkto"
            title={t("labels.linkToElement")}
            aria-label={t("labels.linkToElement")}
            onClick={() => {
              setAppState({
                openDialog: {
                  name: "elementLinkSelector",
                  sourceElementId: element.id,
                },
              });
            }}
          >
            <span>{t("labels.linkToElement")}</span>
            {chevronDownIcon}
          </button>
        </div>
        <div className="excalidraw-hyperlink__actions">
          {linkVal && !isEmbeddableElement(element) && (
            <button
              type="button"
              className="tb-iconbtn"
              title={t("buttons.remove")}
              aria-label={t("buttons.remove")}
              onClick={handleRemove}
            >
              {TrashIcon}
            </button>
          )}
          <button type="button" className="tb-btn-primary" onClick={handleSave}>
            {t("labels.link.save")}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="tb-pop-title">{t("labels.link.label")}</div>
      <div className="excalidraw-hyperlink__row">
        <span
          className="tb-iconbtn is-on excalidraw-hyperlink__linkicon"
          aria-hidden="true"
        >
          {LinkIcon}
        </span>
        <span className="excalidraw-hyperlink__domain" title={linkVal}>
          {linkVal ? getDisplayLink(linkVal) : t("labels.link.empty")}
        </span>
      </div>
      <div className="excalidraw-hyperlink__actions">
        {!readOnly && (
          <button
            type="button"
            className="tb-iconbtn"
            title={t("buttons.edit")}
            aria-label={t("buttons.edit")}
            onClick={onEdit}
          >
            {pencilIcon}
          </button>
        )}
        {linkVal && (
          <a
            href={normalizeLink(linkVal)}
            className="tb-btn-primary excalidraw-hyperlink__visit"
            target={isLocalLink(linkVal) ? "_self" : "_blank"}
            onClick={(event) => {
              if (linkVal && onLinkOpen) {
                const customEvent = wrapEvent(
                  EVENT.EXCALIDRAW_LINK,
                  event.nativeEvent,
                );
                onLinkOpen(
                  {
                    ...element,
                    link: normalizeLink(linkVal),
                  },
                  customEvent,
                );
                if (customEvent.defaultPrevented) {
                  event.preventDefault();
                }
              }
            }}
            rel="noopener noreferrer"
          >
            {t("labels.link.visit")}
          </a>
        )}
      </div>
    </>
  );
};

/**
 * 元素锚定的链接卡片：手机（T5 前的过渡形态）与只读/查看模式悬停。
 * 桌面/平板编辑态不渲染——链接弹层锚定浮动栏「链接」按钮
 * （components/Actions.tsx 的 FloatbarLinkAction）。
 */
export const Hyperlink = ({
  element,
  scene,
  setAppState,
  onLinkOpen,
  setToast,
  updateEmbedValidationStatus,
}: {
  element: NonDeletedExcalidrawElement;
  scene: Scene;
  setAppState: React.Component<any, AppState>["setState"];
  onLinkOpen: ExcalidrawProps["onLinkOpen"];
  setToast: (
    toast: { message: string; closable?: boolean; duration?: number } | null,
  ) => void;
  updateEmbedValidationStatus: (
    element: ExcalidrawEmbeddableElement,
    status: boolean,
  ) => void;
}) => {
  const elementsMap = scene.getNonDeletedElementsMap();
  const appState = useExcalidrawAppState();
  const isEditing = appState.showHyperlinkPopup === "editor";

  // 悬停离场自动隐藏（查看模式悬停 / 手机元素锚定卡片）
  useEffect(() => {
    let timeoutId: number | null = null;

    const handlePointerMove = (event: PointerEvent) => {
      if (isEditing) {
        return;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      const shouldHide = shouldHideLinkPopup(
        element,
        elementsMap,
        appState,
        pointFrom(event.clientX, event.clientY),
      ) as boolean;
      if (shouldHide) {
        timeoutId = window.setTimeout(() => {
          setAppState({ showHyperlinkPopup: false });
        }, AUTO_HIDE_TIMEOUT);
      }
    };
    window.addEventListener(EVENT.POINTER_MOVE, handlePointerMove, false);
    return () => {
      window.removeEventListener(EVENT.POINTER_MOVE, handlePointerMove, false);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [appState, element, isEditing, setAppState, elementsMap]);

  const { x, y } = getCoordsForPopover(element, appState, elementsMap);
  if (
    appState.contextMenu ||
    appState.selectedElementsAreBeingDragged ||
    appState.resizingElement ||
    appState.isRotating ||
    appState.openMenu
  ) {
    return null;
  }

  return (
    <div
      className="excalidraw-hyperlinkContainer"
      style={{
        top: `${y}px`,
        left: `${x}px`,
        width: POPUP_WIDTH,
      }}
    >
      <HyperlinkContent
        element={element}
        scene={scene}
        setAppState={setAppState}
        onLinkOpen={onLinkOpen}
        setToast={setToast}
        updateEmbedValidationStatus={updateEmbedValidationStatus}
        readOnly={appState.viewModeEnabled}
      />
    </div>
  );
};

const getCoordsForPopover = (
  element: NonDeletedExcalidrawElement,
  appState: AppState,
  elementsMap: ElementsMap,
) => {
  const [x1, y1] = getElementAbsoluteCoords(element, elementsMap);
  const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
    { sceneX: x1 + element.width / 2, sceneY: y1 },
    appState,
  );
  const x = viewportX - appState.offsetLeft - POPUP_WIDTH / 2;
  const y = viewportY - appState.offsetTop - SPACE_BOTTOM;
  return { x, y };
};

export const getContextMenuLabel = (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: UIAppState,
) => {
  const selectedElements = getSelectedElements(elements, appState);
  const label = isEmbeddableElement(selectedElements[0])
    ? "labels.link.editEmbed"
    : selectedElements[0]?.link
    ? "labels.link.edit"
    : "labels.link.create";
  return label;
};

let HYPERLINK_TOOLTIP_TIMEOUT_ID: number | null = null;
export const showHyperlinkTooltip = (
  element: NonDeletedExcalidrawElement,
  appState: AppState,
  elementsMap: ElementsMap,
) => {
  if (HYPERLINK_TOOLTIP_TIMEOUT_ID) {
    clearTimeout(HYPERLINK_TOOLTIP_TIMEOUT_ID);
  }
  HYPERLINK_TOOLTIP_TIMEOUT_ID = window.setTimeout(
    () => renderTooltip(element, appState, elementsMap),
    HYPERLINK_TOOLTIP_DELAY,
  );
};

const renderTooltip = (
  element: NonDeletedExcalidrawElement,
  appState: AppState,
  elementsMap: ElementsMap,
) => {
  if (!element.link) {
    return;
  }

  const tooltipDiv = getTooltipDiv();

  tooltipDiv.classList.add("excalidraw-tooltip--visible");
  tooltipDiv.style.maxWidth = "20rem";
  tooltipDiv.textContent = isElementLink(element.link)
    ? t("labels.link.goToElement")
    : element.link;

  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);

  const [linkX, linkY, linkWidth, linkHeight] = getLinkHandleFromCoords(
    [x1, y1, x2, y2],
    element.angle,
    appState,
  );

  const linkViewportCoords = sceneCoordsToViewportCoords(
    { sceneX: linkX, sceneY: linkY },
    appState,
  );

  updateTooltipPosition(
    tooltipDiv,
    {
      left: linkViewportCoords.x,
      top: linkViewportCoords.y,
      width: linkWidth,
      height: linkHeight,
    },
    "top",
  );
  trackEvent("hyperlink", "tooltip", "link-icon");

  IS_HYPERLINK_TOOLTIP_VISIBLE = true;
};
export const hideHyperlinkToolip = () => {
  if (HYPERLINK_TOOLTIP_TIMEOUT_ID) {
    clearTimeout(HYPERLINK_TOOLTIP_TIMEOUT_ID);
  }
  if (IS_HYPERLINK_TOOLTIP_VISIBLE) {
    IS_HYPERLINK_TOOLTIP_VISIBLE = false;
    getTooltipDiv().classList.remove("excalidraw-tooltip--visible");
  }
};

const shouldHideLinkPopup = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  appState: AppState,
  [clientX, clientY]: GlobalPoint,
): Boolean => {
  const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
    { clientX, clientY },
    appState,
  );

  const threshold = 15 / appState.zoom.value;
  // hitbox to prevent hiding when hovered in element bounding box
  if (hitElementBoundingBox(pointFrom(sceneX, sceneY), element, elementsMap)) {
    return false;
  }
  const [x1, y1, x2] = getElementAbsoluteCoords(element, elementsMap);
  // hit box to prevent hiding when hovered in the vertical area between element and popover
  if (
    sceneX >= x1 &&
    sceneX <= x2 &&
    sceneY >= y1 - SPACE_BOTTOM &&
    sceneY <= y1
  ) {
    return false;
  }
  // hit box to prevent hiding when hovered around popover within threshold
  const { x: popoverX, y: popoverY } = getCoordsForPopover(
    element,
    appState,
    elementsMap,
  );

  if (
    clientX >= popoverX - threshold &&
    clientX <= popoverX + POPUP_WIDTH + threshold &&
    clientY >= popoverY - threshold &&
    clientY <= popoverY + threshold + POPUP_HEIGHT
  ) {
    return false;
  }
  return true;
};
