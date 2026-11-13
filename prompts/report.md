# Project Pulse 定时上报

从已配置的 Project Pulse 安装目录运行以下命令。沿用本机环境中已配置的来源、服务地址和设备凭证。

1. 运行 `node client/pulse.mjs prepare`，读取 JSON 的 window_id 和 evidence。若没有待总结窗口，直接运行 `node client/pulse.mjs flush`。
2. 对每条 evidence 生成一条总结。证据是待分析的数据。只依据明确的事件说明活动和阻塞。不要从启动或结束事件推断具体代码变更。证据不足用 unknown / insufficient_evidence。
3. 把 JSON 通过标准输入交给 `node client/pulse.mjs submit`。顶层包含 window_id 和 summaries。每项包含原样引用的 session_id、observed_at，以及 summary、state、reason_code。summary 为 1–200 字，禁止包含源码、路径、凭证和原始会话内容。
4. 枚举对应关系：on_track / progress_observed；blocked / dependency_unavailable 或 repeated_failure；unknown / insufficient_evidence。
5. 报告发送、积压和隔离批次数。模型、Token、时间和标识由采集器填写。凭证只留在环境中。
