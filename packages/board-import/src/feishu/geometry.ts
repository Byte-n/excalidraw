// 画板几何量的归一化。
//
// 退化尺寸（NaN / Infinity / 负值 / 浮点噪声）规整为非负最小值；角度由度数
// 换算为弧度；z_index 收敛为整数。范围外取值一律回落到安全默认。

// 退化尺寸规整后保证非负的最小值。连线等无面积节点允许为 0，故取 0。
export const MIN_DIMENSION = 0;

// 浮点噪声阈值：小于该值的正数视为退化，规整到 MIN_DIMENSION。
const DIMENSION_EPSILON = 1e-9;

const DEG_TO_RAD = Math.PI / 180;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// 规整退化尺寸：NaN / Infinity / 负值 / 浮点噪声 → MIN_DIMENSION。
export function normalizeDimension(value: unknown): number {
  if (!isFiniteNumber(value) || value < MIN_DIMENSION) {
    return MIN_DIMENSION;
  }
  if (value < DIMENSION_EPSILON) {
    return MIN_DIMENSION;
  }
  return value;
}

// 度数 → 弧度；非有限值按 0。
export function toRadians(deg: unknown): number {
  return isFiniteNumber(deg) ? deg * DEG_TO_RAD : 0;
}

// z_index → 整数；非有限值按 0。
export function toIntegerZIndex(z: unknown): number {
  return isFiniteNumber(z) ? Math.trunc(z) : 0;
}
