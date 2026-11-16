# 给另一台电脑配置 Project Pulse

管理员为每台电脑发一个 Project Pulse 设备令牌。同一个人可以绑定到同一个成员 UUID。服务器地址由管理员提供，必须是这台电脑能访问的 HTTPS 地址。单机试跑可使用 HTTP 回环地址。受信局域网内短期试跑可填管理员提供的私有 IPv4 HTTP 地址，并在配置中加入 `"allow_lan_http": true`。HTTP 会明文传输设备令牌和报告。

在个人用户目录的 `.project-pulse/config.json` 填写：

```json
{
  "server_url": "http://192.168.16.70:4185",
  "device_token": "填写该电脑的设备令牌",
  "sources": ["codex", "claude_code"],
  "allow_lan_http": true
}
```

只保留愿意上报的来源。macOS 或 Linux 将目录和文件权限分别设为 700 与 600；Windows 使用当前用户的私有目录并保存为 UTF-8。令牌直接写在配置里，勿发到聊天中。

把整个 `project-pulse-report` 文件夹交给另一台电脑。用电脑上的工具打开该文件夹，然后发送：

> PROJECT_PULSE_AUTOMATION。读取 SKILL.md 并按里面的步骤试报一次，只读取配置授权的来源。试报成功后，直接创建并启用「Project Pulse 每30分钟上报」本机任务，工作目录选本文件夹。已有相同用途的任务就更新并启用。告诉我提交结果和任务是否已启用，不输出凭证和日志。

在 Project Pulse 仓库中也可用相同方式指定 `.agents/skills/project-pulse-report/SKILL.md`。收到明确授权且试报通过后，用本机计划任务功能按每 30 分钟设置。任务正文只要求读取 SKILL.md 执行一次增量上报，沿用用户授权范围。若当前工具无法设置或试报失败，明确说明任务状态和原因。

执行工具需要能读取本地文件、运行命令及访问服务端。macOS／Linux 使用现有 shell 和 curl；Windows 使用 PowerShell 和 curl.exe。无本地能力的网页聊天无法直接上报。使用 DeepSeek 或其他模型的开发工具时，按实际宿主工具及其日志格式选择适配。新工具 ID 由管理员在服务端以 `node db/admin.mjs tool TOOL_ID` 登记。

如果没有配置 `sources`，先向用户确认授权来源。其他日志格式需要明确文件位置、会话标识、时间、摘要证据及用量语义。验证后再打开该来源。
