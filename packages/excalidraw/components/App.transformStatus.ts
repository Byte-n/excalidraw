import type { Radians } from "@excalidraw/math";

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
  /** 多选旋转时本次手势累计转过的角度（单选直接用元素自身的 angle）。 */
  private rotationDelta: Radians | null = null;

  getRotationDelta = () => this.rotationDelta;

  setRotationDelta = (delta: Radians | null): void => {
    this.rotationDelta = delta;
  };

  /**
   * 抓住变换手柄、进入手势时调用。不清悬停态：按下还没动的时候手势读数
   * 尚未成立（`isResizing`/`isRotating` 要等第一次移动才置位），清掉会让
   * 「按住不放」时读数凭空消失。
   */
  beginGesture = (): void => {
    this.rotationDelta = null;
  };

  endGesture = (): void => {
    this.rotationDelta = null;
  };
}
