import {
  applyDarkModeFilter,
  CLASSES,
  FRAME_STYLE,
  KEYS,
  sceneCoordsToViewportCoords,
  THEME,
} from "@excalidraw/common";
import {
  getElementTitle,
  getRenderElementWithPositionOverride,
  isElementInViewport,
  isTitledElement,
} from "@excalidraw/element";

import type { ExcalidrawTitledElement } from "@excalidraw/element/types";

import {
  getElementTitleLayout,
  getElementTitleOffsetY,
} from "../../renderer/elementTitle";

import type { ElementTitleBoundsCache } from "../../types";
import type App from "../App";

const ELEMENT_TITLE_EDIT_PADDING = 6;

export class AppElementTitles {
  constructor(private app: App) {}

  private getElementTitleEnabled = () =>
    this.app.state.frameRendering.enabled && this.app.state.frameRendering.name;

  elementTitleBoundsCache: ElementTitleBoundsCache = {
    get: (element) => {
      if (!this.getElementTitleEnabled()) {
        return null;
      }
      let bounds = this.elementTitleBoundsCache._cache.get(element.id);
      if (
        !bounds ||
        bounds.zoom !== this.app.state.zoom.value ||
        bounds.versionNonce !== element.versionNonce
      ) {
        const layout = getElementTitleLayout(element, {
          zoom: this.app.state.zoom.value,
        });
        bounds = {
          x: layout.x,
          y: layout.y,
          width: layout.width,
          height: layout.height,
          zoom: this.app.state.zoom.value,
          versionNonce: element.versionNonce,
        };
        this.elementTitleBoundsCache._cache.set(element.id, bounds);
      }
      return bounds;
    },
    /**
     * @private
     */
    _cache: new Map(),
  };

  /** Topmost titled element whose title layout contains the point. */
  public hitTestElementTitle = (
    sceneX: number,
    sceneY: number,
  ): ExcalidrawTitledElement | null => {
    if (!this.getElementTitleEnabled() || this.app.state.viewModeEnabled) {
      return null;
    }
    const elements = this.app.scene.getNonDeletedElements();
    for (let index = elements.length - 1; index >= 0; index--) {
      const element = elements[index];
      if (!isTitledElement(element)) {
        continue;
      }
      const layout = getElementTitleLayout(element, {
        zoom: this.app.state.zoom.value,
      });
      if (
        sceneX >= layout.x &&
        sceneX <= layout.x + layout.width &&
        sceneY >= layout.y &&
        sceneY <= layout.y + layout.height
      ) {
        return element;
      }
    }
    return null;
  };

  public resetEditingElementTitle = (
    element: ExcalidrawTitledElement | null,
  ) => {
    if (element) {
      this.app.scene.mutateElement(element, {
        name: element.name?.trim() || null,
      });
    }
    this.app.setState({ editingElementTitle: null });
  };

  /**
   * The only remaining DOM node for element titles: the rename input. Titles
   * themselves are painted on the interactive canvas (`renderer/elementTitle.ts`).
   */
  public renderElementTitleEditor = () => {
    if (!this.getElementTitleEnabled()) {
      if (this.app.state.editingElementTitle) {
        this.resetEditingElementTitle(null);
      }
      return null;
    }

    const editingElementId = this.app.state.editingElementTitle;
    if (!editingElementId) {
      return null;
    }
    const element = this.app.scene.getNonDeletedElement(editingElementId);
    if (!element || !isTitledElement(element)) {
      return null;
    }

    const isDarkTheme = this.app.state.theme === THEME.DARK;
    // Editing is interaction and keeps to document geometry: render-only
    // offsets must neither move the editor nor end the edit.
    const renderState = this.app.getElementRenderState(element, null);
    if (
      !isElementInViewport(
        getRenderElementWithPositionOverride(element, renderState.offset),
        this.app.canvas.width / this.app.ownerWindow.devicePixelRatio,
        this.app.canvas.height / this.app.ownerWindow.devicePixelRatio,
        {
          offsetLeft: this.app.state.offsetLeft,
          offsetTop: this.app.state.offsetTop,
          scrollX: this.app.state.scrollX,
          scrollY: this.app.state.scrollY,
          zoom: this.app.state.zoom,
        },
        this.app.scene.getNonDeletedElementsMap(),
      )
    ) {
      this.resetEditingElementTitle(element);
      return null;
    }

    const { x: x1, y: y1 } = sceneCoordsToViewportCoords(
      {
        sceneX: element.x,
        sceneY: element.y,
      },
      this.app.state,
    );
    const elementTitle = getElementTitle(element);

    return (
      <div
        key={element.id}
        className={CLASSES.ELEMENT_TITLE}
        style={{
          position: "absolute",
          bottom: `${
            this.app.state.height +
            getElementTitleOffsetY(element) -
            y1 +
            this.app.state.offsetTop
          }px`,
          left: `${x1 - this.app.state.offsetLeft}px`,
          zIndex: 2,
          opacity: renderState.opacity,
        }}
      >
        <input
          autoFocus
          value={elementTitle}
          onChange={(event) => {
            this.app.scene.mutateElement(element, {
              name: event.target.value,
            });
          }}
          onFocus={(event) => event.target.select()}
          onBlur={() => this.resetEditingElementTitle(element)}
          onKeyDown={(event) => {
            // for some inexplicable reason, `onBlur` triggered on ESC
            // does not reset `state.editingElementTitle` despite being called,
            // and we need to reset it here as well
            if (event.key === KEYS.ESCAPE || event.key === KEYS.ENTER) {
              this.resetEditingElementTitle(element);
            }
          }}
          style={{
            background: applyDarkModeFilter(
              this.app.state.viewBackgroundColor,
              isDarkTheme,
            ),
            border: "none",
            display: "block",
            padding: `${ELEMENT_TITLE_EDIT_PADDING}px`,
            borderRadius: 4,
            boxShadow: "inset 0 0 0 1px var(--color-selection)",
            fontFamily: "Assistant",
            fontSize: `${FRAME_STYLE.nameFontSize}px`,
            transform: `translate(-${ELEMENT_TITLE_EDIT_PADDING}px, ${ELEMENT_TITLE_EDIT_PADDING}px)`,
            color: "var(--color-on-surface)",
            overflow: "hidden",
            maxWidth: `${
              this.app.ownerDocument.body.clientWidth -
              x1 -
              ELEMENT_TITLE_EDIT_PADDING
            }px`,
          }}
          size={elementTitle.length + 1 || 1}
          dir="auto"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
    );
  };
}
