/** 固定的演示快照；不会把模拟更新伪装成实时采集。所有金额均为独立演示值。 */
export const DEMO_NOW = '2026-11-12T10:30:00+08:00';
export const TIME_ZONE = 'Asia/Singapore';

/**
 * @typedef {Object} Milestone
 * @property {string} id 项目内稳定标识，用于关联任务。
 * @property {string} title 面向验收结果的阶段名称。
 * @property {'accepted'|'review'|'planned'} state 只有 accepted 计入总体进度。
 * @property {string} date 演示验收日期或计划日期，按 +08:00 展示。
 */
/**
 * @typedef {Object} Project
 * @property {string} id 用于哈希路由的稳定标识。
 * @property {string} name 展示名称；项目均为演示场景。
 * @property {'on_track'|'attention'|'blocked'|'completed'|'planned'} status 当前交付健康状态。
 * @property {Milestone[]} milestones 等权里程碑，未规划时为空数组。
 * @property {Object[]} risks 明确给出的演示待处理事项，不根据费用臆测风险。
 */
const milestone = (id, title, state, date) => ({ id, title, state, date });

export const projects = [
  {
    id: 'live-monitor', code: 'PRJ-001', name: '直播监控平台', category: '数据与监控', icon: 'radio', accent: 'lime',
    goal: '让直播状态、异常告警与监控数据，在同一个工作台清晰可见。',
    status: 'on_track', stage: '联调与验收', owner: '林屿', initials: 'LY', updatedAt: '2026-11-12T10:28:00+08:00',
    milestones: [
      milestone('m1', '需求与范围确认', 'accepted', '2026-10-21'), milestone('m2', '数据采集链路', 'accepted', '2026-10-29'),
      milestone('m3', '监控核心能力', 'accepted', '2026-11-06'), milestone('m4', '联调与异常验收', 'review', '2026-11-13'),
      milestone('m5', '上线交付', 'planned', '2026-11-18')
    ],
    risks: [{ level: 'review', title: '异常分级规则待业务确认', detail: 'AI 已完成实现和回归，仍需负责人确认告警触发边界。', owner: '项目负责人' }]
  },
  {
    id: 'highlight-studio', code: 'PRJ-002', name: '智能剪辑工作台', category: '内容与效率', icon: 'film', accent: 'orange',
    goal: '从长视频发现高光线索，让素材审核与成片交付更高效。',
    status: 'attention', stage: '核心能力验收', owner: '许言', initials: 'XY', updatedAt: '2026-11-12T10:25:00+08:00',
    milestones: [
      milestone('m1', '素材链路打通', 'accepted', '2026-10-25'), milestone('m2', '候选片段识别', 'accepted', '2026-11-04'),
      milestone('m3', '剪辑质量验收', 'review', '2026-11-11'), milestone('m4', '交付流程上线', 'planned', '2026-11-19')
    ],
    risks: [{ level: 'attention', title: '质量验收较计划延后 1 天', detail: '候选片段边界仍需人工确认，下一步集中审核 3 组代表性素材。', owner: '内容负责人' }]
  },
  {
    id: 'live-components', code: 'PRJ-003', name: '直播互动组件', category: '互动与体验', icon: 'layers', accent: 'blue',
    goal: '统一直播活动组件的配置体验，支持稳定、快速地搭建互动场景。',
    status: 'on_track', stage: '交付验收', owner: '周宁', initials: 'ZN', updatedAt: '2026-11-12T10:26:00+08:00',
    milestones: [
      milestone('m1', '设计与交互确认', 'accepted', '2026-10-17'), milestone('m2', '核心组件开发', 'accepted', '2026-10-24'),
      milestone('m3', '活动场景联调', 'accepted', '2026-11-02'), milestone('m4', '交付验收', 'review', '2026-11-14')
    ],
    risks: [{ level: 'review', title: '两项交付检查等待验收', detail: '配置兼容性与窄屏展示已完成验证，等待最终交付确认。', owner: '项目负责人' }]
  },
  {
    id: 'agent-gateway', code: 'PRJ-004', name: 'AI 接入网关', category: '平台与基础设施', icon: 'network', accent: 'purple',
    goal: '统一 AI 请求的路由与用量记录，为后续多工具接入打好基础。',
    status: 'blocked', stage: '服务接入', owner: '陈序', initials: 'CX', updatedAt: '2026-11-11T17:40:00+08:00',
    milestones: [milestone('m1', '接口方案确认', 'accepted', '2026-11-05'), milestone('m2', '服务接入与验证', 'planned', '2026-11-13'), milestone('m3', '试运行验收', 'planned', '2026-11-17')],
    risks: [{ level: 'blocked', title: '服务配额尚未确认', detail: '接入验证已暂停。需负责人确认测试环境服务配额，再恢复后续验证。', owner: '平台负责人' }]
  },
  {
    id: 'design-system', code: 'PRJ-005', name: '统一设计组件库', category: '设计与规范', icon: 'pen', accent: 'pink',
    goal: '让常用组件、状态与交互遵循同一套视觉规范。',
    status: 'completed', stage: '已交付', owner: '沈青', initials: 'SQ', updatedAt: '2026-11-02T16:30:00+08:00',
    milestones: [milestone('m1', '视觉基础规范', 'accepted', '2026-10-15'), milestone('m2', '组件与状态规范', 'accepted', '2026-10-21'), milestone('m3', '页面场景校验', 'accepted', '2026-10-28'), milestone('m4', '交付与验收', 'accepted', '2026-11-02')],
    risks: []
  },
  {
    id: 'content-strategy', code: 'PRJ-006', name: '内容策略中台', category: '策略与规划', icon: 'compass', accent: 'teal',
    goal: '整理内容策略与选题线索，形成可跟踪的策划到交付流程。',
    status: 'planned', stage: '需求梳理', owner: '苏禾', initials: 'SH', updatedAt: '2026-11-10T14:00:00+08:00',
    milestones: [], risks: []
  }
];

export const models = [
  { id: 'gpt', name: 'GPT-5', agent: 'Codex', mark: 'C', color: '#c9e76a', tone: 'lime' },
  { id: 'claude', name: 'Claude Sonnet 4', agent: 'Claude Code', mark: '✳', color: '#dc9b77', tone: 'orange' },
  { id: 'gemini', name: 'Gemini 2.5 Pro', agent: 'Gemini CLI', mark: '✦', color: '#a899ef', tone: 'purple' }
];

// 每项依次声明：任务名称、所处列、优先级、负责方、工作类型和预期结果。
const taskSpecs = {
  'live-monitor': [
    ['集成通知中心', 'todo', '中', '林屿', '功能开发', '将告警通知统一接入通知中心，并补充空状态与错误反馈。'],
    ['整理交付验收记录', 'todo', '低', '林屿', '交付整理', '归档本轮验收记录，确认交付范围与后续待办。'],
    ['优化直播间状态同步逻辑', 'doing', '高', 'Codex', '功能开发', '优化并发更新时的状态同步，避免较早响应覆盖最新状态。'],
    ['补充连接重试回归', 'doing', '中', 'Codex', '测试验证', '覆盖短暂断线、重连成功和持续失败三类连接场景。'],
    ['验收异常分级规则', 'review', '高', 'Claude Code', '规则审查', '确认不同异常等级的触发条件和告警展示文案。'],
    ['确认离线告警通知', 'review', '中', '林屿', '业务验收', '核对离线通知的业务触发边界，确认后再完成验收。'],
    ['完成采集适配', 'done', '高', 'Codex', '功能开发', '完成采集数据到统一状态结构的映射。'],
    ['搭建监控概览', 'done', '中', 'Gemini CLI', '页面开发', '完成监控概览的信息结构与基础展示。']
  ],
  'highlight-studio': [
    ['梳理交付导出清单', 'todo', '中', '许言', '交付整理', '明确导出素材与审核结果之间的对应关系。'],
    ['完善审核反馈入口', 'todo', '中', 'Codex', '页面开发', '让审核人员可以快速查看候选片段的反馈。'],
    ['校准高光片段边界', 'doing', '高', 'Codex', '功能开发', '围绕代表性素材补充片段前后文，改善边界完整性。'],
    ['复核候选片段质量', 'review', '高', '许言', '业务验收', '人工复核 3 组样本的内容完整性和描述准确性。'],
    ['完成候选识别链路', 'done', '高', 'Codex', '功能开发', '打通素材读取、候选识别到审核列表的链路。'],
    ['统一素材索引', 'done', '中', 'Claude Code', '数据整理', '为素材建立可追溯的时间与片段索引。']
  ],
  'live-components': [
    ['归档交付清单', 'todo', '低', '周宁', '交付整理', '汇总交付范围与验收结论。'],
    ['检查配置兼容性', 'doing', '中', 'Codex', '测试验证', '核对不同活动配置下的默认值和兼容表现。'],
    ['补充窄屏场景验证', 'doing', '中', 'Gemini CLI', '测试验证', '检查组件在窄屏时的文案换行与操作区域。'],
    ['确认活动场景交付', 'review', '高', '周宁', '业务验收', '确认本轮活动场景达到交付要求。'],
    ['完成组件配置页', 'done', '中', 'Codex', '页面开发', '统一配置页组件与反馈状态。'],
    ['完成活动场景联调', 'done', '高', 'Claude Code', '测试验证', '完成活动场景的配置到展示联调。']
  ],
  'agent-gateway': [
    ['实现用量汇总视图', 'todo', '中', 'Codex', '页面开发', '按项目与工具展示接入用量摘要。'],
    ['补充异常请求记录', 'todo', '中', '陈序', '功能开发', '明确异常记录的展示结构与排查入口。'],
    ['验证服务接入链路', 'doing', '高', 'Codex', '接入验证', '取得测试环境配额后继续验证服务连接与错误处理。'],
    ['核对接口方案', 'done', '高', 'Claude Code', '方案审查', '核对请求路由和用量记录的基本方案。'],
    ['准备接入样例', 'done', '中', 'Gemini CLI', '方案设计', '准备接入验证所需的演示请求场景。']
  ],
  'design-system': [
    ['建立视觉基础规范', 'done', '高', '沈青', '设计规范', '统一颜色、字体、间距和圆角规则。'],
    ['补齐组件状态', 'done', '中', 'Codex', '组件开发', '覆盖正常、禁用、加载与异常状态。'],
    ['校验页面使用场景', 'done', '中', 'Claude Code', '测试验证', '检查基础组件在典型页面中的一致性。'],
    ['完成交付验收', 'done', '高', '沈青', '业务验收', '整理交付内容并完成最终验收。']
  ],
  'content-strategy': [
    ['收集内容工作流需求', 'todo', '高', '苏禾', '需求梳理', '梳理策划、审核和交付的主要使用场景。'],
    ['确认首版范围', 'todo', '中', '苏禾', '范围确认', '确认首版业务边界后再制定里程碑。'],
    ['整理选题资料', 'todo', '低', '苏禾', '资料整理', '收集现有选题资料并确定分类方式。']
  ]
};

/**
 * @typedef {Object} Task
 * @property {string} id 抽屉与 AI 执行记录共用的任务标识。
 * @property {'todo'|'doing'|'review'|'done'} column 看板位置，不等同于里程碑验收状态。
 * @property {boolean} blocked 阻塞保留在原任务列，以独立标记说明原因。
 * @property {string|null} milestoneId 所属里程碑，未规划时不强行关联。
 */
// 显式关联所属阶段，避免将所有已完成任务都挂到第一个里程碑。
const taskMilestones = {
  'live-monitor': ['m4', 'm5', 'm4', 'm4', 'm4', 'm4', 'm2', 'm3'],
  'highlight-studio': ['m4', 'm3', 'm3', 'm3', 'm2', 'm1'],
  'live-components': ['m4', 'm4', 'm4', 'm4', 'm2', 'm3'],
  'agent-gateway': ['m2', 'm2', 'm2', 'm1', 'm1'],
  'design-system': ['m1', 'm2', 'm3', 'm4'], 'content-strategy': [null, null, null]
};
export const tasks = projects.flatMap(project => taskSpecs[project.id].map((spec, index) => ({
  id: `${project.id}-task-${index + 1}`, projectId: project.id, title: spec[0], column: spec[1], priority: spec[2],
  assignee: spec[3], kind: spec[4], description: spec[5], blocked: project.id === 'agent-gateway' && index === 2,
  milestoneId: taskMilestones[project.id][index]
})));

/**
 * @typedef {Object} AIRun
 * @property {'running'|'review'|'blocked'|'completed'|'idle'} state 可读的执行状态，不输出内部推理过程。
 * @property {string} updatedAt 演示快照中的最后更新时间。
 * @property {Object[]} steps 对可观察执行动作的简要记录。
 * @property {string[]} outputs 演示产出名称；作为文本展示，不伪造可访问链接。
 * @property {string} verification 已执行或尚待执行的验证结论。
 */
function run(id, projectId, taskIndex, modelId, state, startedAt, updatedAt, minutes, steps, outputs, verification) {
  return { id, projectId, taskId: `${projectId}-task-${taskIndex}`, modelId, state, startedAt, updatedAt, minutes, steps, outputs, verification };
}
export const runs = [
  run('run-lm-1', 'live-monitor', 3, 'gpt', 'running', '2026-11-12T10:04:00+08:00', '2026-11-12T10:28:00+08:00', 24,
    [{ title: '检查状态更新调用链', state: 'done' }, { title: '调整并发响应处理', state: 'done' }, { title: '验证异常与重连场景', state: 'running' }],
    ['状态同步逻辑调整（演示）', '并发更新回归用例（演示）'], '基础场景验证通过，异常与重连场景验证中；尚未提交业务验收。'),
  run('run-lm-2', 'live-monitor', 5, 'claude', 'review', '2026-11-12T09:32:00+08:00', '2026-11-12T10:06:00+08:00', 34,
    [{ title: '审查告警触发条件', state: 'done' }, { title: '核对异常分级文案', state: 'done' }, { title: '等待业务验收', state: 'review' }],
    ['异常分级审查摘要（演示）', '业务确认事项清单（演示）'], '规则审查已完成；触发边界需业务负责人确认，未计入已验收进度。'),
  run('run-hs-1', 'highlight-studio', 3, 'gpt', 'running', '2026-11-12T09:48:00+08:00', '2026-11-12T10:25:00+08:00', 37,
    [{ title: '读取代表性素材', state: 'done' }, { title: '调整前后文边界', state: 'running' }, { title: '生成复核样本', state: 'pending' }],
    ['片段边界调整样本（演示）'], '调整进行中，尚未完成样本复核。'),
  run('run-lc-1', 'live-components', 2, 'gpt', 'running', '2026-11-12T10:10:00+08:00', '2026-11-12T10:26:00+08:00', 16,
    [{ title: '整理配置场景', state: 'done' }, { title: '执行兼容性检查', state: 'running' }, { title: '汇总检查结果', state: 'pending' }],
    ['配置兼容性检查记录（演示）'], '兼容性检查进行中，结果待汇总。'),
  run('run-lc-2', 'live-components', 3, 'gemini', 'running', '2026-11-12T10:02:00+08:00', '2026-11-12T10:24:00+08:00', 22,
    [{ title: '检查常用窄屏尺寸', state: 'done' }, { title: '核对文案换行', state: 'running' }, { title: '整理视觉检查记录', state: 'pending' }],
    ['窄屏场景检查记录（演示）'], '主要布局已检查，长文案与操作区域仍在核对。'),
  run('run-ag-1', 'agent-gateway', 3, 'gpt', 'blocked', '2026-11-11T16:55:00+08:00', '2026-11-11T17:40:00+08:00', 45,
    [{ title: '准备接入测试场景', state: 'done' }, { title: '验证服务配额', state: 'blocked' }, { title: '执行联调验证', state: 'pending' }],
    ['接入验证准备清单（演示）'], '因测试环境服务配额未确认而暂停，接入验证尚未通过。'),
  run('run-lm-3', 'live-monitor', 7, 'gpt', 'completed', '2026-11-10T09:10:00+08:00', '2026-11-10T09:52:00+08:00', 42,
    [{ title: '核对数据映射', state: 'done' }, { title: '完成采集适配', state: 'done' }, { title: '通过回归验证', state: 'done' }],
    ['采集适配变更（演示）', '回归验证摘要（演示）'], '采集适配回归验证完成，对应阶段已验收。'),
  run('run-hs-2', 'highlight-studio', 6, 'claude', 'completed', '2026-11-09T14:00:00+08:00', '2026-11-09T14:28:00+08:00', 28,
    [{ title: '核对素材时间索引', state: 'done' }, { title: '检查片段追溯关系', state: 'done' }, { title: '汇总验证结果', state: 'done' }],
    ['素材索引核对记录（演示）'], '索引关系检查完成，结果已归档。'),
  run('run-lc-3', 'live-components', 4, 'claude', 'review', '2026-11-12T08:55:00+08:00', '2026-11-12T09:31:00+08:00', 36,
    [{ title: '执行活动联调', state: 'done' }, { title: '核对展示结果', state: 'done' }, { title: '等待交付确认', state: 'review' }],
    ['活动场景联调摘要（演示）'], '技术联调已完成，最终交付里程碑仍待负责人验收。'),
  run('run-ag-2', 'agent-gateway', 5, 'gemini', 'idle', '2026-11-11T09:00:00+08:00', '2026-11-11T09:18:00+08:00', 18,
    [{ title: '准备接入演示请求', state: 'done' }, { title: '整理场景清单', state: 'done' }],
    ['接入演示场景清单（演示）'], '准备工作完成，当前空闲，等待接入验证恢复。'),
  run('run-ds-1', 'design-system', 2, 'gpt', 'completed', '2026-11-02T10:00:00+08:00', '2026-11-02T11:20:00+08:00', 80,
    [{ title: '覆盖组件反馈状态', state: 'done' }, { title: '检查键盘访问', state: 'done' }, { title: '汇总交付内容', state: 'done' }],
    ['组件状态示例（演示）', '设计一致性检查记录（演示）'], '组件状态与设计一致性检查完成，项目已验收。')
];

/**
 * @typedef {Object} UsageRecord
 * @property {string|null} runId 可追溯的演示执行记录，其余历史用量不强行归入可见任务。
 * @property {number} inputTokens 输入 Token 数，与输出分别汇总。
 * @property {number} outputTokens 输出 Token 数。
 * @property {number} costMicros 独立的 USD 演示估算值，使用微美元整数避免累计误差。
 */
export const usage = [];
const dayMs = 86_400_000;
for (let day = 29; day >= 0; day--) {
  const date = new Date(Date.parse('2026-11-12T00:00:00Z') - day * dayMs).toISOString().slice(0, 10);
  for (let p = 0; p < 5; p++) {
    if ((p === 4 && day < 10) || (p === 3 && day === 0)) continue;
    for (let m = 0; m < models.length; m++) {
      const hasVisibleRun = runs.some(item => item.projectId === projects[p].id && item.modelId === models[m].id && item.startedAt.slice(0, 10) === date);
      if ((day + p + m) % 4 === 0 && day !== 0 && !hasVisibleRun) continue;
      const variation = 1 + ((day * 7 + p * 3 + m * 5) % 9) / 10;
      usage.push({
        id: `usage-${p}-${m}-${day}`, projectId: projects[p].id, modelId: models[m].id, runId: null,
        timestamp: `${date}T09:${String(12 + p * 3 + m * 4).padStart(2, '0')}:00+08:00`,
        inputTokens: Math.round((32_000 + p * 6_000 + m * 12_000) * variation),
        outputTokens: Math.round((8_500 + p * 1_500 + m * 3_000) * variation),
        costMicros: Math.round((170_000 + p * 46_000 + m * 105_000) * variation / 10_000) * 10_000
      });
    }
  }
}

// 为抽屉建立一对一的用量归属；归属调整不改变全局或项目的用量总额。
for (const execution of runs) {
  const executionDate = execution.startedAt.slice(0, 10);
  const record = usage.find(item => item.projectId === execution.projectId && item.modelId === execution.modelId && item.timestamp.slice(0, 10) === executionDate && !item.runId);
  if (record) { record.runId = execution.id; record.timestamp = execution.updatedAt; }
}
