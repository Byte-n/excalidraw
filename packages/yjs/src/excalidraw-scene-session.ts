import { generateNKeysBetween } from "@excalidraw/fractional-indexing";

import { projectExcalidrawDisplayElements } from "./scene-projection";

import type { SceneBinding } from "./types";
import type { ExcalidrawSceneElement } from "./excalidraw-scene-types";
const equal = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
const technical = new Set(["version", "versionNonce", "updated", "status"]);
/** 会话内 canonical/display 反向映射；显示水位从不写入 Y.Doc。 */
export class ExcalidrawSceneSession<
  TElement extends ExcalidrawSceneElement,
  TAsset,
> {
  private readonly display = new Map<string, TElement>();
  private readonly projectedInput = new Map<string, Record<string, unknown>>();
  private readonly projectedCanonical = new Map<string, TElement>();
  private protectedInput = new Map<string, TElement>();
  private readonly watermarks = new Map<string, number>();

  constructor(readonly binding: SceneBinding<TElement, TAsset>) {}

  dispose(): void {
    this.display.clear();
    this.projectedInput.clear();
    this.projectedCanonical.clear();
    this.protectedInput.clear();
    this.watermarks.clear();
  }

  project(
    current: readonly TElement[] = [],
    protectedIds: ReadonlySet<string> = new Set(),
  ): TElement[] {
    const canonical = this.binding.getCanonical().elements;
    const byId = new Map(canonical.map((element) => [element.id, element]));
    const local = new Map(current.map((element) => [element.id, element]));
    this.protectedInput = new Map(
      current
        .filter((element) => protectedIds.has(element.id))
        .map((element) => [element.id, structuredClone(element)]),
    );
    for (const element of current) {
      this.observeVersion(element);
    }
    const merged = projectExcalidrawDisplayElements(canonical).map((element) =>
      protectedIds.has(element.id) && local.has(element.id)
        ? structuredClone(local.get(element.id)!)
        : element,
    );
    // 暂缓元素也必须经过软关系适配，否则远端删除父容器会触发 vendor 断言。
    const projected = projectExcalidrawDisplayElements(merged);
    return projected.map((element) => {
      if (protectedIds.has(element.id)) {
        return element;
      }
      const previous = this.projectedCanonical.get(element.id);
      const baseline = this.display.get(element.id);
      const source = byId.get(element.id)!;
      const floor = this.watermarks.get(element.id) ?? 0;
      // 同一 canonical 重复投影复用显示版本，真实远端内容即使版本更低也越过 Store 水位。
      if (
        equal(previous, source) &&
        baseline &&
        equal(
          this.projectedInput.get(element.id),
          this.withoutTechnical(element),
        )
      ) {
        element.version = baseline.version;
        element.versionNonce = baseline.versionNonce;
      } else if (element.version <= floor) {
        element.version = floor + 1;
      }
      // restore 前确定性输入与 restore 后显示基线分开；null→[] 等技术规范化不升版。
      this.projectedInput.set(
        element.id,
        structuredClone(this.withoutTechnical(element)),
      );
      this.projectedCanonical.set(element.id, structuredClone(source));
      return element;
    });
  }

  accept(
    elements: readonly TElement[],
    protectedIds: ReadonlySet<string> = new Set(),
  ): void {
    for (const element of elements) {
      this.observeVersion(element);
      if (!protectedIds.has(element.id)) {
        this.display.set(element.id, structuredClone(element));
      } else {
        const input = this.protectedInput.get(element.id);
        const baseline = this.display.get(element.id);
        if (!input || !baseline) {
          continue;
        }
        // 只更新本次 restore 的技术适配差异，保留尚未发布的用户位移/文字。
        for (const key of new Set([
          ...Object.keys(input),
          ...Object.keys(element),
        ])) {
          if (technical.has(key) || equal(input[key], element[key])) {
            continue;
          }
          if (
            ["x", "y", "width", "height", "angle"].includes(key) &&
            typeof baseline[key] === "number" &&
            typeof input[key] === "number" &&
            typeof element[key] === "number"
          ) {
            Reflect.set(
              baseline,
              key,
              baseline[key] + element[key] - input[key],
            );
          } else if (Object.hasOwn(element, key)) {
            Reflect.set(baseline, key, structuredClone(element[key]));
          } else {
            Reflect.deleteProperty(baseline, key);
          }
        }
      }
    }
  }

  publish(elements: readonly TElement[]): string[] {
    const canonical = new Map(
      this.binding
        .getCanonical()
        .elements.map((element) => [element.id, element]),
    );
    const assets = this.binding.getCanonical().assets;
    const changes: TElement[] = [];
    const reordering = new Set<string>();
    for (const incoming of elements) {
      this.observeVersion(incoming);
      // 未关联图片属于本地 overlay，技术加载状态也不构成文档编辑。
      if (
        incoming.type === "image" &&
        (typeof incoming.fileId !== "string" || !assets[incoming.fileId])
      ) {
        continue;
      }
      const before = this.display.get(incoming.id);
      const source = canonical.get(incoming.id);
      if (!before) {
        if (source) {
          continue;
        }
        reordering.add(incoming.id);
        changes.push(
          structuredClone(
            incoming.type === "image"
              ? { ...incoming, status: "saved" }
              : incoming,
          ),
        );
        continue;
      }
      const keys = new Set([...Object.keys(before), ...Object.keys(incoming)]);
      const changed = [...keys].filter(
        (key) => !technical.has(key) && !equal(before[key], incoming[key]),
      );
      if (!changed.length || !source) {
        continue;
      }
      if (changed.includes("index")) {
        reordering.add(incoming.id);
      }
      const next = structuredClone(source);
      for (const key of changed) {
        if (
          ["x", "y", "width", "height", "angle"].includes(key) &&
          typeof incoming[key] === "number" &&
          typeof before[key] === "number" &&
          typeof source[key] === "number"
        ) {
          // 容器/绑定恢复可能调整显示几何值；只将用户的相对变化施加到 canonical。
          const baselineValue = this.projectedCanonical.get(incoming.id)?.[key];
          Reflect.set(
            next,
            key,
            incoming[key] +
              (typeof baselineValue === "number"
                ? baselineValue - before[key]
                : 0),
          );
        } else if (Object.hasOwn(incoming, key)) {
          Reflect.set(next, key, structuredClone(incoming[key]));
        } else {
          Reflect.deleteProperty(next, key);
        }
      }
      // 编辑器操作 nonce 保留；canonical 版本从最新 Yjs 值递增，不透传显示升版。
      next.version = source.version + 1;
      next.versionNonce = incoming.versionNonce;
      next.updated = incoming.updated;
      if (next.type === "image") {
        next.status = "saved";
      }
      changes.push(next);
    }
    if (reordering.size) {
      const changesById = new Map(
        changes.map((element) => [element.id, element]),
      );
      const ordered = elements.filter(
        (element) => canonical.has(element.id) || changesById.has(element.id),
      );
      for (let offset = 0; offset < ordered.length; ) {
        if (!reordering.has(ordered[offset]!.id)) {
          offset++;
          continue;
        }
        const start = offset;
        const left = start
          ? (changesById.get(ordered[start - 1]!.id) ??
              canonical.get(ordered[start - 1]!.id))!.index
          : null;
        while (offset < ordered.length && reordering.has(ordered[offset]!.id)) {
          offset++;
        }
        // 并发同索引挤满边界时仅扩展右侧必要邻域，不能全场景重编号。
        while (
          offset < ordered.length &&
          left !== null &&
          canonical.get(ordered[offset]!.id)!.index <= left
        ) {
          reordering.add(ordered[offset]!.id);
          offset++;
        }
        const right =
          offset < ordered.length
            ? canonical.get(ordered[offset]!.id)!.index
            : null;
        const indexes = generateNKeysBetween(left, right, offset - start);
        for (let index = start; index < offset; index++) {
          const id = ordered[index]!.id;
          const existing = changesById.get(id);
          const value = existing ?? {
            ...canonical.get(id)!,
            version: canonical.get(id)!.version + 1,
            versionNonce: ordered[index]!.versionNonce,
          };
          value.index = indexes[index - start]!;
          changesById.set(id, value);
        }
      }
      changes.splice(0, changes.length, ...changesById.values());
    }
    const ids = this.binding.applyCommand({ elements: changes });
    // 包括未发布的技术变化，已发布并输掉的值不会在交互结束自动再发。
    this.accept(elements);
    const accepted = new Map(
      this.binding
        .getCanonical()
        .elements.map((element) => [element.id, element]),
    );
    const acceptedProjection = new Map(
      projectExcalidrawDisplayElements([...accepted.values()]).map(
        (element) => [element.id, element],
      ),
    );
    for (const id of ids) {
      this.projectedCanonical.set(id, structuredClone(accepted.get(id)!));
      this.projectedInput.set(
        id,
        this.withoutTechnical(acceptedProjection.get(id)!),
      );
    }
    return ids;
  }

  private observeVersion(element: TElement): void {
    this.watermarks.set(
      element.id,
      Math.max(this.watermarks.get(element.id) ?? 0, element.version),
    );
  }
  private withoutTechnical(element: TElement): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(element).filter(([key]) => !technical.has(key)),
    );
  }
}
