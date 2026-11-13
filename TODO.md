# TODO

## 统一规划所有图形/图元的连接点与吸附策略

- [ ] 执行计划：按 [docs/pointer-pipeline/README.md](docs/pointer-pipeline/README.md) 的 PR1–PR6 推进——
      PR1 冻结连接基线并实现纯几何模块，PR2 建指针帧契约，PR3 连接接入，PR4 时序 affordance，PR5 通用 hover，PR6 清理。
- [ ] 统一连接点模型：每个图形声明允许连接的边（左 / 右 / 上 / 下或自定义路径）、锚点数量与间距、旋转/缩放后的锚点派生规则。
- [ ] 统一吸附管线：端点拖拽、quick-create 手柄、hover 预演、绑定跟随共用同一套候选点与最近点选择逻辑，去掉 `snapToMid`、`getSnapOutlineMidPoint`、`quickCreate` 中各自为政的图形特例。设计见 [docs/connection-snap-pipeline.md](docs/connection-snap-pipeline.md)。
- [ ] 覆盖所有图形家族：基础图形、流程图、时序图生命线 / 激活条 / fragment、表格、frame、便签等，明确每类的连接边限制与吸附半径。
- [ ] 输出统一规范与回归矩阵：鼠标 / 触屏 / 旋转 / 缩放 / 绑定跟随 / 多吸附点，并补齐自动化测试。
- [ ] 时序图当前只落地了「激活条左右边缘动态连接点」（已从多个固定吸附点改为随指针滑动），其余图形仍沿用旧的中点/四向锚点策略，待本次统一改造收敛。