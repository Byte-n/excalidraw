import {
  buildMindmapGraphIndex,
  getBoundTextElement,
  getMindmapSubtreeIds,
} from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

export type MindmapTextFormat = "markdown" | "outline" | "opml";

export type MindmapTextNode = {
  text: string;
  children: MindmapTextNode[];
};

export const MINDMAP_TEXT_MAX_NODES = 500;
export const MINDMAP_TEXT_MAX_DEPTH = 32;
export const MINDMAP_TEXT_MAX_CHARS = 80000;
const MAX_LABEL_LENGTH = 500;

export class MindmapTextError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = "MindmapTextError";
  }
}

const decodeLabel = (value: string, line?: number): string => {
  const text = value.replace(/\\(\\|e|n|r|t|s)/g, (_, escape: string) =>
    escape === "n"
      ? "\n"
      : escape === "r"
      ? "\r"
      : escape === "t"
      ? "\t"
      : escape === "s"
      ? " "
      : escape === "e"
      ? ""
      : "\\",
  );
  if (/\\(?!\\|e|n|r|t|s)/.test(value)) {
    throw new MindmapTextError("Unsupported escape sequence", line);
  }
  return text;
};

const encodeLabel = (text: string): string => {
  // Preserve empty labels in indented formats, where blank lines are ignored.
  const encoded = text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/^ +| +$/g, (spaces) => "\\s".repeat(spaces.length));
  return encoded || "\\e";
};

export const validateMindmapTextTree = (root: MindmapTextNode) => {
  let count = 0;
  const visit = (node: MindmapTextNode, depth: number) => {
    count++;
    if (count > MINDMAP_TEXT_MAX_NODES) {
      throw new MindmapTextError(
        `Too many nodes (maximum ${MINDMAP_TEXT_MAX_NODES})`,
      );
    }
    if (depth > MINDMAP_TEXT_MAX_DEPTH) {
      throw new MindmapTextError(
        `Too many levels (maximum ${MINDMAP_TEXT_MAX_DEPTH})`,
      );
    }
    if (node.text.length > MAX_LABEL_LENGTH) {
      throw new MindmapTextError(
        `Node text is too long (maximum ${MAX_LABEL_LENGTH} characters)`,
      );
    }
    node.children.forEach((child) => visit(child, depth + 1));
  };
  visit(root, 1);
  return root;
};

const parseIndented = (
  input: string,
  format: "markdown" | "outline",
): MindmapTextNode => {
  const stack: MindmapTextNode[] = [];
  let root: MindmapTextNode | null = null;
  let headingDepth = -1;
  let indentUnit: number | null = null;
  for (const [index, raw] of input.split(/\r?\n/).entries()) {
    const line = index + 1;
    if (!raw.trim()) {
      continue;
    }
    const normalizedRaw = raw.replace(/\t/g, "  ");
    let depth: number;
    let label: string;
    if (format === "markdown") {
      const heading = /^(#{1,6}) ([^\n]*)$/.exec(normalizedRaw);
      const item = /^( *)([-*+]) ([^\n]*)$/.exec(normalizedRaw);
      if (heading) {
        depth = heading[1].length - 1;
        headingDepth = depth;
        label = heading[2];
      } else if (item) {
        if (item[1].length > 0 && indentUnit === null) {
          indentUnit = item[1].length;
        }
        if (
          item[1].length > 0 &&
          (!indentUnit || item[1].length % indentUnit !== 0)
        ) {
          throw new MindmapTextError(
            "Use consistent indentation for list levels",
            line,
          );
        }
        depth =
          headingDepth + 1 + (indentUnit ? item[1].length / indentUnit : 0);
        label = item[3];
      } else {
        throw new MindmapTextError(
          "Expected a heading or an indented bullet (-, *, +)",
          line,
        );
      }
    } else {
      const match = /^( *)(.*)$/.exec(normalizedRaw)!;
      if (match[1].length > 0 && indentUnit === null) {
        indentUnit = match[1].length;
      }
      if (
        match[1].length > 0 &&
        (!indentUnit || match[1].length % indentUnit !== 0)
      ) {
        throw new MindmapTextError(
          "Use consistent indentation for levels",
          line,
        );
      }
      depth = indentUnit ? match[1].length / indentUnit : 0;
      label = match[2];
    }
    if (depth > stack.length) {
      throw new MindmapTextError("Skipped a hierarchy level", line);
    }
    if (depth === 0 && root) {
      throw new MindmapTextError("Only one root is supported", line);
    }
    const node: MindmapTextNode = {
      text: decodeLabel(label, line),
      children: [],
    };
    if (depth === 0) {
      root = node;
    } else {
      stack[depth - 1].children.push(node);
    }
    stack.length = depth;
    stack.push(node);
  }
  if (!root) {
    throw new MindmapTextError("Input is empty");
  }
  return validateMindmapTextTree(root);
};

const parseOpml = (input: string, ownerDocument: Document): MindmapTextNode => {
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) {
    throw new MindmapTextError("OPML DTD and entities are not supported");
  }
  const Parser = ownerDocument.defaultView?.DOMParser;
  if (!Parser) {
    throw new MindmapTextError("XML parsing is unavailable");
  }
  const document = new Parser().parseFromString(input, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new MindmapTextError("Invalid OPML XML");
  }
  const opml = document.documentElement;
  if (opml.tagName !== "opml") {
    throw new MindmapTextError("Expected an <opml> document");
  }
  if (
    [...opml.attributes].some(
      (attribute) => attribute.name !== "version" || attribute.value !== "2.0",
    )
  ) {
    throw new MindmapTextError("Unsupported OPML document attributes");
  }
  const children = [...opml.children];
  if (children.some((child) => !["head", "body"].includes(child.tagName))) {
    throw new MindmapTextError("Unsupported OPML element");
  }
  const head = children.find((child) => child.tagName === "head");
  if (head?.children.length || head?.textContent?.trim()) {
    throw new MindmapTextError("OPML metadata cannot be imported without loss");
  }
  const bodies = children.filter((child) => child.tagName === "body");
  if (bodies.length !== 1) {
    throw new MindmapTextError("OPML needs exactly one <body>");
  }
  if ([...bodies[0].attributes].length || bodies[0].childNodes.length === 0) {
    throw new MindmapTextError("OPML body must contain outline elements");
  }
  const parseOutline = (element: Element): MindmapTextNode => {
    if (
      element.tagName !== "outline" ||
      [...element.attributes].some(
        (attribute) => !["text", "title"].includes(attribute.name),
      ) ||
      [...element.childNodes].some(
        (child) => child.nodeType === 3 && child.textContent?.trim(),
      )
    ) {
      throw new MindmapTextError("Unsupported OPML outline content");
    }
    const text = element.getAttribute("text");
    const title = element.getAttribute("title");
    if (text && title && text !== title) {
      throw new MindmapTextError("OPML text and title attributes differ");
    }
    return {
      text: text ?? title ?? "",
      children: [...element.children].map(parseOutline),
    };
  };
  const roots = [...bodies[0].children];
  if (roots.length !== 1) {
    throw new MindmapTextError("OPML needs exactly one root outline");
  }
  return validateMindmapTextTree(parseOutline(roots[0]));
};

export const parseMindmapText = (
  input: string,
  format: MindmapTextFormat,
  ownerDocument?: Document,
): MindmapTextNode => {
  if (input.length > MINDMAP_TEXT_MAX_CHARS) {
    throw new MindmapTextError(
      `Input is too large (maximum ${MINDMAP_TEXT_MAX_CHARS} characters)`,
    );
  }
  if (!input.trim()) {
    throw new MindmapTextError("Input is empty");
  }
  if (format === "opml") {
    if (!ownerDocument) {
      throw new MindmapTextError("XML parsing is unavailable");
    }
    return parseOpml(input, ownerDocument);
  }
  return parseIndented(input, format);
};

const escapeXml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[
        character
      ]!),
  );

export const serializeMindmapText = (
  root: MindmapTextNode,
  format: MindmapTextFormat,
): string => {
  validateMindmapTextTree(root);
  const lines: string[] = [];
  const visit = (node: MindmapTextNode, depth: number) => {
    if (format === "opml") {
      lines.push(
        `${"  ".repeat(depth + 1)}<outline text="${escapeXml(node.text)}"${
          node.children.length ? ">" : " />"
        }`,
      );
      node.children.forEach((child) => visit(child, depth + 1));
      if (node.children.length) {
        lines.push(`${"  ".repeat(depth + 1)}</outline>`);
      }
    } else if (format === "markdown") {
      lines.push(
        depth === 0
          ? `# ${encodeLabel(node.text)}`
          : `${"  ".repeat(depth - 1)}- ${encodeLabel(node.text)}`,
      );
      node.children.forEach((child) => visit(child, depth + 1));
    } else {
      lines.push(`${"  ".repeat(depth)}${encodeLabel(node.text)}`);
      node.children.forEach((child) => visit(child, depth + 1));
    }
  };
  if (format === "opml") {
    lines.push(
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<opml version="2.0">',
      "  <body>",
    );
  }
  visit(root, 0);
  if (format === "opml") {
    lines.push("  </body>", "</opml>");
  }
  return `${lines.join("\n")}\n`;
};

export const getMindmapTextTree = (
  elements: readonly NonDeletedExcalidrawElement[],
  graphId: string,
  subtreeRootId?: string,
): MindmapTextNode => {
  const index = buildMindmapGraphIndex(elements, graphId);
  const rootId = subtreeRootId ?? index.rootId;
  if (!index.nodes.has(rootId)) {
    throw new MindmapTextError("Selected mindmap is no longer available");
  }
  const elementMap = new Map(elements.map((element) => [element.id, element]));
  const visit = (id: string): MindmapTextNode => ({
    text:
      getBoundTextElement(index.nodes.get(id)!, elementMap)?.originalText ?? "",
    children: (index.childrenById.get(id) ?? []).map(visit),
  });
  const tree = visit(rootId);
  // Keep the same traversal and bounds for full graphs and selected branches.
  if (getMindmapSubtreeIds(index, rootId).length > MINDMAP_TEXT_MAX_NODES) {
    throw new MindmapTextError("Mindmap exceeds the text export size limit");
  }
  return validateMindmapTextTree(tree);
};
