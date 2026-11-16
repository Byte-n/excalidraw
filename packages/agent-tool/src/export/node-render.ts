import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { DEFAULT_EXPORT_PADDING, FONT_FAMILY } from "@excalidraw/common";
import { containsCJK, isTitledElement } from "@excalidraw/element";
import { JSDOM } from "jsdom";

import type { ExcalidrawElement } from "@excalidraw/element/types";

type FontFaceLike = {
  urls: Array<URL | string>;
  fontFace: { family: string; unicodeRange: string };
};
type RegisteredFont = {
  metadata: { local?: boolean };
  fontFaces: FontFaceLike[];
};
type ExportNodeModule = {
  exportToSvg: (
    elements: readonly ExcalidrawElement[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
    opts: { skipInliningFonts?: true },
  ) => Promise<SVGSVGElement>;
  getDefaultAppState: () => Record<string, unknown>;
  getExportSize: (
    elements: readonly ExcalidrawElement[],
    padding: number,
    scale: number,
  ) => [number, number];
  Fonts: { registered: Map<number, RegisteredFont> };
};

export type NodeRenderOptions = {
  scale?: number;
  background?: boolean;
  backgroundColor?: string;
  padding?: number;
};

export type NodeSvgResult = {
  format: "svg";
  mimeType: "image/svg+xml";
  data: string;
  width: number;
  height: number;
};

export type NodePngResult = {
  format: "png";
  mimeType: "image/png";
  data: string;
  width: number;
  height: number;
};

const require = createRequire(import.meta.url);
const registeredFonts = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();

const getExportNodeModule = async (): Promise<{
  dom: JSDOM;
  module: ExportNodeModule;
  assetRoot: string;
}> => {
  const exportPath = require.resolve("@excalidraw/excalidraw/export-node");
  const assetRoot = path.dirname(exportPath);
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
  });
  const restore = installGlobals(dom, assetRoot);
  try {
    const modulePath = "@excalidraw/excalidraw/export-node";
    const module = (await import(
      /* @vite-ignore */ modulePath
    )) as unknown as ExportNodeModule;
    return { dom, module, assetRoot };
  } catch (error) {
    restore();
    throw error;
  }
};

let envPromise: Promise<{
  dom: JSDOM;
  module: ExportNodeModule;
  assetRoot: string;
}> | null = null;

const getEnv = () => {
  if (!envPromise) {
    envPromise = getExportNodeModule();
  }
  return envPromise;
};

const withEnv = <T>(
  run: (env: {
    dom: JSDOM;
    module: ExportNodeModule;
    assetRoot: string;
  }) => Promise<T>,
): Promise<T> => {
  const task = queue.then(async () => {
    const env = await getEnv();
    const restore = installGlobals(env.dom, env.assetRoot);
    try {
      return await run(env);
    } finally {
      restore();
    }
  });
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
};

/** 让 exportToSvg / roughjs 在 Node 下拿到最小 DOM；导出串行执行，避免全局竞态。 */
const installGlobals = (dom: JSDOM, assetRoot: string) => {
  const target = globalThis as Record<string, unknown>;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    if (!previous.has(key)) {
      previous.set(key, Object.getOwnPropertyDescriptor(target, key));
    }
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  const win = dom.window as unknown as Record<string, unknown>;
  set("window", dom.window);
  set("document", dom.window.document);
  set("devicePixelRatio", 1);
  set("HTMLElement", dom.window.HTMLElement);
  set("SVGElement", dom.window.SVGElement);
  set("Node", dom.window.Node);
  set("Image", dom.window.Image);
  set("navigator", dom.window.navigator);
  set(
    "requestAnimationFrame",
    dom.window.requestAnimationFrame.bind(dom.window),
  );
  set("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  set("FontFace", createFontFaceStub());
  win.EXCALIDRAW_ASSET_PATH = `${pathToFileURL(assetRoot).href}/`;
  const canvasPrototype = dom.window.HTMLCanvasElement.prototype as {
    getContext: (type: string) => unknown;
  };
  const originalGetContext = canvasPrototype.getContext;
  canvasPrototype.getContext = function getContext(
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type !== "2d") {
      return null;
    }
    const canvas = createCanvas(this.width || 300, this.height || 150);
    return canvas.getContext("2d");
  };
  return () => {
    canvasPrototype.getContext = originalGetContext;
    for (const [key, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(target, key, descriptor);
      } else {
        delete target[key];
      }
    }
  };
};

const createFontFaceStub = () =>
  class FontFaceStub {
    readonly family: string;
    readonly source: string;
    readonly style: string;
    readonly weight: string;
    readonly unicodeRange: string;

    constructor(
      family: string,
      source: string,
      descriptors: Record<string, string> = {},
    ) {
      this.family = family;
      this.source = source;
      this.style = descriptors.style ?? "normal";
      this.weight = descriptors.weight ?? "400";
      this.unicodeRange = descriptors.unicodeRange ?? "U+0-10FFFF";
    }
  };

const textBlocksOf = (
  element: ExcalidrawElement,
): Array<{ text: string; fontFamily?: number }> => {
  const texts = (element as { texts?: Record<string, unknown> }).texts;
  if (!texts) {
    return [];
  }
  const blocks: Array<{ text: string; fontFamily?: number }> = [];
  for (const block of Object.values(texts)) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const record = block as {
      text?: unknown;
      style?: { fontFamily?: unknown };
    };
    if (typeof record.text !== "string") {
      continue;
    }
    blocks.push({
      text: record.text,
      ...(typeof record.style?.fontFamily === "number"
        ? { fontFamily: record.style.fontFamily }
        : {}),
    });
  }
  return blocks;
};

const usedFontFamilies = (elements: readonly ExcalidrawElement[]) => {
  const families = new Set<number>();
  let hasCJK = false;
  let hasTitled = false;
  for (const element of elements) {
    if (isTitledElement(element)) {
      hasTitled = true;
    }
    for (const block of textBlocksOf(element)) {
      if (block.fontFamily !== undefined) {
        families.add(block.fontFamily);
      }
      hasCJK ||= containsCJK(block.text);
    }
  }
  if (hasTitled) {
    families.add(FONT_FAMILY.Helvetica);
  }
  if (hasCJK) {
    families.add(100);
  }
  return [...families];
};

const fontFilePath = (url: URL | string): string | null => {
  if (url instanceof URL) {
    return url.protocol === "file:" ? fileURLToPath(url) : null;
  }
  if (url.startsWith("file:")) {
    return fileURLToPath(url);
  }
  return null;
};

const rangeIncludes = (unicodeRange: string, codePoint: number) =>
  unicodeRange.split(/,\s*/).some((part) => {
    const [start, end] = part.replace("U+", "").split("-");
    const from = Number.parseInt(start, 16);
    const to = end ? Number.parseInt(end, 16) : from;
    return codePoint >= from && codePoint <= to;
  });

const ensureFonts = async (
  module: ExportNodeModule,
  families: readonly number[],
) => {
  for (const family of families) {
    const registered = module.Fonts.registered.get(family);
    if (!registered || registered.metadata.local) {
      continue;
    }
    // 分片字库同名同权重；让含 ASCII 的分片最后注册，保证常见拉丁文本优先命中。
    const ordered = [...registered.fontFaces].sort(
      (left, right) =>
        Number(rangeIncludes(left.fontFace.unicodeRange, 0x41)) -
        Number(rangeIncludes(right.fontFace.unicodeRange, 0x41)),
    );
    for (const face of ordered) {
      const file = face.urls.map(fontFilePath).find(Boolean);
      if (!file) {
        continue;
      }
      const key = `${face.fontFace.family}:${file}`;
      if (registeredFonts.has(key)) {
        continue;
      }
      try {
        GlobalFonts.registerFromPath(file, face.fontFace.family);
        registeredFonts.add(key);
      } catch {
        // 缺字形时由系统字体回退，不阻断导出。
      }
    }
  }
};

const buildFontCss = async (
  module: ExportNodeModule,
  families: readonly number[],
) => {
  const css: string[] = [];
  for (const family of families) {
    const registered = module.Fonts.registered.get(family);
    if (!registered || registered.metadata.local) {
      continue;
    }
    for (const face of registered.fontFaces) {
      const file = face.urls.map(fontFilePath).find(Boolean);
      if (!file) {
        continue;
      }
      try {
        const data = await readFile(file);
        css.push(
          `@font-face{font-family:"${
            face.fontFace.family
          }";src:url(data:font/woff2;base64,${data.toString(
            "base64",
          )});font-style:normal;font-weight:400;unicode-range:${
            face.fontFace.unicodeRange
          }}`,
        );
      } catch {
        // 字体文件缺失时保留运行时回退。
      }
    }
  }
  return css.join("\n");
};

const exportAppState = (
  module: ExportNodeModule,
  options: NodeRenderOptions,
) => {
  const defaults = module.getDefaultAppState();
  return {
    ...defaults,
    exportBackground: options.background ?? true,
    viewBackgroundColor: options.backgroundColor ?? "#ffffff",
    exportPadding: options.padding ?? DEFAULT_EXPORT_PADDING,
    exportScale: options.scale ?? 1,
  };
};

const renderSvg = async (
  env: { module: ExportNodeModule },
  elements: readonly ExcalidrawElement[],
  options: NodeRenderOptions,
  inlineFonts: boolean,
) => {
  const families = usedFontFamilies(elements);
  await ensureFonts(env.module, families);
  const svgRoot = await env.module.exportToSvg(
    elements,
    exportAppState(env.module, options),
    {},
    { skipInliningFonts: true },
  );
  if (inlineFonts) {
    const css = await buildFontCss(env.module, families);
    const style = svgRoot.querySelector(".style-fonts");
    if (style) {
      style.textContent = css;
    }
  }
  const width = Number(svgRoot.getAttribute("width")) || 0;
  const height = Number(svgRoot.getAttribute("height")) || 0;
  return { svg: svgRoot.outerHTML, width, height };
};

export const renderSceneSvg = async (
  elements: readonly ExcalidrawElement[],
  options: NodeRenderOptions = {},
): Promise<NodeSvgResult> =>
  withEnv(async (env) => {
    const { svg, width, height } = await renderSvg(
      env,
      elements,
      options,
      true,
    );
    return {
      format: "svg",
      mimeType: "image/svg+xml",
      data: svg,
      width,
      height,
    };
  });

export const renderScenePng = async (
  elements: readonly ExcalidrawElement[],
  options: NodeRenderOptions = {},
): Promise<NodePngResult> =>
  withEnv(async (env) => {
    const { svg, width, height } = await renderSvg(
      env,
      elements,
      options,
      false,
    );
    const image = await loadImage(Buffer.from(svg));
    const scale = options.scale ?? 1;
    const canvasWidth = Math.max(1, Math.round(image.width || width * scale));
    const canvasHeight = Math.max(
      1,
      Math.round(image.height || height * scale),
    );
    const canvas = createCanvas(canvasWidth, canvasHeight);
    canvas.getContext("2d").drawImage(image, 0, 0);
    return {
      format: "png",
      mimeType: "image/png",
      data: canvas.toBuffer("image/png").toString("base64"),
      width: canvasWidth,
      height: canvasHeight,
    };
  });
