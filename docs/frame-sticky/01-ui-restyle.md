# Frame 与便签 UI/UX 重设计

- 状态：已实施。
- 设计依据：`.tmp/design/excalidraw-canvas-frame.html`、`.tmp/design/excalidraw-canvas-sticky.html`（含亮/暗双主题令牌与交互状态图）。
- 参考先例：[表格 P06 UI 重设计](../table-container/phase-6.md)、[思维导图 P12 UI 重设计](../mindmap-plan/12-mindmap-ui-restyle.md)。

## Context

设计稿把 Frame 从「装饰性矩形」重定义为画板：实色背景遮住点阵、1px 浅灰边框、标题缩小加 # 图标，交互反馈统一走主色（`#1677ff` / 暗色 `#4096ff`）。便签保留「纸片」感，用柔和双层投影替代抖动轮廓与硬偏移阴影，六色低饱和纸色替换当前快捷色。本期不改交互模型（创建、编辑、归属、裁剪逻辑全部保留），只做**视觉语言替换 + 反馈补强**。

零历史包袱原则沿用表格总览跨期不变量：不迁移、不兼容旧外观；新默认值直接生效。

## 差异分析（设计稿 ↔ 当前实现）

### Frame

#### A. 重定义的视觉

1. **边框**：当前 2px `#BBB`（`constants.ts:203-216` `FRAME_STYLE`，`renderElement.ts:1166-1207`）→ 1px `#D0D3D9`，圆角 8px 不变。
2. **背景**：当前透明（`renderElement.ts:1174` 的 fillStyle 为死代码，SVG 导出 `fill="none"`，`staticSvgScene.ts:782-816`）→ 实色 `#FFFFFF`（暗色走统一滤镜），遮住点阵，导出保留。
3. **标题**：当前 14px `#999`、距边框 3px（DOM 渲染，`components/app/frames.tsx:83-264`）→ 12px/500 `#646A73`，基线在边框上方 8px，左侧 10px「#」画板图标。
4. **悬停**：当前无 frame 专属悬停（走通用 hoveredElementId 外框）→ 悬停标题或边框时：边框 1.5px 主色 55%、标题墨色；悬停内部内容不触发（命中已限边框+标题，`collision.ts:192-238`，无需改）。
5. **选中**：当前选中框带通用 padding → 选中框与边框重合（padding 0）、标题主色；frame 不可旋转、无旋转手柄（现状已如此，回归）。
6. **拖入目标**：当前仅 2px 蓝描边（`renderFrameHighlight`，`interactiveScene.ts:1417-1445`）→ 背景混入 6% 主色 + 1.5px 主色边框 + 标题主色。
7. **重命名**：双击标题原位输入框已有（frames.tsx:158-207）→ 白底、1px 主色边框、圆角 4（现状已接近），输入期间隐藏 # 图标（输入框本身即替换标题，天然满足）。

#### B. 现状一致（不改动，验收时回归）

- 内容裁剪已完整实现（`staticScene.ts:165-189` `frameClip`、`:358-393` `clipElementToFrame`、SVG `maybeWrapNodesInFrameClipPath`），默认开启。
- 命中只在边框 + 标题（`collision.ts:98-130,192-238`）。
- frame 内元素 z-index 连续区间管理（`zindex.ts:147-153,287-293,616-619`）。
- magicframe 特判描边色（`renderElement.ts:1183-1188`）保留。

### 便签

#### A. 重定义的视觉

1. **形状**：当前带抖动 jitter 的轮廓 + 内描边 `rgba(0,0,0,0.08)`（`stickyNote.ts:225-368`、`renderElement.ts:499-533`）→ 圆角 4px 矩形，无描边。
2. **投影**：当前 3px 硬偏移 16% 黑色阴影（`STICKY_NOTE_SHADOW_OFFSET/OPACITY`，`constants.ts:277-280`）→ 双层柔和投影 `0 1 2 / 8% + 0 3 8 / 10%`；悬停与拖动中抬升为 `0 2 3 / 8% + 0 8 20 / 14%`。
3. **颜色**：当前默认 `#FFDF6B` + 5 个快捷色（`colors.ts:270,283-289`）→ 六色 `#FFE58F`（默认黄）`#C6EFD9` `#CDE3FC` `#FCD5DD` `#E2D8FB` `#E5E6EB`；黄色文字专属深棕 `#5C4200`，其余墨色（`syncStickyNoteInk`，`stickyNote.ts:145-187`）。
4. **文字**：内边距 16 已是现状；行高对齐 1.55；自动字号保留（短文本放大、长文本缩小、最小 12px）。
5. **页脚**：当前 12px Helvetica「7 Sep」、不透明（`STICKY_NOTE_FOOTER`，`constants.ts:258-265`、`stickyNote.ts:423-493`）→ 11px、55% 透明、中文格式「10月11日」（跨年带年份），右下对齐不变。数据源用元素基类 `created` 字段（`types.ts:78-82`），不新增字段。
6. **悬停**：当前通用悬停外框 → 便签不画悬停描边，只抬升投影；拖动过程中保持抬升。
7. **编辑中**：1.5px 主色内框代替选中框（`interactiveScene.ts` 对 stickynote 特判）。

#### B. 现状一致（不改动，验收时回归）

- 绑定 text 子元素 + 容器布局/字号自适应（`stickyNote.ts` `getStickyNoteLayout`/`fitStickyNoteFont`）。
- `baseHeight` 用户设定基准高度、内容超出自动长高。
- 创建入口（工具按钮、指针创建）、文本编辑走通用 wysiwyg 通道。

## 产品判断点（本期的取舍，可推翻）

1. **暗色主题走全 app 统一的 `applyDarkModeFilter`**（与表格 P06 D.1、思维导图 P12 D.3 一致），不逐像素复刻设计稿暗色 hex（`#6B5612` 等）；六色纸存亮色值，绘制时换算。
2. **便签正文字体族不随本期切换「系统字体」**：字体族切换影响文字测量与全部既有测试基线，沿用表格 P06 D.3 的决策留待单独处理；页脚同样沿用当前字体族，仅改字号/透明度/格式。
3. **Frame 背景实色填充参与导出**：设计稿明确「导出时保留」，SVG 导出同步填充（与表格白底导出同一语义）。
4. **便签页脚日期格式改为中文「M月D日」**：替换「7 Sep」；跨年补年份「2025年10月11日」。旧便签元素显示随之变化（零历史包袱）。
5. **黄色便签墨色 `#5C4200` 通过 `syncStickyNoteInk` 特判实现**：仅黄色背景时 label 文字与 stroke 同步为该色，其余五色沿用元素自身墨色。

## 实施方案

### Phase 1 — 便签视觉（sticky agent）

- `constants.ts`：投影常量改为双层柔和参数（新增 blur 参数，废弃硬偏移）；`STICKY_NOTE_FOOTER` fontSize 12→11、opacity 1→0.55。
- `colors.ts`：`DEFAULT_STICKY_NOTE_BG` → `#FFE58F`；`STICKY_NOTE_BACKGROUND_PICKS` 整体替换为六色。
- `stickyNote.ts`：路径生成去 jitter、圆角 4；页脚格式「M月D日」/跨年带年份；`syncStickyNoteInk` 黄色特判 `#5C4200`。
- `renderElement.ts` / `staticSvgScene.ts`：便签渲染改为圆角矩形 + canvas `shadowBlur` 双层投影（SVG 用 `feDropShadow`），去掉内描边与硬偏移阴影。
- `interactiveScene.ts`：stickynote 悬停不画通用外框、投影抬升（含拖动中）；编辑中画 1.5px 主色内框。
- 测试：`element/_tests_/stickyNote.test.ts`、`excalidraw/_tests_/stickyNotes.test.tsx`、`colorTargets.test.ts` 同步。

### Phase 2 — Frame 视觉与反馈（frame agent）

- `constants.ts` `FRAME_STYLE`：strokeColor `#D0D3D9`、strokeWidth 1、backgroundColor `#FFFFFF`、nameFontSize 12、nameOffsetY 3→8、nameColor `#646A73`/`#A3A9B2`。
- `renderElement.ts:1166-1207`：补实底填充（清死代码），magicframe 特判保留；`staticSvgScene.ts:782-816` 导出同步填充。
- `frames.tsx`：标题 12px/500 + 左侧 # 图标（内联 SVG），距边框 8px；悬停/选中/拖入时标题变色（墨色/主色，读 appState）；重命名输入框样式对齐。
- `interactiveScene.ts`：frame 悬停特判（边框 1.5px 主色 55%，替代通用 hover 外框）；`renderFrameHighlight` 加 6% 主色填充、线宽 2→1.5；frame 选中框 padding 0。
- `export.ts:109-139` 标题导出字号同步 12px。
- 测试：`element/_tests_/frame.test.tsx`、`interactivity.test.tsx`、`renderOverrides.test.tsx` 同步。

### Phase 3 — 验收（verify agent）

- `yarn test:typecheck` + 相关测试文件全量回归；修复快照与断言漂移。
- 测试代码不留调试打印。

## 关键文件

- `packages/common/src/constants.ts`（FRAME_STYLE、STICKY_NOTE_*、STICKY_NOTE_FOOTER）
- `packages/common/src/colors.ts`（便签六色）
- `packages/element/src/stickyNote.ts`、`renderElement.ts`
- `packages/excalidraw/renderer/interactiveScene.ts`、`staticSvgScene.ts`、`staticScene.ts`
- `packages/excalidraw/components/app/frames.tsx`
- `packages/excalidraw/scene/export.ts`

## 测试

- **命令**：`yarn test:typecheck`、`yarn test:update`（提交前必跑）；测试代码不留调试打印。
- **手工验证（由用户执行）**：`yarn start` 起 app ——
  1. 新建 frame：实底遮点阵、1px 浅灰边框、12px 标题带 # 图标；
  2. 悬停 frame 标题/边框看主色反馈，悬停内部元素不触发；
  3. 选中 frame：选中框与边框重合、无旋转手柄、标题主色；
  4. 拖元素进 frame：6% 主色底 + 主色边框，松手归属；
  5. 双击标题重命名：原位白底输入框，回车/失焦提交；
  6. frame 内容裁剪回归（拖元素越界看裁剪与虚线轮廓）；
  7. 新建便签：默认黄色圆角纸片 + 柔和投影、六色快捷色切换、黄色深棕文字；
  8. 便签悬停抬升投影（无描边）、拖动保持抬升、双击编辑看主色内框；
  9. 便签页脚「M月D日」11px 弱化；自动字号回归（长文缩小）；
  10. 切暗色主题整体过一遍；导出 PNG/SVG 确认 frame 实底与便签投影保留。
