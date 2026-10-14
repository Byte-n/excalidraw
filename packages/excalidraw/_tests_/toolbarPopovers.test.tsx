import React from "react";

import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawLinearElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { act, fireEvent, render, waitFor } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

// radix 弹层需要 ResizeObserver（jsdom 没有，同 floatbarSceneMatrix 的约定）
const stubResizeObserver = () => {
  (global as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
};

const queryFloatbar = () => document.querySelector(".tb-floatbar");

const clickFloatbarTrigger = (label: string) => {
  stubResizeObserver();
  fireEvent.click(
    queryFloatbar()!.querySelector<HTMLButtonElement>(
      `[aria-label='${label}']`,
    )!,
  );
};

const selectSingle = (element: { id: string }) => {
  act(() => {
    API.setAppState({ selectedElementIds: { [element.id]: true } });
  });
};

describe("T4 弹层与二级界面统一", () => {
  describe("弹层容器", () => {
    it("「样式」弹层自触发器向下弹出（data-side=bottom）、带箭头、tb-pop 容器", async () => {
      await render(<Excalidraw />);
      const rect = API.createElement({ type: "rectangle" });
      API.setElements([rect]);
      selectSingle(rect);

      clickFloatbarTrigger("Styles");

      const popup = document.querySelector(".properties-content")!;
      expect(popup).not.toBeNull();
      expect(popup.getAttribute("data-side")).toBe("bottom");
      // 箭头（10px 旋转方块）+ tb-pop 容器（圆角 10 / 内边距 8 / 统一阴影）
      expect(popup.querySelector("svg.tb-pop-arrow")).not.toBeNull();
      expect(popup.querySelector(".Island.tb-pop")).not.toBeNull();
    });

    it("弹层互斥：颜色弹层打开时再点「样式」→ 颜色关闭、样式打开", async () => {
      await render(<Excalidraw />);
      const rect = API.createElement({ type: "rectangle" });
      API.setElements([rect]);
      selectSingle(rect);

      clickFloatbarTrigger("Stroke");
      expect(document.querySelector(".color-picker-content")).not.toBeNull();

      clickFloatbarTrigger("Styles");
      expect(document.querySelector(".color-picker-content")).toBeNull();
      expect(document.querySelector(".properties-content")).not.toBeNull();
      expect(h.state.openPopup).toBe("compactStrokeStyles");
    });

    it("Esc 关闭弹层且焦点回到触发按钮；点击弹层外部关闭", async () => {
      await render(<Excalidraw />);
      const rect = API.createElement({ type: "rectangle" });
      API.setElements([rect]);
      selectSingle(rect);

      clickFloatbarTrigger("Styles");
      const stylesTrigger = queryFloatbar()!.querySelector<HTMLButtonElement>(
        "[aria-label='Styles']",
      )!;
      const popup = document.querySelector(".properties-content")!;
      fireEvent.keyDown(popup, { key: "Escape" });

      expect(document.querySelector(".properties-content")).toBeNull();
      expect(h.state.openPopup).toBeNull();
      // radix FocusScope 的卸载焦点恢复在下一个 tick 生效
      await waitFor(() => {
        expect(document.activeElement).toBe(stylesTrigger);
      });

      // 重新打开，点击外部（画布）关闭
      clickFloatbarTrigger("Styles");
      expect(document.querySelector(".properties-content")).not.toBeNull();
      // radix 的外部点击监听在弹层挂载后的 setTimeout(0) 才注册
      await act(async () => {});
      fireEvent.pointerDown(
        document.querySelector(".excalidraw")!.querySelector("canvas")!,
      );
      await waitFor(() => {
        expect(document.querySelector(".properties-content")).toBeNull();
      });
    });
  });

  describe("颜色弹层", () => {
    it("全色板网格 15 色（族色块取当前明度档）；结构 = 色板 → 明度 → 自定义 → 色值；点色板后弹层保持打开", async () => {
      await render(<Excalidraw />);
      // 自定义色（不在调色板内）→ 弹层出现「自定义」区
      const rect = API.createElement({
        type: "rectangle",
        strokeColor: "#123456",
      });
      API.setElements([rect]);
      selectSingle(rect);

      clickFloatbarTrigger("Stroke");

      const popup = document.querySelector(".color-picker-content")!;

      // 色板网格：15 枚，调色板条目按序（透明/白/灰/黑/古铜 + 十族）；
      // 当前色为自定义色，族色块取描边默认明度档（index 4）
      const gridSwatches = Array.from(
        popup.querySelectorAll<HTMLButtonElement>("[data-testid^='color-']"),
      );
      expect(gridSwatches.map((s) => s.dataset.testid)).toEqual([
        "color-transparent",
        "color-white",
        "color-gray",
        "color-black",
        "color-bronze",
        "color-cyan",
        "color-blue",
        "color-violet",
        "color-grape",
        "color-pink",
        "color-green",
        "color-teal",
        "color-yellow",
        "color-orange",
        "color-red",
      ]);
      expect(
        gridSwatches.map((swatch) =>
          swatch.style.getPropertyValue("--swatch-color"),
        ),
      ).toEqual([
        "transparent",
        "#ffffff",
        "#1f2329",
        "#1e1e1e",
        "#846358",
        "#0c8599",
        "#2f6fb0",
        "#7146d6",
        "#9c36b5",
        "#c2255c",
        "#2f9e44",
        "#0e8c7e",
        "#b86e00",
        "#e8590c",
        "#d83a52",
      ]);

      // 结构顺序：色板 → 明度 → 自定义 → 色值
      const headings = Array.from(
        popup.querySelectorAll(".color-picker__heading"),
      ).map((node) => node.textContent);
      expect(headings).toEqual([
        "Colors",
        "Shades",
        "Most used custom colors",
        "Hex code",
      ]);

      // 弹层宽度对齐设计稿 236px
      expect(
        document
          .querySelector<HTMLElement>(".color-picker-content")
          ?.closest<HTMLElement>(".Island.tb-pop")
          ?.style.getPropertyValue("width"),
      ).toBe("14.75rem");

      // 点击色板应用后弹层保持打开
      fireEvent.click(popup.querySelector("[data-testid='color-red']")!);
      expect(h.elements[0].strokeColor).toBe("#d83a52");
      expect(document.querySelector(".color-picker-content")).not.toBeNull();
      expect(h.state.openPopup).toBe("elementStroke");
    });

    it("便签纸色弹层：六色纸预设 + 明度（无自定义、无色值输入/取色）", async () => {
      await render(<Excalidraw />);
      const note = API.createElement({ type: "stickynote" });
      API.setElements([note]);
      selectSingle(note);

      clickFloatbarTrigger("Paper color");

      const popup = document.querySelector(".color-picker-content")!;
      // 六色纸预设（STICKY_NOTE_BACKGROUND_PICKS）
      const presetSwatches = popup.querySelectorAll(
        ".color-picker-content--presets .color-picker__button",
      );
      expect(presetSwatches.length).toBe(6);
      const headings = Array.from(
        popup.querySelectorAll(".color-picker__heading"),
      ).map((node) => node.textContent);
      expect(headings).toEqual(["Shades"]);
      expect(popup.querySelector(".color-picker-input")).toBeNull();
      expect(popup.querySelector(".excalidraw-eye-dropper-trigger")).toBeNull();
    });
  });

  describe("箭头端点库", () => {
    const openArrowProperties = () => {
      const arrow = API.createElement({
        type: "arrow",
        points: [pointFrom(0, 0), pointFrom(100, 100)],
        // 测试基建默认两端为 null，显式给终点一个端点以校验触发器回显
        endArrowhead: "arrow",
      });
      API.setElements([arrow]);
      selectSingle(arrow);
      clickFloatbarTrigger("Arrow type");
      return arrow;
    };

    it("双触发器显示当前端点；常用 10 枚；关系型 6 枚默认折叠", async () => {
      await render(<Excalidraw />);
      const arrow = openArrowProperties();

      const popup = document.querySelector(".properties-content")!;
      const triggers = Array.from(popup.querySelectorAll(".tb-headtrig"));
      expect(triggers.length).toBe(2);
      expect(triggers[0].textContent).toBe("Start · None");
      expect(triggers[1].textContent).toBe("End · Arrow");
      expect(triggers[0].classList.contains("is-on")).toBe(true);

      // 常用 10 枚；关系型默认折叠（仅一个网格）
      const grids = popup.querySelectorAll(".headgrid");
      expect(grids.length).toBe(1);
      expect(grids[0].querySelectorAll("button").length).toBe(10);
      expect(popup.textContent).toContain("Relational (for connectors)");

      // 默认编辑起点：选「菱形」→ startArrowhead 变更、endArrowhead 不变
      fireEvent.click(
        popup.querySelector<HTMLButtonElement>("[aria-label='Diamond']")!,
      );
      let arrowEl = h.elements[0] as ExcalidrawLinearElement;
      expect(arrowEl.startArrowhead).toBe("diamond");
      expect(arrowEl.endArrowhead).toBe("arrow");

      // 切换到终点后网格作用于终点
      fireEvent.click(triggers[1] as HTMLElement);
      fireEvent.click(
        popup.querySelector<HTMLButtonElement>("[aria-label='Cross']")!,
      );
      arrowEl = h.elements[0] as ExcalidrawLinearElement;
      expect(arrowEl.endArrowhead).toBe("x_arrow");
      expect(arrowEl.startArrowhead).toBe("diamond");
      expect(arrowEl.id).toBe(arrow.id);
    });

    it("折叠态记忆：展开后重开弹层仍展开（localStorage）", async () => {
      await render(<Excalidraw />);
      window.localStorage.removeItem("excalidraw-arrowheads-relational-open");
      openArrowProperties();

      let popup = document.querySelector(".properties-content")!;
      expect(popup.querySelectorAll(".headgrid").length).toBe(1);

      // 展开关系型折叠区
      fireEvent.click(
        Array.from(popup.querySelectorAll(".picker-collapsible")).find((node) =>
          node.textContent?.includes("Relational"),
        ) as HTMLElement,
      );
      expect(popup.querySelectorAll(".headgrid").length).toBe(2);
      expect(
        popup.querySelectorAll(".headgrid")[1].querySelectorAll("button")
          .length,
      ).toBe(6);
      expect(
        window.localStorage.getItem("excalidraw-arrowheads-relational-open"),
      ).toBe("true");

      // 关闭再开（等价于刷新后的重挂载读取）：保持展开
      fireEvent.keyDown(popup, { key: "Escape" });
      expect(document.querySelector(".properties-content")).toBeNull();
      clickFloatbarTrigger("Arrow type");
      popup = document.querySelector(".properties-content")!;
      expect(popup.querySelectorAll(".headgrid").length).toBe(2);

      window.localStorage.removeItem("excalidraw-arrowheads-relational-open");
    });
  });

  describe("链接弹层", () => {
    it("单选带链接元素自动出现访问态；编辑态含 URL 输入与「链接到元素」", async () => {
      await render(<Excalidraw />);
      const rect = API.createElement({ type: "rectangle" });
      API.setElements([rect]);
      API.updateElement(rect, { link: "https://example.com/spec" });
      // 与 pointerSession 选中即置 info 的行为一致（此处直接置状态模拟）
      act(() => {
        API.setAppState({
          selectedElementIds: { [rect.id]: true },
          showHyperlinkPopup: "info",
        });
      });

      // 访问态：链接图标 + 域名文本 + 编辑/访问
      const popup = document.querySelector(
        ".properties-content .Island.tb-pop",
      )!;
      expect(popup).not.toBeNull();
      expect(popup.textContent).toContain("example.com/spec");
      expect(
        popup.querySelector<HTMLAnchorElement>(".excalidraw-hyperlink__visit")!
          .href,
      ).toBe("https://example.com/spec");

      // 编辑态：URL 输入 + 链接到元素… + 移除/保存
      fireEvent.click(popup.querySelector("[aria-label='Edit']")!);
      expect(h.state.showHyperlinkPopup).toBe("editor");
      const input = document.querySelector<HTMLInputElement>(
        ".excalidraw-hyperlink__input",
      )!;
      expect(input).not.toBeNull();
      const linkToObject = document.querySelector<HTMLButtonElement>(
        ".excalidraw-hyperlink__linkto",
      )!;
      expect(linkToObject.textContent).toContain("Link to object");

      // 编辑 URL 后保存 → 回访问态
      fireEvent.change(input, { target: { value: "https://excalidraw.com" } });
      fireEvent.click(
        document.querySelector<HTMLButtonElement>(
          ".Island.tb-pop .tb-btn-primary",
        )!,
      );
      expect(h.elements[0].link).toBe("https://excalidraw.com");
      expect(h.state.showHyperlinkPopup).toBe("info");
      expect(document.querySelector(".Island.tb-pop")!.textContent).toContain(
        "excalidraw.com",
      );
    });

    it("「链接到元素…」打开 elementLinkSelector 期间浮动栏隐藏，关闭后恢复", async () => {
      await render(<Excalidraw />);
      const rect = API.createElement({ type: "rectangle" });
      API.setElements([rect]);
      act(() => {
        API.setAppState({
          selectedElementIds: { [rect.id]: true },
          showHyperlinkPopup: "editor",
        });
      });
      expect(queryFloatbar()).not.toBeNull();

      fireEvent.click(
        document.querySelector<HTMLButtonElement>(
          ".excalidraw-hyperlink__linkto",
        )!,
      );
      expect(h.state.openDialog?.name).toBe("elementLinkSelector");
      expect(queryFloatbar()).toBeNull();

      // 关闭对话框（既有行为：对话框开启/关闭时清空选区，故此处重新选中
      // 验证浮动栏的强制隐藏已解除、可随选区恢复）
      act(() => {
        API.setAppState({ openDialog: null });
      });
      selectSingle(rect);
      expect(queryFloatbar()).not.toBeNull();
    });

    it("桌面编辑态：选中带链接元素不自动弹出（按钮高亮），悬停也不再重弹", async () => {
      await render(<Excalidraw />);
      const rect = API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });
      API.setElements([rect]);
      API.updateElement(rect, { link: "https://example.com/spec" });

      // 画布点选带链接元素：仅按钮高亮，弹层不自动出现
      mouse.clickAt(50, 50);
      expect(API.getSelectedElement().id).toBe(rect.id);
      expect(h.state.showHyperlinkPopup).toBe(false);
      expect(document.querySelector(".properties-content")).toBeNull();
      const linkButton = queryFloatbar()!.querySelector<HTMLButtonElement>(
        "[data-testid='floatbar-link']",
      )!;
      expect(linkButton.classList.contains("active")).toBe(true);

      // 悬停已选中元素：弹层保持关闭（点击「链接」按钮才弹出）
      mouse.moveTo(60, 60);
      expect(h.state.showHyperlinkPopup).toBe(false);
      expect(document.querySelector(".properties-content")).toBeNull();
    });

    it("点击「链接」按钮：有链接开访问态，无链接开编辑态，再点关闭", async () => {
      await render(<Excalidraw />);
      const linked = API.createElement({ type: "rectangle" });
      API.setElements([linked]);
      API.updateElement(linked, { link: "https://example.com/spec" });
      selectSingle(linked);

      // 有链接 → 访问态（域名文本 + 访问）
      clickFloatbarTrigger("Edit link");
      expect(h.state.showHyperlinkPopup).toBe("info");
      let popup = document.querySelector(".properties-content")!;
      expect(popup.textContent).toContain("example.com/spec");
      expect(
        popup.querySelector<HTMLAnchorElement>(".excalidraw-hyperlink__visit")!
          .href,
      ).toBe("https://example.com/spec");

      // 再点按钮关闭
      clickFloatbarTrigger("Edit link");
      expect(h.state.showHyperlinkPopup).toBe(false);
      expect(document.querySelector(".properties-content")).toBeNull();

      // 无链接元素 → 编辑态（URL 输入）
      const plain = API.createElement({ type: "rectangle", x: 300, y: 300 });
      API.setElements([linked, plain]);
      selectSingle(plain);
      clickFloatbarTrigger("Add link");
      expect(h.state.showHyperlinkPopup).toBe("editor");
      popup = document.querySelector(".properties-content")!;
      expect(
        popup.querySelector(".excalidraw-hyperlink__input"),
      ).not.toBeNull();
    });
  });

  describe("字体弹层", () => {
    it("当前字体行尾对勾；悬停项实时预览（currentHoveredFontFamily）", async () => {
      await render(<Excalidraw />);
      const text = API.createElement({ type: "text", text: "hello" });
      API.setElements([text]);
      selectSingle(text);

      stubResizeObserver();
      fireEvent.click(
        queryFloatbar()!.querySelector<HTMLButtonElement>(
          "[data-testid='font-family-show-fonts']",
        )!,
      );

      const popup = document.querySelector(".properties-content")!;
      expect(popup).not.toBeNull();

      // 当前字体行尾对勾
      const selectedRow = popup.querySelector<HTMLButtonElement>(
        ".dropdown-menu-item--selected",
      )!;
      expect(selectedRow.querySelector(".font-picker__check")).not.toBeNull();

      // 悬停其他字体行 → 画布文本实时预览
      const otherRow = Array.from(
        popup.querySelectorAll<HTMLButtonElement>(".dropdown-menu-item"),
      ).find((row) => row !== selectedRow)!;
      fireEvent.mouseMove(otherRow);
      await waitFor(() => {
        expect(h.state.currentHoveredFontFamily).toBe(Number(otherRow.value));
      });
    });
  });
});
