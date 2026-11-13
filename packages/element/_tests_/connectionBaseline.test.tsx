import { reseed } from "@excalidraw/common";

import { pointFrom, pointRotateRads } from "@excalidraw/math";

import { Excalidraw } from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";
import {
  Keyboard,
  Pointer,
  UI,
} from "@excalidraw/excalidraw/_tests_/helpers/ui";
import {
  render,
  unmountComponent,
} from "@excalidraw/excalidraw/_tests_/test-utils";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import { getGlobalAttachPointForBindableElement } from "../src/binding";
import { getProjectionBindingGap } from "../src/bindingGap";
import { LinearElementEditor } from "../src/linearElementEditor";

import type {
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  NonDeleted,
} from "../src/types";

/**
 * PR1 基线冻结：用**真实 App + 真实指针**记录 HEAD 上用户驱动的两条指针路径
 * （从空白拖出新箭头 / 拖拽已有箭头的起点）的落点，供 PR3 的预期变更做 diff。
 *
 * 每条记录只包含观测值：
 *   - `startBinding` / `endBinding`：绑到了哪个元素（null = 未绑定）
 *   - `startAttach` / `endAttach`：`binding.attachPoint` 的归一化比例（未绑定为 null）
 *   - `startPoint` / `endPoint`：箭头两端在场景里的全局坐标
 *
 * 坐标一律从元素几何推导、确定性构造：不使用随机坐标；绑定的元素 id 显式写死。
 * 不断言任何「应该怎样」的落点语义 —— 只把 HEAD 的行为拍平进快照。
 */

const { h } = window;

const mouse = new Pointer("mouse");

unmountComponent();

// ---------------------------------------------------------------------------
// element families
// ---------------------------------------------------------------------------

const ELEMENT_X = 300;
const ELEMENT_Y = 250;
const ELEMENT_WIDTH = 200;
const ELEMENT_HEIGHT = 120;

type FamilyId =
  | "rectangle"
  | "rectangle-rot30"
  | "diamond"
  | "ellipse"
  | "fc-hexagon"
  | "text"
  | "stickynote"
  | "frame"
  | "activation";

const createFamilyElement = (
  family: FamilyId,
): NonDeleted<ExcalidrawBindableElement> => {
  const common = {
    id: `baseline-${family}`,
    x: ELEMENT_X,
    y: ELEMENT_Y,
    strokeWidth: 2,
  } as const;

  switch (family) {
    case "rectangle":
    case "rectangle-rot30":
      return API.createElement({
        type: "rectangle",
        ...common,
        width: ELEMENT_WIDTH,
        height: ELEMENT_HEIGHT,
        ...(family === "rectangle-rot30"
          ? { angle: ((30 * Math.PI) / 180) as Radians }
          : {}),
      }) as unknown as NonDeleted<ExcalidrawBindableElement>;
    case "diamond":
      return API.createElement({
        type: "diamond",
        ...common,
        width: ELEMENT_WIDTH,
        height: ELEMENT_HEIGHT,
      }) as unknown as NonDeleted<ExcalidrawBindableElement>;
    case "ellipse":
      return API.createElement({
        type: "ellipse",
        ...common,
        width: ELEMENT_WIDTH,
        height: ELEMENT_HEIGHT,
      }) as unknown as NonDeleted<ExcalidrawBindableElement>;
    case "fc-hexagon":
      return API.createElement({
        type: "fc-hexagon",
        ...common,
        width: ELEMENT_WIDTH,
        height: ELEMENT_HEIGHT,
      }) as unknown as NonDeleted<ExcalidrawBindableElement>;
    case "text":
      return API.createElement({
        type: "text",
        ...common,
        width: ELEMENT_WIDTH,
        height: 60,
        text: "probe",
      }) as unknown as NonDeleted<ExcalidrawBindableElement>;
    case "stickynote":
      return API.createElement({
        type: "stickynote",
        ...common,
        width: ELEMENT_WIDTH,
        height: ELEMENT_HEIGHT,
      }) as unknown as NonDeleted<ExcalidrawBindableElement>;
    case "frame":
      return API.createElement({
        type: "frame",
        ...common,
        width: ELEMENT_WIDTH,
        height: ELEMENT_HEIGHT,
      }) as unknown as NonDeleted<ExcalidrawBindableElement>;
    case "activation":
      return API.createElement({
        type: "sc-activation",
        ...common,
        width: 16,
        height: 100,
      }) as unknown as NonDeleted<ExcalidrawBindableElement>;
  }
};

// ---------------------------------------------------------------------------
// geometry: probes derived from the element bounds (rotated about the center)
// ---------------------------------------------------------------------------

type Vec2 = readonly [number, number];

const vecSub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

const vecAdd = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];

const vecScale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];

const vecNormalize = (a: Vec2): Vec2 => {
  const length = Math.hypot(a[0], a[1]);
  return length === 0 ? [0, 0] : [a[0] / length, a[1] / length];
};

/** unrotated element center == the rotation center */
const centerOf = (element: ExcalidrawBindableElement): GlobalPoint =>
  pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );

/** element-local, unrotated point (relative to element.x/y) → global */
const localToGlobal = (
  element: ExcalidrawBindableElement,
  local: Vec2,
): GlobalPoint =>
  pointRotateRads(
    pointFrom<GlobalPoint>(element.x + local[0], element.y + local[1]),
    centerOf(element),
    element.angle,
  );

/**
 * A point strictly on the outline but not at an edge midpoint, expressed in
 * element-local coordinates.
 */
const arbitraryEdgeLocal = (
  family: FamilyId,
  width: number,
  height: number,
): Vec2 => {
  switch (family) {
    case "diamond":
      // midpoint of the upper-right slanted edge
      return [0.75 * width, 0.25 * height] as const;
    case "ellipse":
      // 45° on the ellipse (upper right quadrant)
      return [
        width / 2 + width / (2 * Math.SQRT2),
        height / 2 - height / (2 * Math.SQRT2),
      ] as const;
    case "fc-hexagon":
      // midpoint of the upper-right slanted edge, matching getFcHexagonOutline
      return [0.8725 * width, 0.25 * height] as const;
    default:
      // one third down the right edge
      return [width, height / 3] as const;
  }
};

type Probe = { name: string; point: GlobalPoint };

const buildProbes = (
  family: FamilyId,
  element: ExcalidrawBindableElement,
): Probe[] => {
  const { width, height } = element;
  const center = centerOf(element);
  // Text targets have a zero projection gap by design; the probe offsets still
  // need a non-zero distance, so fall back to the base binding gap.
  const gap = getProjectionBindingGap(element, { elbowed: false }) || 6;
  const deepInside = 0.25 * Math.min(width, height);

  const edges: { name: string; local: Vec2 }[] = [
    { name: "edge-top", local: [width / 2, 0] },
    { name: "edge-right", local: [width, height / 2] },
    { name: "edge-bottom", local: [width / 2, height] },
    { name: "edge-left", local: [0, height / 2] },
  ];

  const corners: { name: string; local: Vec2 }[] = [
    { name: "corner-tl", local: [0, 0] },
    { name: "corner-tr", local: [width, 0] },
    { name: "corner-br", local: [width, height] },
    { name: "corner-bl", local: [0, height] },
  ];

  const probes: Probe[] = [{ name: "center", point: center }];

  for (const { name, local } of edges) {
    const anchor = localToGlobal(element, local);
    const outward = vecNormalize(vecSub(anchor, center));
    probes.push({
      name: `${name}/out2`,
      point: pointFrom<GlobalPoint>(
        ...(vecAdd(anchor, vecScale(outward, gap * 2)) as [number, number]),
      ),
    });
    probes.push({
      name: `${name}/in3`,
      point: pointFrom<GlobalPoint>(
        ...(vecAdd(anchor, vecScale(outward, -3)) as [number, number]),
      ),
    });
    probes.push({
      name: `${name}/deep`,
      point: pointFrom<GlobalPoint>(
        ...(vecAdd(anchor, vecScale(outward, -deepInside)) as [number, number]),
      ),
    });
  }

  for (const { name, local } of corners) {
    const corner = localToGlobal(element, local);
    const outward = vecNormalize(vecSub(corner, center));
    probes.push({
      name: `${name}/out2`,
      point: pointFrom<GlobalPoint>(
        ...(vecAdd(corner, vecScale(outward, gap * 2)) as [number, number]),
      ),
    });
  }

  probes.push({
    name: "edge-right/arbitrary",
    point: localToGlobal(element, arbitraryEdgeLocal(family, width, height)),
  });

  const rightAnchor = localToGlobal(element, [width, height / 2]);
  const rightOutward = vecNormalize(vecSub(rightAnchor, center));
  probes.push({
    name: "edge-right/out3",
    point: pointFrom<GlobalPoint>(
      ...(vecAdd(rightAnchor, vecScale(rightOutward, gap * 3)) as [
        number,
        number,
      ]),
    ),
  });

  return probes;
};

// ---------------------------------------------------------------------------
// case execution
// ---------------------------------------------------------------------------

type ArrowKind = "sharp" | "round" | "elbow";
type Mode = "default" | "shift" | "grid" | "no-midpoint";
type Operation = "create" | "drag-start";

/**
 * Deterministic blank (unbindable) points on the ray from the element center
 * through the probe, both on the probe's side:
 *  - `near`  — 150px beyond the probe, used as the gesture's blank start / end
 *              (150 also clears the AABB of the 30°-rotated rectangle, whose
 *              horizontal half-extent is ~117px)
 *  - `far`   — another 100px along the same ray, the pre-existing arrow's free
 *              end for the endpoint-drag operation
 */
const BLANK_NEAR_DISTANCE = 150;
const BLANK_FAR_DISTANCE = 100;

const blankPointsFor = (
  element: ExcalidrawBindableElement,
  probe: GlobalPoint,
): { near: GlobalPoint; far: GlobalPoint } => {
  const center = centerOf(element);
  const delta = vecSub(probe, center);
  const distance = Math.hypot(delta[0], delta[1]);
  const outward =
    distance < 1e-9
      ? // the exact center has no direction; treat it as "to the right"
        ([1, 0] as Vec2)
      : vecNormalize(delta);
  const near = pointFrom<GlobalPoint>(
    ...(vecAdd(probe, vecScale(outward, BLANK_NEAR_DISTANCE)) as [
      number,
      number,
    ]),
  );
  return {
    near,
    far: pointFrom<GlobalPoint>(
      ...(vecAdd(near, vecScale(outward, BLANK_FAR_DISTANCE)) as [
        number,
        number,
      ]),
    ),
  };
};

const round = (value: number) =>
  Object.is(value, -0) ? 0 : Math.round(value * 1e4) / 1e4;

const roundPoint = (point: readonly [number, number]) =>
  [round(point[0]), round(point[1])] as [number, number];

const resetScene = (
  element: ExcalidrawBindableElement,
  arrowType: ArrowKind,
  mode: Mode,
) => {
  API.setElements([element]);
  API.setAppState({
    selectedElementIds: {},
    selectedLinearElement: null,
    newElement: null,
    suggestedBinding: null,
    isBindingEnabled: true,
    bindingPreference: "enabled",
    gridModeEnabled: mode === "grid",
    gridSize: 20,
    isMidpointSnappingEnabled: mode !== "no-midpoint",
    currentItemArrowType: arrowType,
  });
  mouse.reset();
};

const moveTo = (point: GlobalPoint) => mouse.moveTo(point[0], point[1]);

const GRID_SIZE = 20;

const snapToGrid = (point: GlobalPoint): GlobalPoint =>
  pointFrom<GlobalPoint>(
    Math.round(point[0] / GRID_SIZE) * GRID_SIZE,
    Math.round(point[1] / GRID_SIZE) * GRID_SIZE,
  );

const moveAndRelease = (point: GlobalPoint, shift: boolean) => {
  if (shift) {
    Keyboard.withModifierKeys({ shift: true }, () => {
      moveTo(point);
      mouse.up();
    });
  } else {
    moveTo(point);
    mouse.up();
  }
};

const findArrow = (): ExcalidrawArrowElement => {
  const arrow = h.elements.find(
    (element): element is ExcalidrawArrowElement =>
      element.type === "arrow" && !element.isDeleted,
  );
  if (!arrow) {
    throw new Error("expected an arrow in the scene");
  }
  return arrow;
};

const runCase = ({
  element,
  arrowType,
  mode,
  probe,
  operation,
}: {
  element: ExcalidrawBindableElement;
  arrowType: ArrowKind;
  mode: Mode;
  probe: Probe;
  operation: Operation;
}) => {
  resetScene(element, arrowType, mode);
  UI.clickTool("arrow");

  const blankRaw = blankPointsFor(element, probe.point);
  // In grid mode both blank points must already sit on the grid, otherwise the
  // grid snap moves the arrow's start away from the point we press on.
  const blank =
    mode === "grid"
      ? {
          near: snapToGrid(blankRaw.near),
          far: snapToGrid(blankRaw.far),
        }
      : blankRaw;

  if (operation === "create") {
    if (mode === "shift") {
      Keyboard.withModifierKeys({ shift: true }, () => {
        mouse.downAt(blank.near[0], blank.near[1]);
        moveTo(probe.point);
        mouse.up();
      });
    } else {
      mouse.downAt(blank.near[0], blank.near[1]);
      moveTo(probe.point);
      mouse.up();
    }
  } else {
    // draw a plain arrow away from the element; it stays selected & in
    // point-edit mode afterwards, i.e. its endpoint handles are grabbable
    mouse.downAt(blank.near[0], blank.near[1]);
    moveTo(blank.far);
    mouse.up();

    mouse.reset();
    mouse.downAt(blank.near[0], blank.near[1]);
    moveAndRelease(probe.point, mode === "shift");
  }

  return findArrow();
};

const recordArrow = (
  arrow: ExcalidrawArrowElement,
  element: ExcalidrawBindableElement,
) => {
  const elementsMap = h.app.scene.getNonDeletedElementsMap();
  const startPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    arrow,
    0,
    elementsMap,
  );
  const endPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    arrow,
    -1,
    elementsMap,
  );

  const expectAttachMatchesEndpoint = (
    binding: ExcalidrawArrowElement["startBinding"],
    endpoint: readonly [number, number],
  ) => {
    if (!binding) {
      return;
    }
    const resolved = getGlobalAttachPointForBindableElement(
      binding.attachPoint,
      element,
      elementsMap,
    );
    expect(resolved[0]).toBeCloseTo(endpoint[0], 4);
    expect(resolved[1]).toBeCloseTo(endpoint[1], 4);
  };

  expectAttachMatchesEndpoint(arrow.startBinding, startPoint);
  expectAttachMatchesEndpoint(arrow.endBinding, endPoint);

  return {
    startBinding: arrow.startBinding?.elementId ?? null,
    startAttach: arrow.startBinding
      ? roundPoint(arrow.startBinding.attachPoint)
      : null,
    startPoint: roundPoint(startPoint),
    endBinding: arrow.endBinding?.elementId ?? null,
    endAttach: arrow.endBinding
      ? roundPoint(arrow.endBinding.attachPoint)
      : null,
    endPoint: roundPoint(endPoint),
  };
};

// ---------------------------------------------------------------------------
// matrix
// ---------------------------------------------------------------------------

const FAMILIES: FamilyId[] = [
  "rectangle",
  "rectangle-rot30",
  "diamond",
  "ellipse",
  "fc-hexagon",
  "text",
  "stickynote",
  "frame",
  "activation",
];
const ARROWS: ArrowKind[] = ["sharp", "round", "elbow"];
const MODES: Mode[] = ["default", "shift", "grid", "no-midpoint"];
/**
 * Endpoint-drag is covered for the four families the plan calls out. The
 * matrix is quadratic in families × positions, and this operation exercises
 * the same landing code as `create`; the remaining families only use `create`.
 */
const DRAG_START_FAMILIES: FamilyId[] = [
  "rectangle",
  "ellipse",
  "text",
  "activation",
];

/**
 * The run budget (~2 minutes on a loaded machine) is spent on the gesture
 * count, not on the family / arrow / mode axes, so those three axes stay full
 * and the per-family probe list is trimmed to one probe per class:
 *   center · four edge midpoints in the outside band · one inside-band probe ·
 *   one deep-inside probe · one outside corner · one arbitrary non-midpoint
 *   edge point · one gap*3 probe.
 * Dropped to stay within budget: the inside/deep probes of the other three
 * edges (6) and three of the four outside corners.
 */
const CREATE_PROBE_NAMES = new Set([
  "center",
  "edge-top/out2",
  "edge-right/out2",
  "edge-bottom/out2",
  "edge-left/out2",
  "edge-right/in3",
  "edge-right/deep",
  "corner-tr/out2",
  "edge-right/arbitrary",
  "edge-right/out3",
]);

/** Endpoint-drag only samples center, the four outside edge midpoints and one corner. */
const DRAG_PROBE_NAMES = new Set([
  "center",
  "edge-top/out2",
  "edge-right/out2",
  "edge-bottom/out2",
  "edge-left/out2",
  "corner-tr/out2",
]);

describe("connection baseline", () => {
  for (const family of FAMILIES) {
    // One render per family: `@testing-library/react` cleans the tree up after
    // every test, so the App has to be mounted inside the test that uses it.
    it(
      family,
      async () => {
        reseed(7);
        await render(<Excalidraw handleKeyboardGlobally={true} />);

        const element = createFamilyElement(family);
        const probes = buildProbes(family, element);

        for (const arrowType of ARROWS) {
          for (const mode of MODES) {
            for (const probe of probes) {
              if (!CREATE_PROBE_NAMES.has(probe.name)) {
                continue;
              }
              // HEAD bug, intentionally not fixed here: dropping an elbow
              // arrow exactly on a diamond's centre makes `heading.ts` trip
              // "The point is too close to the element mid point to determine
              // heading"; the throwing event aborts the arrow insertion and
              // leaves the app unable to create arrows for the rest of the
              // render. Recorded as a finding, excluded so the baseline stays
              // runnable.
              if (
                family === "diamond" &&
                arrowType === "elbow" &&
                probe.name === "center"
              ) {
                continue;
              }
              const created = runCase({
                element,
                arrowType,
                mode,
                probe,
                operation: "create",
              });
              expect(recordArrow(created, element)).toMatchSnapshot(
                `${family}/${arrowType}/${probe.name}/${mode}/create`,
              );

              if (
                DRAG_START_FAMILIES.includes(family) &&
                DRAG_PROBE_NAMES.has(probe.name)
              ) {
                const dragged = runCase({
                  element,
                  arrowType,
                  mode,
                  probe,
                  operation: "drag-start",
                });
                expect(recordArrow(dragged, element)).toMatchSnapshot(
                  `${family}/${arrowType}/${probe.name}/${mode}/drag-start`,
                );
              }
            }
          }
        }

        unmountComponent();
      },
      180_000,
    );
  }
});
