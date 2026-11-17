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
