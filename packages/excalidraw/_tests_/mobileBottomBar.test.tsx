import React from "react";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import {
  act,
  fireEvent,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "./test-utils";

const { h } = window;

// radix 弹层需要 ResizeObserver（jsdom 没有，同 toolbarPopovers 的约定）
const stubResizeObserver = () => {
  (global as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
};

// 手机竖屏：强制 formFactor=phone；jsdom 容器 0×0 → isLandscape=false（竖屏）
const renderPhonePortrait = async () => {
  await render(<Excalidraw UIOptions={{ getFormFactor: () => "phone" }} />);
  act(() => h.app.refreshEditorInterface());
  expect(h.app.editorInterface.formFactor).toBe("phone");
  expect(h.app.editorInterface.isLandscape).toBe(false);
};

const queryBar = () =>
  document.querySelector<HTMLElement>(".mobile-shape-actions.tb-bar");

const selectSingle = (element: { id: string }) => {
  act(() => {
    API.setAppState({ selectedElementIds: { [element.id]: true } });
  });
};

describe("T5 手机端：底部条 + 底部 sheet", () => {
  describe("底部条（tb-bar）", () => {
    it("选中便签：外露纸色/文字色色板 + 图层/删除/更多图标按钮（38px 槽位）", async () => {
      await renderPhonePortrait();
      const note = API.createElement({ type: "stickynote" });
      API.setElements([note]);
      selectSingle(note);

      const bar = queryBar()!;
      expect(bar).not.toBeNull();
      expect(bar.querySelector("[aria-label='Font color']")).not.toBeNull();
      expect(bar.querySelector("[aria-label='Paper color']")).not.toBeNull();
      // 图层 / 更多
      expect(bar.querySelector("[aria-label='Layers']")).not.toBeNull();
      expect(bar.querySelector("[aria-label='Actions']")).not.toBeNull();
      // 撤销/重做常驻
      expect(bar.querySelector("[data-testid='button-undo']")).not.toBeNull();
      expect(bar.querySelector("[data-testid='button-redo']")).not.toBeNull();
      // jsdom 条宽 0：复制/删除按宽度让位进「更多」（既有测量方向）
      expect(bar.querySelector("[aria-label='Delete']")).toBeNull();
    });

    it("条宽足够时删除/复制依次外露（宽度测量让位方向保留）", async () => {
      mockBoundingClientRect({ width: 390, height: 844 });
      try {
        await renderPhonePortrait();
        const note = API.createElement({ type: "stickynote" });
        API.setElements([note]);
        selectSingle(note);

        const bar = queryBar()!;
        // 390px：删除外露、复制仍进「更多」
        expect(bar.querySelector("[aria-label='Delete']")).not.toBeNull();
        expect(bar.querySelector("[aria-label='Duplicate']")).toBeNull();
      } finally {
        restoreOriginalGetBoundingClientRect();
      }
    });

    it("单元格选区：底部条含撤销/重做（既有行为回归）", async () => {
      await renderPhonePortrait();
      const table = API.createElement({ type: "table" });
      API.setElements([table]);
      const [firstCell, secondCell] = table.table.cells;
      act(() => {
        API.setAppState({
          tableCellSelection: {
            tableId: table.id,
            anchorId: firstCell.id,
            focusId: secondCell.id,
            mobileMode: false,
          },
        });
      });

      const bar = queryBar()!;
      expect(bar).not.toBeNull();
      expect(bar.querySelector("[data-testid='button-undo']")).not.toBeNull();
      expect(bar.querySelector("[data-testid='button-redo']")).not.toBeNull();
      // 单元格命令（选区模式/合并）与单元格背景色板仍在
      expect(
        bar.querySelector("[data-testid='table-cell-multi-select']"),
      ).not.toBeNull();
    });
  });

  describe("底部 sheet", () => {
    it("点底部条分组 → 升起 sheet（抓手 + 遮罩 + role=dialog），点遮罩关闭", async () => {
      await renderPhonePortrait();
      const rect = API.createElement({ type: "rectangle" });
      API.setElements([rect]);
      selectSingle(rect);

      stubResizeObserver();
      fireEvent.click(
        queryBar()!.querySelector<HTMLButtonElement>("[aria-label='Layers']")!,
      );

      // sheet 容器：role=dialog + 抓手 + 遮罩；不再是右侧弹层（无 tb-pop/箭头）
      const sheet = document.querySelector(".tb-sheet")!;
      expect(sheet).not.toBeNull();
      expect(sheet.getAttribute("role")).toBe("dialog");
      expect(sheet.getAttribute("aria-label")).toBe("Layers");
      expect(sheet.querySelector(".tb-sheet__grab")).not.toBeNull();
      expect(document.querySelector(".tb-sheet__overlay")).not.toBeNull();
      // 锚定结构防回归：sheet 处于 .tb-sheet-portal 内（popper 定位覆盖为
      // 贴底通栏，见 toolbar.scss）；jsdom 不测布局，真机走查需确认贴底
      expect(sheet.closest(".tb-sheet-portal")).not.toBeNull();
      expect(document.querySelector(".Island.tb-pop")).toBeNull();
      expect(document.querySelector(".tb-pop-arrow")).toBeNull();
      expect(h.state.openPopup).toBe("compactLayers");

      // sheet 内容 = 桌面弹层同序分组（图层四动作）
      expect(sheet.textContent).toContain("Layers");

      // 点遮罩关闭（radix 的外部点击监听在弹层挂载后的 setTimeout(0) 才注册）
      await act(async () => {});
      fireEvent.pointerDown(document.querySelector(".tb-sheet__overlay")!);
      await waitFor(() => {
        expect(document.querySelector(".tb-sheet")).toBeNull();
      });
      expect(h.state.openPopup).toBeNull();
    });

    it("颜色分组开 sheet：色板在 sheet 内，点色板后 sheet 保持打开", async () => {
      await renderPhonePortrait();
      const rect = API.createElement({ type: "rectangle" });
      API.setElements([rect]);
      selectSingle(rect);

      stubResizeObserver();
      fireEvent.click(
        queryBar()!.querySelector<HTMLButtonElement>("[aria-label='Stroke']")!,
      );

      const sheet = document.querySelector(".tb-sheet")!;
      expect(sheet.getAttribute("aria-label")).toBe("Stroke");
      expect(sheet.querySelector(".color-picker-content")).not.toBeNull();

      // 点色板网格色块应用后 sheet 保持打开
      fireEvent.click(sheet.querySelector("[data-testid='color-red']")!);
      expect(h.elements[0].strokeColor).toBe("#d83a52");
      expect(document.querySelector(".tb-sheet")).not.toBeNull();
      expect(h.state.openPopup).toBe("elementStroke");
    });

    it("「更多」开 sheet：含对齐/操作分组；Esc 关闭", async () => {
      await renderPhonePortrait();
      const rectA = API.createElement({ type: "rectangle" });
      const rectB = API.createElement({ type: "rectangle", x: 200 });
      API.setElements([rectA, rectB]);
      act(() => {
        API.setAppState({
          selectedElementIds: { [rectA.id]: true, [rectB.id]: true },
        });
      });

      stubResizeObserver();
      fireEvent.click(
        queryBar()!.querySelector<HTMLButtonElement>("[aria-label='Actions']")!,
      );

      const sheet = document.querySelector(".tb-sheet")!;
      expect(sheet).not.toBeNull();
      // 图层已上条（不在「更多」重复）；对齐 + 操作分组在 sheet
      expect(sheet.textContent).toContain("Align");
      expect(sheet.textContent).toContain("Actions");
      expect(sheet.textContent).not.toContain("Layers");

      fireEvent.keyDown(sheet, { key: "Escape" });
      await waitFor(() => {
        expect(document.querySelector(".tb-sheet")).toBeNull();
      });
      expect(h.state.openPopup).toBeNull();
    });

    it("手机横屏不走 sheet（按平板处理保持弹层分支）", async () => {
      mockBoundingClientRect({ width: 844, height: 390 });
      try {
        await render(
          <Excalidraw UIOptions={{ getFormFactor: () => "phone" }} />,
        );
        act(() => h.app.refreshEditorInterface());
        expect(h.app.editorInterface.formFactor).toBe("phone");
        expect(h.app.editorInterface.isLandscape).toBe(true);

        const rect = API.createElement({ type: "rectangle" });
        API.setElements([rect]);
        selectSingle(rect);

        stubResizeObserver();
        fireEvent.click(
          queryBar()!.querySelector<HTMLButtonElement>(
            "[aria-label='Layers']",
          )!,
        );

        expect(document.querySelector(".tb-sheet")).toBeNull();
        expect(document.querySelector(".Island.tb-pop")).not.toBeNull();
      } finally {
        restoreOriginalGetBoundingClientRect();
      }
    });
  });
});
