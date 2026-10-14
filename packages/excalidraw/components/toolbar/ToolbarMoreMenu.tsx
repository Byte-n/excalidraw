import clsx from "clsx";
import { Popover } from "radix-ui";

import {
  actionDeleteSelected,
  actionDuplicateSelection,
  actionGroup,
  actionToggleElementLock,
  actionUngroup,
} from "../../actions";
import { t } from "../../i18n";
import {
  getCopyAsSubmenu,
  getEditSubmenu,
  getFlipSubmenuItems,
  getFrameSubmenuItems,
  getLinkSubmenu,
  getStyleSubmenu,
  getTableSubmenu,
  getTextSubmenu,
  buildContextMenuSubmenu,
} from "../app/contextMenu";
import {
  useExcalidrawActionManager,
  useExcalidrawAppState,
  useExcalidrawElements,
} from "../App";
import {
  CONTEXT_MENU_SEPARATOR,
  ContextMenuItemsView,
  filterContextMenuItems,
} from "../ContextMenu";
import { DotsHorizontalIcon } from "../icons";

import type { ContextMenuItems } from "../ContextMenu";

import type { AppClassProperties, AppState } from "../../types";

/**
 * 「更多」操作菜单（设计稿 §6）：固定项序——
 * 复制 / 链接› / 样式› / 复制为› | 成组 / 翻转› / 编辑› / 文字和容器› /
 * 画框› / 表格› / 锁定 | 删除（危险项置底）。
 * 子菜单与右键菜单同源（components/app/contextMenu.ts 的构建器），
 * 无对应能力时由 filterContextMenuItems 整体剔除（与右键菜单同一过滤逻辑）。
 * 视觉复用 ContextMenu.scss 的 .context-menu* 类。
 */
export const getToolbarMoreMenuItems = (app: AppClassProperties) => {
  const items: ContextMenuItems = [
    actionDuplicateSelection,
    getLinkSubmenu(),
    getStyleSubmenu(),
    getCopyAsSubmenu(),
    CONTEXT_MENU_SEPARATOR,
    actionGroup,
    actionUngroup,
    buildContextMenuSubmenu("labels.contextMenuFlip", getFlipSubmenuItems()),
    getEditSubmenu(),
    getTextSubmenu(),
    buildContextMenuSubmenu("labels.contextMenuFrame", getFrameSubmenuItems()),
    // 表格子菜单仅单元格选区场景出现（与右键菜单一致）
    ...(app.state.tableCellSelection ? [getTableSubmenu()] : []),
    actionToggleElementLock,
    CONTEXT_MENU_SEPARATOR,
    actionDeleteSelected,
  ];
  return items;
};

export const ToolbarMoreMenu = ({
  app,
  setAppState,
  container,
}: {
  app: AppClassProperties;
  setAppState: React.Component<any, AppState>["setState"];
  container: HTMLDivElement | null;
}) => {
  // 经 context（而非 props）取状态：与右键菜单同源同状态快照
  const appState = useExcalidrawAppState();
  const elements = useExcalidrawElements();
  const actionManager = useExcalidrawActionManager();
  const isOpen = appState.openPopup === "compactOtherProperties";
  const label = t("labels.moreActions");

  const items = getToolbarMoreMenuItems(app);
  const filteredItems = filterContextMenuItems(
    items,
    actionManager,
    elements,
    appState,
  );

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
            title={label}
            aria-label={label}
            data-testid="toolbar-more-menu"
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
          <Popover.Portal container={container}>
            <Popover.Content
              className="tb-more-menu-popover focus-visible-none"
              data-prevent-outside-click
              side="bottom"
              align="end"
              sideOffset={8}
              collisionBoundary={container ?? undefined}
              onOpenAutoFocus={(event) => {
                // 菜单不抢占焦点（与右键菜单一致；键盘导航由 hover/click 驱动）
                event.preventDefault();
              }}
              onCloseAutoFocus={(event) => {
                event.stopPropagation();
                event.preventDefault();
                if (container) {
                  container.focus();
                }
              }}
            >
              <ul
                className="context-menu tb-more-menu"
                role="menu"
                aria-label={label}
                onContextMenu={(event) => event.preventDefault()}
              >
                <ContextMenuItemsView
                  items={filteredItems}
                  actionManager={actionManager}
                  onClose={(callback) => {
                    // 先关菜单、待状态提交后再执行动作（与右键菜单 onClose
                    // 的 setState callback 时序一致，避免动作结果回写 openPopup）
                    setAppState({ openPopup: null }, callback);
                  }}
                />
              </ul>
            </Popover.Content>
          </Popover.Portal>
        )}
      </Popover.Root>
    </div>
  );
};
