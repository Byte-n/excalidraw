import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";

import { getTextFromElements } from "../src/textElement";
import { newElement } from "../src/newElement";
import { getTextElementStyle } from "../src/text/elementText";

describe("Test getTextFromElements", () => {
  it("reads standalone text and embedded body text from texts.body", () => {
    const text = API.createElement({
      type: "text",
      id: "standalone",
      text: "standalone",
    });
    const shape = newElement({
      type: "composite",
      shape: { id: "rectangle", schemaVersion: 1 },
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const withBody = {
      ...shape,
      texts: {
        body: { text: "embedded", style: getTextElementStyle(text) },
      },
    };

    expect(getTextFromElements([text, withBody])).toBe(
      "standalone\n\nembedded",
    );
  });
});
