import {
  KEYS,
  THEME,
  applyDarkModeFilter,
  getFontString,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads, type Radians } from "@excalidraw/math";

import {
  LinearElementEditor,
  getLineHeightInPx,
  getLocalTextRegionLayout,
  getTextRegions,
  isLinearElement,
  normalizeSingleLineText,
} from "@excalidraw/element";

import type { TextEditingSession } from "@excalidraw/element";
import type {
  ExcalidrawCompositeElement,
  ExcalidrawDataflowElement,
  ExcalidrawFlowElement,
  ExcalidrawLinearElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawSequenceElement,
  ExcalidrawStickyNoteElement,
  ExcalidrawTableElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { getTransform } from "./textWysiwyg";

import type App from "../components/App";

type RegionTextElement =
  | ExcalidrawCompositeElement
  | ExcalidrawFlowElement
  | ExcalidrawDataflowElement
  | ExcalidrawStickyNoteElement
  | ExcalidrawMindmapNodeElement
  | ExcalidrawTableElement
  | ExcalidrawSequenceElement
  | ExcalidrawLinearElement;

/**
 * 区域文本编辑器的轻量覆盖层：正文不再有独立的文字元素，
 * 每次输入即写回 `texts` 并触发几何反馈，编辑框始终按 reflow 后的区域布局定位。
 */
export const textRegionEditor = ({
  app,
  element,
  session,
  canvas,
  excalidrawContainer,
  getViewportCoords,
  onChange,
  onCommit,
  onCancel,
  autoSelect = true,
}: {
  app: App;
  element: NonDeleted<RegionTextElement>;
  session: TextEditingSession;
  canvas: HTMLCanvasElement;
  excalidrawContainer: HTMLDivElement | null;
  getViewportCoords: (x: number, y: number) => [number, number];
  onChange: (text: string) => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
  autoSelect?: boolean;
}): (() => void) => {
  const ownerDocument = excalidrawContainer?.ownerDocument ?? document;
  const ownerWindow = ownerDocument.defaultView ?? window;
  const region = session.target.region;
  const style = session.style;

  let isFinished = false;
  /** 草稿写回 scene 期间抑制 onUpdate 触发的重复定位。 */
  let isApplyingDraft = false;
  let lastAppliedText = session.initialText;

  const editable = ownerDocument.createElement("textarea");
  editable.dir = "auto";
  editable.tabIndex = 0;
  editable.dataset.type = "wysiwyg";
  editable.classList.add("excalidraw-wysiwyg");
  Object.assign(editable.style, {
    position: "absolute",
    display: "inline-block",
    minHeight: "1em",
    backfaceVisibility: "hidden",
    margin: 0,
    padding: 0,
    border: 0,
    outline: 0,
    resize: "none",
    background: "transparent",
    overflow: "hidden",
    // 暗色模式下的 canvas 形成层叠上下文，编辑框必须显式抬高层级
    zIndex: "var(--zIndex-wysiwyg)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowWrap: "break-word",
    boxSizing: "content-box",
  });
  editable.value = session.initialText;

  const getLiveElement = (): NonDeleted<RegionTextElement> => {
    const latest = app.scene.getNonDeletedElement(element.id);
    return latest &&
      (latest.type === "composite" ||
        latest.type === "flow" ||
        latest.type === "dataflow" ||
        latest.type === "stickynote" ||
        latest.type === "table" ||
        latest.type === "sequence" ||
        latest.type === "mindmap-node" ||
        latest.type === "arrow" ||
        latest.type === "line")
      ? latest
      : element;
  };

  /** 单行区域把硬换行折叠成空格，并保持光标位置。 */
  const normalizeSingleLineInput = () => {
    const normalized = normalizeSingleLineText(editable.value);
    if (normalized === editable.value) {
      return;
    }
    const caret = editable.selectionEnd ?? editable.value.length;
    const caretAfter = normalizeSingleLineText(
      editable.value.slice(0, caret),
    ).length;
    editable.value = normalized;
    editable.setSelectionRange(caretAfter, caretAfter);
  };

  /**
   * 覆盖层几何全部从 reflow 后的元素派生：区域宽高、字号 fit、对齐都读
   * 当前 layout，和画布保持同一份事实。
   */
  const updateLayout = () => {
    const current = getLiveElement();
    const regionDefinition = getTextRegions(current).find(
      (definition) => definition.key === region,
    );
    if (!regionDefinition) {
      return;
    }

    const local = getLocalTextRegionLayout(current, region, {
      defaultStyle: style,
      elementsMap: app.scene.getNonDeletedElementsMap(),
    });
    if (!local) {
      return;
    }

    const width = regionDefinition.bounds.width;
    const lineHeightPx = getLineHeightInPx(local.fontSize, local.lineHeight);
    // 5% 缓冲避免重新布局时编辑框抖动
    const height = Math.max(local.height, lineHeightPx) * 1.05;

    let centerX: number;
    let centerY: number;
    let angle: number;
    if (region === "label" && isLinearElement(current)) {
      // 标签以路径锚点为中心，且编辑框始终保持水平
      const sceneLayout = LinearElementEditor.getLabelSceneLayout(
        current,
        app.scene.getNonDeletedElementsMap(),
        { defaultStyle: style },
      );
      centerX = sceneLayout.x + sceneLayout.width / 2;
      centerY = sceneLayout.y + sceneLayout.height / 2;
      angle = 0;
    } else {
      // 未旋转坐标下的编辑框中心，绕元素中心旋转后得到场景坐标
      const center = pointFrom(
        current.x + regionDefinition.bounds.x + width / 2,
        current.y + local.y + height / 2,
      );
      const elementCenter = pointFrom(
        current.x + current.width / 2,
        current.y + current.height / 2,
      );
      [centerX, centerY] = pointRotateRads(
        center,
        elementCenter,
        current.angle as Radians,
      );
      angle = current.angle;
    }
    const [viewportX, viewportY] = getViewportCoords(
      centerX - width / 2,
      centerY - height / 2,
    );

    const maxHeight = (app.state.height - viewportY) / app.state.zoom.value;

    Object.assign(editable.style, {
      font: getFontString({
        fontSize: local.fontSize,
        fontFamily: local.fontFamily,
        ...(local.fontWeight !== undefined
          ? { fontWeight: local.fontWeight }
          : {}),
      }),
      lineHeight: String(local.lineHeight),
      width: `${width}px`,
      height: `${height}px`,
      left: `${viewportX}px`,
      top: `${viewportY}px`,
      transform: getTransform(
        width,
        height,
        angle,
        app.state,
        width,
        maxHeight,
      ),
      textAlign: local.textAlign,
      color: applyDarkModeFilter(
        local.color ?? current.strokeColor,
        app.state.theme === THEME.DARK,
      ),
      opacity: String(current.opacity / 100),
      maxHeight: `${maxHeight}px`,
    });
    editable.scrollTop = 0;
  };

  let observer: ResizeObserver | null = null;
  let isCleanedUp = false;

  const cleanup = () => {
    if (isCleanedUp) {
      return;
    }
    isCleanedUp = true;
    editable.onblur = null;
    editable.oninput = null;
    editable.onkeydown = null;
    editable.onpointerdown = null;
    observer?.disconnect();
    ownerWindow.removeEventListener("resize", updateLayout);
    ownerWindow.removeEventListener("scroll", updateLayout, true);
    ownerWindow.removeEventListener("pointerdown", onPointerDown, true);
    ownerWindow.removeEventListener("blur", handleSubmit);
    ownerWindow.removeEventListener("beforeunload", handleSubmit);
    // 应用可能在编辑过程中被卸载，此时场景已销毁，解绑会抛错
    try {
      unbindUpdate();
    } catch {
      // 场景已销毁，无需解绑
    }
    editable.remove();
    if (app.textWysiwygSubmitHandler === handleSubmit) {
      app.textWysiwygSubmitHandler = null;
    }
  };

  const handleSubmit = () => {
    if (isFinished) {
      return;
    }
    isFinished = true;
    const nextText = editable.value;
    // 先清理再提交，避免移除 textarea 时触发 blur 造成重复提交
    cleanup();
    onCommit(nextText);
  };

  const handleCancel = () => {
    if (isFinished) {
      return;
    }
    isFinished = true;
    cleanup();
    onCancel();
  };

  /** 点击编辑框之外即提交；捕获阶段先于画布自己的 pointerdown 处理 */
  const onPointerDown = (event: PointerEvent) => {
    if (
      event.target instanceof ownerWindow.Node &&
      editable.contains(event.target)
    ) {
      return;
    }
    handleSubmit();
  };

  /** 单行区域先折叠硬换行，再交给 scene 与覆盖层共用。 */
  const normalizeInput = () => {
    const current = getLiveElement();
    const definition = getTextRegions(current).find(
      (candidate) => candidate.key === region,
    );
    if (definition?.wrap === "single-line") {
      normalizeSingleLineInput();
    }
  };

  /** 输入即写回：文本与几何一起进 scene，覆盖层随后从新元素派生位置。 */
  const applyDraft = () => {
    if (editable.value === lastAppliedText) {
      return;
    }
    lastAppliedText = editable.value;
    isApplyingDraft = true;
    try {
      onChange(editable.value);
    } finally {
      isApplyingDraft = false;
    }
  };

  editable.oninput = () => {
    normalizeInput();
    applyDraft();
    updateLayout();
  };

  editable.onkeydown = (event) => {
    // 输入法组合期间只处理组合本身
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === KEYS.ESCAPE) {
      event.preventDefault();
      handleCancel();
    }
  };

  editable.onpointerdown = (event) => event.stopPropagation();

  const unbindUpdate = app.scene.onUpdate(() => {
    if (!isApplyingDraft) {
      updateLayout();
    }
  });

  updateLayout();

  const editorContainer =
    excalidrawContainer?.querySelector(".excalidraw-textEditorContainer") ??
    excalidrawContainer;
  editorContainer?.appendChild(editable);

  editable.focus();
  if (autoSelect) {
    editable.select();
  } else {
    editable.setSelectionRange(editable.value.length, editable.value.length);
  }

  // 工具弹层的焦点恢复可能晚于创建：先不绑定 blur，等它落定后重新聚焦再接管
  ownerWindow.setTimeout(() => {
    if (isFinished) {
      return;
    }
    editable.onblur = handleSubmit;
    editable.focus();
  }, 0);

  // 视野变化后重新定位；宿主窗口不一定 resize，优先观察画布本身
  if (canvas && "ResizeObserver" in ownerWindow) {
    observer = new ownerWindow.ResizeObserver(() => {
      updateLayout();
    });
    observer.observe(canvas);
  } else {
    ownerWindow.addEventListener("resize", updateLayout);
  }
  ownerWindow.addEventListener("scroll", updateLayout, true);
  ownerWindow.addEventListener("blur", handleSubmit);
  ownerWindow.addEventListener("beforeunload", handleSubmit);

  // rAF 后再监听，避免捕获到触发本次编辑的 pointerdown
  ownerWindow.requestAnimationFrame(() => {
    ownerWindow.addEventListener("pointerdown", onPointerDown, {
      capture: true,
    });
  });

  return handleSubmit;
};
