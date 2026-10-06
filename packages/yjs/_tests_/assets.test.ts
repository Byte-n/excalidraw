import { createAssetCoordinator } from "../src/assets";

test("deduplicates upload/download, validates complete mapping, and aborts late work", async () => {
  let uploads = 0;
  let fetches = 0;
  const coordinator = createAssetCoordinator({
    fetch: async () => {
      fetches++;
      return new Blob(["abc"], { type: "image/png" });
    },
    upload: async () => {
      uploads++;
      return { size: 3, mimeType: "image/png" };
    },
    authorize: async () => "signed",
  });
  const [first, second] = await Promise.all([
    coordinator.ensureUploaded("file", "data:image/png;base64,YWJj"),
    coordinator.ensureUploaded("file", "data:image/png;base64,YWJj"),
  ]);
  expect(first).toStrictEqual(second);
  expect(uploads).toBe(1);
  const binary = await coordinator.resolve("file", {
    size: 3,
    mimeType: "image/png",
  });
  expect(binary.id).toBe("file");
  // 发起端上传成功后直接复用本地 DataURL，不再次授权下载。
  expect(fetches).toBe(1);
  coordinator.cancelPending();
  coordinator.dispose();
  await expect(
    coordinator.resolve("other", { size: 3, mimeType: "image/png" }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("取消前不遵守 AbortSignal 的下载晚到时拒绝结果，不覆盖新一轮缓存", async () => {
  let finishOld!: (blob: Blob) => void;
  let fetches = 0;
  const oldFetch = new Promise<Blob>((resolve) => {
    finishOld = resolve;
  });
  const coordinator = createAssetCoordinator({
    upload: async () => ({ size: 3, mimeType: "image/png" }),
    authorize: async () => "signed",
    fetch: async () =>
      ++fetches === 1 ? oldFetch : new Blob(["new"], { type: "image/png" }),
  });
  onTestFinished(() => coordinator.dispose());
  const asset = { size: 3, mimeType: "image/png" };
  const old = coordinator.resolve("file", asset).catch((error) => error);
  await vi.waitFor(() => expect(fetches).toBe(1));
  coordinator.cancelPending();
  const fresh = await coordinator.resolve("file", asset);
  finishOld(new Blob(["old"], { type: "image/png" }));
  expect(await old).toMatchObject({ name: "AbortError" });
  expect(await coordinator.resolve("file", asset)).toEqual(fresh);
  expect(fresh.dataURL).toBe("data:image/png;base64,bmV3");
  expect(fetches).toBe(2);
});
