import {
  parseTextRegionKey,
  textRegionKey,
  isTextRegionKey,
} from "../src/text/keys";
import {
  getTextBlock,
  isEmptyTextBlock,
  pruneEmptyTextBlocks,
  withTextBlock,
  withoutTextBlock,
} from "../src/text/ops";

import type { TextBlock, TextRegionKey } from "../src/text/types";

const makeBlock = (text: string): TextBlock => ({
  text,
  style: {
    fontFamily: 1,
    fontSize: 20,
    lineHeight: 1.25 as TextBlock["style"]["lineHeight"],
    textAlign: "left",
    verticalAlign: "top",
  },
});

describe("textRegionKey", () => {
  it("exposes fixed region keys", () => {
    expect(textRegionKey.body).toBe("body");
    expect(textRegionKey.title).toBe("title");
    expect(textRegionKey.label).toBe("label");
  });

  it("builds structural keys", () => {
    const cellKey: TextRegionKey = textRegionKey.cell("c1");
    const rowKey: TextRegionKey = textRegionKey.row("r1");

    expect(cellKey).toBe("cell:c1");
    expect(rowKey).toBe("row:r1");
  });
});

describe("parseTextRegionKey", () => {
  it("parses fixed region keys", () => {
    expect(parseTextRegionKey("body")).toEqual({ kind: "body" });
    expect(parseTextRegionKey("title")).toEqual({ kind: "title" });
    expect(parseTextRegionKey("label")).toEqual({ kind: "label" });
  });

  it("parses structural keys and keeps colons inside the id", () => {
    expect(parseTextRegionKey("cell:c1")).toEqual({
      kind: "cell",
      cellId: "c1",
    });
    expect(parseTextRegionKey("cell:c1:sub")).toEqual({
      kind: "cell",
      cellId: "c1:sub",
    });
    expect(parseTextRegionKey("row:r1:sub")).toEqual({
      kind: "row",
      rowId: "r1:sub",
    });
  });

  it("rejects empty ids and unknown keys", () => {
    expect(parseTextRegionKey("cell:")).toBeNull();
    expect(parseTextRegionKey("row:")).toBeNull();
    expect(parseTextRegionKey("")).toBeNull();
    expect(parseTextRegionKey("cell")).toBeNull();
    expect(parseTextRegionKey("Body")).toBeNull();
    expect(parseTextRegionKey("footer")).toBeNull();
  });

  it("narrows keys via isTextRegionKey", () => {
    expect(isTextRegionKey("body")).toBe(true);
    expect(isTextRegionKey("cell:")).toBe(false);
    expect(isTextRegionKey("nope")).toBe(false);
  });
});

describe("text block ops", () => {
  it("returns undefined for missing blocks", () => {
    expect(getTextBlock(undefined, "body")).toBeUndefined();
    expect(getTextBlock({}, "body")).toBeUndefined();
  });

  it("reads existing blocks", () => {
    const block = makeBlock("hello");
    expect(getTextBlock({ body: block }, "body")).toBe(block);
  });

  it("treats empty text as empty block", () => {
    expect(isEmptyTextBlock(makeBlock(""))).toBe(true);
    expect(isEmptyTextBlock(makeBlock("x"))).toBe(false);
  });

  it("adds a block without mutating the input", () => {
    const initial = {};
    const next = withTextBlock(initial, "body", makeBlock("hello"));

    expect(next).toEqual({ body: makeBlock("hello") });
    expect(initial).toEqual({});
    expect(next).not.toBe(initial);
  });

  it("overwrites an existing block", () => {
    const first = makeBlock("a");
    const second = makeBlock("b");
    const texts = { body: first };

    const next = withTextBlock(texts, "body", second);

    expect(next?.body).toBe(second);
    expect(texts.body).toBe(first);
  });

  it("removes the key when writing an empty block", () => {
    const texts = { body: makeBlock("a"), label: makeBlock("b") };

    expect(withTextBlock(texts, "body", makeBlock(""))).toEqual({
      label: makeBlock("b"),
    });
    expect(
      withTextBlock({ body: makeBlock("a") }, "body", makeBlock("")),
    ).toBeUndefined();
    expect(withTextBlock(undefined, "body", makeBlock(""))).toBeUndefined();
  });

  it("returns undefined when removing the last block", () => {
    const texts = { body: makeBlock("a") };

    expect(withoutTextBlock(texts, "body")).toBeUndefined();
    expect(withoutTextBlock(undefined, "body")).toBeUndefined();
  });

  it("keeps other blocks when removing one and never mutates input", () => {
    const body = makeBlock("a");
    const label = makeBlock("b");
    const texts = { body, label };

    const next = withoutTextBlock(texts, "body");

    expect(next).toEqual({ label });
    expect(texts).toEqual({ body, label });
    expect(next).not.toBe(texts);
  });

  it("returns the input unchanged when the key is absent", () => {
    const texts = { body: makeBlock("a") };

    expect(withoutTextBlock(texts, "label")).toBe(texts);
  });

  it("prunes empty blocks", () => {
    const body = makeBlock("a");
    const texts = { body, label: makeBlock(""), title: makeBlock("") };

    expect(pruneEmptyTextBlocks(texts)).toEqual({ body });
    expect(pruneEmptyTextBlocks(undefined)).toBeUndefined();
    expect(pruneEmptyTextBlocks({ body: makeBlock("") })).toBeUndefined();
    expect(pruneEmptyTextBlocks({ body })).toEqual({ body });
  });
});
