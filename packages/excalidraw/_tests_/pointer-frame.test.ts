import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";

import { resolveInteractionTarget } from "../components/app/interactionTarget";
import {
  isSamePointerFrame,
  registerPointerTargetProvider,
  resolvePointerFrame,
  type PointerFrame,
  type PointerFrameInput,
  type PointerTarget,
} from "../components/app/pointerFrame";
import { AppPointerState } from "../components/app/pointerState";

const pt = (x: number, y: number) => pointFrom<GlobalPoint>(x, y);

vi.mock("../components/app/interactionTarget", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../components/app/interactionTarget")
  >();
  return { ...actual, resolveInteractionTarget: vi.fn() };
});

const resolveBase = vi.mocked(resolveInteractionTarget);

const app = { state: { zoom: { value: 1 } } } as any;

const input = (
  overrides: Partial<PointerFrameInput> = {},
): PointerFrameInput => ({
  point: pt(0, 0),
  phase: "hover",
  mode: "selection",
  pointerType: "mouse",
  ...overrides,
});

const makeFrame = (
  target: PointerTarget,
  overrides: Partial<PointerFrame> = {},
): PointerFrame => ({
  phase: "hover",
  point: pt(0, 0),
  target,
  pointerType: "mouse",
  ...overrides,
});

let cleanups: (() => void)[] = [];

const stub = <K extends PointerTarget["kind"]>(
  kind: K,
  resolve: (
    app: any,
    input: PointerFrameInput,
  ) => Extract<PointerTarget, { kind: K }> | null,
) => {
  cleanups.push(registerPointerTargetProvider({ kind, resolve } as any));
};

beforeEach(() => {
  resolveBase.mockReset();
  resolveBase.mockReturnValue({ kind: "canvas" });
});

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
});

describe("resolvePointerFrame priority", () => {
  it("keeps the text handle above the composite control provider", () => {
    resolveBase.mockReturnValue({ kind: "textHandle", elementId: "text-1" });
    stub("compositeControl", () => ({
      kind: "compositeControl",
      elementId: "rect-1",
      control: { kind: "cube-depth", x: 0, y: 0 },
    }));

    expect(resolvePointerFrame(app, input()).target).toEqual({
      kind: "textHandle",
      elementId: "text-1",
    });
  });

  it("resolves the composite control before a transform handle", () => {
    resolveBase.mockReturnValue({
      kind: "transformHandle",
      elementId: "rect-1",
      handle: "nw",
    });
    stub("compositeControl", () => ({
      kind: "compositeControl",
      elementId: "rect-1",
      control: { kind: "cube-depth", x: 1, y: 2 },
    }));

    expect(resolvePointerFrame(app, input()).target).toEqual({
      kind: "compositeControl",
      elementId: "rect-1",
      control: { kind: "cube-depth", x: 1, y: 2 },
    });
  });

  it("keeps the transform handle when no composite control reports", () => {
    const base = {
      kind: "transformHandle",
      elementId: "rect-1",
      handle: "nw",
    } as const;
    resolveBase.mockReturnValue(base);
    stub("compositeControl", () => null);

    expect(resolvePointerFrame(app, input()).target).toEqual(base);
  });

  it("orders quickCreateHandle > activationEdge > poleActivation", () => {
    stub("compositeControl", () => null);
    stub("quickCreateHandle", () => ({
      kind: "quickCreateHandle",
      elementId: "rect-1",
      direction: "right",
    }));
    stub("activationEdge", () => ({
      kind: "activationEdge",
      elementId: "activation-1",
      side: "right",
      point: pt(10, 10),
    }));
    stub("poleActivation", () => ({
      kind: "poleActivation",
      lifelineId: "lifeline-1",
      placement: {
        center: { x: 0, y: 0 },
        angle: 0 as any,
        localY: 0,
      },
    }));

    expect(resolvePointerFrame(app, input()).target.kind).toBe(
      "quickCreateHandle",
    );
  });

  it("orders activationEdge > poleActivation", () => {
    stub("compositeControl", () => null);
    stub("activationEdge", () => ({
      kind: "activationEdge",
      elementId: "activation-1",
      side: "right",
      point: pt(10, 10),
    }));
    stub("poleActivation", () => ({
      kind: "poleActivation",
      lifelineId: "lifeline-1",
      placement: {
        center: { x: 0, y: 0 },
        angle: 0 as any,
        localY: 0,
      },
    }));

    expect(resolvePointerFrame(app, input()).target.kind).toBe(
      "activationEdge",
    );
  });

  it("falls back to poleActivation when nothing else reports", () => {
    stub("compositeControl", () => null);
    stub("poleActivation", () => ({
      kind: "poleActivation",
      lifelineId: "lifeline-1",
      placement: {
        center: { x: 0, y: 0 },
        angle: 0 as any,
        localY: 0,
      },
    }));

    expect(resolvePointerFrame(app, input()).target.kind).toBe(
      "poleActivation",
    );
  });

  it("returns the base target when a provider is not registered", () => {
    const base = { kind: "element", elementId: "rect-1" } as const;
    resolveBase.mockReturnValue(base);
    stub("compositeControl", () => null);

    expect(resolvePointerFrame(app, input()).target).toEqual(base);
  });

  it("propagates provider errors instead of falling back", () => {
    stub("compositeControl", () => {
      throw new Error("provider boom");
    });

    expect(() => resolvePointerFrame(app, input())).toThrow("provider boom");
  });

  it("resolves connection targets only in arrow mode", () => {
    resolveBase.mockReturnValue({
      kind: "selectedElement",
      elementId: "rect-1",
    });
    const connection = {
      kind: "connection",
      elementId: "rect-1",
      hit: { tier: "anchor", point: { x: 1, y: 2 }, anchors: [] } as any,
    } as const;
    stub("connection", () => connection);

    expect(resolvePointerFrame(app, input({ mode: "arrow" })).target).toEqual(
      connection,
    );
  });

  it("degrades selection handles to canvas in arrow mode", () => {
    resolveBase.mockReturnValue({
      kind: "transformHandle",
      elementId: "rect-1",
      handle: "nw",
    });

    expect(resolvePointerFrame(app, input({ mode: "arrow" })).target).toEqual({
      kind: "canvas",
    });
  });

  it("does not resolve the base in shape / other mode", () => {
    expect(resolvePointerFrame(app, input({ mode: "shape" })).target).toEqual({
      kind: "canvas",
    });
    expect(resolvePointerFrame(app, input({ mode: "other" })).target).toEqual({
      kind: "canvas",
    });
    expect(resolveBase).not.toHaveBeenCalled();
  });
});

describe("isSamePointerFrame", () => {
  const canvas = makeFrame({ kind: "canvas" });

  it("treats identical frames as equal", () => {
    expect(isSamePointerFrame(canvas, makeFrame({ kind: "canvas" }))).toBe(
      true,
    );
    expect(isSamePointerFrame(canvas, canvas)).toBe(true);
  });

  it("compares phase, point and target kind", () => {
    expect(
      isSamePointerFrame(
        canvas,
        makeFrame({ kind: "canvas" }, { phase: "armed" }),
      ),
    ).toBe(false);
    expect(
      isSamePointerFrame(
        canvas,
        makeFrame({ kind: "canvas" }, { point: pt(10, 0) }),
      ),
    ).toBe(false);
    expect(
      isSamePointerFrame(
        makeFrame({ kind: "element", elementId: "rect-1" }),
        makeFrame({ kind: "canvas" }),
      ),
    ).toBe(false);
  });

  it("ignores sub-epsilon point differences", () => {
    expect(
      isSamePointerFrame(
        canvas,
        makeFrame({ kind: "canvas" }, { point: pt(1e-7, 0) }),
      ),
    ).toBe(true);
  });

  it("compares payload identity for the new kinds", () => {
    const hit = { tier: "anchor", point: { x: 1, y: 2 }, anchors: [] } as any;
    const connection = makeFrame({
      kind: "connection",
      elementId: "rect-1",
      hit,
    });
    expect(
      isSamePointerFrame(
        connection,
        makeFrame({ kind: "connection", elementId: "rect-1", hit }),
      ),
    ).toBe(true);
    expect(
      isSamePointerFrame(
        connection,
        makeFrame({
          kind: "connection",
          elementId: "rect-1",
          hit: { ...hit },
        }),
      ),
    ).toBe(false);

    expect(
      isSamePointerFrame(
        makeFrame({
          kind: "quickCreateHandle",
          elementId: "rect-1",
          direction: "right",
        }),
        makeFrame({
          kind: "quickCreateHandle",
          elementId: "rect-1",
          direction: "left",
        }),
      ),
    ).toBe(false);

    const control = { kind: "cube-depth", x: 5, y: 6 } as const;
    expect(
      isSamePointerFrame(
        makeFrame({ kind: "compositeControl", elementId: "rect-1", control }),
        makeFrame({
          kind: "compositeControl",
          elementId: "rect-1",
          control: { ...control },
        }),
      ),
    ).toBe(true);
    expect(
      isSamePointerFrame(
        makeFrame({
          kind: "poleActivation",
          lifelineId: "lifeline-1",
          placement: { center: { x: 0, y: 0 }, angle: 0 as any, localY: 0 },
        }),
        makeFrame({
          kind: "poleActivation",
          lifelineId: "lifeline-1",
          placement: { center: { x: 0, y: 0 }, angle: 0 as any, localY: 1 },
        }),
      ),
    ).toBe(false);
  });
});

describe("AppPointerState", () => {
  const createState = () => {
    const repaint = { request: vi.fn() };
    return { state: new AppPointerState({ repaint } as any), repaint };
  };

  it("does not repaint when the frame is unchanged", () => {
    const { state, repaint } = createState();
    const frame = makeFrame({ kind: "canvas" });

    expect(state.setFrame(frame)).toBe(true);
    expect(repaint.request).toHaveBeenCalledTimes(1);

    expect(
      state.setFrame(makeFrame({ kind: "canvas" }, { point: pt(0, 0) })),
    ).toBe(false);
    expect(repaint.request).toHaveBeenCalledTimes(1);
  });

  it("repaints once per changed target or point", () => {
    const { state, repaint } = createState();

    state.setFrame(makeFrame({ kind: "canvas" }));
    state.setFrame(makeFrame({ kind: "element", elementId: "rect-1" }));
    expect(repaint.request).toHaveBeenCalledTimes(2);

    state.setFrame(
      makeFrame(
        { kind: "element", elementId: "rect-1" },
        { point: pt(20, 20) },
      ),
    );
    expect(repaint.request).toHaveBeenCalledTimes(3);
  });

  it("clears idempotently", () => {
    const { state, repaint } = createState();
    state.setFrame(makeFrame({ kind: "canvas" }));
    repaint.request.mockClear();

    expect(state.clear()).toBe(true);
    expect(state.getFrame()).toBeNull();
    expect(repaint.request).toHaveBeenCalledTimes(1);

    expect(state.clear()).toBe(false);
    expect(repaint.request).toHaveBeenCalledTimes(1);
  });
});
