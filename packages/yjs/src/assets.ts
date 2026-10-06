export type AssetTransport<TRef> = {
  upload(fileId: string, blob: Blob, signal: AbortSignal): Promise<TRef>;
  authorize(fileId: string, signal: AbortSignal): Promise<string>;
  fetch(url: string, signal: AbortSignal): Promise<Blob>;
};

export type AssetBinary = {
  id: string;
  dataURL: string;
  mimeType: string;
  created: number;
};

export type AssetCoordinator<TRef extends { size: number }> = {
  ensureUploaded(
    fileId: string,
    dataURL: string,
    signal?: AbortSignal,
  ): Promise<TRef>;
  resolve(
    fileId: string,
    ref: TRef,
    signal?: AbortSignal,
  ): Promise<AssetBinary>;
  resolveMany(
    refs: Readonly<Record<string, TRef>>,
    signal?: AbortSignal,
  ): Promise<Record<string, AssetBinary>>;
  cancelPending(): void;
  dispose(): void;
};

const toDataURL = async (blob: Blob): Promise<string> => {
  if (typeof FileReader === "undefined") {
    return `data:${blob.type};base64,`;
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

/** 宿主无关的上传与下载协调器，不解释 HTTP、认证、Y.Doc 或存储标识。 */
export const createAssetCoordinator = <
  TRef extends { size: number; mimeType: string },
>(
  transport: AssetTransport<TRef>,
): AssetCoordinator<TRef> => {
  let disposed = false;
  let controller = new AbortController();
  const uploads = new Map<
    string,
    { content: string; promise: Promise<TRef> }
  >();
  const uploaded = new Map<string, { content: string; ref: TRef }>();
  const downloads = new Map<string, Promise<AssetBinary>>();
  const cache = new Map<string, AssetBinary>();
  const active = (signal?: AbortSignal) => {
    if (disposed) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    controller.signal.throwIfAborted();
    signal?.throwIfAborted();
  };
  const ensureUploaded = async (
    fileId: string,
    dataURL: string,
    signal?: AbortSignal,
  ) => {
    active(signal);
    const signalForUpload = controller.signal;
    const old = uploaded.get(fileId) ?? uploads.get(fileId);
    if (old && old.content !== dataURL) {
      throw new Error("asset content conflicts for file ID");
    }
    if (uploaded.has(fileId)) {
      return uploaded.get(fileId)!.ref;
    }
    const pending = uploads.get(fileId);
    if (pending) {
      return pending.promise;
    }
    const promise = (async () => {
      const blob = await transport.fetch(dataURL, signalForUpload);
      signalForUpload.throwIfAborted();
      active(signal);
      const ref = await transport.upload(fileId, blob, signalForUpload);
      signalForUpload.throwIfAborted();
      active(signal);
      uploaded.set(fileId, { content: dataURL, ref });
      // 发起端已拥有原始二进制，后续本地解析直接复用，避免再次请求授权地址。
      const mimeType = dataURL.match(/^data:([^;,]+)/)?.[1] ?? ref.mimeType;
      cache.set(fileId, { id: fileId, dataURL, mimeType, created: 0 });
      return ref;
    })();
    uploads.set(fileId, { content: dataURL, promise });
    try {
      return await promise;
    } finally {
      if (uploads.get(fileId)?.promise === promise) {
        uploads.delete(fileId);
      }
    }
  };
  const resolve = async (fileId: string, ref: TRef, signal?: AbortSignal) => {
    active(signal);
    const cached = cache.get(fileId);
    if (cached) {
      return cached;
    }
    const pending = downloads.get(fileId);
    if (pending) {
      return pending;
    }
    const signalForDownload = controller.signal;
    const promise = (async () => {
      let blob: Blob | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const url = await transport.authorize(fileId, signalForDownload);
        signalForDownload.throwIfAborted();
        try {
          blob = await transport.fetch(url, signalForDownload);
          signalForDownload.throwIfAborted();
          break;
        } catch (error) {
          signalForDownload.throwIfAborted();
          if (attempt) {
            throw error;
          }
        }
      }
      active(signal);
      signalForDownload.throwIfAborted();
      if (!blob || blob.size !== ref.size) {
        throw new Error("asset content validation failed");
      }
      const result = {
        id: fileId,
        dataURL: await toDataURL(blob),
        mimeType: ref.mimeType,
        created: 0,
      };
      signalForDownload.throwIfAborted();
      active(signal);
      cache.set(fileId, result);
      return result;
    })();
    downloads.set(fileId, promise);
    try {
      return await promise;
    } finally {
      if (downloads.get(fileId) === promise) {
        downloads.delete(fileId);
      }
    }
  };
  return {
    ensureUploaded,
    resolve,
    resolveMany: async (refs, signal) => {
      const result: Record<string, AssetBinary> = {};
      await Promise.all(
        Object.entries(refs).map(async ([id, ref]) => {
          result[id] = await resolve(id, ref, signal);
        }),
      );
      return result;
    },
    cancelPending: () => {
      controller.abort();
      controller = new AbortController();
      uploads.clear();
      downloads.clear();
    },
    dispose: () => {
      disposed = true;
      controller.abort();
      uploads.clear();
      downloads.clear();
      cache.clear();
      uploaded.clear();
    },
  };
};
