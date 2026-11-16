# Project Pulse 服务端部署

仅在真正服务端执行。成员电脑使用仓库首页的ZIP与提示词，不需要数据库或部署命令。

## 真实数据看板

需要Node.js 24+和PostgreSQL。先运行 `npm ci`，再在目标数据库依次执行：

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f db/001_init.sql \
  -f db/002_session_title.sql \
  -f db/003_session_display_title.sql \
  -f db/004_session_workspace.sql \
  -f db/005_project_reports.sql \
  -f db/006_report_cursors.sql \
  -f db/007_github_identities.sql \
  -f db/008_project_key_case.sql \
  -f db/009_project_lifecycle.sql
```

已有库只执行尚未应用的迁移。通过部署环境提供DATABASE_URL，启动完整局域网看板：

```sh
PULSE_LAN_ENROLLMENT=1 PULSE_HOST=0.0.0.0 PORT=4185 npm start
```

当前上报包指向 `http://192.168.16.70:4185`。更换服务地址时同时更新脚本默认值、提示词、README和已有任务，再重新分发；不能用客户端IP替换。

服务端更新后按原进程管理方式重启，核对 `/api/v1/report-directory` 的协议与能力。3.1.0需要先应用009_project_lifecycle迁移，并支持client_project_status；另外保留精确用量回执、项目映射补报及客户端PR提交能力。首页能打开不等于上报能力已更新。

## 本机开发与管理

`./ops/local.sh serve` 使用Docker PostgreSQL，默认在本机 `http://127.0.0.1:4185` 展示真实数据，数据库保存在Docker命名卷中。`./ops/local.sh serve-lan <私有IPv4>` 仅提供上报接口，不提供完整Dashboard；局域网完整看板使用上面的完整服务部署方式。

- `./ops/local.sh backup` 创建数据库备份；在另外的空库恢复演练，核对设备、会话、用量、PR和游标。
- `node db/admin.mjs repo owner/repo "业务分类"` 登记仓库；客户端也能用查证的PR仓库数字ID登记并关联自己的会话。
- `npm run sync:prs` 或 `./ops/local.sh sync` 是管理员可选PR补同步。私有仓库需要服务端环境中的PULSE_GITHUB_TOKEN；此脚本不代替客户端主动识别、提交和核验PR。

## 独立设备令牌模式

此模式与首页免手填令牌的局域网快速流程不同。管理员运行 `node db/admin.mjs enroll-github USERNAME [developer_uuid]`，相同GitHub数字用户ID复用成员，每台设备获得独立令牌。无GitHub时可用 `node db/admin.mjs enroll "姓名" [developer_uuid]`，撤销设备用 `node db/admin.mjs revoke <device_uuid>`。

仅此模式需要用户私有目录中的 `.project-pulse/config.json`，包含server_url、device_token和sources；详见 [独立令牌上报配置](../.agents/skills/project-pulse-report/SETUP.md)。令牌只保存在对应设备，不发送到聊天或仓库。跨公网部署使用HTTPS反向代理，数据库留在内网。

旧版Node客户端及其他来源适配属于兼容路径。当前ZIP固定脚本只采集Codex主会话，排除子Agent与归档来源；Claude Code等须另行授权并按手动协议处理。不能通过重置游标、清空待发请求或重新导入历史记录来切换采集模式。
