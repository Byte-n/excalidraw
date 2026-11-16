import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  TABLE_CELL_TEXT_PADDING_X,
  TABLE_CELL_TEXT_PADDING_Y,
  getFontString,
  getLineHeight,
} from "@excalidraw/common";

import { measureText } from "../textMeasurements";
import { getTextBlock, withTextBlock } from "../text/ops";
import { textRegionKey } from "../text/keys";
import { wrapText } from "../textWrapping";

import {
  fitSequenceFragmentOperator,
  getSequenceFragmentRowBounds,
  getSequenceFragmentRowLayout,
  isSequenceFragmentElement,
} from "./sequenceOutline";

import type { Scene } from "../Scene";
import type {
  ExcalidrawElement,
  ExcalidrawSequenceElement,
  SequenceShapeData,
} from "../types";
import type { TextBlock, TextBlockStyle } from "../text/types";

/** 已收窄到 `sc-fragment` 的 sequence 元素。 */
type SequenceFragmentElement = ExcalidrawElement &
  ExcalidrawSequenceElement & {
    shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
  };

/**
 * Scene-level behavior of a fragment row's body text: the fragment is a
 * single-column table, so every body row is a cell whose text wraps against the
 * row width and grows the row when it needs more height. The header row (the
 * operator tab) never carries body text.
 */

/** operator 页签没有文本时使用的样式（仅用于测量，不写入元素）。 */
const EMPTY_OPERATOR_STYLE: TextBlockStyle = {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
  lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
  textAlign: "left",
  verticalAlign: "top",
};

/** 行文本可用宽度：与区域定义一致，扣掉左右内边距。 */
const getRowTextWidth = (rowWidth: number) =>
  Math.max(rowWidth - TABLE_CELL_TEXT_PADDING_X * 2, 1);

/** 一行文本块换行后的高度，加上上下内边距后的行需求高度。 */
export const getSequenceFragmentRowTextRequiredHeight = (
  block: TextBlock,
  rowWidth: number,
): number => {
  const font = getFontString({
    fontSize: block.style.fontSize,
    fontFamily: block.style.fontFamily,
    fontWeight: block.style.fontWeight,
  });
  const wrapped = wrapText(block.text, font, getRowTextWidth(rowWidth));
  return (
    measureText(wrapped, font, block.style.lineHeight).height +
    TABLE_CELL_TEXT_PADDING_Y * 2
  );
};

/** 片段的行文本 key（表头行不参与）。 */
const getFragmentRowKeys = (
  fragment: SequenceFragmentElement,
  rowIds?: readonly string[],
): Array<{ rowId: string; key: ReturnType<typeof textRegionKey.row> }> => {
  const rows = fragment.shape.fragment?.rows?.length
    ? getSequenceFragmentRowLayout(fragment.height, fragment.shape.fragment)
        .rows
    : [];
  return rows
    .slice(1)
    .filter((row) => !rowIds || rowIds.includes(row.id))
    .map((row) => ({ rowId: row.id, key: textRegionKey.row(row.id) }));
};

/**
 * 把 operator 页签文本块折算成页签的适配结果：宽度/表头行高由文本块的
 * 样式测量得出，不依赖文字元素。
 */
export const getSequenceFragmentOperatorTextFit = (
  fragment: ExcalidrawElement,
  block?: TextBlock,
) => {
  if (!isSequenceFragmentElement(fragment)) {
    return null;
  }
  const style = block?.style ?? EMPTY_OPERATOR_STYLE;
  return fitSequenceFragmentOperator(fragment, {
    text: block?.text ?? "",
    style,
  });
};

/**
 * 按 `texts.body` 适配 operator 页签：先更新页签宽度与表头行高，再让下方行
 * 跟随新的边界。旋转片段的顶部补偿与行增长保持一致。
 */
export const fitSequenceFragmentOperatorFromTexts = (
  scene: Scene,
  fragment: ExcalidrawElement,
): boolean => {
  if (!isSequenceFragmentElement(fragment)) {
    return false;
  }
  const fit = getSequenceFragmentOperatorTextFit(
    fragment,
    getTextBlock(fragment.texts, "body"),
  );
  if (!fit) {
    return false;
  }
  const heightDelta = fit.height - fragment.height;
  const operatorWidthChanged =
    fit.shape.fragment?.operatorWidth !==
    fragment.shape.fragment?.operatorWidth;
  if (Math.abs(heightDelta) <= 1e-6 && !operatorWidthChanged) {
    return false;
  }
  const angle = fragment.angle ?? 0;
  scene.mutateElement(
    fragment,
    {
      height: fit.height,
      shape: fit.shape,
      // 盒子从局部顶边向下增长；旋转时补偿 x/y 让视觉左上角保持不动
      ...(heightDelta !== 0 && angle
        ? {
            x: fragment.x + (Math.sin(angle) * heightDelta) / 2,
            y: fragment.y + ((Math.cos(angle) - 1) * heightDelta) / 2,
          }
        : {}),
    },
    { informMutation: false, isDragging: true },
  );
  return true;
};

export type SequenceFragmentRowTextRefitOptions = {
  /** 只处理这些行的文本（默认全部正文行）。 */
  rowIds?: readonly string[];
  /** 文本放不下时撑高行（默认 true）。 */
  grow?: boolean;
  /** 测量前把文本块字号乘以该系数（多选等比缩放）。 */
  fontScale?: number;
};

/**
 * 按 `texts` 中的行文本块计算每一行的需求高度并撑高行；元素高度随行高增长，
 * 以维持 `sum(rows.height) === element.height`。`fontScale` 会把字号写回文本块
 * （不低于 `MIN_FONT_SIZE`）后再测量。
 */
export const refitSequenceFragmentRowBackgroundTexts = (
  scene: Scene,
  fragment: ExcalidrawElement,
  opts: SequenceFragmentRowTextRefitOptions = {},
): boolean => {
  if (!isSequenceFragmentElement(fragment)) {
    return false;
  }
  const grow = opts.grow ?? true;
  let didChange = false;
  let live = scene.getNonDeletedElement(fragment.id);
  if (!live || !isSequenceFragmentElement(live)) {
    return false;
  }
  const rowKeys = getFragmentRowKeys(live, opts.rowIds);
  if (!rowKeys.length) {
    return false;
  }

  if (opts.fontScale !== undefined && opts.fontScale !== 1) {
    let texts = live.texts;
    let scaled = false;
    for (const { key } of rowKeys) {
      const block = getTextBlock(texts, key);
      if (!block) {
        continue;
      }
      const fontSize = Math.max(
        MIN_FONT_SIZE,
        block.style.fontSize * opts.fontScale,
      );
      if (fontSize === block.style.fontSize) {
        continue;
      }
      texts = withTextBlock(texts, key, {
        ...block,
        style: { ...block.style, fontSize },
      });
      scaled = true;
    }
    if (scaled) {
      scene.mutateElement(
        live,
        { texts },
        { informMutation: false, isDragging: true },
      );
      didChange = true;
      live = scene.getNonDeletedElement(live.id)!;
      if (!live || !isSequenceFragmentElement(live)) {
        return didChange;
      }
    }
  }

  if (!grow) {
    return didChange;
  }

  const requiredHeights = new Map<string, number>();
  for (const { rowId, key } of rowKeys) {
    const block = getTextBlock(live.texts, key);
    if (!block) {
      continue;
    }
    const bounds = getSequenceFragmentRowBounds(
      live.width,
      live.height,
      live.shape.fragment,
      rowId,
    );
    if (!bounds) {
      continue;
    }
    requiredHeights.set(
      rowId,
      Math.max(
        requiredHeights.get(rowId) ?? 0,
        getSequenceFragmentRowTextRequiredHeight(block, bounds.width),
      ),
    );
  }

  const rows = live.shape.fragment?.rows ?? [];
  let heightDelta = 0;
  const nextRows = rows.map((row) => {
    const requiredHeight = requiredHeights.get(row.id);
    if (requiredHeight === undefined || requiredHeight <= row.height) {
      return row;
    }
    heightDelta += requiredHeight - row.height;
    return { ...row, height: requiredHeight };
  });
  if (heightDelta > 0) {
    const angle = live.angle ?? 0;
    scene.mutateElement(
      live,
      {
        height: live.height + heightDelta,
        shape: {
          ...live.shape,
          fragment: { ...live.shape.fragment, rows: nextRows },
        },
        // 盒子从局部顶边向下增长；旋转时补偿 x/y 让视觉左上角保持不动
        ...(angle
          ? {
              x: live.x + (Math.sin(angle) * heightDelta) / 2,
              y: live.y + ((Math.cos(angle) - 1) * heightDelta) / 2,
            }
          : {}),
      },
      { informMutation: false, isDragging: true },
    );
    didChange = true;
  }
  return didChange;
};
