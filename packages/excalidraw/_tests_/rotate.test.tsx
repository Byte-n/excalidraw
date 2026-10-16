import React from "react";
import { expect } from "vitest";

import { reseed } from "@excalidraw/common";

import { pointFrom } from "@excalidraw/math";

import { distanceToElement } from "@excalidraw/element";

import type { GlobalPoint } from "@excalidraw/math";

import { Excalidraw } from "../index";

import { UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

const { h } = window;

unmountComponent();

beforeEach(() => {
  localStorage.clear();
  reseed(7);
});

test("unselected bound arrow updates when rotating its target element", async () => {
  await render(<Excalidraw />);
  const rectangle = UI.createElement("rectangle", {
    width: 200,
    height: 100,
  });
  const arrow = UI.createElement("arrow", {
    x: -80,
    y: 50,
    width: 85,
    height: 0,
  });

  expect(arrow.endBinding?.elementId).toEqual(rectangle.id);

  // the rotation handle now sits diagonally outside the se corner; that spot
  // is the mirror of the old ne spot about the element's horizontal centre
  // line, so the drag is mirrored too (the delta's dy negated) and sweeps the
  // same shift-snapped 15°, in the opposite direction
  UI.rotate(rectangle, [60, -36], { shift: true });

  expect(arrow.endBinding?.elementId).toEqual(rectangle.id);
  expect(arrow.x).toBeCloseTo(-80);
  expect(arrow.y).toBeCloseTo(50);
  // 数值口径：端点贴在目标轮廓外一个 binding gap 处（端点就是 attachPoint 本身，
  // 见 binding.ts 的 updateBoundPoint），因此 bbox 比「锚点在图形内部」的时代小
  expect(arrow.width).toBeCloseTo(77.614, 1);
  expect(arrow.height).toBeCloseTo(27.444, 1);
});

test("unselected bound arrows update when rotating their target elements", async () => {
  await render(<Excalidraw />);
  const ellipse = UI.createElement("ellipse", {
    x: 0,
    y: 80,
    width: 300,
    height: 120,
  });
  const ellipseArrow = UI.createElement("arrow", {
    x: -10,
    y: 80,
    width: 50,
    height: 60,
  });
  const text = UI.createElement("text", {
    position: 220,
  });
  await UI.editText(text, "test");
  const textArrow = UI.createElement("arrow", {
    x: 360,
    y: 300,
    width: -140,
    height: -60,
  });

  expect(ellipseArrow.endBinding?.elementId).toEqual(ellipse.id);
  expect(textArrow.endBinding?.elementId).toEqual(text.id);

  // mirrored for the same reason as above: the rotation handle of the common
  // bounds moved from above the ne corner to below the se corner
  UI.rotate([ellipse, text], [-82, -23], { shift: true });

  expect(ellipseArrow.endBinding?.elementId).toEqual(ellipse.id);
  expect(ellipseArrow.x).toEqual(-10);
  expect(ellipseArrow.y).toEqual(80);
  expect(ellipseArrow.points[0]).toEqual([0, 0]);
  expect(ellipseArrow.points[1][0]).toBeCloseTo(42.154, 1);
  expect(ellipseArrow.points[1][1]).toBeCloseTo(-5.388, 1);

  expect(textArrow.endBinding?.elementId).toEqual(text.id);
  expect(textArrow.x).toEqual(360);
  expect(textArrow.y).toEqual(300);
  expect(textArrow.points[0]).toEqual([0, 0]);
  // 文本目标不留 binding gap（见 binding.ts 的 getProjectionBindingGap）：端点正落在
  // 文本的绑定边上，而不是再往外一个 gap —— 所以比带 gap 的旧值更贴近文本
  expect(textArrow.points[1][0]).toBeCloseTo(-152.469, 1);
  expect(textArrow.points[1][1]).toBeCloseTo(-36.674, 1);
  // ... 而「落在边上」是可验的几何事实，不只是两个凑出来的数
  expect(
    distanceToElement(
      text,
      h.app.scene.getNonDeletedElementsMap(),
      pointFrom<GlobalPoint>(
        textArrow.x + textArrow.points[1][0],
        textArrow.y + textArrow.points[1][1],
      ),
    ),
  ).toBeCloseTo(0, 1);
});
