import type { SceneBinding, SceneElement } from "./types";
const technical = new Set(["version", "versionNonce", "updated", "status"]);
const geometry = new Set(["x", "y", "width", "height", "angle"]);
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export type SceneSession<TElement extends SceneElement> = {
  project(
    current?: readonly TElement[],
    protectedIds?: ReadonlySet<string>,
  ): readonly TElement[];
  accept(
    elements: readonly TElement[],
    protectedIds?: ReadonlySet<string>,
  ): void;
  publish(elements: readonly TElement[]): void;
  dispose(): void;
};
/** 在 Y.Doc 外维护 canonical/display 双基线、投影输入、版本水位与交互暂缓。 */
export const createSceneSession = <
  TElement extends SceneElement,
  TAsset = unknown,
>(
  binding: SceneBinding<TElement, TAsset>,
  project = (elements: readonly TElement[]) => {
    const adapter = binding.getAdapter?.();
    return (
      adapter?.projectDisplay?.({
        elements,
        assets: binding.getAssets(),
      }) ??
      adapter?.project?.(elements) ??
      elements
    );
  },
): SceneSession<TElement> => {
  const display = new Map<string, TElement>();
  const projectedCanonical = new Map<string, TElement>();
  const projectedInput = new Map<string, Record<string, unknown>>();
  const watermarks = new Map<string, number>();
  let protectedInput = new Map<string, TElement>();
  let disposed = false;
  const observe = (e: TElement) => {
    if (typeof e.version === "number") {
      watermarks.set(e.id, Math.max(watermarks.get(e.id) ?? 0, e.version));
    }
  };
  const withoutTechnical = (e: TElement) =>
    Object.fromEntries(Object.entries(e).filter(([k]) => !technical.has(k)));
  const projectScene = (
    current: readonly TElement[] = [],
    protectedIds: ReadonlySet<string> = new Set(),
  ) => {
    if (disposed) {
      return [];
    }
    const source = binding.getElements();
    const canonicalById = new Map(source.map((e) => [e.id, e]));
    const local = new Map(current.map((e) => [e.id, e]));
    const projected = project(source).map((raw) => {
      observe(raw);
      const next = structuredClone(raw);
      const prior = projectedCanonical.get(raw.id);
      const baseline = display.get(raw.id);
      const floor = watermarks.get(raw.id) ?? 0;
      if (
        prior &&
        baseline &&
        equal(prior, raw) &&
        equal(projectedInput.get(raw.id), withoutTechnical(next))
      ) {
        Reflect.set(next, "version", baseline.version);
        Reflect.set(next, "versionNonce", baseline.versionNonce);
      } else if (typeof next.version === "number" && next.version <= floor) {
        Reflect.set(next, "version", floor + 1);
      }
      projectedCanonical.set(
        raw.id,
        structuredClone(canonicalById.get(raw.id) ?? raw),
      );
      projectedInput.set(raw.id, structuredClone(withoutTechnical(next)));
      if (!protectedIds.has(raw.id)) {
        display.set(raw.id, structuredClone(next));
      }
      return protectedIds.has(raw.id) && local.has(raw.id)
        ? structuredClone(local.get(raw.id)!)
        : next;
    });
    protectedInput = new Map(
      current
        .filter((e) => protectedIds.has(e.id))
        .map((e) => [e.id, structuredClone(e)]),
    );
    return projected;
  };
  const accept = (
    elements: readonly TElement[],
    protectedIds: ReadonlySet<string> = new Set(),
  ) => {
    for (const e of elements) {
      observe(e);
      if (!protectedIds.has(e.id)) {
        display.set(e.id, structuredClone(e));
      } else {
        const input = protectedInput.get(e.id);
        const base = display.get(e.id);
        if (!input || !base) {
          continue;
        }
        for (const key of new Set([...Object.keys(input), ...Object.keys(e)])) {
          if (technical.has(key) || equal(input[key], e[key])) {
            continue;
          }
          if (
            geometry.has(key) &&
            typeof base[key] === "number" &&
            typeof input[key] === "number" &&
            typeof e[key] === "number"
          ) {
            Reflect.set(base, key, base[key] + e[key] - input[key]);
          } else if (Object.hasOwn(e, key)) {
            Reflect.set(base, key, structuredClone(e[key]));
          } else {
            Reflect.deleteProperty(base, key);
          }
        }
      }
    }
  };
  const publish = (elements: readonly TElement[]) => {
    if (disposed) {
      return;
    }
    const source = new Map(binding.getElements().map((e) => [e.id, e]));
    const changes: TElement[] = [];
    for (const incoming of elements) {
      observe(incoming);
      const before = display.get(incoming.id);
      const current = source.get(incoming.id);
      if (!before || !current) {
        if (!current) {
          changes.push(structuredClone(incoming));
        }
        continue;
      }
      const changed = [
        ...new Set([...Object.keys(before), ...Object.keys(incoming)]),
      ].filter((k) => !technical.has(k) && !equal(before[k], incoming[k]));
      if (!changed.length) {
        continue;
      }
      const next = structuredClone(current);
      for (const key of changed) {
        if (
          geometry.has(key) &&
          typeof incoming[key] === "number" &&
          typeof before[key] === "number" &&
          typeof current[key] === "number"
        ) {
          const projected = projectedCanonical.get(incoming.id)?.[key];
          Reflect.set(
            next,
            key,
            incoming[key] +
              (typeof projected === "number" ? projected - before[key] : 0),
          );
        } else if (Object.hasOwn(incoming, key)) {
          Reflect.set(next, key, structuredClone(incoming[key]));
        } else {
          Reflect.deleteProperty(next, key);
        }
      }
      Reflect.set(next, "version", (current.version ?? 0) + 1);
      Reflect.set(
        next,
        "versionNonce",
        incoming.versionNonce ?? current.versionNonce,
      );
      changes.push(next);
    }
    if (changes.length) {
      binding.applyLocal(changes);
    }
    accept(elements);
  };
  return {
    project: projectScene,
    accept,
    publish,
    dispose: () => {
      disposed = true;
      display.clear();
      projectedCanonical.clear();
      projectedInput.clear();
      watermarks.clear();
      protectedInput.clear();
    },
  };
};
