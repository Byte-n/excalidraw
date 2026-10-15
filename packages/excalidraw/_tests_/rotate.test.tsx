import React from "react";
import { expect } from "vitest";

import { reseed } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

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
  expect(arrow.width).toBeCloseTo(88.24, 1);
  expect(arrow.height).toBeCloseTo(24.597, 1);
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
  expect(ellipseArrow.points[1][0]).toBeCloseTo(59.568, 1);
  expect(ellipseArrow.points[1][1]).toBeCloseTo(32.308, 1);

  expect(textArrow.endBinding?.elementId).toEqual(text.id);
  expect(textArrow.x).toEqual(360);
  expect(textArrow.y).toEqual(300);
  expect(textArrow.points[0]).toEqual([0, 0]);
  expect(textArrow.points[1][0]).toBeCloseTo(-118.468, 0);
  expect(textArrow.points[1][1]).toBeCloseTo(-30.914, 0);
});
