import { expect, test } from "vitest";

import { prepareExport } from "./export-preparation";

test("prepareExport waits for complete files and never returns partial output", async () => {
  const prepared = await prepareExport(
    { elements: [{ id: "a" }], files: {} },
    async ({ signal }) => {
      signal?.throwIfAborted();
      return {
        image: {
          id: "image",
          dataURL: "data:image/png;base64,YWJj",
          mimeType: "image/png",
          created: 0,
        },
      };
    },
  );
  expect(prepared.files.image.id).toBe("image");
});

test("prepareExport aborts before and after resolver without partial files", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    prepareExport(
      { elements: [], files: {}, signal: controller.signal },
      async () => ({}),
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  const late = new AbortController();
  await expect(
    prepareExport(
      { elements: [], files: {}, signal: late.signal },
      async () => {
        late.abort();
        return {
          image: {
            id: "image",
            dataURL: "data:image/png;base64,YWJj",
            mimeType: "image/png",
            created: 0,
          },
        };
      },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});
