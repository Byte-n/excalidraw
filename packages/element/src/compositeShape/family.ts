import type {
  BasicShapeId,
  FlowchartShapeId,
  SequenceShapeId,
  ShapeElementType,
  ShapeId,
} from "../types";

/** Shape families. Adding a family (e.g. a later sequence family) is one entry here. */
export const SHAPE_FAMILIES = ["basic", "flow", "sequence"] as const;
export type ShapeFamily = typeof SHAPE_FAMILIES[number];

/** The 29 basic shape ids. */
export const BASIC_SHAPE_IDS = [
  "rectangle",
  "diamond",
  "ellipse",
  "cross",
  "brace-reverse",
  "brace",
  "cloud",
  "double-arrow",
  "forward-arrow",
  "backward-arrow",
  "octagon",
  "pentagon",
  "hexagon",
  "star",
  "triangle",
  "right-triangle",
  "left-triangle",
  "round-rect",
  "rectangle-bubble",
  "pill",
  "bubble",
  "trapezoid",
  "parallelogram",
  "right-pentagon",
  "step",
  "cube",
  "cylinder",
  "pie",
  "circular-ring",
] as const;

/** The 14 flowchart (Lark) shape ids. */
export const FLOWCHART_SHAPE_IDS = [
  "fc-round-rect",
  "fc-terminator",
  "fc-diamond",
  "fc-document",
  "fc-parallelogram",
  "fc-cylinder",
  "fc-horiz-cylinder",
  "fc-predefined-process",
  "fc-manual-input",
  "fc-trapezoid",
  "fc-delay",
  "fc-hexagon",
  "fc-off-page-connector",
  "fc-circle",
] as const;

/** The 10 sequence (Lark sequence-diagram) shape ids. */
export const SEQUENCE_SHAPE_IDS = [
  "sc-lifeline-entity",
  "sc-lifeline-control",
  "sc-lifeline-boundary",
  "sc-lifeline-actor",
  "sc-lifeline-queue",
  "sc-lifeline-data-base",
  "sc-lifeline-object",
  "sc-lifeline-collection",
  "sc-activation",
  "sc-fragment",
] as const;

/** Family → its id list. Adding a family adds an entry here. */
const SHAPE_IDS_BY_FAMILY: Record<ShapeFamily, readonly ShapeId[]> = {
  basic: BASIC_SHAPE_IDS,
  flow: FLOWCHART_SHAPE_IDS,
  sequence: SEQUENCE_SHAPE_IDS,
};

/** All 53 shape ids, expanded in family order. */
export const SHAPE_IDS: readonly ShapeId[] = [
  ...BASIC_SHAPE_IDS,
  ...FLOWCHART_SHAPE_IDS,
  ...SEQUENCE_SHAPE_IDS,
];

/**
 * Family → element top-level type. A missing mapping for a registered family
 * is caught by the `_ElementTypeCoversFamilies` interlock below.
 */
export const ELEMENT_TYPE_BY_FAMILY = {
  basic: "composite",
  flow: "flow",
  sequence: "sequence",
} as const;

const FAMILY_BY_SHAPE_ID = new Map<ShapeId, ShapeFamily>(
  SHAPE_FAMILIES.flatMap((family) =>
    SHAPE_IDS_BY_FAMILY[family].map((id) => [id, family] as const),
  ),
);

export const shapeFamily = (id: ShapeId): ShapeFamily => {
  const family = FAMILY_BY_SHAPE_ID.get(id);
  if (!family) {
    throw new Error(`Unsupported shape id: ${id}`);
  }
  return family;
};

/** Element top-level type is derived from the family — the single place type is established. */
export const shapeElementType = (id: ShapeId): ShapeElementType =>
  ELEMENT_TYPE_BY_FAMILY[shapeFamily(id)];

/** Whether an id belongs to a family (runtime predicate; families are disjoint). */
export const isBasicShapeId = (id: string): id is BasicShapeId =>
  (BASIC_SHAPE_IDS as readonly string[]).includes(id);
export const isFlowchartShapeId = (id: string): id is FlowchartShapeId =>
  (FLOWCHART_SHAPE_IDS as readonly string[]).includes(id);
export const isSequenceShapeId = (id: string): id is SequenceShapeId =>
  (SEQUENCE_SHAPE_IDS as readonly string[]).includes(id);
/** Whether an id is one of the 53 shape ids. */
export const isShapeId = (id: string): id is ShapeId =>
  (SHAPE_IDS as readonly string[]).includes(id);

type AssertTrue<T extends true> = T;

// Compile-time interlocks. These mirror the `satisfies` guards the plan
// prescribes; the repo's prettier (2.6.2) predates the `satisfies` operator,
// so the same checks are expressed as `AssertTrue` type-level assertions.

/** Every `BasicShapeId` is registered in `BASIC_SHAPE_IDS`. */
type _BasicIdsExhaustive = AssertTrue<
  Exclude<BasicShapeId, typeof BASIC_SHAPE_IDS[number]> extends never
    ? true
    : false
>;
/** Every `FlowchartShapeId` is registered in `FLOWCHART_SHAPE_IDS`. */
type _FlowIdsExhaustive = AssertTrue<
  Exclude<FlowchartShapeId, typeof FLOWCHART_SHAPE_IDS[number]> extends never
    ? true
    : false
>;
/** Every `SequenceShapeId` is registered in `SEQUENCE_SHAPE_IDS`. */
type _SequenceIdsExhaustive = AssertTrue<
  Exclude<SequenceShapeId, typeof SEQUENCE_SHAPE_IDS[number]> extends never
    ? true
    : false
>;
/** The three families are pairwise disjoint. */
type _FamiliesDisjoint = AssertTrue<
  Extract<BasicShapeId, FlowchartShapeId> extends never
    ? Extract<BasicShapeId, SequenceShapeId> extends never
      ? Extract<FlowchartShapeId, SequenceShapeId> extends never
        ? true
        : false
      : false
    : false
>;
/** Every id listed under `basic` is actually a `BasicShapeId`. */
type _BasicIdsAreBasic = AssertTrue<
  typeof BASIC_SHAPE_IDS[number] extends BasicShapeId ? true : false
>;
/** Every id listed under `flow` is actually a `FlowchartShapeId`. */
type _FlowIdsAreFlow = AssertTrue<
  typeof FLOWCHART_SHAPE_IDS[number] extends FlowchartShapeId ? true : false
>;
/** Every id listed under `sequence` is actually a `SequenceShapeId`. */
type _SequenceIdsAreSequence = AssertTrue<
  typeof SEQUENCE_SHAPE_IDS[number] extends SequenceShapeId ? true : false
>;
/** `ELEMENT_TYPE_BY_FAMILY` maps every family to a `ShapeElementType`. */
type _ElementTypeCoversFamilies = AssertTrue<
  typeof ELEMENT_TYPE_BY_FAMILY extends Record<ShapeFamily, ShapeElementType>
    ? true
    : false
>;

/** Forces evaluation of every interlock above; never read at runtime. */
export type _ShapeFamilyInterlocks = [
  _BasicIdsExhaustive,
  _FlowIdsExhaustive,
  _SequenceIdsExhaustive,
  _FamiliesDisjoint,
  _BasicIdsAreBasic,
  _FlowIdsAreFlow,
  _SequenceIdsAreSequence,
  _ElementTypeCoversFamilies,
];
