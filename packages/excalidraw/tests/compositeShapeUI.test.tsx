import { Excalidraw } from "../index";

import { Keyboard, Pointer, UI } from "./helpers/ui";
import {
  act,
  fireEvent,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  screen,
} from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

describe.each([
  { name: "desktop", width: 1200, height: 800, formFactor: "desktop" },
  { name: "phone", width: 390, height: 844, formFactor: "phone" },
])("composite shape tools on $name", ({ width, height, formFactor }) => {
  beforeEach(async () => {
    mockBoundingClientRect({ width, height });
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    act(() => h.app.refreshEditorInterface());
  });

  afterEach(() => restoreOriginalGetBoundingClientRect());

  it("creates all three shapes and preserves them through undo and redo", () => {
    expect(h.app.editorInterface.formFactor).toBe(formFactor);

    for (const [index, id] of ["rectangle", "diamond", "ellipse"].entries()) {
      if (formFactor === "phone" && id !== "rectangle") {
        fireEvent.click(screen.getByTestId("toolbar-rectangle"));
        fireEvent.click(screen.getByTestId(`toolbar-${id}`));
      } else {
        UI.clickTool(id as "rectangle" | "diamond" | "ellipse");
      }
      const x = 60 + index * 100;
      mouse.reset();
      mouse.down(x, 80);
      mouse.reset();
      mouse.up(x + 80, 160);
      expect(h.elements[h.elements.length - 1]).toMatchObject({
        type: "composite_shape",
        shape: { id, schemaVersion: 1 },
      });
    }

    expect(h.app.scene.getNonDeletedElements()).toHaveLength(3);
    Keyboard.undo();
    expect(h.app.scene.getNonDeletedElements()).toHaveLength(2);
    Keyboard.redo();
    expect(h.app.scene.getNonDeletedElements()).toHaveLength(3);
  });
});
