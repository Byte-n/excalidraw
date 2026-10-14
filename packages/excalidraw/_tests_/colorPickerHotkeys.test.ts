import { COLOR_PALETTE } from "@excalidraw/common";

import type { ColorPaletteCustom } from "@excalidraw/common";

import { colorPickerKeyNavHandler } from "../components/ColorPicker/keyboardNavHandlers";

const handlerArgs = (
  key: string,
  palette: ColorPaletteCustom,
  presetColors: readonly string[],
  onChange: (color: string) => void,
  {
    color = null,
    excludedColors,
    picksOnly,
  }: {
    color?: string | null;
    excludedColors?: readonly string[];
    picksOnly?: boolean;
  } = {},
) => ({
  event: {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as React.KeyboardEvent,
  activeColorPickerSection: null,
  palette,
  color,
  onChange,
  customColors: [],
  presetColors,
  setActiveColorPickerSection: () => {},
  updateData: () => {},
  activeShade: 1,
  onEyeDropperToggle: () => {},
  onEscape: () => {},
  picksOnly,
  excludedColors,
});

describe("color picker hotkeys", () => {
  it("maps letter hotkeys to the palette grid by position (family swatch at the active shade)", () => {
    // 全色板网格（5×3）：q/w/e/r/t/a… 按调色板条目序绑定；族色块取当前明度档
    const onChange = vi.fn();
    const palette = {
      transparent: COLOR_PALETTE.transparent,
      red: ["#r0", "#r1", "#r2", "#r3", "#r4"],
    } as unknown as ColorPaletteCustom;

    expect(
      colorPickerKeyNavHandler(handlerArgs("q", palette, [], onChange)),
    ).toBe(true);
    expect(onChange).toHaveBeenCalledWith("transparent");

    onChange.mockClear();
    expect(
      colorPickerKeyNavHandler(handlerArgs("w", palette, [], onChange)),
    ).toBe(true);
    expect(onChange).toHaveBeenCalledWith("#r1");
  });

  it("reports an excluded (hidden) entry's hotkey as handled without selecting it", () => {
    // regression: returning "unhandled" let the key escape the modal and hit
    // global shortcuts (`q` toggles the tool lock; see the integration
    // regression in bucketFill.test.tsx)
    const onChange = vi.fn();
    const palette = {
      transparent: COLOR_PALETTE.transparent,
      red: "#ff0000",
    } as ColorPaletteCustom;

    const handled = colorPickerKeyNavHandler(
      handlerArgs("q", palette, [], onChange, {
        excludedColors: [COLOR_PALETTE.transparent],
      }),
    );

    expect(handled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports a hotkey past the end of a short custom palette as handled", () => {
    // a host-provided palette with fewer entries than hotkey bindings must
    // not leak the unbound keys either
    const onChange = vi.fn();
    const palette = { red: "#ff0000" } as ColorPaletteCustom;

    // `b` is the 15th binding — far past the single palette entry
    const handled = colorPickerKeyNavHandler(
      handlerArgs("b", palette, [], onChange),
    );

    expect(handled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still selects a present, non-excluded entry", () => {
    const onChange = vi.fn();
    const palette = {
      transparent: COLOR_PALETTE.transparent,
      red: "#ff0000",
    } as ColorPaletteCustom;

    const handled = colorPickerKeyNavHandler(
      handlerArgs("w", palette, [], onChange, {
        excludedColors: [COLOR_PALETTE.transparent],
      }),
    );

    expect(handled).toBe(true);
    expect(onChange).toHaveBeenCalledWith("#ff0000");
  });

  it("steps over an excluded entry when navigating vertically", () => {
    // three rows of five; `transparent` sits in column 0 of row 1 and is
    // excluded, so vertical moves through that cell must skip it in the
    // arrow's direction (wrapping) instead of landing on the hidden swatch
    const palette = {
      transparent: COLOR_PALETTE.transparent,
      white: "#w0",
      gray: "#g0",
      black: "#k0",
      bronze: "#b0",
      red: "#r1",
      green: "#g1",
      blue: "#b1",
      yellow: "#y1",
      orange: "#o1",
      pink: "#r2",
      grape: "#g2",
      violet: "#b2",
      cyan: "#y2",
      teal: "#o2",
    } as unknown as ColorPaletteCustom;
    const excluded = [COLOR_PALETTE.transparent];

    // up from row 2 / column 0 wraps past the excluded cell to row 3
    let onChange = vi.fn();
    expect(
      colorPickerKeyNavHandler({
        ...handlerArgs("ArrowUp", palette, [], onChange, {
          excludedColors: excluded,
          color: "#r1",
        }),
        activeColorPickerSection: "baseColors",
      }),
    ).toBe(true);
    expect(onChange).toHaveBeenCalledWith("#r2");

    // down from row 3 / column 0 wraps past the excluded cell to row 2
    onChange = vi.fn();
    expect(
      colorPickerKeyNavHandler({
        ...handlerArgs("ArrowDown", palette, [], onChange, {
          excludedColors: excluded,
          color: "#r2",
        }),
        activeColorPickerSection: "baseColors",
      }),
    ).toBe(true);
    expect(onChange).toHaveBeenCalledWith("#r1");
  });

  it("keeps shade navigation palette-driven", () => {
    // 明度区仍由 palette 色相族驱动（与色板区正交）
    const palette = {
      red: ["#r0", "#r1", "#r2", "#r3", "#r4"],
    } as unknown as ColorPaletteCustom;
    const onChange = vi.fn();

    expect(
      colorPickerKeyNavHandler({
        ...handlerArgs("ArrowRight", palette, ["#p0"], onChange, {
          color: "#r1",
        }),
        activeColorPickerSection: "shades",
      }),
    ).toBe(true);
    expect(onChange).toHaveBeenCalledWith("#r2");
  });

  describe("picksOnly (sticky note paper) variant", () => {
    it("maps letter hotkeys to the preset row by position", () => {
      // 便签纸色不在调色板内：字母键按预设行按位绑定
      const onChange = vi.fn();
      const presets = ["#p0", "#p1", "#p2", "#p3", "#p4", "#p5"];

      expect(
        colorPickerKeyNavHandler(
          handlerArgs("q", {}, presets, onChange, { picksOnly: true }),
        ),
      ).toBe(true);
      expect(onChange).toHaveBeenCalledWith("#p0");

      onChange.mockClear();
      expect(
        colorPickerKeyNavHandler(
          handlerArgs("a", {}, presets, onChange, { picksOnly: true }),
        ),
      ).toBe(true);
      expect(onChange).toHaveBeenCalledWith("#p5");
    });

    it("reports a hotkey past the end of the preset row as handled without selecting", () => {
      const onChange = vi.fn();
      const presets = ["#p0", "#p1"];

      // `b` is the 15th binding — far past the two presets
      const handled = colorPickerKeyNavHandler(
        handlerArgs("b", {}, presets, onChange, { picksOnly: true }),
      );

      expect(handled).toBe(true);
      expect(onChange).not.toHaveBeenCalled();

      expect(
        colorPickerKeyNavHandler(
          handlerArgs("q", {}, presets, onChange, { picksOnly: true }),
        ),
      ).toBe(true);
      expect(onChange).toHaveBeenCalledWith("#p0");
    });

    it("navigates the preset row with arrow keys (horizontal cycle, vertical stays)", () => {
      const presets = ["#p0", "#p1", "#p2", "#p3", "#p4", "#p5"];

      let onChange = vi.fn();
      expect(
        colorPickerKeyNavHandler({
          ...handlerArgs("ArrowRight", {}, presets, onChange, {
            color: "#p2",
            picksOnly: true,
          }),
          activeColorPickerSection: "baseColors",
        }),
      ).toBe(true);
      expect(onChange).toHaveBeenCalledWith("#p3");

      onChange = vi.fn();
      expect(
        colorPickerKeyNavHandler({
          ...handlerArgs("ArrowLeft", {}, presets, onChange, {
            color: "#p0",
            picksOnly: true,
          }),
          activeColorPickerSection: "baseColors",
        }),
      ).toBe(true);
      expect(onChange).toHaveBeenCalledWith("#p5");

      // 单行预设：上下键原位不动
      onChange = vi.fn();
      expect(
        colorPickerKeyNavHandler({
          ...handlerArgs("ArrowDown", {}, presets, onChange, {
            color: "#p2",
            picksOnly: true,
          }),
          activeColorPickerSection: "baseColors",
        }),
      ).toBe(true);
      expect(onChange).toHaveBeenCalledWith("#p2");

      // 当前色不在预设行内时方向键不动作（不泄漏到画布移动选区）
      onChange = vi.fn();
      expect(
        colorPickerKeyNavHandler({
          ...handlerArgs("ArrowRight", {}, presets, onChange, {
            color: "#elsewhere",
            picksOnly: true,
          }),
          activeColorPickerSection: "baseColors",
        }),
      ).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("suppresses the eye-dropper hotkeys", () => {
      // 便签纸色弹层只有六色纸 + 明度（无取色入口）：i / Alt 不唤起取色器；
      // 按键仍按 handled 吞掉（`i` 外泄会命中画布级取色快捷键）
      const presets = ["#p0", "#p1"];
      const onEyeDropperToggle = vi.fn();

      expect(
        colorPickerKeyNavHandler({
          ...handlerArgs("i", {}, presets, () => {}, { picksOnly: true }),
          onEyeDropperToggle,
        }),
      ).toBe(true);
      expect(onEyeDropperToggle).not.toHaveBeenCalled();

      expect(
        colorPickerKeyNavHandler({
          ...handlerArgs("Alt", {}, presets, () => {}, { picksOnly: true }),
          onEyeDropperToggle,
        }),
      ).toBe(true);
      expect(onEyeDropperToggle).not.toHaveBeenCalled();

      // 常规变体不受影响
      expect(
        colorPickerKeyNavHandler({
          ...handlerArgs("i", {}, presets, () => {}),
          onEyeDropperToggle,
        }),
      ).toBe(true);
      expect(onEyeDropperToggle).toHaveBeenCalledTimes(1);
    });
  });
});
