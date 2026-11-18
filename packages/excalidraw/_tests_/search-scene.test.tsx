import React from "react";

import { DEFAULT_FONT_FAMILY, getLineHeight } from "@excalidraw/common";

import type {
  ExcalidrawTableElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import type {
  RevealElementOptions,
  SceneSearchResult,
  SearchPanelItem,
  SearchPanelOptions,
  SearchSceneOptions,
} from "../index";

import { API } from "./helpers/api";
import { render } from "./test-utils";

// 编译期断言：公共搜索类型均可从包根导入。
export type PublicSearchTypes = {
  result: SceneSearchResult;
  searchOptions: SearchSceneOptions;
  revealOptions: RevealElementOptions;
  panelOptions: SearchPanelOptions;
  panelItem: SearchPanelItem;
};

const { h } = window;

const textBlock = (text: string) => ({
  text,
  style: {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 16,
    lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
    textAlign: "left" as const,
    verticalAlign: "top" as const,
  },
});

const search = (
  query: string | readonly string[],
  options?: SearchSceneOptions,
) => h.app.api.searchScene(query, options);

describe("searchScene", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("matches titles and every text region", async () => {
    const shape = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      texts: { body: textBlock("shape needle") },
    });
    const note = API.createElement({
      type: "stickynote",
      x: 200,
      y: 0,
      width: 100,
      height: 100,
      baseHeight: 100,
      texts: { body: textBlock("note needle") },
    });
    const table = API.createElement({
      type: "table",
      x: 400,
      y: 0,
    }) as ExcalidrawTableElement;
    const cell = table.table.cells[0];
    const frame = API.createElement({ type: "frame", x: 0, y: 400 });
    const mindmap = API.createElement({
      type: "mindmap-node",
      x: 600,
      y: 0,
      mindmap: {
        graphId: "graph-1",
        parentId: null,
        order: null,
        collapsed: false,
        shape: { id: "rectangle", schemaVersion: 1 },
      },
      texts: API.mindmapBody({ role: "root" }, "mindmap needle"),
    });
    const fragment = API.createElement({
      type: "sequence",
      x: 0,
      y: 800,
      width: 400,
      height: 240,
      shape: {
        id: "sc-fragment",
        schemaVersion: 1,
        fragment: {
          rows: [
            { id: "header", height: 36 },
            { id: "body", height: 204 },
          ],
        },
      },
      texts: {
        body: textBlock("fragment tab"),
        "row:body": textBlock("row needle"),
      },
    });

    API.setElements([shape, note, table, frame, mindmap, fragment]);
    API.updateElement(table, {
      texts: { [`cell:${cell.id}`]: textBlock("cell needle") },
    });
    API.updateElement(table, { name: "table needle" });
    API.updateElement(frame, { name: "frame needle" });

    expect(search("shape needle")[0].elementId).toBe(shape.id);
    expect(search("note needle")[0].elementId).toBe(note.id);
    expect(search("cell needle")[0].elementId).toBe(table.id);
    expect(search("frame needle")[0].elementId).toBe(frame.id);
    expect(search("mindmap needle")[0].elementId).toBe(mindmap.id);
    expect(search("row needle")[0].elementId).toBe(fragment.id);
    expect(search("fragment tab")[0].elementId).toBe(fragment.id);
  });

  it("returns one result per element and counts every occurrence", async () => {
    const text = API.createElement({
      type: "text",
      text: "needle needle needle",
    });
    API.setElements([text]);

    const results = search("needle");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      elementId: text.id,
      elementType: "text",
      group: "text",
      matchCount: 3,
      matchedTermCount: 1,
      matchedTerms: ["needle"],
      title: "needle needle needle",
    });
  });

  it("ignores deleted elements", async () => {
    API.setElements([
      API.createElement({
        type: "text",
        text: "ghost needle",
        isDeleted: true,
      }),
    ]);

    expect(search("needle")).toHaveLength(0);
  });

  it("truncates element results by limit", async () => {
    API.setElements([
      API.createElement({ type: "text", text: "common text", y: 0 }),
      API.createElement({ type: "text", text: "common text", y: 100 }),
      API.createElement({ type: "text", text: "common text", y: 200 }),
    ]);

    expect(search("common", { limit: 2 })).toHaveLength(2);
    expect(search("common", { limit: 0 })).toHaveLength(0);
  });

  it("supports any and all multi-term matching", async () => {
    const both = API.createElement({ type: "text", text: "alpha beta", y: 0 });
    const single = API.createElement({
      type: "text",
      text: "alpha gamma",
      y: 100,
    });
    API.setElements([both, single]);

    const anyResults = search(["alpha", "beta"], { match: "any" });
    expect(anyResults.map((result) => result.elementId)).toEqual([
      both.id,
      single.id,
    ]);
    expect(anyResults[1]).toMatchObject({
      matchedTermCount: 1,
      matchedTerms: ["alpha"],
    });

    const allResults = search(["alpha", "beta"], { match: "all" });
    expect(allResults.map((result) => result.elementId)).toEqual([both.id]);
    expect(allResults[0]).toMatchObject({
      matchedTermCount: 2,
      matchedTerms: ["alpha", "beta"],
    });
  });

  it("matches both the title and the body of titled elements", async () => {
    const table = API.createElement({
      type: "table",
      x: 0,
      y: 0,
    }) as ExcalidrawTableElement;
    const cell = table.table.cells[0];
    API.setElements([table]);
    API.updateElement(table, {
      name: "matrix",
      texts: { [`cell:${cell.id}`]: textBlock("matrix") },
    });

    const results = search("matrix");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      elementId: table.id,
      elementType: "table",
      group: "table",
      title: "matrix",
      matchCount: 2,
    });
  });

  it("excludes hidden mindmap nodes unless includeHidden is set", async () => {
    const root = API.createElement({
      type: "mindmap-node",
      x: 0,
      y: 0,
      mindmap: {
        graphId: "graph-1",
        parentId: null,
        order: null,
        collapsed: true,
        shape: { id: "rectangle", schemaVersion: 1 },
      },
      texts: API.mindmapBody({ role: "root" }, "root label"),
    });
    const child = API.createElement({
      type: "mindmap-node",
      x: 0,
      y: 100,
      mindmap: {
        graphId: "graph-1",
        parentId: root.id,
        order: "a1" as FractionalIndex,
        collapsed: false,
        shape: { id: "rectangle", schemaVersion: 1 },
      },
      texts: API.mindmapBody({ role: "node" }, "hidden needle"),
    });
    API.setElements([root, child]);

    expect(search("hidden needle")).toHaveLength(0);

    const results = search("hidden needle", { includeHidden: true });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      elementId: child.id,
      group: "mindmap",
      hidden: true,
    });
  });

  it("collects the frameLike parent chain as breadcrumb", async () => {
    const outer = API.createElement({ type: "frame", x: 0, y: 0 });
    const text = API.createElement({
      type: "text",
      x: 20,
      y: 20,
      text: "deep needle",
      containerRef: { kind: "frameLike", elementId: outer.id },
    });
    API.setElements([outer, text]);
    API.updateElement(outer, { name: "Outer" });

    const results = search("deep needle");

    expect(results).toHaveLength(1);
    expect(results[0].breadcrumb).toEqual(["Outer"]);
  });
});
