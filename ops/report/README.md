# Project Pulse macOS / Windows 快速上报包

版本以 `VERSION` 为准（当前 3.0.0），需要服务端协议 3。先阅读 `UPGRADE.md`，升级时保留本目录的隐藏状态文件和待续传目录。包内 `SHA256SUMS` 可用于核对文件完整性。

这是客户端上报包。解压后不要移动包内文件，在 Codex 打开解压后的 `project-pulse-report` 目录，把 `PROMPT.txt` 全文发给 Codex。不要直接在 ZIP 预览里执行。

## 不可更改的部署信息

- 服务端固定为 `http://192.168.16.70:4185`。解压本包的电脑是客户端；不得用客户端自己的 IP 替换服务端地址，不得在客户端启动 Project Pulse 服务端。
- 快速流程使用局域网设备指纹，不需要 `~/.project-pulse/config.json`，也不需要设备令牌。
- macOS 使用系统 Perl 和 curl，Windows 使用系统 Windows PowerShell 和 curl.exe。其他机器必须能访问上述地址。
- 客户端只上报会话、Token、摘要和里程碑。GitHub PR 同步由服务端的定时任务负责，客户端不执行 GitHub 同步。

## 试报流程

1. 在本包永久目录下的 `.pulse-pending/` 中选一个尚不存在的随机子目录路径，脚本会创建它。Prepare 与 Submit 使用同一路径，失败后保留该目录；下轮 Prepare 会先重试上轮请求。不要把待发请求放在会被系统清理的临时目录。首次先查询团队目录；仅用用户确认的 GitHub 账号传入 `-GitHubLogin`（macOS 为 `--github-login`），唯一命中服务端已登记账号时归到该成员；无法匹配时用 `-Label`／`--label` 设置用户确认的名字。无人值守时沿用本地已保存的身份。此局域网模式的账号声明不等同于 GitHub 登录认证，不能按共享仓库或提交作者推断是谁。已知本上报 chat UUID 时必须传 `-ExcludeSessionId`／`--exclude-session-id`。Windows 设备哈希使用 MachineGuid、换行、用户 SID，macOS 使用 IOPlatformUUID、换行、用户 UID；切换前核对既有设备标识，避免重复。
2. 执行准备命令。只有授权生成工作摘要时才加 `-IncludeEvidence`。必须上传新增 Token 消耗，包括模型、事件时间、所属会话、输入 `input_tokens`、缓存输入 `cached_input_tokens`、输出 `output_tokens`。这些由固定脚本从授权日志解析并按服务端游标生成差分；缓存输入是输入的子集，不可重复加到总 Token。检查 `plan.json` 的 `batches[].usage` 条数和三个字段的合计。没有新摘要或里程碑时仍提交用量；无批次时继续核验并设置已授权的定时任务。

```powershell
powershell.exe -NoProfile -File .\pulse-report.ps1 -Action Prepare -WorkDir <尚不存在的待续传子目录> -IncludeEvidence -ResolveGit
```

macOS 对应命令：

```sh
/usr/bin/perl ./pulse-report.pl --action Prepare --work-dir "<尚不存在的待续传子目录>" --include-evidence --resolve-git
```

3. 根据 Prepare 返回的 `evidence`，仅为有新成果、验证结果或阻塞的会话写 `summary`。项目报告缺失或有新进展时写 `goal` 和 `milestones`。结合已有项目报告，证据不足时写具体待验证项。内容仅限有依据的短句，禁止复制原日志、代码、完整路径、凭证或链接。同项目每轮至多提交一份。在临时目录以 UTF-8 保存数组 `summaries.json`，例如：

```json
[{"source_id":"替换成 Prepare 返回的 UUID","summary":"完成了消息回执测试","goal":"稳定展示消息回执","milestones":[{"title":"核对回执状态","state":"completed","evidence":"已通过回执测试"},{"title":"覆盖弱网恢复","state":"pending","evidence":"缺少断网重连测试"}]}]
```

4. 提交并核对回执。输出实际提交批数、读取字节、诊断、积压和三类 Token 增量。脚本要求 `committed`、批次、游标及回执 `usage` 的事件数和三类 Token 全部一致才设置 `usage_verified: true`；重试同一正文不会重复计量。若只有游标已推进但未拿到用量回执，不能报告精确用量已核验，应继续用原目录 Submit 获取原请求的回执。Dashboard 的7天窗口可能看不到较旧积压，用量以事务提交回执为准；Dashboard 可作辅助展示核验。无批次时检查 `diagnostics`：至少有成功的游标查询且没有未解决的解析错误，才能报告“已检查的来源无新增”；还有积压时不能声称全量同步完毕。缺少日志、无授权来源或全部被排除时如实报告，不能当作完整试报通过。只有用量核验成功后才清理本轮待续传子目录，保留包目录中的隐藏状态文件。

```powershell
powershell.exe -NoProfile -File .\pulse-report.ps1 -Action Submit -WorkDir <临时路径>
```

macOS 对应命令：

```sh
/usr/bin/perl ./pulse-report.pl --action Submit --work-dir "<临时路径>"
```

脚本单轮检查最多8个候选文件、最多读取1 MiB，并在约12秒扫描预算到达后暂停；请求最多等待4秒。首次采集起点为首次运行前7天，并持久化在本包状态及服务端游标上下文，之后不随日期滚动；已知来源即使修改时间过旧也继续追赶积压。轮转位置持久化，多次运行会继续轮转。无变化文件也计入检查预算，所以 `backlog` 是待检查／待读取提示，不是精确剩余字节数。

首次快照：会话开始于采集范围内时可计入该主会话累计量；跨窗口老会话的首次快照只用可信的 `last_token_usage`，不将窗口前累计量计入。正常快照取累计差分，重复快照计零；累计值回退时只用明确的 `last_token_usage`，缺失则记录 `unmeasured_snapshots`。该诊断表示存在无法确定的用量，不能声称计量完整。文件头分段读取到完整首行，受整轮1 MiB限制；不完整行不推进游标。超过预算的长行、截断或损坏文件报告诊断，不能静默跳过。

`-ResolveGit`／`--resolve-git` 只读授权会话工作目录的本地 Git remote，不遍历项目文件。以规范化的 GitHub `owner/repo` 关联项目；未登记仓库也保留规范项目键，之后管理员登记时可归入同一项目。无法确认远端时保留本地工作区，不按相似名字合并。

## 创建并核对定时任务

- `PROMPT.txt` 明确要求并授权“立即上报”和“设置每30分钟定时任务”两个必做交付。试报成功后必须继续调用 Codex 桌面端定时任务工具（`automation_update`），不得再次询问是否设置，也不得在一次上传完成后结束。不能以有积压、无新增用量或沿用摘要为由跳过。定时运行本身只执行一轮上报，不重复创建任务。
- 先查找本机同目录、同上报用途的已有任务，更新并启用；没有才创建。任务名为「Project Pulse 每30分钟上报」，每 30 分钟执行一次，工作目录必须是解压后的永久目录，不得使用临时目录或 ZIP 路径。
- 定时任务正文：`PROJECT_PULSE_AUTOMATION。当前电脑是客户端，服务端固定为 http://192.168.16.70:4185；不得改用本机 IP，不得启动服务端。读取当前目录 README.md，执行一次快速增量上报，仅采集用户已授权的 Codex 会话。必须使用固定脚本上传模型及输入、缓存输入、输出 Token 增量，即使没有新摘要也要提交用量。核对 committed 回执和服务端会话用量；缺少用量时说明具体原因。复用已有摘要，仅在有实质进展或缺少项目报告时总结。`
- 创建或更新后必须重新查询任务，确认名称、已启用、30 分钟间隔和工作目录。未实际查到任务时不得声称「已设置」。当前工具无定时任务能力时，必须明确回报「未设置」及原因。
- 只有试报成功且重新查询确认定时任务已启用，才可报告整体完成。最终给出任务标识、实际计划规则及下次运行时间（工具未提供则如实说明）。试报失败或定时任务工具缺失／报错时报告“整体未完成”，列出失败步骤和具体错误。
