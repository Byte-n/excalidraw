import {
  applyDarkModeFilter,
  CLASSES,
  FRAME_STYLE,
  KEYS,
  sceneCoordsToViewportCoords,
  THEME,
} from "@excalidraw/common";
import {
  getFrameLikeTitle,
  getRenderElementWithPositionOverride,
  isElementInViewport,
  isFrameLikeElement,
} from "@excalidraw/element";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";

import { getFrameNameLayout } from "../../renderer/frameName";

import type { FrameNameBoundsCache } from "../../types";
import type App from "../App";

const FRAME_NAME_EDIT_PADDING = 6;

export class AppFrames {
  constructor(private app: App) {}

  private getFrameNameEnabled = () =>
    this.app.state.frameRendering.enabled && this.app.state.frameRendering.name;

  frameNameBoundsCache: FrameNameBoundsCache = {
    get: (frameElement) => {
      if (!this.getFrameNameEnabled()) {
        return null;
      }
      let bounds = this.frameNameBoundsCache._cache.get(frameElement.id);
      if (
        !bounds ||
        bounds.zoom !== this.app.state.zoom.value ||
        bounds.versionNonce !== frameElement.versionNonce
      ) {
        const layout = getFrameNameLayout(frameElement, {
          zoom: this.app.state.zoom.value,
        });
        bounds = {
          x: layout.x,
          y: layout.y,
          width: layout.width,
          height: layout.height,
          zoom: this.app.state.zoom.value,
          versionNonce: frameElement.versionNonce,
        };
        this.frameNameBoundsCache._cache.set(frameElement.id, bounds);
      }
      return bounds;
    },
    /**
     * @private
     */
    _cache: new Map(),
  };

  /** Topmost frame whose title layout contains the point (view mode aside). */
  public hitTestFrameName = (
    sceneX: number,
    sceneY: number,
  ): ExcalidrawFrameLikeElement | null => {
    if (!this.getFrameNameEnabled() || this.app.state.viewModeEnabled) {
      return null;
    }
    const frames = this.app.scene.getNonDeletedFramesLikes();
    for (let index = frames.length - 1; index >= 0; index--) {
      const frame = frames[index];
      const layout = getFrameNameLayout(frame, {
        zoom: this.app.state.zoom.value,
      });
      if (
        sceneX >= layout.x &&
        sceneX <= layout.x + layout.width &&
        sceneY >= layout.y &&
        sceneY <= layout.y + layout.height
      ) {
        return frame;
      }
    }
    return null;
  };

  public resetEditingFrame = (frame: ExcalidrawFrameLikeElement | null) => {
    if (frame) {
      this.app.scene.mutateElement(frame, { name: frame.name?.trim() || null });
    }
    this.app.setState({ editingFrame: null });
  };

  /**
   * The only remaining DOM node for frame titles: the rename input. The title
   * itself is painted on the interactive canvas (`renderer/frameName.ts`).
   */
  public renderFrameNameEditor = () => {
    if (!this.getFrameNameEnabled()) {
      if (this.app.state.editingFrame) {
        this.resetEditingFrame(null);
      }
      return null;
    }

    const editingFrameId = this.app.state.editingFrame;
    if (!editingFrameId) {
      return null;
    }
    const frame = this.app.scene.getNonDeletedElement(editingFrameId);
    if (!frame || !isFrameLikeElement(frame)) {
      return null;
    }

    const isDarkTheme = this.app.state.theme === THEME.DARK;
    // Editing is interaction and keeps to document geometry: render-only
    // offsets must neither move the editor nor end the edit.
    const renderState = this.app.getElementRenderState(frame, null);
    if (
      !isElementInViewport(
        getRenderElementWithPositionOverride(frame, renderState.offset),
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
      this.resetEditingFrame(frame);
      return null;
    }

    const { x: x1, y: y1 } = sceneCoordsToViewportCoords(
      {
        sceneX: frame.x,
        sceneY: frame.y,
      },
      this.app.state,
    );
    const frameName = getFrameLikeTitle(frame);

    return (
      <div
        key={frame.id}
        className={CLASSES.FRAME_NAME}
        style={{
          position: "absolute",
          bottom: `${
            this.app.state.height +
            FRAME_STYLE.nameOffsetY -
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
          value={frameName}
          onChange={(event) => {
            this.app.scene.mutateElement(frame, {
              name: event.target.value,
            });
          }}
          onFocus={(event) => event.target.select()}
          onBlur={() => this.resetEditingFrame(frame)}
          onKeyDown={(event) => {
            // for some inexplicable reason, `onBlur` triggered on ESC
            // does not reset `state.editingFrame` despite being called,
            // and we need to reset it here as well
            if (event.key === KEYS.ESCAPE || event.key === KEYS.ENTER) {
              this.resetEditingFrame(frame);
            }
          }}
          style={{
            background: applyDarkModeFilter(
              this.app.state.viewBackgroundColor,
              isDarkTheme,
            ),
            border: "none",
            display: "block",
            padding: `${FRAME_NAME_EDIT_PADDING}px`,
            borderRadius: 4,
            boxShadow: "inset 0 0 0 1px var(--color-selection)",
            fontFamily: "Assistant",
            fontSize: `${FRAME_STYLE.nameFontSize}px`,
            transform: `translate(-${FRAME_NAME_EDIT_PADDING}px, ${FRAME_NAME_EDIT_PADDING}px)`,
            color: "var(--color-on-surface)",
            overflow: "hidden",
            maxWidth: `${
              this.app.ownerDocument.body.clientWidth -
              x1 -
              FRAME_NAME_EDIT_PADDING
            }px`,
          }}
          size={frameName.length + 1 || 1}
          dir="auto"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
    );
  };
}
