import { projects, tasks, runs, models } from './data.js';

/**
 * 项目档案补充业务目标与交付边界，均为原型演示资料。
 * startDate 是启动日期；targetDate 是计划交付日期，不据此推算验收进度。
 * outcomes 是期待交付的可观察结果；reviewer 是演示验收角色。
 */
export const projectProfiles = {
  'live-monitor': { version: 'v0.8.0', startDate: '2026-10-14', targetDate: '2026-11-18', reviewer: '业务负责人', sponsor: '运营团队',
    context: '直播状态分散、异常响应依赖人工巡查，需要将采集、告警和处置放到同一条工作链路。',
    outcomes: ['统一直播状态采集与展示', '异常分级与告警可追溯', '交付前完成断线和并发场景验证'],
    scope: ['数据采集', '状态同步', '告警通知', '质量验证', '交付验收'] },
  'highlight-studio': { version: 'v0.6.0', startDate: '2026-10-18', targetDate: '2026-11-19', reviewer: '内容负责人', sponsor: '内容团队',
    context: '长视频素材审核成本较高，需要让候选片段、审核结论与导出素材保持完整对应。',
    outcomes: ['候选片段可定位到原素材', '片段边界与描述经人工复核', '审核记录随交付结果一并留存'],
    scope: ['素材索引', '高光识别', '审核体验', '质量验证', '交付导出'] },
  'live-components': { version: 'v1.4.0', startDate: '2026-10-10', targetDate: '2026-11-14', reviewer: '活动负责人', sponsor: '直播运营',
    context: '活动场景配置重复、组件反馈不一致，需要统一配置方式并覆盖不同展示尺寸。',
    outcomes: ['活动配置与展示结果一致', '配置兼容及窄屏检查有记录', '组件、使用说明与验收清单一起交付'],
    scope: ['组件配置', '活动联调', '展示体验', '交付验收'] },
  'agent-gateway': { version: 'v0.3.0', startDate: '2026-11-02', targetDate: '2026-11-17', reviewer: '平台负责人', sponsor: '研发团队',
    context: 'AI 服务接入分散，需要统一请求路由、异常记录和项目用量归属。当前验证等待测试配额。',
    outcomes: ['服务接入过程可验证', '失败请求与异常原因可定位', '项目用量记录有统一归属'],
    scope: ['方案设计', '服务接入', '用量观测', '异常记录'] },
  'design-system': { version: 'v1.0.0', startDate: '2026-10-08', targetDate: '2026-11-02', reviewer: '设计负责人', sponsor: '产品设计',
    context: '页面组件及反馈状态不一致，需要建立统一的设计与使用规范。',
    outcomes: ['统一颜色、字阶与间距规则', '常用组件反馈状态完整', '典型页面场景已完成校验'],
    scope: ['视觉规范', '组件状态', '场景校验', '交付验收'] },
  'content-strategy': { version: '规划中', startDate: '2026-11-10', targetDate: null, reviewer: '内容负责人', sponsor: '内容团队',
    context: '策划资料散落在不同环节，先梳理工作流和首版范围，再安排研发与 AI 任务。',
    outcomes: ['确认使用对象与主要场景', '形成首版范围及验收节点', '建立可检索的选题资料分类'],
    scope: ['需求调研', '范围规划', '资料整理'] }
};

/** 任务模块分组仅用于工作分解；各模块任务完成率不会替代项目的里程碑验收进度。 */
const taskModules = {
  'live-monitor': ['告警通知', '交付验收', '状态同步', '质量验证', '告警通知', '告警通知', '数据采集', '数据采集'],
  'highlight-studio': ['交付导出', '审核体验', '高光识别', '质量验证', '高光识别', '素材索引'],
  'live-components': ['交付验收', '组件配置', '展示体验', '交付验收', '组件配置', '活动联调'],
  'agent-gateway': ['用量观测', '异常记录', '服务接入', '方案设计', '方案设计'],
  'design-system': ['视觉规范', '组件状态', '场景校验', '交付验收'],
  'content-strategy': ['需求调研', '范围规划', '资料整理']
};
/**
 * @typedef {Object} TaskDetail
 * @property {string} module 所属业务模块，供工作分解与任务筛选使用。
 * @property {string|null} dueDate 与所属阶段一致的演示计划日期，未规划时为空。
 * @property {string[]} dependencyIds 前置任务标识，只在同一项目内关联。
 * @property {Object[]} checklist 具体执行检查项，完成不代表已获业务验收。
 */
export const taskDetails = Object.fromEntries(projects.flatMap(project => tasks.filter(item => item.projectId === project.id).map((task, index) => {
  const lastRun = runs.filter(item => item.taskId === task.id).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const milestone = project.milestones.find(item => item.id === task.milestoneId);
  const states = { todo: ['pending', 'pending', 'pending'], doing: ['done', 'running', 'pending'], review: ['done', 'done', 'review'], done: ['done', 'done', 'done'] }[task.column];
  return [task.id, {
    module: taskModules[project.id][index], dueDate: milestone?.date || null, dependencyIds: [],
    updatedAt: lastRun?.updatedAt || project.updatedAt,
    checklist: ['确认任务范围与输入材料', `完成${task.kind}内容`, '补齐验证记录并提交验收'].map((title, step) => ({ title, state: states[step] })),
    acceptance: [task.description, '关联产出可追溯到本任务', '由负责人复核结果并记录验收结论']
  }];
})));
taskDetails['live-monitor-task-1'].dependencyIds = ['live-monitor-task-5'];
taskDetails['live-monitor-task-3'].checklist = [
  { title: '核对采集端到页面的状态更新链路', state: 'done' },
  { title: '覆盖重复响应与响应乱序场景', state: 'done' },
  { title: '调整旧响应覆盖最新状态的处理', state: 'done' },
  { title: '回归断线重连与持续失败场景', state: 'running' },
  { title: '整理状态同步变更与验证记录', state: 'pending' }
];

export const documentKinds = {
  requirement: { label: '需求说明', icon: 'document', tone: 'blue' }, design: { label: '技术方案', icon: 'network', tone: 'purple' },
  contract: { label: '接口约定', icon: 'code', tone: 'teal' }, change: { label: '变更说明', icon: 'code', tone: 'lime' },
  test: { label: '测试报告', icon: 'checkCircle', tone: 'green' }, review: { label: '验收记录', icon: 'flag', tone: 'amber' },
  delivery: { label: '交付清单', icon: 'inbox', tone: 'orange' }, plan: { label: '实施计划', icon: 'calendar', tone: 'pink' }
};
export const documentStates = {
  draft: { label: '草稿', tone: 'muted' }, review: { label: '待确认', tone: 'amber' }, approved: { label: '已确认', tone: 'green' }
};

/**
 * @typedef {Object} OutputDocument
 * @property {string} id 产出文档的稳定标识，供列表、抽屉和深链接共用。
 * @property {string} projectId 所属项目，所有任务、执行与里程碑关联均限定在该项目内。
 * @property {string|null} milestoneId 关联验收阶段，未规划项目允许为空。
 * @property {string[]} taskIds 支撑该文档的任务；不将文档确认等同于任务或里程碑验收。
 * @property {string|null} runId 可追溯的 AI 执行记录，人工作业文档允许为空。
 * @property {'draft'|'review'|'approved'} status 文档自身的内容确认状态。
 * @property {Object[]} sections 可实际预览和导出的演示正文，不读取其他项目真实资料。
 * @property {Object[]} history 版本变化及确认记录，只展示已给出的演示版本。
 */
function doc(projectId, slug, title, kind, status, milestoneId, taskIndex, runId, updatedAt, summary, points, version) {
  const project = projects.find(item => item.id === projectId);
  const execution = runs.find(item => item.id === runId);
  const author = execution ? models.find(item => item.id === execution.modelId).agent : project.owner;
  const currentVersion = version || (status === 'approved' ? 'v1.0' : status === 'review' ? 'v0.9' : 'v0.3');
  const previousDate = new Date(Date.parse(updatedAt) - 86_400_000).toISOString();
  return {
    id: `${projectId}-${slug}`, projectId, title, kind, status, milestoneId, taskIds: taskIndex ? [`${projectId}-task-${taskIndex}`] : [],
    runId, author, reviewer: projectProfiles[projectId].reviewer, updatedAt, version: currentVersion, summary,
    sections: [
      { title: '目的与结论', type: 'paragraph', content: summary },
      { title: '本版本覆盖范围', type: 'list', content: points },
      { title: '检查与确认记录', type: 'checklist', content: points.map((point, index) => ({ title: point, state: status === 'approved' ? 'passed' : index === 0 ? 'passed' : status === 'review' ? 'review' : 'pending' })) },
      { title: '后续处理', type: 'list', content: status === 'approved' ? ['本版本内容已确认，后续调整应记录新的版本。', '项目交付进度以关联里程碑的验收结论为准。'] : status === 'review' ? [`请${projectProfiles[projectId].reviewer}复核尚待确认的内容。`, '完成确认后，将结论同步到关联任务与验收节点。'] : ['补齐尚未完成的验证与边界说明。', `内容就绪后，提交${projectProfiles[projectId].reviewer}确认。`] }
    ],
    history: [
      { version: currentVersion, date: updatedAt, author, status, summary: status === 'approved' ? '完成内容确认，形成当前交付版本。' : status === 'review' ? '补齐执行记录与确认清单，提交负责人复核。' : '补充范围与执行记录，当前版本持续完善中。' },
      { version: 'v0.1', date: previousDate, author, status: 'draft', summary: '建立初稿，整理输入材料与覆盖范围。' }
    ]
  };
}
export const documents = [
  doc('live-monitor', 'requirements', '直播监控需求与范围说明', 'requirement', 'approved', 'm1', null, null, '2026-10-21T15:20:00+08:00', '明确直播状态监控、告警与处置的首版范围，供开发和验收使用。', ['覆盖直播状态采集与概览展示', '按异常类型区分提醒与待处理事项', '本期交付范围包含监控与告警，不包含运营结算'], 'v1.2'),
  doc('live-monitor', 'architecture', '监控数据链路技术方案', 'design', 'approved', 'm2', 7, null, '2026-10-29T16:10:00+08:00', '梳理采集、状态归一化与页面刷新之间的数据流向。', ['采集结果先完成统一状态映射', '页面只消费归一化后的监控状态', '异常信息保留可追溯的来源与更新时间'], 'v1.1'),
  doc('live-monitor', 'monitor-validation', '监控核心能力验证记录', 'test', 'approved', 'm3', 8, null, '2026-11-06T16:00:00+08:00', '汇总监控概览、状态刷新与异常反馈的检查结果，支撑核心能力阶段验收。', ['监控概览能够展示主要直播状态', '状态刷新与采集结果保持一致', '空数据与异常场景有明确反馈']),
  doc('live-monitor', 'sync-contract', '状态同步接口与并发约定', 'contract', 'draft', 'm4', 3, 'run-lm-1', '2026-11-12T10:28:00+08:00', '记录状态更新顺序、响应乱序与断线重连时的处理约定；异常场景仍在验证。', ['更新结果需对应同一直播间和请求批次', '旧响应不能覆盖更新的直播状态', '持续失败时保留明确的错误反馈与重试入口']),
  doc('live-monitor', 'alert-review', '异常告警分级审查记录', 'review', 'review', 'm4', 5, 'run-lm-2', '2026-11-12T10:06:00+08:00', '技术审查已完成，告警触发边界与分级文案等待业务负责人确认。', ['核对短暂断线与持续离线的分级边界', '确认重复告警的展示与消除方式', '业务负责人确认后再关闭验收事项']),
  doc('live-monitor', 'retry-report', '连接重试场景回归报告', 'test', 'draft', 'm4', 4, null, '2026-11-12T09:50:00+08:00', '整理连接恢复的覆盖场景，短暂断线已复核，持续失败场景仍待补齐。', ['短暂断线后可以重新建立连接', '重试失败时展示可理解的状态', '持续失败与页面切换组合场景待完成']),
  doc('live-monitor', 'acceptance', '联调与异常验收清单', 'review', 'review', 'm4', 6, null, '2026-11-11T16:30:00+08:00', '汇总联调输入、验证记录与待业务确认的事项，供本轮验收使用。', ['采集与页面监控状态一致', '离线提醒的触发边界经业务确认', '断线重连与并发场景有对应验证记录']),
  doc('live-monitor', 'adapter-change', '采集适配变更说明', 'change', 'approved', 'm2', 7, 'run-lm-3', '2026-11-10T09:52:00+08:00', '补充采集适配的变更内容和回归结论，作为已交付链路的后续维护记录。', ['统一采集状态到页面状态的映射', '补充异常采集结果的默认处理', '记录回归覆盖与影响范围']),
  doc('live-monitor', 'handover', '上线交付准备清单', 'delivery', 'draft', 'm5', 2, null, '2026-11-11T14:20:00+08:00', '预先整理上线前的交付材料，最终交付依赖联调与异常验收通过。', ['汇总功能范围、变更说明和验收记录', '核对待处理风险与后续维护事项', '补齐最终交付确认人及结论']),
  doc('highlight-studio', 'requirements', '素材审核流程与首版范围', 'requirement', 'approved', 'm1', null, null, '2026-10-25T14:10:00+08:00', '确认素材输入、候选片段与审核交付之间的工作流。', ['候选片段能定位到原始素材', '审核结论与导出结果保留对应关系', '候选评分用于排序，最终质量由人工审核']),
  doc('highlight-studio', 'candidate-pipeline', '候选识别链路验证报告', 'test', 'approved', 'm2', 5, null, '2026-11-04T16:00:00+08:00', '确认素材读取、候选识别与审核列表之间的链路可用，片段质量另行验收。', ['候选片段可以进入审核列表', '来源素材及时间索引可追溯', '识别链路通过不代表片段质量自动通过']),
  doc('highlight-studio', 'index', '素材索引与追溯核对记录', 'design', 'approved', 'm1', 6, 'run-hs-2', '2026-11-09T14:28:00+08:00', '核对素材时间索引与片段追溯关系，相关检查已完成。', ['素材来源与时间范围可定位', '片段描述与原素材片段一致', '审核页面能回到对应素材']),
  doc('highlight-studio', 'boundary', '高光片段边界调整记录', 'change', 'draft', 'm3', 3, 'run-hs-1', '2026-11-12T10:25:00+08:00', '正在补充代表性素材的前后文，生成下一轮人工复核样本。', ['检查片段开头是否包含必要前情', '检查结尾是否保留结果与反馈', '复核样本需保留原素材定位信息']),
  doc('highlight-studio', 'quality', '代表性素材质量验收表', 'review', 'review', 'm3', 4, null, '2026-11-11T17:10:00+08:00', '质量验收较计划延后，等待内容负责人集中复核三组样本。', ['检查内容主体与描述归属', '确认片段边界完整', '记录通过、待调整及不采用的结论']),
  doc('highlight-studio', 'export', '成片导出与素材交付清单', 'delivery', 'draft', 'm4', 1, null, '2026-11-10T15:00:00+08:00', '整理导出素材、审核结论与交付说明的对应方式。', ['导出结果带有可识别的素材名称', '审核记录可追溯到导出片段', '交付材料包含未完成事项说明']),
  doc('live-components', 'design', '互动组件配置设计说明', 'design', 'approved', 'm1', null, null, '2026-10-17T16:00:00+08:00', '明确互动组件配置方式与主要反馈状态。', ['配置项与预览结果一一对应', '正常、空数据和异常状态文案统一', '重要配置项有清晰的操作反馈']),
  doc('live-components', 'component-change', '核心组件开发与变更说明', 'change', 'approved', 'm2', 5, null, '2026-10-24T16:00:00+08:00', '汇总组件配置页及基础组件的开发内容，记录对应验证与已知边界。', ['配置项与组件展示结构对应', '常用反馈状态遵循统一规范', '变更范围与使用边界已归档']),
  doc('live-components', 'integration', '活动场景联调验证报告', 'test', 'approved', 'm3', 6, null, '2026-11-02T16:00:00+08:00', '完成已规划活动场景的配置到展示联调，最终交付仍需后续负责人确认。', ['常见活动配置能形成预期展示', '配置切换后状态可以正常更新', '联调记录与待交付确认项分开归档']),
  doc('live-components', 'compatibility', '配置兼容性检查报告', 'test', 'draft', 'm4', 2, 'run-lc-1', '2026-11-12T10:26:00+08:00', '常用配置已完成检查，剩余兼容场景正在验证。', ['核对不同活动场景的默认配置', '检查配置切换后展示是否一致', '汇总不兼容项及处理结论']),
  doc('live-components', 'responsive', '窄屏展示检查记录', 'test', 'draft', 'm4', 3, 'run-lc-2', '2026-11-12T10:24:00+08:00', '记录窄屏布局检查结果，长文案与操作区域仍在核对。', ['主要信息在窄屏下完整可读', '长文案换行不会遮挡操作区', '键盘和触屏操作区域保持可访问']),
  doc('live-components', 'acceptance', '活动场景交付验收记录', 'review', 'review', 'm4', 4, 'run-lc-3', '2026-11-12T09:31:00+08:00', '技术联调已结束，等待活动负责人确认最终交付。', ['活动配置到展示链路已核对', '兼容性与窄屏记录需要一并复核', '负责人确认最终交付范围']),
  doc('live-components', 'handover', '组件使用与交付清单', 'delivery', 'review', 'm4', 1, null, '2026-11-11T15:40:00+08:00', '汇总组件使用场景、配置说明与待确认的交付材料。', ['组件与对应活动场景保持一致', '使用说明覆盖常见配置方式', '交付清单附上验收记录']),
  doc('agent-gateway', 'design', '多工具接入与用量归属方案', 'design', 'approved', 'm1', 4, null, '2026-11-05T15:00:00+08:00', '明确请求路由、用量归属及异常记录的基本方案。', ['请求能归属到对应项目与 AI 工具', '输入和输出 Token 分别记录', '费用与实际账单接入前保持估算标识']),
  doc('agent-gateway', 'checklist', '服务接入验证准备清单', 'test', 'draft', 'm2', 3, 'run-ag-1', '2026-11-11T17:40:00+08:00', '接入验证已暂停，测试环境配额确认后继续执行。', ['接入场景和输入材料已准备', '测试配额需要平台负责人确认', '配额就绪后再执行连通与异常验证']),
  doc('agent-gateway', 'samples', '接入演示请求场景集', 'plan', 'approved', 'm1', 5, 'run-ag-2', '2026-11-11T09:18:00+08:00', '准备常规与异常接入场景，供恢复验证后使用。', ['覆盖请求成功和服务失败场景', '区分验证输入与预期反馈', '所有示例均不包含真实凭据']),
  doc('agent-gateway', 'risks', '服务配额依赖与恢复事项', 'review', 'review', 'm2', 3, null, '2026-11-11T17:42:00+08:00', '记录当前阻塞原因、负责人及恢复执行所需的条件。', ['明确测试配额当前尚未确认', '由平台负责人跟进外部条件', '恢复后重新验证接入链路']),
  doc('design-system', 'foundations', '视觉基础与使用规范', 'design', 'approved', 'm1', 1, null, '2026-10-15T15:00:00+08:00', '统一颜色、字阶、间距及基础布局规则。', ['核心语义色与状态含义一致', '标题与辅助信息形成清晰层级', '间距与圆角遵循统一规范']),
  doc('design-system', 'states', '基础组件状态覆盖报告', 'test', 'approved', 'm2', 2, 'run-ds-1', '2026-11-02T11:20:00+08:00', '组件的正常、禁用、加载与异常状态已完成检查。', ['组件反馈状态覆盖完整', '主要操作支持键盘访问', '空状态与错误反馈可理解']),
  doc('design-system', 'scenarios', '典型页面一致性检查记录', 'review', 'approved', 'm3', 3, null, '2026-10-28T16:00:00+08:00', '对典型页面进行组件使用与视觉一致性校验。', ['组件使用方式与规范一致', '状态与提示信息没有相互矛盾', '窄屏页面仍保持信息层级']),
  doc('design-system', 'handover', '设计组件库交付清单', 'delivery', 'approved', 'm4', 4, null, '2026-11-02T16:30:00+08:00', '设计规范、组件状态与场景记录已汇总交付。', ['交付材料范围完整', '验收结论与遗留事项已记录', '负责人完成最终交付确认']),
  doc('content-strategy', 'discovery', '内容工作流需求调研提纲', 'requirement', 'draft', null, 1, null, '2026-11-10T14:00:00+08:00', '先确认策划、审核与交付人员的主要工作场景，再制定首版范围。', ['收集各角色的主要输入与输出', '梳理现有策划资料的存放方式', '识别跨环节协作中的等待与重复工作']),
  doc('content-strategy', 'scope', '首版范围讨论稿', 'plan', 'draft', null, 2, null, '2026-11-10T15:10:00+08:00', '整理首版讨论事项，当前尚未形成既定里程碑。', ['明确必须覆盖的主要使用场景', '讨论首版不包含的业务范围', '范围确认后再安排交付日期与验收节点'])
];
