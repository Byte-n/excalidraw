import React from "react";

import {
  applySequenceOperation,
  getNonDeletedElements,
  isLinearElement,
  isSequenceLifelineElement,
  layoutElements,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { actionArrangeGrid, actionArrangeSequence } from "../actions";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

const { h } = window;

const positionsOf = (elements: readonly ExcalidrawElement[]) =>
  new Map(elements.map((element) => [element.id, [element.x, element.y]]));

describe("画布整理 action", () => {
  it("整理选中：网格坐标与纯布局一致", async () => {
    await render(<Excalidraw />);
    const elements = [
      API.createElement({
        type: "rectangle",
        id: "a",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        index: "a1" as never,
      }),
      API.createElement({
        type: "rectangle",
        id: "b",
        x: 300,
        y: 120,
        width: 120,
        height: 40,
        index: "a2" as never,
      }),
      API.createElement({
        type: "rectangle",
        id: "c",
        x: 80,
        y: 320,
        width: 80,
        height: 80,
        index: "a3" as never,
      }),
    ];
    API.setElements(elements);
    API.setSelectedElements(elements);

    const selected = h.app.scene.getSelectedElements(h.state);
    const expected = layoutElements(h.elements, {
      ids: selected.map((element) => element.id),
      algorithm: "grid",
    });

    act(() => {
      API.executeAction(actionArrangeGrid);
    });

    const after = positionsOf(h.elements);
    for (const element of expected.elements) {
      expect(after.get(element.id)).toEqual([element.x, element.y]);
    }
  });

  it("整理时序图：参与者与消息坐标与纯 sequence 布局一致", async () => {
    await render(<Excalidraw />);
    let elements = applySequenceOperation([], {
      action: "addParticipant",
      kind: "sc-lifeline-entity",
      position: { x: 0, y: 0 },
      text: "客户端",
    }).elements;
    elements = applySequenceOperation(elements, {
      action: "addParticipant",
      kind: "sc-lifeline-object",
      position: { x: 500, y: 0 },
      text: "服务端",
    }).elements;
    const participants = elements
      .filter(isSequenceLifelineElement)
      .map((element) => element.id);
    elements = applySequenceOperation(elements, {
      action: "addMessage",
      from: { participantId: participants[0] },
      to: { participantId: participants[1] },
      y: 260,
      text: "请求",
    }).elements;
    API.setElements(elements);
    const selected = getNonDeletedElements(elements);
    API.setSelectedElements([...selected]);

    const expected = layoutElements(elements, {
      ids: selected.map((element) => element.id),
      algorithm: "sequence",
    });

    act(() => {
      API.executeAction(actionArrangeSequence);
    });

    const after = new Map(h.elements.map((element) => [element.id, element]));
    for (const element of expected.elements) {
      if (element.isDeleted) {
        continue;
      }
      const actual = after.get(element.id);
      expect(actual).toBeTruthy();
      expect([actual!.x, actual!.y, actual!.width, actual!.height]).toEqual([
        element.x,
        element.y,
        element.width,
        element.height,
      ]);
      if (isLinearElement(element) && isLinearElement(actual!)) {
        expect(actual!.points).toEqual(element.points);
      }
    }
  });

  it("普通单选不可用，时序图单选可用于整理时序图", async () => {
    await render(<Excalidraw />);
    const rect = API.createElement({ type: "rectangle", x: 0, y: 0 });
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    expect(
      actionArrangeGrid.predicate?.(h.elements, h.state, h.app.props, h.app),
    ).toBe(false);

    const lifeline = getNonDeletedElements(
      applySequenceOperation([], {
        action: "addParticipant",
        kind: "sc-lifeline-entity",
        position: { x: 0, y: 0 },
        text: "参与者",
      }).elements,
    ).find(isSequenceLifelineElement)!;
    API.setElements([lifeline]);
    API.setSelectedElements([lifeline]);
    expect(
      actionArrangeSequence.predicate?.(
        h.elements,
        h.state,
        h.app.props,
        h.app,
      ),
    ).toBe(true);
  });
});
