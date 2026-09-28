import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { newElementWith } from "../src/mutateElement";
import { Scene } from "../src/Scene";
import { getFrameChildren, getFrameChildrenInsertionIndex } from "../src/frame";
import {
  assertValidFrameLikeContainerRefs,
  frameLikeContainerRef,
  hasBoundTextElement,
  isLinearElement,
  isTextElement,
} from "../src/typeChecks";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "../src/types";

describe("Test TypeChecks", () => {
  it("only treats nullish frame IDs as no parent", () => {
    expect(frameLikeContainerRef(null)).toBeUndefined();
    expect(frameLikeContainerRef(undefined)).toBeUndefined();
    expect(() => frameLikeContainerRef("")).toThrow(
      "Invalid frame-like container ID",
    );
  });

  it("validates frame-like container references", () => {
    const frame = API.createElement({ type: "frame" });
    const child = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });

    expect(() =>
      assertValidFrameLikeContainerRefs([frame, child]),
    ).not.toThrow();
    expect(() =>
      assertValidFrameLikeContainerRefs([
        frame,
        { ...child, containerRef: { kind: "frameLike", elementId: "missing" } },
      ]),
    ).toThrow("Invalid frame-like container reference");
    expect(() =>
      assertValidFrameLikeContainerRefs([
        frame,
        { ...child, containerRef: null } as unknown as ExcalidrawElement,
      ]),
    ).toThrow("Invalid container reference");
    expect(() =>
      assertValidFrameLikeContainerRefs([
        frame,
        { ...child, containerRef: "" } as unknown as ExcalidrawElement,
      ]),
    ).toThrow("Invalid container reference");
    for (const elementId of [0, null, undefined, "", false]) {
      expect(() =>
        assertValidFrameLikeContainerRefs([
          frame,
          {
            ...child,
            containerRef: { kind: "frameLike", elementId },
          } as unknown as ExcalidrawElement,
        ]),
      ).toThrow("Invalid container reference");
    }
  });

  it("enforces frame-like container references at scene boundaries", () => {
    const frame = API.createElement({
      type: "frame",
      index: "a0" as ExcalidrawElement["index"],
    });
    const child = API.createElement({
      type: "rectangle",
      index: "a1" as ExcalidrawElement["index"],
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    const scene = new Scene([frame, child]);

    expect(() =>
      scene.replaceAllElements([
        frame,
        newElementWith(child, {
          containerRef: { kind: "frameLike", elementId: "missing" },
        }),
      ]),
    ).toThrow("Invalid frame-like container reference");

    expect(() =>
      scene.mutateElement(child, {
        containerRef: { kind: "frameLike", elementId: "missing" },
      }),
    ).toThrow("Invalid container reference");

    expect(() =>
      scene.replaceAllElements([
        frame,
        { ...child, containerRef: null } as unknown as ExcalidrawElement,
      ]),
    ).toThrow("Invalid container reference");
    expect(() =>
      scene.mutateElement(child, {
        containerRef: null,
      } as unknown as Parameters<typeof scene.mutateElement>[1]),
    ).toThrow("Invalid container reference");
    expect(() =>
      scene.mutateElement(child, {
        containerRef: { kind: "frameLike", elementId: 0 },
      } as unknown as Parameters<typeof scene.mutateElement>[1]),
    ).toThrow("Invalid container reference");

    expect(() =>
      scene.mutateElement(frame as ExcalidrawElement, { isDeleted: true }),
    ).toThrow("with children");
    expect(frame.isDeleted).toBe(false);
  });

  it("rejects a deleted parent and a second parent on bound text", () => {
    const deletedFrame = API.createElement({ type: "frame", isDeleted: true });
    const child = API.createElement({ type: "rectangle" });
    const scene = new Scene([deletedFrame, child]);

    expect(() =>
      scene.mutateElement(child, {
        containerRef: { kind: "frameLike", elementId: deletedFrame.id },
      }),
    ).toThrow("Invalid container reference");

    const frame = API.createElement({ type: "frame" });
    const owner = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    const label = API.createElement({
      type: "text",
      containerId: owner.id,
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    expect(() =>
      assertValidFrameLikeContainerRefs([frame, owner, label]),
    ).toThrow("cannot have a containerRef");
  });

  it("keeps frame children in scene order after changing a parent", () => {
    const frame = API.createElement({ type: "frame" });
    const first = API.createElement({ type: "rectangle" });
    const second = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    const scene = new Scene([frame, first, second]);

    scene.mutateElement(first, {
      containerRef: { kind: "frameLike", elementId: frame.id },
    });

    expect(
      getFrameChildren(scene.getElementsIncludingDeleted(), frame.id),
    ).toEqual([first, second]);
  });

  it("inserts a frame child after its owner's bound text", () => {
    const frame = API.createElement({ type: "frame" });
    const owner = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    const label = API.createElement({ type: "text", containerId: owner.id });

    expect(
      getFrameChildrenInsertionIndex([frame, owner, label], frame.id),
    ).toBe(3);
  });

  describe("Test hasBoundTextElement", () => {
    it("should return true for text bindable containers with bound text", () => {
      expect(
        hasBoundTextElement(
          API.createElement({
            type: "rectangle",
            boundElements: [{ type: "text", id: "text-id" }],
          }),
        ),
      ).toBeTruthy();

      expect(
        hasBoundTextElement(
          API.createElement({
            type: "ellipse",
            boundElements: [{ type: "text", id: "text-id" }],
          }),
        ),
      ).toBeTruthy();

      expect(
        hasBoundTextElement(
          API.createElement({
            type: "arrow",
            boundElements: [{ type: "text", id: "text-id" }],
          }),
        ),
      ).toBeTruthy();
    });

    it("should return false for text bindable containers without bound text", () => {
      expect(
        hasBoundTextElement(
          API.createElement({
            type: "freedraw",
            boundElements: [{ type: "arrow", id: "arrow-id" }],
          }),
        ),
      ).toBeFalsy();
    });

    it("should return false for non text bindable containers", () => {
      expect(
        hasBoundTextElement(
          API.createElement({
            type: "freedraw",
            boundElements: [{ type: "text", id: "text-id" }],
          }),
        ),
      ).toBeFalsy();
    });

    expect(
      hasBoundTextElement(
        API.createElement({
          type: "image",
          boundElements: [{ type: "text", id: "text-id" }],
        }),
      ),
    ).toBeFalsy();
  });
});

describe("Test NonDeleted type", () => {
  it("should only allow `isDeleted: false` elements", () => {
    const element = API.createElement({ type: "rectangle" });
    const deletedElement = newElementWith(element as ExcalidrawElement, {
      isDeleted: true,
    });

    // @ts-expect-error deleted elements are not assignable to NonDeleted
    const nonDeleted: NonDeletedExcalidrawElement = deletedElement;

    // runtime narrowing is still required to treat an element as non-deleted
    // @ts-expect-error generic elements are not assignable to NonDeleted
    const nonDeletedGeneric: NonDeletedExcalidrawElement =
      deletedElement as ExcalidrawElement;

    expect(nonDeleted.isDeleted).toBe(true);
    expect(nonDeletedGeneric.isDeleted).toBe(true);
  });

  it("should be preserved by type guards", () => {
    const elements: NonDeletedExcalidrawElement[] = [
      API.createElement({ type: "text", text: "text" }),
      API.createElement({ type: "arrow" }),
    ];

    const textElements: NonDeleted<ExcalidrawTextElement>[] =
      elements.filter(isTextElement);
    const linearElements: NonDeleted<ExcalidrawLinearElement>[] =
      elements.filter(isLinearElement);

    expect(textElements.length).toBe(1);
    expect(linearElements.length).toBe(1);
  });
});
