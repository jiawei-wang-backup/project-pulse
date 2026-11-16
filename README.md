# Project Pulse

团队开发活动看板。每 30 分钟由开发者机器上的 Codex 读取授权会话、生成摘要，并通过 curl 上报模型与 Token。服务端只做校验、存储、GitHub PR 同步和展示。

## 本地预览

看板服务需要 Node.js 24+。运行 `npm ci` 和 `npm start`。未配置数据库时，打开 http://127.0.0.1:4174 可浏览演示版。

## 启用 PostgreSQL

1. 创建空数据库。用数据库管理凭证执行 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001_init.sql -f db/002_session_title.sql -f db/003_session_display_title.sql -f db/004_session_workspace.sql -f db/005_project_reports.sql -f db/006_report_cursors.sql -f db/007_github_identities.sql`。已有数据库只需执行尚未应用的迁移。
2. 设置 `DATABASE_URL` 并运行 `npm start`。默认监听本机。团队部署时通过 HTTPS 反向代理暴露服务，数据库留在内网。看板读取接口无需登录；设备上报仍使用每台设备独立的采集凭证。
3. 管理员核对 GitHub 用户名后，在服务端为每台设备执行 `node db/admin.mjs enroll-github USERNAME`。同一个 GitHub 数字用户 ID 自动复用成员 UUID，每台电脑仍得到独立设备令牌。已有成员首次绑定时执行 `node db/admin.mjs enroll-github USERNAME <developer_uuid>`，已有设备和历史记录继续归属于该成员。不使用 GitHub 时仍可执行 `node db/admin.mjs enroll "姓名" [developer_uuid]`。只将新令牌发给对应成员。撤销单台设备可执行 `node db/admin.mjs revoke <device_uuid>`。
4. 执行 `node db/admin.mjs repo owner/repo "业务分类"` 登记项目。私有仓库需在服务端配置拥有仓库及 PR 读取权限的 `PULSE_GITHUB_TOKEN`。用系统调度每 30 分钟运行 `npm run sync:prs`，也可手动触发。

## 配置开发者设备

macOS 和 Windows 可使用 [固定脚本和快速试报说明](ops/report/README.md) 处理 Codex 增量。可信局域网试点也可分发 [单文件上报说明书](docs/lan-report.md)。管理员运行 `./ops/local.sh serve-lan <本机私有 IPv4>`，分发前将说明书里的服务地址改为实际局域网地址。此入口免设备令牌，HTTP 明文传输，供同一可信局域网内试跑。

复制整个 [Project Pulse 上报包](.agents/skills/project-pulse-report) 到另一台电脑，按 [试报说明](.agents/skills/project-pulse-report/SETUP.md) 配置。Codex 和 Claude Code 可以作为日志来源，也可以作为执行上报的工具。其他工具需有本机访问能力和已验证的日志格式映射。

macOS 和 Windows 客户端都使用已有的 Codex 和系统命令。由看板管理员发放设备令牌。用文本编辑器在当前用户目录下创建 `.project-pulse/config.json`，文件名以 `.json` 结尾。

```json
{
  "server_url": "http://127.0.0.1:4185",
  "device_token": "替换成管理员发放的设备令牌",
  "sources": ["codex"]
}
```

- **macOS**：运行 `mkdir -p ~/.project-pulse && chmod 700 ~/.project-pulse` 创建配置目录。保存配置后运行 `chmod 600 ~/.project-pulse/config.json`。Codex 用 `curl` 上报。
- **Windows**：在 PowerShell 中运行 `New-Item -ItemType Directory -Force -Path (Join-Path $HOME '.project-pulse') | Out-Null` 创建目录。配置放在个人用户目录下并使用 UTF-8 保存。Codex 用 Windows PowerShell 和系统的 `curl.exe` 上报，无需安装 WSL 或额外运行时。

团队其他电脑填实际部署的 HTTPS 地址。设备令牌可绑定到已有成员，同一人的多台电脑各用一个令牌。

在 Codex 桌面端为项目目录配置一个每 **30 分钟**运行的本机计划任务，任务内容填「PROJECT_PULSE_AUTOMATION。读取并执行 prompts/report.md。只上报授权的会话。」可先发同一句话手动试跑。运行环境须能读取授权日志并访问配置中的服务端。具体界面与运行条件见 [OpenAI 的计划任务文档](https://learn.chatgpt.com/docs/automations?surface=app)。

Codex 从 PostgreSQL 读取上次提交的位置，用 curl 发送结构化报告。数据库在同一事务里保存报告和游标。断网后下次从已确认位置继续；请求已提交但回执丢失时，可以重新查询游标。

从旧版客户端切换时，先停止旧任务并清空待发批次，在配置里加 `"report_from": "切换时刻的 UTC 时间"`，以免历史 Token 重复累计。新设备令牌可绑定原成员 UUID。旧客户端使用不同的会话标识，历史会话仍作为独立记录保留。旧版 Node.js 客户端保留用于兼容和测试。

## 验证与当前范围

- `npm test` 运行原型及领域测试。
- 在临时空库执行迁移后，设置该库的 `DATABASE_URL` 并执行 `npm run test:integration`。测试会写入合成数据，请用可丢弃的数据库。
- Codex 直报限制每轮日志数量和读取字节数。真实开发机的开销与长时间断网恢复仍需试点实测。
- 旧版客户端的 Codex 和 Claude Code 适配使用合成会话做了端到端验证。上报包提供 Codex 和 Claude Code 日志适配。Claude Code 直报尚未在真实设备上验证。Codex 子 Agent 采集范围见本机试点章节。GitHub 同步首轮读取每个仓库最新的 100 条 PR，之后按更新增量同步。
- PostgreSQL 模式的根地址使用正式工作台样式展示真实数据，包含项目目标、里程碑、人员、模型、会话摘要和按项目分组的 PR。尚无项目报告时仍显示里程碑空状态。未配置数据库时，根地址仍展示演示原型。旧版简化看板保留在 `/assets/live.html`，便于排查接口数据。

[技术方案和协议](技术方案.md) · [数据库迁移](db/001_init.sql)

## 本机试点

安装依赖后执行 `./ops/local.sh serve`，访问 http://127.0.0.1:4185。通过这个脚本启动的看板在本机直接打开即可。PostgreSQL 数据保存在 Docker 命名卷中，数据库端口仅绑定回环地址。

- `./ops/local.sh admin enroll-github USERNAME [developer_uuid]` 按 GitHub 账号发放设备令牌。此操作由管理员执行，成员无需在看板或客户端登录 GitHub。
- `./ops/local.sh sync` 执行一次 PR 同步。部署时可将 `ops/local-sync.sh` 每 30 分钟加入本机调度，并收集 stderr。私有仓库同步需要在任务环境加载 GitHub 读取凭证。
- `./ops/local.sh backup` 生成 PostgreSQL 自定义格式备份。恢复演练时先创建空库，再用 `pg_restore --exit-on-error --dbname <空库连接串> <备份文件>` 恢复，核对设备、会话和 PR 记录。
- Codex 子 Agent 在日志提供父线程 ID 且本机能解析父链时归到根会话。子线程累计 Token 暂不进入汇总，因为日志可能包含继承的历史计数。Claude Code 子 Agent 暂未接入。
