# Project Pulse Windows 快速上报

把本目录整个解压到那台电脑，在 Codex 打开并发送：

> PROJECT_PULSE_AUTOMATION。执行 README.md 的快速上报流程，只上报我授权的 Codex 会话；允许生成脱敏成果摘要和项目里程碑。

本包使用 Windows 自带的 PowerShell 和 curl.exe。局域网地址默认为 172.16.30.104:4185，免手填令牌。其他机器应在同一可信局域网。macOS/Linux、Claude Code 日志以及历史里程碑补报可用包内的 lan-report.md。Windows 快速路径当前采集 Codex 主会话。

1. 新建一个随机命名的临时工作目录路径，实际目录由脚本创建。使用同一路径执行以下两个命令。首次可用 `-Label` 传入用户确认的姓名或账号名。已知本上报 chat UUID 时传 `-ExcludeSessionId`。脚本设备哈希使用 MachineGuid、换行、用户 SID；从旧说明切换时先确认既有设备标识一致，以免重复统计。无法确认时先用手动流程续报。
2. 执行准备命令。只有授权生成工作摘要时才加 `-IncludeEvidence`。如无批次，直接结束。没有实质进展时沿用现有摘要，直接提交。

```powershell
powershell.exe -NoProfile -File .\pulse-report.ps1 -Action Prepare -WorkDir <临时路径> -IncludeEvidence
```

3. 根据 Prepare 返回的 `evidence`，仅为有新成果、验证结果或阻塞的会话写 `summary`。项目报告缺失或有新进展时写 `goal` 和 `milestones`。结合已有项目报告，证据不足时写具体待验证项。内容仅限有依据的短句，禁止复制原日志、代码、完整路径、凭证或链接。同项目每轮至多提交一份。在临时目录以 UTF-8 保存数组 `summaries.json`，例如：

```json
[{"source_id":"替换成 Prepare 返回的 UUID","summary":"完成了消息回执测试","goal":"稳定展示消息回执","milestones":[{"title":"核对回执状态","state":"completed","evidence":"已通过回执测试"},{"title":"覆盖弱网恢复","state":"pending","evidence":"缺少断网重连测试"}]}]
```

4. 提交并核对回执。输出实际提交批数、读取字节、跳过原因和是否有积压。提交成功后清理本轮临时目录；失败或回执不明时，先用同一目录重跑 Submit，避免重新生成请求。只有在确认下一轮能从服务端游标继续时才清理失败的临时目录。

```powershell
powershell.exe -NoProfile -File .\pulse-report.ps1 -Action Submit -WorkDir <临时路径>
```

脚本单轮检查最多 8 个候选文件，文件头和增量合计最多 1 MiB，并在约 12 秒的扫描预算到达后暂停。单个 HTTP 请求最多等待 4 秒。候选按近 7 天修改时间选取，用量按事件时间筛选。旧事件只用来建立基线。只处理完整 JSONL 行，预算内装不下一行时会留下跳过原因。如果长行持续阻塞，按手动协议处理。已经上报的项目缺里程碑但没有增量时，按 lan-report.md 的补报流程。

试报成功后可在 Codex 桌面端把同一句安排为每 30 分钟执行，工作目录选择解压目录。
