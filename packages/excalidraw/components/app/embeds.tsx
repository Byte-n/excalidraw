import clsx from "clsx";
import { clamp } from "@excalidraw/math";
import {
  COLOR_PALETTE,
  YOUTUBE_STATES,
  POINTER_EVENTS,
  DEFAULT_REDUCED_GLOBAL_ALPHA,
  toValidURL,
  sceneCoordsToViewportCoords,
} from "@excalidraw/common";
import {
  isEmbeddableElement,
  isIframeElement,
  isElementInViewport,
  getCornerRadius,
  createSrcDoc,
  embeddableURLValidator,
  getEmbedLink,
  ShapeCache,
  getRenderElementWithPositionOverride,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeleted,
  ExcalidrawIframeLikeElement,
  IframeData,
  ExcalidrawEmbeddableElement,
  Ordered,
  MagicGenerationData,
} from "@excalidraw/element/types";
import type { ValueOf } from "@excalidraw/common/utility-types";

import { t } from "../../i18n";
import Spinner from "../Spinner";

import type { EmbedsValidationStatus } from "../../types";

import type App from "../App";

const MAX_EMBEDDABLE_VIEWPORT_SCALE = 4;

export class AppEmbeds {
  constructor(private app: App) {}

  public iFrameRefs = new Map<ExcalidrawElement["id"], HTMLIFrameElement>();
  public validationStatus: EmbedsValidationStatus = new Map();
  public initializedEmbeds = new Set<ExcalidrawIframeLikeElement["id"]>();
  public youtubeVideoStates = new Map<
    ExcalidrawElement["id"],
    ValueOf<typeof YOUTUBE_STATES>
  >();

  public onWindowMessage = (event: MessageEvent) => {
    if (
      event.origin !== "https://player.vimeo.com" &&
      event.origin !== "https://www.youtube.com"
    ) {
      return;
    }

    let data = null;
    try {
      data = JSON.parse(event.data);
    } catch (e) {}
    if (!data) {
      return;
    }

    switch (event.origin) {
      case "https://player.vimeo.com":
        //Allowing for multiple instances of Excalidraw running in the window
        if (data.method === "paused") {
          let source: Window | null = null;
          const iframes = this.app.ownerDocument.body.querySelectorAll(
            "iframe.excalidraw__embeddable",
          );
          if (!iframes) {
            break;
          }
          for (const iframe of iframes as NodeListOf<HTMLIFrameElement>) {
            if (iframe.contentWindow === event.source) {
              source = iframe.contentWindow;
            }
          }
          source?.postMessage(
            JSON.stringify({
              method: data.value ? "play" : "pause",
              value: true,
            }),
            "*",
          );
        }
        break;
      case "https://www.youtube.com":
        if (
          data.event === "infoDelivery" &&
          data.info &&
          data.id &&
          typeof data.info.playerState === "number"
        ) {
          const id = data.id;
          const playerState = data.info.playerState as number;
          if (
            (Object.values(YOUTUBE_STATES) as number[]).includes(playerState)
          ) {
            this.youtubeVideoStates.set(
              id,
              playerState as ValueOf<typeof YOUTUBE_STATES>,
            );
          }
        }
        break;
    }
  };

  private cacheEmbeddableRef(
    element: ExcalidrawIframeLikeElement,
    ref: HTMLIFrameElement | null,
  ) {
    if (ref) {
      this.iFrameRefs.set(element.id, ref);
    }
  }

  public getHTMLIFrameElement(
    element: ExcalidrawIframeLikeElement,
  ): HTMLIFrameElement | undefined {
    return this.iFrameRefs.get(element.id);
  }

  public updateEmbedValidationStatus = (
    element: ExcalidrawEmbeddableElement,
    status: boolean,
  ) => {
    this.validationStatus.set(element.id, status);
    ShapeCache.delete(element);
  };

  public updateEmbeddables = () => {
    const iframeLikes = new Set<ExcalidrawIframeLikeElement["id"]>();

    let updated = false;
    this.app.scene.getNonDeletedElements().filter((element) => {
      if (isEmbeddableElement(element)) {
        iframeLikes.add(element.id);
        if (!this.validationStatus.has(element.id)) {
          updated = true;

          const validated = embeddableURLValidator(
            element.link,
            this.app.props.validateEmbeddable,
          );

          this.updateEmbedValidationStatus(element, validated);
        }
      } else if (isIframeElement(element)) {
        iframeLikes.add(element.id);
      }
      return false;
    });

    if (updated) {
      this.app.scene.triggerUpdate();
    }

    // GC
    this.iFrameRefs.forEach((ref, id) => {
      if (!iframeLikes.has(id)) {
        this.iFrameRefs.delete(id);
      }
    });
  };

  public renderEmbeddables() {
    const scale = this.app.state.zoom.value;
    const normalizedWidth = this.app.state.width;
    const normalizedHeight = this.app.state.height;

    const embeddableElements = this.app.scene
      .getNonDeletedElements()
      .filter(
        (el): el is Ordered<NonDeleted<ExcalidrawIframeLikeElement>> =>
          (isEmbeddableElement(el) &&
            this.validationStatus.get(el.id) === true) ||
          isIframeElement(el),
      );

    return (
      <>
        {embeddableElements.map((el) => {
          const renderState = this.app.getElementRenderState(el);
          const { x, y } = sceneCoordsToViewportCoords(
            { sceneX: el.x, sceneY: el.y },
            this.app.state,
          );

          const isVisible = isElementInViewport(
            getRenderElementWithPositionOverride(el, renderState.offset),
            normalizedWidth,
            normalizedHeight,
            this.app.state,
            this.app.scene.getNonDeletedElementsMap(),
          );
          const hasBeenInitialized = this.initializedEmbeds.has(el.id);

          if (isVisible && !hasBeenInitialized) {
            this.initializedEmbeds.add(el.id);
          }
          const shouldRender = isVisible || hasBeenInitialized;

          if (!shouldRender) {
            return null;
          }

          let src: IframeData | null;
          let isPendingGeneration = false;

          if (isIframeElement(el)) {
            src = null;

            const data: MagicGenerationData = (el.customData?.generationData ??
              this.app.magicGenerations.get(el.id)) || {
              status: "error",
              message: "No generation data",
              code: "ERR_NO_GENERATION_DATA",
            };

            if (data.status === "done") {
              const html = data.html;
              src = {
                intrinsicSize: { w: el.width, h: el.height },
                type: "document",
                srcdoc: () => {
                  return html;
                },
              } as const;
            } else if (data.status === "pending") {
              src = {
                intrinsicSize: { w: el.width, h: el.height },
                type: "document",
                srcdoc: () => {
                  return createSrcDoc(`
                    <style>
                      html, body {
                        width: 100%;
                        height: 100%;
                        margin: 0;
                      }
                    </style>
                    <script>
                      // progressively renders the partial HTML snapshots the
                      // editor streams in during generation by document.write-
                      // ing them into this.app very document — feeding the
                      // browser's incremental HTML parser, so incomplete
                      // markup renders progressively
                      // (see App.onMagicFrameGenerate)
                      let writtenLength = 0;
                      let opened = false;

                      const onPartialMessage = (event) => {
                        const data = event.data;
                        if (
                          !data ||
                          data.type !== "excalidraw:diagramToCode:partial" ||
                          typeof data.html !== "string" ||
                          data.html.length <= writtenLength
                        ) {
                          return;
                        }
                        if (!opened) {
                          opened = true;
                          document.open();
                          // document.open() wipes all listeners from both the
                          // document and the window, so re-register
                          window.addEventListener("message", onPartialMessage);
                        }
                        document.write(data.html.slice(writtenLength));
                        writtenLength = data.html.length;
                      };

                      window.addEventListener("message", onPartialMessage);
                    </script>
                  `);
                },
              } as const;
              isPendingGeneration = true;
            } else {
              let message: string;
              if (data.code === "ERR_GENERATION_INTERRUPTED") {
                message = "Generation was interrupted...";
              } else {
                message = data.message || "Generation failed";
              }
              src = {
                intrinsicSize: { w: el.width, h: el.height },
                type: "document",
                srcdoc: () => {
                  return createSrcDoc(`
                    <style>
                    html, body {
                      height: 100%;
                    }
                      body {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        color: ${COLOR_PALETTE.red[3]};
                      }
                      h1, h3 {
                        margin-top: 0;
                        margin-bottom: 0.5rem;
                      }
                    </style>
                    <h1>Error!</h1>
                    <h3>${message}</h3>
                  `);
                },
              } as const;
            }
          } else {
            src = getEmbedLink(toValidURL(el.link || ""));
          }

          const isActive =
            this.app.state.activeEmbeddable?.element === el &&
            this.app.state.activeEmbeddable?.state === "active";
          const isHovered =
            this.app.state.activeEmbeddable?.element === el &&
            this.app.state.activeEmbeddable?.state === "hover";

          // scale video embeds based on zoom (capped) so that smaller embeds
          // on canvas when zoomed are still of legible quality
          // (note: for some embed types like gdrive, the quality is poor when
          // scaling mid playback and works only when you initially start the
          // playback at the higher zoom level)
          const shouldScaleEmbeddableViewport = src?.type === "video";
          const embeddableViewportScale = clamp(
            shouldScaleEmbeddableViewport ? scale : 1,
            0.75,
            MAX_EMBEDDABLE_VIEWPORT_SCALE,
          );

          return (
            <div
              key={el.id}
              className={clsx("excalidraw__embeddable-container", {
                "is-hovered": isHovered,
              })}
              style={{
                transform: isVisible
                  ? `translate(${
                      x +
                      renderState.offset.x * this.app.state.zoom.value -
                      this.app.state.offsetLeft
                    }px, ${
                      y +
                      renderState.offset.y * this.app.state.zoom.value -
                      this.app.state.offsetTop
                    }px) scale(${scale})`
                  : "none",
                display: isVisible ? "block" : "none",
                opacity:
                  renderState.opacity *
                  (this.app.state.openDialog?.name === "elementLinkSelector"
                    ? DEFAULT_REDUCED_GLOBAL_ALPHA
                    : 1),
                ["--embeddable-radius" as string]: `${getCornerRadius(
                  Math.min(el.width, el.height),
                  el,
                )}px`,
              }}
            >
              <div
                //this.app is a hack that addresses isse with embedded excalidraw.com embeddable
                //https://github.com/excalidraw/excalidraw/pull/6691#issuecomment-1607383938
                /*ref={(ref) => {
                  if (!this.app.excalidrawContainerRef.current) {
                    return;
                  }
                  const container = this.app.excalidrawContainerRef.current;
                  const sh = container.scrollHeight;
                  const ch = container.clientHeight;
                  if (sh !== ch) {
                    container.style.height = `${sh}px`;
                    setTimeout(() => {
                      container.style.height = `100%`;
                    });
                  }
                }}*/
                className="excalidraw__embeddable-container__inner"
                style={{
                  width: isVisible ? `${el.width}px` : 0,
                  height: isVisible ? `${el.height}px` : 0,
                  transform: isVisible ? `rotate(${el.angle}rad)` : "none",
                  pointerEvents: isActive
                    ? POINTER_EVENTS.enabled
                    : POINTER_EVENTS.disabled,
                }}
              >
                {isHovered && (
                  <div className="excalidraw__embeddable-hint">
                    {t("buttons.embeddableInteractionButton")}
                  </div>
                )}
                <div
                  className="excalidraw__embeddable__outer"
                  style={{
                    padding: `${el.strokeWidth}px`,
                  }}
                >
                  <div
                    className="excalidraw__embeddable__content"
                    style={{
                      width: `${embeddableViewportScale * 100}%`,
                      height: `${embeddableViewportScale * 100}%`,
                      transform: `scale(${1 / embeddableViewportScale})`,
                    }}
                  >
                    {(isEmbeddableElement(el)
                      ? this.app.props.renderEmbeddable?.(el, this.app.state)
                      : null) ?? (
                      <iframe
                        ref={(ref) => this.cacheEmbeddableRef(el, ref)}
                        className="excalidraw__embeddable"
                        srcDoc={
                          src?.type === "document"
                            ? src.srcdoc(this.app.state.theme)
                            : undefined
                        }
                        src={
                          src?.type !== "document" ? src?.link ?? "" : undefined
                        }
                        // https://stackoverflow.com/q/18470015
                        scrolling="no"
                        referrerPolicy="no-referrer-when-downgrade"
                        title="Excalidraw Embedded Content"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen={true}
                        sandbox={`${
                          src?.sandbox?.allowSameOrigin
                            ? "allow-same-origin"
                            : ""
                        } allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads`}
                      />
                    )}
                  </div>
                </div>
                {isPendingGeneration && (
                  <div className="excalidraw__embeddable__generating">
                    <Spinner size="1em" />
                    Generating…
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </>
    );
  }
}
