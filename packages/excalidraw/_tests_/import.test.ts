import { MIME_TYPES } from "@excalidraw/common";

import { prepareImportBlob } from "../data/import";

test("prepares JSON files as a replacing scene and ordinary PNG files as paste/drop images", async () => {
  const json = new File(
    [
      JSON.stringify({
        type: "excalidraw",
        version: 4,
        source: "test",
        elements: [],
        appState: {},
        files: {},
      }),
    ],
    "scene.excalidraw",
    { type: MIME_TYPES.json },
  );
  const scene = await prepareImportBlob(json, { source: "file" }, null, []);
  expect(scene).toMatchObject({ kind: "scene", source: "file", replace: true });

  const png = new File(
    [
      Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
        ),
        (character) => character.charCodeAt(0),
      ),
    ],
    "image.png",
    { type: MIME_TYPES.png },
  );
  const image = await prepareImportBlob(png, { source: "paste" }, null, []);
  expect(image).toMatchObject({
    kind: "image",
    source: "paste",
    replace: false,
  });
});
