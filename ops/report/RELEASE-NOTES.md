Project Pulse 跨平台上报包（macOS / Windows / Linux）。

解压到永久目录，用 Codex 打开 project-pulse-report 文件夹，复制 README 中的提示词发送。立即完成试报，并在成功后创建或更新、核验每30分钟同步任务。

- 客户端Codex负责项目、会话、成员、GitHub PR、模型／真实Token、摘要、目标和里程碑的识别与核验；先自行查找，仍缺信息才询问用户。
- 支持账号及会话目录迁移、同名项目识别、归属补报、失败续传、精确计量回执与客户端PR提交。
- 真正服务端须更新并重启，支持协议3及usage_receipt、project_mapping_backfill、client_pr_ingest。
- 包内含VERSION、SHA256SUMS和UPGRADE.md，不含本机路径映射、日志、设备状态或凭证。

代码已通过macOS、Windows、Ubuntu CI、39项本地测试及独立PostgreSQL集成测试。发布前另核对ZIP及逐文件校验和。真实定时触发是否成功，应由各客户端实际运行后验收。
