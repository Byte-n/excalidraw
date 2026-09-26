import {
  applyDarkModeFilter,
  CLASSES,
  CURSOR_TYPE,
  FRAME_STYLE,
  KEYS,
  POINTER_EVENTS,
  sceneCoordsToViewportCoords,
  THEME,
} from "@excalidraw/common";
import {
  getFrameLikeTitle,
  getRenderElementWithPositionOverride,
  isElementInViewport,
  isFrameLikeElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
} from "@excalidraw/element/types";

import type { FrameNameBoundsCache } from "../../types";
import type App from "../App";

export class AppFrames {
  constructor(private app: App) {}

  private getFrameNameDOMId = (frameElement: ExcalidrawElement) => {
    return `${this.app.id}-frame-name-${frameElement.id}`;
  };

  frameNameBoundsCache: FrameNameBoundsCache = {
    get: (frameElement) => {
      let bounds = this.frameNameBoundsCache._cache.get(frameElement.id);
      if (
        !bounds ||
        bounds.zoom !== this.app.state.zoom.value ||
        bounds.versionNonce !== frameElement.versionNonce
      ) {
        const frameNameDiv = this.app.ownerDocument.getElementById(
          this.getFrameNameDOMId(frameElement),
        );

        if (frameNameDiv) {
          const box = frameNameDiv.getBoundingClientRect();
          const zoom = this.app.state.zoom.value;

          // Only the title's size comes from layout: its visual position may
          // have an override. Hit bounds stay anchored to the document frame,
          // with the title's bottom nameOffsetY screen pixels above it.
          bounds = {
            x: frameElement.x,
            y: frameElement.y - (box.height + FRAME_STYLE.nameOffsetY) / zoom,
            width: box.width / zoom,
            height: box.height / zoom,
            zoom,
            versionNonce: frameElement.versionNonce,
          };

          this.frameNameBoundsCache._cache.set(frameElement.id, bounds);

          return bounds;
        }
        return null;
      }

      return bounds;
    },
    /**
     * @private
     */
    _cache: new Map(),
  };

  public resetEditingFrame = (frame: ExcalidrawFrameLikeElement | null) => {
    if (frame) {
      this.app.scene.mutateElement(frame, { name: frame.name?.trim() || null });
    }
    this.app.setState({ editingFrame: null });
  };

  public renderFrameNames = () => {
    if (
      !this.app.state.frameRendering.enabled ||
      !this.app.state.frameRendering.name
    ) {
      if (this.app.state.editingFrame) {
        this.resetEditingFrame(null);
      }
      return null;
    }

    const isDarkTheme = this.app.state.theme === THEME.DARK;
    const nonDeletedFramesLikes = this.app.scene.getNonDeletedFramesLikes();

    const focusedSearchMatch =
      nonDeletedFramesLikes.length > 0
        ? this.app.state.searchMatches?.focusedId &&
          isFrameLikeElement(
            this.app.scene.getElement(this.app.state.searchMatches.focusedId),
          )
          ? this.app.state.searchMatches.matches.find((sm) => sm.focus)
          : null
        : null;

    return nonDeletedFramesLikes.map((f) => {
      // The name is a decoration that follows the frame's render overrides,
      // except while it's being edited: editing is interaction and keeps to
      // document geometry like everything else interactive. Culling by the
      // translated frame would otherwise end the edit (and commit the name)
      // from a render-only override.
      const renderState = this.app.getElementRenderState(
        f,
        f.id === this.app.state.editingFrame
          ? null
          : this.app.elementRenderOverrides,
      );
      if (
        !isElementInViewport(
          getRenderElementWithPositionOverride(f, renderState.offset),
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
        if (this.app.state.editingFrame === f.id) {
          this.resetEditingFrame(f);
        }
        // if frame not visible, don't render its name
        return null;
      }

      const { x: x1, y: y1 } = sceneCoordsToViewportCoords(
        {
          sceneX: f.x + renderState.offset.x,
          sceneY: f.y + renderState.offset.y,
        },
        this.app.state,
      );

      const FRAME_NAME_EDIT_PADDING = 6;

      let frameNameJSX;

      const frameName = getFrameLikeTitle(f);

      if (f.id === this.app.state.editingFrame) {
        const frameNameInEdit = frameName;

        frameNameJSX = (
          <input
            autoFocus
            value={frameNameInEdit}
            onChange={(e) => {
              this.app.scene.mutateElement(f, {
                name: e.target.value,
              });
            }}
            onFocus={(e) => e.target.select()}
            onBlur={() => this.resetEditingFrame(f)}
            onKeyDown={(event) => {
              // for some inexplicable reason, `onBlur` triggered on ESC
              // does not reset `state.editingFrame` despite being called,
              // and we need to reset it here as well
              if (event.key === KEYS.ESCAPE || event.key === KEYS.ENTER) {
                this.resetEditingFrame(f);
              }
            }}
            style={{
              background: applyDarkModeFilter(
                this.app.state.viewBackgroundColor,
                isDarkTheme,
              ),
              zIndex: 2,
              border: "none",
              display: "block",
              padding: `${FRAME_NAME_EDIT_PADDING}px`,
              borderRadius: 4,
              boxShadow: "inset 0 0 0 1px var(--color-primary)",
              fontFamily: "Assistant",
              fontSize: `${FRAME_STYLE.nameFontSize}px`,
              transform: `translate(-${FRAME_NAME_EDIT_PADDING}px, ${FRAME_NAME_EDIT_PADDING}px)`,
              color: isDarkTheme
                ? FRAME_STYLE.nameColorDarkTheme
                : FRAME_STYLE.nameColorLightTheme,
              overflow: "hidden",
              maxWidth: `${
                this.app.ownerDocument.body.clientWidth -
                x1 -
                FRAME_NAME_EDIT_PADDING
              }px`,
            }}
            size={frameNameInEdit.length + 1 || 1}
            dir="auto"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
          />
        );
      } else {
        frameNameJSX = frameName;
      }

      return (
        <div
          id={this.getFrameNameDOMId(f)}
          className={CLASSES.FRAME_NAME}
          key={f.id}
          style={{
            position: "absolute",
            opacity: renderState.opacity,
            // Positioning from bottom so that we don't to either
            // calculate text height or adjust using transform (which)
            // messes up input position when editing the frame name.
            // This makes the positioning deterministic and we can calculate
            // the same position when rendering to canvas / svg.
            bottom: `${
              this.app.state.height +
              FRAME_STYLE.nameOffsetY -
              y1 +
              this.app.state.offsetTop
            }px`,
            left: `${x1 - this.app.state.offsetLeft}px`,
            zIndex: 2,
            fontSize: FRAME_STYLE.nameFontSize,
            color: isDarkTheme
              ? FRAME_STYLE.nameColorDarkTheme
              : FRAME_STYLE.nameColorLightTheme,
            lineHeight: FRAME_STYLE.nameLineHeight,
            width: "max-content",
            maxWidth:
              focusedSearchMatch?.id === f.id && focusedSearchMatch?.focus
                ? "none"
                : `${f.width * this.app.state.zoom.value}px`,
            overflow:
              f.id === this.app.state.editingFrame ? "visible" : "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            cursor: CURSOR_TYPE.MOVE,
            pointerEvents: this.app.state.viewModeEnabled
              ? POINTER_EVENTS.disabled
              : POINTER_EVENTS.enabled,
          }}
          onPointerDown={(event) => this.app.handleCanvasPointerDown(event)}
          onContextMenu={this.app.handleCanvasContextMenu}
          onDoubleClick={() => {
            this.app.setState({
              editingFrame: f.id,
            });
          }}
        >
          {frameNameJSX}
        </div>
      );
    });
  };
}
