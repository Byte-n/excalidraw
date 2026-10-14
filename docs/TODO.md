## 后续计划

- [ ] mindmap node 可以夸 mindmap 移动，不再限制必须是同一个 `graphId`
- [ ] mindmap node 可拖动放入另外一个 mindmap tree 中
- [ ] 剪贴板中只有 mindmap 时，若用户选择已有的 mindmap node（或 mindmap root node）再执行粘贴，就展示弹窗，选择“插入到选中的节点下” 还是 “粘贴为独立的 mindmap”
  - [ ] 前提如何支持 “圈选部分 mindmap node” ? 是否与当前的选区 mindmap 扩张有冲突？
- [ ] 统计图表（雷达图等）缺少功能入口：目前只能粘贴表格触发 `PasteChartDialog` 才能创建（普通 Cmd+V，不能用“粘贴为纯文本”，见 `components/app/clipboard.ts`），工具栏里没有任何图表工具
  - [ ] 入口形态：新增一个「图表」工具，还是并入已有的某个面板？
  - [ ] 雷达图还要求数据点 ≥ 3（`charts/charts.helpers.ts` 的 `isSpreadsheetValidForChartType`），入口里得能引导用户补足数据
