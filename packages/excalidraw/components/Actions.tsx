import {
  setTableSceneCellStyle,
  setTableSceneStyle,
} from "@excalidraw/element/tableScene";

import clsx from "clsx";
import { useRef } from "react";
import { Popover } from "radix-ui";

import {
  CLASSES,
  COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_COLOR_INDEX,
  TABLE_LINE_PICKS,
  TABLE_STYLE,
  THEME,
  applyDarkModeFilter,
} from "@excalidraw/common";

import {
  getMindmapShapeId,
  isArrowElement,
  isEmbeddableElement,
  isFrameLikeElement,
  isMindmapEdgeElement,
  isTableElement,
  getTableCellFillColor,
  getTableCellRange,
  getCellsInTableRange,
  isTableCellTransparent,
  resolveTableColor,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedElementsMap,
  NonDeletedSceneElementsMap,
  MindmapNodeShape,
  MindmapLayoutDirection,
  MindmapEdgeRouting,
  StrokeStyle,
} from "@excalidraw/element/types";

import { actionToggleZenMode } from "../actions";

import { t, type TranslationKeys } from "../i18n";
import { getSelectedElements, getTargetElements } from "../scene";
import { getShortcutKey } from "../shortcut";

import { getFormValue } from "../actions/actionProperties";

import { useTextEditorFocus } from "../hooks/useTextEditorFocus";
import { useSceneNonce } from "../hooks/useSceneNonce";

import { actionToggleViewMode } from "../actions/actionToggleViewMode";

import "./Actions.scss";

import { useExcalidrawContainer, useAppProps } from "./App";
import { IconButton } from "./IconButton";
import Stack from "./Stack";
import { Tooltip } from "./Tooltip";
import { PropertiesPopover } from "./PropertiesPopover";
import { ColorPicker } from "./ColorPicker/ColorPicker";
import { getContextMenuLabel, HyperlinkContent } from "./hyperlink/Hyperlink";
import { RadioSelection } from "./RadioSelection";
import { Range } from "./Range";
import { CheckboxItem } from "./CheckboxItem";
import {
  sharpArrowIcon,
  roundArrowIcon,
  elbowArrowIcon,
  TextSizeIcon,
  adjustmentsIcon,
  DotsHorizontalIcon,
  pencilIcon,
  RectangleIcon,
  EllipseIcon,
  DiamondIcon,
  ArrowRightIcon,
  CenterHorizontallyIcon,
  LayersIcon,
  LinkIcon,
  StrokeWidthBaseIcon,
  StrokeStyleDashedIcon,
  StrokeStyleDottedIcon,
  TextAlignLeftIcon,
  TextAlignCenterIcon,
  TextAlignRightIcon,
  tableCellSelectIcon,
  tableCellMultiSelectIcon,
  tableCellMergeIcon,
} from "./icons";

import { ToolbarGroup } from "./toolbar/ToolbarGroup";
import { ToolbarMoreMenu } from "./toolbar/ToolbarMoreMenu";

import { getShapeActionPredicates } from "./shapeActionPredicates";

import type { ShapeActionPredicates } from "./shapeActionPredicates";
import type { AppClassProperties, UIAppState, AppState } from "../types";
import type { ActionManager } from "../actions/manager";

// re-exported for consumers outside the styles panel (e.g. CommandPalette)
export {
  canChangeStrokeColor,
  canChangeBackgroundColor,
} from "./shapeActionPredicates";

// Common CSS class combinations
const PROPERTIES_CLASSES = clsx([
  CLASSES.SHAPE_ACTIONS_THEME_SCOPE,
  "properties-content",
]);

const MINDMAP_SHAPES: readonly [MindmapNodeShape, React.ReactNode][] = [
  ["rectangle", RectangleIcon],
  ["ellipse", EllipseIcon],
  ["diamond", DiamondIcon],
  ["pill", RectangleIcon],
];

const MINDMAP_DIRECTIONS: readonly [MindmapLayoutDirection, TranslationKeys][] =
  [
    ["left-to-right", "labels.mindmapDirectionLeftToRight"],
    ["right-to-left", "labels.mindmapDirectionRightToLeft"],
    ["top-to-bottom", "labels.mindmapDirectionTopToBottom"],
    ["bottom-to-top", "labels.mindmapDirectionBottomToTop"],
  ];

type MindmapEdgeStyle = {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  routing: MindmapEdgeRouting;
};

/** 连线颜色色板（浮动栏外露，走统一 ColorPicker 弹层） */
const MindmapEdgeColorPicker = ({
  style,
  onChange,
  app,
  appState,
}: {
  style: MindmapEdgeStyle;
  onChange: (update: Partial<MindmapEdgeStyle>) => void;
  app: AppClassProperties;
  appState: UIAppState;
}) => (
  <ColorPicker
    type="mindmapEdgeColor"
    label={t("labels.mindmapEdgeColor")}
    color={style.strokeColor}
    onChange={(strokeColor) => onChange({ strokeColor })}
    palette={DEFAULT_ELEMENT_STROKE_COLOR_PALETTE}
    compact
    elements={app.scene.getNonDeletedElements()}
    appState={appState}
    updateData={(state) => app.setState(state)}
  />
);

/**
 * 弹层内嵌的连线颜色色板行：弹层内不再开弹层（设计稿「最多一个、嵌套 ≤2 级」
 * 且 openPopup 单值互斥），故内嵌场景用行内色板而非 ColorPicker 弹层；
 * 透明不在备选（连线不可见没有意义，与既有原生取色行为一致）。
 */
const MindmapEdgeColorSwatches = ({
  color,
  onChange,
  appState,
}: {
  color: string;
  onChange: (color: string) => void;
  appState: UIAppState;
}) => (
  <div className="buttonList" role="radiogroup" aria-label={t("labels.color")}>
    {Object.entries(DEFAULT_ELEMENT_STROKE_COLOR_PALETTE).map(
      ([name, value]) => {
        const swatchColor = Array.isArray(value)
          ? value[DEFAULT_ELEMENT_STROKE_COLOR_INDEX]
          : value;
        if (!swatchColor || swatchColor === COLOR_PALETTE.transparent) {
          return null;
        }
        const displayColor = applyDarkModeFilter(
          swatchColor,
          appState.theme === THEME.DARK,
        );
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={color === swatchColor}
            className={clsx("color-picker__button", {
              active: color === swatchColor,
            })}
            style={{ "--swatch-color": displayColor } as React.CSSProperties}
            title={swatchColor}
            aria-label={swatchColor}
            data-testid={`mindmap-edge-color-${name}`}
            onClick={() => onChange(swatchColor)}
          >
            <div className="color-picker__button-outline" />
          </button>
        );
      },
    )}
  </div>
);

/**
 * 连线样式四子组：颜色 / 宽度 / 线型 / 路径（曲线·正交）——
 * 设计稿「思维导图 · 连线」，弃用原生 color/number 输入，色板 + 滑杆 +
 * 分段选择器。整树「默认连线」、节点「入边样式」、选中连线三处共用；
 * includeColor=false 时省略颜色子组（色板已外露于浮动栏）。
 */
const MindmapEdgeStyleControls = ({
  title,
  style,
  onChange,
  appState,
  includeColor = true,
}: {
  title: string;
  style: MindmapEdgeStyle;
  onChange: (update: Partial<MindmapEdgeStyle>) => void;
  appState: UIAppState;
  includeColor?: boolean;
}) => (
  <ToolbarGroup legend={title} className="mindmap-style-panel__edge">
    {includeColor && (
      <ToolbarGroup legend={t("labels.color")}>
        <MindmapEdgeColorSwatches
          color={style.strokeColor}
          onChange={(strokeColor) => onChange({ strokeColor })}
          appState={appState}
        />
      </ToolbarGroup>
    )}
    <ToolbarGroup legend={t("labels.width")}>
      <Range
        label={t("labels.width")}
        hideLabel
        value={style.strokeWidth}
        onChange={(strokeWidth) => onChange({ strokeWidth })}
        min={0.5}
        max={8}
        step={0.5}
        testId="mindmap-edge-width"
      />
    </ToolbarGroup>
    <ToolbarGroup legend={t("labels.lineStyle")}>
      <RadioSelection<StrokeStyle>
        group="mindmap-edge-line"
        options={[
          {
            value: "solid",
            text: t("labels.strokeStyle_solid"),
            icon: StrokeWidthBaseIcon,
            testId: "mindmap-edge-line-solid",
          },
          {
            value: "dashed",
            text: t("labels.strokeStyle_dashed"),
            icon: StrokeStyleDashedIcon,
            testId: "mindmap-edge-line-dashed",
          },
          {
            value: "dotted",
            text: t("labels.strokeStyle_dotted"),
            icon: StrokeStyleDottedIcon,
            testId: "mindmap-edge-line-dotted",
          },
        ]}
        value={style.strokeStyle}
        onChange={(strokeStyle) => onChange({ strokeStyle })}
      />
    </ToolbarGroup>
    <ToolbarGroup legend={t("labels.edgeRouting")}>
      <RadioSelection<MindmapEdgeRouting>
        group="mindmap-edge-routing"
        options={[
          {
            value: "orthogonal",
            text: t("labels.edgeRoutingOrthogonal"),
            icon: elbowArrowIcon,
            testId: "mindmap-edge-routing-orthogonal",
          },
          {
            value: "curved",
            text: t("labels.edgeRoutingCurved"),
            icon: roundArrowIcon,
            testId: "mindmap-edge-routing-curved",
          },
        ]}
        value={style.routing}
        onChange={(routing) => onChange({ routing })}
      />
    </ToolbarGroup>
  </ToolbarGroup>
);

/** 整树 ·「布局方向」分组内容 */
const MindmapGraphDirectionGroup = ({ app }: { app: AppClassProperties }) => {
  const root = app.mindmap.getSelectedGraphRoot();
  if (!root) {
    return null;
  }
  const disabled = !app.mindmap.canEditNode(root.id);
  return (
    <ToolbarGroup legend={t("labels.mindmapLayoutDirection")}>
      <div className="buttonList">
        {MINDMAP_DIRECTIONS.map(([direction, labelKey]) => (
          <IconButton
            key={direction}
            type="toggle"
            icon={
              <span
                className={`mindmap-direction-icon mindmap-direction-icon--${direction}`}
              >
                {ArrowRightIcon}
              </span>
            }
            checked={(root.layoutDirection ?? "left-to-right") === direction}
            disabled={disabled}
            title={t(labelKey)}
            aria-label={t(labelKey)}
            data-testid={`mindmap-direction-${direction}`}
            onSelect={() => app.mindmap.setLayoutConfig({ direction })}
          />
        ))}
      </div>
    </ToolbarGroup>
  );
};

/** 整树 ·「默认连线」分组内容（作用于整树未单独设置的分支） */
const MindmapGraphEdgeGroup = ({
  app,
  appState,
}: {
  app: AppClassProperties;
  appState: UIAppState;
}) => {
  const root = app.mindmap.getSelectedGraphRoot();
  if (!root) {
    return null;
  }
  return (
    <MindmapEdgeStyleControls
      title={t("labels.mindmapDefaultEdge")}
      style={{
        strokeColor: root.defaultEdgeStrokeColor ?? "#1b1b1f",
        strokeWidth: root.defaultEdgeStrokeWidth ?? 2,
        strokeStyle: root.defaultEdgeStrokeStyle ?? "solid",
        routing: root.defaultEdgeRouting ?? "orthogonal",
      }}
      onChange={app.mindmap.setGraphEdgeStyle}
      appState={appState}
    />
  );
};

/** 节点 ·「节点形状」分组内容（自动 / 矩形 / 椭圆 / 菱形 / 胶囊） */
const MindmapNodeShapeGroup = ({ app }: { app: AppClassProperties }) => {
  const node = app.mindmap.getSelectedNode();
  if (!node) {
    return null;
  }
  const derivedShape = app.mindmap.getDerivedNodeShape(node.id);
  return (
    <ToolbarGroup legend={t("labels.mindmapNodeShape")}>
      <div className="buttonList">
        {derivedShape && (
          <IconButton
            type="toggle"
            icon={<span aria-hidden="true">A</span>}
            checked={getMindmapShapeId(node) === derivedShape}
            title={t("labels.mindmapShapeAuto")}
            aria-label={t("labels.mindmapShapeAuto")}
            data-testid="mindmap-shape-auto"
            onSelect={() => app.mindmap.setNodeShape(derivedShape)}
          />
        )}
        {MINDMAP_SHAPES.map(([shape, icon]) => (
          <IconButton
            key={shape}
            type="toggle"
            icon={icon}
            checked={
              getMindmapShapeId(node) === shape && shape !== derivedShape
            }
            title={shape}
            aria-label={shape}
            data-testid={`mindmap-shape-${shape}`}
            onSelect={() => app.mindmap.setNodeShape(shape)}
          />
        ))}
      </div>
    </ToolbarGroup>
  );
};

/** 节点 ·「入边样式」分组内容（根节点无入边，渲染为空） */
const MindmapIncomingEdgeGroup = ({
  app,
  appState,
}: {
  app: AppClassProperties;
  appState: UIAppState;
}) => {
  const node = app.mindmap.getSelectedNode();
  if (!node) {
    return null;
  }
  const incomingEdge = app.scene
    .getNonDeletedElements()
    .find(
      (element) => isMindmapEdgeElement(element) && element.childId === node.id,
    );
  if (!incomingEdge || !isMindmapEdgeElement(incomingEdge)) {
    return null;
  }
  return (
    <MindmapEdgeStyleControls
      title={t("labels.mindmapIncomingEdge")}
      style={incomingEdge}
      onChange={app.mindmap.setIncomingEdgeStyle}
      appState={appState}
    />
  );
};

/**
 * The "arrange" (z-order) fieldset, identical across every styles-panel layout.
 */
const LayersFieldset = ({
  renderAction,
}: {
  renderAction: ActionManager["renderAction"];
}) => (
  <ToolbarGroup legend={t("labels.layers")}>
    <div className="buttonList">
      {renderAction("sendToBack")}
      {renderAction("sendBackward")}
      {renderAction("bringForward")}
      {renderAction("bringToFront")}
    </div>
  </ToolbarGroup>
);

/**
 * The align + distribute fieldset, identical across every styles-panel layout.
 * Button order is mirrored for RTL so the leftmost button always aligns left.
 */
const AlignFieldset = ({
  renderAction,
  showDistribute,
}: {
  renderAction: ActionManager["renderAction"];
  showDistribute: boolean;
}) => {
  const isRTL = document.documentElement.getAttribute("dir") === "rtl";

  return (
    <ToolbarGroup legend={t("labels.align")}>
      <div className="buttonList">
        {isRTL ? (
          <>
            {renderAction("alignRight")}
            {renderAction("alignHorizontallyCentered")}
            {renderAction("alignLeft")}
          </>
        ) : (
          <>
            {renderAction("alignLeft")}
            {renderAction("alignHorizontallyCentered")}
            {renderAction("alignRight")}
          </>
        )}
        {showDistribute && renderAction("distributeHorizontally")}
        {/* breaks the row ˇˇ */}
        <div style={{ flexBasis: "100%", height: 0 }} />
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: ".5rem",
            marginTop: "-0.5rem",
          }}
        >
          {renderAction("alignTop")}
          {renderAction("alignVerticallyCentered")}
          {renderAction("alignBottom")}
          {showDistribute && renderAction("distributeVertically")}
        </div>
      </div>
    </ToolbarGroup>
  );
};

/**
 * 浮动栏分组弹层：每组一个图标按钮，点击弹出该组的分组内容。
 * （弹层方向/箭头/碰撞等容器规格统一由 T4 处理，本任务沿用 PropertiesPopover。）
 */
const FloatbarPopupGroup = ({
  popup,
  label,
  icon,
  appState,
  setAppState,
  container,
  children,
}: {
  popup: NonNullable<AppState["openPopup"]>;
  label: string;
  icon: React.ReactNode;
  appState: UIAppState;
  setAppState: React.Component<any, AppState>["setState"];
  container: HTMLDivElement | null;
  children: React.ReactNode;
}) => {
  const isOpen = appState.openPopup === popup;
  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          setAppState({ openPopup: open ? popup : null });
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={clsx("compact-action-button properties-trigger", {
              active: isOpen,
            })}
            title={label}
            aria-label={label}
            data-testid={`floatbar-group-${popup}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setAppState({ openPopup: isOpen ? null : popup });
            }}
          >
            {icon}
          </button>
        </Popover.Trigger>
        {isOpen && (
          <PropertiesPopover
            className={PROPERTIES_CLASSES}
            container={container}
            label={label}
            style={{ maxWidth: "13rem" }}
            onClose={() => {}}
          >
            <div className="selected-shape-actions">{children}</div>
          </PropertiesPopover>
        )}
      </Popover.Root>
    </div>
  );
};

/** 「图层」弹层触发器 + 弹层内容（z-order 四动作） */
const LayersPopupGroup = ({
  renderAction,
  appState,
  setAppState,
  container,
}: {
  renderAction: ActionManager["renderAction"];
  appState: UIAppState;
  setAppState: React.Component<any, AppState>["setState"];
  container: HTMLDivElement | null;
}) => (
  <FloatbarPopupGroup
    popup="compactLayers"
    label={t("labels.layers")}
    icon={LayersIcon}
    appState={appState}
    setAppState={setAppState}
    container={container}
  >
    <LayersFieldset renderAction={renderAction} />
  </FloatbarPopupGroup>
);

/** 「对齐」弹层触发器 + 弹层内容（多选；超过 2 个元素追加分布） */
const AlignPopupGroup = ({
  renderAction,
  predicates,
  appState,
  setAppState,
  container,
}: {
  renderAction: ActionManager["renderAction"];
  predicates: ShapeActionPredicates;
  appState: UIAppState;
  setAppState: React.Component<any, AppState>["setState"];
  container: HTMLDivElement | null;
}) => (
  <FloatbarPopupGroup
    popup="compactAlign"
    label={t("labels.align")}
    icon={CenterHorizontallyIcon}
    appState={appState}
    setAppState={setAppState}
    container={container}
  >
    <AlignFieldset
      renderAction={renderAction}
      showDistribute={predicates.distribute}
    />
  </FloatbarPopupGroup>
);

/**
 * 「链接」入口 + 链接弹层（设计稿「链接弹层与联动态」）：
 * 自浮动栏链接按钮向下弹出 tb-pop，编辑/访问两态（内容与元素锚定卡片
 * 共用 HyperlinkContent）。仅点击按钮（或 Cmd+K / 右键菜单）弹出——选中
 * 带链接元素只高亮按钮，不再自动展开（showHyperlinkPopup 状态机）；
 * 与其他弹层互斥（openPopup 单值 + 此处开门；开启时清 openPopup，
 * 见 actionLink.perform）。
 */
const FloatbarLinkAction = ({
  app,
  appState,
  setAppState,
  container,
}: {
  app: AppClassProperties;
  appState: UIAppState;
  setAppState: React.Component<any, AppState>["setState"];
  container: HTMLDivElement | null;
}) => {
  const appProps = useAppProps();
  const elements = app.scene.getNonDeletedElements();
  const selectedElements = getSelectedElements(elements, appState);
  const element = selectedElements.length === 1 ? selectedElements[0] : null;

  // 与 openPopup 互斥：其他弹层开启期间访问/编辑态隐藏（状态保留，关闭后恢复）
  const isOpen = Boolean(
    element &&
      appState.showHyperlinkPopup &&
      !appState.openPopup &&
      // 与元素锚定卡片同一组暂隐条件（拖动/缩放/旋转/菜单/右键时隐藏）
      !appState.contextMenu &&
      !appState.selectedElementsAreBeingDragged &&
      !appState.resizingElement &&
      !appState.isRotating &&
      !appState.openMenu,
  );

  if (!element) {
    return null;
  }

  const label = t(getContextMenuLabel(elements, appState));

  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAppState({ showHyperlinkPopup: false });
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={clsx("compact-action-button properties-trigger", {
              active: isOpen || !!element.link,
            })}
            title={`${
              isEmbeddableElement(element)
                ? t("labels.link.labelEmbed")
                : t("labels.link.label")
            } - ${getShortcutKey("CtrlOrCmd+K")}`}
            aria-label={label}
            data-testid="floatbar-link"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // 有链接进访问态（可再点铅笔进编辑态），无链接直接进编辑态；
              // 与其他弹层互斥
              setAppState({
                showHyperlinkPopup: isOpen
                  ? false
                  : element.link
                  ? "info"
                  : "editor",
                openPopup: null,
              });
            }}
          >
            {LinkIcon}
          </button>
        </Popover.Trigger>
        {isOpen && (
          <PropertiesPopover
            className="properties-content"
            container={container}
            label={label}
            style={{ width: "15.75rem" }}
            onClose={() => {}}
          >
            <HyperlinkContent
              key={element.id}
              element={element}
              scene={app.scene}
              setAppState={setAppState}
              onLinkOpen={appProps.onLinkOpen}
              setToast={app.setToast}
              updateEmbedValidationStatus={app.updateEmbedValidationStatus}
            />
          </PropertiesPopover>
        )}
      </Popover.Root>
    </div>
  );
};

/**
 * Frame 场景：浮动栏「重命名」入口（聚焦画布标题输入框，双击标题同效） */
const FrameRenameAction = ({
  app,
  targetElements,
}: {
  app: AppClassProperties;
  targetElements: ExcalidrawElement[];
}) => {
  const frame = targetElements[0];
  if (!frame || !isFrameLikeElement(frame)) {
    return null;
  }
  return (
    <div className="compact-action-item">
      <IconButton
        type="button"
        icon={pencilIcon}
        title={t("labels.rename")}
        aria-label={t("labels.rename")}
        data-testid="frame-rename"
        onClick={() => app.setState({ editingFrame: frame.id })}
      />
    </div>
  );
};

/**
 * 浮动工具栏内容（桌面/平板共用）：场景矩阵的同一渲染源。
 * 高频色板（描边/背景）直接外露，其余每组一个图标按钮进弹层；
 * 分组集合与顺序 = 设计稿 §4 场景矩阵。
 */
export const FloatbarShapeActions = ({
  appState,
  elementsMap,
  renderAction,
  app,
  setAppState,
}: {
  appState: UIAppState;
  elementsMap: NonDeletedElementsMap | NonDeletedSceneElementsMap;
  renderAction: ActionManager["renderAction"];
  app: AppClassProperties;
  setAppState: React.Component<any, AppState>["setState"];
}) => {
  const targetElements = getTargetElements(elementsMap, appState);
  const predicates = getShapeActionPredicates(
    appState,
    targetElements,
    elementsMap,
    app,
  );
  const { container } = useExcalidrawContainer();
  const tableSelected =
    !!appState.tableCellSelection ||
    !!appState.tableRowColSelection ||
    targetElements.some(isTableElement);

  // —— 思维导图 · 连线：连线颜色色板外露 + 宽度/线型/路径弹层 ——
  const selectedMindmapEdge = app.mindmap.getSelectedEdge();
  if (selectedMindmapEdge) {
    return (
      <div className="selected-shape-actions">
        <div className="compact-action-item">
          <MindmapEdgeColorPicker
            style={selectedMindmapEdge}
            onChange={app.mindmap.setSelectedEdgeStyle}
            app={app}
            appState={appState}
          />
        </div>
        <span className="sep" />
        <FloatbarPopupGroup
          popup="mindmapEdgeStyle"
          label={t("labels.mindmapEdgeStyle")}
          icon={adjustmentsIcon}
          appState={appState}
          setAppState={setAppState}
          container={container}
        >
          <MindmapEdgeStyleControls
            title={t("labels.mindmapEdgeStyle")}
            style={selectedMindmapEdge}
            onChange={app.mindmap.setSelectedEdgeStyle}
            appState={appState}
            includeColor={false}
          />
        </FloatbarPopupGroup>
        <span className="sep" />
        {predicates.showExtraActions && (
          <ToolbarMoreMenu
            app={app}
            setAppState={setAppState}
            container={container}
          />
        )}
      </div>
    );
  }

  // —— 思维导图 · 整树（选中根节点）：布局方向 + 默认连线 ——
  const mindmapRoot = app.mindmap.getSelectedGraphRoot();
  if (mindmapRoot) {
    return (
      <div className="selected-shape-actions">
        <FloatbarPopupGroup
          popup="mindmapGraphDirection"
          label={t("labels.mindmapLayoutDirection")}
          icon={ArrowRightIcon}
          appState={appState}
          setAppState={setAppState}
          container={container}
        >
          <MindmapGraphDirectionGroup app={app} />
        </FloatbarPopupGroup>
        <FloatbarPopupGroup
          popup="mindmapGraphEdge"
          label={t("labels.mindmapDefaultEdge")}
          icon={elbowArrowIcon}
          appState={appState}
          setAppState={setAppState}
          container={container}
        >
          <MindmapGraphEdgeGroup app={app} appState={appState} />
        </FloatbarPopupGroup>
        <span className="sep" />
        {predicates.showExtraActions && (
          <ToolbarMoreMenu
            app={app}
            setAppState={setAppState}
            container={container}
          />
        )}
      </div>
    );
  }

  // 桶填充工具配置：背景色板（无透明）外露 + 填充样式/透明度进样式弹层
  if (appState.activeTool.type === "bucketfill") {
    return (
      <div className="selected-shape-actions">
        <div className="compact-action-item">
          {renderAction("changeBucketFillBackgroundColor")}
        </div>
        <span className="sep" />
        <CombinedShapeProperties
          appState={appState}
          renderAction={renderAction}
          setAppState={setAppState}
          predicates={predicates}
          container={container}
          app={app}
        />
      </div>
    );
  }

  // —— 表格 · 单元格选区：选区模式 / 合并 / 单元格背景色板 + 更多 ——
  if (appState.tableCellSelection) {
    return (
      <div className="selected-shape-actions">
        <TableCellCompactActions
          app={app}
          appState={appState}
          setAppState={setAppState}
        />
        <TableStyleActions app={app} appState={appState} variant="fill" />
        <span className="sep" />
        <ToolbarMoreMenu
          app={app}
          setAppState={setAppState}
          container={container}
        />
      </div>
    );
  }

  // —— 思维导图 · 节点：色板外露，节点形状 / 入边样式在分组触发区，图层进「更多」 ——
  const mindmapNode = app.mindmap.getSelectedNode();

  // 样式弹层承载的分组：填充 / 描边宽度 / 描边样式 / 边角 / 透明度（压感同组）；
  // 表格整体选中方有表格样式弹层，行/列选区仅外露色板
  const tableElementSelected = targetElements.some(isTableElement);
  const hasStyleGroups =
    tableElementSelected ||
    (!tableSelected &&
      (predicates.fill ||
        predicates.strokeWidth ||
        predicates.strokeStyle ||
        predicates.freedrawMode ||
        predicates.roundness ||
        predicates.opacity));
  const hasTextGroups = predicates.text;
  const hasMiddleGroups =
    !!mindmapNode ||
    predicates.frameRename ||
    predicates.cropEditor ||
    hasStyleGroups ||
    predicates.arrowType ||
    hasTextGroups;
  const hasTailActions =
    predicates.lineEditor ||
    predicates.link ||
    predicates.align ||
    (predicates.layers && !mindmapNode) ||
    predicates.showExtraActions;

  return (
    <div className="selected-shape-actions">
      {/* 表格：边框颜色 / 网格线颜色 / 背景颜色三色板外露 */}
      <TableStyleActions app={app} appState={appState} variant="fill" />

      {/* 外露色板：描边 / 背景 */}
      {!tableSelected && predicates.strokeColor && (
        <div className="compact-action-item">
          {renderAction("changeStrokeColor")}
        </div>
      )}
      {!tableSelected && predicates.backgroundColor && (
        <div className="compact-action-item">
          {renderAction("changeBackgroundColor")}
        </div>
      )}

      {hasMiddleGroups && <span className="sep" />}

      {/* 思维导图 · 节点：节点形状 / 入边样式（设计稿节点栏中段） */}
      {mindmapNode && (
        <>
          <FloatbarPopupGroup
            popup="mindmapNodeShape"
            label={t("labels.mindmapNodeShape")}
            icon={RectangleIcon}
            appState={appState}
            setAppState={setAppState}
            container={container}
          >
            <MindmapNodeShapeGroup app={app} />
          </FloatbarPopupGroup>
          <FloatbarPopupGroup
            popup="mindmapIncomingEdge"
            label={t("labels.mindmapIncomingEdge")}
            icon={elbowArrowIcon}
            appState={appState}
            setAppState={setAppState}
            container={container}
          >
            <MindmapIncomingEdgeGroup app={app} appState={appState} />
          </FloatbarPopupGroup>
        </>
      )}

      {/* Frame：重命名入口 */}
      {predicates.frameRename && (
        <FrameRenameAction app={app} targetElements={targetElements} />
      )}

      {/* 图片：裁剪入口 */}
      {predicates.cropEditor && (
        <div className="compact-action-item">{renderAction("cropEditor")}</div>
      )}

      {/* 样式弹层：填充 / 描边宽度 / 描边样式 / 边角 / 透明度 */}
      {hasStyleGroups && (
        <CombinedShapeProperties
          appState={appState}
          renderAction={renderAction}
          setAppState={setAppState}
          predicates={predicates}
          container={container}
          app={app}
        />
      )}

      {/* 箭头属性弹层：箭头类型 + 端点 */}
      <CombinedArrowProperties
        appState={appState}
        renderAction={renderAction}
        setAppState={setAppState}
        targetElements={targetElements}
        predicates={predicates}
        container={container}
        app={app}
      />

      {/* 文字：字体触发器 + 文字属性弹层（字号 / 文字对齐 / 垂直对齐） */}
      {hasTextGroups && (
        <>
          <div className="compact-action-item">
            {renderAction("changeFontFamily")}
          </div>
          <CombinedTextProperties
            appState={appState}
            renderAction={renderAction}
            setAppState={setAppState}
            predicates={predicates}
            container={container}
          />
        </>
      )}

      {hasTailActions && <span className="sep" />}

      {/* 线条/箭头：编辑节点入口 */}
      {predicates.lineEditor && (
        <div className="compact-action-item">
          {renderAction("toggleLinearEditor")}
        </div>
      )}

      {/* 单选（含容器绑定文本伪单选）：链接入口 + 链接弹层（编辑/访问两态） */}
      {predicates.link && (
        <FloatbarLinkAction
          app={app}
          appState={appState}
          setAppState={setAppState}
          container={container}
        />
      )}

      {/* 多选：对齐与分布 */}
      {predicates.align && (
        <AlignPopupGroup
          renderAction={renderAction}
          predicates={predicates}
          appState={appState}
          setAppState={setAppState}
          container={container}
        />
      )}

      {/* 图层（思维导图节点进「更多」，不在浮动栏外露） */}
      {predicates.layers && !mindmapNode && (
        <LayersPopupGroup
          renderAction={renderAction}
          appState={appState}
          setAppState={setAppState}
          container={container}
        />
      )}

      {/* 更多操作菜单 */}
      {predicates.showExtraActions && (
        <ToolbarMoreMenu
          app={app}
          setAppState={setAppState}
          container={container}
        />
      )}
    </div>
  );
};

const CombinedShapeProperties = ({
  appState,
  renderAction,
  setAppState,
  predicates,
  container,
  app,
}: {
  appState: UIAppState;
  renderAction: ActionManager["renderAction"];
  setAppState: React.Component<any, AppState>["setState"];
  predicates: ShapeActionPredicates;
  container: HTMLDivElement | null;
  app: AppClassProperties;
}) => {
  // 表格整体（选中表格元素）才给「样式」弹层；行/列/单元格选区只有外露色板
  const tableElementSelected = Object.keys(appState.selectedElementIds).some(
    (id) => isTableElement(app.scene.getNonDeletedElement(id)),
  );
  const shouldShowCombinedProperties =
    tableElementSelected ||
    predicates.hasSelection ||
    (appState.activeTool.type !== "selection" &&
      appState.activeTool.type !== "eraser" &&
      appState.activeTool.type !== "hand" &&
      appState.activeTool.type !== "laser" &&
      appState.activeTool.type !== "lasso");
  const isOpen = appState.openPopup === "compactStrokeStyles";

  if (!shouldShowCombinedProperties) {
    return null;
  }

  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            setAppState({ openPopup: "compactStrokeStyles" });
          } else {
            setAppState({ openPopup: null });
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={clsx("compact-action-button properties-trigger", {
              active: isOpen,
            })}
            title={t("labels.contextMenuStyle")}
            aria-label={t("labels.contextMenuStyle")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              setAppState({
                openPopup: isOpen ? null : "compactStrokeStyles",
              });
            }}
          >
            {adjustmentsIcon}
          </button>
        </Popover.Trigger>
        {isOpen && (
          <PropertiesPopover
            className={PROPERTIES_CLASSES}
            container={container}
            label={t("labels.contextMenuStyle")}
            style={{
              width: tableElementSelected ? "13rem" : undefined,
              maxWidth: "13rem",
            }}
            onClose={() => {}}
          >
            <div className="selected-shape-actions">
              {tableElementSelected ? (
                <TableStyleActions
                  app={app}
                  appState={appState}
                  variant="details"
                />
              ) : (
                <>
                  {predicates.fill && renderAction("changeFillStyle")}
                  {predicates.strokeWidth && renderAction("changeStrokeWidth")}
                  {
                    /* in compact UI the freedraw pressure setting is rendered as a
                  standalone cycle button in the compact actions list; we render
                  it in the combined properties popup as well for clarity
                */
                    predicates.freedrawMode &&
                      renderAction("changeFreedrawMode")
                  }
                  {predicates.strokeStyle && (
                    <>{renderAction("changeStrokeStyle")}</>
                  )}
                  {predicates.roundness && renderAction("changeRoundness")}
                  {predicates.opacity && renderAction("changeOpacity")}
                </>
              )}
            </div>
          </PropertiesPopover>
        )}
      </Popover.Root>
    </div>
  );
};

const CombinedArrowProperties = ({
  appState,
  renderAction,
  setAppState,
  targetElements,
  predicates,
  container,
  app,
}: {
  appState: UIAppState;
  renderAction: ActionManager["renderAction"];
  setAppState: React.Component<any, AppState>["setState"];
  targetElements: ExcalidrawElement[];
  predicates: ShapeActionPredicates;
  container: HTMLDivElement | null;
  app: AppClassProperties;
}) => {
  if (!predicates.arrowType) {
    return null;
  }

  const isOpen = appState.openPopup === "compactArrowProperties";

  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            setAppState({ openPopup: "compactArrowProperties" });
          } else {
            setAppState({ openPopup: null });
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={clsx("compact-action-button properties-trigger", {
              active: isOpen,
            })}
            title={t("labels.arrowtypes")}
            aria-label={t("labels.arrowtypes")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              setAppState({
                openPopup: isOpen ? null : "compactArrowProperties",
              });
            }}
          >
            {(() => {
              // Show an icon based on the current arrow type
              const arrowType = getFormValue(
                targetElements,
                app,
                (element) => {
                  if (isArrowElement(element)) {
                    return element.elbowed
                      ? "elbow"
                      : element.roundness
                      ? "round"
                      : "sharp";
                  }
                  return null;
                },
                (element) => isArrowElement(element),
                (hasSelection) =>
                  hasSelection ? null : appState.currentItemArrowType,
              );

              if (arrowType === "elbow") {
                return elbowArrowIcon;
              }
              if (arrowType === "round") {
                return roundArrowIcon;
              }
              return sharpArrowIcon;
            })()}
          </button>
        </Popover.Trigger>
        {isOpen && (
          <PropertiesPopover
            container={container}
            className="properties-content"
            label={t("labels.arrowtypes")}
            style={{ maxWidth: "13rem" }}
            onClose={() => {}}
          >
            {renderAction("changeArrowProperties")}
          </PropertiesPopover>
        )}
      </Popover.Root>
    </div>
  );
};

const CombinedTextProperties = ({
  appState,
  renderAction,
  setAppState,
  predicates,
  container,
}: {
  appState: UIAppState;
  renderAction: ActionManager["renderAction"];
  setAppState: React.Component<any, AppState>["setState"];
  predicates: ShapeActionPredicates;
  container: HTMLDivElement | null;
}) => {
  const { saveCaretPosition, restoreCaretPosition } = useTextEditorFocus(
    container?.ownerDocument,
  );
  const isOpen = appState.openPopup === "compactTextProperties";

  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            if (appState.editingTextElement) {
              saveCaretPosition();
            }
            setAppState({ openPopup: "compactTextProperties" });
          } else {
            setAppState({ openPopup: null });
            if (appState.editingTextElement) {
              restoreCaretPosition();
            }
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={clsx("compact-action-button properties-trigger", {
              active: isOpen,
            })}
            title={t("labels.textAlign")}
            aria-label={t("labels.textAlign")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              if (isOpen) {
                setAppState({ openPopup: null });
              } else {
                if (appState.editingTextElement) {
                  saveCaretPosition();
                }
                setAppState({ openPopup: "compactTextProperties" });
              }
            }}
          >
            {TextSizeIcon}
          </button>
        </Popover.Trigger>
        {appState.openPopup === "compactTextProperties" && (
          <PropertiesPopover
            className={PROPERTIES_CLASSES}
            container={container}
            label={t("labels.textAlign")}
            style={{ maxWidth: "13rem" }}
            // Improve focus handling for text editing scenarios
            preventAutoFocusOnTextEdit={!!appState.editingTextElement}
            onClose={() => {
              // Refocus text editor when popover closes with caret restoration
              if (appState.editingTextElement) {
                restoreCaretPosition();
              }
            }}
          >
            <div className="selected-shape-actions">
              {predicates.text && renderAction("changeFontSize")}
              {predicates.textAlign && renderAction("changeTextAlign")}
              {predicates.verticalAlign && renderAction("changeVerticalAlign")}
            </div>
          </PropertiesPopover>
        )}
      </Popover.Root>
    </div>
  );
};

const CombinedExtraActions = ({
  appState,
  renderAction,
  predicates,
  setAppState,
  container,
  showDuplicate,
  showDelete,
}: {
  appState: UIAppState;
  renderAction: ActionManager["renderAction"];
  predicates: ShapeActionPredicates;
  setAppState: React.Component<any, AppState>["setState"];
  container: HTMLDivElement | null;
  showDuplicate?: boolean;
  showDelete?: boolean;
}) => {
  const isOpen = appState.openPopup === "compactOtherProperties";

  if (!predicates.showExtraActions) {
    return null;
  }

  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            setAppState({ openPopup: "compactOtherProperties" });
          } else {
            setAppState({ openPopup: null });
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={clsx("compact-action-button properties-trigger", {
              active: isOpen,
            })}
            title={t("labels.actions")}
            aria-label={t("labels.actions")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setAppState({
                openPopup: isOpen ? null : "compactOtherProperties",
              });
            }}
          >
            {DotsHorizontalIcon}
          </button>
        </Popover.Trigger>
        {isOpen && (
          <PropertiesPopover
            className={PROPERTIES_CLASSES}
            container={container}
            label={t("labels.actions")}
            style={{
              maxWidth: "12rem",
              justifyContent: "center",
              alignItems: "center",
            }}
            onClose={() => {}}
          >
            <div className="selected-shape-actions">
              {predicates.align && (
                <AlignFieldset
                  renderAction={renderAction}
                  showDistribute={predicates.distribute}
                />
              )}
              <ToolbarGroup legend={t("labels.actions")}>
                <div className="buttonList">
                  {renderAction("group")}
                  {renderAction("ungroup")}
                  {predicates.linkSingleOnly && renderAction("hyperlink")}
                  {predicates.cropEditor && renderAction("cropEditor")}
                  {showDuplicate && renderAction("duplicateSelection")}
                  {showDelete && renderAction("deleteSelectedElements")}
                </div>
              </ToolbarGroup>
            </div>
          </PropertiesPopover>
        )}
      </Popover.Root>
    </div>
  );
};

const LinearEditorAction = ({
  renderAction,
  predicates,
}: {
  renderAction: ActionManager["renderAction"];
  predicates: ShapeActionPredicates;
}) => {
  if (!predicates.lineEditor) {
    return null;
  }

  return (
    <div className="compact-action-item">
      {renderAction("toggleLinearEditor")}
    </div>
  );
};

const TableCellCompactActions = ({
  app,
  appState,
  setAppState,
}: {
  app: AppClassProperties;
  appState: UIAppState;
  setAppState: React.Component<any, AppState>["setState"];
}) => {
  const selection = appState.tableCellSelection;
  if (!selection) {
    return null;
  }
  const table = app.scene.getNonDeletedElement(selection.tableId);
  let cells: ReturnType<typeof getCellsInTableRange> = [];
  if (table && isTableElement(table)) {
    try {
      cells = getCellsInTableRange(
        table.table,
        getTableCellRange(table.table, selection.anchorId, selection.focusId),
      );
    } catch {
      // A stale transient selection disappears when the next cell is chosen.
    }
  }
  const visibleCount = cells.filter((cell) => !cell.mergedInto).length;
  const hasMergedCell = cells.some(
    (cell) =>
      !cell.mergedInto &&
      ((cell.rowSpan ?? 1) > 1 || (cell.columnSpan ?? 1) > 1),
  );
  const fitContent =
    table &&
    isTableElement(table) &&
    (table.table as typeof table.table & { sizingMode?: string }).sizingMode ===
      "fitContent";
  const mergeReason = fitContent
    ? "Merged cells are unavailable in fit-to-content tables"
    : visibleCount < 2
    ? "Select at least two visible cells to merge"
    : null;
  const splitReason = hasMergedCell ? null : "Select a merged cell to split";
  const cellAction = hasMergedCell ? "split" : "merge";
  const cellActionLabel = t(
    hasMergedCell ? "labels.tableSplitCells" : "labels.tableMergeCells",
  );
  const cellActionReason = hasMergedCell ? splitReason : mergeReason;
  return (
    <>
      <div className="compact-action-item">
        <button
          type="button"
          className="compact-action-button table-cell-command"
          data-testid="table-cell-multi-select"
          aria-label={t("labels.tableCellSelection")}
          aria-pressed={selection.mobileMode}
          title={t("labels.tableCellSelection")}
          onClick={() =>
            setAppState((state) => ({
              tableCellSelection: state.tableCellSelection && {
                ...state.tableCellSelection,
                mobileMode: !state.tableCellSelection.mobileMode,
              },
            }))
          }
        >
          {selection.mobileMode
            ? tableCellMultiSelectIcon
            : tableCellSelectIcon}
        </button>
      </div>
      <div className="compact-action-item">
        <button
          type="button"
          className={clsx("compact-action-button table-cell-command", {
            active: hasMergedCell,
          })}
          data-testid={`table-${cellAction}-cells`}
          aria-label={cellActionLabel}
          disabled={!!cellActionReason}
          title={cellActionReason ?? cellActionLabel}
          onClick={() =>
            hasMergedCell
              ? app.commitTableCellSplit()
              : app.commitTableCellMerge()
          }
        >
          {tableCellMergeIcon}
        </button>
      </div>
    </>
  );
};

const TableStyleActions = ({
  app,
  appState,
  variant = "fill",
}: {
  app: AppClassProperties;
  appState: UIAppState;
  // fill = 外露色板（浮动栏/底部条）；details = 边框宽度/样式/透明度/表头/标题弹层
  variant?: "fill" | "details";
}) => {
  useSceneNonce(app.scene);
  const cellSelection = appState.tableCellSelection;
  const axisSelection = appState.tableRowColSelection;
  const selectedTableId = Object.keys(appState.selectedElementIds).find(
    (id) => {
      const element = app.scene.getNonDeletedElement(id);
      return element && isTableElement(element);
    },
  );
  const tableId =
    cellSelection?.tableId ?? axisSelection?.tableId ?? selectedTableId;
  const table = tableId && app.scene.getNonDeletedElement(tableId);
  if (!table || !isTableElement(table)) {
    return null;
  }
  const targetCells = cellSelection
    ? getCellsInTableRange(
        table.table,
        getTableCellRange(
          table.table,
          cellSelection.anchorId,
          cellSelection.focusId,
        ),
      ).filter((cell) => !cell.mergedInto)
    : [];
  const axis =
    axisSelection &&
    (axisSelection.kind === "row"
      ? table.table.rows.find((row) => row.id === axisSelection.id)
      : table.table.columns.find((column) => column.id === axisSelection.id));
  // the picker shows what the cell actually renders: the painted fill, the
  // body base when the fill chain is silent, or transparent when the chain
  // resolves transparent (such cells punch through the body base)
  const isDark = appState.theme === THEME.DARK;
  const bodyBase = resolveTableColor(TABLE_STYLE.backgroundColor, isDark);
  const getCellFill = (cell: typeof targetCells[number]) =>
    isTableCellTransparent(table.table, cell)
      ? "transparent"
      : getTableCellFillColor(cell, isDark, table.table) ?? bodyBase;
  const color = cellSelection
    ? targetCells[0] && getCellFill(targetCells[0])
    : axisSelection
    ? axis?.style?.backgroundColor ??
      table.table.style?.backgroundColor ??
      bodyBase
    : table.table.style?.backgroundColor ?? bodyBase;
  const update = (patch: Partial<NonNullable<typeof table.table.style>>) => {
    const currentCellSelection = app.state.tableCellSelection;
    const currentAxisSelection = app.state.tableRowColSelection;
    const currentTableId =
      currentCellSelection?.tableId ??
      currentAxisSelection?.tableId ??
      Object.keys(app.state.selectedElementIds).find((id) =>
        isTableElement(app.scene.getNonDeletedElement(id)),
      );
    const currentTable =
      currentTableId && app.scene.getNonDeletedElement(currentTableId);
    if (!currentTable || !isTableElement(currentTable)) {
      return;
    }
    const current = currentTable.table;
    let next = current;
    if (currentCellSelection) {
      const ids = new Set(
        getCellsInTableRange(
          current,
          getTableCellRange(
            current,
            currentCellSelection.anchorId,
            currentCellSelection.focusId,
          ),
        )
          .filter((cell) => !cell.mergedInto)
          .map((cell) => cell.id),
      );
      app.scheduleCapture();
      for (const cellId of ids) {
        setTableSceneCellStyle(app.scene, currentTable, cellId, {
          ...(patch.backgroundColor !== undefined && {
            backgroundColor: patch.backgroundColor,
          }),
          ...(patch.clipContent !== undefined && {
            clipContent: patch.clipContent,
          }),
        });
      }
      app.scene.triggerUpdate();
      return;
    } else if (currentAxisSelection?.kind === "row") {
      next = {
        ...current,
        rows: current.rows.map((row) =>
          row.id === currentAxisSelection.id
            ? { ...row, style: { ...row.style, ...patch } }
            : row,
        ),
      };
    } else if (currentAxisSelection?.kind === "column") {
      next = {
        ...current,
        columns: current.columns.map((column) =>
          column.id === currentAxisSelection.id
            ? { ...column, style: { ...column.style, ...patch } }
            : column,
        ),
      };
    } else {
      app.scheduleCapture();
      setTableSceneStyle(app.scene, currentTable, patch);
      app.scene.triggerUpdate();
      return;
    }
    app.scheduleCapture();
    app.scene.mutateElement(currentTable, { table: next });
    app.scene.triggerUpdate();
  };
  const tableOnly = !cellSelection && !axisSelection;
  const fillIsMixed =
    targetCells.length > 1 &&
    targetCells.some((cell) => getCellFill(cell) !== color);
  const selectedColor = fillIsMixed ? null : color ?? "transparent";
  const updatePickerState = (state?: Partial<AppState>) => {
    if (state) {
      app.setState((previous) => ({ ...previous, ...state }));
    }
  };
  const lineStyleOptions = [
    {
      value: "solid" as const,
      text: t("labels.strokeStyle_solid"),
      icon: StrokeWidthBaseIcon,
    },
    {
      value: "dashed" as const,
      text: t("labels.strokeStyle_dashed"),
      icon: StrokeStyleDashedIcon,
    },
    {
      value: "dotted" as const,
      text: t("labels.strokeStyle_dotted"),
      icon: StrokeStyleDottedIcon,
    },
  ];
  const titleAlignOptions = [
    {
      value: "start" as const,
      text: t("labels.left"),
      icon: TextAlignLeftIcon,
      testId: "table-title-align-start",
    },
    {
      value: "center" as const,
      text: t("labels.center"),
      icon: TextAlignCenterIcon,
      testId: "table-title-align-center",
    },
    {
      value: "end" as const,
      text: t("labels.right"),
      icon: TextAlignRightIcon,
      testId: "table-title-align-end",
    },
  ];
  const colorPicker = (
    <ColorPicker
      key="fill"
      type="elementBackground"
      label={t("labels.background")}
      color={selectedColor}
      onChange={(nextColor) => update({ backgroundColor: nextColor })}
      palette={DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE}
      topPicks={DEFAULT_ELEMENT_BACKGROUND_PICKS}
      compact
      elements={app.scene.getNonDeletedElements()}
      appState={appState}
      updateData={updatePickerState}
    />
  );
  // the border and grid pickers are deliberately decoupled (a transparent
  // border must not kill the grid, and vice versa). Their top-picks strips
  // are fixed — `transparent` heads them, and they don't share the element
  // stroke picker's drag customization.
  // 表格的两条线在场景语义上是外框 / 内框，而 type 只表示取色域（都取描边
  // 色域），故显式给出弹层小标题，避免沿用形状场景的「描边」
  const borderColorPicker = (
    <ColorPicker
      key="border"
      type="elementStroke"
      label={t("labels.tableBorderColor")}
      popupTitle={t("labels.tableOuterBorder")}
      color={table.table.style?.borderColor ?? TABLE_STYLE.strokeColor}
      onChange={(nextColor) => update({ borderColor: nextColor })}
      palette={DEFAULT_ELEMENT_STROKE_COLOR_PALETTE}
      topPicks={TABLE_LINE_PICKS}
      compact
      elements={app.scene.getNonDeletedElements()}
      appState={appState}
      updateData={updatePickerState}
    />
  );
  const gridColorPicker = (
    <ColorPicker
      key="grid"
      type="tableGrid"
      label={t("labels.tableGridColor")}
      popupTitle={t("labels.tableInnerBorder")}
      color={table.table.style?.gridColor ?? TABLE_STYLE.gridColor}
      onChange={(nextColor) => update({ gridColor: nextColor })}
      palette={DEFAULT_ELEMENT_STROKE_COLOR_PALETTE}
      topPicks={TABLE_LINE_PICKS}
      compact
      elements={app.scene.getNonDeletedElements()}
      appState={appState}
      updateData={updatePickerState}
    />
  );
  return (
    <div
      className={clsx("table-style-actions", {
        "compact-action-item table-style-actions--fill-only":
          variant === "fill",
      })}
      aria-label="Table style"
    >
      {variant === "fill" && tableOnly && (
        <div className="compact-action-item">{borderColorPicker}</div>
      )}
      {variant === "fill" && tableOnly && (
        <div className="compact-action-item">{gridColorPicker}</div>
      )}
      {variant === "fill" && (
        <div className="compact-action-item">{colorPicker}</div>
      )}
      {variant === "details" && tableOnly && (
        <>
          <ToolbarGroup legend={t("labels.tableBorderWidth")}>
            <Range
              label={t("labels.tableBorderWidth")}
              hideLabel
              value={
                table.table.style?.borderWidth ??
                table.table.style?.gridWidth ??
                1
              }
              onChange={(value) =>
                update({ borderWidth: value, gridWidth: value })
              }
              min={0}
              max={20}
              step={0.5}
            />
          </ToolbarGroup>
          <ToolbarGroup legend={t("labels.tableBorderStyle")}>
            <div className="buttonList">
              <RadioSelection
                group="table-border-style"
                options={lineStyleOptions}
                value={table.table.style?.borderStyle ?? "solid"}
                onChange={(value) =>
                  update({ borderStyle: value, gridStyle: value })
                }
              />
            </div>
          </ToolbarGroup>
          <ToolbarGroup legend={t("labels.opacity")}>
            <Range
              label={t("labels.opacity")}
              hideLabel
              value={table.table.style?.opacity ?? 100}
              onChange={(value) => update({ opacity: value })}
              min={0}
              max={100}
              step={1}
            />
          </ToolbarGroup>
          <CheckboxItem
            checked={table.table.style?.header !== false}
            onChange={(checked) => update({ header: checked })}
          >
            {t("labels.tableHeaderRow")}
          </CheckboxItem>
          <ToolbarGroup legend={t("labels.tableTitleAlign")}>
            <div className="buttonList">
              <RadioSelection
                group="table-title-align"
                options={titleAlignOptions}
                value={table.table.style?.title?.align ?? "start"}
                onChange={(value) => update({ title: { align: value } })}
              />
            </div>
          </ToolbarGroup>
        </>
      )}
    </div>
  );
};

/**
 * 手机底部条（设计稿 tb-bar）：通栏横排、可横滑；色板 24px 外露、
 * 图标按钮 38×38、分隔线 1×22（容器规格见 toolbar.scss 的 .tb-bar）。
 * 二级界面一律底部 sheet（PropertiesPopover 的手机竖屏分支）。
 * 宽度不足时复制/删除让位进「更多」（既有宽度测量逻辑，方向保留）；
 * 单元格选区含撤销/重做（既有行为）。
 */
export const MobileShapeActions = ({
  appState,
  elementsMap,
  renderAction,
  app,
  setAppState,
}: {
  appState: UIAppState;
  elementsMap: NonDeletedElementsMap | NonDeletedSceneElementsMap;
  renderAction: ActionManager["renderAction"];
  app: AppClassProperties;
  setAppState: React.Component<any, AppState>["setState"];
}) => {
  const targetElements = getTargetElements(elementsMap, appState);
  const predicates = getShapeActionPredicates(
    appState,
    targetElements,
    elementsMap,
    app,
  );
  const { container } = useExcalidrawContainer();
  const tableSelected =
    !!appState.tableCellSelection ||
    !!appState.tableRowColSelection ||
    targetElements.some(isTableElement);
  const mobileActionsRef = useRef<HTMLDivElement>(null);

  const ACTIONS_WIDTH =
    mobileActionsRef.current?.getBoundingClientRect()?.width ?? 0;

  // tb-bar 控件规格（按钮 38 / 间距 2）。基线条目 = 6 分组 + 撤销/重做；
  // 宽度再富余一档放删除、两档放复制，否则让位进「更多」（既有方向保留；
  // 底条改通栏后 390px 手机可外露删除）
  const MIN_ACTIONS = 8;

  const GAP = 2;
  const WIDTH = 38;

  const MIN_WIDTH = MIN_ACTIONS * WIDTH + (MIN_ACTIONS - 1) * GAP;

  const ADDITIONAL_WIDTH = WIDTH + GAP;

  const showDeleteOutside = ACTIONS_WIDTH >= MIN_WIDTH + ADDITIONAL_WIDTH;
  const showDuplicateOutside =
    ACTIONS_WIDTH >= MIN_WIDTH + 2 * ADDITIONAL_WIDTH;

  // 思维导图选中节点：底部整体替换为节点动作条（MobileMindmapActions，
  // 与本栏同挂 .App-bottom-bar；可见条件与 canEditNode 保持一致——
  // 编辑节点文本时动作条让位、本栏恢复为文字属性）
  const selectedMindmapNode = app.mindmap.getSelectedNode();
  if (selectedMindmapNode && app.mindmap.canEditNode(selectedMindmapNode.id)) {
    return null;
  }

  if (appState.tableCellSelection) {
    return (
      <div
        className="compact-shape-actions mobile-shape-actions tb-bar"
        ref={mobileActionsRef}
      >
        <TableCellCompactActions
          app={app}
          appState={appState}
          setAppState={setAppState}
        />
        <TableStyleActions app={app} appState={appState} variant="fill" />
        <span className="sep" />
        <div className="compact-action-item">{renderAction("undo")}</div>
        <div className="compact-action-item">{renderAction("redo")}</div>
      </div>
    );
  }

  const showSwatchZone =
    tableSelected || predicates.strokeColor || predicates.backgroundColor;
  // 中段分组（样式/箭头/文字/图层触发器）出现条件：有选区或处于绘制工具
  // （与 CombinedShapeProperties 的可见条件同向）
  const showMiddleZone =
    predicates.hasSelection ||
    (appState.activeTool.type !== "selection" &&
      appState.activeTool.type !== "eraser" &&
      appState.activeTool.type !== "hand" &&
      appState.activeTool.type !== "laser" &&
      appState.activeTool.type !== "lasso");

  return (
    <div
      className="compact-shape-actions mobile-shape-actions tb-bar"
      ref={mobileActionsRef}
    >
      {/* 表格：边框颜色 / 网格线颜色 / 背景颜色色板外露 */}
      <TableStyleActions app={app} appState={appState} variant="fill" />

      {/* 外露色板：描边 / 背景（24px） */}
      {!tableSelected && predicates.strokeColor && (
        <div className={clsx("compact-action-item")}>
          {renderAction("changeStrokeColor")}
        </div>
      )}
      {/* Background Color (the bucket fill variant excludes `transparent`) */}
      {!tableSelected && predicates.backgroundColor && (
        <div className="compact-action-item">
          {renderAction(
            appState.activeTool.type === "bucketfill"
              ? "changeBucketFillBackgroundColor"
              : "changeBackgroundColor",
          )}
        </div>
      )}

      {showSwatchZone && <span className="sep" />}

      {!appState.tableRowColSelection && (
        <CombinedShapeProperties
          appState={appState}
          renderAction={renderAction}
          setAppState={setAppState}
          predicates={predicates}
          container={container}
          app={app}
        />
      )}
      {/* Combined Arrow Properties */}
      <CombinedArrowProperties
        appState={appState}
        renderAction={renderAction}
        setAppState={setAppState}
        targetElements={targetElements}
        predicates={predicates}
        container={container}
        app={app}
      />
      {/* Linear Editor */}
      <LinearEditorAction renderAction={renderAction} predicates={predicates} />
      {/* Text Properties */}
      {predicates.text && (
        <>
          <div className="compact-action-item">
            {renderAction("changeFontFamily")}
          </div>
          <CombinedTextProperties
            appState={appState}
            renderAction={renderAction}
            setAppState={setAppState}
            predicates={predicates}
            container={container}
          />
        </>
      )}
      {/* 图层（设计稿底部条尾区图标；sheet 打开 z-order 四动作） */}
      {predicates.layers && !tableSelected && (
        <LayersPopupGroup
          renderAction={renderAction}
          appState={appState}
          setAppState={setAppState}
          container={container}
        />
      )}

      {showMiddleZone && <span className="sep" />}

      <div className="compact-action-item">{renderAction("undo")}</div>
      <div className="compact-action-item">{renderAction("redo")}</div>
      {(showDuplicateOutside || tableSelected) && (
        <div className="compact-action-item">
          {renderAction("duplicateSelection")}
        </div>
      )}
      {(showDeleteOutside || tableSelected) && (
        <div className="compact-action-item">
          {renderAction("deleteSelectedElements")}
        </div>
      )}
      {/* Combined Other Actions（「更多」sheet） */}
      {!tableSelected && (
        <CombinedExtraActions
          appState={appState}
          renderAction={renderAction}
          predicates={predicates}
          setAppState={setAppState}
          container={container}
          showDuplicate={!showDuplicateOutside}
          showDelete={!showDeleteOutside}
        />
      )}
    </div>
  );
};

export const ZoomActions = ({
  renderAction,
}: {
  renderAction: ActionManager["renderAction"];
}) => (
  <Stack.Col gap={1} className={CLASSES.ZOOM_ACTIONS}>
    <Stack.Row align="center">
      {renderAction("zoomOut")}
      {renderAction("resetZoom")}
      {renderAction("zoomIn")}
    </Stack.Row>
  </Stack.Col>
);

export const UndoRedoActions = ({
  renderAction,
  className,
}: {
  renderAction: ActionManager["renderAction"];
  className?: string;
}) => (
  <div className={`undo-redo-buttons ${className}`}>
    <div className="undo-button-container">
      <Tooltip label={t("buttons.undo")}>{renderAction("undo")}</Tooltip>
    </div>
    <div className="redo-button-container">
      <Tooltip label={t("buttons.redo")}> {renderAction("redo")}</Tooltip>
    </div>
  </div>
);

export const ExitZenModeButton = ({
  actionManager,
  showExitZenModeBtn,
}: {
  actionManager: ActionManager;
  showExitZenModeBtn: boolean;
}) => (
  <button
    type="button"
    className={clsx("disable-zen-mode", {
      "disable-zen-mode--visible": showExitZenModeBtn,
    })}
    onClick={() => actionManager.executeAction(actionToggleZenMode)}
  >
    {t("buttons.exitZenMode")}
  </button>
);

export const ExitViewModeButton = ({
  actionManager,
}: {
  actionManager: ActionManager;
}) => (
  <button
    type="button"
    className="disable-view-mode"
    onClick={() => actionManager.executeAction(actionToggleViewMode)}
  >
    {pencilIcon}
  </button>
);
