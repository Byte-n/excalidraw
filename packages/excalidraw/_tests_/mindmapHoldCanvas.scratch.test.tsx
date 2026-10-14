import {
  getCompletelySelectedMindmapGraphElementIds,
  newMindmapNodeElement,
  newTextElement,
} from "@excalidraw/element";

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

describe("scratch: canvas calls while holding root with collapsed branch", () => {
  it("records strokeRect calls on the interactive canvas", async () => {
    type Call = { type: string; args: unknown[] };
    const callsByCanvas = new WeakMap<object, Call[]>();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: any[]
    ) {
      const ctx = (origGetContext as any).apply(this, args);
      if (args[0] !== "2d" || !ctx) {
        return ctx;
      }
      const calls: Call[] = [];
      callsByCanvas.set(this, calls);
      return new Proxy(ctx, {
        get(target, prop: string) {
          const value = (target as any)[prop];
          if (typeof value === "function") {
            return (...fnArgs: unknown[]) => {
              calls.push({ type: prop, args: fnArgs });
              return value.apply(target, fnArgs);
            };
          }
          return value;
        },
      }) as typeof ctx;
    } as any;

    try {
      await render(
        <Excalidraw
          handleKeyboardGlobally
          initialData={{ elements: fixture() }}
        />,
      );
      const mouse = new Pointer("mouse");
      const node = (id: string) =>
        h.app.scene.getNonDeletedElement(id)! as ExcalidrawElement;

      const interactive = document.querySelector(
        "canvas.excalidraw__canvas.interactive",
      ) as HTMLCanvasElement;
      const interactiveCalls = () => callsByCanvas.get(interactive) ?? [];

      // 按住根节点（不松开、不移动）
      mouse.downAt(node("root").x + 20, node("root").y + 20);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const hidden = [...h.app.scene.getMindmapHiddenElementIds()];
      const suppressed = [
        ...getCompletelySelectedMindmapGraphElementIds(
          h.app.scene.getNonDeletedElements(),
          h.state.selectedElementIds,
        ),
      ];
      // eslint-disable-next-line no-console
      console.log("HIDDEN:", JSON.stringify(hidden.sort()));
      // eslint-disable-next-line no-console
      console.log(
        "SELECTED:",
        JSON.stringify(Object.keys(h.state.selectedElementIds).sort()),
      );
      // eslint-disable-next-line no-console
      console.log("SUPPRESSED:", JSON.stringify(suppressed.sort()));

      const strokeRects = interactiveCalls().filter(
        (call) => call.type === "strokeRect",
      );
      // eslint-disable-next-line no-console
      console.log(
        "INTERACTIVE strokeRect count:",
        strokeRects.length,
        JSON.stringify(
          strokeRects.map((call) =>
            call.args.map((n) => Math.round(Number(n))),
          ),
        ),
      );
      const summary: Record<string, number> = {};
      interactiveCalls().forEach((call) => {
        summary[call.type] = (summary[call.type] ?? 0) + 1;
      });
      // eslint-disable-next-line no-console
      console.log("INTERACTIVE call summary:", JSON.stringify(summary));

      mouse.up();
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });
});
