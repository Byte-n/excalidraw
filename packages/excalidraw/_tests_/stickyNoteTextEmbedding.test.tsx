import {
  COLOR_PALETTE,
  DEFAULT_STICKY_NOTE_SIZE,
  STICKY_NOTE_MAX_FONT_SIZE,
} from "@excalidraw/common";

import {
  convertToExcalidrawElements,
  getLocalTextRegionLayout,
} from "@excalidraw/element";

import type {
  ExcalidrawStickyNoteElement,
  ExcalidrawTextContainer,
  NonDeleted,
} from "@excalidraw/element/types";

import { actionChangeFontSize } from "../actions/actionProperties";
import * as restore from "../data/restore";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { act, render, unmountComponent } from "./test-utils";

const { h } = window;

unmountComponent();

/** 足够长，保证在 250px 便签内换行并缩小到最小字号后仍撑高便签 */
const longText = "便签正文需要在纸面内部自动换行并可以撑高便签高度".repeat(12);

const createStickyNote = (
  overrides: Partial<{ angle: number; width: number; height: number }> = {},
) =>
  API.createElement({
    type: "stickynote",
    x: 100,
    y: 100,
    width: DEFAULT_STICKY_NOTE_SIZE,
    height: DEFAULT_STICKY_NOTE_SIZE,
    baseHeight: DEFAULT_STICKY_NOTE_SIZE,
    ...overrides,
  }) as NonDeleted<ExcalidrawStickyNoteElement>;

const getLiveNote = (elementId: string) =>
  h.app.scene.getNonDeletedElement(
    elementId,
  ) as NonDeleted<ExcalidrawStickyNoteElement>;

/** 骨架创建的便签：label 直接落进 texts.body，场景里没有文字元素 */
const createNoteFromSkeleton = (text: string, fontSize?: number) =>
  convertToExcalidrawElements([
    {
      type: "stickynote",
      x: 100,
      y: 100,
      label: { text, ...(fontSize !== undefined ? { fontSize } : {}) },
    },
  ])[0] as NonDeleted<ExcalidrawStickyNoteElement>;

const startEditing = (element: NonDeleted<ExcalidrawStickyNoteElement>) => {
  act(() => {
    h.app.startTextEditing({
      sceneX: element.x + element.width / 2,
      sceneY: element.y + element.height / 2,
      container: element as ExcalidrawTextContainer,
    });
  });
};

const getTextElements = () =>
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

describe("sticky note text embedding", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    API.setElements([]);
  });

  it("提交正文后写入 texts.body，且不产生文字元素", async () => {
    const note = createStickyNote();
    API.setElements([note]);
    API.setSelectedElements([note]);

    startEditing(note);

    expect(h.state.editingTextRegion?.target).toEqual({
      elementId: note.id,
      region: "body",
    });
    expect(h.state.editingTextElement).toBe(null);

    await submitText("第一行\n第二行");

    const live = getLiveNote(note.id);
    expect(live.texts?.body?.text).toBe("第一行\n第二行");
    expect(getTextElements()).toHaveLength(0);
    expect(h.state.editingTextRegion).toBe(null);
    expect(h.state.editingTextElement).toBe(null);
    expect(await getTextEditor({ waitForEditor: false })).toBe(null);
  });

  it("很长的正文缩小字号，缩到最小仍放不下时便签向上增高", async () => {
    const note = createStickyNote();
    API.setElements([note]);
    API.setSelectedElements([note]);

    startEditing(note);
    await submitText(longText);

    const live = getLiveNote(note.id);
    const layout = getLocalTextRegionLayout(live, "body")!;
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.fontSize).toBeLessThan(live.texts!.body!.style.fontSize);
    expect(live.baseHeight).toBe(DEFAULT_STICKY_NOTE_SIZE);
    expect(live.height).toBeGreaterThan(DEFAULT_STICKY_NOTE_SIZE);
    expect(getTextElements()).toHaveLength(0);
  });

  it("清空正文后删除 body 并把便签缩回 baseHeight", async () => {
    const note = createStickyNote();
    API.setElements([note]);
    API.setSelectedElements([note]);

    startEditing(note);
    await submitText(longText);
    const grown = getLiveNote(note.id);
    expect(grown.height).toBeGreaterThan(DEFAULT_STICKY_NOTE_SIZE);

    startEditing(grown);
    await submitText("");

    const live = getLiveNote(note.id);
    expect(live.texts).toBe(undefined);
    expect(live.height).toBe(DEFAULT_STICKY_NOTE_SIZE);
    expect(live.baseHeight).toBe(DEFAULT_STICKY_NOTE_SIZE);
    expect(h.state.editingTextRegion).toBe(null);
    expect(getTextElements()).toHaveLength(0);
  });

  it("Escape 取消编辑时正文与几何都不变", async () => {
    const note = createStickyNote();
    API.setElements([note]);
    API.setSelectedElements([note]);

    startEditing(note);
    await submitText("初始正文");

    const before = getLiveNote(note.id);
    const heightBefore = before.height;
    const versionBefore = before.version;

    startEditing(before);
    await enterText("不会提交的正文");

    const live = getLiveNote(note.id);
    expect(live.texts?.body?.text).toBe("初始正文");
    expect(live.height).toBe(heightBefore);
    expect(live.version).toBe(versionBefore);
    expect(h.state.editingTextRegion).toBe(null);
    expect(getTextElements()).toHaveLength(0);
  });

  it("便签正文的默认颜色跟随便签 ink", async () => {
    const note = createStickyNote();
    API.setElements([note]);
    API.setSelectedElements([note]);

    startEditing(note);
    await submitText("跟随 ink");

    const live = getLiveNote(note.id);
    expect(live.texts!.body!.style.color).toBeUndefined();
    expect(getLocalTextRegionLayout(live, "body")!.color).toBe(
      live.strokeColor,
    );

    const RED = COLOR_PALETTE.red[4];
    act(() => {
      h.app.scene.mutateElement(getLiveNote(note.id), { strokeColor: RED });
    });
    expect(getLocalTextRegionLayout(getLiveNote(note.id), "body")!.color).toBe(
      RED,
    );
  });

  it("旋转后的便签提交正文也不产生文字元素", async () => {
    const note = createStickyNote({ angle: Math.PI / 6 });
    API.setElements([note]);
    API.setSelectedElements([note]);

    startEditing(note);
    await submitText("旋转便签中的正文");

    const live = getLiveNote(note.id);
    expect(live.texts?.body?.text).toBe("旋转便签中的正文");
    expect(getTextElements()).toHaveLength(0);
    expect(live.angle).toBe(note.angle);
    expect(h.state.editingTextRegion).toBe(null);
  });

  it("骨架 label 写入 texts.body，不产生文字元素，高度按 fit", () => {
    const note = createNoteFromSkeleton("骨架正文");
    expect(note.texts?.body?.text).toBe("骨架正文");
    expect(note.boundElements).toBe(null);
    expect(note.texts?.body?.style.textAlign).toBe("center");
    expect(note.texts?.body?.style.verticalAlign).toBe("middle");
    expect(note.height).toBe(note.baseHeight);

    const tall = createNoteFromSkeleton(longText, 28);
    expect(tall.texts?.body?.text).toBe(longText);
    expect(tall.baseHeight).toBe(DEFAULT_STICKY_NOTE_SIZE);
    expect(tall.height).toBeGreaterThan(tall.baseHeight);
  });

  it("改字号写入 texts.body 并按 fit 重新求解高度", () => {
    const note = createNoteFromSkeleton("hello", 20);
    API.setElements([note]);
    API.setSelectedElements([note]);

    act(() => {
      h.app.actionManager.executeAction(actionChangeFontSize, "ui", 40);
    });

    const live = getLiveNote(note.id);
    expect(live.texts?.body?.style.fontSize).toBe(40);
    expect(getLocalTextRegionLayout(live, "body")!.fontSize).toBe(40);
    // 短文本放得下：高度回到 baseHeight
    expect(live.height).toBe(live.baseHeight);
    expect(getTextElements()).toHaveLength(0);
  });

  it("restore 保留 texts.body 与 fit 高度，并丢弃正文颜色", () => {
    const note = createNoteFromSkeleton(longText, 28);
    expect(note.height).toBeGreaterThan(note.baseHeight);

    const persisted = JSON.parse(JSON.stringify(note));
    persisted.texts.body.style.color = COLOR_PALETTE.red[4];
    persisted.texts.body.style.fontSize = 1e20;

    const restored = restore.restoreElements([persisted], null, {
      refreshDimensions: true,
    })[0] as ExcalidrawStickyNoteElement;

    expect(restored.texts?.body?.text).toBe(note.texts?.body?.text);
    expect(restored.texts?.body?.style.color).toBeUndefined();
    expect(restored.texts?.body?.style.fontSize).toBe(
      STICKY_NOTE_MAX_FONT_SIZE,
    );
    expect(restored.baseHeight).toBe(note.baseHeight);
    expect(restored.height).toBeCloseTo(note.height);
  });
});
