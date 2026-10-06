import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { PreparedImport } from "./import";

export type ImportDispatchResult =
  | {
      kind: "scene" | "clipboard-elements" | "image" | "library";
      source: PreparedImport["source"];
    }
  | { kind: "aborted"; source: PreparedImport["source"] };

/** Core-only import decision boundary. It performs no confirmation, React, or host writes. */
export const dispatchPreparedImport = (
  prepared: PreparedImport,
  signal?: AbortSignal,
): ImportDispatchResult => {
  if (signal?.aborted) {
    return { kind: "aborted", source: prepared.source };
  }
  return { kind: prepared.kind, source: prepared.source };
};

/** Remap only relationship IDs; arbitrary customData and shape payloads stay byte-for-byte intact. */
export const remapImportElementIds = (
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] => {
  const ids = new Map(
    elements.map((element) => [element.id, crypto.randomUUID()]),
  );
  const relationKeys = new Set([
    "id",
    "elementId",
    "containerId",
    "frameId",
    "parentId",
    "childId",
    "graphId",
    "groupIds",
    "rowId",
    "columnId",
    "cellId",
    "mergedInto",
    "fileId",
    "boundTo",
    "sourceId",
    "targetId",
    "refId",
  ]);
  const rewrite = (value: unknown, key = ""): unknown => {
    if (typeof value === "string" && relationKeys.has(key)) {
      if (!ids.has(value)) {
        ids.set(value, crypto.randomUUID());
      }
      return ids.get(value);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => rewrite(entry, key));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [
          childKey,
          ["customData", "shape"].includes(childKey)
            ? structuredClone(child)
            : rewrite(child, childKey),
        ]),
      );
    }
    return value;
  };
  return elements.map((element) => rewrite(element) as ExcalidrawElement);
};
