// 转换前的整板闸门：只保留不可由归一化吸收的结构性不变量。
//
// 几何有限、尺寸非负、z_index 整数等由归一化层吸收，不在原始节点上
// 复查（否则会把原本能导入的板变成整板失败）。父 id 的存在性按原始数据全部
// 节点 id 判定，使指向「存在但类型未建模被丢弃」的父节点（如 group / svg /
// life_line）不再导致整板失败；真正不存在的 id 仍整板失败。

import { dispatchKind } from "./resolve.js";

import type { LarkBoardNode } from "../source.js";

// 整板闸门校验失败。
export class BoardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardValidationError";
  }
}

// 校验原始节点数组的结构不变量：保留集合内 id 唯一、parent_id 指向存在且非
// 自身、children 不含自身。
export function assertLarkBoard(nodes: LarkBoardNode[]): void {
  // 原始数据里出现过的全部 id（含被丢弃类型），用于父 id 存在性判定。
  const allIds = new Set<string>();
  for (const node of nodes) {
    if (typeof node.id === "string" && node.id.length > 0) {
      allIds.add(node.id);
    }
  }

  const seen = new Set<string>();
  for (const node of nodes) {
    // 非法 id 与范围外 / 未知类型不产出元素，也不参与闸门。
    if (typeof node.id !== "string" || node.id.length === 0) {
      continue;
    }
    if (dispatchKind(node.type) === undefined) {
      continue;
    }

    if (seen.has(node.id)) {
      throw new BoardValidationError(`画板节点 id 重复: ${node.id}`);
    }
    seen.add(node.id);

    const parentId =
      typeof node.parent_id === "string" && node.parent_id.length > 0
        ? node.parent_id
        : undefined;
    if (parentId !== undefined) {
      if (parentId === node.id) {
        throw new BoardValidationError(
          `画板节点 ${node.id} 的 parent_id 指向自身`,
        );
      }
      if (!allIds.has(parentId)) {
        throw new BoardValidationError(
          `画板节点 ${node.id} 的 parent_id=${parentId} 不存在`,
        );
      }
    }

    if (Array.isArray(node.children)) {
      for (const childId of node.children) {
        if (childId === node.id) {
          throw new BoardValidationError(
            `画板节点 ${node.id} 的 children 含自身`,
          );
        }
      }
    }
  }
}
