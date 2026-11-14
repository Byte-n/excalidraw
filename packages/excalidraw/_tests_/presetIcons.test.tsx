import { THEME, applyDarkModeFilter } from "@excalidraw/common";

import { SHAPE_IDS } from "@excalidraw/element";

import { render } from "@testing-library/react";

import {
  getFramePresetIcon,
  getMindmapPresetIcon,
  getPresetShapeIcon,
} from "../components/presetIcons";
import { ALL_PRESET_ITEMS } from "../components/presetCatalog";
import { SHAPE_PRESET_DEFAULTS } from "../components/shapePresetDefaults";

import type { ReactNode } from "react";

const renderSvg = (node: ReactNode) => {
  const { container } = render(<>{node}</>);
  return container.querySelector("svg");
};

describe("presetIcons", () => {
  it.each([...SHAPE_IDS])("%s 渲染成 24×24 且带非空 path", (id) => {
    const svg = renderSvg(getPresetShapeIcon(id, THEME.LIGHT));

    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");

    const paths = Array.from(svg?.querySelectorAll("path") ?? []);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.getAttribute("d")?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("矩形图标使用预设填充色，并随深色主题换算", () => {
    const fill = SHAPE_PRESET_DEFAULTS.rectangle.backgroundColor;

    const light = renderSvg(getPresetShapeIcon("rectangle", THEME.LIGHT));
    expect(light?.querySelector(`path[fill="${fill}"]`)).not.toBeNull();

    const dark = renderSvg(getPresetShapeIcon("rectangle", THEME.DARK));
    expect(
      dark?.querySelector(`path[fill="${applyDarkModeFilter(fill, true)}"]`),
    ).not.toBeNull();
  });

  it("开放/透明图形只描边、不填充", () => {
    const svg = renderSvg(getPresetShapeIcon("brace", THEME.LIGHT));
    const paths = Array.from(svg?.querySelectorAll("path") ?? []);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.getAttribute("fill")).toBe("none");
    }
  });

  it("组合片段 else 预设图标画出虚线行分隔", () => {
    const { container } = render(
      <>
        {getPresetShapeIcon("sc-fragment", THEME.LIGHT, {
          fragmentBodyRows: 2,
        })}
      </>,
    );
    const paths = Array.from(container.querySelectorAll("path"));
    expect(
      paths.filter((path) => path.getAttribute("stroke-dasharray")),
    ).toHaveLength(1);
  });

  it("画框与脑图图例渲染成 24×24", () => {
    for (const icon of [
      getFramePresetIcon(THEME.LIGHT),
      getMindmapPresetIcon(THEME.LIGHT),
    ]) {
      const svg = renderSvg(icon);
      expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    }
  });

  it("目录里的每一项都有可渲染的图标", () => {
    for (const item of ALL_PRESET_ITEMS) {
      const svg = renderSvg(item.getIcon(THEME.LIGHT));
      expect(svg).not.toBeNull();
    }
  });
});
