import { newMindmapNodeElement, newTextElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { Pointer } from "./helpers/ui";
import { spyInteractiveStrokeRects } from "./helpers/canvas";
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
