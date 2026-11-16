import {
  SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT,
  SEQUENCE_FRAGMENT_TAB_HEIGHT,
  SEQUENCE_LIFELINE_HEAD_HEIGHTS,
  SEQUENCE_LIFELINE_IDS,
  getSequenceLifelineDefaultSize,
} from "@excalidraw/element";
import { SHAPE_IDS } from "@excalidraw/yjs";

import type { SequenceLifelineId } from "@excalidraw/element";

import { CanvasSdkError } from "./errors.js";
import {
  CanvasGenerateDiagramInputSchema,
  CanvasGenerateMindmapInputSchema,
  CanvasGenerateSequenceInputSchema,
  CanvasGenerateTableInputSchema,
  parseInput,
} from "./schemas.js";

import type { CanvasOp } from "./schemas.js";
import type {
  CanvasApplyReceipt,
  CanvasGenerateApi,
  CanvasGenerateDiagramInput,
  CanvasGenerateMindmapInput,
  CanvasGenerateSequenceInput,
  CanvasGenerateTableInput,
  CanvasMindmapNodeInput,
  CanvasPoint,
  CanvasSdk,
} from "./types.js";

const FRAGMENT_PADDING = 24;
const DEFAULT_PARTICIPANT_GAP = 160;
const DEFAULT_MESSAGE_TOP_GAP = 80;
const DEFAULT_MESSAGE_ROW_GAP = 56;
const MAX_MINDMAP_NODES = 400;

type WriteOptions = {
  dryRun?: boolean;
  idempotencyKey?: string;
};

const runOps = (
  apply: CanvasSdk["apply"],
  ops: CanvasOp[],
  options: WriteOptions,
): Promise<CanvasApplyReceipt> =>
  apply({
    ops,
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    ...(options.idempotencyKey
      ? { idempotencyKey: options.idempotencyKey }
      : {}),
  });

const assignIds = (
  entries: readonly { id?: string }[],
  prefix: string,
  used: Set<string>,
  label: string,
): string[] => {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.id === undefined) {
      continue;
    }
    if (seen.has(entry.id) || used.has(entry.id)) {
      throw new CanvasSdkError(
        "invalid_input",
        `${label} id 重复: ${entry.id}`,
      );
    }
    seen.add(entry.id);
    used.add(entry.id);
  }
  let counter = 0;
  return entries.map((entry) => {
    if (entry.id !== undefined) {
      return entry.id;
    }
    let id = `${prefix}${counter++}`;
    while (used.has(id)) {
      id = `${prefix}${counter++}`;
    }
    used.add(id);
    return id;
  });
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const layoutOrigin = (origin: CanvasPoint | undefined): CanvasPoint =>
  origin ?? { x: 0, y: 0 };

const assertKnownShapeKinds = (
  kinds: readonly (string | undefined)[],
  path: string,
) => {
  for (const [index, kind] of kinds.entries()) {
    if (
      kind !== undefined &&
      !(SHAPE_IDS as readonly string[]).includes(kind)
    ) {
      throw new CanvasSdkError("invalid_input", `未知图形类型: ${kind}`, {
        path: `${path}[${index}].kind`,
        legalValues: [...SHAPE_IDS],
      });
    }
  }
};

const assertKnownLifelineKinds = (kinds: readonly (string | undefined)[]) => {
  for (const [index, kind] of kinds.entries()) {
    if (
      kind !== undefined &&
      !(SEQUENCE_LIFELINE_IDS as readonly string[]).includes(kind)
    ) {
      throw new CanvasSdkError("invalid_input", `未知生命线类型: ${kind}`, {
        path: `participants[${index}].kind`,
        legalValues: [...SEQUENCE_LIFELINE_IDS],
      });
    }
  }
};

const buildDiagramOps = (input: CanvasGenerateDiagramInput): CanvasOp[] => {
  const parsed = parseInput(CanvasGenerateDiagramInputSchema, input);
  if (parsed.format === "mermaid") {
    throw new CanvasSdkError(
      "unsupported_format",
      "本期 generate.diagram 只接受语义 JSON，不解析 Mermaid 源码",
      { legalValues: ["json"] },
    );
  }
  const used = new Set<string>();
  const nodeIds = assignIds(parsed.spec.nodes, "n", used, "节点");
  const edgeIds = assignIds(parsed.spec.edges ?? [], "e", used, "边");
  assertKnownShapeKinds(
    parsed.spec.nodes.map((node) => node.kind),
    "spec.nodes",
  );
  const nodeIdSet = new Set(nodeIds);
  for (const [index, edge] of (parsed.spec.edges ?? []).entries()) {
    for (const endpoint of [edge.from, edge.to]) {
      if (!nodeIdSet.has(endpoint)) {
        throw new CanvasSdkError(
          "invalid_input",
          `连线 ${edgeIds[index]} 引用了不存在的节点: ${endpoint}`,
          { path: `spec.edges[${index}]` },
        );
      }
    }
  }

  const ops: CanvasOp[] = parsed.spec.nodes.map((node, index) => ({
    op: "addShape",
    tempId: nodeIds[index],
    kind: (node.kind ?? "rectangle") as never,
    x: node.x ?? 0,
    y: node.y ?? 0,
    ...(node.width !== undefined ? { width: node.width } : {}),
    ...(node.height !== undefined ? { height: node.height } : {}),
    ...(node.label !== undefined ? { label: node.label } : {}),
  }));
  for (const [index, edge] of (parsed.spec.edges ?? []).entries()) {
    ops.push({
      op: "connect",
      tempId: edgeIds[index],
      from: edge.from,
      to: edge.to,
      ...(edge.kind !== undefined ? { kind: edge.kind } : {}),
      ...(edge.routing !== undefined ? { routing: edge.routing } : {}),
      ...(edge.label !== undefined ? { label: edge.label } : {}),
    });
  }
  if (parsed.layout !== false) {
    ops.push({
      op: "layout",
      algorithm: "layered",
      ids: nodeIds,
      origin: layoutOrigin(parsed.origin),
      options: {
        direction: parsed.layout?.direction ?? "TB",
        ...(parsed.layout?.rankGap !== undefined
          ? { rankGap: parsed.layout.rankGap }
          : {}),
        ...(parsed.layout?.nodeGap !== undefined
          ? { nodeGap: parsed.layout.nodeGap }
          : {}),
      },
    });
  }
  return ops;
};

const buildSequenceOps = (input: CanvasGenerateSequenceInput): CanvasOp[] => {
  const parsed = parseInput(CanvasGenerateSequenceInputSchema, input);
  assertKnownLifelineKinds(
    parsed.participants.map((participant) => participant.kind),
  );
  const used = new Set<string>();
  const participantIds = assignIds(parsed.participants, "p", used, "参与者");
  const messages = parsed.messages ?? [];
  const messageIds = assignIds(messages, "m", used, "消息");
  const fragmentIds = assignIds(parsed.fragments ?? [], "f", used, "片段");
  const participantIdSet = new Set(participantIds);
  const messageById = new Map(
    messages.map((message, index) => [messageIds[index], message]),
  );
  for (const [index, message] of messages.entries()) {
    for (const endpoint of [message.from, message.to]) {
      if (!participantIdSet.has(endpoint)) {
        throw new CanvasSdkError(
          "invalid_input",
          `消息 ${messageIds[index]} 引用了不存在的参与者: ${endpoint}`,
          { path: `messages[${index}]` },
        );
      }
    }
  }
  for (const [index, fragment] of (parsed.fragments ?? []).entries()) {
    for (const participantId of fragment.participants ?? []) {
      if (!participantIdSet.has(participantId)) {
        throw new CanvasSdkError(
          "invalid_input",
          `片段 ${fragmentIds[index]} 引用了不存在的参与者: ${participantId}`,
          { path: `fragments[${index}].participants` },
        );
      }
    }
    for (const messageId of fragment.messages ?? []) {
      if (!messageById.has(messageId)) {
        throw new CanvasSdkError(
          "invalid_input",
          `片段 ${fragmentIds[index]} 引用了不存在的消息: ${messageId}`,
          { path: `fragments[${index}].messages` },
        );
      }
    }
  }

  const origin = layoutOrigin(parsed.origin);
  const gap =
    parsed.layout === false
      ? DEFAULT_PARTICIPANT_GAP
      : parsed.layout?.gap ?? DEFAULT_PARTICIPANT_GAP;
  const topGap =
    parsed.layout === false
      ? DEFAULT_MESSAGE_TOP_GAP
      : parsed.layout?.nodeGap ?? DEFAULT_MESSAGE_TOP_GAP;
  const rowGap =
    parsed.layout === false
      ? DEFAULT_MESSAGE_ROW_GAP
      : parsed.layout?.rankGap ?? DEFAULT_MESSAGE_ROW_GAP;

  const layouts = parsed.participants.map((participant, index) => {
    const kind = (participant.kind ??
      "sc-lifeline-entity") as SequenceLifelineId;
    const defaults = getSequenceLifelineDefaultSize(kind);
    return {
      id: participantIds[index],
      kind,
      width: participant.width ?? defaults.width,
      height: participant.height ?? defaults.height,
      headHeight: SEQUENCE_LIFELINE_HEAD_HEIGHTS[kind],
      x: 0,
    };
  });
  let cursor = origin.x;
  for (const participant of layouts) {
    participant.x = cursor;
    cursor += participant.width + gap;
  }
  const layoutById = new Map(
    layouts.map((participant) => [participant.id, participant]),
  );
  const maxHeadHeight = Math.max(
    ...layouts.map((participant) => participant.headHeight),
  );
  // 激活条需要头部下方的空间，即使布局把消息行距压到 0 也要先落在杆上。
  const messageTopGap = Math.max(topGap, 64);
  const firstMessageY = origin.y + maxHeadHeight + messageTopGap;

  const ops: CanvasOp[] = parsed.participants.map((participant, index) => {
    const layout = layouts[index]!;
    return {
      op: "sequence",
      action: "addParticipant",
      tempId: participantIds[index],
      kind: layout.kind,
      x: layout.x,
      y: origin.y,
      width: layout.width,
      height: layout.height,
      label: participant.label,
    };
  });
  messages.forEach((message, index) => {
    ops.push({
      op: "sequence",
      action: "addMessage",
      tempId: messageIds[index],
      from: { participantId: message.from },
      to: { participantId: message.to },
      y: firstMessageY + index * rowGap,
      ...(message.label !== undefined ? { label: message.label } : {}),
    });
  });

  const allMessageIds = [...messageIds];
  const allParticipantIds = [...participantIds];
  const messageYById = new Map(
    messageIds.map((id, index) => [id, firstMessageY + index * rowGap]),
  );
  (parsed.fragments ?? []).forEach((fragment, index) => {
    const includedMessages = fragment.messages
      ? [...fragment.messages]
      : fragment.participants
      ? allMessageIds.filter((id) => {
          const message = messageById.get(id)!;
          return (
            fragment.participants!.includes(message.from) ||
            fragment.participants!.includes(message.to)
          );
        })
      : allMessageIds;
    const includedParticipants = fragment.participants
      ? [...fragment.participants]
      : includedMessages.length > 0
      ? unique(
          includedMessages.flatMap((id) => {
            const message = messageById.get(id)!;
            return [message.from, message.to];
          }),
        )
      : allParticipantIds;
    const covered = includedParticipants
      .map((id) => layoutById.get(id))
      .filter((participant) => participant !== undefined);
    if (!covered.length) {
      throw new CanvasSdkError(
        "invalid_input",
        `片段 ${fragmentIds[index]} 至少需要覆盖一位参与者`,
      );
    }
    const left = Math.min(...covered.map((participant) => participant.x));
    const right = Math.max(
      ...covered.map((participant) => participant.x + participant.width),
    );
    const rows = includedMessages.map((id) => messageYById.get(id)!);
    const top = rows.length ? Math.min(...rows) - rowGap / 2 : firstMessageY;
    const bottom = rows.length
      ? Math.max(...rows) + rowGap / 2
      : firstMessageY + rowGap;
    ops.push({
      op: "sequence",
      action: "addFragment",
      tempId: fragmentIds[index],
      x: left - FRAGMENT_PADDING,
      y: top,
      width: right - left + FRAGMENT_PADDING * 2,
      height: Math.max(
        bottom - top,
        SEQUENCE_FRAGMENT_TAB_HEIGHT + SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT,
      ),
      operator: fragment.operator ?? "alt",
    });
  });

  if (parsed.layout !== false) {
    ops.push({
      op: "layout",
      algorithm: "sequence",
      ids: [...participantIds, ...fragmentIds],
      origin,
      options: { gap, rankGap: rowGap, nodeGap: topGap },
    });
  }
  return ops;
};

const flattenMindmap = (
  root: CanvasMindmapNodeInput,
): Array<{ tempId: string; parentTempId: string | null; text: string }> => {
  const nodes: Array<{
    tempId: string;
    parentTempId: string | null;
    text: string;
  }> = [];
  const visit = (node: CanvasMindmapNodeInput, parentTempId: string | null) => {
    const tempId = `n${nodes.length}`;
    nodes.push({ tempId, parentTempId, text: node.text });
    for (const child of node.children ?? []) {
      visit(child, tempId);
    }
  };
  visit(root, null);
  if (nodes.length > MAX_MINDMAP_NODES) {
    throw new CanvasSdkError(
      "invalid_input",
      `脑图节点超过上限 ${MAX_MINDMAP_NODES}`,
    );
  }
  return nodes;
};

const buildMindmapOps = (input: CanvasGenerateMindmapInput): CanvasOp[] => {
  const parsed = parseInput(CanvasGenerateMindmapInputSchema, input);
  const nodes = flattenMindmap(parsed.root);
  const root = nodes[0]!;
  const origin = layoutOrigin(parsed.origin);
  const ops: CanvasOp[] = [
    {
      op: "mindmap",
      action: "createRoot",
      tempId: root.tempId,
      x: origin.x,
      y: origin.y,
      text: root.text,
      ...(parsed.direction !== undefined
        ? { direction: parsed.direction }
        : {}),
    },
    ...nodes.slice(1).map((node) => ({
      op: "mindmap" as const,
      action: "addChild" as const,
      tempId: node.tempId,
      nodeId: node.parentTempId!,
      text: node.text,
    })),
    {
      op: "layout",
      algorithm: "tree",
      ids: nodes.map((node) => node.tempId),
      origin,
    },
  ];
  return ops;
};

const buildTableOps = (input: CanvasGenerateTableInput): CanvasOp[] => {
  const parsed = parseInput(CanvasGenerateTableInputSchema, input);
  const header = parsed.header ?? true;
  const rowCount = parsed.rows.length + (header ? 1 : 0);
  if (rowCount < 1) {
    throw new CanvasSdkError("invalid_input", "表格至少需要一行");
  }
  for (const [index, row] of parsed.rows.entries()) {
    if (row.length !== parsed.columns.length) {
      throw new CanvasSdkError(
        "invalid_input",
        `第 ${index + 1} 行数据列数与 columns 不一致`,
        { path: `rows[${index}]` },
      );
    }
  }
  const cellTexts = header ? [parsed.columns, ...parsed.rows] : parsed.rows;
  return [
    {
      op: "table",
      action: "create",
      tempId: "table",
      position: layoutOrigin(parsed.origin),
      rowCount,
      columnCount: parsed.columns.length,
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.maxWidth !== undefined
        ? { columnWidth: parsed.maxWidth / parsed.columns.length }
        : {}),
      cellTexts,
    },
  ];
};

export const createGenerateApi = (deps: {
  apply: CanvasSdk["apply"];
}): CanvasGenerateApi =>
  Object.freeze({
    diagram: async (input) => runOps(deps.apply, buildDiagramOps(input), input),
    sequence: async (input) =>
      runOps(deps.apply, buildSequenceOps(input), input),
    mindmap: async (input) => runOps(deps.apply, buildMindmapOps(input), input),
    table: async (input) => runOps(deps.apply, buildTableOps(input), input),
  });
