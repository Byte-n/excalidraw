import { KEYS, getGridPoint } from "@excalidraw/common";

import { buildMindmapGraphFromTree } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { getLanguage } from "../i18n";

import {
  buildPresetPreviewElements,
  getMindmapPresetTree,
  hasCreationPreview,
  PREVIEW_ELEMENT_ID,
} from "./app/createPresets";

import type App from "./App";
import type { KeyboardModifiersObject, ToolType } from "../types";

/** 跟随光标的预览锚点：光标落点 */
type ScenePoint = { x: number; y: number };

/** 指针移动事件里预览要用到的部分（拿到 ctrl 以决定要不要吸附网格） */
type PreviewPointerEvent = KeyboardModifiersObject & { pointerType?: string };

/**
 * 选中创建工具后跟随鼠标的半透明预览。
 *
 * 预览元素**只存在于这里**——不进 scene、不进 store、不进历史，协作端看不到；
 * 指针按下后由真正的 `newElement` 接管，因此一个没落地的预览不会留下任何痕迹。
 * 绘制复用工具栏拖拽预览那一套（`NewElementCanvas` + `TOOL_DRAG_PREVIEW_OPACITY`）。
 *
 * 预设的内容与尺寸来自 `app/createPresets`，与「单击落地」同源：预览里看到的
 * 就是点下去会得到的东西。
 */
export class AppCreatePreview {
  constructor(private app: App) {}

  /** 当前的预览元素，`null` 表示不显示 */
  public elements: readonly NonDeletedExcalidrawElement[] | null = null;

  /**
   * 建好的预设（以原点为锚）。建图要测量文字，因此**不每次 pointermove 重建**：
   * 移动只做整体平移——思维导图连线是边局部坐标（调用方负责平移），改 x/y 即可。
   */
  private cache: {
    tool: ToolType | "custom";
    /** 影响外观的 AppState 切片；变了就得重建 */
    fingerprint: string;
    elements: readonly NonDeletedExcalidrawElement[];
    /** 平移的参照元素：单元素工具是它自己，思维导图是根节点 */
    anchorId: string;
  } | null = null;

  /**
   * 悬停更新。仅鼠标/笔（触摸没有悬停态）；拖拽工具按钮外出、切到非创建工具、
   * 或框架正在创建元素时都会收起预览。
   */
  handlePointerMove = (
    tool: ToolType | "custom",
    scenePoint: ScenePoint,
    event: PreviewPointerEvent,
  ) => {
    if (event.pointerType === "touch" || !hasCreationPreview(tool)) {
      this.clear();
      return;
    }
    // 工具栏拖出的预览优先：它在 drag 期间由 `app.toolDrag.preview` 画
    if (this.app.toolDrag.isDragging()) {
      this.clear();
      return;
    }

    const cached = this.ensureCache(tool);
    if (!cached) {
      this.clear();
      return;
    }
    const anchor = cached.elements.find(
      (element) => element.id === cached.anchorId,
    );
    if (!anchor) {
      this.clear();
      return;
    }

    const [x, y] = getGridPoint(
      scenePoint.x,
      scenePoint.y,
      event[KEYS.CTRL_OR_CMD] ? null : this.app.getEffectiveGridSize(),
    );
    this.elements = translate(cached.elements, x - anchor.x, y - anchor.y);
    // 画布是命令式绘制的，React 侧不会因为这里的赋值重绘
    this.app.triggerRender();
  };

  /** 收起预览；没有预览时不重绘 */
  clear = () => {
    if (this.elements === null) {
      return;
    }
    this.elements = null;
    this.app.triggerRender();
  };

  private ensureCache(tool: ToolType | "custom") {
    const fingerprint = this.getFingerprint();
    if (
      this.cache &&
      this.cache.tool === tool &&
      this.cache.fingerprint === fingerprint
    ) {
      return this.cache;
    }
    this.cache = this.build(tool, fingerprint);
    return this.cache;
  }

  /** 建一次预设，锚在原点：单元素工具是左上角在原点的那一个，思维导图是根节点左上角在原点的那张图 */
  private build(tool: ToolType | "custom", fingerprint: string) {
    if (tool === "mindmap") {
      const { elements, rootId } = buildMindmapGraphFromTree(
        getMindmapPresetTree(),
        { x: 0, y: 0 },
        {},
        // 固定身份：预览不得推进共享的 id / 随机序列
        (index) => ({ id: `${PREVIEW_ELEMENT_ID}:${index}`, seed: index + 1 }),
      );
      // 刚建出来的元素，永远不会是已删除的
      return {
        tool,
        fingerprint,
        elements: elements as readonly NonDeletedExcalidrawElement[],
        anchorId: rootId,
      };
    }
    const elements = buildPresetPreviewElements(this.app, tool as ToolType, {
      x: 0,
      y: 0,
    });
    const anchor = elements[0];
    return anchor ? { tool, fingerprint, elements, anchorId: anchor.id } : null;
  }

  /**
   * 外观指纹：这些字段一变，预览就得重建（否则会画着上一个样式）。
   * 思维导图的层级主题随深浅主题取值，所以 theme 也在内。
   */
  private getFingerprint = () => {
    const { state } = this.app;
    return [
      state.theme,
      state.currentItemStrokeColor,
      state.currentItemBackgroundColor,
      state.currentItemFillStyle,
      state.currentItemStrokeWidthKey,
      state.currentItemStrokeStyle,
      state.currentItemOpacity,
      state.currentItemRoundness,
      state.preferredGenericShape,
      state.currentItemStickynoteBackgroundColor,
      state.currentItemStickynoteStrokeColor,
      // 表格预设换一张、单元文字的字体换一个，预览里的表都得重建
      state.currentTablePreset,
      state.currentItemFontFamily,
      // 思维导图的占位文字随语言变化，预设图因此也要跟着重建
      getLanguage().code,
    ].join("|");
  };
}

/** 整体平移：大小与相对关系不变，只改 x/y（连线是边局部坐标，同样只需平移） */
const translate = <TElement extends ExcalidrawElement>(
  elements: readonly TElement[],
  dx: number,
  dy: number,
): readonly TElement[] =>
  elements.map(
    (element) =>
      ({ ...element, x: element.x + dx, y: element.y + dy } as TElement),
  );
