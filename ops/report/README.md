# Project Pulse macOS / Windows / Linux 快速上报包

版本以 `VERSION` 为准（当前 3.6.0），多仓库功能需要服务端011迁移及multi_repository_projects能力；需要服务端协议3、client_project_status能力，以及已应用009_project_lifecycle迁移。先阅读 `UPGRADE.md`，升级时保留隐藏状态和待续传目录。包内SHA256SUMS可核对完整性。

这是客户端上报包。解压后不要移动包内文件，在 Codex 打开解压后的 `project-pulse-report` 目录，把 `PROMPT.txt` 全文发给 Codex。不要直接在 ZIP 预览里执行。

## 下载与首次发送提示词

服务端启用 `team_metadata_edit` 能力后，客户端也可修正全员的摘要、项目归属、目标、里程碑和状态，操作流程见包内 `team-edits.md`。先查询最新记录和version，明确目标成员与来源会话，再修改和核验回执；不能直接写数据库或凭空调整Token。

**[下载最新上报 ZIP：project-pulse-report-3.6.0.zip](https://github.com/jiawei-wang-dev/project-pulse/releases/download/report-client-v3.6.0-20261117/project-pulse-report-3.6.0.zip)**

本版3.6.0先盘点项目供用户选择，确认后仅上报所选项目并创建30分钟任务；详见 `project-selection.md`。保留全员数据修正说明及接口，启用步骤见 `team-edits.md`，服务端未启用时不能宣称可修改。继续保留宽松Agent识别：运行窗口2小时，补足消息／输出／工具／用量活动信号，明确结束仍退出。覆盖更新原永久目录后，重新发送下面提示词以更新原30分钟任务，不能只下载新包而继续运行旧目录。

解压到永久目录，用Codex打开本文件夹，复制下面整段发送；也可直接发送PROMPT.txt全文。不要仅打开ZIP预览。

```text
PROJECT_PULSE_AUTOMATION。读取当前目录的 PROMPT.txt 和 README.md，先按project-selection.md只读列出本机项目让我选择，等我确认后再对所选项目执行完整上报与定时同步流程。

第一步只做只读盘点：列出项目编号、仓库或本地工作区、已识别主会话数量及待确认项，让我多选。选择前不得执行Prepare／Submit、上传或设置任务，不默认全选。确认后保存私有选择文件；每轮Prepare和Submit必须限制OnlySource为所选项目，后续30分钟任务沿用此范围，新项目先询问再加入。

我授权你识别本机 Codex 主会话及相关项目、成员、GitHub仓库和PR、模型与真实Token用量，并生成脱敏摘要、项目目标和里程碑。先主动查找并复用已有信息，仍缺信息或证据冲突时，再集中询问我。排除当前上报会话，不编造数据。

使用包内对应系统的固定脚本，向 http://192.168.16.70:4185 增量上报。一个所选业务项目可关联多个仓库：查证每个真实仓库及数字ID，按README写repositories.json；PR按实际仓库与编号提交，不伪造单仓库归属。先核对服务端multi_repository_projects能力。PR也要按README查证并结构化提交，分别核对日志、Token和PR回执。

每轮先读私有项目选择，并用 Inventory 查询所选项目和本机已授权会话在面板上的已有信息与缺项，再开始准备上报。只补有证据的缺项和经确认的新信息。已有内容、项目归属或待发批次与本机证据冲突时，先列出差异询问用户，等待确认再处理冲突项。定时运行把问题留在结果里，继续同步范围内其余无冲突数据。提交后重新查询核对。

每轮检查所选项目的功能模块。服务端支持 project_modules 时，根据项目 README、代码和已确认成果整理 1–12 项，每项写模块名称和一句职责介绍。首次缺失或有变化时提交完整 modules 清单，并核对项目报告是否显示。无新增日志时按项目报告补报流程提交，沿用原游标和计量上下文。证据不足或服务端尚未启用时，在结果里说明。

项目状态由会话证据判断，在研包含尚未完成的阻塞项目；不按时间超时，与Agent执行状态分开。状态变化或首次补齐时按README提交statuses.json并核对status_receipt，不把一轮任务结束当作整个项目完成。

需要修正团队记录时，先核对服务端team_metadata_edit能力，再按team-edits.md查询目标成员、设备、会话与最新version，带原因提交并核验。允许修正全员的摘要、项目归属、目标、里程碑和状态；证据不足先询问，不改原始Token或游标。正常上报不为使用此接口而改写其他成员数据。

试报成功后，必须使用定时任务工具，创建或更新并启用「Project Pulse 每30分钟上报」，每30分钟在当前永久解压目录执行完整识别与增量同步。已有同用途任务就更新，避免重复；设置后重新查询确认启用状态、间隔和目录。无需再次询问是否设置。

最后报告实际识别及提交结果、Token与PR核验结果、积压和缺失信息，以及任务标识、启用状态和计划规则。无法上报或无法设置任务时明确说明失败步骤和原因，不得宣称全部完成。
```

## 不可更改的部署信息

- 服务端固定为 `http://192.168.16.70:4185`。解压本包的电脑是客户端；不得用客户端自己的 IP 替换服务端地址，不得在客户端启动 Project Pulse 服务端。
- 快速流程使用局域网设备指纹，不需要 `~/.project-pulse/config.json`，也不需要设备令牌。
- macOS／Linux 使用系统 Perl（含 JSON::PP、Digest::SHA）和 curl，Windows 使用系统 Windows PowerShell 和 curl.exe。其他机器必须能访问上述地址。Linux入口检查依赖，缺少时明确报告，不自动安装。
- 项目、会话、PR、模型、Token、摘要、目标、里程碑等均由客户端Codex主动识别和核验，脚本负责解析差分与提交，服务端校验、存储、展示。客户端通过 `pulls.json` 上报查证后的PR，不能依赖服务端抓取代替识别。服务端原PR同步脚本保留为管理员可选补充。

## 先选项目

先阅读包内 `project-selection.md`，只读列出本机项目供用户多选。用户确认之前不执行Prepare／Submit，也不创建任务。确认后保存私有 `.pulse-project-selection.json`，后续仅按所选项目的OnlySource范围试报与定时同步。此选择不随ZIP分发。

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

脚本单轮检查最多8个候选文件、普通预算读取1 MiB，首个不完整长行可扩展至默认32 MiB，并在约12秒扫描预算到达后暂停；请求最多等待4秒。首次采集起点为首次运行前7天，并持久化在本包状态及服务端游标上下文，之后不随日期滚动；已知来源即使修改时间过旧也继续追赶积压。轮转位置持久化，多次运行会继续轮转。无变化文件也计入检查预算，所以 `backlog` 是待检查／待读取提示，不是精确剩余字节数。

首次快照：会话开始于采集范围内时可计入该主会话累计量；跨窗口老会话的首次快照只用可信的 `last_token_usage`，不将窗口前累计量计入。正常快照取累计差分，重复快照计零；累计值回退时只用明确的 `last_token_usage`，缺失则记录 `unmeasured_snapshots`。该诊断表示存在无法确定的用量，不能声称计量完整。文件头及数据行都支持有界长行扩展；默认单行上限32 MiB，macOS／Linux可传 `--max-line-bytes 67108864`，Windows可传 `-MaxLineBytes 67108864`，最大允许256 MiB。超过上限返回line_exceeds_max_line_bytes，保持该行起点和Token基线；提高上限后从同一位置继续，不跳过记录；同时把相同MaxLineBytes参数写入原30分钟任务，避免下一轮退回较低上限。尚未完整换行或JSON损坏时同样不推进该记录游标。普通扫描仍为约12秒，长行扩展与解析可能增加本轮用时，bytes_read按真实读取量报告。

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

真正服务端需提供 `client_pr_ingest` 能力；多仓库还需011迁移及 `multi_repository_projects` 能力；缺失时明确报告PR尚未同步，不能降级为“摘要里写了链接就算已上传”。回报日志回执与PR回执两项，再辅助检查Dashboard.pulls。只有PR已识别但未提交时不得声称全部同步完成。

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

## 一个业务项目关联多个仓库

真正服务端先应用 `db/011_project_repositories.sql` 并重启，目录必须声明 `multi_repository_projects`。会话的主仓库UUID作为稳定业务项目身份；已核实的额外仓库通过独立关联表挂到该项目。PR始终以真实仓库ID与PR编号为键，不能将JXAccount的PR伪造成MCPhub仓库的PR。第二个仓库的PR不改变既有会话归属、目标、里程碑或Token游标。项目卡片展示关联仓库数量，文档在业务项目内标明PR的真实仓库。

即使无PR，也可在本轮工作目录写 `repositories.json`，数组最多50条，每条仅包含：

```json
[{"source_session_id":"已选项目的一条已上报主会话UUID","repository":"owner/secondary","github_id":123456}]
```

源会话、仓库关系与数字ID必须查证，不能按同名目录或仓库相似度擅自合并；只登记用户所选业务项目相关仓库。Submit会把它和pulls.json一起保存为不可变pr-request.json，向既有report-pulls接口提交；无PR时pulls可以为空。核对pr_receipt.repositories与实际仓库条数、pulls与实际PR条数。关联及PR在同一事务中提交，失败整批回滚，不影响已成功提交的日志或Token；重复请求幂等。已有旧版失败的30条混合仓库请求，在服务端升级后原样重试即可，不改批次ID、会话ID或事件ID。

服务端目录的project_repositories提供业务项目与真实仓库对应关系。只有唯一、已核实的关联才可复用；一个仓库映射多个业务项目、或本来有独立项目会话时须让用户确认，不自动移动历史数据。新会话识别到唯一的已关联仓库时复用既有业务项目；已选项目可在私有选择中增加 `repositories` 数组记录已确认仓库，仍按source_ids限制本轮上报。团队数据修正不会自动删除关联表，归属变更前先查证影响范围。

## 定时任务执行规则

- `PROMPT.txt` 明确要求先盘点并等待项目选择，确认后授权“所选项目试报”和“设置每30分钟定时任务”两个必做交付。试报成功后必须继续调用 Codex 桌面端定时任务工具（`automation_update`），不得再次询问是否设置，也不得在一次上传完成后结束。不能以有积压、无新增用量或沿用摘要为由跳过。定时运行本身只执行一轮上报，不重复创建任务。
- 先查找本机同目录、同上报用途的已有任务，更新并启用；没有才创建。任务名为「Project Pulse 每30分钟上报」，每 30 分钟执行一次，工作目录必须是解压后的永久目录，不得使用临时目录或 ZIP 路径。
- 定时任务正文（创建时将“本包永久目录”替换为实际绝对目录）：`PROJECT_PULSE_AUTOMATION。读取本包永久目录的VERSION和README.md，服务端为http://192.168.16.70:4185。由当前客户端Codex主动识别成员、项目、迁移目录、主会话、GitHub仓库与PR、模型、三类Token、摘要、目标及里程碑。先读取私有项目选择，仅对所选项目传OnlySource，空选择或损坏则停止。每轮先读私有项目选择，并用 Inventory 查询所选项目和本机已授权会话在面板上的已有信息与缺项，再开始准备上报。只补有证据的缺项和经确认的新信息。已有内容、项目归属或待发批次与本机证据冲突时，先列出差异询问用户，等待确认再处理冲突项。定时运行把问题留在结果里，继续同步范围内其余无冲突数据。提交后重新查询核对。确认待发请求的全部记录仍在授权范围且没有冲突后恢复，复用已有证据与映射；使用固定脚本解析Token差分并提交，不能估算或重复累计。用已授权GitHub工具检查open／closed／merged／draft，将查证结果按README写入pulls.json并用Submit提交，即使无新增日志也要检查PR。核对日志committed、usage_verified、PR的pr_receipt及diagnostics，报告实际提交、覆盖范围、积压和无法计量项。先自行查找与判断，仅在仍缺少信息或证据冲突时在任务结果集中反问用户；不要阻塞其他可确认数据上报。项目状态由会话证据判断，on_track与blocked均为在研；不按时间超时，不把Agent任务结束当作项目完成。状态变化或首次补齐时写statuses.json并核对status_receipt，无证据则沿用上次状态。每轮检查所选项目的功能模块。服务端支持 project_modules 时，根据项目 README、代码和已确认成果整理 1–12 项，每项写模块名称和一句职责介绍。首次缺失或有变化时提交完整 modules 清单，并核对项目报告是否显示。无新增日志时按项目报告补报流程提交，沿用原游标和计量上下文。证据不足或服务端尚未启用时，在结果里说明。排除当前上报会话，不启动服务端，不重复创建任务。`
- 创建或更新后必须重新查询任务，确认名称、已启用、30 分钟间隔和工作目录。未实际查到任务时不得声称「已设置」。当前工具无定时任务能力时，必须明确回报「未设置」及原因。
- Linux也遵守相同规则：只有当前执行工具实际提供定时任务能力才可设置；只有CLI而没有该能力时，完成可执行的上报并明确报告“定时任务未设置”，不擅自安装服务或写入cron。
- 只有试报成功且重新查询确认定时任务已启用，才可报告整体完成。最终给出任务标识、实际计划规则及下次运行时间（工具未提供则如实说明）。试报失败或定时任务工具缺失／报错时报告“整体未完成”，列出失败步骤和具体错误。

## 项目功能模块

服务端应用 `012_project_modules.sql` 并重启后，目录声明 `project_modules`。客户端从已选项目的 README、代码或会话证据归纳功能，随 `summaries.json` 的项目目标和里程碑提交可选的 `modules`，例如 `[{"name":"增量采集","description":"读取新增会话并计算 Token 差分。"}]`。支持 1–12 个模块，名称最多 48 字，描述最多 200 字。无新增日志时，按包内 lan-report.md 的等游标项目报告流程补报。复用上一版 goal 和 milestones，使用本次独立的 report_id 和 batch_id，同一次重试保持请求原样。提交后核对项目报告中的 modules。旧报告省略模块不会清除已上报列表。


## 查询面板缺项

项目选择完成后，及每次定时上报开始时，对每个已选项目调用 Inventory。项目键使用已核实的 GitHub owner/repo 或工作区名称，每次最多传 50 个本机已授权主会话 UUID。macOS 使用：

```sh
/usr/bin/perl ./pulse-report.pl --action Inventory --project-key owner/repo --only-source <UUID>
```

Linux 把命令入口换为 `sh ./pulse-report-linux.sh`。Windows 在 PowerShell 内运行：

```powershell
& .\pulse-report.ps1 -Action Inventory -ProjectKey 'owner/repo' -OnlySource @('<UUID>')
```

Inventory 是只读操作。它返回项目目标、里程碑、模块、状态、PR 总数及最近 50 条 PR，以及该设备匹配会话的摘要、状态和偏移。missing 是待核实的缺项。PR 数为零或列表截断时，仍通过真实仓库查证。conflicts 列出本机来源已登记的不同项目归属，相关来源暂停提交，等用户确认。unreported_source_ids 是该设备尚未上报的来源，继续处理经本机核实的新增会话。若 project 为 null，可先提交这些来源的正常日志批次，随后再查项目缺项。

只补确有证据的缺项。已有字段冲突时，在本轮结果列出服务端现值、候选值和依据，请用户确认后再写入。提交前重查拟编辑的记录。恢复旧待发前也检查计划、PR 和状态请求是否仍在所选范围且无冲突。若存在冲突，保留原请求并暂停该待发队列，不改正文、不绕过队列。服务端尚无 report_inventory 或该查询失败时报告原因，暂停本轮写入，避免无基线覆盖已有内容。

有游标但无新增日志时，可沿用 lan-report.md 的等游标补报协议补齐项目资料或缺失摘要。摘要补报使用 summaries 数组，关联原设备的原会话，使用新 summary_id 和 batch_id，保留原游标与 context，其他必填数组为空。服务端发现该摘要已存在则返回 409，重新读取以确认。用量始终由采集脚本按原游标差分。
