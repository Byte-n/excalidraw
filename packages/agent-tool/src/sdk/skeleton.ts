import { FONT_FAMILY } from "@excalidraw/common";

import { CanvasSdkError } from "./errors.js";

import type { CanvasWarning } from "./types.js";

const fontFamilies = Object.entries(FONT_FAMILY) as [string, number][];

export const fontFamilyNames = fontFamilies.map(([name]) => name);

/** 字体名大小写不敏感映射为枚举值；未知名称留给后续解析报 invalid_input。 */
export const lookupFontFamily = (name: string): number | undefined =>
  fontFamilies.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

export const resolveFontFamily = (value: number | string): number => {
  if (typeof value === "number") {
    return value;
  }
  const resolved = lookupFontFamily(value);
  if (resolved === undefined) {
    throw new CanvasSdkError("invalid_input", `未知字体: ${value}`, {
      legalValues: fontFamilyNames,
    });
  }
  return resolved;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const correctNode = (
  value: unknown,
  path: string,
  warnings: CanvasWarning[],
): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      correctNode(entry, `${path}[${index}]`, warnings),
    );
  }
  if (!isRecord(value)) {
    return value;
  }
  const corrected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (
      key === "label" &&
      typeof entry === "string" &&
      (value.op === "addShape" || value.op === "updateShape")
    ) {
      warnings.push({
        code: "input_corrected",
        message: "字符串 label 已转换为 { text }",
        path: entryPath,
        from: entry,
        to: { text: entry },
      });
      corrected[key] = { text: entry };
      continue;
    }
    if (key === "fontFamily" && typeof entry === "string") {
      const resolved = lookupFontFamily(entry);
      if (resolved !== undefined) {
        warnings.push({
          code: "input_corrected",
          message: "字体名称已转换为字体枚举值",
          path: entryPath,
          from: entry,
          to: resolved,
        });
        corrected[key] = resolved;
      } else {
        corrected[key] = entry;
      }
      continue;
    }
    if (key === "kind" && entry === "circle" && value.op === "addShape") {
      warnings.push({
        code: "input_corrected",
        message: "circle 已规范化为 ellipse",
        path: entryPath,
        from: "circle",
        to: "ellipse",
      });
      corrected[key] = "ellipse";
      continue;
    }
    corrected[key] = correctNode(entry, entryPath, warnings);
  }
  return corrected;
};

/** 在 Zod 校验前做确定性的字段纠正，并记录可回传的 warnings。 */
export const correctApplyOps = (
  ops: readonly unknown[],
): { ops: unknown[]; warnings: CanvasWarning[] } => {
  const warnings: CanvasWarning[] = [];
  return {
    ops: ops.map((op, index) => correctNode(op, `ops[${index}]`, warnings)),
    warnings,
  };
};
