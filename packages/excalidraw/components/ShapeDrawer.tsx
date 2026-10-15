import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { KEYS } from "@excalidraw/common";

import { t } from "../i18n";

import {
  SHAPE_DRAWER_WIDTH_PX,
  SHAPE_SHEET_HEIGHT_RATIO,
  getVisibleCenterSceneCoords,
  placePreset,
} from "./app/presetPlacement";
import { getPresetDragSource } from "./app/presetDragSources";
import { useEditorInterface, useExcalidrawContainer } from "./App";
import { CloseIcon, chevronDownIcon } from "./icons";
import { SHAPE_CATALOG } from "./presetCatalog";
import { BottomSheet, BottomSheetOverlay } from "./toolbar/BottomSheet";

import "./ShapeDrawer.scss";

import type { CSSProperties } from "react";

import type App from "./App";
import type { AppClassProperties } from "../types";

/**
 * 图形抽屉（「更多功能」入口，设计稿见 docs/shape-drawer/design.md）。
 *
 * 纯浮层：不改变布局、不联动 `openSidebar`，只由 `appState.openShapeDrawer`
 * 控制显隐。两种形态渲染同一份目录数据与同一种取用语义：
 *
 * - 桌面/平板/手机横屏：画板左侧滑出（`.shape-drawer`，宽度吃
 *   `SHAPE_DRAWER_WIDTH_PX`，`:root[dir="rtl"]` 下从右侧滑入）；
 * - 手机竖屏：底部 `BottomSheet`（最大高度吃 `SHAPE_SHEET_HEIGHT_RATIO`）。
 *
 * 组件本身**常挂载**（分区折叠状态因此在会话内保留）：
 *
 * - 桌面/平板/手机横屏的左侧抽屉常挂载、仅以 `data-open` 控制显隐——关闭态
 *   `visibility: hidden` 同时退出 tab 顺序与无障碍树，并带滑入/滑出过渡；
 * - 手机竖屏的底部 `BottomSheet` 按需挂载（关闭时不渲染），避免一个隐藏的
 *   `.tb-sheet` 被既有手机端用例的全局查询误命中；折叠状态存在组件自身，
 *   不随该子树卸载丢失。
 */
export const ShapeDrawer = ({ app }: { app: AppClassProperties }) => {
  const { container } = useExcalidrawContainer();
  const editorInterface = useEditorInterface();
  const isPhonePortrait =
    editorInterface.formFactor === "phone" && !editorInterface.isLandscape;

  const open = app.state.openShapeDrawer;

  // 组件的 `app` 是结构化的 AppClassProperties，而放置链路（presetPlacement）
  // 按具名的 App 类签名；这里按仓库既有的做法（见 app/table.ts 的 `app as App`）
  // 收窄一次，供 placePreset / getVisibleCenterSceneCoords 使用
  const sceneApp = app as App;

  // 分区折叠：默认只展开「基础图形」；状态存在组件内，抽屉关闭再打开仍记住
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {
      basic: true,
    },
  );

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // 打开前聚焦的元素：关闭时还焦点给它（通常是「更多功能」按钮）
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 打开时记住原焦点并把焦点移进抽屉（收起按钮）；关闭时还回去
  useEffect(() => {
    if (!open) {
      return;
    }
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // 关闭态只是 visibility: hidden，节点一直在，可直接聚焦
    closeButtonRef.current?.focus();

    return () => {
      // 「更多功能」按钮随弹层关闭会被卸载，故按「原焦点 → 入口按钮 → 图形
      // 触发按钮」依次兜底，保证焦点不落回 body
      const previous = previousFocusRef.current;
      const target =
        (previous?.isConnected && previous) ||
        document.querySelector<HTMLElement>(
          '[data-testid="tool-popover-more"]',
        ) ||
        document.querySelector<HTMLElement>(
          '[data-testid="toolbar-rectangle"]',
        );
      target?.focus();
    };
  }, [open]);

  // Esc 关闭（仅抽屉打开时）：capture 阶段拦截，不冒泡到画布全局快捷键
  useEffect(() => {
    if (!open) {
      return;
    }
    const ownerDocument = container?.ownerDocument ?? document;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === KEYS.ESCAPE) {
        event.preventDefault();
        event.stopPropagation();
        app.setAppState({ openShapeDrawer: false });
      }
    };
    ownerDocument.addEventListener("keydown", onKeyDown, true);
    return () => ownerDocument.removeEventListener("keydown", onKeyDown, true);
  }, [open, container, app]);

  // 画布 pointerdown 关闭（复用既有 app.onPointerDownEmitter，同 ToolPopover）
  useEffect(() => {
    if (!open) {
      return;
    }
    const unsubscribe = app.onPointerDownEmitter.on(() => {
      app.setAppState({ openShapeDrawer: false });
    });
    return () => unsubscribe?.();
  }, [open, app]);

  const content = (
    <>
      <div className="shape-drawer__header">
        <span className="shape-drawer__title">{t("shapeDrawer.title")}</span>
        <button
          ref={closeButtonRef}
          type="button"
          className="shape-drawer__close"
          data-testid="shape-drawer-close"
          aria-label={t("buttons.close")}
          title={t("buttons.close")}
          onClick={() => app.setAppState({ openShapeDrawer: false })}
        >
          {CloseIcon}
        </button>
      </div>
      <div className="shape-drawer__content">
        {SHAPE_CATALOG.map((group) => {
          const expanded = expandedGroups[group.id] ?? false;
          const panelId = `shape-drawer-panel-${group.id}`;
          const groupLabel = t(group.titleKey);
          return (
            <section key={group.id} className="shape-drawer__group">
              <button
                type="button"
                className="shape-drawer__group-toggle"
                aria-expanded={expanded}
                aria-controls={panelId}
                data-testid={`shape-drawer-group-${group.id}`}
                onClick={() =>
                  setExpandedGroups((prev) => ({
                    ...prev,
                    [group.id]: !(prev[group.id] ?? false),
                  }))
                }
              >
                <span className="shape-drawer__group-title">{groupLabel}</span>
                <span
                  className={clsx("shape-drawer__chevron", {
                    "is-open": expanded,
                  })}
                  aria-hidden="true"
                >
                  {chevronDownIcon}
                </span>
              </button>
              <div
                id={panelId}
                className="shape-drawer__grid"
                role="group"
                aria-label={groupLabel}
                hidden={!expanded}
              >
                {group.items.map((item) => {
                  const label = t(item.titleKey);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="shape-drawer__item"
                      data-testid={`shape-drawer-item-${item.id}`}
                      aria-label={label}
                      title={label}
                      // 单击：落在扣除抽屉遮挡后的可见区域中心；不武装工具、
                      // 不改当前图形，放置后抽屉保持展开（便于连续取用）
                      onClick={() =>
                        placePreset(
                          sceneApp,
                          item.creation,
                          getVisibleCenterSceneCoords(sceneApp),
                        )
                      }
                      // 拖入：按下即武装可拖拽源，拖到画布松手落一份预设。
                      // 两种取用模式互斥——拖拽超过阈值后 pointerup 落在画布上，
                      // 不会触发格子的 click（与便签触发器 onTriggerPointerDown
                      // 同一机制）；原地松手不越过阈值，仍由上面的 onClick 放置。
                      onPointerDown={(event) =>
                        app.toolDrag.handlePresetPointerDown(
                          getPresetDragSource(item),
                          event.nativeEvent,
                        )
                      }
                    >
                      <span
                        className="shape-drawer__item-icon"
                        style={
                          item.iconRotation
                            ? {
                                transform: `rotate(${item.iconRotation}deg)`,
                              }
                            : undefined
                        }
                      >
                        {item.getIcon(app.state.theme)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );

  // 手机竖屏：同一份内容放进底部 BottomSheet（遮罩 + 贴底通栏）。这里**按需
  // 挂载**——关闭时不渲染，避免一个隐藏的 .tb-sheet 被全局 `.tb-sheet` 查询
  // （既有手机端用例）误命中；分区折叠状态存在 ShapeDrawer 自身、不随该子树
  // 卸载丢失，故「会话内保留」仍成立。面板最大高度取自与算式同源的常量。
  if (isPhonePortrait) {
    if (!open || !container) {
      return null;
    }
    return createPortal(
      <div
        className="shape-drawer-sheet-root"
        data-testid="shape-drawer"
        style={
          {
            "--shape-sheet-max-height": `${SHAPE_SHEET_HEIGHT_RATIO * 100}%`,
          } as CSSProperties
        }
      >
        <BottomSheetOverlay
          onPointerDown={() => app.setAppState({ openShapeDrawer: false })}
        />
        <div className="tb-sheet-anchor shape-drawer-sheet-anchor">
          <BottomSheet
            className="shape-drawer-sheet"
            label={t("shapeDrawer.title")}
          >
            {content}
          </BottomSheet>
        </div>
      </div>,
      container,
    );
  }

  // 桌面/平板/手机横屏：画板左侧抽屉（宽度取自与算式同源的常量）
  return (
    <aside
      className="shape-drawer"
      role="dialog"
      aria-label={t("shapeDrawer.title")}
      // 关闭态退出无障碍树（jsdom 不解析样式表，故不能只靠 visibility: hidden）
      aria-hidden={!open || undefined}
      data-open={open}
      data-testid="shape-drawer"
      style={
        {
          "--shape-drawer-width": `${SHAPE_DRAWER_WIDTH_PX}px`,
        } as CSSProperties
      }
    >
      {content}
    </aside>
  );
};
