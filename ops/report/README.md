# Project Pulse macOS / Windows / Linux 快速上报包

版本以 `VERSION` 为准（当前 3.1.1），需要服务端协议3、client_project_status能力，以及已应用009_project_lifecycle迁移。先阅读 `UPGRADE.md`，升级时保留隐藏状态和待续传目录。包内SHA256SUMS可核对完整性。

这是客户端上报包。解压后不要移动包内文件，在 Codex 打开解压后的 `project-pulse-report` 目录，把 `PROMPT.txt` 全文发给 Codex。不要直接在 ZIP 预览里执行。

## 下载与首次发送提示词

[下载当前3.1.1上报ZIP](https://github.com/jiawei-wang-dev/project-pulse/releases/download/report-client-v3.1.1-20261116/project-pulse-report-3.1.1.zip) · [始终下载最新版本](https://github.com/jiawei-wang-dev/project-pulse/releases/latest/download/project-pulse-report-latest.zip) · [查看发布记录](https://github.com/jiawei-wang-dev/project-pulse/releases)

解压到永久目录，用Codex打开本文件夹，复制下面整段发送；也可直接发送PROMPT.txt全文。不要仅打开ZIP预览。

```text
PROJECT_PULSE_AUTOMATION。读取当前目录的 PROMPT.txt 和 README.md，执行完整上报与定时同步流程。

我授权你识别本机 Codex 主会话及相关项目、成员、GitHub仓库和PR、模型与真实Token用量，并生成脱敏摘要、项目目标和里程碑。先主动查找并复用已有信息，仍缺信息或证据冲突时，再集中询问我。排除当前上报会话，不编造数据。

使用包内对应系统的固定脚本，向 http://192.168.16.70:4185 增量上报。PR也要按README查证并结构化提交，分别核对日志、Token和PR回执。

项目状态由会话证据判断，在研包含尚未完成的阻塞项目；不按时间超时，与Agent执行状态分开。状态变化或首次补齐时按README提交statuses.json并核对status_receipt，不把一轮任务结束当作整个项目完成。

试报成功后，必须使用定时任务工具，创建或更新并启用「Project Pulse 每30分钟上报」，每30分钟在当前永久解压目录执行完整识别与增量同步。已有同用途任务就更新，避免重复；设置后重新查询确认启用状态、间隔和目录。无需再次询问是否设置。

最后报告实际识别及提交结果、Token与PR核验结果、积压和缺失信息，以及任务标识、启用状态和计划规则。无法上报或无法设置任务时明确说明失败步骤和原因，不得宣称全部完成。
```

## 不可更改的部署信息

- 服务端固定为 `http://192.168.16.70:4185`。解压本包的电脑是客户端；不得用客户端自己的 IP 替换服务端地址，不得在客户端启动 Project Pulse 服务端。
- 快速流程使用局域网设备指纹，不需要 `~/.project-pulse/config.json`，也不需要设备令牌。
- macOS／Linux 使用系统 Perl（含 JSON::PP、Digest::SHA）和 curl，Windows 使用系统 Windows PowerShell 和 curl.exe。其他机器必须能访问上述地址。Linux入口检查依赖，缺少时明确报告，不自动安装。
- 项目、会话、PR、模型、Token、摘要、目标、里程碑等均由客户端Codex主动识别和核验，脚本负责解析差分与提交，服务端校验、存储、展示。客户端通过 `pulls.json` 上报查证后的PR，不能依赖服务端抓取代替识别。服务端原PR同步脚本保留为管理员可选补充。

## 试报流程

先自行收集授权信息并复用已知结果；只在查找后仍缺信息或冲突时集中询问用户。不得以需要用户逐项手填为默认路径。

1. 在本包永久目录下的 `.pulse-pending/` 中选一个尚不存在的随机子目录路径，脚本会创建它。Prepare 与 Submit 使用同一路径，失败后保留该目录；下轮 Prepare 会先重试上轮请求。不要把待发请求放在会被系统清理的临时目录。首次先查询团队目录；仅用用户确认的 GitHub 账号传入 `-GitHubLogin`（macOS 为 `--github-login`），唯一命中服务端已登记账号时归到该成员；无法匹配时用 `-Label`／`--label` 设置用户确认的名字。无人值守时沿用本地已保存的身份。此局域网模式的账号声明不等同于 GitHub 登录认证，不能按共享仓库或提交作者推断是谁。已知本上报 chat UUID 时必须传 `-ExcludeSessionId`／`--exclude-session-id`。Windows 设备哈希使用 MachineGuid、换行、用户 SID，macOS 使用 IOPlatformUUID、换行、用户 UID；切换前核对既有设备标识，避免重复。
2. 执行准备命令。只有授权生成工作摘要时才加 `-IncludeEvidence`。必须上传新增 Token 消耗，包括模型、事件时间、所属会话、输入 `input_tokens`、缓存输入 `cached_input_tokens`、输出 `output_tokens`。这些由固定脚本从授权日志解析并按服务端游标生成差分；缓存输入是输入的子集，不可重复加到总 Token。检查 `plan.json` 的 `batches[].usage` 条数和三个字段的合计。没有新摘要或里程碑时仍提交用量；无批次时继续核验并设置已授权的定时任务。

```powershell
powershell.exe -NoProfile -File .\pulse-report.ps1 -Action Prepare -WorkDir <尚不存在的待续传子目录> -IncludeEvidence -ResolveGit
```

macOS 对应命令：

```sh
/usr/bin/perl ./pulse-report.pl --action Prepare --work-dir "<尚不存在的待续传子目录>" --include-evidence --resolve-git
```

Linux对应命令（其余参数与macOS相同）：

```sh
sh ./pulse-report-linux.sh --action Prepare --work-dir "<尚不存在的待续传子目录>" --include-evidence --resolve-git
```

Linux设备标识为 `/etc/machine-id`（或DBus machine-id）与UID的哈希，和Codex登录账号、IP无关。缺少有效machine-id时，在 `${XDG_STATE_HOME:-$HOME/.local/state}/project-pulse/device-id` 首次生成并保存随机标识；以后复用，不要把该文件分发给其他电脑。克隆系统须使用各自独立的machine-id。原始机器标识不会上传。

3. 根据 Prepare 返回的 `evidence`，仅为有新成果、验证结果或阻塞的会话写 `summary`。项目报告缺失或有新进展时写 `goal` 和 `milestones`。结合已有项目报告，证据不足时写具体待验证项。内容仅限有依据的短句，禁止复制原日志、代码、完整路径、凭证或链接。同项目每轮至多提交一份。在临时目录以 UTF-8 保存数组 `summaries.json`，例如：

```json
[{"source_id":"替换成 Prepare 返回的 UUID","summary":"完成了消息回执测试","goal":"稳定展示消息回执","milestones":[{"title":"核对回执状态","state":"completed","evidence":"已通过回执测试"},{"title":"覆盖弱网恢复","state":"pending","evidence":"缺少断网重连测试"}]}]
```

同时按下节PR字段规范把本轮查证的记录写到同一待续传目录 `pulls.json`。即使Prepare为零日志批次，只要来源会话已在服务端存在，Submit仍可单独提交PR；新会话须先成功上报，不能把PR挂到无关会话。没有可查证PR时省略文件并说明原因，不填伪造占位记录。

4. 提交并核对回执。输出实际提交批数、读取字节、诊断、积压和三类 Token 增量。脚本要求 `committed`、批次、游标及回执 `usage` 的事件数和三类 Token 全部一致才设置 `usage_verified: true`；重试同一正文不会重复计量。若只有游标已推进但未拿到用量回执，不能报告精确用量已核验，应继续用原目录 Submit 获取原请求的回执。Dashboard 的7天窗口可能看不到较旧积压，用量以事务提交回执为准；Dashboard 可作辅助展示核验。无批次时检查 `diagnostics`：至少有成功的游标查询且没有未解决的解析错误，才能报告“已检查的来源无新增”；还有积压时不能声称全量同步完毕。缺少日志、无授权来源或全部被排除时如实报告，不能当作完整试报通过。只有用量核验成功后才清理本轮待续传子目录，保留包目录中的隐藏状态文件。

```powershell
powershell.exe -NoProfile -File .\pulse-report.ps1 -Action Submit -WorkDir <同一个待续传子目录>
```

macOS 对应命令：

```sh
/usr/bin/perl ./pulse-report.pl --action Submit --work-dir "<同一个待续传子目录>"
```

Linux提交命令：

```sh
sh ./pulse-report-linux.sh --action Submit --work-dir "<同一个待续传子目录>"
```

脚本单轮检查最多8个候选文件、最多读取1 MiB，并在约12秒扫描预算到达后暂停；请求最多等待4秒。首次采集起点为首次运行前7天，并持久化在本包状态及服务端游标上下文，之后不随日期滚动；已知来源即使修改时间过旧也继续追赶积压。轮转位置持久化，多次运行会继续轮转。无变化文件也计入检查预算，所以 `backlog` 是待检查／待读取提示，不是精确剩余字节数。

首次快照：会话开始于采集范围内时可计入该主会话累计量；跨窗口老会话的首次快照只用可信的 `last_token_usage`，不将窗口前累计量计入。正常快照取累计差分，重复快照计零；累计值回退时只用明确的 `last_token_usage`，缺失则记录 `unmeasured_snapshots`。该诊断表示存在无法确定的用量，不能声称计量完整。文件头分段读取到完整首行，受整轮1 MiB限制；不完整行不推进游标。超过预算的长行、截断或损坏文件报告诊断，不能静默跳过。

`-ResolveGit`／`--resolve-git` 只读工作目录或已识别迁移目录的本地 Git remote；客户端Codex负责以下迁移分析。以规范化的 GitHub `owner/repo` 关联项目；未登记仓库也保留规范项目键，之后管理员登记时可归入同一项目。

## Codex更新、换号与会话目录迁移

每轮Prepare检查当前 `CODEX_HOME`、当前用户默认 `.codex`、`.codex-*`／`.codex_*`、`.config/codex`，以及系统Codex候选目录（macOS Application Support、Windows APPDATA／LOCALAPPDATA），并复用状态文件里已经发现的sessions根目录。候选位置不保证每个Codex版本都会使用；只在Codex候选容器内检查最多64个目录、最多4层，跳过目录链接，不全盘搜索。根目录内部仍按当前已验证的日期层级JSONL格式解析；未来格式改变需要明确诊断后适配，不能猜字段。

用户确认的新位置可通过macOS `--session-root "/绝对路径/sessions"`（可重复）或Windows `-SessionRoot 'C:\实际路径\sessions'`传入Prepare，之后自动记住。路径只留在本地隐藏状态，不上传到服务端；更新包时保留状态。换Codex账号不会改变设备指纹或团队成员身份，成员变更必须另行确认。

跨目录复制／迁移时，优先读取同原生会话ID的较完整副本，按原ID和服务端字节游标续传，不按文件路径新建会话。相同ID但首行元数据变化会返回 `source_header_changed_requires_confirmation`，需要确认后诊断，禁止清空游标或直接重复导入。`session_roots_found: 0`、无日志、`discovery_incomplete: true`或文件格式未识别都不等于没有Token用量：上报可确认部分后，必须反问用户是否更新／换号以及当前会话目录。

## 项目工作目录迁移

日志的sessions目录与项目cwd是两个不同位置。客户端Codex先自行总结判断同名目录是否为迁移后的同一项目，不把路径判断工作直接推给用户。先复用已核实缓存；旧路径不存在时，从当前工作区、已知项目根及当前用户常用项目目录（Desktop／Documents）中有界寻找同名目录或同名仓库子目录，最多3层、32个候选，跳过链接及依赖目录。读取限于候选README、Git remote、最近5条提交及已授权的脱敏会话摘要，每个候选最多3个文件／200行，不扫描整盘或其他用户目录。

结合项目目标、技术栈、特征功能、仓库地址与近期工作判断归属。同名可作为候选线索；内容一致且候选唯一、remote无冲突时，客户端Codex直接保存旧／新绝对路径到私有 `.pulse-project-paths.json`，无需再询问用户。可参考 `project-paths.example.json`，在条目增加 `reason` 记录简短识别依据（脚本只使用old_path／new_path）。多候选、remote冲突或证据不足时才向用户集中追问，并继续上传其余可确认数据。

脚本读取该映射并使用 `ResolveGit` 查询新目录真实remote。保存映射后先完成或恢复已准备的不可变批次，再新建待续传目录重新Prepare，以便生成归属补报；不修改已发送正文，不重置游标。Windows JSON反斜线需转义，也可使用正斜线。macOS/Linux可用 `--project-map <映射JSON路径>`，Windows用 `-ProjectMap <映射JSON路径>`。没有可核实Git remote的目录先保留本地工作区，并说明仓库尚未识别。

经核实的仓库关系会保存在本机状态中；以后目录暂时不可访问仍能沿用。原日志、当前remote和缓存存在冲突时，`diagnostics.project_unresolved` 返回原因，保留原日志能确认的归属并向用户追问，不静默覆盖。真实remote仍无法识别时继续上报已确认用量，列出待确认项目。

对于已经上报且没有新日志的会话，脚本使用服务端目录能力 `project_mapping_backfill` 生成只含 `mappings` 的补报。服务端按本设备、本会话更新项目关联，并将该会话已有里程碑报告的项目键归到规范仓库；Token记录、会话字节游标和历史日志均不改变。已正确归属的会话不会反复产生补报。此能力需要真正服务端拉取本次更新并重启，无需数据库迁移。旧服务端会明确诊断需要升级。

本机映射与状态可能包含本地绝对路径，只在本机使用，不加入分发ZIP或Git提交。升级时保留它们；跨电脑只分发空白示例。

## PR与字段完整性核对细则

每轮上报后必须按本轮涉及项目核对以下清单（即使上传成功也不能省略）：

1. 仓库：从授权Git remote取得规范 `owner/repo`，与服务端目录的repositories及Dashboard项目键对照。未登记仓库标为“未登记”；目录迁移先由客户端Codex按上述流程总结识别，仅在仍不确定时标为“映射未识别”并追问。
2. PR：客户端Codex先通过已授权GitHub工具查证，再请求Dashboard按 `pulls[].full_name` 比对，发现缺失或更新就按下节准备pulls.json并提交。面板没有记录不能证明GitHub没有PR。覆盖open／closed／merged／draft；查询、提交或核验失败时区分具体状态，先完成其他可确认数据，再反问最少缺失信息；不能等待服务端抓取来代替本轮客户端识别。
3. 完整性：逐项检查成员、项目映射、PR、模型、输入／缓存输入／输出Token、摘要、目标、已完成／未完成里程碑。状态明确区分“已识别”“确认没有”“不适用”“本轮无新增”“未识别”“未核验／未检查”“权限不足”和“已识别但未同步”。未知不能填0或编造完成项。
4. 最终回复：先回报实际提交和定时任务结果，再列出未识别项（项目、字段、原因、已做检查），最后必须用一个集中问题向用户索取最少缺失信息：仓库URL、PR链接／编号、GitHub账号／姓名，或项目目标／验收依据。无法确认目标时询问目标，无法确认里程碑时询问交付项；不能只列问题而不反问。用户已提供的信息先复用。无人值守时把问题写进本次任务结果，下次沿用已确认信息，不等待回答来阻止其他数据上传。

例如：“项目X的Token已提交，但PR未核验：服务端无记录且本机无GitHub读取权限。请提供项目X的仓库地址或PR链接／编号，方便进一步查证归属；PR尚不能标记为已同步。”

## 客户端PR提交字段与核验

本节取代旧包中“PR只能由服务端抓取”的约定。客户端Codex使用已授权的GitHub工具或已登录的 `gh`，查询明确仓库的数字ID与PR。可用 `gh api repos/owner/repo` 取得仓库 `id`／`full_name`，用 `gh pr list --repo owner/repo --state all --limit 30 --json number,title,url,state,isDraft,createdAt,updatedAt` 查询最近PR；每轮最多检查8个本轮涉及或已识别项目、每仓库最多30条，每次只提交最多50条，超过则明确说明未覆盖部分并分批续报。仅完整且成功的查询结果为空，才可在该查询范围内报告没有PR。未知权限或空面板不能代替GitHub查询。不要自动安装工具、登录其他账号或要求用户粘贴凭证。

`pulls.json` 为UTF-8数组，每项恰好包含以下字段（示例值必须替换为真实查证结果）：

```json
[{"source_session_id":"00000000-0000-0000-0000-000000000000","repository":"owner/repo","github_id":123456,"number":7,"title":"PR title","url":"https://github.com/owner/repo/pull/7","state":"open","is_draft":false,"created_at":"2026-11-16T00:00:00Z","updated_at":"2026-11-16T01:00:00Z"}]
```

`source_session_id` 是本设备已上报且确定属于此项目的原生会话UUID，不是当前上报任务会话；`github_id` 是仓库数字ID，不是PR ID；仓库名称与URL使用GitHub返回的完整名称。`state` 为open／closed／merged小写，draft用独立布尔字段，时间为UTC。不能只查询open PR，不能把merged当作closed，不能用猜测填数字ID。记录不含PR正文、代码或凭证。

Submit先提交日志与用量，再将PR请求保存为不可变 `pr-request.json` 并发送 `POST /api/v1/report-pulls`；成功回执为 `pr_receipt: {batch_id,status:"committed",pulls:条数}`。脚本核对批次与条数。失败保留本目录，下轮Prepare优先重试，不能更改已发送正文。PR重复提交幂等，较旧updated_at不会覆盖新状态。服务端可据查证的仓库数字ID登记仓库，并只关联本设备对应会话；仓库身份冲突明确返回错误，不静默覆盖。PR不改变Token计量与读取游标。

真正服务端需提供 `client_pr_ingest` 能力（更新代码并重启，无新迁移）；缺失时明确报告PR尚未同步，不能降级为“摘要里写了链接就算已上传”。回报日志回执与PR回执两项，再辅助检查Dashboard.pulls。只有PR已识别但未提交时不得声称全部同步完成。

## 客户端项目状态判断

Agent识别与项目状态独立：新的用户消息、模型输出／推理、工具调用或未知状态下的新增Token可补足缺失的开始事件。明确运行状态的活动窗口由60分钟放宽为120分钟；legacy unknown状态需近30分钟真实用量证据。明确完成、取消、失败不靠时间猜测复活，尾部Token快照不把终止任务改回running。统计表示最近上报证据下的运行估计，不是实时进程探测；项目生命周期不受这个时间窗口影响。

仅上报指定会话时可用macOS/Linux `--only-source <原生UUID>`（可重复）或Windows `-OnlySource <UUID>`；默认仍采集授权范围内主会话。此选项只筛选增量源，不清空历史游标或忽略已准备的待发请求；先完成既有待发批次再开始新的单项目范围。

顶部“在研项目”统计on_track与blocked，与“运行中的Agent”独立。客户端Codex根据会话、目标、里程碑、上次状态以及明确的人类决定判断，不按最后活动时间推断。下班、开会、没有新日志或Token不构成阻塞、暂停或完成依据；Agent任务结束也不等于项目完成。

| state | reason_code | 判断依据 |
| --- | --- | --- |
| on_track | progress_observed | 已开始且仍有明确未完成目标，未明确暂停 |
| blocked | dependency_unavailable / repeated_failure | 尚有无法解决的依赖或反复失败，需干预；仍计入在研 |
| completed | goal_completed | 整体项目目标已实现并有验证依据，不是仅一轮任务结束 |
| paused | user_paused | 有明确的项目暂停决定 |
| unknown | insufficient_evidence | 首次证据不足；已有有效状态时优先沿用，不因无变化重置 |

状态变化或首次补齐时，在本轮同一待续传目录保存UTF-8的statuses.json。每项目每轮最多提交一份，用本设备已上报且属于该项目的主会话UUID。依据为脱敏短句，不复制日志原文：

```json
[{"source_session_id":"替换成真实会话UUID","state":"blocked","reason_code":"dependency_unavailable","observed_at":"替换成当前UTC判断时间","evidence":"外部接口缺少必要权限，已尝试现有授权方式仍无法继续"}]
```

observed_at为本次有证据的判断时间，状态无变化时不反复提交以覆盖其他成员的判断。查阅Prepare.evidence.previous_project_status及上版摘要／报告，必要时读对应来源游标。即使无新日志也可Submit独立状态；脚本先提交日志，再提交statuses，随后提交PR，分别核对回执。成功status_receipt包含batch_id、committed和statuses条数；失败保留原请求续传。服务端只接受本设备已有会话，较旧判断不覆盖新判断，不改变Token游标、Agent状态或其最后活动时间。

服务器须应用009迁移并提供client_project_status能力；旧服务端明确报升级要求。无状态不能猜在研：先询问项目目标或暂停／完成依据。

## 定时任务执行规则

- `PROMPT.txt` 明确要求并授权“立即上报”和“设置每30分钟定时任务”两个必做交付。试报成功后必须继续调用 Codex 桌面端定时任务工具（`automation_update`），不得再次询问是否设置，也不得在一次上传完成后结束。不能以有积压、无新增用量或沿用摘要为由跳过。定时运行本身只执行一轮上报，不重复创建任务。
- 先查找本机同目录、同上报用途的已有任务，更新并启用；没有才创建。任务名为「Project Pulse 每30分钟上报」，每 30 分钟执行一次，工作目录必须是解压后的永久目录，不得使用临时目录或 ZIP 路径。
- 定时任务正文（创建时将“本包永久目录”替换为实际绝对目录）：`PROJECT_PULSE_AUTOMATION。读取本包永久目录的VERSION和README.md，服务端为http://192.168.16.70:4185。由当前客户端Codex主动识别成员、项目、迁移目录、主会话、GitHub仓库与PR、模型、三类Token、摘要、目标及里程碑。先恢复待发请求，复用已有证据与映射；使用固定脚本解析Token差分并提交，不能估算或重复累计。用已授权GitHub工具检查open／closed／merged／draft，将查证结果按README写入pulls.json并用Submit提交，即使无新增日志也要检查PR。核对日志committed、usage_verified、PR的pr_receipt及diagnostics，报告实际提交、覆盖范围、积压和无法计量项。先自行查找与判断，仅在仍缺少信息或证据冲突时在任务结果集中反问用户；不要阻塞其他可确认数据上报。项目状态由会话证据判断，on_track与blocked均为在研；不按时间超时，不把Agent任务结束当作项目完成。状态变化或首次补齐时写statuses.json并核对status_receipt，无证据则沿用上次状态。排除当前上报会话，不启动服务端，不重复创建任务。`
- 创建或更新后必须重新查询任务，确认名称、已启用、30 分钟间隔和工作目录。未实际查到任务时不得声称「已设置」。当前工具无定时任务能力时，必须明确回报「未设置」及原因。
- Linux也遵守相同规则：只有当前执行工具实际提供定时任务能力才可设置；只有CLI而没有该能力时，完成可执行的上报并明确报告“定时任务未设置”，不擅自安装服务或写入cron。
- 只有试报成功且重新查询确认定时任务已启用，才可报告整体完成。最终给出任务标识、实际计划规则及下次运行时间（工具未提供则如实说明）。试报失败或定时任务工具缺失／报错时报告“整体未完成”，列出失败步骤和具体错误。
