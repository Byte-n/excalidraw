import clsx from "clsx";
import { useEffect, useState } from "react";

import { KEYS, capitalizeString } from "@excalidraw/common";
import {
  STICKY_NOTE_PRESETS,
  TABLE_PRESET_IDS,
  findStickyNotePreset,
  getStickyNoteCreationInk,
  isTablePresetId,
  supportsFill,
} from "@excalidraw/element";

import type { BaseShapeId, PointerType } from "@excalidraw/element/types";
import type { TablePresetId } from "@excalidraw/element";

import { trackEvent } from "../analytics";
import { t } from "../i18n";
import { getShortcutKey } from "../shortcut";

import { getCompositeShapeIcon } from "./CompositeShapeIcon";
import { IconButton } from "./IconButton";
import { getStickyNotePresetIcon } from "./StickyNotePresetIcon";
import { getTablePresetIcon } from "./TablePresetIcon";
import { ToolPopover } from "./ToolPopover";
import {
  SelectionIcon,
  RectangleIcon,
  DiamondIcon,
  EllipseIcon,
  ArrowIcon,
  LineIcon,
  FreedrawIcon,
  drawShapeToolIcon,
  TextIcon,
  ImageIcon,
  EraserIcon,
  laserPointerToolIcon,
  bucketFillIcon,
  LassoIcon,
  handIcon,
  frameToolIcon,
  EmbedIcon,
  stickyNoteToolIcon,
  mindmapIcon,
  tableToolIcon,
} from "./icons";

import type {
  AppClassProperties,
  AppState,
  ToolType,
  UIAppState,
} from "../types";

export type ToolConfig = {
  icon: React.ReactNode;
  /** letter shortcut(s) — the first one is shown in tooltips and badges */
  letterKey?: string | readonly string[];
  /** whether `letterKey` requires Shift to be held (e.g. Shift+X) */
  shiftKey?: boolean;
  numericKey?: string;
  /** whether the tool's shapes can be filled — fills the icon when active */
  fillable?: boolean;
  /**
   * re-activating the tool switches back to the previously active tool
   * (via the keyboard shortcut or ESC — see `setActiveTool`'s `toggle`
   * option)
   */
  toggle?: boolean;
};

/** preserves the exact keys while typing every entry as ToolConfig */
const defineTools = <T extends Record<string, ToolConfig>>(tools: T) =>
  tools as { [K in keyof T]: ToolConfig };

/**
 * Tool data — the single source of truth for tool buttons, keyboard
 * shortcuts (`findShapeByKey`), and the command palette. Toolbar placement
 * is not defined here: toolbars compose the `*ToolButton` components below
 * manually, so entries without a toolbar slot (e.g. laser) are data-only.
 */
export const TOOLS = defineTools({
  hand: {
    icon: handIcon,
    letterKey: KEYS.H,
    toggle: true,
  },
  selection: {
    icon: SelectionIcon,
    letterKey: KEYS.V,
    numericKey: KEYS["1"],
    fillable: true,
  },
  rectangle: {
    icon: RectangleIcon,
    letterKey: KEYS.R,
    numericKey: KEYS["2"],
    fillable: true,
  },
  diamond: {
    icon: DiamondIcon,
    fillable: true,
  },
  ellipse: {
    icon: EllipseIcon,
    fillable: true,
  },
  arrow: {
    icon: ArrowIcon,
    letterKey: KEYS.A,
    numericKey: KEYS["5"],
    fillable: true,
  },
  line: {
    icon: LineIcon,
    letterKey: KEYS.L,
    numericKey: KEYS["6"],
    fillable: true,
  },
  freedraw: {
    icon: FreedrawIcon,
    letterKey: [KEYS.P, KEYS.X],
    numericKey: KEYS["7"],
  },
  text: {
    icon: TextIcon,
    letterKey: KEYS.T,
    numericKey: KEYS["8"],
  },
  stickynote: {
    icon: stickyNoteToolIcon,
    letterKey: KEYS.N,
  },
  image: {
    icon: ImageIcon,
    numericKey: KEYS["9"],
  },
  eraser: {
    icon: EraserIcon,
    letterKey: KEYS.E,
    numericKey: KEYS["0"],
    toggle: true,
  },
  frame: {
    icon: frameToolIcon,
    letterKey: KEYS.F,
  },
  autoshape: {
    icon: drawShapeToolIcon,
    letterKey: KEYS.X,
    shiftKey: true,
    fillable: false,
  },
  embeddable: {
    icon: EmbedIcon,
  },
  laser: {
    icon: laserPointerToolIcon,
    letterKey: KEYS.K,
  },
  bucketfill: {
    icon: bucketFillIcon,
    letterKey: KEYS.B,
  },
  mindmap: {
    icon: mindmapIcon,
    letterKey: "m",
  },
  table: {
    icon: tableToolIcon,
    // J is the first unclaimed plain letter — "table" has no free initial
    // (T is the text tool)
    letterKey: KEYS.J,
  },
  lasso: {
    icon: LassoIcon,
    fillable: false,
  },
});

export type ToolbarToolType = keyof typeof TOOLS;

/**
 * tools that, when activated while already active, switch back to the
 * previously active tool (see `setActiveTool`'s `toggle` option)
 */
export const TOGGLE_TOOLS: readonly (ToolType | "custom")[] = (
  Object.keys(TOOLS) as ToolbarToolType[]
).filter((type) => TOOLS[type].toggle);

export const getToolLetter = (type: ToolbarToolType) => {
  const { letterKey, shiftKey } = TOOLS[type];
  if (!letterKey) {
    return letterKey;
  }
  const letter = capitalizeString(
    typeof letterKey === "string" ? letterKey : letterKey[0],
  );
  return shiftKey ? getShortcutKey(`Shift+${letter}`) : letter;
};

/** human-readable shortcut hint, e.g. "R or 2", used in tooltips & aria */
export const getToolShortcut = (type: ToolbarToolType) => {
  const letter = getToolLetter(type);
  const { numericKey } = TOOLS[type];
  return letter && numericKey != null
    ? `${letter} ${t("helpDialog.or")} ${numericKey}`
    : letter || numericKey;
};

export const findShapeByKey = (
  key: string,
  app: AppClassProperties,
  shiftKey: boolean = false,
) => {
  // CapsLock-insensitive: the caller excludes every modifier but shift, and
  // shift is matched explicitly below, so a capital letter on its own means
  // CapsLock
  const lowerKey = key.toLowerCase();

  for (const type of Object.keys(TOOLS) as ToolbarToolType[]) {
    const { letterKey, numericKey, shiftKey: requiresShift } = TOOLS[type];
    // shift-bound tools require shift; plain-bound ones require its absence
    if (shiftKey !== Boolean(requiresShift)) {
      continue;
    }
    if (
      (numericKey != null && key === numericKey) ||
      (letterKey &&
        (typeof letterKey === "string"
          ? letterKey === lowerKey
          : letterKey.includes(lowerKey)))
    ) {
      // the selection shortcut activates whichever selection tool the user
      // prefers (selection or lasso)
      if (type === "selection") {
        return app.state.preferredSelectionTool.type;
      }
      // R/2 activates whichever generic shape the user selected in the
      // grouped toolbar button.
      if (type === "rectangle") {
        return app.state.preferredGenericShape === "diamond" ||
          app.state.preferredGenericShape === "ellipse"
          ? app.state.preferredGenericShape
          : "rectangle";
      }
      return type;
    }
  }
  return null;
};

/**
 * Whether a toolbar entry activating the given tool renders disabled — true
 * when the active tool is host-controlled (`props.activeTool`) and the entry
 * doesn't activate the forced tool (`setActiveTool` refuses it).
 */
export const isToolButtonDisabled = (app: AppClassProperties, type: string) =>
  app.props.activeTool != null && app.props.activeTool.type !== type;

export type ToolButtonComponentProps = {
  app: AppClassProperties;
  activeTool: UIAppState["activeTool"];
  /** hide the keybinding badge rendered in the button's corner */
  hideKeyBinding?: boolean;
  /**
   * hide all shortcut affordances (tooltip hint, aria-keyshortcuts, and the
   * keybinding badge) — used on mobile where there's no keyboard
   */
  hideShortcut?: boolean;
};

type ToolButtonBehavior = {
  /**
   * display the shortcut of another tool (tooltip, aria, keybinding badge) —
   * e.g. the lasso button shows the selection shortcut, which activates it
   * when lasso is the preferred selection tool
   */
  shortcutType?: ToolbarToolType;
  /**
   * custom activation — replaces the default track + `setActiveTool` (pen
   * detection still runs before it)
   */
  onSelect?: (
    app: AppClassProperties,
    data: { pointerType: PointerType | null },
  ) => void;
};

/**
 * Creates a toolbar button component for the given tool. Activation is
 * uniform: track + `setActiveTool` (recording the previous tool for toggle
 * tools), with pen detection on the first pen interaction.
 */
const createToolButton = (
  type: ToolbarToolType,
  behavior?: ToolButtonBehavior,
) => {
  const config = TOOLS[type];
  const shortcutType = behavior?.shortcutType ?? type;

  const ToolButtonComponent = ({
    app,
    activeTool,
    hideKeyBinding,
    hideShortcut,
  }: ToolButtonComponentProps) => {
    const label = capitalizeString(t(`toolBar.${type}`));
    const shortcut = hideShortcut ? null : getToolShortcut(shortcutType);

    return (
      <IconButton
        className={clsx({ fillable: config.fillable })}
        type="toggle"
        icon={config.icon}
        checked={activeTool.type === type}
        disabled={isToolButtonDisabled(app, type)}
        title={shortcut ? `${label} — ${shortcut}` : label}
        keyBindingLabel={
          hideKeyBinding || hideShortcut
            ? undefined
            : getToolLetter(shortcutType) || TOOLS[shortcutType].numericKey
        }
        aria-label={label}
        aria-keyshortcuts={shortcut ?? undefined}
        data-testid={`toolbar-${type}`}
        onPointerDown={(event) => {
          // a draggable tool can be dragged out onto the canvas; a press that
          // stays put is still a click (`onSelect`)
          app.toolDrag.handleButtonPointerDown(type, event.nativeEvent);
        }}
        onSelect={({ pointerType }) => {
          if (!app.state.penDetected && pointerType === "pen") {
            app.togglePenMode(true);
          }

          if (behavior?.onSelect) {
            behavior.onSelect(app, { pointerType });
            return;
          }

          if (app.state.activeTool.type !== type) {
            trackEvent("toolbar", type, "ui");
            app.setActiveTool({ type });
          }
        }}
      />
    );
  };

  ToolButtonComponent.displayName = `${capitalizeString(type)}IconButton`;

  return ToolButtonComponent;
};

export const HandToolButton = createToolButton("hand");
export const RectangleToolButton = createToolButton("rectangle");
export const DiamondToolButton = createToolButton("diamond");
export const EllipseToolButton = createToolButton("ellipse");
export const ArrowToolButton = createToolButton("arrow");
export const LineToolButton = createToolButton("line");
export const FreedrawToolButton = createToolButton("freedraw");
export const TextToolButton = createToolButton("text");
export const ImageToolButton = createToolButton("image");
export const EraserToolButton = createToolButton("eraser");
export const FrameToolButton = createToolButton("frame");
export const TableToolButton = createToolButton("table");
export const MindmapToolButton = createToolButton("mindmap");

/**
 * The selection tool button — pointer-clicking it while the selection tool
 * is active switches to lasso.
 */
export const SelectionToolButton = createToolButton("selection", {
  onSelect: (app, { pointerType }) => {
    if (app.state.activeTool.type === "selection" && pointerType !== null) {
      // pointer-clicking the active selection tool switches to lasso;
      // keyboard/AT activation stays on selection
      app.setActiveTool({ type: "lasso" });
      return;
    }

    if (app.state.activeTool.type !== "selection") {
      trackEvent("toolbar", "selection", "ui");
      app.setActiveTool({ type: "selection" });
    }
  },
});

/**
 * Rendered in place of the selection button when lasso is the preferred
 * selection tool; the selection shortcut activates it then.
 */
export const LassoToolButton = createToolButton("lasso", {
  shortcutType: "selection",
});

/**
 * The selection ⇄ lasso popover used in all toolbars; picking an option also
 * makes it the preferred selection tool.
 */
export const SelectionToolPopover = ({
  app,
  activeTool,
  setAppState,
  showShortcut = false,
}: {
  app: AppClassProperties;
  activeTool: UIAppState["activeTool"];
  setAppState: React.Component<any, AppState>["setState"];
  showShortcut?: boolean;
}) => {
  const SELECTION_TOOLS = [
    {
      type: "selection",
      icon: TOOLS.selection.icon,
      fillable: TOOLS.selection.fillable,
      title: capitalizeString(t("toolBar.selection")),
    },
    {
      type: "lasso",
      icon: TOOLS.lasso.icon,
      fillable: TOOLS.lasso.fillable,
      title: capitalizeString(t("toolBar.lasso")),
    },
  ] as const;

  const displayedOption =
    SELECTION_TOOLS.find(
      (tool) => tool.type === app.state.preferredSelectionTool.type,
    ) || SELECTION_TOOLS[0];

  return (
    <ToolPopover
      app={app}
      options={SELECTION_TOOLS}
      activeTool={activeTool}
      defaultOption={app.state.preferredSelectionTool.type}
      data-testid="toolbar-selection"
      onToolChange={(type: string) => {
        if (type === "selection" || type === "lasso") {
          app.setActiveTool({ type });
          setAppState({
            preferredSelectionTool: { type, initialized: true },
          });
        }
      }}
      displayedOption={displayedOption}
      keyBindingLabel={showShortcut ? getToolLetter("selection") : undefined}
      shortcut={showShortcut ? getToolShortcut("selection") : undefined}
      ariaKeyshortcuts={showShortcut ? getToolShortcut("selection") : undefined}
    />
  );
};

type GenericShapeType = BaseShapeId | "right-triangle" | "left-triangle";

const isGenericShapeType = (type: string): type is GenericShapeType =>
  [
    "rectangle",
    "diamond",
    "ellipse",
    "cross",
    "brace-reverse",
    "brace",
    "cloud",
    "double-arrow",
    "forward-arrow",
    "backward-arrow",
    "octagon",
    "pentagon",
    "hexagon",
    "star",
    "triangle",
    "right-triangle",
    "left-triangle",
    "round-rect",
    "rectangle-bubble",
    "pill",
    "bubble",
    "trapezoid",
    "parallelogram",
    "right-pentagon",
    "step",
    "cube",
    "cylinder",
    "pie",
    "circular-ring",
  ].includes(type);

const SHAPE_TOOLS = (
  Object.freeze([
    "rectangle",
    "diamond",
    "ellipse",
    "cross",
    "brace-reverse",
    "brace",
    "cloud",
    "double-arrow",
    "forward-arrow",
    "backward-arrow",
    "octagon",
    "pentagon",
    "hexagon",
    "star",
    "triangle",
    "right-triangle",
    "left-triangle",
    "round-rect",
    "rectangle-bubble",
    "pill",
    "bubble",
    "trapezoid",
    "parallelogram",
    "right-pentagon",
    "step",
    "cube",
    "cylinder",
    "pie",
    "circular-ring",
  ]) as readonly GenericShapeType[]
).map((type) => ({
  type,
  icon:
    type === "diamond"
      ? DiamondIcon
      : type === "ellipse"
      ? EllipseIcon
      : type === "rectangle"
      ? RectangleIcon
      : getCompositeShapeIcon(type),
  fillable:
    type === "right-triangle" || type === "left-triangle" || supportsFill(type),
  title: capitalizeString(type.replaceAll("-", " ")),
}));

/**
 * The rectangle/diamond/ellipse popover used by the desktop and mobile
 * toolbars. The trigger displays the user's preferred generic shape.
 */
export const GenericShapeToolPopover = ({
  app,
  activeTool,
  hideShortcut = false,
}: {
  app: AppClassProperties;
  activeTool: UIAppState["activeTool"];
  hideShortcut?: boolean;
}) => {
  useEffect(() => {
    const activeType = activeTool.type as string;
    const preferredIsExtended =
      app.state.preferredGenericShape !== "rectangle" &&
      app.state.preferredGenericShape !== "diamond" &&
      app.state.preferredGenericShape !== "ellipse";
    if (
      isGenericShapeType(activeType) &&
      !(activeType === "rectangle" && preferredIsExtended) &&
      !(
        activeType === "triangle" &&
        (app.state.preferredGenericShape === "right-triangle" ||
          app.state.preferredGenericShape === "left-triangle")
      ) &&
      app.state.preferredGenericShape !== activeType
    ) {
      app.setAppState({ preferredGenericShape: activeType });
    }
  }, [activeTool.type, app]);

  const preferredGenericShape =
    isGenericShapeType(activeTool.type) &&
    app.state.preferredGenericShape === activeTool.type
      ? activeTool.type
      : app.state.preferredGenericShape;

  const displayedOption =
    SHAPE_TOOLS.find((tool) => tool.type === preferredGenericShape) ||
    SHAPE_TOOLS[0];

  return (
    <ToolPopover
      app={app}
      options={SHAPE_TOOLS}
      activeTool={activeTool}
      activeOptionType={
        activeTool.type === "rectangle"
          ? preferredGenericShape
          : activeTool.type
      }
      defaultOption={preferredGenericShape}
      data-testid="toolbar-rectangle"
      onToolChange={(type: string) => {
        if (isGenericShapeType(type)) {
          app.setAppState({ preferredGenericShape: type });
          app.setActiveTool({
            type: type === "diamond" || type === "ellipse" ? type : "rectangle",
          });
        }
      }}
      displayedOption={displayedOption}
      keyBindingLabel={
        hideShortcut
          ? undefined
          : getToolLetter("rectangle") || TOOLS.rectangle.numericKey
      }
      ariaKeyshortcuts={hideShortcut ? undefined : getToolShortcut("rectangle")}
      shortcut={hideShortcut ? null : getToolShortcut("rectangle")}
    />
  );
};

/**
 * 当前便签样式不匹配任何预设时的伪选项标识。它只让触发按钮显示「当前生效
 * 样式」这张缩略图，不会出现在选项列表里，也就选不中。
 */
const CUSTOM_STICKY_NOTE_STYLE = "custom-style";

/**
 * 便签工具的内置样式 popover，与普通图形分组同一套交互：触发按钮显示当前
 * 样式、点选项即选用该样式并激活便签工具。预设只写「新建便签的默认色」
 * （`currentItemStickynote*`），画布上已有的便签一律不动。
 */
export const StickyNoteToolPopover = ({
  app,
  activeTool,
  hideShortcut = false,
}: {
  app: AppClassProperties;
  activeTool: UIAppState["activeTool"];
  hideShortcut?: boolean;
}) => {
  const { theme } = app.state;
  const backgroundColor = app.state.currentItemStickynoteBackgroundColor;
  // 生效墨色按创建规则推导，缩略图与高亮因此对得上「照这个样式新建的便签」
  const ink = getStickyNoteCreationInk(
    backgroundColor,
    app.state.currentItemStickynoteStrokeColor,
  );
  const current = findStickyNotePreset(
    backgroundColor,
    app.state.currentItemStickynoteStrokeColor,
  );

  const PRESET_TOOLS = STICKY_NOTE_PRESETS.map((preset) => ({
    type: preset.id,
    icon: getStickyNotePresetIcon(
      preset.backgroundColor,
      preset.strokeColor,
      theme,
    ),
    // 预设由纸色唯一确定，配色族的既有译名（colors.*）就是它的名字
    title: t(`colors.${preset.id}`),
  }));

  return (
    <ToolPopover
      app={app}
      options={PRESET_TOOLS}
      activeTool={activeTool}
      activeOptionType={current?.id}
      defaultOption={current?.id ?? CUSTOM_STICKY_NOTE_STYLE}
      data-testid="toolbar-stickynote"
      sharedToolType="stickynote"
      isTriggerChecked={activeTool.type === "stickynote"}
      onTriggerPointerDown={(event) => {
        // 便签可以从工具栏拖到画布上放下（见 AppToolDrag）：按下即武装，
        // 原地松开仍由触发按钮的点击负责开合弹层
        app.toolDrag.handleButtonPointerDown("stickynote", event.nativeEvent);
      }}
      onToolChange={(type: string) => {
        const preset = STICKY_NOTE_PRESETS.find((p) => p.id === type);
        if (preset) {
          app.setAppState({
            currentItemStickynoteBackgroundColor: preset.backgroundColor,
            currentItemStickynoteStrokeColor: preset.strokeColor,
          });
        }
        app.setActiveTool({ type: "stickynote" });
      }}
      displayedOption={{
        type: current?.id ?? CUSTOM_STICKY_NOTE_STYLE,
        icon: getStickyNotePresetIcon(backgroundColor, ink, theme),
        title: current ? t(`colors.${current.id}`) : t("toolBar.stickynote"),
      }}
      keyBindingLabel={hideShortcut ? undefined : getToolLetter("stickynote")}
      ariaKeyshortcuts={
        hideShortcut ? undefined : getToolShortcut("stickynote")
      }
      shortcut={hideShortcut ? null : getToolShortcut("stickynote")}
    />
  );
};

/**
 * 表格预设的选项文案：`plain` 就是工具名本身，两条泳道用各自的预设名（也正是
 * 新建出来的表里标题带上那行字）。
 */
const TABLE_PRESET_TITLES: Record<TablePresetId, Parameters<typeof t>[0]> = {
  plain: "toolBar.table",
  "swimlane-horizontal": "toolBar.swimlaneHorizontal",
  "swimlane-vertical": "toolBar.swimlaneVertical",
};

/**
 * 表格工具的内置预设 popover，与便签样式弹层同一套交互：触发按钮显示当前预设
 * 的缩略图，点选项即换预设并激活表格工具。预设只决定**新建**的表长什么样
 * （见 `app/createPresets`），画布上已有的表一律不动。
 */
export const TableToolPopover = ({
  app,
  activeTool,
  hideShortcut = false,
}: {
  app: AppClassProperties;
  activeTool: UIAppState["activeTool"];
  hideShortcut?: boolean;
}) => {
  const current = app.state.currentTablePreset;
  const PRESET_TOOLS = TABLE_PRESET_IDS.map((id) => ({
    type: id,
    icon: getTablePresetIcon(id, app.state.theme),
    title: t(TABLE_PRESET_TITLES[id]),
  }));
  const displayedOption =
    PRESET_TOOLS.find((option) => option.type === current) || PRESET_TOOLS[0];

  return (
    <ToolPopover
      app={app}
      options={PRESET_TOOLS}
      activeTool={activeTool}
      activeOptionType={current}
      defaultOption={current}
      data-testid="toolbar-table"
      // 选项是预设不是工具：选哪一条都是激活表格工具（同便签样式）
      sharedToolType="table"
      isTriggerChecked={activeTool.type === "table"}
      onToolChange={(type: string) => {
        if (isTablePresetId(type)) {
          app.setAppState({ currentTablePreset: type });
        }
        app.setActiveTool({ type: "table" });
      }}
      displayedOption={displayedOption}
      keyBindingLabel={hideShortcut ? undefined : getToolLetter("table")}
      ariaKeyshortcuts={hideShortcut ? undefined : getToolShortcut("table")}
      shortcut={hideShortcut ? null : getToolShortcut("table")}
    />
  );
};

/**
 * The freedraw ⇄ draw-shape popover used in compact (tablet) and mobile
 * toolbars. The trigger remembers and displays the most recently used option.
 */
export const FreedrawToolPopover = ({
  app,
  activeTool,
}: {
  app: AppClassProperties;
  activeTool: UIAppState["activeTool"];
}) => {
  const DRAWING_TOOLS = [
    {
      type: "freedraw",
      icon: TOOLS.freedraw.icon,
      fillable: TOOLS.freedraw.fillable,
      title: capitalizeString(t("toolBar.freedraw")),
    },
    {
      type: "autoshape",
      icon: TOOLS.autoshape.icon,
      fillable: TOOLS.autoshape.fillable,
      title: capitalizeString(t("toolBar.autoshape")),
    },
  ] as const;

  const [lastDrawingTool, setLastDrawingTool] = useState<
    typeof DRAWING_TOOLS[number]["type"]
  >(activeTool.type === "autoshape" ? "autoshape" : "freedraw");

  useEffect(() => {
    if (activeTool.type === "freedraw" || activeTool.type === "autoshape") {
      setLastDrawingTool(activeTool.type);
    }
  }, [activeTool.type]);

  const displayedOption =
    DRAWING_TOOLS.find((tool) => tool.type === lastDrawingTool) ||
    DRAWING_TOOLS[0];

  return (
    <ToolPopover
      app={app}
      options={DRAWING_TOOLS}
      activeTool={activeTool}
      defaultOption={lastDrawingTool}
      data-testid="toolbar-freedraw"
      onToolChange={(type: string) => {
        if (type === "freedraw" || type === "autoshape") {
          setLastDrawingTool(type);
          app.setActiveTool({ type });
        }
      }}
      displayedOption={displayedOption}
    />
  );
};
