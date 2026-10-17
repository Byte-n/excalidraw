import {
  COLOR_PALETTE,
  DEFAULT_FRAME_PRESET_SIZE,
  DEFAULT_NEW_ELEMENT_STROKE_COLOR,
  DEFAULT_STICKY_NOTE_PRESET_SIZE,
  KEYS,
  reseed,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";

import {
  STICKY_NOTE_PRESETS,
  getCommonBounds,
  isCompositeShapeElement,
  isMindmapNodeElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawStickyNoteElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import {
  SHAPE_DRAWER_WIDTH_PX,
  SHAPE_SHEET_HEIGHT_RATIO,
} from "../components/app/presetPlacement";
import { SHAPE_PRESET_DEFAULTS } from "../components/shapePresetDefaults";
import { Excalidraw } from "../index";
import { t } from "../i18n";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  screen,
} from "./test-utils";

const { h } = window;

const POINTER = {
  pointerId: 1,
  pointerType: "mouse",
  isPrimary: true,
} as const;

const live = (): readonly ExcalidrawElement[] =>
  h.app.scene.getNonDeletedElements();

/** 抽屉根节点：桌面是 `<aside data-testid="shape-drawer">`，手机是 portal 容器 */
const drawerRoot = () =>
  document.querySelector<HTMLElement>('[data-testid="shape-drawer"]');

const groupPanel = (id: string) =>
  document.getElementById(`shape-drawer-panel-${id}`) as HTMLElement;

const groupToggle = (id: string) =>
  screen.getByTestId(`shape-drawer-group-${id}`);

/** 从普通图形 popover 点「更多功能」→ 打开图形抽屉 */
const openDrawer = () => {
  fireEvent.click(screen.getByTestId("toolbar-rectangle"));
  fireEvent.click(screen.getByTestId("tool-popover-more"));
};

/** 展开某个分区（已展开则 no-op） */
const expandGroup = (id: string) => {
  const toggle = groupToggle(id);
  if (toggle.getAttribute("aria-expanded") === "false") {
    fireEvent.click(toggle);
  }
};

/** 单击一个抽屉格子（不带指针手势 → 走「单击落地」分支） */
const placeItem = (id: string) => {
  fireEvent.click(screen.getByTestId(`shape-drawer-item-${id}`));
};

/**
 * 可见区域中心的场景坐标。算式按设计稿独立推导（视口中心右移半个抽屉宽度
 * ÷ zoom），只复用实现导出的宽度常量——不调用被测函数本身。
 * 默认字号缩放 1、无平移，网格关闭时 `placePreset` 不做吸附，故可与元素包围盒
 * 中心精确对齐。
 */
const expectedVisibleCenter = () => {
  const { width, height, zoom, scrollX, scrollY } = h.state;
  const scale = zoom.value;
  return {
    x: width / (2 * scale) - scrollX + SHAPE_DRAWER_WIDTH_PX / (2 * scale),
    y: height / (2 * scale) - scrollY,
  };
};

const boundsCenter = (elements: readonly ExcalidrawElement[]) => {
  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
};

/** 拖出抽屉格子：按下 → 越过阈值的 pointermove（预览出现）——松手由用例自行派发 */
const dragOut = (itemId: string, clientX: number, clientY: number) => {
  fireEvent.pointerDown(screen.getByTestId(`shape-drawer-item-${itemId}`), {
    ...POINTER,
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  fireEvent.pointerMove(window, { ...POINTER, clientX, clientY });
};

describe("图形抽屉的开合", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    mockBoundingClientRect({ width: 1200, height: 800 });
    await render(<Excalidraw handleKeyboardGlobally />);
    act(() => h.app.refreshEditorInterface());
  });

  afterEach(() => restoreOriginalGetBoundingClientRect());

  it("点「更多功能」打开抽屉，标题与六个分区按 基础→流程图→便签→画框→表格→脑图 出现", () => {
    // 抽屉常挂载：打开前即已存在，但为关闭态
    expect(drawerRoot()).not.toBeNull();
    expect(drawerRoot()).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByTestId("toolbar-rectangle"));
    // 「更多功能」入口在普通图形 popover 的底部整行
    expect(screen.getByTestId("tool-popover-more").textContent).toBe(
      t("shapeDrawer.more"),
    );
    fireEvent.click(screen.getByTestId("tool-popover-more"));

    expect(drawerRoot()).toHaveAttribute("data-open", "true");
    expect(drawerRoot()).toHaveAttribute("role", "dialog");
    expect(drawerRoot()).toHaveAttribute("aria-label", t("shapeDrawer.title"));
    expect(
      drawerRoot()!.querySelector(".shape-drawer__title")?.textContent,
    ).toBe(t("shapeDrawer.title"));

    // 六个分区标题与顺序
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid^="shape-drawer-group-"]',
        ),
      ).map((node) => node.dataset.testid),
    ).toEqual([
      "shape-drawer-group-basic",
      "shape-drawer-group-flowchart",
      "shape-drawer-group-sticky",
      "shape-drawer-group-frame",
      "shape-drawer-group-table",
      "shape-drawer-group-mindmap",
    ]);
    expect(
      Array.from(document.querySelectorAll(".shape-drawer__group-title")).map(
        (node) => node.textContent,
      ),
    ).toEqual([
      t("shapeDrawer.basic"),
      t("shapeDrawer.flowchart"),
      t("shapeDrawer.sticky"),
      t("shapeDrawer.frame"),
      t("shapeDrawer.table"),
      t("shapeDrawer.mindmap"),
    ]);
  });

  it("收起按钮关闭抽屉", () => {
    openDrawer();
    expect(drawerRoot()).toHaveAttribute("data-open", "true");

    fireEvent.click(screen.getByTestId("shape-drawer-close"));

    expect(h.state.openShapeDrawer).toBe(false);
    expect(drawerRoot()).toHaveAttribute("data-open", "false");
  });

  it("Esc 关闭抽屉", () => {
    openDrawer();
    expect(h.state.openShapeDrawer).toBe(true);

    Keyboard.keyPress(KEYS.ESCAPE);

    expect(h.state.openShapeDrawer).toBe(false);
    expect(drawerRoot()).toHaveAttribute("data-open", "false");
  });

  it("画板 pointerdown / 选中图形不关闭抽屉", () => {
    openDrawer();
    expect(h.state.openShapeDrawer).toBe(true);

    fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
      ...POINTER,
      button: 0,
      clientX: 120,
      clientY: 120,
    });

    // 非模态：点画板、选中图形一律不收起
    expect(h.state.openShapeDrawer).toBe(true);
    expect(drawerRoot()).toHaveAttribute("data-open", "true");
  });

  it("点击抽屉外的其他 UI 不关闭抽屉", () => {
    openDrawer();
    expect(h.state.openShapeDrawer).toBe(true);

    // 打到工具栏上「矩形」触发按钮（普通按钮，非 data-prevent-outside-click）
    fireEvent.pointerDown(screen.getByTestId("toolbar-rectangle"), {
      ...POINTER,
      button: 0,
      clientX: 100,
      clientY: 700,
    });

    // 非模态：抽屉以外的其他 UI（工具栏/属性面板/菜单）也不收起
    expect(h.state.openShapeDrawer).toBe(true);
    expect(drawerRoot()).toHaveAttribute("data-open", "true");
  });
});

describe("图形抽屉的分区折叠", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    mockBoundingClientRect({ width: 1200, height: 800 });
    await render(<Excalidraw handleKeyboardGlobally />);
    act(() => h.app.refreshEditorInterface());
    openDrawer();
  });

  afterEach(() => restoreOriginalGetBoundingClientRect());

  it("默认只展开「基础图形」，其余五个分区的网格不可见", () => {
    expect(groupToggle("basic")).toHaveAttribute("aria-expanded", "true");
    expect(groupPanel("basic")).not.toHaveAttribute("hidden");

    for (const id of ["flowchart", "sticky", "frame", "table", "mindmap"]) {
      expect(groupToggle(id)).toHaveAttribute("aria-expanded", "false");
      expect(groupPanel(id)).toHaveAttribute("hidden");
    }
  });

  it("点流程图分区展开后其 fc-* 格子可见，aria-expanded 翻转", () => {
    const toggle = groupToggle("flowchart");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(groupPanel("flowchart")).toHaveAttribute("hidden");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = groupPanel("flowchart");
    expect(panel).not.toHaveAttribute("hidden");
    expect(
      panel.querySelector('[data-testid="shape-drawer-item-fc-diamond"]'),
    ).not.toBeNull();
  });
});

describe("图形抽屉的单击放置", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    mockBoundingClientRect({ width: 1200, height: 800 });
    await render(<Excalidraw handleKeyboardGlobally />);
    act(() => h.app.refreshEditorInterface());
    openDrawer();
  });

  afterEach(() => restoreOriginalGetBoundingClientRect());

  it("点 fc-diamond → 落在可见区域中心，且不武装工具、不改当前图形", () => {
    expandGroup("flowchart");
    // 打开抽屉时入口点击会把当前工具置为 rectangle —— 记录点击格子之前的值
    const toolBefore = h.state.activeTool.type;
    const shapeBefore = h.state.preferredGenericShape;
    const center = expectedVisibleCenter();

    placeItem("fc-diamond");

    // 非模态：放完预设抽屉保持展开，便于连续取用
    expect(h.state.openShapeDrawer).toBe(true);
    expect(drawerRoot()).toHaveAttribute("data-open", "true");

    const created = live();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: "composite_shape",
      shape: { id: "fc-diamond", schemaVersion: 1 },
      width: SHAPE_PRESET_DEFAULTS["fc-diamond"].width,
      height: SHAPE_PRESET_DEFAULTS["fc-diamond"].height,
      // 抽屉放置用的是该图形的预设默认填色，不是工具栏当前色
      backgroundColor: COLOR_PALETTE.yellow[0],
      strokeWidth: 1,
    });

    // 包围盒中心 == 可见区域中心（视口中心 + 半个抽屉宽度 ÷ zoom）
    const got = boundsCenter(created);
    expect(got.x).toBeCloseTo(center.x);
    expect(got.y).toBeCloseTo(center.y);

    // 取用面板语义：不武装工具、不动工具栏的「当前图形」
    expect(h.state.activeTool.type).toBe(toolBefore);
    expect(h.state.preferredGenericShape).toBe(shapeBefore);
  });

  it("基础图形：点 cube → 落一份 cube 复合图形", () => {
    placeItem("cube");

    const created = live();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: "composite_shape",
      shape: { id: "cube", schemaVersion: 1 },
    });
  });

  it("基础图形：直角三角是无参 id，点 right-triangle / left-triangle 各落 120×80", () => {
    placeItem("right-triangle");
    placeItem("left-triangle");

    const created = live().filter(isCompositeShapeElement);
    expect(created).toHaveLength(2);

    const right = created.find((el) => el.shape.id === "right-triangle")!;
    expect(right).toMatchObject({
      type: "composite_shape",
      shape: { id: "right-triangle", schemaVersion: 1 },
      width: 120,
      height: 80,
    });

    const left = created.find((el) => el.shape.id === "left-triangle")!;
    expect(left).toMatchObject({
      type: "composite_shape",
      shape: { id: "left-triangle", schemaVersion: 1 },
      width: 120,
      height: 80,
    });
  });

  it("尺寸可区分的预设：fc-cylinder 落 80×100、cube 落 148×106，都带默认填色与线宽 1", () => {
    expandGroup("flowchart");
    placeItem("fc-cylinder");
    placeItem("cube");

    const composites = live().filter(isCompositeShapeElement);
    expect(composites).toHaveLength(2);

    const cylinder = composites.find(
      (element) => element.shape.id === "fc-cylinder",
    )!;
    expect(cylinder).toMatchObject({
      width: SHAPE_PRESET_DEFAULTS["fc-cylinder"].width,
      height: SHAPE_PRESET_DEFAULTS["fc-cylinder"].height,
      backgroundColor: COLOR_PALETTE.green[0],
      strokeWidth: 1,
    });

    const cube = composites.find((element) => element.shape.id === "cube")!;
    expect(cube).toMatchObject({
      width: SHAPE_PRESET_DEFAULTS.cube.width,
      height: SHAPE_PRESET_DEFAULTS.cube.height,
      backgroundColor: COLOR_PALETTE.violet[0],
      strokeWidth: 1,
    });
  });

  it("先把 currentItem* 设成非默认值 → 落地的仍是图形预设默认样式", () => {
    act(() => {
      h.app.setAppState({
        currentItemBackgroundColor: "#ff0000",
        currentItemStrokeColor: "#00ff00",
        currentItemFillStyle: "hachure",
        currentItemStrokeStyle: "dashed",
        currentItemStrokeWidthKey: "bold",
        currentItemOpacity: 30,
      });
    });

    expandGroup("flowchart");
    placeItem("fc-cylinder");

    // 放置链路与工具栏当前样式脱钩：填色/描边/线型/线宽/不透明度都是预设默认
    expect(live()[0]).toMatchObject({
      shape: { id: "fc-cylinder" },
      backgroundColor: COLOR_PALETTE.green[0],
      strokeColor: DEFAULT_NEW_ELEMENT_STROKE_COLOR,
      fillStyle: "solid",
      strokeStyle: "solid",
      strokeWidth: 1,
      opacity: 100,
    });
  });

  it("便签：点 blue → 落一份蓝纸便签", () => {
    expandGroup("sticky");
    const preset = STICKY_NOTE_PRESETS.find(
      (candidate) => candidate.id === "blue",
    )!;

    placeItem("blue");

    const notes = live().filter(
      (element): element is ExcalidrawStickyNoteElement =>
        element.type === "stickynote",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].backgroundColor).toBe(preset.backgroundColor);
    expect(notes[0].width).toBe(DEFAULT_STICKY_NOTE_PRESET_SIZE);
    expect(notes[0].baseHeight).toBe(DEFAULT_STICKY_NOTE_PRESET_SIZE);
  });

  it("画框：点 frame → 落一份 400×300 的画框", () => {
    expandGroup("frame");

    placeItem("frame");

    const frames = live().filter((element) => element.type === "frame");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: "frame",
      width: DEFAULT_FRAME_PRESET_SIZE.width,
      height: DEFAULT_FRAME_PRESET_SIZE.height,
    });
  });

  it("表格：点 swimlane-horizontal → 落一张带标签文字的泳道表", () => {
    expandGroup("table");

    placeItem("swimlane-horizontal");

    const tables = live().filter(
      (element): element is ExcalidrawTableElement => element.type === "table",
    );
    expect(tables).toHaveLength(1);

    // 泳道自带标签文字（标题带 + 每条泳道一个名字）
    const labels = live().filter(
      (element): element is ExcalidrawTextElement =>
        element.type === "text" &&
        element.containerRef?.kind === "tableCell" &&
        element.containerRef.role === "backgroundText",
    );
    expect(labels.map((label) => label.originalText)).toEqual([
      t("toolBar.swimlaneHorizontal"),
      t("toolBar.swimlane"),
      t("toolBar.swimlane"),
    ]);
  });

  it("脑图：点 mindmap-down → 根节点 layoutDirection 为 top-to-bottom", () => {
    expandGroup("mindmap");

    placeItem("mindmap-down");

    // 预设树：中心主题 + 3 分支 + 每支 2 子主题 = 10 节点、9 连线
    const nodes = live().filter(isMindmapNodeElement);
    expect(nodes).toHaveLength(10);
    const root = nodes.find((node) => node.role === "root")!;
    expect(root.layoutDirection).toBe("top-to-bottom");
    expect(
      live().filter((element) => element.type === "mindmap-edge"),
    ).toHaveLength(9);
  });
});

describe("图形抽屉的拖入", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    mockBoundingClientRect({ width: 1200, height: 800 });
    await render(<Excalidraw handleKeyboardGlobally />);
    act(() => h.app.refreshEditorInterface());
    openDrawer();
  });

  afterEach(() => restoreOriginalGetBoundingClientRect());

  it("拖泳道表格入画布：多元素预览、落在松手处、清空预览、复位选择工具、一步撤销", () => {
    expandGroup("table");
    const dropClient = { clientX: 300, clientY: 260 };

    dragOut("swimlane-horizontal", dropClient.clientX, dropClient.clientY);

    // 预览是整张表（表 + 三条标签），尚不入场景
    const preview = h.app.toolDrag.previewElements!;
    expect(preview).not.toBeNull();
    expect(preview.length).toBe(4);
    expect(preview.map((element) => element.type)).toEqual([
      "table",
      "text",
      "text",
      "text",
    ]);
    expect(live()).toHaveLength(0);
    expect(API.getUndoStack()).toHaveLength(0);

    fireEvent.pointerUp(GlobalTestState.interactiveCanvas, {
      ...POINTER,
      button: 0,
      ...dropClient,
    });

    // 预览清空，整张表落在松手处（包围盒中心对到指针）
    expect(h.app.toolDrag.previewElements).toBeNull();
    const dropped = live();
    expect(dropped).toHaveLength(4);
    const dropScene = viewportCoordsToSceneCoords(dropClient, h.state);
    const center = boundsCenter(dropped);
    expect(center.x).toBeCloseTo(dropScene.x);
    expect(center.y).toBeCloseTo(dropScene.y);

    // 工具复位为选择工具
    expect(h.state.activeTool.type).toBe("selection");
    // 整次拖入是一步可撤销
    expect(API.getUndoStack()).toHaveLength(1);
    Keyboard.undo();
    expect(live()).toHaveLength(0);
  });

  it("拖脑图入画布：整图多元素预览，落地后根节点带方向", () => {
    expandGroup("mindmap");
    const dropClient = { clientX: 340, clientY: 200 };

    dragOut("mindmap-down", dropClient.clientX, dropClient.clientY);

    // 整图：10 节点 + 10 绑定文本 + 9 连线
    const preview = h.app.toolDrag.previewElements!;
    expect(preview.length).toBeGreaterThan(1);
    expect(preview.length).toBe(29);
    expect(live()).toHaveLength(0);

    fireEvent.pointerUp(GlobalTestState.interactiveCanvas, {
      ...POINTER,
      button: 0,
      ...dropClient,
    });

    expect(h.app.toolDrag.previewElements).toBeNull();
    const dropped = live();
    expect(dropped).toHaveLength(29);
    const dropScene = viewportCoordsToSceneCoords(dropClient, h.state);
    const center = boundsCenter(dropped);
    expect(center.x).toBeCloseTo(dropScene.x);
    expect(center.y).toBeCloseTo(dropScene.y);

    const root = dropped
      .filter(isMindmapNodeElement)
      .find((node) => node.role === "root")!;
    expect(root.layoutDirection).toBe("top-to-bottom");
    expect(h.state.activeTool.type).toBe("selection");
    expect(API.getUndoStack()).toHaveLength(1);
  });

  it("拖图形入画布：落一份预设默认尺寸的复合图形，包围盒中心在松手处", () => {
    expandGroup("flowchart");
    const dropClient = { clientX: 320, clientY: 240 };

    dragOut("fc-cylinder", dropClient.clientX, dropClient.clientY);

    // 预览是单个元素（跨过拖拽阈值后出现），尚不入场景，样式即预设默认
    const preview = h.app.toolDrag.previewElements!;
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({
      type: "composite_shape",
      shape: { id: "fc-cylinder" },
      width: SHAPE_PRESET_DEFAULTS["fc-cylinder"].width,
      height: SHAPE_PRESET_DEFAULTS["fc-cylinder"].height,
      backgroundColor: COLOR_PALETTE.green[0],
      strokeWidth: 1,
    });
    expect(live()).toHaveLength(0);

    fireEvent.pointerUp(GlobalTestState.interactiveCanvas, {
      ...POINTER,
      button: 0,
      ...dropClient,
    });

    // 预览清空，图形落在松手处：包围盒中心对到指针，不是 x/y
    expect(h.app.toolDrag.previewElements).toBeNull();
    const dropped = live();
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({
      type: "composite_shape",
      shape: { id: "fc-cylinder", schemaVersion: 1 },
      width: SHAPE_PRESET_DEFAULTS["fc-cylinder"].width,
      height: SHAPE_PRESET_DEFAULTS["fc-cylinder"].height,
      backgroundColor: COLOR_PALETTE.green[0],
      strokeWidth: 1,
    });
    const dropScene = viewportCoordsToSceneCoords(dropClient, h.state);
    const center = boundsCenter(dropped);
    expect(center.x).toBeCloseTo(dropScene.x);
    expect(center.y).toBeCloseTo(dropScene.y);

    // 工具复位为选择工具，整次拖入一步可撤销
    expect(h.state.activeTool.type).toBe("selection");
    expect(API.getUndoStack()).toHaveLength(1);
  });
});

describe("手机竖屏走底部面板分支", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    mockBoundingClientRect({ width: 390, height: 844 });
    await render(<Excalidraw handleKeyboardGlobally />);
    // 刷新编辑器形态并重新渲染：抽屉按 `useEditorInterface()` 选分支，
    // 只有重渲染才会把新的 formFactor 传进 context
    act(() => {
      h.app.refreshEditorInterface();
      h.app.refresh();
    });
  });

  afterEach(() => restoreOriginalGetBoundingClientRect());

  it("同入口弹出 BottomSheet（tb-sheet），而非左侧抽屉", () => {
    expect(h.app.editorInterface.formFactor).toBe("phone");
    expect(h.app.editorInterface.isLandscape).toBe(false);

    // 关闭时不挂载任何抽屉节点（手机分支按需挂载）
    expect(document.querySelector(".tb-sheet.shape-drawer-sheet")).toBeNull();
    expect(document.querySelector("aside.shape-drawer")).toBeNull();
    expect(drawerRoot()).toBeNull();

    openDrawer();

    // portal 容器 + 既有 BottomSheet 容器
    const root = drawerRoot()!;
    expect(root).not.toBeNull();
    expect(root.classList.contains("shape-drawer-sheet-root")).toBe(true);

    const sheet = document.querySelector<HTMLElement>(
      ".tb-sheet.shape-drawer-sheet",
    )!;
    expect(sheet).not.toBeNull();
    expect(sheet).toHaveAttribute("role", "dialog");
    expect(sheet).toHaveAttribute("aria-label", t("shapeDrawer.title"));
    expect(sheet.querySelector(".shape-drawer__title")?.textContent).toBe(
      t("shapeDrawer.title"),
    );

    // 面板最大高度取自与可见中心算式同源的常量（45%）
    expect(root.style.getPropertyValue("--shape-sheet-max-height")).toBe(
      `${SHAPE_SHEET_HEIGHT_RATIO * 100}%`,
    );

    // 桌面左侧抽屉分支没有出现；内容仍是同一份目录（六个分区）
    expect(document.querySelector("aside.shape-drawer")).toBeNull();
    expect(
      document.querySelectorAll('[data-testid^="shape-drawer-group-"]'),
    ).toHaveLength(6);
  });

  it("点遮罩不收起，点弹层内收起按钮才收起", () => {
    openDrawer();
    expect(h.state.openShapeDrawer).toBe(true);

    const overlay = document.querySelector<HTMLElement>(".tb-sheet__overlay")!;
    expect(overlay).not.toBeNull();

    fireEvent.pointerDown(overlay, {
      ...POINTER,
      button: 0,
      clientX: 195,
      clientY: 800,
    });

    // 非模态：手机竖屏点遮罩同样不收起（与桌面一致）
    expect(h.state.openShapeDrawer).toBe(true);
    expect(drawerRoot()).not.toBeNull();

    // 弹层内的收起按钮才收起
    fireEvent.click(screen.getByTestId("shape-drawer-close"));
    expect(h.state.openShapeDrawer).toBe(false);
    expect(drawerRoot()).toBeNull();
  });
});
