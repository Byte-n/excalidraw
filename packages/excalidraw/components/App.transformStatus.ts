import type { Bounds } from "@excalidraw/common";
import type { Radians } from "@excalidraw/math";

import type { TransformHandleType } from "@excalidraw/element";

import type App from "./App";

/**
 * 变换读数（旋转角度／缩放尺寸）的状态。
 *
 * 两条状态都是「组件外部状态」：不放 appState，所以必须自己请求重绘
 * （`app.repaint.request()`，见 `App.repaint.ts`——`setState({})` 画不出东西）。
 * 这也是刻意的：塞进 appState 就得同步加进 `InteractiveCanvas.tsx` 的
 * `getRelevantAppStateProps` 白名单，漏一个键画布就不重绘。
 *
 * 形态对齐 `App.quickCreate`：悬停由指针移动路径写入，渲染层只读。
 */
export class AppTransformStatus {
  private hovered: {
    handle: TransformHandleType;
    selectionKey: string;
  } | null = null;

  /** 多选旋转时本次手势累计转过的角度（单选直接用元素自身的 angle）。 */
  private rotationDelta: Radians | null = null;

  /**
   * 多选旋转时按下瞬间的选区框。渲染层读它拿「选区大小」——旋转中的实时
   * AABB 会随角度呼吸，和旁边稳定跳动的增量并排会显得读数在乱抖。
   */
  private gestureBounds: Bounds | null = null;

  constructor(private readonly app: App) {}

  /**
   * 当前选中集合的指纹。悬停态记下它，读的时候比对：选区换过就当作没有悬停，
   * 免得上一份选区的读数残留在新的选区上（换选区不一定触发一次 pointermove）。
   */
  private selectionKey = () =>
    Object.keys(this.app.state.selectedElementIds).sort().join(",");

  getHoveredHandle = (): TransformHandleType | null => {
    if (!this.hovered) {
      return null;
    }
    if (this.hovered.selectionKey !== this.selectionKey()) {
      return null;
    }
    // 手势进行中读数由手势接管（`isResizing` 按定义不含旋转，两者分开看）
    if (this.app.state.isResizing || this.app.state.isRotating) {
      return null;
    }
    return this.hovered.handle;
  };

  setHoveredHandle = (handle: TransformHandleType): void => {
    const selectionKey = this.selectionKey();
    if (
      this.hovered?.handle === handle &&
      this.hovered.selectionKey === selectionKey
    ) {
      return;
    }
    this.hovered = { handle, selectionKey };
    this.app.repaint.request();
  };

  clearHovered = (): void => {
    if (!this.hovered) {
      return;
    }
    this.hovered = null;
    this.app.repaint.request();
  };

  getRotationDelta = () => this.rotationDelta;

  getGestureBounds = () => this.gestureBounds;

  setRotationDelta = (delta: Radians | null): void => {
    this.rotationDelta = delta;
  };

  /**
   * 抓住变换手柄、进入手势时调用。不清悬停态：按下还没动的时候手势读数
   * 尚未成立（`isResizing`/`isRotating` 要等第一次移动才置位），清掉会让
   * 「按住不放」时读数凭空消失。
   */
  beginGesture = (bounds: Bounds | null): void => {
    this.gestureBounds = bounds;
    this.rotationDelta = null;
  };

  endGesture = (): void => {
    this.gestureBounds = null;
    this.rotationDelta = null;
  };
}
