import { reseed } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { fireEvent, render, waitFor } from "./test-utils";

const ownerDocument = () => window.document;

/** 底栏工具岛里某个工具组的触发按钮 */
const trigger = (testId = "toolbar-rectangle") =>
  ownerDocument().querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;

const optionsPanel = () =>
  ownerDocument().querySelector<HTMLElement>(".tool-popover-content");

const option = (testId: string) =>
  ownerDocument().querySelector<HTMLElement>(
    `.tool-popover-content [data-testid="${testId}"]`,
  );

// jsdom 没有 PointerEvent，fireEvent 建出来的事件不带 pointerType；
// 这里自建事件并补上该属性（React 的合成事件会照读）
const pointerMove = (
  type: "pointerover" | "pointerout",
  { pointerType = "mouse", relatedTarget = null as EventTarget | null } = {},
) => {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerType, relatedTarget });
  return event;
};

/** 从外部移入元素 */
const hoverIn = (el: HTMLElement, pointerType = "mouse") =>
  fireEvent(el, pointerMove("pointerover", { pointerType }));

/** 从元素移出到与之无关的目标 */
const hoverOut = (
  el: HTMLElement,
  to: EventTarget | null = ownerDocument().body,
) => fireEvent(el, pointerMove("pointerout", { relatedTarget: to }));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("toolbar option popover on hover", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    await render(<Excalidraw />);
  });

  it("shows the options when the pointer moves over the tool button", async () => {
    expect(optionsPanel()).toBeNull();

    hoverIn(trigger());

    await waitFor(() => expect(optionsPanel()).not.toBeNull());
    expect(option("toolbar-diamond")).not.toBeNull();
  });

  it("keeps the options open once the pointer moves onto them", async () => {
    hoverIn(trigger());
    await waitFor(() => expect(optionsPanel()).not.toBeNull());

    // 离开触发按钮、移入弹层：弹层与按钮同属悬停容器，指针仍在容器内，
    // 不触发关闭
    const shapeOption = option("toolbar-diamond")!;
    hoverOut(trigger(), shapeOption);
    hoverIn(shapeOption);

    await wait(400);
    expect(optionsPanel()).not.toBeNull();
  });

  it("closes the options when the pointer leaves them", async () => {
    hoverIn(trigger());
    await waitFor(() => expect(optionsPanel()).not.toBeNull());

    const shapeOption = option("toolbar-diamond")!;
    hoverIn(shapeOption);
    hoverOut(shapeOption);

    await waitFor(() => expect(optionsPanel()).toBeNull());
  });

  it("does not open on hover with a non-mouse pointer", async () => {
    hoverIn(trigger(), "touch");

    await wait(400);
    expect(optionsPanel()).toBeNull();
  });

  it("still toggles the options on click", async () => {
    fireEvent.click(trigger());
    await waitFor(() => expect(optionsPanel()).not.toBeNull());

    fireEvent.click(trigger());
    await waitFor(() => expect(optionsPanel()).toBeNull());
  });
});
