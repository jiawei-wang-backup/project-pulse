import { DEMO_NOW, projects, tasks, runs, usage, models } from './data.js';
import { documents, documentKinds, documentStates, projectProfiles, taskDetails } from './catalog.js';
import { employeeById, memberships, documentPeople } from './people-data.js';

/** 页面共用状态词汇；交付健康状态与 AI 执行状态分开，避免误读。 */
export const projectStates = {
  on_track: { label: '正常推进', tone: 'green' }, attention: { label: '需要关注', tone: 'amber' },
  blocked: { label: '已阻塞', tone: 'red' }, completed: { label: '已完成', tone: 'muted' }, planned: { label: '未开始', tone: 'muted' }
};
export const runStates = {
  running: { label: '执行中', tone: 'green' }, review: { label: '待验收', tone: 'amber' },
  blocked: { label: '已阻塞', tone: 'red' }, completed: { label: '已完成', tone: 'muted' }, idle: { label: '空闲', tone: 'muted' }
};
export const columns = [{ id: 'todo', label: '待办' }, { id: 'doing', label: '进行中' }, { id: 'review', label: '待验收' }, { id: 'done', label: '已完成' }];
export const periodLabels = { 1: '今日', 7: '近 7 天', 30: '近 30 天' };
const dayMs = 86_400_000;

/** 未规划返回 null，而不是将不存在的计划渲染为 0% 的既定目标。 */
export function progressOf(project) {
  if (!project.milestones.length) return null;
  return Math.round(project.milestones.filter(item => item.state === 'accepted').length / project.milestones.length * 100);
}
export const nextMilestone = project => project.milestones.find(item => item.state !== 'accepted') || null;
export const projectTasks = projectId => tasks.filter(item => item.projectId === projectId);
export const projectRuns = projectId => runs.filter(item => item.projectId === projectId).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
export const runningFor = projectId => projectRuns(projectId).filter(item => item.state === 'running');
export const modelOf = modelId => models.find(item => item.id === modelId);
export const taskOf = taskId => tasks.find(item => item.id === taskId);
export const projectOf = projectId => projects.find(item => item.id === projectId);

/** 按 +08:00 的自然日筛选；截止时间固定在演示快照，排除未来记录。 */
export function periodBounds(period, now = DEMO_NOW) {
  const days = [1, 7, 30].includes(Number(period)) ? Number(period) : 7;
  const timestamp = Date.parse(now);
  const date = new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);
  return { start: Date.parse(`${date}T00:00:00+08:00`) - (days - 1) * dayMs, end: timestamp, days };
}
export function recordsFor(projectId = null, period = 7, source = usage) {
  const { start, end } = periodBounds(period);
  return source.filter(item => (!projectId || item.projectId === projectId) && Date.parse(item.timestamp) >= start && Date.parse(item.timestamp) <= end);
}
export function sumUsage(records) {
  return records.reduce((sum, item) => ({ inputTokens: sum.inputTokens + item.inputTokens, outputTokens: sum.outputTokens + item.outputTokens, costMicros: sum.costMicros + item.costMicros }), { inputTokens: 0, outputTokens: 0, costMicros: 0 });
}
export const usageForRun = runId => sumUsage(usage.filter(item => item.runId === runId));
export function activityFor(projectId, period) {
  const { start, end } = periodBounds(period);
  return runs.filter(item => (!projectId || item.projectId === projectId) && Date.parse(item.updatedAt) >= start && Date.parse(item.updatedAt) <= end).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
export function trendFor(projectId, period) {
  const { start, end, days } = periodBounds(period);
  const records = recordsFor(projectId, period);
  const step = days === 1 ? 3_600_000 : dayMs;
  const count = days === 1 ? Math.floor((end - start) / step) + 1 : days;
  return Array.from({ length: count }, (_, index) => {
    const from = start + index * step;
    const values = sumUsage(records.filter(item => Date.parse(item.timestamp) >= from && Date.parse(item.timestamp) < from + step));
    const localDate = new Date(from + 8 * 3_600_000).toISOString();
    return { ...values, label: days === 1 ? `${localDate.slice(11, 13)}:00` : `${localDate.slice(5, 7)}.${localDate.slice(8, 10)}` };
  });
}
export function breakdownFor(projectId, period) {
  const records = recordsFor(projectId, period);
  return models.map(model => ({ ...model, ...sumUsage(records.filter(item => item.modelId === model.id)) }));
}
export function filterProjects(query = '', status = 'all') {
  const normalized = query.trim().toLocaleLowerCase();
  return projects.filter(project => (status === 'all' || project.status === status) && `${project.name} ${project.code} ${project.category}`.toLocaleLowerCase().includes(normalized));
}
export function overviewMetrics(period) {
  return {
    active: projects.filter(project => ['on_track', 'attention', 'blocked'].includes(project.status)).length,
    pending: projects.flatMap(project => project.milestones).filter(item => item.state === 'review').length,
    running: runs.filter(item => item.state === 'running').length,
    ...sumUsage(recordsFor(null, period))
  };
}
export function routeFrom(hash) {
  if (!hash || hash === '#' || hash === '#/' || hash === '#/overview') return { page: 'overview' };
  if (hash === '#/outputs') return { page: 'outputs' };
  if (hash === '#/team') return { page: 'team' };
  try {
    const personMatch=hash.match(/^#\/team\/([^/?#]+)(?:\?([^#]*))?$/);
    if(personMatch&&employeeById(decodeURIComponent(personMatch[1]))){
      const route={page:'employee',employeeId:decodeURIComponent(personMatch[1])},params=new URLSearchParams(personMatch[2]||'');
      if(['overview','tasks','ai','documents'].includes(params.get('tab')))route.tab=params.get('tab');
      if(memberships.some(item=>item.employeeId===route.employeeId&&item.projectId===params.get('project')))route.projectId=params.get('project');
      return route;
    }
    const match = hash.match(/^#\/projects\/([^/?#]+)(?:\?([^#]*))?$/);
    if (match && projectOf(decodeURIComponent(match[1]))) {
      const route = { page: 'project', projectId: decodeURIComponent(match[1]) };
      const parameters = new URLSearchParams(match[2] || '');
      if (['overview', 'members', 'board', 'documents', 'usage', 'activity'].includes(parameters.get('tab'))) route.tab = parameters.get('tab');
      const linkedDocument = documentOf(parameters.get('doc'));
      if (linkedDocument?.projectId === route.projectId) { route.documentId = linkedDocument.id; route.tab = 'documents'; }
      return route;
    }
  } catch { /* 非法编码按未知项目处理，不让整个页面中断。 */ }
  return { page: 'not-found' };
}
export function money(micros) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(micros / 1_000_000); }
export function tokens(number) {
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}
export function shortDate(value) { if (!value) return '待规划'; const date = value.slice(0, 10); return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`; }
export function relativeTime(value) {
  const minutes = Math.max(0, Math.floor((Date.parse(DEMO_NOW) - Date.parse(value)) / 60_000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }

/** 文档状态是独立确认流程，不参与里程碑进度计算。 */
export const documentOf = documentId => documents.find(item => item.id === documentId);
export function documentsFor(projectId = null, filters = {}) {
  const query = String(filters.query || '').trim().toLocaleLowerCase();
  const bounds = filters.period ? periodBounds(filters.period) : null;
  return documents.filter(item => (!projectId || item.projectId === projectId)
    && (!filters.status || filters.status === 'all' || item.status === filters.status)
    && (!filters.kind || filters.kind === 'all' || item.kind === filters.kind)
    && (!filters.taskId || item.taskIds.includes(filters.taskId))
    && (!filters.runId || item.runId === filters.runId)
    && (!filters.milestoneId || item.milestoneId === filters.milestoneId)
    && (!bounds || (Date.parse(item.updatedAt) >= bounds.start && Date.parse(item.updatedAt) <= bounds.end))
    && `${item.title} ${item.summary} ${item.author} ${projectOf(item.projectId).name} ${documentKinds[item.kind].label}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
export function documentDigest(projectId = null, period = 7) {
  const selected = documentsFor(projectId);
  return { total: selected.length, approved: selected.filter(item => item.status === 'approved').length,
    review: selected.filter(item => item.status === 'review').length, draft: selected.filter(item => item.status === 'draft').length,
    updated: documentsFor(projectId, { period }).length, aiAuthored: selected.filter(item => item.runId).length };
}
export function taskDigest(projectId = null) {
  const selected = projectId ? projectTasks(projectId) : tasks;
  return { total: selected.length, done: selected.filter(item => item.column === 'done').length, doing: selected.filter(item => item.column === 'doing').length,
    review: selected.filter(item => item.column === 'review').length, todo: selected.filter(item => item.column === 'todo').length, blocked: selected.filter(item => item.blocked).length };
}
export function milestoneDigest(projectId = null) {
  const selected = (projectId ? [projectOf(projectId)] : projects).flatMap(item => item.milestones);
  return { total: selected.length, accepted: selected.filter(item => item.state === 'accepted').length, review: selected.filter(item => item.state === 'review').length };
}
export function currentExecutions(projectId = null, filter = 'all') {
  return runs.filter(item => (!projectId || item.projectId === projectId) && item.state !== 'completed' && (filter === 'all' || item.state === filter))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
export function moduleRows(projectId) {
  const project = projectOf(projectId);
  return projectProfiles[projectId].scope.map(name => {
    const selected = projectTasks(projectId).filter(item => taskDetails[item.id].module === name);
    const taskIds = new Set(selected.map(item => item.id));
    const done = selected.filter(item => item.column === 'done').length;
    return { name, total: selected.length, done, doing: selected.filter(item => item.column === 'doing').length, review: selected.filter(item => item.column === 'review').length,
      blocked: selected.filter(item => item.blocked).length, outputs: documentsFor(projectId).filter(item => item.taskIds.some(id => taskIds.has(id))).length,
      progress: selected.length ? Math.round(done / selected.length * 100) : null, owner: project.owner };
  });
}
/** 未来节点按计划日期排序；已延期与待验收节点保留可见，不能因未完成而被跳过。 */
export function deliveryQueue(projectId = null) {
  return (projectId ? [projectOf(projectId)] : projects).flatMap(project => project.milestones.filter(item => item.state !== 'accepted').map(item => ({
    ...item, projectId: project.id, owner: project.owner, projectName: project.name,
    overdue: Date.parse(`${item.date}T23:59:59+08:00`) < Date.parse(DEMO_NOW),
    documents: documentsFor(project.id, { milestoneId: item.id }).length
  }))).sort((a, b) => a.date.localeCompare(b.date));
}
export function costAllocation(period) {
  const total = sumUsage(recordsFor(null, period)).costMicros;
  return projects.map(project => { const amount = sumUsage(recordsFor(project.id, period)); return { project, ...amount, share: total ? amount.costMicros / total * 100 : 0 }; })
    .sort((a, b) => b.costMicros - a.costMicros);
}
/** 可追溯执行只是本期用量的一部分，其余历史汇总必须显式保留，不能用任务记录冒充全部账单。 */
export function executionCostBreakdown(projectId, period) {
  const rows = activityFor(projectId, period).map(execution => ({ execution, ...usageForRun(execution.id), documents: documentsFor(projectId,{runId:execution.id}).length }));
  const total = sumUsage(recordsFor(projectId,period)), traced = sumUsage(rows);
  return { rows, total, traced, otherCostMicros: total.costMicros-traced.costMicros };
}
/** 项目动态由可追溯的文档、AI 执行和验收节点组成；不会合成实际 Git 提交或发布记录。 */
export function timelineFor(projectId, filter = 'all') {
  const project = projectOf(projectId);
  const events = [
    ...documentsFor(projectId).map(item => ({ id: `document-${item.id}`, kind: 'document', at: item.updatedAt, author: item.author,
      title: `更新了「${item.title}」`, detail: `${item.version} · ${documentStates[item.status].label}`, documentId: item.id })),
    ...projectRuns(projectId).map(item => ({ id: item.id, kind: 'ai', at: item.updatedAt, author: modelOf(item.modelId).agent,
      title: taskOf(item.taskId).title, detail: `${runStates[item.state].label} · ${item.minutes} 分钟`, runId: item.id })),
    ...project.milestones.filter(item => item.state === 'accepted').map(item => ({ id: `milestone-${item.id}`, kind: 'milestone',
      at: `${item.date}T16:00:00+08:00`, author: project.owner, title: `验收通过「${item.title}」`, detail: '已计入总体进度', milestoneId: item.id }))
  ];
  return events.filter(item => filter === 'all' || item.kind === filter).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
/** 导出的是页面正在预览的演示正文，与实际项目资料明确区分。 */
export function documentMarkdown(document) {
  const project = projectOf(document.projectId);
  const responsibility=documentPeople[document.id];
  const lines = [`# ${document.title}`, '', '> Project Pulse 演示文档，不代表真实项目交付或验收结果。', '',
    `项目：${project.name}`, `版本：${document.version}`, `状态：${documentStates[document.status].label}`, `作者：${document.author}`,
    ...(responsibility?[`员工负责人：${employeeById(responsibility.ownerId).name}`,`内容确认人：${employeeById(responsibility.reviewerId).name}`]:[]),`更新时间：${document.updatedAt}`, ''];
  for (const section of document.sections) {
    lines.push(`## ${section.title}`, '');
    if (section.type === 'paragraph') lines.push(section.content);
    if (section.type === 'list') lines.push(...section.content.map(item => `- ${item}`));
    if (section.type === 'checklist') lines.push(...section.content.map(item => `- [${item.state === 'passed' ? 'x' : ' '}] ${item.title}${item.state === 'review' ? '（待确认）' : item.state === 'pending' ? '（待补充）' : ''}`));
    lines.push('');
  }
  return lines.join('\n');
}
