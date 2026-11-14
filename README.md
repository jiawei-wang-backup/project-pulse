# Project Pulse

团队开发活动看板。每 30 分钟由开发者机器上选定的 Codex 或 Claude Code 根据脱敏事件生成摘要。采集器上报会话、模型和 Token。服务端只做校验、存储、GitHub PR 同步和展示。

## 本地预览

需要 Node.js 24+。客户端上报还需要 curl。运行 `npm ci` 和 `npm start`。未配置数据库时，打开 http://127.0.0.1:4174 可浏览演示版。

## 启用 PostgreSQL

1. 创建空数据库。用数据库管理凭证执行 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001_init.sql -f db/002_session_title.sql -f db/003_session_display_title.sql -f db/004_session_workspace.sql -f db/005_project_reports.sql`。已有数据库只需执行尚未应用的迁移。
2. 设置 `DATABASE_URL` 和独立的 `PULSE_VIEW_TOKEN`，运行 `npm start`。默认监听本机。团队部署时通过 HTTPS 反向代理暴露服务，数据库留在内网。看板以团队共享访问令牌登录，单设备采集凭证不能读取看板。
3. 为每台设备执行 `node db/admin.mjs enroll "姓名"`。为同一人增加设备时执行 `node db/admin.mjs enroll "姓名" <developer_uuid>`。安全分发输出中的 device_token。设备离开团队时执行 `node db/admin.mjs revoke <device_uuid>`。
4. 执行 `node db/admin.mjs repo owner/repo "业务分类"` 登记项目。私有仓库需在服务端配置拥有仓库及 PR 读取权限的 `PULSE_GITHUB_TOKEN`。用系统调度每 30 分钟运行 `npm run sync:prs`，也可手动触发。

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
| PULSE_SHARE_SESSION_TITLES | 可选。设为 `1` 时，从 Codex 会话索引读取并上报侧栏标题。标题可能含项目内容，只在允许共享标题时启用。 |
| PULSE_SUMMARY_CONTEXT | 可选。设为 `1` 时将少量任务描述和完成说明交给选定的总结工具。这些摘录可能包含项目内容，且所选工具可能将输入发给其模型服务。采集器上报生成的摘要。 |
| PULSE_STATE_DIR | 可选。本机配置、游标和队列目录，默认 `~/.project-pulse`。 |

将 [配置模板](client/config.example.json) 复制到状态目录下的 `config.json`，填入服务器地址、设备令牌及总结工具。macOS/Linux 上将该文件权限设为 `600`。已有的环境变量仍可覆盖配置。会话目录及仓库白名单继续用上表的环境变量。

`state.json` 同时记录读到的日志位置和待发请求。采集器先保存状态，再通过 curl 发送原批次，收到匹配的提交回执后从待发列表移除。升级首次运行时自动读取旧 `state.sqlite` 并迁移状态，保留原文件作为备份。正常运行只读写 JSON。强制结束留下 `collector.lock` 时，确认没有采集进程在运行后再删锁文件。

在所选开发工具配置每 **30 分钟**运行的本机任务，工作目录指向项目安装目录，使用 [上报提示词](prompts/report.md)。也可由系统调度启动已经配置好的本机工具。任务依次执行 `prepare`、生成会话总结和项目目标/里程碑、通过标准输入调用 `submit`。项目里程碑明确区分已完成与未完成，并附简短依据；证据不足时不能推断已完成。网络中断会保留待发队列。可用 `node client/pulse.mjs flush` 手动补传。

## 验证与当前范围

- `npm test` 运行原型及领域测试。
- 在临时空库执行迁移后，设置该库的 `DATABASE_URL` 并执行 `npm run test:integration`。测试会写入合成数据，请用可丢弃的数据库。
- 采集器对输入文件大小、行数、网络请求和每轮批次设限。真实开发机的开销还需试点实测。摘要使用有限的结构化事件信号，缺少证据时状态为未知。
- Codex 和 Claude Code 的基本适配使用合成会话做了端到端验证。Codex 额度可按上述账号 UUID 启用。Codex 子 Agent 采集范围见本机试点章节。GitHub 同步首轮读取每个仓库最新的 100 条 PR，之后按更新增量同步。
- PostgreSQL 模式的根地址使用正式工作台样式展示真实数据，包含项目目标、里程碑、人员、模型、会话摘要和按项目分组的 PR。尚无项目报告时仍显示里程碑空状态。未配置数据库时，根地址仍展示演示原型。旧版简化看板保留在 `/assets/live.html`，便于排查接口数据。

[技术方案和协议](技术方案.md) · [数据库迁移](db/001_init.sql)

## 本机试点

安装依赖后执行 `./ops/local.sh serve`，访问 http://127.0.0.1:4185。通过这个脚本启动的看板在本机直接打开即可。PostgreSQL 数据保存在 Docker 命名卷中，数据库端口仅绑定回环地址。

- `./ops/local.sh admin enroll "姓名"` 创建设备凭证。
- `./ops/local.sh sync` 执行一次 PR 同步。部署时可将 `ops/local-sync.sh` 每 30 分钟加入本机调度，并收集 stderr。私有仓库同步需要在任务环境加载 GitHub 读取凭证。
- `./ops/local.sh backup` 生成 PostgreSQL 自定义格式备份。恢复演练时先创建空库，再用 `pg_restore --exit-on-error --dbname <空库连接串> <备份文件>` 恢复，核对设备、会话和 PR 记录。
- Codex 子 Agent 在日志提供父线程 ID 且本机能解析父链时归到根会话。子线程累计 Token 暂不进入汇总，因为日志可能包含继承的历史计数。Claude Code 子 Agent 暂未接入。
