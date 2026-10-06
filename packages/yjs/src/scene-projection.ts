import type { ExcalidrawSceneElement } from "./excalidraw-scene-types";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** canonical 顺序仅取决于合法索引与 ID，不使用版本或时间。 */
export function orderExcalidrawSceneElements<
  TElement extends ExcalidrawSceneElement,
>(elements: readonly TElement[]): TElement[] {
  return [...elements].sort(
    (a, b) => compare(a.index, b.index) || compare(a.id, b.id),
  );
}

/**
 * 只读显示适配：先解除失效父关系，再按 ID 选择唯一文字，最后断开环的最大 ID 边。
 * vendor 容器成员坐标为场景坐标，解除关系时保留 x/y/angle 和全部文本。
 * 返回深拷贝，包括墓碑；任何显示修复均不得写回共享文档。
 */
export function projectExcalidrawDisplayElements<
  TElement extends ExcalidrawSceneElement,
>(input: readonly TElement[]): TElement[] {
  const elements = orderExcalidrawSceneElements(input).map((element) =>
    structuredClone(element),
  );
  const byId = new Map(elements.map((element) => [element.id, element]));
  const detach = (element: ExcalidrawSceneElement): void => {
    delete element.containerRef;
  };
  for (const element of elements) {
    const ref = element.containerRef;
    if (!ref) {
      continue;
    }
    const parent = byId.get(ref.elementId);
    let valid =
      !!parent &&
      !parent.isDeleted &&
      !(element.type === "text" && element.containerId);
    if (ref.kind === "frameLike") {
      valid =
        valid &&
        !!parent &&
        ["frame", "magicframe"].includes(parent.type) &&
        !["frame", "magicframe"].includes(element.type);
    } else if (ref.kind === "tableTitle") {
      valid = valid && parent?.type === "table" && element.type === "text";
    } else {
      const table = parent?.table;
      valid =
        valid &&
        parent?.type === "table" &&
        !!table &&
        typeof table === "object" &&
        !Array.isArray(table) &&
        Array.isArray(table.cells) &&
        table.cells.some(
          (cell) =>
            !!cell &&
            typeof cell === "object" &&
            !Array.isArray(cell) &&
            cell.id === ref.cellId,
        ) &&
        (ref.role !== "backgroundText" || element.type === "text");
    }
    if (!valid) {
      detach(element);
    }
  }
  const occupied = new Set<string>();
  for (const element of [...elements].sort((a, b) => compare(a.id, b.id))) {
    const ref = element.containerRef;
    if (
      element.isDeleted ||
      !ref ||
      (ref.kind !== "tableTitle" &&
        !(ref.kind === "tableCell" && ref.role === "backgroundText"))
    ) {
      continue;
    }
    const slot = JSON.stringify(
      ref.kind === "tableTitle"
        ? ["title", ref.elementId]
        : ["cell", ref.elementId, ref.cellId],
    );
    if (occupied.has(slot)) {
      detach(element);
    } else {
      occupied.add(slot);
    }
  }
  for (const start of [...elements].sort((a, b) => compare(a.id, b.id))) {
    const path: TElement[] = [];
    const visited = new Map<string, number>();
    let current: TElement | undefined = start;
    while (current) {
      const previous = visited.get(current.id);
      if (previous !== undefined) {
        const cycle = path.slice(previous).sort((a, b) => compare(a.id, b.id));
        detach(cycle[cycle.length - 1]!);
        break;
      }
      visited.set(current.id, path.length);
      path.push(current);
      current = current.containerRef
        ? byId.get(current.containerRef.elementId)
        : undefined;
    }
  }
  // 重复合法索引仅在显示副本中适配，反向映射必须保留 canonical index。
  if (
    elements.some(
      (element, index) =>
        index > 0 && element.index === elements[index - 1]!.index,
    )
  ) {
    const digits =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    elements.forEach((element, index) => {
      element.index = `c${digits[Math.floor(index / (62 * 62))]}${
        digits[Math.floor(index / 62) % 62]
      }${digits[index % 62]}`;
    });
  }
  return elements;
}
