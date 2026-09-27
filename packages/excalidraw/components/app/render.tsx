import clsx from "clsx";
import { POINTER_EVENTS } from "@excalidraw/common";
import {
  isIframeElement,
  isMagicFrameElement,
  isMindmapNodeElement,
  getBoundTextElement,
  getCompositeShapeTextFitMode,
  redrawTextBoundingBox,
} from "@excalidraw/element";

import { getLanguage, t } from "../../i18n";
import { Hyperlink } from "../hyperlink/Hyperlink";
import { editorJotaiStore } from "../../editor-jotai";
import { isGridModeEnabled } from "../../snapping";
import { ElementCanvasButtons } from "../ElementCanvasButtons";
import ConvertElementTypePopup, {
  convertElementTypePopupAtom,
} from "../ConvertElementTypePopup";
import { TOOL_DRAG_PREVIEW_OPACITY } from "../App.toolDrag";
import { RIGHT_SIDEBAR_WIDTH } from "../App.viewport";
import { ContextMenu } from "../ContextMenu";
import { ViewportStatusBorder } from "../ViewportStatusFrame/ViewportStatusFrame";
import LayerUI from "../LayerUI";
import { ElementCanvasButton } from "../MagicButton";
import { SVGLayer } from "../SVGLayer";
import { StaticCanvas, InteractiveCanvas } from "../canvases";
import NewElementCanvas from "../canvases/NewElementCanvas";
import { CursorHint } from "../CursorHint";
import {
  MagicIcon,
  PlusIcon,
  TextFitAutoIcon,
  TextFitFixedIcon,
  copyIcon,
  fullscreenIcon,
} from "../icons";
import UnlockPopup from "../UnlockPopup";

import {
  AppContext,
  AppPropsContext,
  EditorInterfaceContext,
  ExcalidrawContainerContext,
  ExcalidrawElementsContext,
  ExcalidrawAppStateContext,
  ExcalidrawSetAppStateContext,
  ExcalidrawActionManagerContext,
  ExcalidrawAPIContext,
} from "./context";

import type App from "../App";

export const AppView = ({ app }: { app: App }) => {
  const selectedElements = app.scene.getSelectedElements(app.state);
  const {
    renderTopRightUI,
    renderTopLeftUI,
    renderTopCenterToolbar,
    renderCustomStats,
  } = app.props;

  const {
    elementsMap: renderableElementsMap,
    visibleElements,
    canvasNonce,
    /**
     * element to draw on the <NewElementCanvas> for optimization purposes.
     * Can be null even if app.state.newElement defined
     * (e.g. when its zIndex isn't on top) */
    newElementCanvasElement,
  } = app.renderer.getRenderableElements({
    zoom: app.state.zoom,
    offsetLeft: app.state.offsetLeft,
    offsetTop: app.state.offsetTop,
    scrollX: app.state.scrollX,
    scrollY: app.state.scrollY,
    height: app.state.height,
    width: app.state.width,
    editingTextElement: app.state.editingTextElement,
    newElement: app.state.newElement,
    selectedElements,
    selectedElementsAreBeingDragged: app.state.selectedElementsAreBeingDragged,
    frameToHighlight: app.state.frameToHighlight,
  });
  app.visibleElements = visibleElements;
  app.hasRenderableElements = renderableElementsMap.size > 0;

  const allElementsMap = app.scene.getNonDeletedElementsMap();

  // a tool dragged out of the toolbar previews on the new-element canvas
  // (it is not in the scene until dropped)
  const previewElement = newElementCanvasElement ?? app.toolDrag.preview;

  const shouldBlockPointerEvents =
    // default back to `--ui-pointerEvents` flow if setPointerCapture
    // not supported
    "setPointerCapture" in app.ownerWindow.HTMLElement.prototype
      ? false
      : app.state.selectionElement ||
        app.state.newElement ||
        app.state.selectedElementsAreBeingDragged ||
        app.state.resizingElement ||
        (app.state.activeTool.type === "laser" &&
          // technically we can just test on app once we make it more safe
          app.state.cursorButton === "down");

  const firstSelectedElement = selectedElements[0];
  const selectedCompositeShape =
    selectedElements.length === 1 &&
    firstSelectedElement?.type === "composite_shape"
      ? firstSelectedElement
      : null;
  const hoveredMindmapNode = Object.keys(app.state.hoveredElementIds)
    .map((id) => app.scene.getNonDeletedElement(id))
    .find(isMindmapNodeElement);
  const mindmapNodeForControls = hoveredMindmapNode
    ? hoveredMindmapNode
    : selectedElements.length === 1 &&
      isMindmapNodeElement(firstSelectedElement)
    ? firstSelectedElement
    : null;

  const showShapeSwitchPanel =
    editorJotaiStore.get(convertElementTypePopupAtom)?.type === "panel";

  const setCompositeShapeTextFit = (nextMode: "auto" | "fixed") => {
    if (!selectedCompositeShape) {
      return;
    }
    if (getCompositeShapeTextFitMode(selectedCompositeShape) === nextMode) {
      return;
    }
    app.scene.mutateElement(selectedCompositeShape, {
      textFitMode: nextMode,
      ...(nextMode === "auto" && {
        textFitMinWidth: selectedCompositeShape.width,
        textFitMinHeight: selectedCompositeShape.height,
      }),
    });
    const latestShape = app.scene.getElement(selectedCompositeShape.id);
    const boundText = getBoundTextElement(
      latestShape || selectedCompositeShape,
      app.scene.getNonDeletedElementsMap(),
    );
    if (boundText) {
      redrawTextBoundingBox(
        boundText,
        latestShape || selectedCompositeShape,
        app.scene,
      );
    }
    app.store.scheduleCapture();
  };

  return (
    <div
      translate="no"
      className={clsx(
        "excalidraw excalidraw-container notranslate",
        app.props.className,
        {
          "excalidraw--view-mode":
            app.state.viewModeEnabled ||
            app.state.openDialog?.name === "elementLinkSelector",
          "excalidraw--mobile": app.editorInterface.formFactor === "phone",
          "excalidraw--non-interactive": !app.isInteractionEnabled(),
          "excalidraw--navigation":
            !app.isInteractionEnabled() && app.isNavigationEnabled(),
          "excalidraw--tools":
            !app.isInteractionEnabled() &&
            app.isToolSupported(app.state.activeTool.type),
          "excalidraw--embeds":
            !app.isInteractionEnabled() && app.isEmbedsEnabled(),
          "excalidraw--allow-browser-zoom":
            !app.isInteractionEnabled() && app.isBrowserZoomEnabled(),
          "excalidraw--ui-hidden": !app.isDefaultUIEnabled(),
          "excalidraw--mobile-toolbar":
            app.editorInterface.formFactor === "phone" &&
            app.isDefaultUIEnabled() &&
            !app.state.viewModeEnabled,
          "excalidraw--viewport-status-border":
            !!app.props.viewportStatusFrame?.border,
          "excalidraw--viewport-status-label":
            !!app.props.viewportStatusFrame?.label,
          "excalidraw--zen-mode": app.state.zenModeEnabled,
        },
      )}
      style={{
        ["--ui-pointerEvents" as any]: shouldBlockPointerEvents
          ? POINTER_EVENTS.disabled
          : POINTER_EVENTS.enabled,
        ["--right-sidebar-width" as any]: `${RIGHT_SIDEBAR_WIDTH}px`,
      }}
      ref={app.excalidrawContainerRef}
      onDrop={app.isInteractionEnabled() ? app.handleAppOnDrop : undefined}
      tabIndex={0}
      onKeyDown={
        app.props.handleKeyboardGlobally || !app.isInteractionEnabled()
          ? undefined
          : app.onKeyDown
      }
      onPointerEnter={
        app.isInteractionEnabled() ? app.toggleOverscrollBehavior : undefined
      }
      onPointerLeave={
        app.isInteractionEnabled() ? app.toggleOverscrollBehavior : undefined
      }
    >
      <ExcalidrawAPIContext.Provider value={app.api}>
        <AppContext.Provider value={app}>
          <AppPropsContext.Provider value={app.props}>
            <ExcalidrawContainerContext.Provider
              value={app.excalidrawContainerValue}
            >
              <EditorInterfaceContext.Provider value={app.editorInterface}>
                <ExcalidrawSetAppStateContext.Provider value={app.setAppState}>
                  <ExcalidrawAppStateContext.Provider value={app.state}>
                    <ExcalidrawElementsContext.Provider
                      value={app.scene.getNonDeletedElements()}
                    >
                      <ExcalidrawActionManagerContext.Provider
                        value={app.actionManager}
                      >
                        <LayerUI
                          canvas={app.canvas}
                          appState={app.state}
                          defaultUIEnabled={app.isDefaultUIEnabled()}
                          zoomUIEnabled={app.isUIControlEnabled("zoom")}
                          scrollBackToContentUIEnabled={app.isUIControlEnabled(
                            "scrollBackToContent",
                          )}
                          files={app.files}
                          setAppState={app.setAppState}
                          actionManager={app.actionManager}
                          elements={app.scene.getNonDeletedElements()}
                          onLockToggle={app.toggleLock}
                          onPenModeToggle={app.togglePenMode}
                          langCode={getLanguage().code}
                          renderTopLeftUI={renderTopLeftUI}
                          renderTopRightUI={renderTopRightUI}
                          renderTopCenterToolbar={renderTopCenterToolbar}
                          renderCustomStats={renderCustomStats}
                          showExitZenModeBtn={
                            typeof app.props?.zenModeEnabled === "undefined" &&
                            app.state.zenModeEnabled
                          }
                          UIOptions={app.props.UIOptions}
                          onExportImage={app.onExportImage}
                          renderWelcomeScreen={
                            !app.state.isLoading &&
                            app.state.showWelcomeScreen &&
                            app.state.activeTool.type ===
                              app.state.preferredSelectionTool.type &&
                            !app.state.zenModeEnabled &&
                            !app.scene.getElementsIncludingDeleted().length
                          }
                          app={app}
                          isCollaborating={app.props.isCollaborating}
                          generateLinkForSelection={
                            app.props.generateLinkForSelection
                          }
                          currentUserControls={app.props.currentUserControls}
                        >
                          {app.props.children}
                        </LayerUI>

                        <div className="excalidraw-textEditorContainer" />
                        <div className="excalidraw-contextMenuContainer" />
                        <div className="excalidraw-eye-dropper-container" />
                        <SVGLayer
                          trails={[
                            app.laserTrails,
                            app.lassoTrail,
                            app.eraserTrail,
                            app.drawShape.trail,
                          ]}
                        />
                        {app.isDefaultUIEnabled() && <CursorHint />}
                        {app.isDefaultUIEnabled() &&
                          selectedElements.length === 1 &&
                          app.state.openDialog?.name !==
                            "elementLinkSelector" &&
                          app.state.showHyperlinkPopup && (
                            <Hyperlink
                              key={firstSelectedElement.id}
                              element={firstSelectedElement}
                              scene={app.scene}
                              setAppState={app.setAppState}
                              onLinkOpen={app.props.onLinkOpen}
                              setToast={app.setToast}
                              updateEmbedValidationStatus={
                                app.updateEmbedValidationStatus
                              }
                            />
                          )}
                        {app.isDefaultUIEnabled() &&
                          selectedCompositeShape &&
                          !app.state.openDialog && (
                            <ElementCanvasButtons
                              element={selectedCompositeShape}
                              elementsMap={renderableElementsMap}
                              anchor="bottom-right"
                            >
                              <ElementCanvasButton
                                title="Keep shape size"
                                icon={TextFitFixedIcon}
                                checked={
                                  getCompositeShapeTextFitMode(
                                    selectedCompositeShape,
                                  ) === "fixed"
                                }
                                onChange={() =>
                                  setCompositeShapeTextFit("fixed")
                                }
                              />
                              <ElementCanvasButton
                                title="Fit shape to text"
                                icon={TextFitAutoIcon}
                                checked={
                                  getCompositeShapeTextFitMode(
                                    selectedCompositeShape,
                                  ) === "auto"
                                }
                                onChange={() =>
                                  setCompositeShapeTextFit("auto")
                                }
                              />
                            </ElementCanvasButtons>
                          )}
                        {app.isDefaultUIEnabled() &&
                          mindmapNodeForControls &&
                          app.mindmap.canEditNode(mindmapNodeForControls.id) &&
                          !app.state.openDialog && (
                            <ElementCanvasButtons
                              element={mindmapNodeForControls}
                              elementsMap={renderableElementsMap}
                              layoutDirection={app.mindmap.getLayoutDirection(
                                mindmapNodeForControls.graphId,
                              )}
                            >
                              <ElementCanvasButton
                                isMobile={
                                  app.editorInterface.formFactor !== "desktop"
                                }
                                title={t("labels.addMindmapChild")}
                                icon={PlusIcon}
                                checked={false}
                                onChange={() =>
                                  app.mindmap.createChild(
                                    mindmapNodeForControls.id,
                                  )
                                }
                              />
                              {app.mindmap.hasChildren(
                                mindmapNodeForControls.id,
                              ) && (
                                <ElementCanvasButton
                                  isMobile={
                                    app.editorInterface.formFactor !== "desktop"
                                  }
                                  title={t(
                                    mindmapNodeForControls.collapsed
                                      ? "labels.expandMindmap"
                                      : "labels.collapseMindmap",
                                  )}
                                  icon={
                                    <span aria-hidden="true">
                                      {mindmapNodeForControls.collapsed
                                        ? "▸"
                                        : "▾"}
                                    </span>
                                  }
                                  checked={mindmapNodeForControls.collapsed}
                                  onChange={() =>
                                    app.mindmap.executeTreeCommand(
                                      { type: "toggleCollapse" },
                                      mindmapNodeForControls.id,
                                    )
                                  }
                                />
                              )}
                            </ElementCanvasButtons>
                          )}
                        {app.isDefaultUIEnabled() &&
                          app.props.aiEnabled !== false &&
                          selectedElements.length === 1 &&
                          isMagicFrameElement(firstSelectedElement) && (
                            <ElementCanvasButtons
                              element={firstSelectedElement}
                              elementsMap={renderableElementsMap}
                            >
                              <ElementCanvasButton
                                title={t("labels.convertToCode")}
                                icon={MagicIcon}
                                checked={false}
                                onChange={() =>
                                  app.onMagicFrameGenerate(
                                    firstSelectedElement,
                                    "button",
                                  )
                                }
                              />
                            </ElementCanvasButtons>
                          )}
                        {app.isDefaultUIEnabled() &&
                          selectedElements.length === 1 &&
                          isIframeElement(firstSelectedElement) &&
                          firstSelectedElement.customData?.generationData
                            ?.status === "done" && (
                            <ElementCanvasButtons
                              element={firstSelectedElement}
                              elementsMap={renderableElementsMap}
                            >
                              <ElementCanvasButton
                                title={t("labels.copySource")}
                                icon={copyIcon}
                                checked={false}
                                onChange={() =>
                                  app.onIframeSrcCopy(firstSelectedElement)
                                }
                              />
                              <ElementCanvasButton
                                title="Enter fullscreen"
                                icon={fullscreenIcon}
                                checked={false}
                                onChange={() => {
                                  const iframe =
                                    app.getHTMLIFrameElement(
                                      firstSelectedElement,
                                    );
                                  if (iframe) {
                                    try {
                                      iframe.requestFullscreen();
                                      app.setState({
                                        activeEmbeddable: {
                                          element: firstSelectedElement,
                                          state: "active",
                                        },
                                        selectedElementIds: {
                                          [firstSelectedElement.id]: true,
                                        },
                                        newElement: null,
                                        selectionElement: null,
                                      });
                                    } catch (err: any) {
                                      console.warn(err);
                                      app.setState({
                                        errorMessage:
                                          "Couldn't enter fullscreen",
                                      });
                                    }
                                  }
                                }}
                              />
                            </ElementCanvasButtons>
                          )}

                        {app.isDefaultUIEnabled() && app.state.contextMenu && (
                          <ContextMenu
                            items={app.state.contextMenu.items}
                            top={app.state.contextMenu.top}
                            left={app.state.contextMenu.left}
                            actionManager={app.actionManager}
                            onClose={(callback) => {
                              app.setState({ contextMenu: null }, () => {
                                app.focusContainer();
                                callback?.();
                              });
                            }}
                          />
                        )}
                        <StaticCanvas
                          canvas={app.canvas}
                          rc={app.rc}
                          elementsMap={renderableElementsMap}
                          allElementsMap={allElementsMap}
                          visibleElements={
                            app.elementRenderOffsets.size
                              ? app.renderer.getVisibleElementsWithRenderOffsets(
                                  visibleElements,
                                  renderableElementsMap,
                                  app.state,
                                  app.elementRenderOffsets,
                                )
                              : visibleElements
                          }
                          canvasNonce={canvasNonce}
                          selectionNonce={
                            app.state.selectionElement?.versionNonce
                          }
                          scale={app.ownerWindow.devicePixelRatio}
                          appState={app.state}
                          renderConfig={{
                            imageCache: app.imageCache,
                            isExporting: false,
                            renderGrid: isGridModeEnabled(app),
                            renderLinks: app.isLinksEnabled(),
                            canvasBackgroundColor:
                              app.state.viewBackgroundColor,
                            embedsValidationStatus: app.embedsValidationStatus,
                            elementsPendingErasure: app.elementsPendingErasure,
                            pendingFlowchartNodes: app.flowchart.pendingNodes,
                            theme: app.state.theme,
                            ...app.getRenderOverrideConfig(),
                          }}
                        />
                        {previewElement && (
                          <NewElementCanvas
                            appState={app.state}
                            newElement={previewElement}
                            scale={app.ownerWindow.devicePixelRatio}
                            rc={app.rc}
                            elementsMap={renderableElementsMap}
                            allElementsMap={allElementsMap}
                            renderConfig={{
                              imageCache: app.imageCache,
                              isExporting: false,
                              renderGrid: false,
                              canvasBackgroundColor:
                                app.state.viewBackgroundColor,
                              embedsValidationStatus:
                                app.embedsValidationStatus,
                              elementsPendingErasure:
                                app.elementsPendingErasure,
                              pendingFlowchartNodes: null,
                              theme: app.state.theme,
                              ...app.getRenderOverrideConfig(),
                            }}
                            // a tool dragged out of the toolbar previews
                            // translucently; the element itself is drawn
                            // exactly as it will land
                            opacity={
                              app.toolDrag.preview
                                ? TOOL_DRAG_PREVIEW_OPACITY
                                : undefined
                            }
                          />
                        )}
                        <InteractiveCanvas
                          app={app}
                          containerRef={app.excalidrawContainerRef}
                          canvas={app.interactiveCanvas}
                          elementsMap={renderableElementsMap}
                          visibleElements={visibleElements}
                          allElementsMap={allElementsMap}
                          selectedElements={selectedElements}
                          canvasNonce={canvasNonce}
                          selectionNonce={
                            app.state.selectionElement?.versionNonce
                          }
                          scale={app.ownerWindow.devicePixelRatio}
                          appState={app.state}
                          renderScrollbars={app.props.renderScrollbars === true}
                          editorInterface={app.editorInterface}
                          interactionEnabled={app.isInteractionEnabled()}
                          navigationEnabled={app.isNavigationEnabled()}
                          renderInteractiveSceneCallback={
                            app.renderInteractiveSceneCallback
                          }
                          handleCanvasRef={app.handleInteractiveCanvasRef}
                          onContextMenu={app.handleCanvasContextMenu}
                          onClick={app.handleCanvasClick}
                          onPointerMove={app.handleCanvasPointerMove}
                          onPointerUp={app.handleCanvasPointerUp}
                          onPointerCancel={(event) => {
                            app.removePointer(event);
                            app.maybeCleanupAfterMissingPointerUp(
                              event.nativeEvent,
                            );
                          }}
                          onTouchMove={app.handleTouchMove}
                          onPointerDown={app.handleCanvasPointerDown}
                          onDoubleClick={app.handleCanvasDoubleClick}
                        />
                        {app.props.viewportStatusFrame?.border &&
                          app.editorInterface.formFactor === "phone" && (
                            <ViewportStatusBorder
                              border={app.props.viewportStatusFrame.border}
                            />
                          )}
                        {app.frames.renderFrameNames()}
                        {app.isDefaultUIEnabled() &&
                          app.state.activeLockedId && (
                            <UnlockPopup
                              app={app}
                              activeLockedId={app.state.activeLockedId}
                            />
                          )}
                        {app.isDefaultUIEnabled() && showShapeSwitchPanel && (
                          <ConvertElementTypePopup app={app} />
                        )}
                      </ExcalidrawActionManagerContext.Provider>
                      {app.renderEmbeddables()}
                    </ExcalidrawElementsContext.Provider>
                  </ExcalidrawAppStateContext.Provider>
                </ExcalidrawSetAppStateContext.Provider>
              </EditorInterfaceContext.Provider>
            </ExcalidrawContainerContext.Provider>
          </AppPropsContext.Provider>
        </AppContext.Provider>
      </ExcalidrawAPIContext.Provider>
    </div>
  );
};
