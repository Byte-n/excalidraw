import { CURSOR_TYPE } from "@excalidraw/common";

import { TABLE_STRUCTURE_ZONE_SIZE } from "../components/app/table";
import {
  clearContainerInteractionHover,
  dispatchContainerInteraction,
  registerContainerInteractionProvider,
  resolveInteractionTarget,
  type ContainerInteractionCandidate,
  type ContainerInteractionProvider,
  type InteractionTarget,
} from "../components/app/interactionTarget";

const editorInterface = {
  formFactor: "desktop",
  userAgent: { isMobileDevice: false },
} as any;

const rectElement = (id: string, x = 1000, y = 1000) =>
  ({
    id,
    type: "rectangle",
    x,
    y,
    width: 100,
    height: 100,
    angle: 0,
    locked: false,
  } as any);

const tableElement = (id = "table-1", locked = false) =>
  ({
    id,
    type: "table",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    angle: 0,
    locked,
    table: {
      rows: [{ id: "row-1", height: 100 }],
      columns: [{ id: "column-1", width: 200 }],
    },
  } as any);

const createMockApp = ({
  elements = [],
  selectedElements = [],
  selectedIds = {},
  hitElement = null,
  hitTextAutoResizeHandle = false,
  tableStructureHover = null,
}: {
  elements?: any[];
  selectedElements?: any[];
  selectedIds?: Record<string, true>;
  hitElement?: any;
  hitTextAutoResizeHandle?: boolean;
  tableStructureHover?: any;
} = {}) => {
  return {
    state: {
      selectedElementIds: selectedIds,
      selectedLinearElement: null,
      zoom: { value: 1 },
      tableStructureHover,
    },
    scene: {
      getNonDeletedElements: () => elements,
      getSelectedElements: () => selectedElements,
      getNonDeletedElementsMap: () => new Map(),
    },
    getElementAtPosition: () => hitElement,
    getTopLayerFrameAtSceneCoords: () => null,
    isHittingTextAutoResizeHandle: () => hitTextAutoResizeHandle,
    editorInterface,
    cursor: { set: vi.fn() },
    setState: vi.fn(),
  } as any;
};

/** The scene point on the table's left reorder rail. */
const railPoint = (table: any) => ({
  x: table.x - TABLE_STRUCTURE_ZONE_SIZE / 2,
  y: table.y + table.height / 2,
});

/** The scene point inside the table grid, clear of every zone. */
const bodyPoint = (table: any) => ({
  x: table.x + table.width / 2,
  y: table.y + table.height / 2,
});

interface MockProviderHandles {
  cursor?: string;
  candidate?: ContainerInteractionCandidate | null;
  renderHover?: ReturnType<typeof vi.fn>;
  clearHover?: ReturnType<typeof vi.fn>;
}

const registerMockProvider = ({
  cursor = "",
  candidate = null,
  renderHover = vi.fn(),
  clearHover = vi.fn(),
}: MockProviderHandles = {}) => {
  const provider: ContainerInteractionProvider = {
    getInteractionCandidate: () => candidate,
    getCursor: () => cursor,
    renderHover,
    clearHover,
  };
  return {
    provider,
    renderHover,
    clearHover,
    unregister: registerContainerInteractionProvider(provider),
  };
};

const mockCandidate = (
  overrides: Partial<ContainerInteractionCandidate> = {},
): ContainerInteractionCandidate => ({
  containerId: "container-1",
  control: "border",
  priority: 100,
  ...overrides,
});

describe("resolveInteractionTarget", () => {
  it("resolves the canvas when nothing is under the pointer", () => {
    const app = createMockApp();
    expect(resolveInteractionTarget(app, { x: 0, y: 0 })).toEqual({
      kind: "canvas",
    });
  });

  it("resolves an unlocked hit element and skips locked ones", () => {
    const rect = rectElement("rect-1");
    const app = createMockApp({ hitElement: rect });
    expect(resolveInteractionTarget(app, { x: 0, y: 0 })).toEqual({
      kind: "element",
      elementId: "rect-1",
    });

    const locked = { ...rect, locked: true };
    const lockedApp = createMockApp({ hitElement: locked });
    expect(resolveInteractionTarget(lockedApp, { x: 0, y: 0 })).toEqual({
      kind: "canvas",
    });
  });

  it("resolves a selected hit element", () => {
    const rect = rectElement("rect-1");
    const app = createMockApp({
      hitElement: rect,
      selectedElements: [rect],
      selectedIds: { "rect-1": true },
    });
    expect(resolveInteractionTarget(app, { x: 0, y: 0 })).toEqual({
      kind: "selectedElement",
      elementId: "rect-1",
    });
  });

  it("prefers the text auto-resize handle over container zones", () => {
    const table = tableElement();
    const text = { id: "text-1", type: "text", locked: false } as any;
    const app = createMockApp({
      elements: [table],
      selectedElements: [text],
      selectedIds: { "text-1": true },
      hitTextAutoResizeHandle: true,
    });
    expect(resolveInteractionTarget(app, railPoint(table))).toEqual({
      kind: "textHandle",
      elementId: "text-1",
    });
  });

  describe("table structure zones (real provider)", () => {
    it("resolves an unselected table rail to a container control", () => {
      const table = tableElement();
      const app = createMockApp({ elements: [table] });
      expect(resolveInteractionTarget(app, railPoint(table))).toMatchObject({
        kind: "containerControl",
        containerId: "table-1",
        control: "reorder",
      });
    });

    it("a selected normal element keeps priority over the rail", () => {
      const table = tableElement();
      const rect = rectElement("rect-1");
      const app = createMockApp({
        elements: [table],
        selectedElements: [rect],
        selectedIds: { "rect-1": true },
        hitElement: rect,
      });
      expect(resolveInteractionTarget(app, railPoint(table))).toEqual({
        kind: "selectedElement",
        elementId: "rect-1",
      });
    });

    it("an unselected element does not beat the rail", () => {
      const table = tableElement();
      const rect = rectElement("rect-1");
      const app = createMockApp({
        elements: [table],
        hitElement: rect,
      });
      expect(resolveInteractionTarget(app, railPoint(table))).toMatchObject({
        kind: "containerControl",
        containerId: "table-1",
      });
    });

    it("a selected table keeps its own structure zones", () => {
      const table = tableElement();
      const app = createMockApp({
        elements: [table],
        selectedElements: [table],
        selectedIds: { "table-1": true },
        hitElement: table,
      });
      expect(resolveInteractionTarget(app, railPoint(table))).toMatchObject({
        kind: "containerControl",
        containerId: "table-1",
        control: "reorder",
      });
    });

    it("resolves the table body to containerBody and yields to hits", () => {
      const table = tableElement();
      const emptyApp = createMockApp({ elements: [table] });
      const target = resolveInteractionTarget(emptyApp, bodyPoint(table));
      expect(target).toMatchObject({
        kind: "containerBody",
        containerId: "table-1",
      });

      const rect = rectElement("rect-1");
      const coveredApp = createMockApp({
        elements: [table],
        hitElement: rect,
      });
      expect(resolveInteractionTarget(coveredApp, bodyPoint(table))).toEqual({
        kind: "element",
        elementId: "rect-1",
      });
    });

    it("locked tables expose no structure zones", () => {
      const table = tableElement("table-1", true);
      const app = createMockApp({
        elements: [table],
        hitElement: table,
      });
      expect(resolveInteractionTarget(app, railPoint(table))).toEqual({
        kind: "canvas",
      });
    });
  });

  describe("container candidate priorities", () => {
    it("resolves the highest-priority candidate", () => {
      const app = createMockApp();
      const high = registerMockProvider({
        candidate: mockCandidate({ containerId: "high", priority: 100 }),
      });
      const low = registerMockProvider({
        candidate: mockCandidate({ containerId: "low", priority: 50 }),
      });
      try {
        expect(resolveInteractionTarget(app, { x: 0, y: 0 })).toMatchObject({
          kind: "containerControl",
          containerId: "high",
        });
      } finally {
        high.unregister();
        low.unregister();
      }
    });

    it("a selected container beats another container's control zone", () => {
      const table = tableElement();
      const frameBorder = registerMockProvider({
        candidate: mockCandidate({
          containerId: "frame-1",
          control: "border",
          priority: 50,
        }),
      });
      try {
        // the table is not in the scene here, so only the foreign frame
        // candidate competes with the selected table
        const app = createMockApp({
          selectedElements: [table],
          selectedIds: { "table-1": true },
          hitElement: table,
        });
        expect(resolveInteractionTarget(app, railPoint(table))).toEqual({
          kind: "selectedElement",
          elementId: "table-1",
        });
      } finally {
        frameBorder.unregister();
      }
    });

    it("new containers join through registration only", () => {
      const app = createMockApp();
      const before = resolveInteractionTarget(app, { x: 0, y: 0 });
      const mock = registerMockProvider({
        candidate: mockCandidate({ containerId: "custom" }),
      });
      try {
        expect(resolveInteractionTarget(app, { x: 0, y: 0 })).toMatchObject({
          kind: "containerControl",
          containerId: "custom",
        });
      } finally {
        mock.unregister();
      }
      expect(resolveInteractionTarget(app, { x: 0, y: 0 })).toEqual(before);
    });
  });

  it("resolves the same target for hover and pointer-down", () => {
    const table = tableElement();
    const rect = rectElement("rect-1");
    const app = createMockApp({
      elements: [table],
      selectedElements: [rect],
      selectedIds: { "rect-1": true },
      hitElement: rect,
    });
    const hoverTarget: InteractionTarget = resolveInteractionTarget(
      app,
      railPoint(table),
    );
    // pointer-down resolves with the same inputs (origin + native event)
    const downTarget: InteractionTarget = resolveInteractionTarget(
      app,
      railPoint(table),
      { pointerType: "mouse" },
    );
    expect(downTarget).toEqual(hoverTarget);
  });
});

describe("container interaction dispatch", () => {
  it("routes hover state and cursor through the producing provider", () => {
    const table = tableElement();
    const app = createMockApp({ elements: [table] });
    const target = resolveInteractionTarget(app, railPoint(table));
    expect(target.kind).toBe("containerControl");

    dispatchContainerInteraction(
      app,
      (target as Extract<InteractionTarget, { kind: "containerControl" }>)
        .candidate,
    );
    expect(app.cursor.set).toHaveBeenCalledWith(CURSOR_TYPE.MOVE);
    expect(app.setState).toHaveBeenCalledWith({
      tableStructureHover: expect.objectContaining({
        tableId: "table-1",
        kind: "rowGrip",
      }),
    });
  });

  it("derives the table body reveal from the containerBody target", () => {
    const table = tableElement();
    const app = createMockApp({ elements: [table] });
    const target = resolveInteractionTarget(app, bodyPoint(table));
    expect(target.kind).toBe("containerBody");

    dispatchContainerInteraction(
      app,
      (target as Extract<InteractionTarget, { kind: "containerBody" }>)
        .candidate,
    );
    expect(app.setState).toHaveBeenCalledWith({
      tableStructureHover: { tableId: "table-1", kind: "table" },
    });
    // the body reveal keeps the tool default (AUTO is an empty cursor), so
    // the dispatch must not override the cursor
    expect(app.cursor.set).not.toHaveBeenCalled();
  });

  it("leaves the cursor untouched when the provider reports none", () => {
    const app = createMockApp();
    const mock = registerMockProvider({
      candidate: mockCandidate(),
      cursor: "",
    });
    try {
      const target = resolveInteractionTarget(app, { x: 0, y: 0 });
      dispatchContainerInteraction(
        app,
        (target as Extract<InteractionTarget, { kind: "containerControl" }>)
          .candidate,
      );
      expect(app.cursor.set).not.toHaveBeenCalled();
      expect(mock.renderHover).toHaveBeenCalledWith(
        app,
        expect.objectContaining({ containerId: "container-1" }),
      );
    } finally {
      mock.unregister();
    }
  });

  it("clears every provider's hover state for non-container targets", () => {
    const table = tableElement();
    const app = createMockApp({
      elements: [table],
      tableStructureHover: { tableId: "table-1", kind: "rowGrip" } as any,
    });
    const first = registerMockProvider({ candidate: null });
    const second = registerMockProvider({ candidate: null });
    try {
      clearContainerInteractionHover(app);
      expect(first.clearHover).toHaveBeenCalledWith(app);
      expect(second.clearHover).toHaveBeenCalledWith(app);
      // the built-in table provider clears its shared channel too
      expect(app.setState).toHaveBeenCalledWith({
        tableStructureHover: null,
      });
    } finally {
      first.unregister();
      second.unregister();
    }
  });
});
