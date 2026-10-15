/**
 * 交互层画布（ui-canvas）的显式重绘入口。
 *
 * 交互层是 `React.memo(InteractiveCanvas)`，`areEqual` 只比较相关 appState 键 /
 * canvasNonce / elements 等 prop；而 `AnimationController` 里那个动画只在启动时
 * 同步画一帧，返回 undefined 的 animationState 就立刻注销（交互层没有常驻 RAF
 * 循环）。所以一帧画布要么由 InteractiveCanvas 真重渲染带上，要么由这里显式请求。
 *
 * 推论：`app.setState({})` **画不出任何东西**——所有值浅相等，memo 判定为相等，
 * 组件连 effect（刷新 rendererParams 并画一帧）都不会跑。悬停高亮这类只改
 * 「组件外部状态」（`app.quickCreate.getHovered()`、`app.mindmap` 的悬停等）的
 * 即时反馈必须走这个入口。
 */
export class AppRepaint {
  private renderer: (() => void) | null = null;

  /** 由 InteractiveCanvas 注册（rendererParams 就绪时），卸载时传 null 注销。 */
  setRenderer = (render: (() => void) | null) => {
    this.renderer = render;
  };

  /** 立即重绘一帧交互层。画布尚未挂载时是空操作。 */
  request = () => {
    this.renderer?.();
  };
}
