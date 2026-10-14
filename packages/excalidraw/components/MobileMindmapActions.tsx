import clsx from "clsx";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { KEYS } from "@excalidraw/common";

import { t } from "../i18n";
import { getShortcutKey } from "../shortcut";
import { getShortcutFromShortcutName } from "../actions/shortcuts";

import { useExcalidrawContainer } from "./App";
import { DotsIcon, PlusIcon, TextIcon, TrashIcon, mindmapIcon } from "./icons";
import { BottomSheet, BottomSheetOverlay } from "./toolbar/BottomSheet";

import "./MobileMindmapActions.scss";

import type { AppClassProperties } from "../types";

/**
 * 手机端思维导图节点动作条（设计稿「手机端：思维导图节点」）：
 * 底部动作条 = 添加子节点（Tab）/ 编辑文本 / 折叠·展开分支（有子节点时）
 * + 「…」；「…」打开底部 sheet：添加同级节点（↵）/ 提升节点·拆分导图
 * （仅普通节点）/ 删除完整子树（⌫，危险置底区）/ 删除节点保留子节点。
 *
 * 选中节点时整体替换底部属性条（MobileShapeActions 同步让位）。
 */
export const MobileMindmapActions = ({ app }: { app: AppClassProperties }) => {
  const [open, setOpen] = useState(false);
  const { container } = useExcalidrawContainer();
  const node = app.mindmap.getSelectedNode();
  const editable = !!node && app.mindmap.canEditNode(node.id);

  // sheet 打开期间 Esc 关闭（capture 阶段拦截，不冒泡到画布的全局快捷键）
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === KEYS.ESCAPE) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    const ownerDocument = container?.ownerDocument ?? document;
    ownerDocument.addEventListener("keydown", onKeyDown, true);
    return () => ownerDocument.removeEventListener("keydown", onKeyDown, true);
  }, [open, container]);

  if (!node || !editable) {
    return null;
  }
  const hasChildren = app.mindmap.hasChildren(node.id);
  const run = (result: ReturnType<typeof app.mindmap.getDeleteActionResult>) =>
    app.syncActionResult(result);

  return (
    <div
      className="mobile-mindmap-actions tb-bar"
      role="toolbar"
      aria-label={t("toolBar.mindmap")}
    >
      <button
        type="button"
        className="tb-iconbtn"
        title={`${t("labels.addMindmapChild")} — Tab`}
        aria-label={t("labels.addMindmapChild")}
        onClick={() => app.mindmap.createChild(node.id)}
      >
        {PlusIcon}
      </button>
      <button
        type="button"
        className="tb-iconbtn"
        title={t("labels.editMindmapNode")}
        aria-label={t("labels.editMindmapNode")}
        onClick={app.mindmap.editSelectedNode}
      >
        {TextIcon}
      </button>
      {hasChildren && (
        <button
          type="button"
          className="tb-iconbtn"
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
      <button
        type="button"
        className={clsx("tb-iconbtn", { "is-on": open })}
        title={t("toolBar.extraTools")}
        aria-label={t("toolBar.extraTools")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {DotsIcon}
      </button>

      {open &&
        container &&
        createPortal(
          <>
            <BottomSheetOverlay onPointerDown={() => setOpen(false)} />
            {/* 非 radix 分支自带锚定容器（.tb-sheet-anchor，toolbar.scss）：
                贴容器底边通栏、层级压过遮罩；PropertiesPopover 分支的锚定
                由 .tb-sheet-portal 的 popper 覆盖承担，两者等效 */}
            <div className="tb-sheet-anchor">
              <BottomSheet label={t("toolBar.mindmap")}>
                <ul
                  className="context-menu"
                  role="menu"
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <li role="none">
                    <button
                      type="button"
                      className="context-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        app.mindmap.createSibling(node.id);
                      }}
                    >
                      <span className="context-menu-item__icon" aria-hidden>
                        {PlusIcon}
                      </span>
                      <div className="context-menu-item__label">
                        {t("labels.addMindmapSibling")}
                      </div>
                      <kbd className="context-menu-item__shortcut">
                        {getShortcutKey(
                          getShortcutFromShortcutName("mindmapCreateSibling"),
                        )}
                      </kbd>
                    </button>
                  </li>
                  {node.role === "node" && (
                    <li role="none">
                      <button
                        type="button"
                        className="context-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setOpen(false);
                          app.mindmap.promote(node.id);
                        }}
                      >
                        <span className="context-menu-item__icon" aria-hidden>
                          {mindmapIcon}
                        </span>
                        <div className="context-menu-item__label">
                          {t("labels.promoteMindmap")}
                        </div>
                        <kbd className="context-menu-item__shortcut">
                          {getShortcutKey(
                            getShortcutFromShortcutName("mindmapPromote"),
                          )}
                        </kbd>
                      </button>
                    </li>
                  )}
                  <hr className="context-menu-item-separator" />
                  <li role="none">
                    <button
                      type="button"
                      className="context-menu-item dangerous"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        run(app.mindmap.getDeleteActionResult(false, node.id));
                      }}
                    >
                      <span className="context-menu-item__icon" aria-hidden>
                        {TrashIcon}
                      </span>
                      <div className="context-menu-item__label">
                        {t("labels.deleteMindmapSubtree")}
                      </div>
                      <kbd className="context-menu-item__shortcut">
                        {getShortcutKey("Delete")}
                      </kbd>
                    </button>
                  </li>
                  <li role="none">
                    <button
                      type="button"
                      className="context-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        run(app.mindmap.getDeleteActionResult(true, node.id));
                      }}
                    >
                      <span className="context-menu-item__icon" aria-hidden>
                        {TrashIcon}
                      </span>
                      <div className="context-menu-item__label">
                        {t("labels.deleteMindmapPreservingChildren")}
                      </div>
                      <kbd className="context-menu-item__shortcut">
                        {getShortcutKey(
                          getShortcutFromShortcutName(
                            "mindmapDeletePreservingChildren",
                          ),
                        )}
                      </kbd>
                    </button>
                  </li>
                </ul>
              </BottomSheet>
            </div>
          </>,
          container,
        )}
    </div>
  );
};
