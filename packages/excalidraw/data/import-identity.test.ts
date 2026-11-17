import { FONT_FAMILY, getLineHeight } from "@excalidraw/common";

import {
  cellKey,
  getTextBlock,
  isActivationElement,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  isShapeElement,
  isTableElement,
  mergeTableCells,
  newArrowElement,
  newElement,
  newElementWith,
  newFrameElement,
  newImageElement,
  newMindmapEdgeElement,
  newMindmapNodeElement,
  newTableElement,
  textRegionKey,
  withTextBlock,
} from "@excalidraw/element";

import { validateOrderKey } from "@excalidraw/fractional-indexing";

import { pointFrom } from "@excalidraw/math";

import {
  regenerateImportIdentities,
  remapImportedAppState,
} from "./import-identity";

import type {
  TextBlockMap,
  TextBlockStyle,
} from "@excalidraw/element/text/types";
import type {
  ExcalidrawElement,
  FileId,
  FractionalIndex,
} from "@excalidraw/element/types";

const textStyle: TextBlockStyle = {
  fontFamily: FONT_FAMILY.Excalifont,
  fontSize: 13,
  lineHeight: getLineHeight(FONT_FAMILY.Excalifont),
  textAlign: "left",
  verticalAlign: "middle",
};

const setId = <T extends ExcalidrawElement>(element: T, id: string): T => ({
  ...element,
  id,
});

const setIndex = (
  element: ExcalidrawElement,
  index: string,
): ExcalidrawElement => ({ ...element, index: index as FractionalIndex });

const makeActivation = (
  id: string,
  link?: { lifelineId: string; localY: number },
): ExcalidrawElement => {
  const base = newElement({
    type: "sc-activation",
    x: 0,
    y: 100,
    width: 30,
    height: 100,
  });
  if (!isShapeElement(base)) {
    throw new Error("expected a sequence element");
  }
  return {
    ...base,
    id,
    shape: {
      id: "sc-activation",
      schemaVersion: 1,
      ...(link ? { link } : {}),
    },
  } as ExcalidrawElement;
};

const makeTable = () => {
  const table = newTableElement({
    type: "table",
    x: 0,
    y: 0,
    rowCount: 2,
    columnCount: 2,
  });
  const anchorId = table.table.cells[0].id;
  const tableTexts: TextBlockMap | undefined = withTextBlock(
    withTextBlock(undefined, cellKey(anchorId), {
      text: "A1",
      style: textStyle,
    }),
    textRegionKey.row(table.table.rows[0].id),
    { text: "Header", style: textStyle },
  );
  return newElementWith(
    { ...table, id: "table-1" },
    {
      table: mergeTableCells(table.table, anchorId, table.table.cells[1].id),
      texts: tableTexts,
    },
  );
};

describe("regenerateImportIdentities", () => {
  it("rebuilds element and group ids once per batch while keeping order", () => {
    const first = setIndex(
      setId(
        newElement({
          type: "rectangle",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          groupIds: ["group-outer", "group-inner"],
        }),
        "element-first",
      ),
      "a0",
    );
    const second = setIndex(
      setId(
        newElement({
          type: "ellipse",
          x: 20,
          y: 0,
          width: 10,
          height: 10,
          groupIds: ["group-outer", "group-inner"],
        }),
        "element-second",
      ),
      "a1",
    );
    const third = setIndex(
      setId(
        newElement({
          type: "diamond",
          x: 40,
          y: 0,
          width: 10,
          height: 10,
          groupIds: ["group-other"],
        }),
        "element-third",
      ),
      "a2",
    );

    const { elements, elementIdMap } = regenerateImportIdentities(
      [first, second, third],
      [],
    );

    expect(elements).toHaveLength(3);
    expect(elements.map((element) => element.id)).not.toEqual([
      "element-first",
      "element-second",
      "element-third",
    ]);
    expect(new Set(elements.map((element) => element.id)).size).toBe(3);
    expect(elementIdMap.get("element-first")).toBe(elements[0].id);
    expect(elementIdMap.get("element-third")).toBe(elements[2].id);

    // 同一旧分组在同一批次映射到同一新分组，顺序不变
    expect(elements[0].groupIds).toHaveLength(2);
    expect(elements[0].groupIds[0]).toBe(elements[1].groupIds[0]);
    expect(elements[0].groupIds[1]).toBe(elements[1].groupIds[1]);
    expect(elements[0].groupIds[0]).not.toBe("group-outer");
    expect(elements[0].groupIds[0]).not.toBe(elements[0].groupIds[1]);
    expect(elements[2].groupIds[0]).not.toBe(elements[0].groupIds[0]);

    // index 合法且保持数组顺序
    const indices = elements.map((element) => element.index!);
    for (const index of indices) {
      expect(() => validateOrderKey(index)).not.toThrow();
    }
    expect(indices).toEqual([...indices].sort());

    // version 与 versionNonce 重新生成，入参不被修改
    expect(elements[0].version).not.toBe(first.version);
    expect(elements[0].versionNonce).not.toBe(first.versionNonce);
    expect(first.id).toBe("element-first");
    expect(first.groupIds).toEqual(["group-outer", "group-inner"]);
    expect(first.index).toBe("a0");
  });

  it("rebuilds table row, column and cell ids and remaps text region keys", () => {
    const table = makeTable();
    const originalRowIds = table.table.rows.map((row) => row.id);
    const originalColumnIds = table.table.columns.map((column) => column.id);
    const originalCellIds = table.table.cells.map((cell) => cell.id);
    const originalAnchorCellId = originalCellIds[0];

    const { elements } = regenerateImportIdentities([table], []);
    const copy = elements[0];
    if (!isTableElement(copy)) {
      throw new Error("expected table element");
    }

    expect(copy.id).not.toBe("table-1");
    expect(copy.table.rows.map((row) => row.id)).not.toEqual(originalRowIds);
    expect(copy.table.columns.map((column) => column.id)).not.toEqual(
      originalColumnIds,
    );
    expect(copy.table.cells.map((cell) => cell.id)).not.toEqual(
      originalCellIds,
    );

    const [anchor, merged] = copy.table.cells;
    expect(merged.mergedInto).toBe(anchor.id);
    expect(merged.rowId).toBe(copy.table.rows[0].id);
    expect(merged.columnId).toBe(copy.table.columns[1].id);
    expect(anchor.rowSpan).toBe(1);
    expect(anchor.columnSpan).toBe(2);
    expect(anchor.style).toEqual(table.table.cells[0].style);

    const cellBlock = copy.texts?.[cellKey(anchor.id)];
    const rowBlock = copy.texts?.[textRegionKey.row(copy.table.rows[0].id)];
    expect(cellBlock?.text).toBe("A1");
    expect(rowBlock?.text).toBe("Header");
    expect(cellBlock?.style).toEqual(textStyle);
    expect(copy.texts?.[cellKey(originalAnchorCellId)]).toBeUndefined();

    // 入参的表格结构与文本不变
    expect(table.table.cells[0].id).toBe(originalAnchorCellId);
    expect(table.texts?.[cellKey(originalAnchorCellId)]?.text).toBe("A1");
  });

  it("remaps container refs and only keeps bindings inside the batch", () => {
    const frame = setId(
      newFrameElement({ name: "Frame", x: 0, y: 0, width: 200, height: 200 }),
      "frame-1",
    );
    const child = setId(
      newElement({
        type: "rectangle",
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        containerRef: { kind: "frameLike", elementId: "frame-1" },
        boundElements: [
          { id: "arrow-1", type: "arrow" },
          { id: "arrow-missing", type: "arrow" },
        ],
      }),
      "child-1",
    );
    const orphan = setId(
      newElement({
        type: "rectangle",
        x: 40,
        y: 10,
        width: 20,
        height: 20,
        containerRef: { kind: "frameLike", elementId: "parent-missing" },
      }),
      "orphan-1",
    );
    const table = makeTable();
    const cellContent = setId(
      newElement({
        type: "rectangle",
        x: 5,
        y: 5,
        width: 10,
        height: 10,
        containerRef: {
          kind: "tableCell",
          elementId: "table-1",
          cellId: table.table.cells[0].id,
          role: "content",
        },
      }),
      "cell-content-1",
    );
    const arrow = {
      ...newArrowElement({
        type: "arrow",
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        points: [pointFrom(0, 0), pointFrom(100, 0)],
      }),
      id: "arrow-1",
      startBinding: { elementId: "child-1", attachPoint: pointFrom(0, 0) },
      endBinding: { elementId: "missing-1", attachPoint: pointFrom(100, 0) },
    } as ExcalidrawElement;

    const result = regenerateImportIdentities(
      [frame, child, orphan, table, cellContent, arrow],
      [],
    );
    const byOriginalId = (originalId: string) => {
      const nextId = result.elementIdMap.get(originalId);
      return result.elements.find((element) => element.id === nextId)!;
    };

    const frameCopy = byOriginalId("frame-1");
    const childCopy = byOriginalId("child-1");
    const orphanCopy = byOriginalId("orphan-1");
    const tableCopy = byOriginalId("table-1");
    const cellContentCopy = byOriginalId("cell-content-1");
    const arrowCopy = byOriginalId("arrow-1");

    expect(childCopy.containerRef).toEqual({
      kind: "frameLike",
      elementId: frameCopy.id,
    });
    expect(orphanCopy.containerRef).toBeUndefined();
    expect(childCopy.boundElements).toEqual([
      { id: arrowCopy.id, type: "arrow" },
    ]);

    if (!isTableElement(tableCopy)) {
      throw new Error("expected table element");
    }
    expect(cellContentCopy.containerRef).toEqual({
      kind: "tableCell",
      elementId: tableCopy.id,
      cellId: tableCopy.table.cells[0].id,
      role: "content",
    });

    if (!("startBinding" in arrowCopy) || !("endBinding" in arrowCopy)) {
      throw new Error("expected arrow element");
    }
    expect(arrowCopy.startBinding?.elementId).toBe(childCopy.id);
    expect(arrowCopy.endBinding).toBeNull();
  });

  it("remaps mindmap graph, parent and child ids and promotes detached roots", () => {
    const root = setId(
      newMindmapNodeElement({
        x: 0,
        y: 0,
        graphId: "graph-source",
        role: "root",
        parentId: null,
        order: null,
      }),
      "mind-root",
    );
    const child = setId(
      newMindmapNodeElement({
        x: 0,
        y: 0,
        graphId: "graph-source",
        role: "node",
        parentId: "mind-root",
        order: "a0" as FractionalIndex,
      }),
      "mind-child",
    );
    const orphan = setId(
      newMindmapNodeElement({
        x: 0,
        y: 0,
        graphId: "graph-source",
        role: "node",
        parentId: "mind-missing",
        order: "a1" as FractionalIndex,
      }),
      "mind-orphan",
    );
    const sceneChild = setId(
      newMindmapNodeElement({
        x: 0,
        y: 0,
        graphId: "graph-source",
        role: "node",
        parentId: "scene-parent",
        order: "a2" as FractionalIndex,
      }),
      "mind-scene-child",
    );
    const edge = setId(
      newMindmapEdgeElement({
        x: 0,
        y: 0,
        graphId: "graph-source",
        parentId: "mind-root",
        childId: "mind-child",
      }),
      "mind-edge",
    );
    const sceneParent = setId(
      newMindmapNodeElement({
        x: 0,
        y: 0,
        graphId: "graph-scene",
        role: "root",
        parentId: null,
        order: null,
      }),
      "scene-parent",
    );

    const result = regenerateImportIdentities(
      [root, child, orphan, sceneChild, edge],
      [sceneParent],
    );
    const byOriginalId = (originalId: string) => {
      const nextId = result.elementIdMap.get(originalId);
      return result.elements.find((element) => element.id === nextId)!;
    };
    const rootCopy = byOriginalId("mind-root");
    const childCopy = byOriginalId("mind-child");
    const orphanCopy = byOriginalId("mind-orphan");
    const sceneChildCopy = byOriginalId("mind-scene-child");
    const edgeCopy = byOriginalId("mind-edge");

    if (
      !isMindmapNodeElement(rootCopy) ||
      !isMindmapNodeElement(childCopy) ||
      !isMindmapNodeElement(orphanCopy) ||
      !isMindmapNodeElement(sceneChildCopy)
    ) {
      throw new Error("expected mindmap nodes");
    }
    expect(rootCopy.graphId).not.toBe("graph-source");
    expect(childCopy.graphId).toBe(rootCopy.graphId);
    expect(childCopy.role).toBe("node");
    expect(childCopy.parentId).toBe(rootCopy.id);

    // 父节点不在批次也不在目标场景时提升为根
    expect(orphanCopy.role).toBe("root");
    expect(orphanCopy.parentId).toBeNull();
    expect(orphanCopy.order).toBeNull();

    // 目标场景中的父节点保留原 id
    expect(sceneChildCopy.role).toBe("node");
    expect(sceneChildCopy.parentId).toBe("scene-parent");

    if (!isMindmapEdgeElement(edgeCopy)) {
      throw new Error("expected mindmap edge");
    }
    expect(edgeCopy.graphId).toBe(rootCopy.graphId);
    expect(edgeCopy.parentId).toBe(rootCopy.id);
    expect(edgeCopy.childId).toBe(childCopy.id);
  });

  it("rewrites sequence activation links and drops links to targets outside the batch", () => {
    const lifeline = setId(
      newElement({
        type: "sc-lifeline-queue",
        x: 0,
        y: 0,
        width: 160,
        height: 400,
      }),
      "lifeline-1",
    );
    const activation = makeActivation("activation-1", {
      lifelineId: "lifeline-1",
      localY: 120,
    });

    const linked = regenerateImportIdentities([lifeline, activation], []);
    const nextLifelineId = linked.elementIdMap.get("lifeline-1");
    const linkedActivation = linked.elements.find(
      (element) => element.id === linked.elementIdMap.get("activation-1"),
    )!;
    if (!isActivationElement(linkedActivation)) {
      throw new Error("expected activation element");
    }
    expect(linkedActivation.shape.link).toEqual({
      lifelineId: nextLifelineId,
      localY: 120,
    });
    expect(linkedActivation.shape.id).toBe("sc-activation");
    expect(linkedActivation.shape.schemaVersion).toBe(1);

    const detached = regenerateImportIdentities([activation], []);
    const detachedActivation = detached.elements[0];
    if (!isActivationElement(detachedActivation)) {
      throw new Error("expected activation element");
    }
    expect(detachedActivation.shape.link).toBeUndefined();
    expect(detachedActivation.shape.id).toBe("sc-activation");
  });

  it("preserves user text, custom data, style, file id and tombstones", () => {
    const image = setId(
      newImageElement({
        type: "image",
        x: 7,
        y: 9,
        width: 30,
        height: 40,
        fileId: "file-1" as FileId,
        status: "saved",
        customData: { owner: "host", id: "image-1" },
      }),
      "image-1",
    );
    const shape = setId(
      {
        ...newElement({
          type: "rectangle",
          x: 1,
          y: 2,
          width: 30,
          height: 40,
          backgroundColor: "#ff0000",
          strokeColor: "#00ff00",
          strokeWidth: 3,
          strokeStyle: "dashed",
          customData: { keep: true },
        }),
        texts: withTextBlock(undefined, "body", {
          text: "用户文本",
          style: textStyle,
        }),
      },
      "shape-1",
    );
    const tombstone = setId(
      {
        ...newElement({
          type: "rectangle",
          x: 0,
          y: 0,
          width: 5,
          height: 5,
        }),
        texts: withTextBlock(undefined, "label", {
          text: "墓碑文本",
          style: textStyle,
        }),
        isDeleted: true,
      },
      "tombstone-1",
    );

    const result = regenerateImportIdentities([image, shape, tombstone], []);
    const byOriginalId = (originalId: string) => {
      const nextId = result.elementIdMap.get(originalId);
      return result.elements.find((element) => element.id === nextId)!;
    };
    const imageCopy = byOriginalId("image-1");
    const shapeCopy = byOriginalId("shape-1");
    const tombstoneCopy = byOriginalId("tombstone-1");

    if (!("fileId" in imageCopy) || !("fileId" in image)) {
      throw new Error("expected image elements");
    }
    expect(imageCopy.fileId).toBe("file-1");
    expect(imageCopy.customData).toEqual({ owner: "host", id: "image-1" });
    expect(imageCopy.customData).not.toBe(image.customData);

    expect(shapeCopy).toMatchObject({
      x: 1,
      y: 2,
      width: 30,
      height: 40,
      backgroundColor: "#ff0000",
      strokeColor: "#00ff00",
      strokeWidth: 3,
      strokeStyle: "dashed",
      customData: { keep: true },
    });
    expect(shapeCopy.customData).not.toBe(shape.customData);
    expect(shapeCopy.texts?.body).toBeDefined();
    expect(shapeCopy.texts?.body).toEqual(shape.texts?.body);
    expect(shapeCopy.texts?.body).not.toBe(shape.texts?.body);
    expect(shapeCopy.texts?.body?.text).toBe("用户文本");

    expect(tombstoneCopy.isDeleted).toBe(true);
    expect(getTextBlock(tombstoneCopy.texts, "label")?.text).toBe("墓碑文本");

    // 入参元素保持原样
    expect(image.id).toBe("image-1");
    expect(shape.id).toBe("shape-1");
    expect(shape.texts?.body?.text).toBe("用户文本");
  });

  it("handles an empty batch", () => {
    const result = regenerateImportIdentities([], []);
    expect(result.elements).toEqual([]);
    expect(result.elementIdMap.size).toBe(0);
  });
});

describe("remapImportedAppState", () => {
  it("remaps selection ids and clears element references it cannot map", () => {
    const element = setIndex(
      setId(
        newElement({
          type: "rectangle",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          groupIds: ["group-outer"],
        }),
        "element-first",
      ),
      "a0",
    );
    const { elementIdMap } = regenerateImportIdentities([element], []);
    const appState = {
      viewBackgroundColor: "#ffffff",
      selectedElementIds: { "element-first": true, "element-missing": true },
      previousSelectedElementIds: { "element-first": true },
      selectedGroupIds: { "group-outer": true },
      editingGroupId: "group-outer",
      editingElement: { id: "element-first" },
      selectedLinearElement: { elementId: "element-first" },
      hoveredElementIds: { "element-first": true },
      croppingElementId: "element-first",
    };

    const next = remapImportedAppState(appState, elementIdMap)!;

    expect(next).not.toBe(appState);
    expect(next.viewBackgroundColor).toBe("#ffffff");
    expect(next.selectedElementIds).toEqual({
      [elementIdMap.get("element-first")!]: true,
    });
    expect(next.previousSelectedElementIds).toEqual({});
    expect(next.selectedGroupIds).toEqual({});
    expect(next.editingGroupId).toBeNull();
    expect(next.editingElement).toBeNull();
    expect(next.selectedLinearElement).toBeNull();
    expect(next.hoveredElementIds).toEqual({});
    expect(next.croppingElementId).toBeNull();
  });

  it("returns undefined without an appState", () => {
    expect(remapImportedAppState(undefined, new Map())).toBeUndefined();
  });
});
