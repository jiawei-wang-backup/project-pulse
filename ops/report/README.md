# Project Pulse macOS / Windows 快速上报

把本目录整个解压到那台电脑，在 Codex 打开并发送：

> PROJECT_PULSE_AUTOMATION。读取当前目录的 README.md，立即按快速流程上报一次，只采集我授权的 Codex 会话，允许生成脱敏摘要和里程碑。试报成功后，请直接为这台电脑创建并启用「Project Pulse 每30分钟上报」本机任务，每 30 分钟在这个目录运行。已有相同用途的任务就更新并启用，避免重复创建。完成后分别告诉我试报结果和任务状态。

macOS 使用系统 Perl 和 curl，Windows 使用系统 PowerShell 和 curl.exe。局域网地址固定为 `http://192.168.16.70:4185`，免手填令牌。其他机器应在同一可信局域网。Linux、Claude Code 日志以及历史里程碑补报可用包内的 lan-report.md。两端快速路径当前采集 Codex 主会话。

1. 新建一个随机命名的临时工作目录路径，实际目录由脚本创建。使用同一路径执行以下两个命令。首次可用 `-Label` 传入用户确认的姓名或账号名。已知本上报 chat UUID 时传 `-ExcludeSessionId`。Windows 设备哈希使用 MachineGuid、换行、用户 SID，macOS 使用 IOPlatformUUID、换行、用户 UID；从旧说明切换时先确认既有设备标识一致，以免重复统计。无法确认时先用手动流程续报。
2. 执行准备命令。只有授权生成工作摘要时才加 `-IncludeEvidence`。如无批次，直接结束。没有实质进展时沿用现有摘要，直接提交。

```powershell
powershell.exe -NoProfile -File .\pulse-report.ps1 -Action Prepare -WorkDir <临时路径> -IncludeEvidence
```

macOS 对应命令：

```sh
/usr/bin/perl ./pulse-report.pl --action Prepare --work-dir "<临时路径>" --include-evidence
```

3. 根据 Prepare 返回的 `evidence`，仅为有新成果、验证结果或阻塞的会话写 `summary`。项目报告缺失或有新进展时写 `goal` 和 `milestones`。结合已有项目报告，证据不足时写具体待验证项。内容仅限有依据的短句，禁止复制原日志、代码、完整路径、凭证或链接。同项目每轮至多提交一份。在临时目录以 UTF-8 保存数组 `summaries.json`，例如：

```json
[{"source_id":"替换成 Prepare 返回的 UUID","summary":"完成了消息回执测试","goal":"稳定展示消息回执","milestones":[{"title":"核对回执状态","state":"completed","evidence":"已通过回执测试"},{"title":"覆盖弱网恢复","state":"pending","evidence":"缺少断网重连测试"}]}]
```

4. 提交并核对回执。输出实际提交批数、读取字节、跳过原因和是否有积压。提交成功后清理本轮临时目录；失败或回执不明时，先用同一目录重跑 Submit，避免重新生成请求。只有在确认下一轮能从服务端游标继续时才清理失败的临时目录。

```powershell
powershell.exe -NoProfile -File .\pulse-report.ps1 -Action Submit -WorkDir <临时路径>
```

macOS 对应命令：

```sh
/usr/bin/perl ./pulse-report.pl --action Submit --work-dir "<临时路径>"
```

脚本单轮检查最多 8 个候选文件，文件头和增量合计最多 1 MiB，并在约 12 秒的扫描预算到达后暂停。单个 HTTP 请求最多等待 4 秒。候选按近 7 天修改时间选取，用量按事件时间筛选。旧事件只用来建立基线。只处理完整 JSONL 行，预算内装不下一行时会留下跳过原因。如果长行持续阻塞，按手动协议处理。已经上报的项目缺里程碑但没有增量时，按 lan-report.md 的补报流程。

## 创建并核对定时任务

- 只有用户明确要求设置定时上报时才创建任务。试报成功指服务端确认提交，或服务端游标可读且本轮没有新增数据。试报失败时说明具体原因及任务是否已经存在。
- 按上面的用户请求使用 Codex 桌面端的定时任务功能。先查找本机同目录、同上报用途的已有任务，更新并启用该任务；没有才创建。每 30 分钟执行一次，工作目录选解压目录。
- 定时任务正文只写每轮执行内容：`PROJECT_PULSE_AUTOMATION。读取当前目录 README.md，执行一次快速增量上报，仅采集用户已授权的 Codex 会话。复用已有摘要，仅在有实质进展或缺少项目报告时总结。`
- 核对任务已经启用、间隔为 30 分钟，并回报任务名称和首次自动运行是否已验证。当前环境无法创建任务时，在回复里明确说明「未设置」及原因，给出桌面端 Scheduled 页的手动入口。
