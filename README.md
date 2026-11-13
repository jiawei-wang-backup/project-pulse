# Project Pulse

团队开发活动看板。每 30 分钟由开发者机器上选定的 Codex 或 Claude Code 根据脱敏事件生成摘要。采集器上报会话、模型和 Token。服务端只做校验、存储、GitHub PR 同步和展示。

## 本地预览

需要 Node.js 24+。运行 `npm ci` 和 `npm start`。未配置数据库时，打开 http://127.0.0.1:4174 可浏览演示版。

## 启用 PostgreSQL

1. 创建空数据库。用数据库管理凭证执行 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001_init.sql`。
2. 设置 `DATABASE_URL` 和独立的 `PULSE_VIEW_TOKEN`，运行 `npm start`。默认监听本机。团队部署时通过 HTTPS 反向代理暴露服务，数据库留在内网。看板以团队共享访问令牌登录，单设备采集凭证不能读取看板。
3. 为每台设备执行 `node db/admin.mjs enroll "姓名"`。为同一人增加设备时执行 `node db/admin.mjs enroll "姓名" <developer_uuid>`。安全分发输出中的 device_token。设备离开团队时执行 `node db/admin.mjs revoke <device_uuid>`。
4. 执行 `node db/admin.mjs repo owner/repo "业务分类"` 登记项目。私有仓库需在服务端配置拥有仓库及 PR 读取权限的 `PULSE_GITHUB_TOKEN`。用系统调度每 15 分钟运行 `npm run sync:prs`，也可手动触发。

## 配置开发者设备

在同一个本机定时任务环境配置下表。项目路径和环境配置只留在本机。令牌可从系统密钥库载入。每台机器只启用一个总结任务。

| 环境变量 | 用途 |
|---|---|
| PULSE_SERVER_URL | 看板服务的 HTTPS 地址。本机联调用 HTTP loopback。 |
| PULSE_DEVICE_TOKEN | 管理员发放的设备令牌。 |
| PULSE_REPOSITORIES | 允许上报归属的 GitHub 仓库，以逗号分隔。 |
| PULSE_CODEX_DIR | 已授权的 Codex JSONL 会话目录，例如 `~/.codex/sessions` 的绝对路径。 |
| PULSE_CLAUDE_DIR | 已授权的 Claude Code JSONL 项目目录，例如 `~/.claude/projects` 的绝对路径。 |
| PULSE_SUMMARIZER_TOOL | `codex` 或 `claude_code`。决定总结来源。可与会话来源不同。 |
| PULSE_CODEX_ACCOUNT_ID | 可选。为已确认使用单一 Codex 账号的设备配置账号 UUID。同一个人的同一账号跨设备复用 UUID，换号时停用或重新配置。 |
| PULSE_STATE_DIR | 可选。SQLite 游标和队列位置，默认 `~/.project-pulse`。 |

在所选开发工具配置每 **30 分钟**运行的本机任务，工作目录指向项目安装目录，使用 [上报提示词](prompts/report.md)。也可由系统调度启动已经配置好的本机工具。任务依次执行 `prepare`、生成总结、通过标准输入调用 `submit`。网络中断会保留待发队列。可用 `node client/pulse.mjs flush` 手动补传。

## 验证与当前范围

- `npm test` 运行原型及领域测试。
- 在临时空库执行迁移后，设置该库的 `DATABASE_URL` 并执行 `npm run test:integration`。测试会写入合成数据，请用可丢弃的数据库。
- 采集器对输入文件大小、行数、网络请求和每轮批次设限。真实开发机的开销还需试点实测。摘要使用有限的结构化事件信号，缺少证据时状态为未知。
- Codex 和 Claude Code 的基本适配使用合成会话做了端到端验证。Codex 额度可按上述账号 UUID 启用。子 Agent 保留了数据结构和看板查询，当前适配器仅上报主 Agent。GitHub 同步首轮读取每个仓库最新的 100 条 PR，之后按更新增量同步。
- PostgreSQL 模式使用独立的真实数据看板，包含项目、人员、模型、会话摘要和按项目分组的 PR。演示界面的完整任务详情及文档预览可在演示模式查看。

[技术方案和协议](技术方案.md) · [数据库迁移](db/001_init.sql)
