import type { BinaryFiles } from "../types";

export type PrepareExportInput<TElement> = {
  elements: readonly TElement[];
  files: BinaryFiles;
  signal?: AbortSignal;
};

export type ExportPreparer<TElement> = (
  input: PrepareExportInput<TElement>,
) => Promise<BinaryFiles> | BinaryFiles;

/** 等待宿主资源准备后再导出；失败或取消时不会返回部分文件。 */
export const prepareExport = async <TElement>(
  input: PrepareExportInput<TElement>,
  preparer?: ExportPreparer<TElement>,
): Promise<PrepareExportInput<TElement>> => {
  input.signal?.throwIfAborted();
  if (!preparer) {
    return input;
  }
  const files = await preparer(input);
  input.signal?.throwIfAborted();
  return { ...input, files: { ...files } };
};
