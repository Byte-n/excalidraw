import clsx from "clsx";
import React from "react";

import { getShortcutFromShortcutName } from "../actions/shortcuts";
import { t } from "../i18n";

import { useExcalidrawAppState, useExcalidrawElements } from "./App";

import { Popover } from "./Popover";

import "./ContextMenu.scss";

import type { ActionManager } from "../actions/manager";
import type { ShortcutName } from "../actions/shortcuts";
import type { Action } from "../actions/types";

import type { TranslationKeys } from "../i18n";

export type ContextMenuSubmenu = {
  type: "submenu";
  label: TranslationKeys;
  items: ContextMenuItems;
};

export type ContextMenuItem =
  | typeof CONTEXT_MENU_SEPARATOR
  | Action
  | ContextMenuSubmenu;

export type ContextMenuItems = (ContextMenuItem | false | null | undefined)[];

type ContextMenuProps = {
  actionManager: ActionManager;
  items: ContextMenuItems;
  top: number;
  left: number;
  onClose: (callback?: () => void) => void;
};

export const CONTEXT_MENU_SEPARATOR = "separator";

const isSubmenu = (item: ContextMenuItem): item is ContextMenuSubmenu =>
  typeof item === "object" && "type" in item && item.type === "submenu";

/**
 * 按 action predicate 过滤菜单项（子菜单递归；空子菜单整体移除）。
 * 右键菜单与浮动栏「更多」菜单（toolbar/ToolbarMoreMenu）共用。
 */
export const filterContextMenuItems = (
  items: ContextMenuItems,
  actionManager: ActionManager,
  elements: ReturnType<typeof useExcalidrawElements>,
  appState: ReturnType<typeof useExcalidrawAppState>,
): ContextMenuItem[] => {
  const filteredItems = items.reduce((acc: ContextMenuItem[], item) => {
    if (!item) {
      return acc;
    }
    if (item === CONTEXT_MENU_SEPARATOR) {
      acc.push(item);
      return acc;
    }
    if (isSubmenu(item)) {
      const submenuItems = filterContextMenuItems(
        item.items,
        actionManager,
        elements,
        appState,
      );
      if (
        submenuItems.some(
          (submenuItem) => submenuItem !== CONTEXT_MENU_SEPARATOR,
        )
      ) {
        acc.push({ ...item, items: submenuItems });
      }
      return acc;
    }
    if (
      !item.predicate ||
      item.predicate(
        elements,
        appState,
        actionManager.app.props,
        actionManager.app,
      )
    ) {
      acc.push(item);
    }
    return acc;
  }, []);

  return filteredItems.filter(
    (item, index) =>
      item !== CONTEXT_MENU_SEPARATOR ||
      (index > 0 && filteredItems[index - 1] !== CONTEXT_MENU_SEPARATOR),
  );
};

/**
 * 菜单项列表渲染（含子菜单），右键菜单与「更多」菜单共用同一渲染，
 * 视觉由 ContextMenu.scss 的 .context-menu* 类承担。
 */
export const ContextMenuItemsView = ({
  items,
  actionManager,
  onClose,
}: {
  items: ContextMenuItem[];
  actionManager: ActionManager;
  onClose: (callback?: () => void) => void;
}) => {
  const appState = useExcalidrawAppState();
  const elements = useExcalidrawElements();

  const renderItems = (menuItems: ContextMenuItem[]): React.ReactNode =>
    menuItems.map((item, idx) => {
      if (item === CONTEXT_MENU_SEPARATOR) {
        return <hr key={idx} className="context-menu-item-separator" />;
      }

      if (isSubmenu(item)) {
        return <Submenu key={idx} item={item} renderItems={renderItems} />;
      }

      const actionName = item.name;
      let label = "";
      if (item.label) {
        if (typeof item.label === "function") {
          label = t(
            item.label(
              elements,
              appState,
              actionManager.app,
            ) as unknown as TranslationKeys,
          );
        } else {
          label = t(item.label as unknown as TranslationKeys);
        }
      }

      return (
        <li
          key={idx}
          data-testid={actionName}
          role="menuitem"
          onClick={() => {
            // Clear the menu before executing an action that may read appState.
            onClose(() => {
              actionManager.executeAction(item, "contextMenu");
            });
          }}
        >
          <button
            type="button"
            className={clsx("context-menu-item", {
              dangerous: actionName === "deleteSelectedElements",
              checkmark: item.checked?.(appState, elements),
            })}
            aria-label={label}
          >
            <span className="context-menu-item__icon" aria-hidden="true">
              {typeof item.icon === "function"
                ? item.icon(appState, elements)
                : item.icon}
            </span>
            <div className="context-menu-item__label">{label}</div>
            <kbd className="context-menu-item__shortcut">
              {actionName
                ? getShortcutFromShortcutName(actionName as ShortcutName)
                : ""}
            </kbd>
          </button>
        </li>
      );
    });

  return <>{renderItems(items)}</>;
};

export const ContextMenu = React.memo(
  ({ actionManager, items, top, left, onClose }: ContextMenuProps) => {
    const appState = useExcalidrawAppState();
    const elements = useExcalidrawElements();

    const filteredItems = filterContextMenuItems(
      items,
      actionManager,
      elements,
      appState,
    );

    return (
      <Popover
        onCloseRequest={() => {
          onClose();
        }}
        top={top}
        left={left}
        fitInViewport={true}
        viewportWidth={appState.width}
        viewportHeight={appState.height}
        className="context-menu-popover"
      >
        <ul
          className="context-menu"
          onContextMenu={(event) => event.preventDefault()}
        >
          <ContextMenuItemsView
            items={filteredItems}
            actionManager={actionManager}
            onClose={onClose}
          />
        </ul>
      </Popover>
    );
  },
);

const Submenu = ({
  item,
  renderItems,
}: {
  item: ContextMenuSubmenu;
  renderItems: (items: ContextMenuItem[]) => React.ReactNode;
}) => {
  const [open, setOpen] = React.useState(false);
  const label = t(item.label);

  return (
    <li
      className="context-menu-submenu"
      role="none"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="context-menu-item context-menu-submenu__trigger"
        data-testid={`submenu-${item.label}`}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="context-menu-item__icon" aria-hidden="true" />
        <div className="context-menu-item__label">{label}</div>
        <span className="context-menu-submenu__chevron" aria-hidden="true">
          &gt;
        </span>
      </button>
      {open && (
        <ul className="context-menu context-menu-submenu__content" role="menu">
          {renderItems(item.items as ContextMenuItem[])}
        </ul>
      )}
    </li>
  );
};
