// 连线（connector）元素构造：走向、端点、折点、标签。
//
// 坐标参考系是本模块的关键职责：箭头元素以绝对原点定位，而坐标态端点的
// position 与折点与「原始父相对原点」同源，故求端点局部量时减原始原点；
// 绑定态端点用目标元素绝对 box 与连线绝对原点同系相减。

import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  ROUNDNESS,
} from "@excalidraw/common";

import { newArrowElement, newTextElement } from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";

import type {
  ElementBinding,
  ExcalidrawElement,
} from "@excalidraw/element/types";

import { mapArrowhead, resolveConnectorShape } from "../mapping.js";

import { identity, localPoint } from "./identity.js";
import { isLarkPoint } from "./resolve.js";
import { mapTextAlign, mapVerticalAlign, projectText } from "./text.js";

import type { Draft } from "./identity.js";
import type { ResolvedNode } from "./resolve.js";
import type { ConnectorRouting } from "../mapping.js";
import type { LarkConnectorEndpoint, LarkPoint } from "../source.js";

export interface ResolvedEndpoint {
  local: LocalPoint;
  binding?: ElementBinding;
}

export interface BuiltConnector {
  arrow: ExcalidrawElement;
  binding?: { start?: ElementBinding; end?: ElementBinding };
  caption?: Draft;
  /** 端点箭头发生回落的次数（`single_arrow` 等）。 */
  downgraded: number;
}

export function buildConnector(
  node: ResolvedNode,
  byNodeId: Map<string, Draft>,
  onRichText: () => void,
): BuiltConnector {
  const payload = node.raw.connector;
  const origin = { x: node.x, y: node.y };
  const rawOrigin = { x: node.relX, y: node.relY };
  const start = resolveEndpoint(payload?.start, origin, rawOrigin, byNodeId);
  const end = resolveEndpoint(payload?.end, origin, rawOrigin, byNodeId);

  const turning: LarkPoint[] = [];
  if (Array.isArray(payload?.turning_points)) {
    for (const tp of payload.turning_points) {
      if (isLarkPoint(tp)) {
        turning.push({ x: tp.x, y: tp.y });
      }
    }
  }

  const shapeRes = resolveConnectorShape(payload?.shape, turning.length > 0);
  const points = buildConnectorPoints(
    shapeRes.routing,
    turning,
    start.local,
    end.local,
  );
  const roundness =
    shapeRes.routing === "curve"
      ? { type: ROUNDNESS.PROPORTIONAL_RADIUS }
      : null;

  const startHead = mapArrowhead(payload?.start?.arrow_style);
  const endHead = mapArrowhead(payload?.end?.arrow_style);

  const arrow = newArrowElement({
    type: "arrow",
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    points,
    roundness,
    startArrowhead: startHead.arrowhead,
    endArrowhead: endHead.arrowhead,
    ...identity(node.raw.id, node.angle),
  });

  const binding: { start?: ElementBinding; end?: ElementBinding } = {};
  if (start.binding) {
    binding.start = start.binding;
  }
  if (end.binding) {
    binding.end = end.binding;
  }

  const built: BuiltConnector = {
    arrow,
    downgraded:
      (startHead.downgraded ? 1 : 0) +
      (endHead.downgraded ? 1 : 0) +
      (shapeRes.downgraded ? 1 : 0),
  };
  if (binding.start || binding.end) {
    built.binding = binding;
  }
  const caption = buildConnectorCaption(node, origin, points, onRichText);
  if (caption) {
    built.caption = caption;
  }
  return built;
}

// 端点两态：绑定态用目标元素绝对 box 与连线绝对原点同系相减；坐标态的
// position 与连线原始父相对原点同系，故减原始原点得出局部量。两种都换算为
// 相对连线原点的局部坐标。
function resolveEndpoint(
  endpoint: LarkConnectorEndpoint | undefined,
  origin: { x: number; y: number },
  rawOrigin: { x: number; y: number },
  byNodeId: Map<string, Draft>,
): ResolvedEndpoint {
  const targetId = endpoint?.attached_object?.id;
  const target = targetId ? byNodeId.get(targetId) : undefined;
  if (targetId && target) {
    const box = {
      x: Number(target.el.x),
      y: Number(target.el.y),
      width: Number(target.el.width ?? 0),
      height: Number(target.el.height ?? 0),
    };
    const attachPoint = attachPointFor(
      endpoint?.attached_object?.snap_to,
      endpoint?.attached_object?.position,
    );
    return {
      local: localPoint(
        box.x + box.width * attachPoint[0] - origin.x,
        box.y + box.height * attachPoint[1] - origin.y,
      ),
      binding: { elementId: targetId, attachPoint },
    };
  }
  const position = endpoint?.position;
  if (position && isLarkPoint(position)) {
    return {
      local: localPoint(position.x - rawOrigin.x, position.y - rawOrigin.y),
    };
  }
  return { local: localPoint(0, 0) };
}

// attachPoint 为归一化边界比例；snap_to 矫正沿边轴，position 提供另一轴。
function attachPointFor(
  snapTo: string | undefined,
  position: LarkPoint | undefined,
): [number, number] {
  const ratioX = clamp01(position?.x ?? 0.5);
  const ratioY = clamp01(position?.y ?? 0.5);
  switch (snapTo) {
    case "right":
      return [1, ratioY];
    case "left":
      return [0, ratioY];
    case "top":
      return [ratioX, 0];
    case "bottom":
      return [ratioX, 1];
    default:
      return [ratioX, ratioY];
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

// 连线路径：直线两点；折线 = 起点 + 折点 + 终点；曲线按中点偏移生成三点走向。
function buildConnectorPoints(
  routing: ConnectorRouting,
  turning: readonly { x: number; y: number }[],
  start: LocalPoint,
  end: LocalPoint,
): LocalPoint[] {
  if (routing === "polyline" && turning.length > 0) {
    return [start, ...turning.map((p) => localPoint(p.x, p.y)), end];
  }
  if (routing === "curve") {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    return [
      start,
      localPoint(
        (start[0] + end[0]) / 2 - dy * 0.15,
        (start[1] + end[1]) / 2 + dx * 0.15,
      ),
      end,
    ];
  }
  return [start, end];
}

// 连线标签：沿路径比例取点，映射为绑定到连线的文本元素。
function buildConnectorCaption(
  node: ResolvedNode,
  origin: { x: number; y: number },
  points: LocalPoint[],
  onRichText: () => void,
): Draft | undefined {
  const data = node.raw.connector?.captions?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return undefined;
  }
  // 仅首条标签落地为元素；其余仍参与富文本压平计数以保持统计一致。
  const projected = data.map((caption) => projectText(caption, onRichText));
  const text = projected[0];
  if (!text || text.text === "") {
    return undefined;
  }
  const ratio = clamp01(node.raw.connector?.caption_position ?? 0.5);
  const first = points[0] ?? localPoint(0, 0);
  const last = points[points.length - 1] ?? localPoint(0, 0);
  const element = newTextElement({
    text: text.text,
    fontSize: text.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: mapTextAlign(text.horizontalAlign),
    verticalAlign: mapVerticalAlign(text.verticalAlign),
    containerId: node.raw.id,
    labelPosition: ratio,
    x: origin.x + first[0] + (last[0] - first[0]) * ratio,
    y: origin.y + first[1] + (last[1] - first[1]) * ratio,
    ...identity(`${node.raw.id}#caption`, 0),
  });
  return { el: element, zKey: node.zIndex + 0.1 };
}
