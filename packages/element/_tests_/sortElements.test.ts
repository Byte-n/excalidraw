import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";

import { normalizeElementOrder } from "../src/sortElements";

import type { ExcalidrawElement } from "../src/types";

const assertOrder = (
  elements: readonly ExcalidrawElement[],
  expectedOrder: string[],
) => {
  const actualOrder = elements.map((element) => element.id);
  expect(actualOrder).toEqual(expectedOrder);
};

describe("normalizeElementsOrder", () => {
  it("normalize group order", () => {
    assertOrder(
      normalizeElementOrder([
        API.createElement({
          id: "A_rect1",
          type: "rectangle",
          groupIds: ["A"],
        }),
        API.createElement({
          id: "rect2",
          type: "rectangle",
        }),
        API.createElement({
          id: "rect3",
          type: "rectangle",
        }),
        API.createElement({
          id: "A_rect4",
          type: "rectangle",
          groupIds: ["A"],
        }),
        API.createElement({
          id: "A_rect5",
          type: "rectangle",
          groupIds: ["A"],
        }),
        API.createElement({
          id: "rect6",
          type: "rectangle",
        }),
        API.createElement({
          id: "A_rect7",
          type: "rectangle",
          groupIds: ["A"],
        }),
      ]),
      ["A_rect1", "A_rect4", "A_rect5", "A_rect7", "rect2", "rect3", "rect6"],
    );
    assertOrder(
      normalizeElementOrder([
        API.createElement({
          id: "A_rect1",
          type: "rectangle",
          groupIds: ["A"],
        }),
        API.createElement({
          id: "rect2",
          type: "rectangle",
        }),
        API.createElement({
          id: "B_rect3",
          type: "rectangle",
          groupIds: ["B"],
        }),
        API.createElement({
          id: "A_rect4",
          type: "rectangle",
          groupIds: ["A"],
        }),
        API.createElement({
          id: "B_rect5",
          type: "rectangle",
          groupIds: ["B"],
        }),
        API.createElement({
          id: "rect6",
          type: "rectangle",
        }),
        API.createElement({
          id: "A_rect7",
          type: "rectangle",
          groupIds: ["A"],
        }),
      ]),
      ["A_rect1", "A_rect4", "A_rect7", "rect2", "B_rect3", "B_rect5", "rect6"],
    );
    // nested groups
    assertOrder(
      normalizeElementOrder([
        API.createElement({
          id: "A_rect1",
          type: "rectangle",
          groupIds: ["A"],
        }),
        API.createElement({
          id: "BA_rect2",
          type: "rectangle",
          groupIds: ["B", "A"],
        }),
      ]),
      ["A_rect1", "BA_rect2"],
    );
    assertOrder(
      normalizeElementOrder([
        API.createElement({
          id: "BA_rect1",
          type: "rectangle",
          groupIds: ["B", "A"],
        }),
        API.createElement({
          id: "A_rect2",
          type: "rectangle",
          groupIds: ["A"],
        }),
      ]),
      ["BA_rect1", "A_rect2"],
    );
    assertOrder(
      normalizeElementOrder([
        API.createElement({
          id: "BA_rect1",
          type: "rectangle",
          groupIds: ["B", "A"],
        }),
        API.createElement({
          id: "A_rect2",
          type: "rectangle",
          groupIds: ["A"],
        }),
        API.createElement({
          id: "CBA_rect3",
          type: "rectangle",
          groupIds: ["C", "B", "A"],
        }),
        API.createElement({
          id: "rect4",
          type: "rectangle",
        }),
        API.createElement({
          id: "A_rect5",
          type: "rectangle",
          groupIds: ["A"],
        }),
        API.createElement({
          id: "BA_rect5",
          type: "rectangle",
          groupIds: ["B", "A"],
        }),
        API.createElement({
          id: "BA_rect6",
          type: "rectangle",
          groupIds: ["B", "A"],
        }),
        API.createElement({
          id: "CBA_rect7",
          type: "rectangle",
          groupIds: ["C", "B", "A"],
        }),
        API.createElement({
          id: "X_rect8",
          type: "rectangle",
          groupIds: ["X"],
        }),
        API.createElement({
          id: "rect9",
          type: "rectangle",
        }),
        API.createElement({
          id: "YX_rect10",
          type: "rectangle",
          groupIds: ["Y", "X"],
        }),
        API.createElement({
          id: "X_rect11",
          type: "rectangle",
          groupIds: ["X"],
        }),
      ]),
      [
        "BA_rect1",
        "CBA_rect3",
        "CBA_rect7",
        "BA_rect5",
        "BA_rect6",
        "A_rect2",
        "A_rect5",
        "rect4",
        "X_rect8",
        "YX_rect10",
        "X_rect11",
        "rect9",
      ],
    );
    assertOrder(
      normalizeElementOrder([
        API.createElement({
          id: "A_rect1",
          type: "rectangle",
          groupIds: ["A"],
        }),
        API.createElement({
          id: "CBA_rect2",
          type: "rectangle",
          groupIds: ["C", "B", "A"],
        }),
        API.createElement({
          id: "A_rect3",
          type: "rectangle",
          groupIds: ["A"],
        }),
      ]),
      ["A_rect1", "CBA_rect2", "A_rect3"],
    );
    assertOrder(
      normalizeElementOrder([
        API.createElement({
          id: "abcT_rect1",
          type: "rectangle",
          groupIds: ["ab", "c", "T"],
        }),
        API.createElement({
          id: "abcT_rect2",
          type: "rectangle",
          groupIds: ["a", "bc", "T"],
        }),
        API.createElement({
          id: "abcT_rect3",
          type: "rectangle",
          groupIds: ["ab", "c", "T"],
        }),
      ]),
      ["abcT_rect1", "abcT_rect3", "abcT_rect2"],
    );
  });
});
