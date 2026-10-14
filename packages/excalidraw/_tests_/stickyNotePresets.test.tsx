import { COLOR_PALETTE, DEFAULT_STICKY_NOTE_BG } from "@excalidraw/common";
import { STICKY_NOTE_PRESETS } from "@excalidraw/element";

import type { ExcalidrawStickyNoteElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { act, fireEvent, render, screen, waitFor } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

const preset = (id: string) => {
  const found = STICKY_NOTE_PRESETS.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`Missing sticky note preset: ${id}`);
  }
  return found;
};

const openPresets = () => {
  fireEvent.click(screen.getByTestId("toolbar-stickynote"));
};

const presetOptions = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      // 弹层选项沿用「toolbar-<选项标识>」的既有约定（同 toolbar-cross），
      // 触发按钮不在 .tool-popover-content 里，不会混进来
      ".tool-popover-content [data-testid^='toolbar-']",
    ),
  );

/** 缩略图上的纸色（纸面填充）与墨色（边框与文字） */
const swatchOf = (button: HTMLElement) => ({
  paper: button.querySelector("rect")?.getAttribute("fill"),
  ink: button.querySelector("svg")?.getAttribute("stroke"),
});

const liveNotes = () =>
  h.elements.filter(
    (element) => element.type === "stickynote" && !element.isDeleted,
  ) as ExcalidrawStickyNoteElement[];

describe("便签预设样式弹层", () => {
  it("列出六条内置预设，每条一张自己的纸墨缩略图", async () => {
    await render(<Excalidraw />);
    openPresets();

    const options = await waitFor(() => {
      const found = presetOptions();
      expect(found).toHaveLength(STICKY_NOTE_PRESETS.length);
      return found;
    });

    expect(options.map((option) => option.dataset.testid)).toEqual(
      ["yellow", "green", "blue", "pink", "violet", "gray"].map(
        (id) => `toolbar-${id}`,
      ),
    );
    expect(options.map((option) => swatchOf(option))).toEqual(
      STICKY_NOTE_PRESETS.map((candidate) => ({
        paper: candidate.backgroundColor,
        ink: candidate.strokeColor,
      })),
    );
  });

  it("触发按钮回显当前生效样式，默认状态即黄纸预设", async () => {
    await render(<Excalidraw />);
    act(() => h.app.setActiveTool({ type: "stickynote" }));

    const trigger = screen.getByTestId("toolbar-stickynote");
    expect(trigger).toHaveAttribute("aria-pressed", "true");
    // 默认 currentItem 的墨停在通用墨色上，缩略图显示的是新建时真正会用的
    // 深棕墨，而不是原文值
    expect(swatchOf(trigger)).toEqual({
      paper: DEFAULT_STICKY_NOTE_BG,
      ink: preset("yellow").strokeColor,
    });

    openPresets();
    await waitFor(() => screen.getByTestId("toolbar-yellow"));
    expect(screen.getByTestId("toolbar-yellow")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("toolbar-blue")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("在弹层里选一条预设：新建便签用该纸色与墨色，已有便签不动", async () => {
    await render(<Excalidraw />);
    const existing = API.createElement({
      type: "stickynote",
      id: "existing",
      x: 600,
      y: 600,
      width: 250,
      height: 250,
      baseHeight: 250,
      backgroundColor: DEFAULT_STICKY_NOTE_BG,
      strokeColor: preset("yellow").strokeColor,
    });
    API.setElements([existing]);

    openPresets();
    fireEvent.click(await waitFor(() => screen.getByTestId("toolbar-blue")));

    expect(h.state.currentItemStickynoteBackgroundColor).toBe(
      preset("blue").backgroundColor,
    );
    expect(h.state.currentItemStickynoteStrokeColor).toBe(
      preset("blue").strokeColor,
    );

    mouse.downAt(100, 100);
    mouse.up();

    const created = liveNotes().find((note) => note.id !== existing.id);
    expect(created).toMatchObject({
      backgroundColor: preset("blue").backgroundColor,
      strokeColor: preset("blue").strokeColor,
    });
    // 画布上已有的便签保持原样
    expect(
      h.elements.find((element) => element.id === existing.id),
    ).toMatchObject({
      backgroundColor: DEFAULT_STICKY_NOTE_BG,
      strokeColor: preset("yellow").strokeColor,
    });
  });

  it("墨色被单独改过时：触发按钮显示当前生效样式，弹层里没有选项高亮", async () => {
    await render(<Excalidraw />);
    const redInk = COLOR_PALETTE.red[4];
    act(() => {
      API.setAppState({
        currentItemStickynoteBackgroundColor: preset("blue").backgroundColor,
        currentItemStickynoteStrokeColor: redInk,
      });
      h.app.setActiveTool({ type: "stickynote" });
    });

    expect(swatchOf(screen.getByTestId("toolbar-stickynote"))).toEqual({
      paper: preset("blue").backgroundColor,
      ink: redInk,
    });

    openPresets();
    const options = await waitFor(() => {
      const found = presetOptions();
      expect(found).toHaveLength(STICKY_NOTE_PRESETS.length);
      return found;
    });
    expect(
      options.every(
        (option) => option.getAttribute("aria-pressed") === "false",
      ),
    ).toBe(true);
  });

  it("按下触发按钮仍可拖出便签，拖出的预览用当前预设", async () => {
    await render(<Excalidraw />);
    const pointer = { pointerId: 1, pointerType: "mouse", isPrimary: true };

    fireEvent.pointerDown(screen.getByTestId("toolbar-stickynote"), {
      ...pointer,
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, {
      ...pointer,
      clientX: 300,
      clientY: 260,
    });

    expect(h.app.toolDrag.preview).toMatchObject({
      type: "stickynote",
      backgroundColor: DEFAULT_STICKY_NOTE_BG,
      strokeColor: preset("yellow").strokeColor,
    });

    act(() => h.app.toolDrag.cancel());
  });
});
