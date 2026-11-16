# Project Pulse macOS / Windows 快速上报包

这是客户端上报包。解压后不要移动包内文件，在 Codex 打开解压后的 `project-pulse-report` 目录，把 `PROMPT.txt` 全文发给 Codex。不要直接在 ZIP 预览里执行。

## 不可更改的部署信息

- 服务端固定为 `http://192.168.16.70:4185`。解压本包的电脑是客户端；不得用客户端自己的 IP 替换服务端地址，不得在客户端启动 Project Pulse 服务端。
- 快速流程使用局域网设备指纹，不需要 `~/.project-pulse/config.json`，也不需要设备令牌。
- macOS 使用系统 Perl 和 curl，Windows 使用系统 Windows PowerShell 和 curl.exe。其他机器必须能访问上述地址。
- 客户端只上报会话、Token、摘要和里程碑。GitHub PR 同步由服务端的定时任务负责，客户端不执行 GitHub 同步。

## 试报流程

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

4. 提交并核对回执。输出实际提交批数、读取字节、跳过原因和是否有积压。脚本只在服务端返回 `committed` 且批次、游标一致时认定提交成功。提交成功后清理本轮临时目录；失败或回执不明时，先用同一目录重跑 Submit，避免重新生成请求。只有在确认下一轮能从服务端游标继续时才清理失败的临时目录。

```powershell
powershell.exe -NoProfile -File .\pulse-report.ps1 -Action Submit -WorkDir <临时路径>
```

macOS 对应命令：

```sh
/usr/bin/perl ./pulse-report.pl --action Submit --work-dir "<临时路径>"
```

脚本单轮检查最多 8 个候选文件，文件头和增量合计最多 1 MiB，并在约 12 秒的扫描预算到达后暂停。单个 HTTP 请求最多等待 4 秒。候选按近 7 天修改时间选取，用量按事件时间筛选。旧事件只用来建立基线。只处理完整 JSONL 行，预算内装不下一行时会留下跳过原因。`backlog: true` 只表示后续轮次仍有候选数据，不代表本轮提交失败。如果长行持续阻塞，按包内 `lan-report.md` 手动协议处理。

## 创建并核对定时任务

- `PROMPT.txt` 已明确授权试报成功后设置定时任务。必须使用 Codex 桌面端定时任务功能，不安装常驻采集程序。
- 先查找本机同目录、同上报用途的已有任务，更新并启用；没有才创建。任务名为「Project Pulse 每30分钟上报」，每 30 分钟执行一次，工作目录必须是解压后的永久目录，不得使用临时目录或 ZIP 路径。
- 定时任务正文：`PROJECT_PULSE_AUTOMATION。当前电脑是客户端，服务端固定为 http://192.168.16.70:4185；不得改用本机 IP，不得启动服务端。读取当前目录 README.md，执行一次快速增量上报，仅采集用户已授权的 Codex 会话。复用已有摘要，仅在有实质进展或缺少项目报告时总结。`
- 创建或更新后必须重新查询任务，确认名称、已启用、30 分钟间隔和工作目录。未实际查到任务时不得声称「已设置」。当前工具无定时任务能力时，必须明确回报「未设置」及原因。
