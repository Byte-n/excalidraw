import { SEQUENCE_SHAPE_IDS } from "@excalidraw/element";

import { render } from "@testing-library/react";

import { getSequenceShapeIcon } from "../components/SequenceShapeIcon";

describe("SequenceShapeIcon", () => {
  it.each([...SEQUENCE_SHAPE_IDS])("%s 渲染成 24×24 且带非空 path", (id) => {
    const { container } = render(<>{getSequenceShapeIcon(id)}</>);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");

    const paths = Array.from(container.querySelectorAll("path"));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.getAttribute("d")?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("组合片段 else 预设图标画出虚线行分隔", () => {
    const { container } = render(
      <>{getSequenceShapeIcon("sc-fragment", { fragmentBodyRows: 2 })}</>,
    );
    const paths = Array.from(container.querySelectorAll("path"));
    expect(
      paths.filter((path) => path.getAttribute("stroke-dasharray")),
    ).toHaveLength(1);
  });
});
