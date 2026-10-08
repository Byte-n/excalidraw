/** 按数据描述符复制 canonical，不读取 getter 或调用 toJSON；可选 undefined 由宿主 schema 判断。 */
export const cloneCanonicalData = <T>(value: T): T => {
  const ancestors = new Set<object>();
  const copy = (input: unknown, optional = false): unknown => {
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean" ||
      (optional && input === undefined) ||
      (typeof input === "number" && Number.isFinite(input))
    ) {
      return input;
    }
    if (
      typeof input !== "object" ||
      ancestors.has(input) ||
      (!Array.isArray(input) &&
        Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null)
    ) {
      throw new Error("invalid_scene");
    }
    ancestors.add(input);
    const entries: [string, unknown][] = [];
    for (const key of Reflect.ownKeys(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (typeof key === "symbol" || !descriptor || !("value" in descriptor)) {
        throw new Error("invalid_scene");
      }
      if (Array.isArray(input) && key === "length") {
        continue;
      }
      if (
        Array.isArray(input) &&
        (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= input.length)
      ) {
        throw new Error("invalid_scene");
      }
      const result = copy(descriptor.value, !Array.isArray(input));
      if (descriptor.enumerable && result !== undefined) {
        entries.push([key, result]);
      }
    }
    let result: unknown;
    if (Array.isArray(input)) {
      if (entries.length !== input.length) {
        throw new Error("invalid_scene");
      }
      result = entries.map(([, entry]) => entry);
    } else {
      result = Object.fromEntries(entries);
    }
    ancestors.delete(input);
    return result;
  };
  // 数据复制仅省略缺省字段；调用者必须再次使用宿主 schema 验证复制后的完整形状。
  return copy(value) as T;
};
