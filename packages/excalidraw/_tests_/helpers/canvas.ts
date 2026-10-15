/**
 * 记录交互画布 2d 上下文的 strokeRect 调用。返回 [取调用, 还原]。
 *
 * 画布上的矩形描边最终都落到 `context.strokeRect`（选区框走
 * `strokeRectWithRotation_simple`，见 `renderer/helpers.ts`），所以断言「框
 * 画没画」看它就够，不用把渲染层的几何常量抄一遍。
 *
 * `getRects()` 拿到的是**最近一帧**的调用：每次 `getContext("2d")` 都会重置
 * 该画布的记录数组，而画布每帧重建上下文（`renderer/helpers.ts` 的
 * `bootstrapCanvas`）。
 */
export const spyInteractiveStrokeRects = () => {
  const callsByCanvas = new WeakMap<
    object,
    [number, number, number, number][]
  >();
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    ...args: any[]
  ) {
    const ctx = (origGetContext as any).apply(this, args);
    if (args[0] !== "2d" || !ctx) {
      return ctx;
    }
    const rects: [number, number, number, number][] = [];
    callsByCanvas.set(this, rects);
    return new Proxy(ctx, {
      get(target, prop: string) {
        const value = (target as any)[prop];
        if (typeof value === "function") {
          return (...fnArgs: unknown[]) => {
            if (prop === "strokeRect") {
              rects.push(fnArgs as [number, number, number, number]);
            }
            return value.apply(target, fnArgs);
          };
        }
        return value;
      },
    }) as typeof ctx;
  } as any;

  const getRects = () => {
    const interactive = document.querySelector(
      "canvas.excalidraw__canvas.interactive",
    ) as HTMLCanvasElement;
    return callsByCanvas.get(interactive) ?? [];
  };
  const restore = () => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
  };
  return { getRects, restore };
};
