# Claude Code 来源

以用户授权的 Claude Code 项目日志目录为准，默认 `~/.claude/projects`。处理一级项目目录的主会话 JSONL，跳过子 Agent 日志和 `isSidechain` 行。只检查最近 7 日有修改的文件。发现同一会话对应多个不同文件时停止处理该会话。

- 从根记录的 `sessionId` 读取标识。合法 UUID 作为 session_id 和 source_id，否则把 `claude_code:session:<原始ID>` 按通用 SHA-256 规则转 UUID。发现一个文件包含多个不同 sessionId 时停止。Agent、摘要和项目报告的派生键统一用 `claude_code:` 前缀。快照 tool 为 `claude_code`，工作区和仓库根据授权的 `cwd` 和 Git 信息确认。
- 从 `user` 的实际用户输入和 `assistant` 的文字回复提取任务与结果；`tool_result` 可作为验证证据。使用日志 UTC 时间。从用户输入或带非空 `message.stop_reason` 的回复判断最近活动，工具调用期间状态未知时填 unknown。排除上报任务自己的会话。
- 从 `assistant.message.model` 读取模型。用 `assistant.message.usage` 中的 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` 算总输入，`cache_read_input_tokens` 为缓存输入，`output_tokens` 为输出。仅在有非空 `message.stop_reason`、稳定的 `message.id` 和完整且可核实的最终计量时提交。事件键为 `claude_code:usage:<source_id>:<message.id>`，按同一消息去重。重复且数据矛盾时保留游标在冲突之前并报错。提供方根据已确认的模型线路填写，不能确认时用 null。此来源不用累计差分，游标 context 的三个 Token 字段填 null。
- 无法读取最终用量时仍可上报会话及摘要。没有父子证据时只报主 Agent。
