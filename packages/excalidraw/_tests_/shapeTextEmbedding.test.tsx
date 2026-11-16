import { KEYS } from "@excalidraw/common";

import type {
  ExcalidrawShapeElement,
  ExcalidrawTextContainer,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { act, render, unmountComponent } from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

unmountComponent();

const rectSize = { width: 200, height: 100 };

/** 足够长，保证在 200px 宽的正文区域内换行成多行并撑高形状 */
const longText = "正文内容需要在形状内部自动换行并撑高形状高度".repeat(6);

const createRectangle = (
  overrides: Partial<{ angle: number; width: number; height: number }> = {},
) =>
  API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: rectSize.width,
    height: rectSize.height,
    ...overrides,
  }) as unknown as NonDeleted<ExcalidrawShapeElement>;

const getLiveShape = (elementId: string) =>
  h.app.scene.getNonDeletedElement(
    elementId,
  ) as NonDeleted<ExcalidrawShapeElement>;

const startEditing = (element: NonDeleted<ExcalidrawShapeElement>) => {
  act(() => {
    h.app.startTextEditing({
      sceneX: element.x + element.width / 2,
      sceneY: element.y + element.height / 2,
      container: element as unknown as ExcalidrawTextContainer,
    });
  });
};

const getShapeTextElements = () =>
  h.elements.filter((element) => !element.isDeleted && element.type === "text");

const submitText = async (text: string) => {
  const editor = await getTextEditor();
  updateTextEditor(editor, text);
  act(() => {
    h.app.textWysiwygSubmitHandler?.();
  });
};

const enterText = async (text: string) => {
  const editor = await getTextEditor();
  updateTextEditor(editor, text);
  act(() => {
    Keyboard.exitTextEditor(editor);
  });
};

describe("shape text embedding", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    API.setElements([]);
  });

  it("提交正文后写入 texts.body，且不产生文字元素", async () => {
    const rectangle = createRectangle();
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    startEditing(rectangle);

    expect(h.state.editingTextRegion?.target).toEqual({
      elementId: rectangle.id,
      region: "body",
    });
    expect(h.state.editingTextElement).toBe(null);

    const text = longText;

    await submitText(text);

    const live = getLiveShape(rectangle.id);
    expect(live.texts?.body?.text).toBe(text);
    expect(getShapeTextElements()).toHaveLength(0);
    expect(h.state.editingTextRegion).toBe(null);
    expect(h.state.editingTextElement).toBe(null);
    expect(live.height).toBeGreaterThan(rectSize.height);
    expect(await getTextEditor({ waitForEditor: false })).toBe(null);
  });

  it("再次进入编辑并替换正文时更新 texts.body", async () => {
    const rectangle = createRectangle();
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    startEditing(rectangle);
    await submitText("初始正文");

    mouse.doubleClickOn(getLiveShape(rectangle.id));
    expect(h.state.editingTextRegion?.target.elementId).toBe(rectangle.id);
    await submitText("替换后的正文");

    const live = getLiveShape(rectangle.id);
    expect(live.texts?.body?.text).toBe("替换后的正文");
    expect(getShapeTextElements()).toHaveLength(0);
  });

  it("清空正文提交后删除 body 并缩回最小高度", async () => {
    const rectangle = createRectangle();
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    startEditing(rectangle);
    await submitText(longText);
    const grown = getLiveShape(rectangle.id);
    expect(grown.height).toBeGreaterThan(rectSize.height);
    expect(grown.textFitMinHeight).toBe(rectSize.height);

    startEditing(grown);
    await submitText("");

    const live = getLiveShape(rectangle.id);
    expect(live.texts).toBe(undefined);
    expect(live.height).toBe(rectSize.height);
    expect(getShapeTextElements()).toHaveLength(0);
    expect(h.state.editingTextRegion).toBe(null);
  });

  it("Escape 取消编辑时不写入场景", async () => {
    const rectangle = createRectangle();
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    startEditing(rectangle);
    await enterText("不会提交的正文");

    const live = getLiveShape(rectangle.id);
    expect(live.texts).toBe(undefined);
    expect(live.version).toBe(rectangle.version);
    expect(getShapeTextElements()).toHaveLength(0);
    expect(h.state.editingTextRegion).toBe(null);
  });

  it("文字工具点击形状同样写入 texts.body", async () => {
    const rectangle = createRectangle();
    API.setElements([rectangle]);

    UI.clickTool("text");
    act(() => {
      mouse.clickAt(
        rectangle.x + rectangle.width / 2,
        rectangle.y + rectangle.height / 2,
      );
    });

    expect(h.state.editingTextRegion?.target.elementId).toBe(rectangle.id);
    expect(h.state.editingTextElement).toBe(null);

    await submitText("文字工具输入");

    const live = getLiveShape(rectangle.id);
    expect(live.texts?.body?.text).toBe("文字工具输入");
    expect(getShapeTextElements()).toHaveLength(0);
  });

  it("旋转后的形状提交正文也不产生文字元素", async () => {
    const rectangle = createRectangle({ angle: Math.PI / 6 });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    startEditing(rectangle);
    await submitText("旋转形状中的正文");

    const live = getLiveShape(rectangle.id);
    expect(live.texts?.body?.text).toBe("旋转形状中的正文");
    expect(getShapeTextElements()).toHaveLength(0);
    expect(h.state.editingTextRegion).toBe(null);
    // 角度保持，编辑不改变形状的旋转
    expect(live.angle).toBe(rectangle.angle);
  });

  it("缩放后的形状提交正文也不产生文字元素", async () => {
    const rectangle = createRectangle();
    API.setElements([rectangle]);
    act(() => {
      h.app.scene.mutateElement(getLiveShape(rectangle.id), {
        width: 320,
        height: 180,
      });
    });

    startEditing(getLiveShape(rectangle.id));
    await submitText("缩放形状中的正文");

    const live = getLiveShape(rectangle.id);
    expect(live.texts?.body?.text).toBe("缩放形状中的正文");
    expect(getShapeTextElements()).toHaveLength(0);
    expect(live.width).toBeGreaterThanOrEqual(320);
  });

  it("Shift+Enter 在多行正文中换行", async () => {
    const rectangle = createRectangle();
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    startEditing(rectangle);
    const editor = await getTextEditor();
    updateTextEditor(editor, "第一行\n第二行");

    act(() => {
      Keyboard.withModifierKeys({ shift: true }, () => {
        Keyboard.keyDown(KEYS.ENTER, editor);
      });
    });

    // Shift+Enter 不提交，仅插入换行
    expect(h.state.editingTextRegion).not.toBe(null);
    expect(await getTextEditor({ waitForEditor: false })).toBe(editor);

    act(() => {
      h.app.textWysiwygSubmitHandler?.();
    });
    expect(getLiveShape(rectangle.id).texts?.body?.text).toContain("第二行");
  });
});
