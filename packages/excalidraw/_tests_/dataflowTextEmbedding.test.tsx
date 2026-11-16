import type {
  ExcalidrawShapeElement,
  ExcalidrawTextContainer,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { exportToSvg } from "../scene/export";
import { t } from "../i18n";
import { attachDataflowPresetTexts } from "../components/app/dataflowPresetText";
import {
  applyEmbeddedTextLayout,
  updateEmbeddedTextStyles,
} from "../components/app/textStyleTargets";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { act, render, unmountComponent } from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

unmountComponent();

const PROCESS_SIZE = { width: 152, height: 137 };
/** 标题栏分隔线在 28，取中线 14 作为标题点击位置 */
const TITLE_BAND_Y = 14;
/** 正文安全区从 30 开始，90 是稳定的正文点击位置 */
const BODY_Y = 90;

const createProcess = () =>
  API.createElement({
    type: "df-process",
    x: 100,
    y: 100,
    width: PROCESS_SIZE.width,
    height: PROCESS_SIZE.height,
  }) as unknown as NonDeleted<ExcalidrawShapeElement>;

const liveProcess = (id: string) =>
  h.app.scene.getNonDeletedElement(
    id,
  ) as unknown as NonDeleted<ExcalidrawShapeElement>;

const startEditingAt = (
  element: NonDeleted<ExcalidrawShapeElement>,
  sceneY: number,
) => {
  act(() => {
    h.app.startTextEditing({
      sceneX: element.x + element.width / 2,
      sceneY,
      container: element as unknown as ExcalidrawTextContainer,
    });
  });
};

const doubleClickAndGetEditor = async (
  element: NonDeleted<ExcalidrawShapeElement>,
  sceneY: number,
) => {
  mouse.doubleClickAt(element.x + element.width / 2, sceneY);
  mouse.down();
  const editor = await getTextEditor();
  mouse.up();
  return editor;
};

const submitText = async (text: string) => {
  const editor = await getTextEditor();
  updateTextEditor(editor, text);
  act(() => {
    h.app.textWysiwygSubmitHandler?.();
  });
};

const getTextElements = () =>
  h.elements.filter((element) => !element.isDeleted && element.type === "text");

describe("dataflow text embedding", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    API.setElements([]);
  });

  it("df-process 预设带标题与正文，且不产生文字元素", () => {
    const preset = attachDataflowPresetTexts(h.app, createProcess());

    expect(preset.texts?.title?.text).toBe("1.01.0");
    expect(preset.texts?.title?.style).toMatchObject({
      fontSize: 13,
      textAlign: "center",
      verticalAlign: "middle",
    });
    expect(preset.texts?.body?.text).toBe(t("dataflowPreset.process"));
    expect(preset.texts?.body?.style).toMatchObject({
      fontSize: 13,
      textAlign: "center",
      verticalAlign: "middle",
    });
    expect(preset.boundElements ?? []).toEqual([]);
    expect(getTextElements()).toHaveLength(0);
  });

  it("双击标题栏编辑标题：保持单行且不改变元素尺寸", async () => {
    const process = createProcess();
    API.setElements([process]);

    await doubleClickAndGetEditor(process, process.y + TITLE_BAND_Y);
    expect(h.state.editingTextRegion?.target).toEqual({
      elementId: process.id,
      region: "title",
    });
    expect(h.state.editingTextElement).toBe(null);

    // 双击后编辑器会重建一次，重新取当前挂载的编辑器
    const editor = await getTextEditor();
    const title = "A very long title that must stay on one line";
    updateTextEditor(
      editor,
      `${title}\nsecond line that must be folded into the header`,
    );
    act(() => {
      h.app.textWysiwygSubmitHandler?.();
    });

    const live = liveProcess(process.id);
    expect(live.texts?.title?.text?.startsWith(title)).toBe(true);
    expect(live.texts?.title?.text).not.toContain("\n");
    expect(live.width).toBe(PROCESS_SIZE.width);
    expect(live.height).toBe(PROCESS_SIZE.height);
    expect(getTextElements()).toHaveLength(0);
  });

  it("双击正文编辑正文并 auto-fit 撑高元素，标题保留", async () => {
    const process = createProcess();
    API.setElements([process]);

    startEditingAt(process, process.y + TITLE_BAND_Y);
    await submitText("Title");

    const afterTitle = liveProcess(process.id);
    const heightAfterTitle = afterTitle.height;
    await doubleClickAndGetEditor(afterTitle, process.y + BODY_Y);
    expect(h.state.editingTextRegion?.target.region).toBe("body");

    const body =
      "正文内容需要在数据流处理图形内部自动换行并撑高形状高度".repeat(4);
    await submitText(body);

    const live = liveProcess(process.id);
    expect(live.texts?.title?.text).toBe("Title");
    expect(live.texts?.body?.text).toBe(body);
    expect(live.height).toBeGreaterThan(heightAfterTitle);
    expect(getTextElements()).toHaveLength(0);
  });

  it("清空标题只删除 title，正文保留", async () => {
    const process = createProcess();
    API.setElements([process]);

    startEditingAt(process, process.y + TITLE_BAND_Y);
    await submitText("Title");
    startEditingAt(liveProcess(process.id), process.y + BODY_Y);
    await submitText("Body");
    startEditingAt(liveProcess(process.id), process.y + TITLE_BAND_Y);
    await submitText("");

    const live = liveProcess(process.id);
    expect(live.texts?.title).toBeUndefined();
    expect(live.texts?.body?.text).toBe("Body");
  });

  it("SVG 导出同时渲染标题与正文", async () => {
    const process = createProcess();
    API.setElements([process]);

    startEditingAt(process, process.y + TITLE_BAND_Y);
    await submitText("Header");
    startEditingAt(liveProcess(process.id), process.y + BODY_Y);
    await submitText("Body");

    const svg = await exportToSvg(
      h.app.scene.getNonDeletedElements(),
      {
        exportBackground: false,
        viewBackgroundColor: h.state.viewBackgroundColor,
      },
      null,
    );

    expect(svg.textContent).toContain("Header");
    expect(svg.textContent).toContain("Body");
  });

  it("修改标题字号不改变元素几何", async () => {
    const process = createProcess();
    API.setElements([process]);

    startEditingAt(process, process.y + TITLE_BAND_Y);
    await submitText("Title");

    const before = liveProcess(process.id);
    const size = { width: before.width, height: before.height };

    act(() => {
      updateEmbeddedTextStyles(h.app.scene, [
        {
          elementId: process.id,
          region: "title",
          style: { fontSize: 32 },
        },
      ]);
      applyEmbeddedTextLayout(h.app.scene, process.id, "title");
    });

    const live = liveProcess(process.id);
    expect(live.texts?.title?.style.fontSize).toBe(32);
    expect(live.width).toBe(size.width);
    expect(live.height).toBe(size.height);
  });
});
