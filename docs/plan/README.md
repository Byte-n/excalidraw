# 实施计划索引

文档入口：[`docs/README.md`](../README.md)。

本目录保存当前仓库中的 phase 计划。范围与验收以计划为准；当前任务、执行空间与恢复入口以 `progress/` 账本为准。ADR、spec 与 phase 的维护规则见 [`docs/README.md`](../README.md)。

| 编号 | 主题 | 状态 | 计划 | 账本 | 关联 ADR |
| --- | --- | --- | --- | --- | --- |
| 01 | 画布搜索与定位 API | 未开始 | [phase-01](phase-01-canvas-search-navigation-api.md) | [progress](progress/phase-01-canvas-search-navigation-api.md) | — |
| — | 时序图分期实施 | 存量计划（无账本） | [sequence-diagram](../sequence-diagram/README.md) | — | — |

状态取值：`未开始 / 进行中 / 已完成 / 已取消`；本规范落地前、没有执行账本的计划统一标为 `存量计划（无账本）`，不补造账本。

- 新增计划使用 `phase-<编号>-<slug>.md`，从 `.agents/skills/phase-workflow/assets/plan-template.md` 复制；执行账本放 `progress/` 下的同名文件。
- 新增计划时在本表登记；收口时更新状态，并在账本记录最终 HEAD 与遗留限制。
- `sequence-diagram` 因被只读的 `docs/lark-exmples/` 相对链接引用，暂留 `docs/sequence-diagram/`；迁移时需同步处理该链接。
- 已完成并清理的计划以 git 历史为准，不在本表保留链接。
