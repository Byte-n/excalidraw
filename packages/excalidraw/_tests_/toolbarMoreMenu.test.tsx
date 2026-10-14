import React from "react";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, fireEvent, render } from "./test-utils";

const { h } = window;

// radix 弹层需要 ResizeObserver（jsdom 没有，同 test-utils 的 togglePopover）
const stubResizeObserver = () => {
  (global as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
};

const openMoreMenu = () => {
  stubResizeObserver();
  fireEvent.click(
    document.querySelector<HTMLButtonElement>(
      "[data-testid='toolbar-more-menu']",
    )!,
  );
};

const queryMenu = () => document.querySelector(".tb-more-menu");

// 顶层菜单项序（分隔符记作 "sep"，子菜单记其 labels 键——testid 在内部按钮上）
const topLevelOrder = () =>
  Array.from(queryMenu()!.children).map((node) => {
    if (node.classList.contains("context-menu-item-separator")) {
      return "sep";
    }
    return (
      node.getAttribute("data-testid") ??
      node.querySelector("[data-testid]")?.getAttribute("data-testid") ??
      null
    );
  });

describe("浮动栏「更多」菜单（T3）", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("单选图形：项序固定，删除置底且危险色", () => {
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    act(() => {
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });

    openMoreMenu();
    const menu = queryMenu();
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(menu?.getAttribute("aria-label")).toBe("More actions");

    // 设计稿固定项序：复制/链接›/样式›/复制为› | 成组区 | 翻转›/编辑›/文字和容器›/画框›/锁定 | 删除
    // 注：jsdom 无 clipboard 能力，复制为›整体被过滤（与右键菜单同逻辑）；
    // 单选无「成组」，非表格无「表格›」；矩形可作为文字容器故有「文字和容器›」
    expect(topLevelOrder()).toEqual([
      "duplicateSelection",
      "submenu-labels.contextMenuLink",
      "submenu-labels.contextMenuStyle",
      "sep",
      "submenu-labels.contextMenuFlip",
      "submenu-labels.contextMenuEdit",
      "submenu-labels.contextMenuText",
      "submenu-labels.contextMenuFrame",
      "toggleElementLock",
      "sep",
      "deleteSelectedElements",
    ]);

    // 删除置底且危险色
    const last = menu!.lastElementChild!;
    expect(last.getAttribute("data-testid")).toBe("deleteSelectedElements");
    expect(last.querySelector(".context-menu-item")).toHaveClass("dangerous");
  });

  it("多选：出现「成组」", () => {
    const rect1 = API.createElement({ type: "rectangle", x: 0 });
    const rect2 = API.createElement({ type: "rectangle", x: 200 });
    API.setElements([rect1, rect2]);
    act(() => {
      API.setAppState({
        selectedElementIds: { [rect1.id]: true, [rect2.id]: true },
      });
    });

    openMoreMenu();
    const order = topLevelOrder();
    expect(order).toContain("group");
    // 成组在「复制/链接/样式/复制为」之后、翻转之前
    expect(order.indexOf("group")).toBeGreaterThan(
      order.indexOf("submenu-labels.contextMenuCopyAs"),
    );
    expect(order.indexOf("group")).toBeLessThan(
      order.indexOf("submenu-labels.contextMenuFlip"),
    );
  });

  it("含文本能力时出现「文字和容器›」，子菜单与右键菜单同源", () => {
    const text = API.createElement({ type: "text", text: "hello" });
    API.setElements([text]);
    act(() => {
      API.setAppState({ selectedElementIds: { [text.id]: true } });
    });

    openMoreMenu();
    expect(topLevelOrder()).toContain("submenu-labels.contextMenuText");

    // 展开「文字和容器›」子菜单：内容按能力过滤（独立文本仅「文字包围成容器」），
    // 与右键菜单同名子菜单同一构建器
    fireEvent.click(
      queryMenu()!.querySelector<HTMLButtonElement>(
        "[data-testid='submenu-labels.contextMenuText']",
      )!,
    );
    const submenu = queryMenu()!.querySelector(
      ".context-menu-submenu__content",
    );
    expect(submenu).not.toBeNull();
    expect(
      Array.from(submenu!.querySelectorAll("li[data-testid]")).map((li) =>
        li.getAttribute("data-testid"),
      ),
    ).toEqual(["wrapTextInContainer"]);
  });

  it("「样式›」子菜单 = 拷贝样式/粘贴样式（与右键菜单同源）", () => {
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    act(() => {
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });

    openMoreMenu();
    fireEvent.click(
      queryMenu()!.querySelector<HTMLButtonElement>(
        "[data-testid='submenu-labels.contextMenuStyle']",
      )!,
    );
    const submenu = queryMenu()!.querySelector(
      ".context-menu-submenu__content",
    );
    expect(
      Array.from(submenu!.querySelectorAll("li[data-testid]")).map((li) =>
        li.getAttribute("data-testid"),
      ),
    ).toEqual(["copyStyles", "pasteStyles"]);
  });

  it("点击菜单项执行动作并关闭菜单（复制）", () => {
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    act(() => {
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });

    openMoreMenu();
    fireEvent.click(
      queryMenu()!.querySelector<HTMLElement>(
        "li[data-testid='duplicateSelection']",
      )!,
    );
    expect(h.elements).toHaveLength(2);
    expect(h.state.openPopup).toBeNull();
  });
});
