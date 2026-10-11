import { newMindmapNodeElement } from "@excalidraw/element";

import {
  getMindmapTextTree,
  MindmapTextError,
  parseMindmapText,
  serializeMindmapText,
} from "../data/mindmapText";

describe("mindmap text formats", () => {
  const tree = {
    text: "Product plan",
    children: [
      {
        text: "Research",
        children: [{ text: "Interviews", children: [] }],
      },
      { text: "Launch", children: [] },
    ],
  };

  it.each(["markdown", "outline"] as const)(
    "round trips %s hierarchy and order",
    (format) => {
      expect(
        parseMindmapText(serializeMindmapText(tree, format), format),
      ).toEqual(tree);
    },
  );

  it("round trips OPML labels and nested outlines", () => {
    const serialized = serializeMindmapText(tree, "opml");
    expect(parseMindmapText(serialized, "opml", window.document)).toEqual(tree);
  });

  it.each(["markdown", "outline", "opml"] as const)(
    "round trips empty and whitespace-only %s labels",
    (format) => {
      const emptyTree = {
        text: "",
        children: [
          { text: "", children: [] },
          { text: "  ", children: [] },
          { text: "\\e", children: [] },
        ],
      };
      const serialized = serializeMindmapText(emptyTree, format);
      expect(parseMindmapText(serialized, format, window.document)).toEqual(
        emptyTree,
      );
    },
  );

  it("exports a node without a bound text element", () => {
    const root = newMindmapNodeElement({
      x: 0,
      y: 0,
      graphId: "graph",
      role: "root",
      parentId: null,
      order: null,
    });
    expect(getMindmapTextTree([root], "graph")).toEqual({
      text: "",
      children: [],
    });
  });

  it("parses empty Markdown headings and list items", () => {
    expect(parseMindmapText("# \n- \n", "markdown")).toEqual({
      text: "",
      children: [{ text: "", children: [] }],
    });
  });

  it("rejects multiple roots, skipped levels, and unsafe OPML entities", () => {
    expect(() => parseMindmapText("Root\nOther", "outline")).toThrow(
      MindmapTextError,
    );
    expect(() =>
      parseMindmapText("Root\n  Child\n        Grandchild", "outline"),
    ).toThrow(/Skipped a hierarchy level/);
    expect(() =>
      parseMindmapText(
        '<!DOCTYPE opml [<!ENTITY x "bad">]><opml><body><outline text="x" /></body></opml>',
        "opml",
        window.document,
      ),
    ).toThrow(/entities/);
  });

  it("reports empty and over-sized input before creating a tree", () => {
    expect(() => parseMindmapText("  \n", "markdown")).toThrow(/empty/i);
    expect(() =>
      parseMindmapText(`# ${"x".repeat(80001)}`, "markdown"),
    ).toThrow(/too large/i);
  });
});
