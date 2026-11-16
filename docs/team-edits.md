# 客户端 Codex 修改团队数据

客户端可修改全员的会话摘要、项目归属、项目目标、里程碑及项目状态。通过已有上报设备身份认证，无需客户端常驻程序。原始日志、Token 用量、采集游标、设备凭证和成员身份不属于此接口的可写字段。

## 服务端启用

在真正服务端执行 `db/010_team_edits.sql`，设置 `PULSE_TEAM_EDITS=1` 并重启。沿用原来的 LAN 注册或 Bearer 设备认证。必须是已经成功上报并且未被撤销的设备，不能仅凭自报的设备标识直接修改。开启后所有已登记客户端都拥有团队修改权限。未开启时接口返回403，目录不声明此能力。客户端先检查 `/api/v1/report-directory` 的 `team_metadata_edit` 能力；不支持时报告需要升级。

## 查询、修改与核验

1. `GET /api/v1/team-sessions`：每页50条，返回所有成员的设备、会话、项目、摘要、目标、里程碑、状态和 `version`。用 `next_offset` 继续查询；可传 `device_id`、`session_id` 精确筛选。两者共同确定记录，不能只凭同名项目或会话标题修改。响应不包含原始日志、设备密钥或本地文件路径。
2. 按用户要求或已核实的证据识别需要修正的字段。涉及别人记录时先核对成员、仓库与会话归属；证据不足或冲突则集中询问用户。禁止仅凭同名目录、时间未推进就批量修改或标记阻塞。
3. `POST /api/v1/team-edits`：提交下方JSON。`expected_version` 原样取自最新查询；`request_id` 是新生成的UUID。一次修改一条来源会话，可以包含多个字段。仓库必须已经登记；`repository: null` 表示解除仓库关联，此时必须有明确的工作区名。已有目标或里程碑可只改其中一项；首次补充时两者必须齐全。
4. 成功必须收到200、`status: committed` 和匹配的 `request_id`，再重新查询记录核对。409 `edit_version_conflict` 时重新读取、判断并用新请求ID提交，不强制覆盖。网络超时则原样重发同一JSON和请求ID；相同请求返回原回执，不重复写入，更改正文复用ID会返回409。
5. `GET /api/v1/team-edits?device_id=<UUID>&session_id=<UUID>` 返回最近50次修改的操作设备、原因、前后快照和服务端时间。回退时先读取当前版本，再把审计中的旧值作为新的修正提交，仍保留历史记录。

认证请求头复用上报流程：`X-Pulse-LAN-Device: <本机哈希>`，或管理员已签发的 `Authorization: Bearer ...`。POST加 `Content-Type: application/json`，正文最多64KiB。令牌不写进提示词或聊天。

```json
{
  "request_id": "新生成的UUID",
  "device_id": "目标会话所属设备UUID（可以是其他成员）",
  "session_id": "目标会话UUID",
  "expected_version": "查询返回的64位version",
  "tool": "codex",
  "reason": "根据用户确认和仓库证据纠正项目归属与进度",
  "patch": {
    "repository": "owner/repo",
    "summary": "已完成什么、验证了什么、还差什么",
    "goal": "项目最终交付目标",
    "milestones": [
      {"title": "多机验收", "state": "pending", "evidence": "仍需另一台设备验证"}
    ],
    "status": {
      "state": "on_track",
      "reason_code": "progress_observed",
      "evidence": "接口已验证，正在进行多机验收，没有无法解决的问题"
    }
  }
}
```

`patch`只填写需要修改的字段，可额外填写 `workspace_name`（120字以内）。摘要、目标、原因和依据最多200字，里程碑1–12项，标题最多120字，不提交原始日志、链接、绝对路径或账号机密。状态原因沿用正常上报：on_track/progress_observed、blocked/dependency_unavailable或repeated_failure、completed/goal_completed、paused/user_paused、unknown/insufficient_evidence。

修正摘要和目标会新增快照，归属会同步迁移该来源会话的项目报告；状态使用服务端观察时间，不修改会话实际活动时间或让Agent复活。修改针对指定来源会话，若同一项目有多条错误归属，应逐条识别、读取版本并修正，不将同名目录自动合并。此接口不锁定未来项目进展；之后有新证据的正常上报仍可更新数据。客户端后续上报先参考服务器最新信息，不能用旧本地缓存恢复已经纠正的归属或状态。

开发验证：对可丢弃且已经执行010迁移的数据库设置 `DATABASE_URL`，运行 `npm run test:team-edits`，验证跨成员修改、审计、重试、并发冲突、访问限制和用量隔离。此测试会写入样例记录，不能对生产库执行。
