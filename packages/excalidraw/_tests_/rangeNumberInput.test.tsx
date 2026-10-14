import { Excalidraw } from "../index";

import { Pointer, UI } from "./helpers/ui";
import { fireEvent, render, screen } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

// 滑杆旁的数值输入框（设计稿 tb-range 的 tb-num）：
// Enter 提交、越界自动收敛、Esc 还原为编辑前的值
describe("Range number input", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  const drawRectangle = () => {
    UI.clickTool("rectangle");
    mouse.down(10, 10);
    mouse.up(20, 20);
  };

  // 透明度滑杆在浮动栏「样式」弹层内（T3 场景矩阵）
  const openStylesPopup = () => {
    (global as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        ".selected-shape-actions [aria-label='Styles']",
      )!,
    );
  };

  const getNumberInput = () =>
    screen.getByTestId("opacity-number") as HTMLInputElement;

  it("commits the typed value on Enter", () => {
    drawRectangle();
    openStylesPopup();

    const input = getNumberInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "55" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(h.elements[0].opacity).toBe(55);
    expect(input.value).toBe("55");
  });

  it("clamps out-of-range values on Enter", () => {
    drawRectangle();
    openStylesPopup();

    const input = getNumberInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "120" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(h.elements[0].opacity).toBe(100);
    expect(input.value).toBe("100");
  });

  it("restores the pre-edit value on Escape", () => {
    drawRectangle();
    openStylesPopup();

    const input = getNumberInput();
    expect(input.value).toBe("100");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "55" } });
    fireEvent.keyDown(input, { key: "Escape" });

    // Esc 还原编辑（不提交）；弹层按通用 Esc 行为一并关闭
    expect(h.elements[0].opacity).toBe(100);
    openStylesPopup();
    expect(getNumberInput().value).toBe("100");
  });

  it("keeps the slider onChange behavior intact", () => {
    drawRectangle();
    openStylesPopup();

    fireEvent.change(screen.getByTestId("opacity"), {
      target: { value: "60" },
    });

    expect(h.elements[0].opacity).toBe(60);
    expect(getNumberInput().value).toBe("60");
  });
});
