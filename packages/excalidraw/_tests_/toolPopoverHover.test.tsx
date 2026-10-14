import { reseed } from "@excalidraw/common";

import { Excalidraw } from "../index";

import {
  POPOVER_HOVER_CLOSE_DELAY,
  POPOVER_HOVER_OPEN_DELAY,
} from "../components/ToolPopover";

import { act, fireEvent, render } from "./test-utils";

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

/**
 * 悬停开合由定时器驱动，这里用假定时器把延迟变成确定的时间推进：
 * 断言不依赖真实时钟，全量测试跑满 CPU 时也不会超时。
 * 每个测试自行推进、并在结束时还原真实定时器。
 */
const withFakeTimers = (fn: () => void) => {
  vi.useFakeTimers();
  try {
    fn();
  } finally {
    vi.useRealTimers();
  }
};

/** 推进假定时器，并冲刷由此触发的 React 更新 */
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("toolbar option popover on hover", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    await render(<Excalidraw />);
  });

  it("shows the options when the pointer moves over the tool button", () => {
    withFakeTimers(() => {
      expect(optionsPanel()).toBeNull();

      hoverIn(trigger());

      // 扫过工具栏不连弹：延迟未到之前是收起的
      advance(POPOVER_HOVER_OPEN_DELAY - 1);
      expect(optionsPanel()).toBeNull();

      advance(1);
      expect(optionsPanel()).not.toBeNull();
      expect(option("toolbar-diamond")).not.toBeNull();
    });
  });

  it("keeps the options open once the pointer moves onto them", () => {
    withFakeTimers(() => {
      hoverIn(trigger());
      advance(POPOVER_HOVER_OPEN_DELAY);
      expect(optionsPanel()).not.toBeNull();

      // 离开触发按钮、移入弹层：弹层与按钮同属悬停容器，指针仍在容器内，
      // 不触发关闭
      const shapeOption = option("toolbar-diamond")!;
      hoverOut(trigger(), shapeOption);
      hoverIn(shapeOption);

      advance(POPOVER_HOVER_CLOSE_DELAY * 2);
      expect(optionsPanel()).not.toBeNull();
    });
  });

  it("closes the options when the pointer leaves them", () => {
    withFakeTimers(() => {
      hoverIn(trigger());
      advance(POPOVER_HOVER_OPEN_DELAY);

      const shapeOption = option("toolbar-diamond")!;
      hoverIn(shapeOption);
      hoverOut(shapeOption);

      // 延迟收起：留出穿过按钮与弹层间隙的时间
      advance(POPOVER_HOVER_CLOSE_DELAY - 1);
      expect(optionsPanel()).not.toBeNull();

      advance(1);
      expect(optionsPanel()).toBeNull();
    });
  });

  it("does not open on hover with a non-mouse pointer", () => {
    withFakeTimers(() => {
      hoverIn(trigger(), "touch");

      advance(POPOVER_HOVER_OPEN_DELAY * 2);
      expect(optionsPanel()).toBeNull();
    });
  });

  it("still toggles the options on click", () => {
    fireEvent.click(trigger());
    expect(optionsPanel()).not.toBeNull();

    fireEvent.click(trigger());
    expect(optionsPanel()).toBeNull();
  });
});
