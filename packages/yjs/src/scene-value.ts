/** Yjs 场景值必须可编码，循环和非数据值必须在发布事务前拒绝。 */
export const assertSceneValue = (
  value: unknown,
  ancestors = new Set<object>(),
): void => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("scene value must contain finite numbers");
    }
    return;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new Error("scene value must be acyclic data");
  }
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new Error("scene value must contain plain objects");
  }
  ancestors.add(value);
  for (const entry of Object.values(value)) {
    assertSceneValue(entry, ancestors);
  }
  ancestors.delete(value);
};

/** 保留 undefined 与缺失键的区别，不使用 JSON stringify 的有损比较。 */
export const equalSceneValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        equalSceneValue(Reflect.get(left, key), Reflect.get(right, key)),
    )
  );
};
