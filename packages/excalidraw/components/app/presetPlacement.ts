import { getGridPoint } from "@excalidraw/common";

import {
  buildMindmapGraphFromTree,
  getCommonBounds,
  isStickyNoteElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawNonSelectionElement,
  ExcalidrawStickyNoteElement,
  NonDeleted,
} from "@excalidraw/element/types";

import {
  createTablePresetDrafts,
  getMindmapPresetTree,
  getPresetSize,
  newCreationDraft,
  PRESET_SIZES,
} from "./createPresets";

import type { CreationDraftOverrides, CreationIdentity } from "./createPresets";
import type { CreationSpec } from "../presetCatalog";
import type App from "../App";

/**
 * 图形抽屉两种取用方式（单击落在「可见区域中心」/ 拖到松手处）共用的装配与
 * 落地能力。这里只有「放下的是什么、放在哪、放完做什么」，不碰抽屉与工具栏，
 * 也不武装工具、不写 `appState`——放置链路因此独立于顶部的「当前图形」。
 */

/** 桌面/平板/手机横屏：左侧图形抽屉的宽度（CSS px）。CSS 与可见中心算式共用 */
export const SHAPE_DRAWER_WIDTH_PX = 240;

/** 手机竖屏：底部图形面板占容器高度的比例。CSS 与可见中心算式共用 */
export const SHAPE_SHEET_HEIGHT_RATIO = 0.45;

type ScenePoint = { x: number; y: number };

/** 手机竖屏：底部面板形态（与 `PropertiesPopover` 同一套判定） */
const isPhonePortrait = (app: App) =>
  app.editorInterface.formFactor === "phone" &&
  !app.editorInterface.isLandscape;

/**
 * 「可见区域中心」的场景坐标：视口中心再扣除抽屉/面板的遮挡——放置点是用户
 * **看得到的画布中心**，不是被面板挡住的几何中心。
 *
 * - 桌面/平板/手机横屏：左侧抽屉盖住左缘，中心右移半个抽屉宽度；
 * - 手机竖屏：底部面板盖住下缘，中心上移半个面板高度。
 *
 * 视口中心算式沿用仓库既有先例（见 `App.mindmap` 的 `importTextTree`）；
 * 抽屉宽度/面板高度取自本文件导出的常量，与后续步骤的 CSS 同源。
 */
export const getVisibleCenterSceneCoords = (app: App): ScenePoint => {
  const { width, height, zoom, scrollX, scrollY } = app.state;
  const scale = zoom.value;
  const centerX = width / (2 * scale) - scrollX;
  const centerY = height / (2 * scale) - scrollY;

  if (isPhonePortrait(app)) {
    const sheetHeight = (height * SHAPE_SHEET_HEIGHT_RATIO) / scale;
    return { x: centerX, y: centerY - sheetHeight / 2 };
  }

  const drawerWidth = SHAPE_DRAWER_WIDTH_PX / scale;
  return { x: centerX + drawerWidth / 2, y: centerY };
};

/** 装配结果：元素 + （仅脑图）根节点 id，落地后要进根节点编辑 */
export type PresetBuildResult = {
  elements: NonDeleted<ExcalidrawNonSelectionElement>[];
  rootId?: string;
};

/** 整体平移：只改 x/y（脑图连线是边局部坐标，同样只需平移） */
const translate = <TElement extends ExcalidrawElement>(
  elements: readonly TElement[],
  dx: number,
  dy: number,
): readonly TElement[] =>
  elements.map(
    (element) =>
      ({ ...element, x: element.x + dx, y: element.y + dy } as TElement),
  );

/**
 * 表格标签/脑图节点的身份派生：一个都不能漏，否则会推进共享的 id / 随机序列
 * （见 `CreationIdentity`）。缺省（真实落地）不给身份，交给构造函数。
 */
const deriveIdentity = (
  identity: CreationIdentity | undefined,
  index: number,
): CreationIdentity => ({
  id: identity?.id === undefined ? undefined : `${identity.id}:${index}`,
  seed: identity?.seed === undefined ? undefined : identity.seed + index,
});

/**
 * 按 `CreationSpec` 装配**未定位**的元素，以 `at` 为锚（单元素即左上角/表格
 * 左上角/脑图根节点左上角）。`identity` 供离屏预览传固定身份——预览不入场景，
 * 却会消耗共享的 id 与随机序列（见 `CreationIdentity`）。
 */
export const buildPresetElementsAt = (
  app: App,
  spec: CreationSpec,
  at: ScenePoint,
  identity?: CreationIdentity,
): PresetBuildResult => {
  const containerRef = app.getContainerRefForDropAt(at);

  switch (spec.kind) {
    case "shape": {
      // 抽屉放置不写 `preferredGenericShape`：以 overrides 一次性带上预设图形
      const draft = newCreationDraft(
        app,
        spec.tool,
        at,
        containerRef,
        identity,
        {
          preferredGenericShape:
            spec.shapeId as CreationDraftOverrides["preferredGenericShape"],
        },
      ) as NonDeleted<ExcalidrawNonSelectionElement>;
      // `spec.shapeId` 就是预设 id（含 `right-triangle`/`left-triangle`），
      // 尺寸走图形默认值表
      const size = getPresetSize(spec.tool, spec.shapeId, draft);
      return {
        elements: [
          {
            ...draft,
            x: at.x,
            y: at.y,
            width: size.width,
            height: size.height,
          },
        ],
      };
    }
    case "sticky": {
      const draft = newCreationDraft(
        app,
        "stickynote",
        at,
        containerRef,
        identity,
        {
          stickyBackgroundColor: spec.preset.backgroundColor,
          stickyStrokeColor: spec.preset.strokeColor,
        },
      ) as NonDeleted<ExcalidrawStickyNoteElement>;
      const size = PRESET_SIZES.stickynote ?? {
        width: draft.width,
        height: draft.height,
      };
      // baseHeight 一并落到预设高：与单击落地（pointerup）得到的便签一致
      return {
        elements: [
          {
            ...draft,
            x: at.x,
            y: at.y,
            width: size.width,
            height: size.height,
            baseHeight: size.height,
          },
        ],
      };
    }
    case "frame": {
      const draft = newCreationDraft(
        app,
        "frame",
        at,
        containerRef,
        identity,
      ) as NonDeleted<ExcalidrawNonSelectionElement>;
      const size = PRESET_SIZES.frame ?? {
        width: draft.width,
        height: draft.height,
      };
      return {
        elements: [
          {
            ...draft,
            x: at.x,
            y: at.y,
            width: size.width,
            height: size.height,
          },
        ],
      };
    }
    case "table": {
      return {
        elements: createTablePresetDrafts(
          app,
          spec.preset,
          at,
          containerRef,
          identity,
          (index) => deriveIdentity(identity, index),
        ),
      };
    }
    case "mindmap": {
      const { elements, rootId } = buildMindmapGraphFromTree(
        getMindmapPresetTree(),
        at,
        {},
        (index) => deriveIdentity(identity, index),
        spec.direction,
      );
      return {
        elements: elements as NonDeleted<ExcalidrawNonSelectionElement>[],
        rootId,
      };
    }
  }
};

/**
 * 在上一支基础上，用 `getCommonBounds` 把**包围盒中心**对到 `center`——单击
 * 放置点即元素的可见中心，而不是某一个元素的左上角（脑图整体平移即可）。
 */
export const buildPresetElementsCentered = (
  app: App,
  spec: CreationSpec,
  center: ScenePoint,
  identity?: CreationIdentity,
): PresetBuildResult => {
  const built = buildPresetElementsAt(app, spec, center, identity);
  const [minX, minY, maxX, maxY] = getCommonBounds(built.elements);
  const dx = center.x - (minX + maxX) / 2;
  const dy = center.y - (minY + maxY) / 2;
  return {
    elements: [...translate(built.elements, dx, dy)],
    rootId: built.rootId,
  };
};

/**
 * 落一次预设：装配（包围盒中心对齐到吸附后的落点）→ 插入 → 选中全部新元素 →
 * 一步可撤销 → 按类型进入编辑（便签直接编辑、脑图复用根节点编辑，其余只选中）。
 *
 * **绝不调用 `setActiveTool`、绝不写 `preferredGenericShape`**：起点是抽屉的
 * 单击/拖入，与顶部工具栏的当前工具、当前图形脱钩。
 */
export const placePreset = (
  app: App,
  spec: CreationSpec,
  center: ScenePoint,
): void => {
  // 与单击落地一致：包围盒中心吸附到网格（getGridPoint + 生效网格尺寸）
  const [gridX, gridY] = getGridPoint(
    center.x,
    center.y,
    app.getEffectiveGridSize(),
  );
  const at = { x: gridX, y: gridY };

  if (spec.kind === "mindmap") {
    if (app.state.viewModeEnabled) {
      app.mindmap.notifyUnsupportedOperation();
      return;
    }
    const { elements, rootId } = buildPresetElementsCentered(app, spec, at);
    if (rootId) {
      // 建整图 + 落地（一次可撤销）+ 根节点编辑，复用画布点一下建图那套语义
      app.mindmap.placePresetGraph(elements, rootId);
    }
    return;
  }

  const { elements } = buildPresetElementsCentered(app, spec, at);
  app.insertNewElements(elements);
  app.setState({
    selectedElementIds: Object.fromEntries(
      elements.map((element) => [element.id, true]),
    ) as Record<string, true>,
    selectedGroupIds: {},
    selectedLinearElement: null,
    hoveredElementIds: {},
    editingGroupId: null,
  });
  // 整次放置是一步可撤销（含表格泳道自带的多元素）
  app.store.scheduleCapture();

  if (spec.kind === "sticky") {
    const note = elements[0];
    if (isStickyNoteElement(note)) {
      app.startTextEditing({
        sceneX: note.x + note.width / 2,
        sceneY: note.y + note.height / 2,
        container: note,
      });
    }
  }
};
