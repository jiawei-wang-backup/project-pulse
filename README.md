# Project Pulse

团队开发活动看板。每位成员电脑上的 Codex 识别项目、会话、GitHub PR、模型和真实 Token 用量，整理脱敏摘要、项目目标与里程碑，每 30 分钟增量同步到服务端。

客户端先自行查找和核验，仍缺信息或证据冲突时才询问用户。固定脚本负责解析、差分、续传和提交，服务端校验、去重、存储与展示。

## 下载上报包

**[下载最新上报 ZIP：project-pulse-report-3.3.0.zip](https://github.com/jiawei-wang-dev/project-pulse/releases/download/report-client-v3.3.0-20261116/project-pulse-report-3.3.0.zip)**

当前版本：**3.3.0**。

本版先只读列出本机项目，等待用户多选；确认后仅上报所选项目，30分钟任务沿用选择，新项目先确认再加入。选择前不试报、不上传、不设置任务。

保留客户端团队数据修正接口：可修改全员的摘要、项目归属、目标、里程碑和状态，保留审计并检查版本冲突；需要真正服务端执行010迁移、启用 `PULSE_TEAM_EDITS=1` 后才可使用。普通增量上报仍兼容既有协议3。

继续保留宽松Agent识别：明确运行状态保留2小时窗口，缺少开始事件时可根据新消息、模型输出、工具调用和用量补足；明确结束的任务不会被尾部Token快照复活。项目是否在研仍独立判断，不按时间超时。

[发布记录](https://github.com/jiawei-wang-dev/project-pulse/releases) · [详细上报流程](ops/report/README.md) · [升级与验收说明](ops/report/UPGRADE.md)

同一个 ZIP 包含 macOS、Windows、Linux 脚本，完整提示词、协议、升级说明和逐文件 SHA-256 校验和。成员电脑只需要上报包，不需要克隆完整项目、安装数据库或启动服务端。当前局域网快速流程无需手填设备令牌或创建 `~/.project-pulse/config.json`。

## 拿到 ZIP 后怎么用

1. 解压到长期保留的目录，例如 `Documents/project-pulse-report`。不要在 ZIP 预览或临时目录里运行。
2. 用这台电脑上的 Codex 打开解压后的 `project-pulse-report` 文件夹。
3. 复制下面整段提示词发送给 Codex。它会先列出本机项目供你选择，等你确认后仅上报所选项目，再创建或更新每 30 分钟同步任务。

```text
PROJECT_PULSE_AUTOMATION。读取当前目录的 PROMPT.txt 和 README.md，先按project-selection.md只读列出本机项目让我选择，等我确认后再对所选项目执行完整上报与定时同步流程。

第一步只做只读盘点：列出项目编号、仓库或本地工作区、已识别主会话数量及待确认项，让我多选。选择前不得执行Prepare／Submit、上传或设置任务，不默认全选。确认后保存私有选择文件；每轮Prepare和Submit必须限制OnlySource为所选项目，后续30分钟任务沿用此范围，新项目先询问再加入。

我授权你识别本机 Codex 主会话及相关项目、成员、GitHub仓库和PR、模型与真实Token用量，并生成脱敏摘要、项目目标和里程碑。先主动查找并复用已有信息，仍缺信息或证据冲突时，再集中询问我。排除当前上报会话，不编造数据。

使用包内对应系统的固定脚本，向 http://192.168.16.70:4185 增量上报。PR也要按README查证并结构化提交，分别核对日志、Token和PR回执。

项目状态由会话证据判断，在研包含尚未完成的阻塞项目；不按时间超时，与Agent执行状态分开。状态变化或首次补齐时按README提交statuses.json并核对status_receipt，不把一轮任务结束当作整个项目完成。

需要修正团队记录时，先核对服务端team_metadata_edit能力，再按team-edits.md查询目标成员、设备、会话与最新version，带原因提交并核验。允许修正全员的摘要、项目归属、目标、里程碑和状态；证据不足先询问，不改原始Token或游标。正常上报不为使用此接口而改写其他成员数据。

试报成功后，必须使用定时任务工具，创建或更新并启用「Project Pulse 每30分钟上报」，每30分钟在当前永久解压目录执行完整识别与增量同步。已有同用途任务就更新，避免重复；设置后重新查询确认启用状态、间隔和目录。无需再次询问是否设置。

最后报告实际识别及提交结果、Token与PR核验结果、积压和缺失信息，以及任务标识、启用状态和计划规则。无法上报或无法设置任务时明确说明失败步骤和原因，不得宣称全部完成。
```

当前服务端是 `http://192.168.16.70:4185`，客户端必须能访问它。客户端自己的 IP 不是服务端地址，不要替换。私有仓库与 PR 使用本机已授权的 GitHub 只读工具；权限不足时由 Codex 说明缺少什么，不把凭证发进聊天。

## 同步哪些数据

| 数据 | 客户端 Codex 的工作 |
| --- | --- |
| 成员与设备 | 核对团队目录和已确认身份；换 Codex 账号不自动变更团队成员 |
| 项目与目录 | 核对 Git remote，结合会话、README 和近期提交识别同名目录及迁移关系 |
| 会话与摘要 | 使用原生会话 ID，排除当前上报会话，复用历史摘要，只总结新增成果 |
| 模型与 Token | 从日志解析模型、输入、缓存输入、输出 Token，按游标计算差分，不估算或重复累计 |
| GitHub PR | 查证仓库数字 ID、PR 编号、状态和时间，结构化提交并核对独立回执 |
| 目标与里程碑 | 依据证据总结目标、已完成及未完成交付项，不编造进度 |
| 项目状态 | 根据会话判断在研、阻塞、完成或明确暂停，独立上报状态与依据，不按时间超时 |
| 30 分钟任务 | 试报成功后必须设置，再查询确认启用状态、间隔和工作目录 |

日志提交核对 `committed`、`usage_verified`，PR 提交核对 `pr_receipt`。无新增、缺少记录、权限不足、解析失败和仍有积压必须分别说明；面板没有 PR 不等于 GitHub 没有 PR。只有查到任务存在才能说“已设置”，实际自动触发成功后才能说“自动运行已验证”。

## 支持的系统

| 系统 | 入口 | 系统依赖 |
| --- | --- | --- |
| macOS | `pulse-report.pl` | Perl、curl |
| Windows | `pulse-report.ps1` | Windows PowerShell、curl.exe |
| Linux | `pulse-report-linux.sh` | Perl（含 JSON::PP、Digest::SHA）、curl |

执行工具需要能读取本地文件、运行命令并连接服务端。定时功能由实际执行工具提供；没有该能力时必须明确报告“未设置”，不能把脚本能运行当作定时任务已启用。

## 更新已有客户端

下载新 ZIP，覆盖原永久解压目录，保留 `.pulse-state-*.json`、`.pulse-project-paths.json`、`.pulse-project-selection.json`、`.pulse-pending/`，再发送上面的提示词。更新原任务的正文并重新核验，不重复创建。待发请求先恢复，不清空游标或重新导入历史 Token。

当前包3.3.0使用协议3。真正服务端需先执行009_project_lifecycle迁移并重启，提供 `usage_receipt`、`project_mapping_backfill`、`client_pr_ingest`、`client_project_status` 能力。Agent识别窗口现为2小时，并补足缺少开始事件的活动识别；已完成、取消或失败的任务不因此复活。更新ZIP不会自动更新另一台电脑的服务端或已存在的定时任务。

## 服务端与开发

以下只在真正服务端或开发环境执行，成员上报电脑无需执行。

- Node.js 24+，运行 `npm ci` 和 `npm start`；未配置数据库时默认在 `http://127.0.0.1:4174` 展示演示数据。
- 真实数据使用 PostgreSQL；迁移、局域网部署、备份及独立令牌模式见 [服务端部署说明](docs/deployment.md)。
- 客户端可通过 [团队数据修正接口](docs/team-edits.md) 修改全员的摘要、项目归属、目标、里程碑和状态；真正服务端需应用010迁移并启用 `PULSE_TEAM_EDITS=1`。
- `npm test` 运行测试；在可丢弃的已迁移数据库设置 `DATABASE_URL` 后运行 `npm run test:integration`。便携采集器 CI 覆盖 macOS、Windows 和 Ubuntu。
- 构建上报包：`sh ops/report/build-package.sh /绝对路径/project-pulse-report-3.3.0.zip`。包内不包含本机状态、路径映射、日志或凭证。

[技术方案](技术方案.md) · [上报详细流程](ops/report/README.md) · [手动协议及其他来源适配](docs/lan-report.md)
