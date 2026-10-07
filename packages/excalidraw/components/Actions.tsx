import {
  setTableSceneCellStyle,
  setTableSceneStyle,
} from "@excalidraw/element/tableScene";

import clsx from "clsx";
import { useRef, useState } from "react";
import { Popover } from "radix-ui";

import {
  CLASSES,
  DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_PICKS,
} from "@excalidraw/common";

import {
  getMindmapShapeId,
  isArrowElement,
  isMindmapEdgeElement,
  isTableElement,
  getTableCellRange,
  getCellsInTableRange,
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

import { t } from "../i18n";
import { getTargetElements } from "../scene";

import { getFormValue } from "../actions/actionProperties";

import { useTextEditorFocus } from "../hooks/useTextEditorFocus";
import { useSceneNonce } from "../hooks/useSceneNonce";

import { actionToggleViewMode } from "../actions/actionToggleViewMode";

import "./Actions.scss";

import { useExcalidrawContainer } from "./App";
import { IconButton } from "./IconButton";
import Stack from "./Stack";
import { Tooltip } from "./Tooltip";
import { PropertiesPopover } from "./PropertiesPopover";
import { ColorPicker } from "./ColorPicker/ColorPicker";
import { RadioSelection } from "./RadioSelection";
import { Range } from "./Range";
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
  StrokeWidthBaseIcon,
  StrokeStyleDashedIcon,
  StrokeStyleDottedIcon,
  tableCellSelectIcon,
  tableCellMultiSelectIcon,
  tableCellMergeIcon,
} from "./icons";

import { Island } from "./Island";

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

const MINDMAP_DIRECTIONS: readonly [MindmapLayoutDirection, string][] = [
  ["left-to-right", "Left to right"],
  ["right-to-left", "Right to left"],
  ["top-to-bottom", "Top to bottom"],
  ["bottom-to-top", "Bottom to top"],
];

type MindmapEdgeStyle = {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  routing: MindmapEdgeRouting;
};

const MindmapEdgeStyleControls = ({
  title,
  style,
  disabled,
  onChange,
}: {
  title: string;
  style: MindmapEdgeStyle;
  disabled: boolean;
  onChange: (update: Partial<MindmapEdgeStyle>) => void;
}) => (
  <section className="mindmap-style-panel__edge" aria-label={title}>
    <h3>{title}</h3>
    <fieldset>
      <legend>Color</legend>
      <input
        type="color"
        className="mindmap-style-panel__color"
        aria-label={`${title} color`}
        disabled={disabled}
        value={
          style.strokeColor.startsWith("#") ? style.strokeColor : "#1b1b1f"
        }
        onChange={(event) =>
          onChange({ strokeColor: event.currentTarget.value })
        }
      />
    </fieldset>
    <fieldset>
      <legend>Width</legend>
      <input
        type="number"
        className="mindmap-style-panel__width"
        aria-label={`${title} width`}
        disabled={disabled}
        min={0}
        step={1}
        value={style.strokeWidth}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          if (Number.isFinite(value) && value >= 0) {
            onChange({ strokeWidth: value });
          }
        }}
      />
    </fieldset>
    <fieldset className="mindmap-style-panel__line">
      <legend>Line</legend>
      <div className="buttonList">
        {(
          [
            ["solid", "Solid", StrokeWidthBaseIcon],
            ["dashed", "Dashed", StrokeStyleDashedIcon],
            ["dotted", "Dotted", StrokeStyleDottedIcon],
          ] as const
        ).map(([strokeStyle, label, icon]) => (
          <IconButton
            key={strokeStyle}
            type="toggle"
            icon={icon}
            checked={style.strokeStyle === strokeStyle}
            disabled={disabled}
            title={label}
            aria-label={label}
            onSelect={() => onChange({ strokeStyle })}
          />
        ))}
      </div>
    </fieldset>
    <fieldset className="mindmap-style-panel__route">
      <legend>Route</legend>
      <div className="buttonList">
        {(
          [
            ["orthogonal", "Orthogonal", elbowArrowIcon],
            ["curved", "Curved", roundArrowIcon],
          ] as const
        ).map(([routing, label, icon]) => (
          <IconButton
            key={routing}
            type="toggle"
            icon={icon}
            checked={style.routing === routing}
            disabled={disabled}
            title={label}
            aria-label={label}
            onSelect={() => onChange({ routing })}
          />
        ))}
      </div>
    </fieldset>
  </section>
);

const MindmapNodeStylePanel = ({ app }: { app: AppClassProperties }) => {
  const node = app.mindmap.getSelectedNode();
  if (!node) {
    return null;
  }
  const incomingEdge = app.scene
    .getNonDeletedElements()
    .find(
      (element) => isMindmapEdgeElement(element) && element.childId === node.id,
    );
  return (
    <div className="mindmap-style-panel">
      <fieldset>
        <legend>Mindmap node</legend>
        <div className="buttonList">
          {MINDMAP_SHAPES.map(([shape, icon]) => (
            <IconButton
              key={shape}
              type="toggle"
              icon={icon}
              checked={getMindmapShapeId(node) === shape}
              title={shape}
              aria-label={shape}
              data-testid={`mindmap-shape-${shape}`}
              onSelect={() => app.mindmap.setNodeShape(shape)}
            />
          ))}
        </div>
      </fieldset>
      {incomingEdge && isMindmapEdgeElement(incomingEdge) && (
        <MindmapEdgeStyleControls
          title="Incoming edge"
          style={incomingEdge}
          disabled={!app.mindmap.canEditNode(node.id)}
          onChange={app.mindmap.setIncomingEdgeStyle}
        />
      )}
    </div>
  );
};

const MindmapSelectedEdgeStylePanel = ({
  app,
}: {
  app: AppClassProperties;
}) => {
  const edge = app.mindmap.getSelectedEdge();
  if (!edge) {
    return null;
  }
  return (
    <div className="mindmap-style-panel">
      <MindmapEdgeStyleControls
        title="Mindmap edge"
        style={edge}
        disabled={!app.mindmap.canEditNode(edge.childId)}
        onChange={app.mindmap.setSelectedEdgeStyle}
      />
    </div>
  );
};

const MindmapGraphStylePanel = ({ app }: { app: AppClassProperties }) => {
  const root = app.mindmap.getSelectedGraphRoot();
  if (!root) {
    return null;
  }
  const disabled = !app.mindmap.canEditNode(root.id);
  return (
    <div className="mindmap-style-panel">
      <fieldset>
        <legend>Direction</legend>
        <div className="buttonList">
          {MINDMAP_DIRECTIONS.map(([direction, label]) => (
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
              title={label}
              aria-label={label}
              onSelect={() => app.mindmap.setLayoutConfig({ direction })}
            />
          ))}
        </div>
      </fieldset>
      <MindmapEdgeStyleControls
        title="Mindmap edge"
        style={{
          strokeColor: root.defaultEdgeStrokeColor ?? "#1b1b1f",
          strokeWidth: root.defaultEdgeStrokeWidth ?? 2,
          strokeStyle: root.defaultEdgeStrokeStyle ?? "solid",
          routing: root.defaultEdgeRouting ?? "orthogonal",
        }}
        disabled={disabled}
        onChange={app.mindmap.setGraphEdgeStyle}
      />
    </div>
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
  <fieldset>
    <legend>{t("labels.layers")}</legend>
    <div className="buttonList">
      {renderAction("sendToBack")}
      {renderAction("sendBackward")}
      {renderAction("bringForward")}
      {renderAction("bringToFront")}
    </div>
  </fieldset>
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
    <fieldset>
      <legend>{t("labels.align")}</legend>
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
    </fieldset>
  );
};

/**
 * Full styles panel: the wide, always-expanded layout used on desktop when the
 * UI is in "full" mode.
 */
export const SelectedShapeActions = ({
  appState,
  elementsMap,
  renderAction,
  app,
}: {
  appState: UIAppState;
  elementsMap: NonDeletedElementsMap | NonDeletedSceneElementsMap;
  renderAction: ActionManager["renderAction"];
  app: AppClassProperties;
}) => {
  const targetElements = getTargetElements(elementsMap, appState);
  const predicates = getShapeActionPredicates(
    appState,
    targetElements,
    elementsMap,
    app,
  );
  const tableSelected = targetElements.some(isTableElement);

  if (app.mindmap.getSelectedEdge()) {
    return (
      <div className="selected-shape-actions">
        <MindmapSelectedEdgeStylePanel app={app} />
      </div>
    );
  }

  // the bucket fill tool configures only the fill it creates: color, fill
  // style, and opacity (shared `currentItem*` values; no stroke properties)
  if (appState.activeTool.type === "bucketfill") {
    return (
      <div className="selected-shape-actions">
        <div>{renderAction("changeBucketFillBackgroundColor")}</div>
        {renderAction("changeFillStyle")}
        {renderAction("changeOpacity")}
      </div>
    );
  }

  if (appState.tableCellSelection) {
    return (
      <div className="selected-shape-actions">
        <TableStyleActions app={app} appState={appState} />
        <fieldset>
          <legend>{t("labels.actions")}</legend>
          <div className="buttonList table-cell-action-buttons">
            <TableCellCompactActions
              app={app}
              appState={appState}
              setAppState={app.setState.bind(app)}
            />
          </div>
        </fieldset>
      </div>
    );
  }

  return (
    <div className="selected-shape-actions">
      <TableStyleActions app={app} appState={appState} />
      {app.mindmap.getSelectedGraphRoot() ? (
        <MindmapGraphStylePanel app={app} />
      ) : (
        app.mindmap.getSelectedNode() && <MindmapNodeStylePanel app={app} />
      )}
      <div>{predicates.strokeColor && renderAction("changeStrokeColor")}</div>
      {predicates.backgroundColor && (
        <div>{renderAction("changeBackgroundColor")}</div>
      )}
      {predicates.fill && renderAction("changeFillStyle")}

      {predicates.strokeWidth && renderAction("changeStrokeWidth")}

      {predicates.strokeStyle && <>{renderAction("changeStrokeStyle")}</>}

      {predicates.freedrawMode && renderAction("changeFreedrawMode")}

      {predicates.sloppiness && <>{renderAction("changeSloppiness")}</>}

      {predicates.roundness && <>{renderAction("changeRoundness")}</>}

      {predicates.arrowType && <>{renderAction("changeArrowType")}</>}

      {predicates.text && (
        <>
          <fieldset>{renderAction("changeFontFamily")}</fieldset>
          {renderAction("changeFontSize")}
          {predicates.textAlign && renderAction("changeTextAlign")}
        </>
      )}

      {predicates.verticalAlign && renderAction("changeVerticalAlign")}
      {predicates.arrowheads && <>{renderAction("changeArrowhead")}</>}

      {predicates.opacity && !tableSelected && renderAction("changeOpacity")}

      {predicates.layers && <LayersFieldset renderAction={renderAction} />}

      {predicates.align && (
        <AlignFieldset
          renderAction={renderAction}
          showDistribute={predicates.distribute}
        />
      )}
      {predicates.showExtraActions && (
        <fieldset>
          <legend>{t("labels.actions")}</legend>
          <div className="buttonList">
            {renderAction("duplicateSelection")}
            {renderAction("deleteSelectedElements")}
            {renderAction("group")}
            {renderAction("ungroup")}
            {predicates.link && renderAction("hyperlink")}
            {predicates.cropEditor && renderAction("cropEditor")}
            {predicates.lineEditor && renderAction("toggleLinearEditor")}
          </div>
        </fieldset>
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
  const tableSelected =
    !!appState.tableCellSelection ||
    !!appState.tableRowColSelection ||
    Object.keys(appState.selectedElementIds).some((id) =>
      isTableElement(app.scene.getNonDeletedElement(id)),
    );
  const [tablePropertiesOpen, setTablePropertiesOpen] = useState(false);
  const shouldShowCombinedProperties =
    tableSelected ||
    predicates.hasSelection ||
    (appState.activeTool.type !== "selection" &&
      appState.activeTool.type !== "eraser" &&
      appState.activeTool.type !== "hand" &&
      appState.activeTool.type !== "laser" &&
      appState.activeTool.type !== "lasso");
  const isOpen = tableSelected
    ? tablePropertiesOpen
    : appState.openPopup === "compactStrokeStyles";

  if (!shouldShowCombinedProperties) {
    return null;
  }

  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (tableSelected) {
            setTablePropertiesOpen(open);
          } else if (open) {
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
            title={t("labels.stroke")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              if (tableSelected) {
                setTablePropertiesOpen(!isOpen);
              } else {
                setAppState({
                  openPopup: isOpen ? null : "compactStrokeStyles",
                });
              }
            }}
          >
            {adjustmentsIcon}
          </button>
        </Popover.Trigger>
        {isOpen && (
          <PropertiesPopover
            className={PROPERTIES_CLASSES}
            container={container}
            style={{
              width: tableSelected ? "13rem" : undefined,
              maxWidth: "13rem",
            }}
            onClose={() => {}}
          >
            <div className="selected-shape-actions">
              {tableSelected ? (
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
                  {predicates.sloppiness && (
                    <>{renderAction("changeSloppiness")}</>
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
            style={{ maxWidth: "13rem" }}
            // Improve focus handling for text editing scenarios
            preventAutoFocusOnTouch={!!appState.editingTextElement}
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
            style={{
              maxWidth: "12rem",
              justifyContent: "center",
              alignItems: "center",
            }}
            onClose={() => {}}
          >
            <div className="selected-shape-actions">
              {predicates.layers && (
                <LayersFieldset renderAction={renderAction} />
              )}

              {predicates.align && (
                <AlignFieldset
                  renderAction={renderAction}
                  showDistribute={predicates.distribute}
                />
              )}
              <fieldset>
                <legend>{t("labels.actions")}</legend>
                <div className="buttonList">
                  {renderAction("group")}
                  {renderAction("ungroup")}
                  {predicates.linkSingleOnly && renderAction("hyperlink")}
                  {predicates.cropEditor && renderAction("cropEditor")}
                  {showDuplicate && renderAction("duplicateSelection")}
                  {showDelete && renderAction("deleteSelectedElements")}
                </div>
              </fieldset>
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
  variant = "full",
}: {
  app: AppClassProperties;
  appState: UIAppState;
  variant?: "full" | "fill" | "details";
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
  const getCellFill = (cell: typeof targetCells[number]) =>
    cell.style.backgroundColor ??
    table.table.rows.find((row) => row.id === cell.rowId)?.style
      ?.backgroundColor ??
    table.table.columns.find((column) => column.id === cell.columnId)?.style
      ?.backgroundColor ??
    table.table.style?.backgroundColor ??
    "transparent";
  const color = cellSelection
    ? targetCells[0] && getCellFill(targetCells[0])
    : axisSelection
    ? axis?.style?.backgroundColor ??
      table.table.style?.backgroundColor ??
      "transparent"
    : table.table.style?.backgroundColor ?? "transparent";
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
  const colorPicker = (
    <ColorPicker
      key="fill"
      type="elementBackground"
      label={t("labels.background")}
      color={selectedColor}
      onChange={(nextColor) => update({ backgroundColor: nextColor })}
      palette={DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE}
      topPicks={DEFAULT_ELEMENT_BACKGROUND_PICKS}
      customizableTopPicks="elementBackground"
      compact={variant === "fill"}
      elements={app.scene.getNonDeletedElements()}
      appState={appState}
      updateData={updatePickerState}
    />
  );
  const borderColorPicker = (
    <ColorPicker
      key="border"
      type="elementStroke"
      label={t("labels.stroke")}
      color={
        table.table.style?.borderColor ??
        table.table.style?.gridColor ??
        "#b3b3b3"
      }
      onChange={(nextColor) =>
        update({ borderColor: nextColor, gridColor: nextColor })
      }
      palette={DEFAULT_ELEMENT_STROKE_COLOR_PALETTE}
      topPicks={DEFAULT_ELEMENT_STROKE_PICKS}
      customizableTopPicks="elementStroke"
      compact={variant === "fill"}
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
      {variant !== "details" && tableOnly && (
        <div className={variant === "fill" ? "compact-action-item" : undefined}>
          {variant === "full" && (
            <h3 aria-hidden="true">{t("labels.stroke")}</h3>
          )}
          {borderColorPicker}
        </div>
      )}
      {variant !== "details" && (
        <div className={variant === "fill" ? "compact-action-item" : undefined}>
          {variant === "full" && (
            <h3 aria-hidden="true">{t("labels.background")}</h3>
          )}
          {colorPicker}
        </div>
      )}
      {tableOnly && variant !== "fill" && (
        <>
          <Range
            label="Border width"
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
          <fieldset>
            <legend>Border style</legend>
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
          </fieldset>
          <Range
            label={t("labels.opacity")}
            value={table.table.style?.opacity ?? 100}
            onChange={(value) => update({ opacity: value })}
            min={0}
            max={100}
            step={1}
          />
        </>
      )}
    </div>
  );
};

/**
 * Compact styles panel — the collapsed, popover-driven layout used on tablets
 * and on desktop when the UI is in "compact" mode.
 */
export const CompactShapeActions = ({
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

  if (app.mindmap.getSelectedEdge()) {
    return (
      <div className="compact-shape-actions">
        <MindmapSelectedEdgeStylePanel app={app} />
      </div>
    );
  }

  return (
    <div className="compact-shape-actions">
      {appState.tableCellSelection && (
        <TableCellCompactActions
          app={app}
          appState={appState}
          setAppState={setAppState}
        />
      )}
      <TableStyleActions app={app} appState={appState} variant="fill" />
      {app.mindmap.getSelectedGraphRoot() ? (
        <MindmapGraphStylePanel app={app} />
      ) : (
        app.mindmap.getSelectedNode() && <MindmapNodeStylePanel app={app} />
      )}
      {/* Stroke Color */}
      {predicates.strokeColor && (
        <div className={clsx("compact-action-item")}>
          {renderAction("changeStrokeColor")}
        </div>
      )}

      {/* Background Color (the bucket fill variant excludes `transparent`) */}
      {predicates.backgroundColor && (
        <div className="compact-action-item">
          {renderAction(
            appState.activeTool.type === "bucketfill"
              ? "changeBucketFillBackgroundColor"
              : "changeBackgroundColor",
          )}
        </div>
      )}

      {/* Freedraw pressure: standalone button cycling the variability mode */}
      {predicates.freedrawMode && (
        <div className="compact-action-item">
          {renderAction("changeFreedrawMode", { cycle: true })}
        </div>
      )}

      {!appState.tableCellSelection && !appState.tableRowColSelection && (
        <CombinedShapeProperties
          appState={appState}
          renderAction={renderAction}
          setAppState={setAppState}
          predicates={predicates}
          container={container}
          app={app}
        />
      )}

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
      {predicates.lineEditor && (
        <div className="compact-action-item">
          {renderAction("toggleLinearEditor")}
        </div>
      )}

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

      {/* Dedicated Copy Button */}
      {predicates.showExtraActions && (
        <div className="compact-action-item">
          {renderAction("duplicateSelection")}
        </div>
      )}

      {/* Dedicated Delete Button */}
      {predicates.showExtraActions && (
        <div className="compact-action-item">
          {renderAction("deleteSelectedElements")}
        </div>
      )}

      {!tableSelected && (
        <CombinedExtraActions
          appState={appState}
          renderAction={renderAction}
          predicates={predicates}
          setAppState={setAppState}
          container={container}
        />
      )}
    </div>
  );
};

/**
 * Mobile styles panel — the horizontal action bar used on phones, with an
 * overflow measurement that promotes duplicate/delete out of the popover when
 * there is room.
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

  // 7 actions + 2 for undo/redo
  const MIN_ACTIONS = 9;

  const GAP = 6;
  const WIDTH = 32;

  const MIN_WIDTH = MIN_ACTIONS * WIDTH + (MIN_ACTIONS - 1) * GAP;

  const ADDITIONAL_WIDTH = WIDTH + GAP;

  const showDeleteOutside = ACTIONS_WIDTH >= MIN_WIDTH + ADDITIONAL_WIDTH;
  const showDuplicateOutside =
    ACTIONS_WIDTH >= MIN_WIDTH + 2 * ADDITIONAL_WIDTH;

  if (appState.tableCellSelection) {
    return (
      <Island className="compact-shape-actions mobile-shape-actions table-cell-shape-actions">
        <TableCellCompactActions
          app={app}
          appState={appState}
          setAppState={setAppState}
        />
        <TableStyleActions app={app} appState={appState} variant="fill" />
        <div className="compact-action-item">{renderAction("undo")}</div>
        <div className="compact-action-item">{renderAction("redo")}</div>
      </Island>
    );
  }

  return (
    <Island
      className="compact-shape-actions mobile-shape-actions"
      style={{
        flexDirection: "row",
        boxShadow: "none",
        padding: 0,
        zIndex: 2,
        backgroundColor: "transparent",
        height: WIDTH * 1.35,
        marginBottom: 4,
        alignItems: "center",
        gap: GAP,
        pointerEvents: "none",
      }}
      ref={mobileActionsRef}
    >
      <TableStyleActions app={app} appState={appState} variant="fill" />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: GAP,
          flex: 1,
        }}
      >
        {predicates.strokeColor && (
          <div className={clsx("compact-action-item")}>
            {renderAction("changeStrokeColor")}
          </div>
        )}
        {/* Background Color (the bucket fill variant excludes `transparent`) */}
        {predicates.backgroundColor && (
          <div className="compact-action-item">
            {renderAction(
              appState.activeTool.type === "bucketfill"
                ? "changeBucketFillBackgroundColor"
                : "changeBackgroundColor",
            )}
          </div>
        )}
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
        <LinearEditorAction
          renderAction={renderAction}
          predicates={predicates}
        />
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

        {/* Combined Other Actions */}
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
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: GAP,
        }}
      >
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
      </div>
    </Island>
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
