Project Pulse 跨平台上报包（macOS / Windows / Linux）。

3.1.1：Agent运行识别放宽为2小时窗口，补足消息、输出、工具和用量活动信号；unknown需近期实际用量，明确结束仍退出。前后端判定一致，与项目状态分离；增加指定源会话筛选。服务端更新重启即可启用新显示规则，009已应用时无需额外迁移。

3.1.0：客户端根据会话证据判断项目生命周期，独立statuses.json／状态回执；在研包含阻塞未完成项目，不依赖Agent是否运行，不按时间超时。产出文档按项目折叠，修复成员参与项目被时间范围过滤的问题，统一Token统计窗口并移除右上角时间标签。真正服务端先应用009_project_lifecycle迁移并重启。

解压到永久目录，用 Codex 打开 project-pulse-report 文件夹，复制 README 中的提示词发送。立即完成试报，并在成功后创建或更新、核验每30分钟同步任务。

- 客户端Codex负责项目、会话、成员、GitHub PR、模型／真实Token、摘要、目标和里程碑的识别与核验；先自行查找，仍缺信息才询问用户。
- 支持账号及会话目录迁移、同名项目识别、归属补报、失败续传、精确计量回执与客户端PR提交。
- 真正服务端须应用009迁移并重启，支持协议3及usage_receipt、project_mapping_backfill、client_pr_ingest、client_project_status。
- 包内含VERSION、SHA256SUMS和UPGRADE.md，不含本机路径映射、日志、设备状态或凭证。

发布前核对macOS、Windows、Ubuntu CI、本地测试、独立PostgreSQL集成测试、ZIP及逐文件校验和。真实定时触发是否成功，应由各客户端实际运行后验收。
