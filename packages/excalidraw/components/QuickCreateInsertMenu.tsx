import { useEffect } from "react";

import { KEYS } from "@excalidraw/common";

import { t } from "../i18n";

import { useExcalidrawAppState } from "./App";
import { Popover } from "./Popover";
import { getCatalogGroup } from "./presetCatalog";

import "./QuickCreateInsertMenu.scss";

import type { QuickCreateMenuState } from "../types";

/**
 * 方向手柄拖到空白处松手后弹出的「插入图形」面板（见 App.quickCreate）：
 * 列出源图形所属分组的图形，点一个即建出该图形 + 连线。
 *
 * 面板本身只负责展示与派发两个回调——落地（建图形/连线）由
 * `app.quickCreate` 的 `commitPendingInsert` / `cancelPendingInsert` 承担，
 * 与之解耦；这里的 `menu` 只是给 React 树用的镜像状态（`appState.quickCreateMenu`）。
 */
export const QuickCreateInsertMenu = ({
  menu,
  onPick,
  onClose,
}: {
  menu: NonNullable<QuickCreateMenuState>;
  onPick: (itemId: string) => void;
  onClose: () => void;
}) => {
  // 缩略图随主题换色（与 ShapeDrawer 同源：便签/表格图标按 theme 求值）
  const { theme } = useExcalidrawAppState();

  // Esc 关闭：`Popover` 的 `onCloseRequest` 只挂 pointerdown（见 Popover.tsx），
  // Esc 需自己接。照 ShapeDrawer.tsx 的先例在 capture 阶段拦截，并
  // preventDefault/stopPropagation，避免冒泡到画布全局快捷键与指针会话的 Esc
  //（指针会话那层的 Esc 只处理拖拽中的手势，见 App.quickCreate.handlePointerKeyDown）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === KEYS.ESCAPE) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const group = getCatalogGroup(menu.groupId);

  return (
    <Popover
      top={menu.top}
      left={menu.left}
      fitInViewport
      onCloseRequest={() => onClose()}
      className="quick-create-menu"
    >
      <div
        className="quick-create-menu__panel"
        data-testid="quick-create-menu"
        role="dialog"
        aria-label={t("quickCreate.insertShape")}
      >
        <div className="quick-create-menu__title">
          {t("quickCreate.insertShape")}
        </div>
        <div className="quick-create-menu__grid" role="group">
          {group.items.map((item) => {
            const label = t(item.titleKey);
            return (
              <button
                key={item.id}
                type="button"
                className="quick-create-menu__item"
                data-testid={`quick-create-item-${item.id}`}
                title={label}
                aria-label={label}
                onClick={() => onPick(item.id)}
              >
                <span
                  className="quick-create-menu__item-icon"
                  style={
                    item.iconRotation
                      ? { transform: `rotate(${item.iconRotation}deg)` }
                      : undefined
                  }
                >
                  {item.getIcon(theme)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
};
