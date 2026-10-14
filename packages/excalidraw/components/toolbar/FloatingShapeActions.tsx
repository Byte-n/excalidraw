import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";

import { showSelectedShapeActions } from "@excalidraw/element";
// 注意：从子路径直接导入，绕开包 index 的 `export *` 在某些导入顺序下
// （如测试先导入 @excalidraw/element/tableScene）因自身循环引用
// （bounds → linearElementEditor → index）产生的部分快照问题
import { getCommonBounds } from "@excalidraw/element/bounds";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import {
  actionToggleElementLock,
  actionToggleLinearEditor,
} from "../../actions";
import { t } from "../../i18n";
import { getSelectedElements } from "../../scene";

import { FloatbarShapeActions } from "../Actions";
import {
  useApp,
  useEditorInterface,
  useExcalidrawActionManager,
  useExcalidrawAppState,
  useExcalidrawContainer,
  useExcalidrawElements,
} from "../App";
import { CloseIcon, LockedIconFilled } from "../icons";

import {
  getSelectionFloatbarLayout,
  getToolConfigFloatbarLayout,
  type ContainerRect,
} from "./floatingPosition";

import "./toolbar.scss";

/**
 * 工具配置态（无选区等作用对象）仍在顶部展示配置栏的工具：
 * 箭头连接 / 线条 / 自由书写 / 文字 / 便签。其余绘制工具（形状、图片、
 * 画框等）激活但未落笔时不展示浮动栏
 */
const TOOL_CONFIG_BAR_TOOLS: ReadonlySet<string> = new Set([
  "arrow",
  "line",
  "freedraw",
  "text",
  "stickynote",
]);

/**
 * 跟随选区的浮动胶囊工具栏（桌面/平板），替换原 full/compact 左侧面板。
 * 设计稿：docs/design-ui/excalidraw-canvas-toolbar.html §2「容器结构」。
 *
 * - 选中态：锚定选区包围盒（上方居中，不足翻到下方，左右出界收敛）
 * - 无选中·工具配置态：固定视口顶部居中（主工具条下方 12px）
 * - 裁剪/编辑节点模式：整体替换为模式条（裁剪拖动时不隐藏）
 * - 全锁定选区：内联「已锁定 + 解锁」
 *
 * 栏内分组内容（T3 起）为场景矩阵的统一渲染：桌面/平板同源
 * （FloatbarShapeActions），尺寸也同档——不再按 formFactor 区分触控放大。
 *
 * 注意：必须经 useExcalidrawAppState（而非 LayerUI props）取状态——
 * LayerUI 的 memo 比较剥离了 scrollX/scrollY/zoom，只有 context 才能保证
 * 滚动/缩放时位置跟随（与 ElementCanvasButtons 同路径）。
 */
export const FloatingShapeActions = () => {
  const app = useApp();
  const appState = useExcalidrawAppState();
  const elements = useExcalidrawElements();
  const actionManager = useExcalidrawActionManager();
  const editorInterface = useEditorInterface();
  const { container } = useExcalidrawContainer();

  const barRef = useRef<HTMLDivElement | null>(null);
  // 浮动栏尺寸（固定 100%，不随画布缩放变化）
  const [barSize, setBarSize] = useState({ width: 0, height: 0 });
  // 顶部主工具条占用区（容器坐标）：无选中态锚点 + 翻转避让
  const [topUIRect, setTopUIRect] = useState<ContainerRect | null>(null);

  // 有作用对象（选区 / 文字编辑 / 表格选区 / 裁剪 / 节点编辑模式）时照常展示；
  // 否则为工具配置态，仅 TOOL_CONFIG_BAR_TOOLS 中的工具展示
  const hasActionTarget = Boolean(
    appState.croppingElementId ||
      appState.selectedLinearElement?.isEditing ||
      appState.editingTextElement ||
      appState.tableCellSelection ||
      appState.tableRowColSelection ||
      getSelectedElements(elements, appState).length,
  );

  const visible =
    editorInterface.formFactor !== "phone" &&
    !appState.zenModeEnabled &&
    showSelectedShapeActions(appState, elements) &&
    (hasActionTarget || TOOL_CONFIG_BAR_TOOLS.has(appState.activeTool.type));

  // 每次渲染后复核尺寸（内容随场景/选区变化就地更新，不做重排动效）；
  // appState 在每次状态更新后变更引用，量测随之保持新鲜
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (bar) {
      const { offsetWidth, offsetHeight } = bar;
      setBarSize((prev) =>
        prev.width === offsetWidth && prev.height === offsetHeight
          ? prev
          : { width: offsetWidth, height: offsetHeight },
      );
    }

    if (container) {
      const containerRect = container.getBoundingClientRect();
      let next: ContainerRect | null = null;
      for (const node of container.querySelectorAll<HTMLElement>(
        "[data-viewport-ui='top']",
      )) {
        const rect = node.getBoundingClientRect();
        if (!rect.width && !rect.height) {
          continue;
        }
        const rel = {
          left: rect.left - containerRect.left,
          top: rect.top - containerRect.top,
          right: rect.right - containerRect.left,
          bottom: rect.bottom - containerRect.top,
        };
        next = next
          ? {
              left: Math.min(next.left, rel.left),
              top: Math.min(next.top, rel.top),
              right: Math.max(next.right, rel.right),
              bottom: Math.max(next.bottom, rel.bottom),
            }
          : rel;
      }
      setTopUIRect((prev) =>
        prev === next ||
        (prev &&
          next &&
          prev.left === next.left &&
          prev.top === next.top &&
          prev.right === next.right &&
          prev.bottom === next.bottom)
          ? prev
          : next,
      );
    }
  }, [appState, container, visible]);

  // 尺寸随内容/容器变化时的兜底量测（如字体载入、窗口缩放）
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof app.ownerWindow.ResizeObserver !== "function") {
      return;
    }
    const observer = new app.ownerWindow.ResizeObserver(() => {
      setBarSize((prev) =>
        prev.width === bar.offsetWidth && prev.height === bar.offsetHeight
          ? prev
          : { width: bar.offsetWidth, height: bar.offsetHeight },
      );
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, [visible, app.ownerWindow]);

  if (!visible) {
    return null;
  }

  const elementsMap = app.scene.getNonDeletedElementsMap();
  const selectedElements = getSelectedElements(elements, appState);

  const croppingElementId = appState.croppingElementId;
  const isLinearEditing = !!appState.selectedLinearElement?.isEditing;
  const isAllLocked =
    selectedElements.length > 0 &&
    selectedElements.every((element) => element.locked);

  // 锚定元素：裁剪/编辑节点模式锚定目标元素；单元格/行列选区锚定表格；
  // 否则为整个选区；无选区（工具配置态）则不锚定、固定顶部居中
  let anchorElements: readonly NonDeletedExcalidrawElement[] = [];
  if (croppingElementId) {
    const element = elementsMap.get(croppingElementId);
    if (element) {
      anchorElements = [element];
    }
  } else if (isLinearEditing) {
    const element = elementsMap.get(appState.selectedLinearElement!.elementId);
    if (element) {
      anchorElements = [element];
    }
  } else if (selectedElements.length) {
    anchorElements = selectedElements;
  } else {
    const tableId =
      appState.tableCellSelection?.tableId ??
      appState.tableRowColSelection?.tableId;
    const table = tableId ? elementsMap.get(tableId) : null;
    if (table) {
      anchorElements = [table];
    }
  }

  // 拖动/缩放/旋转选区时隐藏、松手复位；裁剪模式豁免（拖裁剪框不隐藏）
  const transientlyHidden =
    !croppingElementId &&
    (appState.selectedElementsAreBeingDragged ||
      appState.isResizing ||
      appState.isRotating ||
      !!appState.resizingElement);

  // 容器（.layer-ui__wrapper）尺寸；jsdom 下 clientWidth 为 0，回退 appState
  const parent = barRef.current?.parentElement;
  const containerSize = {
    width: parent?.clientWidth || container?.clientWidth || appState.width,
    height: parent?.clientHeight || container?.clientHeight || appState.height,
  };

  const layout = anchorElements.length
    ? getSelectionFloatbarLayout({
        selectionBounds: getCommonBounds(anchorElements, elementsMap),
        barSize,
        containerSize,
        appState,
        topUIRect,
      })
    : getToolConfigFloatbarLayout({
        barSize,
        containerSize,
        topUIBottom: topUIRect?.bottom ?? 0,
      });

  let ariaLabel: string;
  let content: React.ReactNode;

  if (croppingElementId) {
    // 模式条：裁剪图片 + 取消（还原到进入时状态）+ 应用
    ariaLabel = t("labels.floatbar.cropImage");
    content = (
      <>
        <span className="tb-floatbar__label">
          {t("labels.floatbar.cropImage")}
        </span>
        <button
          type="button"
          className="tb-iconbtn"
          aria-label={t("buttons.cancel")}
          title={t("buttons.cancel")}
          onClick={() => app.cancelImageCropping()}
        >
          {CloseIcon}
        </button>
        <button
          type="button"
          className="tb-btn-primary"
          onClick={() => app.finishImageCropping()}
        >
          {t("labels.floatbar.apply")}
        </button>
      </>
    );
  } else if (isLinearEditing) {
    // 模式条：编辑节点 + 完成
    ariaLabel = t("labels.floatbar.editNodes");
    content = (
      <>
        <span className="tb-floatbar__label">
          {t("labels.floatbar.editNodes")}
        </span>
        <button
          type="button"
          className="tb-btn-primary"
          onClick={() => actionManager.executeAction(actionToggleLinearEditor)}
        >
          {t("buttons.done")}
        </button>
      </>
    );
  } else if (isAllLocked) {
    // 全锁定选区：内联「已锁定 + 解锁」，不显示属性分组
    ariaLabel = t("labels.floatbar.locked");
    content = (
      <>
        <span className="tb-floatbar__label tb-floatbar__label--icon">
          {LockedIconFilled}
        </span>
        <span className="tb-floatbar__label">
          {t("labels.floatbar.locked")}
        </span>
        <button
          type="button"
          className="tb-btn-primary"
          onClick={() => actionManager.executeAction(actionToggleElementLock)}
        >
          {t("labels.floatbar.unlock")}
        </button>
      </>
    );
  } else {
    ariaLabel = anchorElements.length
      ? t("labels.floatbar.selection")
      : t("labels.floatbar.toolDefaults");
    content = (
      <FloatbarShapeActions
        appState={appState}
        elementsMap={elementsMap}
        renderAction={actionManager.renderAction}
        app={app}
        setAppState={app.setAppState}
      />
    );
  }

  return (
    <div
      ref={barRef}
      className={clsx("tb-floatbar", {
        "is-hidden": transientlyHidden,
      })}
      role="toolbar"
      aria-label={ariaLabel}
      style={{
        left: layout.left,
        top: layout.top,
      }}
    >
      {content}
    </div>
  );
};
