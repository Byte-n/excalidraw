import { TEXT_ALIGN, VERTICAL_ALIGN, getLineHeight } from "@excalidraw/common";

import { isDataflowShapeId, withTextBlock } from "@excalidraw/element";

import type { TextBlockStyle } from "@excalidraw/element";
import type {
  DataflowShapeId,
  ExcalidrawShapeElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { t } from "../../i18n";

import type App from "../App";

/**
 * 数据流图预设自带的文案（对照 `docs/lark-exmples/data-flow/exported.pdf`）：
 * 外部实体与数据存储是正文；`df-process` 的标题栏与正文是两个区域；两种
 * 处理（圆角/圆形）的正文是「编号 + 数据处理」两行。
 *
 * 字号固定 13 而不是跟随当前文字字号：样本里文本相对图形的高度约 17%，用默认
 * 20 会让 `df-process-circle` 的「数据处理」折成三行并撑出安全区。13 与表格
 * 单元格背景文字同档，圆形安全区（≈53.7）刚好容得下一行四个汉字（52）。
 */
const DATAFLOW_PRESET_TEXT_FONT_SIZE = 13;

type PresetTextSpec = {
  region: "title" | "body";
  text: string;
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
      return [{ region: "body", text: t("dataflowPreset.externalEntity") }];
    case "df-process":
      return [
        // 样本标题栏里的编号文案就是这两段相邻的 "1.0"
        { region: "title", text: "1.01.0" },
        { region: "body", text: t("dataflowPreset.process") },
      ];
    case "df-process-round":
    case "df-process-circle":
      return [{ region: "body", text: `1.0\n${t("dataflowPreset.process")}` }];
    case "df-store-open":
    case "df-store-left-label":
    case "df-store-plain":
      return [{ region: "body", text: t("dataflowPreset.dataStore") }];
  }
};

export type DataflowPresetTextApp = Pick<App, "state">;

/**
 * 给数据流图形装配预设文本：文本直接写进元素自身的区域，
 * **不造文字元素、不入场景**。`df-process` 写标题与正文，其余图形只写正文。
 */
export const attachDataflowPresetTexts = <
  TElement extends ExcalidrawShapeElement,
>(
  app: DataflowPresetTextApp,
  container: NonDeleted<TElement>,
): NonDeleted<TElement> => {
  if (!isDataflowShapeId(container.shape.id)) {
    return container;
  }

  const fontFamily = app.state.currentItemFontFamily;
  const style: TextBlockStyle = {
    fontFamily,
    fontSize: DATAFLOW_PRESET_TEXT_FONT_SIZE,
    lineHeight: getLineHeight(fontFamily),
    textAlign: TEXT_ALIGN.CENTER,
    verticalAlign: VERTICAL_ALIGN.MIDDLE,
  };

  const texts = getDataflowPresetTextSpecs(container.shape.id).reduce(
    (acc, spec) => withTextBlock(acc, spec.region, { text: spec.text, style }),
    container.texts,
  );

  return texts ? ({ ...container, texts } as NonDeleted<TElement>) : container;
};
