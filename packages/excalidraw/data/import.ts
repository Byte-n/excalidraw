import { IMAGE_MIME_TYPES, MIME_TYPES } from "@excalidraw/common";

import { CaptureUpdateAction } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { parseClipboard, type ParsedDataTranferList } from "../clipboard";

import { loadSceneOrLibraryFromBlob } from "./blob";
import {
  regenerateImportIdentities,
  remapImportedAppState,
} from "./import-identity";

import type {
  AppState,
  BinaryFiles,
  ExcalidrawCollaborationImports,
} from "../types";
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
      identity: "preserved" | "regenerated";
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
      identity: "preserved" | "regenerated";
    };

export type ImportContext = {
  source: ImportSource;
  signal?: AbortSignal;
  operationId?: string;
  position?: { x: number; y: number };
};

export type ImportPreparationOptions = {
  imports?: ExcalidrawCollaborationImports;
  targetElements?: readonly ExcalidrawElement[];
};

/** 按导入策略决定元素身份是否重置；默认保留源身份。 */
const prepareImportIdentity = (
  elements: readonly ExcalidrawElement[],
  appState: Record<string, unknown> | undefined,
  options: ImportPreparationOptions,
) => {
  if (options.imports?.regenerateElementIds !== true) {
    return { elements, appState, identity: "preserved" as const };
  }
  const { elements: regenerated, elementIdMap } = regenerateImportIdentities(
    elements,
    options.targetElements ?? [],
  );
  return {
    elements: regenerated,
    appState: remapImportedAppState(appState, elementIdMap),
    identity: "regenerated" as const,
  };
};

/** 把场景导入结果转成一次性替换场景的 action result。 */
export const preparedImportToActionResult = (
  prepared: Extract<PreparedImport, { kind: "scene" }>,
) => {
  return {
    elements: prepared.elements,
    appState: prepared.appState as Partial<AppState> | undefined,
    files: prepared.files,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  };
};

export const prepareImportBlob = async (
  blob: Blob | File,
  context: ImportContext,
  localAppState: Parameters<typeof loadSceneOrLibraryFromBlob>[1],
  localElements: Parameters<typeof loadSceneOrLibraryFromBlob>[2],
  options: ImportPreparationOptions = {},
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
      const identity = prepareImportIdentity(
        loaded.data.elements,
        loaded.data.appState as Record<string, unknown>,
        options,
      );
      return {
        kind: "scene",
        source: context.source,
        elements: identity.elements,
        appState: identity.appState,
        files: loaded.data.files,
        replace: context.source !== "paste",
        identity: identity.identity,
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
  options: ImportPreparationOptions = {},
): Promise<PreparedImport | null> => {
  const data = await parseClipboard(dataList);
  if (data.elements) {
    const identity = prepareImportIdentity(data.elements, undefined, options);
    return {
      kind: "clipboard-elements",
      source: "paste",
      elements: identity.elements,
      files: data.files,
      replace: false,
      identity: identity.identity,
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
