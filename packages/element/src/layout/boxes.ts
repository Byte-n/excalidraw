import { updateBoundElements } from "../binding";
import { getCommonBounds } from "../bounds";
import { createCalculationScene } from "../sceneOperations";
import { isLinearElement } from "../typeChecks";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "../types";

import type {
  LayoutBounds,
  LayoutOptions,
  LayoutPosition,
  LayoutWarning,
} from "./types";

/** 元素顺序：先 `index`，再 `id`；两侧都没有 index 时按 id。 */
export const compareLayoutElements = (
  left: ExcalidrawElement,
  right: ExcalidrawElement,
): number => {
  const leftIndex = left.index ?? "";
  const rightIndex = right.index ?? "";
  if (leftIndex !== rightIndex) {
    return leftIndex < rightIndex ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
};

export const sortLayoutElements = (
  elements: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] => [...elements].sort(compareLayoutElements);

const toLayoutBounds = (
  bounds: readonly [number, number, number, number],
): LayoutBounds => ({
  x: bounds[0],
  y: bounds[1],
  width: bounds[2] - bounds[0],
  height: bounds[3] - bounds[1],
});

export const getLayoutBounds = (
  elements: readonly ExcalidrawElement[],
): LayoutBounds => toLayoutBounds(getCommonBounds(elements));

/** 选中元素的包围盒左上角，作为未显式给 origin 时的默认起点。 */
export const getLayoutOrigin = (
  elements: readonly ExcalidrawElement[],
): LayoutPosition => {
  const bounds = getCommonBounds(elements);
  return { x: bounds[0], y: bounds[1] };
};

const geometrySignature = (element: ExcalidrawElement): string =>
  JSON.stringify([
    element.x,
    element.y,
    element.width,
    element.height,
    element.angle,
    isLinearElement(element) ? element.points : null,
  ]);

const sameGeometry = (
  left: ExcalidrawElement,
  right: ExcalidrawElement,
): boolean => geometrySignature(left) === geometrySignature(right);

/**
 * 落盘几何：在计算场景里批量移动节点，再让绑定连线跟随；返回输入中
 * 未变化元素的原始对象，尽量保持身份。
 */
export const applyLayoutPositions = (
  elements: readonly ExcalidrawElement[],
  positions: ReadonlyMap<string, LayoutPosition>,
  warnings: readonly LayoutWarning[],
): {
  elements: readonly ExcalidrawElement[];
  bounds: LayoutBounds;
  affectedElementIds: readonly string[];
} => {
  const scene = createCalculationScene(elements);
  try {
    const sceneMap = scene.getNonDeletedElementsMap();
    const moved: NonDeletedExcalidrawElement[] = [];
    for (const [id, position] of positions) {
      const element = sceneMap.get(id);
      if (!element || (element.x === position.x && element.y === position.y)) {
        continue;
      }
      scene.mutateElement(element, { x: position.x, y: position.y });
      moved.push(element);
    }
    for (const element of moved) {
      updateBoundElements(element, scene, { simultaneouslyUpdated: moved });
    }

    const inputById = new Map(elements.map((element) => [element.id, element]));
    const affected = new Set<string>();
    const nextElements = scene.getElementsIncludingDeleted().map((element) => {
      const previous = inputById.get(element.id);
      if (!previous) {
        affected.add(element.id);
        return element;
      }
      if (!sameGeometry(previous, element)) {
        affected.add(element.id);
        return element;
      }
      return previous;
    });

    return {
      elements: nextElements,
      bounds: getLayoutBounds(
        nextElements.filter(
          (element) => affected.has(element.id) && !element.isDeleted,
        ),
      ),
      affectedElementIds: [...affected],
    };
  } finally {
    scene.destroy();
  }
};

/** grid：按行优先排列，列宽取该列最大宽度、行高取该行最大高度。 */
export const computeGridPositions = (
  elements: readonly ExcalidrawElement[],
  origin: LayoutPosition,
  options: LayoutOptions,
  warnings: LayoutWarning[],
): Map<string, LayoutPosition> => {
  const ordered = sortLayoutElements(elements);
  const gap = options.gap ?? 24;
  const fallbackColumns = Math.ceil(Math.sqrt(ordered.length));
  const requested = options.columns;
  let columns = fallbackColumns;
  if (requested !== undefined) {
    if (!Number.isInteger(requested) || requested < 1) {
      warnings.push({
        code: "layout_option_corrected",
        message: "grid 的 columns 必须是正整数，已使用默认值",
        path: "options.columns",
      });
    } else {
      columns = requested;
    }
  }

  const rows = Math.ceil(ordered.length / columns);
  const columnWidths = new Array<number>(columns).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  ordered.forEach((element, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], element.width);
    rowHeights[row] = Math.max(rowHeights[row], element.height);
  });

  const columnOffsets: number[] = [];
  let x = origin.x;
  for (let column = 0; column < columns; column++) {
    columnOffsets.push(x);
    x += columnWidths[column] + gap;
  }
  const rowOffsets: number[] = [];
  let y = origin.y;
  for (let row = 0; row < rows; row++) {
    rowOffsets.push(y);
    y += rowHeights[row] + gap;
  }

  const positions = new Map<string, LayoutPosition>();
  ordered.forEach((element, index) => {
    positions.set(element.id, {
      x: columnOffsets[index % columns],
      y: rowOffsets[Math.floor(index / columns)],
    });
  });
  return positions;
};

export const computeRowPositions = (
  elements: readonly ExcalidrawElement[],
  origin: LayoutPosition,
  options: LayoutOptions,
): Map<string, LayoutPosition> => {
  const gap = options.gap ?? 24;
  const positions = new Map<string, LayoutPosition>();
  let x = origin.x;
  for (const element of sortLayoutElements(elements)) {
    positions.set(element.id, { x, y: origin.y });
    x += element.width + gap;
  }
  return positions;
};

export const computeColumnPositions = (
  elements: readonly ExcalidrawElement[],
  origin: LayoutPosition,
  options: LayoutOptions,
): Map<string, LayoutPosition> => {
  const gap = options.gap ?? 24;
  const positions = new Map<string, LayoutPosition>();
  let y = origin.y;
  for (const element of sortLayoutElements(elements)) {
    positions.set(element.id, { x: origin.x, y });
    y += element.height + gap;
  }
  return positions;
};

/** stack：左上角对齐，按顺序纵向堆叠，宽高保持不变。 */
export const computeStackPositions = (
  elements: readonly ExcalidrawElement[],
  origin: LayoutPosition,
  options: LayoutOptions,
): Map<string, LayoutPosition> => {
  const gap = options.gap ?? 24;
  const positions = new Map<string, LayoutPosition>();
  let y = origin.y;
  for (const element of sortLayoutElements(elements)) {
    positions.set(element.id, { x: origin.x, y });
    y += element.height + gap;
  }
  return positions;
};

export const computeAlignPositions = (
  elements: readonly ExcalidrawElement[],
  options: LayoutOptions,
): Map<string, LayoutPosition> => {
  const bounds = getCommonBounds(elements);
  const axis = options.axis ?? "x";
  const position = options.position ?? "center";
  const positions = new Map<string, LayoutPosition>();
  for (const element of elements) {
    if (axis === "x") {
      const x =
        position === "start"
          ? bounds[0]
          : position === "end"
          ? bounds[2] - element.width
          : bounds[0] + (bounds[2] - bounds[0]) / 2 - element.width / 2;
      positions.set(element.id, { x, y: element.y });
    } else {
      const y =
        position === "start"
          ? bounds[1]
          : position === "end"
          ? bounds[3] - element.height
          : bounds[1] + (bounds[3] - bounds[1]) / 2 - element.height / 2;
      positions.set(element.id, { x: element.x, y });
    }
  }
  return positions;
};

/** distribute：按中心排序后等距分布，首尾保持不动。 */
export const computeDistributePositions = (
  elements: readonly ExcalidrawElement[],
  options: LayoutOptions,
): Map<string, LayoutPosition> => {
  const axis = options.axis ?? "x";
  const sizeOf = (element: ExcalidrawElement) =>
    axis === "x" ? element.width : element.height;
  const startOf = (element: ExcalidrawElement) =>
    axis === "x" ? element.x : element.y;
  const ordered = [...elements].sort(
    (left, right) =>
      startOf(left) + sizeOf(left) / 2 - (startOf(right) + sizeOf(right) / 2),
  );
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const firstCenter = startOf(first) + sizeOf(first) / 2;
  const lastCenter = startOf(last) + sizeOf(last) / 2;
  const step = (lastCenter - firstCenter) / (ordered.length - 1);

  const positions = new Map<string, LayoutPosition>();
  ordered.forEach((element, index) => {
    if (index === 0 || index === ordered.length - 1) {
      positions.set(element.id, { x: element.x, y: element.y });
      return;
    }
    const center = firstCenter + step * index;
    const start = center - sizeOf(element) / 2;
    positions.set(
      element.id,
      axis === "x"
        ? { x: start, y: element.y }
        : { x: element.x, y: start },
    );
  });
  return positions;
};

/** 供 tree 使用的几何差异判断。 */
export const elementGeometryChanged = (
  before: ExcalidrawElement | undefined,
  after: ExcalidrawElement,
): boolean => !before || !sameGeometry(before, after);

/** 供 tree 使用的场景无关批量平移。 */
export const translateLayoutElements = (
  elements: readonly ExcalidrawElement[],
  ids: ReadonlySet<string>,
  delta: LayoutPosition,
): readonly ExcalidrawElement[] =>
  elements.map((element) =>
    ids.has(element.id) && !element.isDeleted
      ? { ...element, x: element.x + delta.x, y: element.y + delta.y }
      : element,
  );
