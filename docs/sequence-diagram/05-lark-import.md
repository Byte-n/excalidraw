# P5：Lark 导入与工具链

- **状态**：未开始
- **依赖**：P1、P3
- **目标**：让飞书画板里的时序图节点能转成 `sc-*` 元素，并让 Agent 工具具备时序图基本语义。

## 1. 当前状态

- `packages/board-import/src/source.ts` 的 `LARK_KNOWN_NODE_TYPES` 已列出 `life_line` / `activation` / `combined_fragment`；
- 但 `feishu/resolve.ts` 的 `dispatchKind` 只映射基础图形、流程图、表格、脑图等；时序节点返回 `undefined`，被计入 dropped；
- `feishu/mapping.ts` 只有基础图形与流程图两张表；
- `feishu/convert.ts` 没有时序分支；
- `agent-tool` 能按 `sc-*` 创建/更新形状，但没有 `headHeight` / 杆长参数。

也就是说：**做这套图形的初衷（Lark 白板导入）目前走不通。**

## 2. 映射规则

| Lark `type` | 判定 | Excalidraw |
| --- | --- | --- |
| `life_line` | `lifeline.type` 为 entity / control / boundary / actor_lifeline / queue / data_base / object_lifeline / collection | 对应 `sc-lifeline-*` |
| `activation` | — | `sc-activation` |
| `combined_fragment` | — | `sc-fragment` |

生命线尺寸：

```ts
headHeight = node.height; // 样例 JSON 里就是头部高
height = node.height + (node.lifeline?.size ?? SEQUENCE_DEFAULT_POLE_LENGTH);
width = node.width;
```

- 样例的 `lifeline.size` 是 360；
- 元素总高 = 头部高 + 杆长，符合 P1 的不变量；
- `text` 落到绑定文本；
- 角度、z-order 沿用 board-import 现有规则。

样式：按原始方案决策 4「只映射形状，不映射样式」，使用项目预设样式；如果 board-import 现有图形已经映射了 fill/stroke，则时序图保持一致，不单独特判。

## 3. 实现清单

### 3.1 board-import

- [ ] `feishu/resolve.ts`
  - [ ] `BoardNodeKind` 增加 `lifeLine` / `activation` / `fragment`；
  - [ ] `dispatchKind` 增加三种 `type`；
  - [ ] 保持未知类型丢弃统计。
- [ ] `feishu/mapping.ts`
  - [ ] `LIFE_LINE_BY_LARK`：8 种 `lifeline.type` → `buildShapeData("sc-lifeline-*")`；
  - [ ] `ACTIVATION_SHAPE` / `FRAGMENT_SHAPE`；
  - [ ] 抽一个 `resolveSequenceShape`，与 `resolveCompositeShape` 并列。
- [ ] `feishu/convert.ts`
  - [ ] `case "lifeLine"`：
    - 校验 `lifeline.type` 是否已知；
    - `headHeight = normalizedHeight`；
    - `element.height = headHeight + size`；
    - 标签文本；
  - [ ] `case "activation"`：普通形状构造；
  - [ ] `case "fragment"`：外框 + 页签；如有文本，写入绑定文本；
  - [ ] 缺参/未知 `lifeline.type` 的降级口径（丢弃计数，或回落矩形，二选一并写测试）。
- [ ] `feishu/connector.ts`
  - [ ] 端点绑定到 activation 或生命线中心线（P3 完成后）；
  - [ ] 没有消息样例时，至少保证 connector 不会导致整板失败。

### 3.2 Agent 工具

- [ ] `packages/element/src/shapeScene.ts`
  - [ ] `ShapeOptionsFor` 增加时序选项：
    ```ts
    type SequenceLifelineOptions = Readonly<{
      headHeight?: number;
      poleLength?: number;
    }>;
    ```
  - [ ] create / update 时保持 `height = headHeight + poleLength`；
  - [ ] 更新头高时保持杆底不动（或保持杆长，二选一并写清楚）。
- [ ] `packages/agent-tool/src/api-documentation.generated.ts`
  - [ ] 重新生成，确保 `sc-*` 与时序选项出现在文档中。

### 3.3 文档

- [ ] 更新 `docs/lark-exmples/sequence/sequence-mapper.md`
  - [ ] 补充 board-import 的实际入口；
  - [ ] 补充 `activation` / `combined_fragment` 的转换口径；
  - [ ] 更新「本期不做」清单。
- [ ] 在 `docs/sequence-diagram/README.md` 的分期表里把 P5 标记为已实现。

## 4. 测试

- [ ] 用 `docs/lark-exmples/sequence/lark-sequence.json` 作为 fixture：
  - [ ] 8 个生命线全部映射成功；
  - [ ] `headHeight` 与样例 JSON 逐节点一致；
  - [ ] `height = headHeight + 360`；
  - [ ] `activation` 尺寸 30×100；
  - [ ] `fragment` 尺寸 400×240；
  - [ ] 文本、z-order、坐标与样例一致；
  - [ ] 未知 `lifeline.type` 的降级计数正确。
- [ ] connector 端点：
  - [ ] 指向 activation 时绑定成功；
  - [ ] 指向生命线时按 P3 规则落到激活条或中心线；
  - [ ] 指向空白时保持现有降级。
- [ ] Agent 工具：
  - [ ] 创建 `sc-lifeline-entity` 不传尺寸时使用默认 `headHeight + pole`；
  - [ ] 更新 `headHeight` 后 `element.height` 正确；
  - [ ] 更新后仍满足 P1 不变量。

## 5. 验收

- [ ] 飞书样例可完整导入，无时序节点被 dropped；
- [ ] 导入后的生命线选择/缩放/杆底控制点符合 P2；
- [ ] 导入后的激活条可被消息绑定；
- [ ] 导入后的 fragment 可继续加行（P4）；
- [ ] 保存、重新打开、复制粘贴后几何不漂移；
- [ ] Agent 工具能创建并更新时序图形。

## 6. 不做

- Lark 回写（可作为 P6 另立）；
- Mermaid `sequenceDiagram` → `sc-*` 的转换；
- 时序图样式逐字段映射（颜色/线宽/字体按项目预设）；
- 自动布局、消息排序、序号分配；
- 跨页/分组的时序图特殊处理。

## 7. 风险

- 样例 JSON 的 `combined_fragment` 没有文本字段，页签标题可能来自 PDF 或接口其他位置；导入时要做缺省处理。
- `lifeline.size` 与节点 `height` 的语义必须写死：`height` 是头部高，`size` 是杆长，不能混用。
- connector 的端点语义在 board-import 与 P3 之间要统一：是绑定到 activation，还是先落到生命线再自动建 activation。
- 如果 P3 的消息语义（同步/异步/返回）没有落地，导入只能保证几何，不能保证语义；需要在验收里区分「形状导入」与「语义导入」。
