import { isStickyNoteElement } from "@excalidraw/element";

import { buildPresetElementsCentered } from "./presetPlacement";

import type { DraggableTool } from "../App.toolDrag";
import type { PresetCatalogItem } from "../presetCatalog";

/**
 * 把目录条目包成可拖拽源：图形抽屉的格子按下即武装它，拖到画布松手落一份预设
 * （见 `AppToolDrag`）。装配复用单击放置的
 * `buildPresetElementsCentered`——元素以指针为**包围盒中心**，与单击放置的
 * 「中心对中心」口径一致。
 *
 * `onDrop` 只补「按类型进编辑」这件落点之外的事：便签进文字编辑、脑图进根节点
 * 编辑（`AppMindmap.startRootEditing`，元素此刻已由通用插入进场景）；其余类型
 * 只选中——选中由通用落地统一负责。
 */
export const getPresetDragSource = (
  item: PresetCatalogItem,
): DraggableTool => ({
  id: item.id,
  createElements: (app, at, identity) =>
    buildPresetElementsCentered(app, item.creation, at, identity),
  onDrop: (app, result) => {
    if (item.creation.kind === "sticky") {
      const note = result.elements[0];
      if (isStickyNoteElement(note)) {
        app.startTextEditing({
          sceneX: note.x + note.width / 2,
          sceneY: note.y + note.height / 2,
          container: note,
        });
      }
      return;
    }
    if (item.creation.kind === "mindmap" && result.rootId) {
      app.mindmap.startRootEditing(result.rootId);
    }
  },
});
