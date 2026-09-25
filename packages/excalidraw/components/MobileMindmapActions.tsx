import { useState } from "react";

import { t } from "../i18n";

import { DotsIcon, PlusIcon, TextIcon, TrashIcon } from "./icons";
import DropdownMenu from "./dropdownMenu/DropdownMenu";

import "./MobileMindmapActions.scss";

import type { AppClassProperties } from "../types";

export const MobileMindmapActions = ({ app }: { app: AppClassProperties }) => {
  const [open, setOpen] = useState(false);
  const node = app.mindmap.getSelectedNode();
  if (!node || !app.mindmap.canEditNode(node.id)) {
    return null;
  }
  const hasChildren = app.mindmap.hasChildren(node.id);
  const run = (result: ReturnType<typeof app.mindmap.getDeleteActionResult>) =>
    app.syncActionResult(result);

  return (
    <div
      className="mobile-mindmap-actions"
      role="toolbar"
      aria-label={t("toolBar.mindmap")}
    >
      <button
        type="button"
        title={t("labels.addMindmapChild")}
        aria-label={t("labels.addMindmapChild")}
        onClick={() => app.mindmap.createChild(node.id)}
      >
        {PlusIcon}
      </button>
      <button
        type="button"
        title={t("labels.editMindmapNode")}
        aria-label={t("labels.editMindmapNode")}
        onClick={app.mindmap.editSelectedNode}
      >
        {TextIcon}
      </button>
      {hasChildren && (
        <button
          type="button"
          title={t(
            node.collapsed ? "labels.expandMindmap" : "labels.collapseMindmap",
          )}
          aria-label={t(
            node.collapsed ? "labels.expandMindmap" : "labels.collapseMindmap",
          )}
          onClick={() =>
            app.mindmap.executeTreeCommand({ type: "toggleCollapse" }, node.id)
          }
        >
          <span aria-hidden="true">{node.collapsed ? "▸" : "▾"}</span>
        </button>
      )}
      <DropdownMenu open={open}>
        <DropdownMenu.Trigger
          title={t("toolBar.extraTools")}
          aria-label={t("toolBar.extraTools")}
          onToggle={() => setOpen(!open)}
        >
          {DotsIcon}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          onClickOutside={() => setOpen(false)}
          onSelect={() => setOpen(false)}
          align="start"
        >
          <DropdownMenu.Item
            icon={PlusIcon}
            onSelect={() => app.mindmap.createSibling(node.id)}
          >
            {t("labels.addMindmapSibling")}
          </DropdownMenu.Item>
          {node.role === "node" && (
            <DropdownMenu.Item onSelect={() => app.mindmap.promote(node.id)}>
              {t("labels.promoteMindmap")}
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item
            icon={TrashIcon}
            onSelect={() =>
              run(app.mindmap.getDeleteActionResult(false, node.id))
            }
          >
            {t("labels.deleteMindmapSubtree")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() =>
              run(app.mindmap.getDeleteActionResult(true, node.id))
            }
          >
            {t("labels.deleteMindmapPreservingChildren")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
    </div>
  );
};
