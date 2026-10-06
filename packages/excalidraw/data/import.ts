import { IMAGE_MIME_TYPES, MIME_TYPES } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { parseClipboard, type ParsedDataTranferList } from "../clipboard";

import { loadSceneOrLibraryFromBlob } from "./blob";

import type { BinaryFiles } from "../types";
import type { ImportedLibraryData } from "./types";

export type ImportSource = "file" | "drop" | "paste";
export type PreparedImport =
  | {
      kind: "scene";
      source: ImportSource;
      elements: readonly ExcalidrawElement[];
      appState?: Record<string, unknown>;
      files: BinaryFiles;
      replace: boolean;
    }
  | {
      kind: "library";
      source: ImportSource;
      library: ImportedLibraryData;
      replace: false;
    }
  | {
      kind: "image";
      source: ImportSource;
      files: readonly File[];
      replace: false;
    }
  | {
      kind: "clipboard-elements";
      source: "paste";
      elements: readonly ExcalidrawElement[];
      files?: BinaryFiles;
      replace: false;
    };

export type ImportContext = {
  source: ImportSource;
  signal?: AbortSignal;
  operationId?: string;
  position?: { x: number; y: number };
};

export const prepareImportBlob = async (
  blob: Blob | File,
  context: ImportContext,
  localAppState: Parameters<typeof loadSceneOrLibraryFromBlob>[1],
  localElements: Parameters<typeof loadSceneOrLibraryFromBlob>[2],
): Promise<PreparedImport> => {
  if (context.signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  try {
    const loaded = await loadSceneOrLibraryFromBlob(
      blob,
      localAppState,
      localElements,
    );
    if (loaded.type === MIME_TYPES.excalidraw) {
      return {
        kind: "scene",
        source: context.source,
        elements: loaded.data.elements,
        appState: loaded.data.appState as Record<string, unknown>,
        files: loaded.data.files,
        replace: context.source !== "paste",
      };
    }
    return {
      kind: "library",
      source: context.source,
      library: loaded.data,
      replace: false,
    };
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "IMAGE_NOT_CONTAINS_SCENE_DATA"
      )
    ) {
      throw error;
    }
    if (
      blob instanceof File &&
      (Object.values(IMAGE_MIME_TYPES) as string[]).includes(blob.type)
    ) {
      return {
        kind: "image",
        source: context.source,
        files: [blob],
        replace: false,
      };
    }
    throw error;
  }
};

/** Clipboard PNG files intentionally remain image attachments; embedded scenes are parsed only by file/drop. */
export const prepareClipboardImport = async (
  dataList: ParsedDataTranferList,
): Promise<PreparedImport | null> => {
  const data = await parseClipboard(dataList);
  if (data.elements) {
    return {
      kind: "clipboard-elements",
      source: "paste",
      elements: data.elements,
      files: data.files,
      replace: false,
    };
  }
  const files = dataList
    .getFiles()
    .map((item) => item.file)
    .filter((file) =>
      (Object.values(IMAGE_MIME_TYPES) as string[]).includes(file.type),
    );
  return files.length
    ? { kind: "image", source: "paste", files, replace: false }
    : null;
};
