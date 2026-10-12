import { newMindmapNodeElement, newTextElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { Pointer } from "./helpers/ui";
import { render } from "./test-utils";

const { h } = window;

// root
//  └─ a (collapsed)
//      └─ a1
//  └─ b
const fixture = () => {
  const entries = [
    ["root", null, "Root", false],
    ["a", "root", "A", true],
    ["a1", "a", "A1", false],
    ["b", "root", "B", false],
  ] as const;
  const elements: ExcalidrawElement[] = [];
  entries.forEach(([id, parentId, label, collapsed], i) => {
    const node = {
      ...newMindmapNodeElement({
        x: 100,
        y: 200,
        graphId: "graph",
        ...(parentId
          ? {
              role: "node" as const,
              parentId,
              order: `a${i}` as FractionalIndex,
            }
          : { role: "root" as const, parentId: null, order: null }),
      }),
      id,
      ...(collapsed ? { collapsed: true } : {}),
    };
    const text = {
      ...newTextElement({
        x: 0,
        y: 0,
        text: label,
        containerId: id,
        textAlign: "center",
        verticalAlign: "middle",
      }),
      id: `${id}-text`,
    };
    elements.push(node, text);
  });
  return elements;
};

/**
 * 记录交互画布 2d 上下文的 strokeRect 调用。返回 [还原函数, 取调用]。
 */
const spyInteractiveStrokeRects = () => {
  const callsByCanvas = new WeakMap<
    object,
    [number, number, number, number][]
  >();
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    ...args: any[]
  ) {
    const ctx = (origGetContext as any).apply(this, args);
    if (args[0] !== "2d" || !ctx) {
      return ctx;
    }
    const rects: [number, number, number, number][] = [];
    callsByCanvas.set(this, rects);
    return new Proxy(ctx, {
      get(target, prop: string) {
        const value = (target as any)[prop];
        if (typeof value === "function") {
          return (...fnArgs: unknown[]) => {
            if (prop === "strokeRect") {
              rects.push(fnArgs as [number, number, number, number]);
            }
            return value.apply(target, fnArgs);
          };
        }
        return value;
      },
    }) as typeof ctx;
  } as any;

  const getRects = () => {
    const interactive = document.querySelector(
      "canvas.excalidraw__canvas.interactive",
    ) as HTMLCanvasElement;
    return callsByCanvas.get(interactive) ?? [];
  };
  const restore = () => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
  };
  return { getRects, restore };
};

describe("mindmap: 按住根节点的选中描边", () => {
  it("整图选中按住不动时不逐元素描边，松手提交后也不描边", async () => {
    const spy = spyInteractiveStrokeRects();
    try {
      await render(
        <Excalidraw
          handleKeyboardGlobally
          initialData={{ elements: fixture() }}
        />,
      );
      const mouse = new Pointer("mouse");
      const root = h.app.scene.getNonDeletedElement("root")!;

      // 按住根节点（不松开、不移动）：selectionElement 仍在，
      // 走「框选进行中」的逐元素高亮分支；整图选中应被抑制。
      mouse.downAt(root.x + 20, root.y + 20);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 0 尺寸的橡皮筋本身不算描边
      const boxesWhileHolding = spy
        .getRects()
        .filter(([, , w, h]) => w > 1 || h > 1);
      expect(boxesWhileHolding).toEqual([]);
      expect(Object.keys(h.state.selectedElementIds).length).toBeGreaterThan(1);

      // 松手提交选择后走主选中渲染，同样不逐元素描边
      const rawCountBeforeUp = spy.getRects().length;
      mouse.up();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const boxesAfterRelease = spy
        .getRects()
        .slice(rawCountBeforeUp)
        .filter(([, , w, h]) => w > 1 || h > 1);
      // 提交后允许多选共同虚线外框（单个矩形），不允许逐元素矩形
      expect(boxesAfterRelease.length).toBeLessThanOrEqual(1);
    } finally {
      spy.restore();
    }
  });
});
