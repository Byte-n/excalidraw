// 无 DOM 环境（api 侧 node 运行时）的文字度量注入。
//
// fork 的文字元素构造依赖 `@excalidraw/element` 的 canvas 度量；该包提供
// `setCustomTextMetricsProvider` 作为宿主显式注入口。board-import 只在渲染前
// 注入一次确定性估算，文本盒尺寸随后按节点宽高覆盖，客户端会重算，故估算
// 只保证可构造、不追求像素精度。

import { setCustomTextMetricsProvider } from "@excalidraw/element";

let installed = false;

// 从 font string（如 `16px Nunito`）取字号，乘字符数的近似字宽估算。
function estimateLineWidth(text: string, fontString: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(fontString);
  const fontSize = match ? Number(match[1]) : 16;
  return text.length * fontSize * 0.6;
}

// 幂等注入：同一进程重复调用只装一次。
export function ensureHeadlessTextMetrics(): void {
  if (installed) {
    return;
  }
  installed = true;
  setCustomTextMetricsProvider({ getLineWidth: estimateLineWidth });
}
