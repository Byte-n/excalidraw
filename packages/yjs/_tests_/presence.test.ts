import {
  createPresenceThrottle,
  presenceViewportBounds,
  shouldUnfollow,
} from "../src/index";

test("presence throttle sends trailing state and immediate release cancels it", () => {
  vi.useFakeTimers();
  let now = 0;
  const emit = vi.fn();
  const throttle = createPresenceThrottle(33, emit, () => now);
  throttle.markSent();
  now = 10;
  throttle.schedule();
  throttle.schedule();
  now = 33;
  vi.advanceTimersByTime(23);
  expect(emit).toHaveBeenCalledTimes(1);
  now = 34;
  throttle.schedule();
  throttle.markSent();
  vi.advanceTimersByTime(33);
  expect(emit).toHaveBeenCalledTimes(1);
  throttle.cancel();
  vi.useRealTimers();
});

test("viewport uses scene coordinates and only matching manual navigation unfollows", () => {
  expect(
    presenceViewportBounds({
      scrollX: -10,
      scrollY: 20,
      width: 100,
      height: 200,
      zoom: { value: 2 },
    }),
  ).toEqual({ minX: 10, minY: -20, maxX: 60, maxY: 80 });
  expect(shouldUnfollow("a", "a", "programmatic")).toBe(false);
  expect(shouldUnfollow("b", "a", "manual")).toBe(false);
  expect(shouldUnfollow("a", "a", "manual")).toBe(true);
});
