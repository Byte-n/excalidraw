import React from "react";

import {
  applyDarkModeFilter,
  STICKY_NOTE_STROKE_PICKS,
  THEME,
} from "@excalidraw/common";

import { render } from "@testing-library/react";

import { TopPicks } from "../components/ColorPicker/TopPicks";

const swatchValues = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(".color-picker__button")).map(
    (el) => el.style.getPropertyValue("--swatch-color"),
  );

describe("color picker swatch theming", () => {
  it("便签墨色快捷色（TopPicks）在深色主题下仍走深色滤镜", () => {
    // 守卫：纸色预设行「不过滤镜」的改动不得扩散到墨色色域——TopPicks 仍须
    // 展示 applyDarkModeFilter 之后的颜色（便签墨色拾色器为 elementStroke 域，
    // picksOnly 为假，走的正是全色板网格 / TopPicks，不经 PresetColorList）
    const { container } = render(
      <TopPicks
        theme={THEME.DARK}
        type="elementStroke"
        activeColor={null}
        topPicks={STICKY_NOTE_STROKE_PICKS}
        onChange={() => {}}
      />,
    );
    expect(swatchValues(container)).toEqual(
      STICKY_NOTE_STROKE_PICKS.map((c) => applyDarkModeFilter(c, true)),
    );
  });
});
