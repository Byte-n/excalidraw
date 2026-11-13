import { pointFrom } from "@excalidraw/math";

import {
  buildShapeData,
  getCompositeShapeControlPoints,
  LinearElementEditor,
} from "@excalidraw/element";
import { setTableSceneTitle } from "@excalidraw/element/tableScene";

import type { LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawLinearElement,
  ExcalidrawTableElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { getCompositeControlPointGlobal } from "../components/app/compositeShapeControls";
import { getTableTitleBar } from "../components/app/tableTitle";
import { getTextAutoResizeHandle } from "../textAutoResizeHandle";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { act, render, unmountComponent, waitFor } from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

unmountComponent();

const rect = () =>
  API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 120,
    height: 80,
  });

/**
 * Hover first, then pointerdown, and resolve the armed frame from the same
 * point (05-general-hover.md §5.3).
 */
const expectHoverDownKind = async (x: number, y: number, kind: string) => {
  await act(() => {
    mouse.moveTo(x, y);
  });
  await waitFor(() => {
    expect(h.app.pointer.getFrame()?.target.kind).toBe(kind);
  });

  await act(() => {
    mouse.downAt(x, y);
  });
  const armed = h.app.pointer.getFrame();
  expect(armed?.phase).toBe("armed");
  expect(armed?.target.kind).toBe(kind);

  await act(() => {
    mouse.upAt(x, y);
  });
};

describe("hover = pointerdown target (PR5a-2)", () => {
  beforeEach(async () => {
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    unmountComponent();
  });

  it("canvas", async () => {
    await expectHoverDownKind(700, 700, "canvas");
  });

  it("element", async () => {
    const element = rect();
    API.setElements([element]);
    await expectHoverDownKind(160, 140, "element");
  });

  it("selectedElement", async () => {
    const element = rect();
    API.setElements([element]);
    API.setSelectedElements([element]);
    await expectHoverDownKind(160, 140, "selectedElement");
  });

  it("transformHandle", async () => {
    const element = rect();
    API.setElements([element]);
    API.setSelectedElements([element]);
    await expectHoverDownKind(100, 100, "transformHandle");
  });

  it("textHandle", async () => {
    const text = API.createElement({
      type: "text",
      x: 300,
      y: 300,
      width: 100,
      height: 60,
      text: "hello",
      fontSize: 20,
      autoResize: false,
    } as any);
    API.setElements([text]);
    API.setSelectedElements([text]);
    act(() => {
      h.app.scene.mutateElement(h.app.scene.getNonDeletedElement(text.id)!, {
        autoResize: false,
      } as any);
    });
    const live = h.app.scene.getNonDeletedElement(text.id)!;
    const handle = getTextAutoResizeHandle(live as any, 1, "desktop")!;
    await expectHoverDownKind(handle.center[0], handle.center[1], "textHandle");
  });

  it("linearHandle", async () => {
    const line = API.createElement({
      type: "line",
      x: 300,
      y: 360,
      width: 120,
      height: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(120, 0)],
    });
    API.setElements([line]);
    const live = h.app.scene.getNonDeletedElement(
      line.id,
    ) as NonDeleted<ExcalidrawLinearElement>;
    API.setAppState({
      selectedElementIds: { [line.id]: true },
      selectedLinearElement: new LinearElementEditor(
        live,
        h.app.scene.getNonDeletedElementsMap(),
      ),
    });
    await expectHoverDownKind(300, 360, "linearHandle");
  });

  it("compositeControl", async () => {
    const composite = API.createElement({
      type: "composite",
      x: 500,
      y: 500,
      width: 120,
      height: 100,
      shape: buildShapeData("cube"),
    });
    API.setElements([composite]);
    API.setSelectedElements([composite]);
    const live = h.app.scene.getNonDeletedElement(composite.id)!;
    const control = getCompositeShapeControlPoints(live as any)[0];
    const [x, y] = getCompositeControlPointGlobal(live as any, control);
    await expectHoverDownKind(x, y, "compositeControl");
  });

  it("containerControl (table title grip)", async () => {
    const table = API.createElement({ type: "table", x: 200, y: 400 });
    API.setElements([table]);
    act(() => {
      setTableSceneTitle(
        h.app.scene,
        h.app.scene.getNonDeletedElement(
          table.id,
        ) as NonDeleted<ExcalidrawTableElement>,
        "Title",
      );
    });
    const liveTable = h.app.scene.getNonDeletedElement(
      table.id,
    ) as NonDeleted<ExcalidrawTableElement>;
    const title = h.elements.find(
      (element) => element.containerRef?.kind === "tableTitle",
    ) as any;
    const bar = getTableTitleBar(liveTable, title, 1, title.fontSize);
    const gripX = bar.grip.x + bar.grip.width / 2;
    const gripY = bar.grip.y + bar.grip.height / 2;
    await expectHoverDownKind(gripX, gripY, "containerControl");
  });
});
