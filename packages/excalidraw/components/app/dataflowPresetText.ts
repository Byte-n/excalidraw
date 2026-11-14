import {
  COLOR_PALETTE,
  DEFAULT_NEW_ELEMENT_STROKE_COLOR,
  TEXT_ALIGN,
  VERTICAL_ALIGN,
  getFontString,
  getLineHeight,
} from "@excalidraw/common";

import {
  computeBoundTextPosition,
  getBoundTextMaxWidth,
  getDataflowProcessTitleLayout,
  isDataflowShapeId,
  measureText,
  newTextElement,
  wrapText,
} from "@excalidraw/element";

import type {
  DataflowShapeId,
  ExcalidrawShapeElement,
  ExcalidrawTextElement,
  ExcalidrawTextElementWithContainer,
  NonDeleted,
  TextContainerSlot,
} from "@excalidraw/element/types";

import { t } from "../../i18n";

import type App from "../App";

/**
 * 数据流图预设自带的文案（对照 `docs/lark-exmples/data-flow/exported.pdf`）：
 * 外部实体与数据存储是主文本；`df-process` 的标题栏与正文是两个槽位；两种
 * 处理（圆角/圆形）的正文是「编号 + 数据处理」两行。
 *
 * 字号固定 13 而不是跟随当前文字字号：样本里文本相对图形的高度约 17%，用默认
 * 20 会让 `df-process-circle` 的「数据处理」折成三行并撑出安全区。13 与表格
 * 单元格背景文字同档，圆形安全区（≈53.7）刚好容得下一行四个汉字（52）。
 */
const DATAFLOW_PRESET_TEXT_FONT_SIZE = 13;

type PresetTextSpec = {
  text: string;
  slot?: TextContainerSlot;
};

/**
 * 按图形取预设文本。文案走 i18n 且**按调用时求值**——语言可以在会话中切换，
 * 模块级常量会把当时的语言冻住（同 `getMindmapPresetTree`）。
 */
const getDataflowPresetTextSpecs = (
  shapeId: DataflowShapeId,
): readonly PresetTextSpec[] => {
  switch (shapeId) {
    case "df-external-entity":
      return [{ text: t("dataflowPreset.externalEntity") }];
    case "df-process":
      return [
        // 样本标题栏里的编号文案就是这两段相邻的 "1.0"
        { text: "1.01.0", slot: "title" },
        { text: t("dataflowPreset.process") },
      ];
    case "df-process-round":
    case "df-process-circle":
      return [{ text: `1.0\n${t("dataflowPreset.process")}` }];
    case "df-store-open":
    case "df-store-left-label":
    case "df-store-plain":
      return [{ text: t("dataflowPreset.dataStore") }];
  }
};

export type DataflowPresetTextApp = Pick<App, "state">;

/**
 * 给数据流图形装配预设文本：**只造元素，不入场景**。文本按容器槽位的安全区
 * 排版（`computeBoundTextPosition`），并回写到容器的 `boundElements`，之后
 * 双击、移动、缩放走的都是普通绑定文本那一套。
 *
 * `identity` 供离屏预览传固定身份（见 `CreationIdentity`）；每个文本都取一次，
 * 漏一个就会推进共享的 id / 随机序列。
 */
export const attachDataflowPresetTexts = <
  TElement extends ExcalidrawShapeElement,
>(
  app: DataflowPresetTextApp,
  container: NonDeleted<TElement>,
  identity: (index: number) => { id?: string; seed?: number } = () => ({}),
): {
  container: NonDeleted<TElement>;
  texts: NonDeleted<ExcalidrawTextElement>[];
} => {
  if (!isDataflowShapeId(container.shape.id)) {
    return { container, texts: [] };
  }

  const fontFamily = app.state.currentItemFontFamily;
  const lineHeight = getLineHeight(fontFamily);
  const elementsMap = new Map([[container.id, container]]);

  const texts = getDataflowPresetTextSpecs(container.shape.id).map(
    (spec, index) => {
      let text = newTextElement({
        x: 0,
        y: 0,
        strokeColor: DEFAULT_NEW_ELEMENT_STROKE_COLOR,
        backgroundColor: COLOR_PALETTE.transparent,
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        opacity: 100,
        locked: false,
        text: spec.text,
        fontSize: DATAFLOW_PRESET_TEXT_FONT_SIZE,
        fontFamily,
        lineHeight,
        textAlign: TEXT_ALIGN.CENTER,
        verticalAlign: VERTICAL_ALIGN.MIDDLE,
        containerId: container.id,
        containerSlot: spec.slot,
        autoResize: spec.slot === "title" ? false : undefined,
        angle: container.angle,
        groupIds: container.groupIds,
        ...identity(index),
      });

      if (spec.slot === "title") {
        const layout = getDataflowProcessTitleLayout(container, text);
        text = {
          ...text,
          text: layout.text,
          width: layout.width,
          height: layout.height,
        };
      } else {
        const font = getFontString(text);
        const wrapped = wrapText(
          text.originalText,
          font,
          getBoundTextMaxWidth(container, text),
        );
        const metrics = measureText(wrapped, font, lineHeight);
        text = {
          ...text,
          text: wrapped,
          width: metrics.width,
          height: metrics.height,
        };
      }

      const { x, y } = computeBoundTextPosition(
        container,
        text as ExcalidrawTextElementWithContainer,
        elementsMap,
      );
      return { ...text, x, y };
    },
  );

  return {
    container: {
      ...container,
      boundElements: [
        ...(container.boundElements ?? []),
        ...texts.map((text) => ({
          type: "text" as const,
          id: text.id,
          ...(text.containerSlot ? { slot: text.containerSlot } : {}),
        })),
      ],
    } as NonDeleted<TElement>,
    texts,
  };
};
