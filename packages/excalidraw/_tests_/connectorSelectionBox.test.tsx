import { pointFrom } from "@excalidraw/math";

import {
  getElementAbsoluteCoords,
  getElementWithTransformHandleType,
  getTransformHandles,
  hasBoundingBox,
  newArrowElement,
  newLinearElement,
} from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { Pointer } from "./helpers/ui";
import { spyInteractiveStrokeRects } from "./helpers/canvas";
import { render } from "./test-utils";

const { h } = window;

/**
 * 连接线（直线/曲线/折线）选中后不画矩形选中框：矩形只会把一条斜线圈进它的
 * 包围盒。选中反馈交给沿路径的端点手柄与线本身，按住不放时交给沿路径的描线。
 *
 * 画布上的矩形描边都落到 `context.strokeRect`（选区框走
 * `strokeRectWithRotation_simple`，见 renderer/helpers.ts），所以这里用
 * `spyInteractiveStrokeRects` 断言「框画没画」。
 */
const WRAPS_MARGIN = 8;

/**
 * 与元素包围盒同量级、且把元素整圈包住的矩形 = 选中框。手柄（约 8px 的小方
 * 块）、橡皮筋（0 尺寸）都远小于元素本身，不会误判。
 */
const selectionBoxRects = (
  rects: readonly (readonly [number, number, number, number])[],
  element: NonDeletedExcalidrawElement,
) => {
  const width = Math.abs(element.width);
  const height = Math.abs(element.height);
  return rects.filter(
    ([, , w, h]) =>
      w >= width + WRAPS_MARGIN && h >= height + WRAPS_MARGIN && h > 1,
  );
};

// 三种线样式各自的落点：直线两点、直角错开四拐点、圆角曲线两点（恒两点）、
// 折线交给正交路由。线段都从 (100,100) 起，下面的命中点都取在线上。
const fixtures: {
  name: string;
  element: () => NonDeletedExcalidrawElement;
  hitPoint: [number, number];
  /**
   * 包围盒内、但离路径很远的点。两点连接线的包围盒是退化的（宽或高为 0），
   * 没有这种点；只有多拐点形态曾经留着一块「看不见的框」，所以只有它有。
   */
  emptyInsideBBox?: [number, number];
}[] = [
  {
    name: "直线连接线（两点）",
    element: () =>
      newArrowElement({
        type: "arrow",
        x: 100,
        y: 100,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
      }),
    hitPoint: [200, 100],
  },
  {
    name: "直角连接线（错开，四拐点）",
    element: () =>
      newArrowElement({
        type: "arrow",
        x: 100,
        y: 100,
        points: [
          pointFrom<LocalPoint>(0, 0),
          pointFrom<LocalPoint>(0, 100),
          pointFrom<LocalPoint>(200, 100),
          pointFrom<LocalPoint>(200, 200),
        ],
      }),
    // 第三点 → 第四点这条横线上的中点
    hitPoint: [200, 200],
    // 包围盒 (100,100)-(300,300) 里的空白处：路径只落在 x=200 竖线与 y=200 横线上
    emptyInsideBBox: [280, 130],
  },
  {
    name: "曲线连接线（圆角，两点）",
    element: () =>
      newArrowElement({
        type: "arrow",
        x: 100,
        y: 100,
        roundness: { type: 2 },
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
      }),
    hitPoint: [200, 100],
  },
  {
    name: "折线连接线（elbow）",
    element: () =>
      newArrowElement({
        type: "arrow",
        x: 100,
        y: 100,
        elbowed: true,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
      }),
    hitPoint: [200, 100],
  },
  {
    name: "直线（line 工具，两点）",
    element: () =>
      newLinearElement({
        type: "line",
        x: 100,
        y: 100,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
      }),
    hitPoint: [200, 100],
  },
];

describe("连接线选中不画矩形框", () => {
  it.each(fixtures)("$name：选中后不画矩形", async ({ element, hitPoint }) => {
    const spy = spyInteractiveStrokeRects();
    try {
      const connector = element();
      await render(<Excalidraw initialData={{ elements: [connector] }} />);
      const mouse = new Pointer("mouse");
      const [x, y] = hitPoint;

      mouse.clickAt(x, y);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 先确认真的选中了，否则断言可能只是「没选中所以没框」
      expect(h.state.selectedElementIds[connector.id]).toBe(true);
      expect(selectionBoxRects(spy.getRects(), connector)).toEqual([]);
    } finally {
      spy.restore();
    }
  });

  it.each(fixtures)(
    "$name：按住不放时也不画矩形",
    async ({ element, hitPoint }) => {
      const spy = spyInteractiveStrokeRects();
      try {
        const connector = element();
        await render(<Excalidraw initialData={{ elements: [connector] }} />);
        const mouse = new Pointer("mouse");
        const [x, y] = hitPoint;

        mouse.clickAt(x, y);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(h.state.selectedElementIds[connector.id]).toBe(true);

        // 按住不放：selectionElement 仍在，走「框选进行中」的逐元素高亮分支
        mouse.downAt(x, y);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(selectionBoxRects(spy.getRects(), connector)).toEqual([]);

        mouse.up();
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally {
        spy.restore();
      }
    },
  );

  it.each(fixtures)(
    "$name：选中后没有变换手柄，包围盒边上也抓不到缩放",
    async ({ element, hitPoint }) => {
      const connector = element();
      await render(<Excalidraw initialData={{ elements: [connector] }} />);
      const mouse = new Pointer("mouse");
      const [x, y] = hitPoint;

      mouse.clickAt(x, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(h.state.selectedElementIds[connector.id]).toBe(true);

      // 渲染与命中同源：手柄为空数组即「画不出、也抓不到」
      expect(
        getTransformHandles(
          connector,
          h.state.zoom,
          h.app.scene.getNonDeletedElementsMap(),
          "mouse",
          {},
        ),
      ).toEqual({});

      // 边带的兜底路径同样不认连接线：贴着包围盒左上角按下去不该进入缩放
      const [x1, y1] = getElementAbsoluteCoords(
        connector,
        h.app.scene.getNonDeletedElementsMap(),
      );
      expect(
        getElementWithTransformHandleType(
          [connector],
          h.state,
          x1,
          y1,
          h.state.zoom,
          "mouse",
          h.app.scene.getNonDeletedElementsMap(),
          h.app.editorInterface,
        ),
      ).toBe(null);

      // 「有没有框」的唯一判据：它同时管画框、抓手柄、以及 hitTest 里
      // 「只命中包围盒也算点到」那条路。连接线必须一律为 false，否则框不画了
      // 却仍在某处生效。
      expect(hasBoundingBox([connector], h.state, h.app.editorInterface)).toBe(
        false,
      );
    },
  );

  // 曾经漏掉的半边：框不画了，但 `hasBoundingBox` 对多拐点连接线仍返回
  // true，于是 `hitElement` 里的「只命中包围盒」那条路照样把包围盒内的空白处
  // 判成命中——按住拖动会把连接线拖走，而画面上那个框并不存在。
  const withEmptyInsideBBox = fixtures.filter(
    (
      fixture,
    ): fixture is typeof fixtures[number] & {
      emptyInsideBBox: [number, number];
    } => !!fixture.emptyInsideBBox,
  );
  it.each(withEmptyInsideBBox)(
    "$name：包围盒里的空白处不再能拖动它",
    async ({ element, hitPoint, emptyInsideBBox }) => {
      const connector = element();
      await render(<Excalidraw initialData={{ elements: [connector] }} />);
      const mouse = new Pointer("mouse");
      const read = () =>
        h.app.scene.getNonDeletedElement(
          connector.id,
        )! as NonDeletedExcalidrawElement;

      mouse.clickAt(...hitPoint);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(h.state.selectedElementIds[connector.id]).toBe(true);

      const before = { x: read().x, y: read().y };
      mouse.downAt(...emptyInsideBBox);
      mouse.moveTo(emptyInsideBBox[0] + 20, emptyInsideBBox[1] + 20);
      mouse.up();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 那里是一块普通空白：拖动只是拉了一个没捞到东西的橡皮筋
      expect({ x: read().x, y: read().y }).toEqual(before);
      expect(!!h.state.selectedElementIds[connector.id]).toBe(false);
    },
  );
});
