import { MIME_TYPES, VERSIONS } from "@excalidraw/common";

import {
  CaptureUpdateAction,
  isTableElement,
  newElement,
  newImageElement,
  newTableElement,
} from "@excalidraw/element";

import {
  createPasteEvent,
  parseDataTransferEvent,
  type ParsedDataTranferList,
} from "../clipboard";
import { getDefaultAppState } from "../appState";
import {
  prepareClipboardImport,
  prepareImportBlob,
  preparedImportToActionResult,
} from "../data/import";

import type {
  ExcalidrawElement,
  FileId,
  FractionalIndex,
} from "@excalidraw/element/types";

const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

const makeSceneElements = () => {
  const rectangle = {
    ...newElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      groupIds: ["group-source"],
    }),
    id: "rect-1",
    index: "a0" as FractionalIndex,
  };
  const table = {
    ...newTableElement({
      type: "table",
      x: 20,
      y: 0,
      rowCount: 2,
      columnCount: 2,
    }),
    id: "table-1",
    index: "a1" as FractionalIndex,
  };
  const image = {
    ...newImageElement({
      type: "image",
      x: 0,
      y: 20,
      width: 10,
      height: 10,
      fileId: "file-1" as FileId,
      status: "saved",
    }),
    id: "image-1",
    index: "a2" as FractionalIndex,
  };
  return {
    rectangle,
    table,
    image,
    elements: [rectangle, table, image] as readonly ExcalidrawElement[],
  };
};

const makeSceneFile = (elements: readonly ExcalidrawElement[]) =>
  new File(
    [
      JSON.stringify({
        type: "excalidraw",
        version: VERSIONS.excalidraw,
        source: "test",
        elements,
        appState: {},
        files: {
          "file-1": {
            id: "file-1",
            mimeType: MIME_TYPES.png,
            dataURL: "data:image/png;base64,iVBORw0KGgo=",
            created: 0,
            lastRetrieved: 0,
          },
        },
      }),
    ],
    "scene.excalidraw",
    { type: MIME_TYPES.json },
  );

const makeClipboardList = (
  elements: readonly ExcalidrawElement[],
): Promise<ParsedDataTranferList> =>
  parseDataTransferEvent(
    createPasteEvent({
      types: {
        [MIME_TYPES.text]: JSON.stringify({
          type: "excalidraw/clipboard",
          elements,
          files: {},
        }),
      },
    }),
  );

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
  expect(scene).toMatchObject({
    kind: "scene",
    source: "file",
    replace: true,
    identity: "preserved",
  });

  const png = new File([PNG_BYTES], "image.png", { type: MIME_TYPES.png });
  const image = await prepareImportBlob(png, { source: "paste" }, null, []);
  expect(image).toMatchObject({
    kind: "image",
    source: "paste",
    replace: false,
  });
  expect("identity" in image).toBe(false);
});

describe("prepareImportBlob identity policy", () => {
  it("regenerates scene element, group and table identities", async () => {
    const { rectangle, table, elements } = makeSceneElements();
    const localAppState = {
      ...getDefaultAppState(),
      width: 0,
      height: 0,
      offsetTop: 0,
      offsetLeft: 0,
      selectedElementIds: { "rect-1": true as const },
    };
    const scene = await prepareImportBlob(
      makeSceneFile(elements),
      { source: "file" },
      localAppState,
      [],
      { imports: { regenerateElementIds: true }, targetElements: [] },
    );

    expect(scene).toMatchObject({ kind: "scene", identity: "regenerated" });
    if (scene.kind !== "scene") {
      throw new Error("expected a prepared scene");
    }

    const [nextRectangle, nextTable, nextImage] = scene.elements;
    if (!isTableElement(nextTable)) {
      throw new Error("expected a table element");
    }

    expect(scene.elements.map((element) => element.id)).not.toContain("rect-1");
    expect(nextRectangle.id).not.toBe(rectangle.id);
    expect(nextRectangle.groupIds[0]).not.toBe(rectangle.groupIds[0]);
    expect(nextTable.id).not.toBe(table.id);
    expect(nextTable.table.rows[0].id).not.toBe(table.table.rows[0].id);
    expect(nextTable.table.cells[0].id).not.toBe(table.table.cells[0].id);
    expect("fileId" in nextImage && nextImage.fileId).toBe("file-1");
    expect(scene.files).toMatchObject({ "file-1": { id: "file-1" } });

    expect(scene.appState?.selectedElementIds).toEqual({
      [nextRectangle.id]: true,
    });
  });

  it("preserves scene identities when the policy is off or options are omitted", async () => {
    const { rectangle, elements } = makeSceneElements();
    const localAppState = {
      ...getDefaultAppState(),
      width: 0,
      height: 0,
      offsetTop: 0,
      offsetLeft: 0,
      selectedElementIds: {
        "rect-1": true as const,
        "rect-missing": true as const,
      },
    };

    const optionSets = [
      undefined,
      { imports: { regenerateElementIds: false }, targetElements: [] },
    ];
    for (const options of optionSets) {
      const scene = await prepareImportBlob(
        makeSceneFile(elements),
        { source: "file" },
        localAppState,
        [],
        options,
      );
      expect(scene).toMatchObject({ kind: "scene", identity: "preserved" });
      if (scene.kind !== "scene") {
        throw new Error("expected a prepared scene");
      }
      expect(scene.elements.map((element) => element.id)).toContain(
        rectangle.id,
      );
      expect(scene.appState?.selectedElementIds).toEqual({
        "rect-1": true,
        "rect-missing": true,
      });
    }
  });

  it("keeps library contents untouched and without an identity field", async () => {
    const { elements } = makeSceneElements();
    const libraryFile = new File(
      [
        JSON.stringify({
          type: "excalidrawlib",
          version: VERSIONS.excalidrawLibrary,
          source: "test",
          libraryItems: [
            {
              id: "item-1",
              status: "unpublished",
              created: 0,
              name: "item",
              elements,
            },
          ],
        }),
      ],
      "library.excalidrawlib",
      { type: MIME_TYPES.json },
    );
    const prepared = await prepareImportBlob(
      libraryFile,
      { source: "drop" },
      null,
      [],
      { imports: { regenerateElementIds: true }, targetElements: [] },
    );

    expect(prepared.kind).toBe("library");
    expect("identity" in prepared).toBe(false);
    if (prepared.kind !== "library") {
      throw new Error("expected a prepared library");
    }
    expect(
      prepared.library.libraryItems[0].elements.map((element) => element.id),
    ).toEqual(["rect-1", "table-1", "image-1"]);
  });

  it("converts a prepared scene into an immediate replace action result", async () => {
    const { elements } = makeSceneElements();
    const scene = await prepareImportBlob(
      makeSceneFile(elements),
      { source: "file" },
      null,
      [],
      { imports: { regenerateElementIds: true } },
    );
    if (scene.kind !== "scene") {
      throw new Error("expected a prepared scene");
    }

    const actionResult = preparedImportToActionResult(scene);
    expect(actionResult).toMatchObject({
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    expect(actionResult.elements).toBe(scene.elements);
    expect(actionResult.files).toBe(scene.files);
    expect(actionResult.appState).toBe(scene.appState);
  });
});

describe("prepareClipboardImport identity policy", () => {
  it("regenerates clipboard element and group identities", async () => {
    const { rectangle, elements } = makeSceneElements();
    const prepared = await prepareClipboardImport(
      await makeClipboardList(elements),
      { imports: { regenerateElementIds: true }, targetElements: [] },
    );

    expect(prepared).toMatchObject({
      kind: "clipboard-elements",
      identity: "regenerated",
    });
    if (prepared?.kind !== "clipboard-elements") {
      throw new Error("expected prepared clipboard elements");
    }
    const [nextRectangle] = prepared.elements;
    expect(nextRectangle.id).not.toBe(rectangle.id);
    expect(nextRectangle.groupIds[0]).not.toBe(rectangle.groupIds[0]);
  });

  it("preserves clipboard identities when the policy is off", async () => {
    const { elements } = makeSceneElements();
    const prepared = await prepareClipboardImport(
      await makeClipboardList(elements),
      { imports: { regenerateElementIds: false }, targetElements: [] },
    );

    expect(prepared).toMatchObject({
      kind: "clipboard-elements",
      identity: "preserved",
    });
    if (prepared?.kind !== "clipboard-elements") {
      throw new Error("expected prepared clipboard elements");
    }
    expect(prepared.elements.map((element) => element.id)).toEqual([
      "rect-1",
      "table-1",
      "image-1",
    ]);
  });
});
