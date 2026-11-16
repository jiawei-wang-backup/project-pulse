import { projects, tasks, runs, DEMO_NOW } from './data.js';
import {
  projectStates, runStates, columns, periodLabels, progressOf, nextMilestone, projectTasks, projectRuns, runningFor,
  modelOf, taskOf, projectOf, recordsFor, sumUsage, usageForRun, activityFor, trendFor, breakdownFor,
  filterProjects, overviewMetrics, routeFrom, money, tokens, shortDate, relativeTime, escapeHtml as e,
  documentsFor, documentOf, documentDigest, taskDigest, milestoneDigest, currentExecutions, documentMarkdown
} from './domain.js';
import { documentKinds, documentStates, projectProfiles, taskDetails } from './catalog.js';
import {
  outputButtons, latestOutputs, executionPanel, deliveryFocus, allocationPanel, projectBrief, projectTimeline,
  documentLibrary, documentLibraryRows, documentFiltersFor, documentPreview, milestonePreview, executionCostPanel
} from './workspace.js';
import { icon } from './icons.js';
import { sparkline, trendChart, modelBreakdown } from './charts.js';
import { employees, employeeById, employeeHref, employeeTaskOwner, employeeSummary, filteredEmployees, projectEmployees } from './people-domain.js';
import { projectOwnerIds, riskOwnerIds } from './people-data.js';
import { teamSnapshot, teamPage, teamRows, projectPeoplePanel, employeePage, employeeTabs, employeeTaskRows, employeeDocumentContent } from './people-views.js';

const app = document.querySelector('#app');
const drawerRoot = document.querySelector('#drawer-root');
const announcer = document.querySelector('#announcer');
const storageKey = 'project-pulse-view-v1';
/** 筛选与滚动仅保存在本机当前标签页，不包含任何真实业务数据。 */
let saved = {};
try { saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch { /* 隐私模式下仍可使用全部浏览交互。 */ }
const state = {
  period: [1, 7, 30].includes(saved?.period) ? saved.period : 7,
  search: typeof saved?.search === 'string' ? saved.search.slice(0, 120) : '',
  status: saved?.status === 'all' || Object.hasOwn(projectStates, saved?.status) ? saved.status : 'all',
  category: projects.some(project => project.category === saved?.category) ? saved.category : '',
  overviewScroll: Number.isFinite(saved?.overviewScroll) ? Math.max(0, saved.overviewScroll) : 0,
  // 文档筛选按全局 / 各项目分别保存，避免切换项目后继承另一个项目的筛选。
  documentFilters: saved?.documentFilters && typeof saved.documentFilters === 'object' ? saved.documentFilters : {},
  // 成员目录筛选可恢复；个人任务筛选按员工与项目视角分别保存于当前页面会话。
  teamFilters:{query:typeof saved?.teamFilters?.query==='string'?saved.teamFilters.query.slice(0,120):'',
    department:employees.some(item=>item.department===saved?.teamFilters?.department)?saved.teamFilters.department:'all',
    project:projectOf(saved?.teamFilters?.project)?saved.teamFilters.project:'all',
    work:['active','no_active'].includes(saved?.teamFilters?.work)?saved.teamFilters.work:'all'},
  personTaskFilters:{},personDocumentModes:{},taskOwnerFilters:{},
  executionFilters: {}, timelineFilters: {}, taskModules: {}, taskQueries: {}, navOpen: false, drawer: null
};
let currentRoute = routeFrom(location.hash);
let drawerOpener = null;
let drawerHistory = [];
let navOpener = null;
let focusSearchAfterRoute = false;
let pendingTabFocus = null;
let pendingEmployeeTabFocus = null;
let pendingRouteScroll = null;
history.scrollRestoration = 'manual';
if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/overview');

function persist() {
  try { sessionStorage.setItem(storageKey, JSON.stringify({ period: state.period, search: state.search, status: state.status, category: state.category, overviewScroll: state.overviewScroll, documentFilters: state.documentFilters,teamFilters:state.teamFilters })); }
  catch { /* 浏览器不允许持久化时，内存状态仍然有效。 */ }
}
function projectLink(project) { return `#/projects/${encodeURIComponent(project.id)}`; }
function statusBadge(key, kind = 'project') {
  const status = (kind === 'run' ? runStates : projectStates)[key];
  return `<span class="status-badge tone-${status.tone}">${status.label}</span>`;
}
function modelMark(model) { return `<span class="model-mark" style="--model-color:${model.color}">${e(model.mark)}</span>`; }
function periodControl() {
  return `<div class="period-control" role="group" aria-label="消耗与活动的统计时间">${icon('calendar')}${[1, 7, 30].map(period => `<button class="period-button ${state.period === period ? 'is-active' : ''}" data-period="${period}" aria-pressed="${state.period === period}">${periodLabels[period]}</button>`).join('')}</div>`;
}
function emptyState(iconName, title, description, className = '', action = '') {
  return `<div class="empty-state ${className}">${icon(iconName)}<strong>${e(title)}</strong><p>${e(description)}</p>${action}</div>`;
}
const projectTabs = [
  { id: 'overview', label: '项目概览', icon: 'grid' }, { id:'members',label:'项目成员',icon:'users' }, { id: 'board', label: '任务看板', icon: 'board' },
  { id: 'documents', label: '产出文档', icon: 'document' }, { id: 'usage', label: 'AI 消耗', icon: 'chart' },
  { id: 'activity', label: '项目动态', icon: 'history' }
];
function personScopeKey(){return `${currentRoute.employeeId}:${currentRoute.projectId||'all'}`;}
function refreshTeam(){
  const content=document.querySelector('#team-table-body');if(!content)return;
  content.innerHTML=teamRows(state.period,state.teamFilters);
  const count=filteredEmployees(state.teamFilters,state.period).length;document.querySelector('[data-team-count]').textContent=count;
  announcer.textContent=`找到 ${count} 位员工`;persist();
}
function updateTeamFilter(control){if(!['query','department','project','work'].includes(control.dataset.teamFilter))return;state.teamFilters={...state.teamFilters,[control.dataset.teamFilter]:control.value};refreshTeam();}
function refreshEmployeeTasks(){if(currentRoute.page!=='employee')return;const content=document.querySelector('#employee-task-content');if(content)content.innerHTML=employeeTaskRows(currentRoute.employeeId,currentRoute.projectId||null,state.personTaskFilters[personScopeKey()]||{});}
function setEmployeeTab(tab,focus=true){
  if(currentRoute.page!=='employee'||!employeeTabs.some(item=>item.id===tab))return;
  if((currentRoute.tab||'overview')===tab){if(focus)document.querySelector(`#person-tab-${tab}`)?.focus({preventScroll:true});return;}
  pendingRouteScroll=window.scrollY;pendingEmployeeTabFocus=focus?tab:null;
  location.hash=employeeHref(currentRoute.employeeId,currentRoute.projectId||null,tab);
}
function filtersFor(scope) {
  const savedFilters = state.documentFilters[scope] || {};
  return { query: typeof savedFilters.query === 'string' ? savedFilters.query.slice(0,120) : '',
    project: savedFilters.project === 'all' || projectOf(savedFilters.project) ? savedFilters.project : 'all',
    kind: Object.hasOwn(documentKinds, savedFilters.kind) ? savedFilters.kind : 'all',
    status: 'all' };
}
function refreshLibrary(scope) {
  const library = document.querySelector(`[data-document-scope="${scope}"]`);
  if (!library) return;
  const filters = filtersFor(scope), selected = documentFiltersFor(scope, filters);
  library.querySelector('.document-library-body').innerHTML = documentLibraryRows(scope, filters);
  const count = documentsFor(selected.projectId, selected).length;
  library.querySelector('[data-document-count]').textContent = count;
  announcer.textContent = `找到 ${count} 份产出文档`;
  persist();
}
function updateDocumentFilter(control) {
  const scope = control.closest('[data-document-scope]')?.dataset.documentScope;
  const key = control.dataset.documentFilter;
  if (!scope || !['query','project','kind','status'].includes(key)) return;
  state.documentFilters[scope] = {...filtersFor(scope),[key]:control.value};
  refreshLibrary(scope);
}
function refreshKanban() {
  if(currentRoute.page!=='project')return;
  const container=document.querySelector('#kanban-container');
  if(container){container.innerHTML=kanban(projectOf(currentRoute.projectId));announcer.textContent=`显示 ${container.querySelectorAll('.task-card').length} 个任务`;}
}
function setDocumentTab(tab) {
  if(state.drawer?.kind!=='document'||!['preview','relations','history'].includes(tab))return;
  state.drawer.documentTab=tab;renderDetail();
  drawerRoot.querySelector(`[data-document-tab="${tab}"]`)?.focus({preventScroll:true});
}
function downloadDocument(documentId,button) {
  const output=documentOf(documentId);if(!output)return;
  const blob=new Blob([documentMarkdown(output)],{type:'text/markdown;charset=utf-8'});
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=`${output.id}-${output.version}.md`;link.hidden=true;
  document.body.append(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  announcer.textContent=`已生成「${output.title}」的演示文档下载`;
  if(button){button.innerHTML=`${icon('check')}已开始下载`;window.setTimeout(()=>{if(button.isConnected)button.innerHTML=`${icon('download')}下载示例`;},2000);}
}
function sidebar() {
  const metrics = overviewMetrics(state.period);
  const total = metrics.costMicros;
  const breakdown = breakdownFor(null, state.period);
  return `<div class="nav-backdrop ${state.navOpen ? 'is-open' : ''}" data-close-nav></div>
    <aside class="sidebar ${state.navOpen ? 'is-open' : ''}" aria-label="工作空间导航">
      <a href="#/overview" class="brand" aria-label="Project Pulse 首页"><span class="brand-mark">${icon('pulse')}</span><span class="brand-name">Project Pulse<small>项目与 AI 工作台</small></span></a><button class="icon-button sidebar-close" data-close-nav aria-label="关闭导航">${icon('close')}</button>
      <nav aria-label="主要导航"><a href="#/overview" class="nav-main ${currentRoute.page === 'overview' ? 'is-active' : ''}" ${currentRoute.page === 'overview' ? 'aria-current="page"' : ''}>${icon('grid')}<span>总览</span><span class="nav-key">G</span></a>
      <a href="#/outputs" class="nav-main nav-outputs ${currentRoute.page === 'outputs' ? 'is-active' : ''}" ${currentRoute.page === 'outputs' ? 'aria-current="page"' : ''}>${icon('document')}<span>产出文档</span><span class="output-review-count">${documentDigest().review}</span></a>
      <a href="#/team" class="nav-main nav-people ${['team','employee'].includes(currentRoute.page)?'is-active':''}" ${['team','employee'].includes(currentRoute.page)?'aria-current="page"':''}>${icon('users')}<span>团队成员</span><span class="people-nav-count">${employees.length}</span></a>
      <div class="nav-section"><span>项目空间</span><span>06</span></div>
      <div class="project-nav">${projects.map(project => `<a href="${projectLink(project)}" class="${currentRoute.projectId === project.id ? 'is-active' : ''}" ${currentRoute.projectId === project.id ? 'aria-current="page"' : ''}><span class="accent-${project.accent}" style="color:var(--accent)">${icon(project.icon, 'nav-project-icon')}</span><span>${e(project.name)}</span><span class="nav-project-progress">${progressOf(project) === null ? '—' : `${progressOf(project)}%`}</span></a>`).join('')}</div></nav>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-usage"><div class="sidebar-usage-label"><span>${periodLabels[state.period]} AI 投入</span>${icon('bolt')}</div><div class="sidebar-usage-total"><strong>${money(total)}</strong><span>USD · 估算</span></div><div class="stacked-bar" aria-hidden="true">${breakdown.map(item => `<span style="width:${total ? item.costMicros / total * 100 : 0}%;--model-color:${item.color}"></span>`).join('')}</div><div class="sidebar-usage-foot">${tokens(metrics.inputTokens + metrics.outputTokens)} Token · 全部项目</div></div>
      <div class="workspace-user"><span class="avatar">P</span><div><strong>演示工作空间</strong><small>LOCAL PROTOTYPE</small></div><span class="local-dot" title="本地预览"></span></div>
    </aside>`;
}
function topbar(project = null) {
  const person=currentRoute.page==='employee'?employeeById(currentRoute.employeeId):null;
  const crumbs=person?`<a href="#/team">团队成员</a>${icon('chevron')}<span class="current">${e(person.name)}</span>`:currentRoute.page==='team'?'<span class="current">团队成员</span>':`<${project?'a href="#/overview"':'span class="current"'}>${currentRoute.page==='outputs'?'产出文档':'总览'}</${project?'a':'span'}>${project?`${icon('chevron')}<span class="current">${e(project.name)}</span>`:''}`;
  return `<header class="topbar"><div class="topbar-left"><button class="icon-button menu-toggle" data-toggle-nav aria-label="打开导航" aria-expanded="${state.navOpen}">${icon('menu')}</button><div class="breadcrumbs"><a href="#/overview">工作空间</a>${icon('chevron')}${crumbs}</div></div><div class="topbar-right"><button class="icon-button" data-about aria-label="关于此原型">${icon('info')}</button><span class="avatar" aria-hidden="true">P</span></div></header>`;
}
function pageFooter() { return `<footer class="page-footer"><span class="footer-brand">PROJECT PULSE <span aria-hidden="true">／</span> 看见进展，让投入有迹可循。</span><span>所有数据均为演示 · 费用为 USD 示例估算 · UTC+08:00</span></footer>`; }
function metric(label, value, unit, foot, iconName, className = '', extra = '') {
  return `<div class="metric ${className}"><div class="metric-label"><span>${label}</span>${icon(iconName)}</div><div class="metric-value ${className.includes('lime') ? 'is-lime' : ''}">${value}${unit ? `<small>${unit}</small>` : ''}</div><div class="metric-foot">${foot}</div>${extra}</div>`;
}
function renderOverviewMetrics() {
  const metrics = overviewMetrics(state.period);
  const docs = documentDigest(null, state.period);
  return `<div class="metric-grid portfolio-metrics" aria-label="工作空间摘要">
    ${metric('在研项目', metrics.active, `/ ${projects.length}`, '', 'folder')}
    ${metric('运行中的 Agent', metrics.running, '个', ``, 'bot')}
    ${metric('成果文档', docs.total, '份', '', 'document')}
    ${metric(`${periodLabels[state.period]}估算费用`, money(metrics.costMicros), '', `${tokens(metrics.inputTokens + metrics.outputTokens)} Token`, 'dollar', 'metric-with-spark lime', sparkline(trendFor(null, state.period)))}
  </div>`;
}
function projectCard(project) {
  const consumption = sumUsage(recordsFor(project.id, state.period));
  const outputs = documentsFor(project.id);
  const latest = outputs[0];
  return `<article class="project-card accent-${project.accent}">
    <div class="card-header"><span class="project-symbol">${icon(project.icon)}</span><div class="card-name"><h3><a href="${projectLink(project)}">${e(project.name)}</a></h3><p>${e(project.category)}</p></div>${statusBadge(project.status)}</div>
    ${milestoneNodes(project)}
    ${outputs.length > 1 ? `<a class="card-latest-output" href="#/projects/${project.id}?tab=documents">${icon('document')}<span>查看产出文档</span>${icon('chevron')}</a>` : latest ? `<button class="card-latest-output" data-open-document="${latest.id}">${icon('document')}<span>${e(latest.title)}</span></button>` : ''}
    <a class="card-footer" href="${projectLink(project)}"><div class="card-consumption"><span>${icon('token')}${tokens(consumption.inputTokens + consumption.outputTokens)}</span><span>${icon('dollar')}${money(consumption.costMicros)}</span></div><span class="card-card-link">进入看板${icon('arrow')}</span></a>
  </article>`;
}
function selectedProjects() {
  return filterProjects(state.search, state.status).filter(project => !state.category || project.category === state.category);
}
function projectCards() {
  const selected = selectedProjects();
  return selected.length ? selected.map(projectCard).join('') : emptyState('search', '没有找到匹配的项目', '换个关键词，或清除筛选查看全部项目。', 'projects-empty', '<button class="text-button" data-clear-filters>清除筛选' + icon('arrow') + '</button>');
}
function analytics(projectId = null) {
  const consumption = sumUsage(recordsFor(projectId, state.period));
  return `<div class="analytics-grid"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">消耗趋势</h2><p class="panel-kicker">${periodLabels[state.period]} · 按${state.period === 1 ? '小时' : '天'}汇总</p></div><span class="panel-unit"><span class="legend-dot" style="--model-color:#c9e76a;display:inline-block;margin-right:5px"></span>估算费用 · USD</span></div><div class="chart-summary"><strong>${money(consumption.costMicros)}</strong><span>输入 ${tokens(consumption.inputTokens)} / 输出 ${tokens(consumption.outputTokens)}</span></div>${trendChart(projectId, state.period, projectId ? 'project-usage' : 'overview-usage')}</section>
  <section class="panel"><div class="panel-head"><div><h2 class="panel-title">模型消耗分布</h2><p class="panel-kicker">所选时间范围内的费用占比</p></div>${icon('token')}</div>${modelBreakdown(projectId, state.period)}</section></div>`;
}
function activityPanel(projectId = null, limit = 6) {
  const selected = activityFor(projectId, state.period).slice(0, limit);
  return `<section class="panel activity-panel ${projectId ? 'project-activity' : ''}"><div class="panel-head"><div><h2 class="panel-title">近期 AI 活动 <span class="section-count">${activityFor(projectId, state.period).length}</span></h2><p class="panel-kicker">${periodLabels[state.period]}的执行摘要与产出</p></div><span class="panel-unit">相对于演示快照</span></div>${selected.length ? `<div class="activity-header" aria-hidden="true"><span>执行任务 / AI 工具</span><span class="activity-project">所属项目</span><span>状态</span><span>Token / 费用</span><span class="activity-time">最近更新</span></div><div class="activity-list">${selected.map(execution => {
    const task = taskOf(execution.taskId), project = projectOf(execution.projectId), model = modelOf(execution.modelId), consumption = usageForRun(execution.id);
    return `<button class="activity-row" data-open-run="${execution.id}" aria-label="查看${e(task.title)}的 AI 执行详情"><span class="activity-task">${modelMark(model)}<span style="min-width:0"><strong>${e(task.title)}</strong><small>${e(model.agent)} · ${e(model.name)}</small></span></span><span class="activity-project">${e(project.name)}</span><span>${statusBadge(execution.state, 'run')}</span><span class="activity-cost">${money(consumption.costMicros)}<small>${tokens(consumption.inputTokens + consumption.outputTokens)} Token</small></span><span class="activity-time">${relativeTime(execution.updatedAt)}</span></button>`;
  }).join('')}</div>` : emptyState('activity', '所选时间内暂无 AI 活动', '可以切换时间范围查看更早的执行记录。')}</section>`;
}
function overview() {
  return `<div class="page-heading"><div><div class="eyebrow">WORKSPACE OVERVIEW</div><h1>总览</h1></div><div class="heading-controls"><a class="button-secondary" href="#/outputs">${icon('document')}产出文档</a>${periodControl()}</div></div>
    ${renderOverviewMetrics()}
    ${teamSnapshot(state.period)}
    <section aria-labelledby="projects-heading"><div class="section-heading"><div><div class="section-title"><h2 id="projects-heading">项目空间</h2><span class="section-count" id="project-result-count">${selectedProjects().length}</span></div></div><div class="project-toolbar"><label class="search-field">${icon('search')}<span class="sr-only">搜索项目</span><input id="project-search" type="search" placeholder="搜索项目…" value="${e(state.search)}" maxlength="120" autocomplete="off"/><kbd aria-hidden="true">/</kbd></label><label class="select-wrap">${icon('sliders')}<span class="sr-only">筛选项目状态</span><select id="project-status"><option value="all">全部状态</option>${Object.entries(projectStates).map(([key, value]) => `<option value="${key}" ${state.status === key ? 'selected' : ''}>${value.label}</option>`).join('')}</select> ${icon('down', 'select-arrow')}</label><label class="select-wrap"><span class="sr-only">筛选业务分类</span><select id="project-category"><option value="">全部业务分类</option>${[...new Set(projects.map(project => project.category))].map(category => `<option value="${e(category)}" ${state.category === category ? 'selected' : ''}>${e(category)}</option>`).join('')}</select>${icon('down', 'select-arrow')}</label></div></div><div class="project-grid" id="project-grid">${projectCards()}</div></section>
    ${deliveryFocus()}<div class="execution-output-grid">${executionPanel(null,state.executionFilters.global||'all')}${latestOutputs()}</div>
    ${analytics()}${allocationPanel(state.period)}${activityPanel()}${pageFooter()}`;
}
function milestones(project) {
  return `<section class="panel"><div class="panel-head"><h2 class="panel-title">${icon('flag')}里程碑路线</h2></div>${milestoneNodes(project)}</section>`;
}
function milestoneNodes(project) {
  return `${project.milestones.length ? `<div class="milestones">${project.milestones.map((item, index) => `<button class="milestone is-${item.state}" data-open-milestone="${project.id}:${item.id}" aria-label="查看${e(item.title)}里程碑详情"><span class="milestone-dot">${item.state === 'accepted' ? icon('check') : item.state === 'review' ? icon('clock') : index + 1}</span><strong>${e(item.title)}</strong><small>${shortDate(item.date)}${item.state === 'review' ? ' · <span>待验收</span>' : item.state === 'accepted' ? ' · 已验收' : ''}</small></button>`).join('')}</div>` : '<p class="no-milestones">暂无节点</p>'}`;
}
function risks(project) {
  return `<section class="panel"><div class="panel-head"><h2 class="panel-title">${icon('warning')}待处理事项</h2><span class="section-count">${project.risks.length}</span></div>${project.risks.length ? project.risks.map(item => `<div class="risk-card ${item.level === 'blocked' ? 'is-blocked' : ''}"><h3>${icon(item.level === 'blocked' ? 'pause' : 'clock')}${e(item.title)}</h3><p>${e(item.detail)}</p><span class="risk-owner">${icon('users')}<a class="employee-inline-link" href="${employeeHref(riskOwnerIds[project.id],project.id)}">${e(employeeById(riskOwnerIds[project.id]).name)}</a><span> · ${e(item.owner)}</span></span></div>`).join('') : `<div class="risk-clear">${icon(project.status === 'planned' ? 'compass' : 'checkCircle')}<div>${project.status === 'planned' ? '等待项目范围确认' : '当前没有待处理风险'}<small>${project.status === 'planned' ? '项目仍在需求梳理阶段' : '所有待处理事项已闭环'}</small></div></div>`}</section>`;
}
function taskCard(task) {
  const related = projectRuns(task.projectId).find(execution => execution.taskId === task.id);
  const isAI = ['Codex', 'Claude Code', 'Gemini CLI'].includes(task.assignee);
  const details = taskDetails[task.id], outputs = documentsFor(task.projectId,{taskId:task.id}), owner=employeeTaskOwner(task.id);
  return `<button class="task-card ${task.blocked ? 'is-blocked' : ''}" data-open-task="${e(task.id)}" aria-label="查看任务：${e(task.title)}"><span class="task-code"><span>T-${task.id.split('-').at(-1).padStart(2, '0')}</span></span><strong>${e(task.title)}</strong><span class="task-kind">${e(details.module)}</span><span class="task-detail-stats"><span>${icon('checkCircle')}${details.checklist.filter(item=>item.state==='done').length}/${details.checklist.length}</span><span>${icon('document')}${outputs.length}</span><span>${details.dueDate?shortDate(details.dueDate):'待规划'}</span></span>${task.blocked ? `<span class="task-blocked-label">${icon('pause')}等待服务配额</span>` : ''}<span class="task-footer"><span class="task-human-owner">${icon('users')}${e(owner.name)}</span><span class="task-agent-label">${icon(isAI?'bot':'users')}${isAI?e(task.assignee.replace(' Code','').replace(' CLI','')):'人工'}</span>${related?.state === 'running' ? '<span class="activity-dot" style="width:4px;height:4px"></span>' : ''}<span class="mini-avatar" aria-hidden="true">${e(owner.name.slice(-1))}</span></span></button>`;
}
function kanban(project) {
  const query = (state.taskQueries[project.id] || '').trim().toLocaleLowerCase(), module = state.taskModules[project.id] || 'all';
  const owner=state.taskOwnerFilters[project.id]||'all';
  const allTasks = projectTasks(project.id).filter(task=>(module==='all'||taskDetails[task.id].module===module)&&(owner==='all'||employeeTaskOwner(task.id).id===owner)&&`${task.title} ${task.assignee} ${employeeTaskOwner(task.id).name} ${taskDetails[task.id].module}`.toLocaleLowerCase().includes(query));
  return `<div class="kanban" aria-label="${e(project.name)}任务看板">${columns.map(column => { const items = allTasks.filter(task => task.column === column.id); return `<section class="kanban-column column-${column.id}" aria-labelledby="column-${column.id}"><div class="column-title"><span class="column-dot"></span><h3 id="column-${column.id}">${column.label}</h3><span class="section-count">${items.length}</span></div>${items.length ? items.map(taskCard).join('') : '<div class="column-empty">暂无任务</div>'}</section>`; }).join('')}</div>`;
}
function taskToolbar(project) {
  return `<div class="task-toolbar"><span>按模块追踪任务、检查项与关联产出</span><label class="search-field">${icon('search')}<span class="sr-only">搜索项目任务</span><input data-task-search type="search" maxlength="120" placeholder="搜索任务或负责方…" value="${e(state.taskQueries[project.id]||'')}"/></label><label class="mini-select"><span class="sr-only">筛选任务模块</span><select id="task-module"><option value="all">全部模块</option>${projectProfiles[project.id].scope.map(module=>`<option value="${e(module)}" ${state.taskModules[project.id]===module?'selected':''}>${e(module)}</option>`).join('')}</select>${icon('down')}</label><label class="mini-select people-owner-select"><span class="sr-only">筛选任务负责人</span><select id="task-owner"><option value="all">全部负责人</option>${projectEmployees(project.id).map(member=>`<option value="${member.employee.id}" ${state.taskOwnerFilters[project.id]===member.employee.id?'selected':''}>${e(member.employee.name)}</option>`).join('')}</select>${icon('down')}</label></div>`;
}
function aiSidebar(project) {
  const current = projectRuns(project.id).filter(execution => ['running', 'review', 'blocked'].includes(execution.state));
  return `<aside class="panel ai-sidebar" aria-label="AI 当前执行情况"><div class="panel-head"><h2 class="panel-title">${icon('bot')}AI 正在做什么</h2><span class="section-count">${runningFor(project.id).length} 运行中</span></div>${current.length ? current.map(execution => {
    const model = modelOf(execution.modelId), task = taskOf(execution.taskId);
    const step = execution.steps.find(item => ['running', 'review', 'blocked'].includes(item.state));
    return `<div class="ai-live-card"><div class="ai-card-heading">${modelMark(model)}<div><strong>${e(model.agent)}</strong><small>${e(model.name)}</small></div>${statusBadge(execution.state, 'run')}</div><h3 class="ai-task-title">${e(task.title)}</h3><p class="ai-step-inline">${execution.state === 'running' ? '<span class="activity-dot"></span>' : icon(execution.state === 'blocked' ? 'pause' : 'clock')}${e(step?.title || '等待下一步')}</p><div class="ai-card-footer"><span>${execution.minutes} 分钟 · ${relativeTime(execution.updatedAt)}</span><button class="text-button" data-open-run="${execution.id}">查看过程${icon('arrow')}</button></div></div>`;
  }).join('') : emptyState('bot', project.status === 'planned' ? 'AI 尚未开始工作' : 'AI 当前空闲', project.status === 'planned' ? '确认项目范围后，再安排 AI 任务。' : '当前没有运行中或待处理的 AI 任务。', 'no-ai')}<p class="ai-aside-note">执行完成后仍需业务验收。AI 任务状态与项目验收进度分别展示。</p></aside>`;
}
function projectUsage(project) {
  const consumption = sumUsage(recordsFor(project.id, state.period));
  return `<div class="usage-detail">${icon('info')}<div><strong>${periodLabels[state.period]}的 AI 投入</strong><p>费用为独立演示估算，输入与输出 Token 分开统计；与总览采用相同口径。</p></div><div class="usage-stat">${periodLabels[state.period]}<span>截至 11月12日 10:30</span></div></div><div class="detail-stat-row">${metric('输入 Token', tokens(consumption.inputTokens), '', '请求上下文与输入内容', 'token')}${metric('输出 Token', tokens(consumption.outputTokens), '', '模型生成的输出内容', 'token')}${metric('估算费用', money(consumption.costMicros), '', 'USD · 示例估算', 'dollar', 'lime')}</div>${analytics(project.id)}${executionCostPanel(project.id,state.period)}`;
}
function projectPage(project) {
  const progress = progressOf(project), next = nextMilestone(project), consumption = sumUsage(recordsFor(project.id, state.period));
  const taskSummary = taskDigest(project.id), docs = documentDigest(project.id), profile = projectProfiles[project.id];
  const tab = currentRoute.tab || 'overview';
  let content;
  if (tab === 'overview') content = `<div class="project-pulse-row">${milestones(project)}${risks(project)}</div>${teamSnapshot(state.period,project.id)}${projectBrief(project)}<div class="execution-output-grid">${executionPanel(project.id,state.executionFilters[project.id]||'all')}${latestOutputs(project.id)}</div>${projectTimeline(project.id,'all',5,true)}`;
  else if(tab==='members')content=projectPeoplePanel(project.id,state.period);
  else if (tab === 'board') content = `${taskToolbar(project)}<div class="board-layout"><div id="kanban-container">${kanban(project)}</div>${aiSidebar(project)}</div>`;
  else if (tab === 'documents') content = `${documentLibrary(project.id,filtersFor(project.id))}`;
  else if (tab === 'usage') content = projectUsage(project);
  else content = projectTimeline(project.id,state.timelineFilters[project.id]||'all');
  return `<div class="page-heading project-page-heading"><div class="project-heading-main"><span class="project-symbol accent-${project.accent}">${icon(project.icon)}</span><div><div class="eyebrow">${e(project.code)} <span aria-hidden="true">/</span> ${e(project.category)}</div><h1>${e(project.name)}${statusBadge(project.status)}</h1><p class="page-description">${e(project.goal)}</p><div class="project-summary-meta"><span>${icon('users')}<a class="employee-inline-link" href="${employeeHref(projectOwnerIds[project.id],project.id)}">${e(project.owner)}</a> 负责</span><button class="member-count-link" data-tab="members">${projectEmployees(project.id).length} 位成员${icon('chevron')}</button><span>${icon('calendar')}${profile.targetDate?shortDate(profile.targetDate)+' 计划交付':'交付日期待规划'}</span><span>${next?'下一节点：'+e(next.title):project.status==='completed'?'全部节点已验收':'等待范围确认'}</span></div></div></div><div class="project-heading-aside"><label class="select-wrap project-select">${icon('folder')}<span class="sr-only">切换项目</span><select id="project-switch">${projects.map(item => `<option value="${item.id}" ${item.id === project.id ? 'selected' : ''}>${e(item.name)}</option>`).join('')}</select>${icon('down', 'select-arrow')}</label>${periodControl()}</div></div>
    <div class="metric-grid detail-metrics project-metrics">
      <div class="metric accent-${project.accent}"><div class="metric-label"><span>总体进度</span>${icon('flag')}</div><div class="metric-value">${progress === null ? '<span style="font-size:19px;color:var(--muted)">未规划</span>' : `${progress}<small>%</small>`}</div><div class="progress-track" role="progressbar" aria-label="总体里程碑验收进度${progress === null ? '，未规划' : ''}" ${progress === null ? '' : `aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"`}><span style="--progress:${progress || 0}%"></span></div><div class="metric-foot">${project.milestones.filter(item => item.state === 'accepted').length} / ${project.milestones.length} 里程碑已验收</div></div>
      ${metric('已完成任务',`${taskSummary.done}<small>/ ${taskSummary.total}</small>`,'',`${taskSummary.doing} 执行中 · ${taskSummary.review} 待验收`,'board')}
      ${metric('运行中的 Agent',runningFor(project.id).length,'个',`${currentExecutions(project.id,'review').length} 待验收 · ${currentExecutions(project.id,'blocked').length} 阻塞`,'bot')}
      ${metric('成果文档',docs.total,'份',`${docs.approved} 已确认 · ${docs.review} 待确认`,'document')}
      ${metric(`${periodLabels[state.period]} Token`, tokens(consumption.inputTokens + consumption.outputTokens), '', `输入 ${tokens(consumption.inputTokens)} / 输出 ${tokens(consumption.outputTokens)}`, 'token')}
      ${metric(`${periodLabels[state.period]}估算费用`, money(consumption.costMicros), '', `USD · ${periodLabels[state.period]}示例估算`, 'dollar', 'lime')}
    </div>
    <div class="board-section-header"><div class="view-tabs" role="tablist" aria-label="项目内容视图">${projectTabs.map(item=>`<button class="view-tab ${tab===item.id?'is-active':''}" data-tab="${item.id}" role="tab" id="tab-${item.id}" aria-selected="${tab===item.id}" aria-controls="project-tab-panel" tabindex="${tab===item.id?0:-1}">${icon(item.icon)}${item.label}${item.id==='board'?`<span>${taskSummary.total}</span>`:item.id==='documents'?`<span>${docs.total}</span>`:''}</button>`).join('')}</div><span class="board-helper">${e(profile.version)} · ${relativeTime(project.updatedAt)}更新</span></div>
    <div id="project-tab-panel" role="tabpanel" aria-labelledby="tab-${tab}">${content}</div>${pageFooter()}`;
}
function outputSummary() {
  const digest = documentDigest();
  return `<div class="metric-grid output-summary">${metric('文档总数', digest.total, '份', '', 'document')}${metric('草稿', digest.draft, '份', '', 'pen')}</div>`;
}
function outputsPage() {
  return `<div class="page-heading"><h1>产出文档</h1></div>${outputSummary()}${documentLibrary('global', filtersFor('global'))}${pageFooter()}`;
}
function render() {
  const project = currentRoute.page === 'project' ? projectOf(currentRoute.projectId) : null;
  const person=currentRoute.page==='employee'?employeeById(currentRoute.employeeId):null;
  let content;
  if(currentRoute.page==='overview')content=overview();
  else if(currentRoute.page==='outputs')content=outputsPage();
  else if(currentRoute.page==='team')content=teamPage(state.period,state.teamFilters,periodControl())+pageFooter();
  else if(person){content=employeePage(person.id,{period:state.period,tab:currentRoute.tab||'overview',projectId:currentRoute.projectId||null,periodMarkup:periodControl(),taskFilters:state.personTaskFilters[personScopeKey()]||{},documentMode:state.personDocumentModes[personScopeKey()]||'owned'})+pageFooter();}
  else if(project)content=projectPage(project);
  else content=emptyState('compass','当前页面暂时不存在','返回总览，查看工作空间中的项目、员工与产出。','','<a class="text-button" href="#/overview">返回总览'+icon('arrow')+'</a>');
  document.title = `${person?person.name:project ? project.name : currentRoute.page==='team'?'团队成员':currentRoute.page==='outputs'?'产出文档':'总览'} · Project Pulse`;
  app.innerHTML = `${sidebar()}<div class="content-shell">${topbar(project)}<main id="main-content" tabindex="-1">${content}</main></div>`;
  const activeTab=document.querySelector('main .view-tabs .is-active');
  if(activeTab){const strip=activeTab.parentElement;strip.scrollLeft=Math.max(0,activeTab.offsetLeft-strip.offsetLeft-strip.clientWidth/2+activeTab.offsetWidth/2);}
  syncNav(false);
}
function updateProjectResults() {
  document.querySelector('#project-grid').innerHTML = projectCards();
  const count = selectedProjects().length;
  document.querySelector('#project-result-count').textContent = count;
  announcer.textContent = `找到 ${count} 个项目`;
  persist();
}
function rememberOverview() {
  if (currentRoute.page === 'overview') { state.overviewScroll = window.scrollY; persist(); }
}
function setTab(tab, focus = true) {
  if (currentRoute.page !== 'project' || !projectTabs.some(item=>item.id===tab)) return;
  if ((currentRoute.tab||'overview')===tab) { if(focus) document.querySelector(`#tab-${tab}`)?.focus({preventScroll:true}); return; }
  pendingRouteScroll = window.scrollY;
  pendingTabFocus = focus ? tab : null;
  location.hash = `#/projects/${currentRoute.projectId}?tab=${tab}`;
}
function syncNav(focus = true) {
  const sidebarElement = document.querySelector('.sidebar');
  // 手机端收起的导航退出焦点顺序；切回桌面时重新启用，避免聚焦到屏幕外的入口。
  if(sidebarElement) sidebarElement.inert = !state.navOpen && window.innerWidth < 1024;
  sidebarElement?.classList.toggle('is-open', state.navOpen);
  document.querySelector('.nav-backdrop')?.classList.toggle('is-open', state.navOpen);
  document.querySelector('[data-toggle-nav]')?.setAttribute('aria-expanded', String(state.navOpen));
  document.body.classList.toggle('body-locked', state.navOpen || Boolean(state.drawer));
  const content = document.querySelector('.content-shell');
  if (content) content.inert = state.navOpen;
  if (state.navOpen) {
    sidebarElement?.setAttribute('role', 'dialog');
    sidebarElement?.setAttribute('aria-modal', 'true');
    if (focus) sidebarElement?.querySelector('a')?.focus();
  } else {
    sidebarElement?.removeAttribute('role'); sidebarElement?.removeAttribute('aria-modal');
    if (focus && navOpener?.isConnected) navOpener.focus();
  }
}

function drawerTemplate(task, execution) {
  const project = projectOf(task.projectId), model = execution ? modelOf(execution.modelId) : null;
  const consumption = execution ? usageForRun(execution.id) : { inputTokens: 0, outputTokens: 0, costMicros: 0 };
  const milestone = project.milestones.find(item => item.id === task.milestoneId);
  const taskState = columns.find(column => column.id === task.column);
  const details = taskDetails[task.id], outputs = documentsFor(project.id,{taskId:task.id}), owner=employeeTaskOwner(task.id);
  return `<div class="eyebrow">${e(project.code)} · ${e(project.name)}</div><div class="drawer-badges">${execution ? statusBadge(execution.state, 'run') : `<span class="status-badge tone-${task.column === 'review' ? 'amber' : task.column === 'doing' ? 'green' : 'muted'}">${taskState.label}</span>`}<span class="task-kind">${e(task.kind)}</span></div><h2 id="drawer-title">${e(task.title)}</h2>
    <dl class="drawer-meta"><div><dt>员工负责人 / 所属模块</dt><dd><a class="employee-inline-link" href="${employeeHref(owner.id,project.id)}">${e(owner.name)}</a> · ${e(details.module)}</dd></div><div><dt>执行方 / 模型</dt><dd>${e(task.assignee)} · ${model?e(model.name):['Codex','Claude Code','Gemini CLI'].includes(task.assignee)?'暂无 AI 执行记录':'人工执行'}</dd></div><div><dt>关联里程碑</dt><dd>${milestone ? `<button class="text-button" data-open-milestone="${project.id}:${milestone.id}">${e(milestone.title)}${icon('chevron')}</button>` : '暂未关联'}</dd></div><div><dt>计划完成</dt><dd>${details.dueDate?shortDate(details.dueDate):'待规划'}</dd></div><div><dt>任务检查项</dt><dd>${details.checklist.filter(item=>item.state==='done').length} / ${details.checklist.length} 已完成</dd></div><div><dt>执行耗时 / 最近更新</dt><dd>${execution?`${execution.minutes} 分钟 · ${relativeTime(execution.updatedAt)}`:relativeTime(details.updatedAt)}</dd></div></dl>
    <section class="drawer-section"><h3>${icon('board')}任务执行检查项</h3><div class="task-checklist">${details.checklist.map(item=>`<div class="document-check is-${item.state==='done'?'passed':item.state==='review'?'review':'pending'}">${icon(item.state==='done'?'checkCircle':item.state==='running'?'activity':'clock')}<p>${e(item.title)}</p><small>${{done:'已完成',running:'执行中',review:'待验收',pending:'未开始'}[item.state]}</small></div>`).join('')}</div></section>
    ${details.dependencyIds.length?`<section class="drawer-section"><h3>${icon('network')}前置任务</h3>${details.dependencyIds.map(id=>`<button class="relation-button" data-open-task="${id}"><span><strong>${e(taskOf(id).title)}</strong><small>${e(taskOf(id).assignee)} · ${columns.find(item=>item.id===taskOf(id).column).label}</small></span>${icon('chevron')}</button>`).join('')}</section>`:''}
    ${execution ? `<section class="drawer-section"><h3>${icon('activity')}执行步骤</h3><div class="execution-steps">${execution.steps.map((step, index) => `<div class="execution-step is-${step.state}"><span class="step-dot">${step.state === 'done' ? icon('check') : step.state === 'blocked' ? icon('pause') : step.state === 'review' ? icon('clock') : index + 1}</span><div>${e(step.title)}<small>${{ done: '已完成', running: '正在执行', review: '等待人工验收', blocked: '等待外部条件', pending: '尚未开始' }[step.state]}</small></div></div>`).join('')}</div></section>
      <section class="drawer-section"><h3>${icon('token')}本次执行消耗 <span class="panel-unit">USD · 示例估算</span></h3><div class="drawer-usage"><div><span>输入 Token</span><strong>${tokens(consumption.inputTokens)}</strong></div><div><span>输出 Token</span><strong>${tokens(consumption.outputTokens)}</strong></div><div><span>估算费用</span><strong>${money(consumption.costMicros)}</strong></div></div></section>` : `<section class="drawer-section">${emptyState('bot', '该任务暂无 AI 执行记录', '任务执行后，可在这里查看过程摘要、关联产出与消耗。')}</section>`}
    <section class="drawer-section"><h3>${icon('document')}关联产出文档 <span class="section-count">${outputs.length}</span></h3>${outputs.length?outputButtons(outputs,true):'<p class="relation-empty">当前任务尚未关联文档。</p>'}${execution?`<details class="execution-output-notes"><summary>执行产出摘要 · ${execution.outputs.length} 项</summary>${execution.outputs.map(output=>`<p>${e(output)}</p>`).join('')}</details>`:''}</section>`;
}
function openDrawer(taskId, runId, opener) {
  const execution = runId ? runs.find(item => item.id === runId) : projectRuns(taskOf(taskId)?.projectId).find(item => item.taskId === taskId);
  const task = taskOf(taskId || execution?.taskId);
  if (!task) return;
  openDetail({kind:'task',taskId:task.id,runId:execution?.id},opener);
}
function openDetail(descriptor, opener) {
  if (state.drawer && opener?.closest('.drawer') && !state.drawer.about) drawerHistory.push(state.drawer);
  else { drawerHistory = []; drawerOpener = opener; }
  state.drawer = descriptor;
  renderDetail();
}
function renderDetail() {
  const descriptor = state.drawer;
  let body, label, symbol;
  if (descriptor.kind==='document') {
    const document = documentOf(descriptor.documentId); if(!document)return;
    body = documentPreview(document,descriptor.documentTab||'preview'); label='产出文档';symbol='document';
  } else if(descriptor.kind==='milestone') { body=milestonePreview(descriptor.projectId,descriptor.milestoneId);label='里程碑与交付证据';symbol='flag'; }
  else { const execution=runs.find(item=>item.id===descriptor.runId);body=drawerTemplate(taskOf(descriptor.taskId),execution);label=execution?'AI 执行详情':'任务详情';symbol=execution?'bot':'board'; }
  drawerRoot.innerHTML = `<div class="drawer-backdrop" data-drawer-backdrop><section class="drawer ${descriptor.kind==='document'?'drawer-wide':''}" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-head">${drawerHistory.length?`<button class="icon-button drawer-back" data-drawer-back aria-label="返回上一层详情">${icon('back')}</button>`:icon(symbol)}<span>${label}</span><span class="demo-tag">演示</span><button class="icon-button" data-close-drawer aria-label="关闭详情">${icon('close')}</button></div><div class="drawer-content">${body}</div></section></div>`;
  app.inert = true;
  document.body.classList.add('body-locked');
  drawerRoot.querySelector('[data-close-drawer]')?.focus();
}
function openAbout(opener) {
  drawerOpener = opener; drawerHistory=[];state.drawer = { about: true };
  drawerRoot.innerHTML = `<div class="drawer-backdrop" data-drawer-backdrop><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-head">${icon('pulse')}<span>关于 Project Pulse</span><button class="icon-button" data-close-drawer aria-label="关闭说明">${icon('close')}</button></div><div class="drawer-content"><div class="eyebrow">MAKE PROGRESS VISIBLE</div><h2 id="drawer-title">让项目和 AI 的投入<br>都清晰可见。</h2><div class="about-copy"><p>这是一个可点击的本地原型，面向项目负责人和部门领导。所有项目、AI 活动、产出和费用均为<strong>演示数据</strong>。</p><ul><li><strong>进度</strong>＝已验收里程碑 ÷ 全部里程碑。AI 执行完成后，仍需业务验收。</li><li><strong>时间筛选</strong>影响消耗与历史活动，当前进度和运行状态独立展示。</li><li><strong>费用</strong>使用 USD 示例估算值，未接入账单，也不代表任何模型的实际报价。</li><li><strong>数据时间</strong>固定在 2026年11月12日 10:30（UTC+08:00），相对时间均以此为准。</li></ul><p>点击项目卡片进入看板，点击任务或 AI 活动查看详情。使用 <strong>/</strong> 搜索项目，<strong>G</strong> 返回总览，<strong>Esc</strong> 关闭详情。</p></div></div></section></div>`;
  app.inert = true; document.body.classList.add('body-locked');
  drawerRoot.querySelector('[data-close-drawer]')?.focus();
}
function closeDrawer(restoreFocus = true) {
  if (!state.drawer) return;
  state.drawer = null; drawerHistory=[];app.inert = false; drawerRoot.innerHTML = '';
  document.body.classList.toggle('body-locked', state.navOpen);
  if (restoreFocus && drawerOpener?.isConnected) drawerOpener.focus({ preventScroll: true });
  else if(restoreFocus) document.querySelector('main')?.focus({preventScroll:true});
}

document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (target.closest('.skip-link')) { event.preventDefault(); document.querySelector('main')?.focus(); document.querySelector('main')?.scrollIntoView(); return; }
  if (target.closest('[data-close-drawer]') || target.matches('[data-drawer-backdrop]')) { closeDrawer(); return; }
  const personTab=target.closest('[data-person-tab]');if(personTab){setEmployeeTab(personTab.dataset.personTab);return;}
  if(target.closest('[data-person-confirmations]')&&currentRoute.page==='employee'){state.personDocumentModes[personScopeKey()]='pending';setEmployeeTab('documents');return;}
  const personMode=target.closest('[data-person-document-mode]');
  if(personMode&&currentRoute.page==='employee'){
    const mode=personMode.dataset.personDocumentMode;if(!['owned','pending','all'].includes(mode))return;
    state.personDocumentModes[personScopeKey()]=mode;
    document.querySelector('#employee-document-content').innerHTML=employeeDocumentContent(currentRoute.employeeId,currentRoute.projectId||null,mode);
    document.querySelectorAll('[data-person-document-mode]').forEach(button=>{button.classList.toggle('is-active',button.dataset.personDocumentMode===mode);button.setAttribute('aria-pressed',String(button.dataset.personDocumentMode===mode));});return;
  }
  if(target.closest('[data-reset-team]')){state.teamFilters={query:'',department:'all',project:'all',work:'all'};document.querySelectorAll('[data-team-filter]').forEach(control=>{control.value=control.dataset.teamFilter==='query'?'':'all';});refreshTeam();document.querySelector('[data-team-filter="query"]')?.focus();return;}
  if(target.closest('[data-drawer-back]')){if(drawerHistory.length){state.drawer=drawerHistory.pop();renderDetail();}return;}
  const outputButton=target.closest('[data-open-document]');
  if(outputButton){if(documentOf(outputButton.dataset.openDocument))openDetail({kind:'document',documentId:outputButton.dataset.openDocument},outputButton);return;}
  const milestoneButton=target.closest('[data-open-milestone]');
  if(milestoneButton){const [projectId,milestoneId]=milestoneButton.dataset.openMilestone.split(':');if(projectOf(projectId)?.milestones.some(item=>item.id===milestoneId))openDetail({kind:'milestone',projectId,milestoneId},milestoneButton);return;}
  const documentTab=target.closest('[data-document-tab]');if(documentTab){setDocumentTab(documentTab.dataset.documentTab);return;}
  const download=target.closest('[data-download-document]');if(download){downloadDocument(download.dataset.downloadDocument,download);return;}
  const section=target.closest('[data-document-section]');if(section){drawerRoot.querySelector(`#document-section-${section.dataset.documentSection}`)?.scrollIntoView({block:'start',behavior:'auto'});return;}
  if(target.closest('[data-reset-documents]')){const library=target.closest('[data-document-scope]'),scope=library.dataset.documentScope;state.documentFilters[scope]={};library.querySelectorAll('[data-document-filter]').forEach(control=>{control.value=control.dataset.documentFilter==='query'?'':'all';});refreshLibrary(scope);library.querySelector('input')?.focus();return;}
  if(target.closest('[data-review-documents]')){state.documentFilters.global={query:'',project:'all',kind:'all',status:'review'};persist();if(currentRoute.page==='outputs')render();else{rememberOverview();location.hash='#/outputs';}return;}
  const moduleButton=target.closest('[data-task-module]');if(moduleButton&&currentRoute.page==='project'){state.taskModules[currentRoute.projectId]=moduleButton.dataset.taskModule;state.taskQueries[currentRoute.projectId]='';const anchor=document.querySelector('.board-section-header').getBoundingClientRect().top+window.scrollY-18;setTab('board');pendingRouteScroll=Math.max(0,anchor);return;}
  if (target.closest('[data-about]')) { openAbout(target.closest('[data-about]')); return; }
  if (target.closest('[data-toggle-nav]')) { navOpener = target.closest('[data-toggle-nav]'); state.navOpen = !state.navOpen; syncNav(); return; }
  if (target.closest('[data-close-nav]')) { state.navOpen = false; syncNav(); return; }
  const period = target.closest('[data-period]');
  if (period) {
    state.period = Number(period.dataset.period); rememberOverview(); persist();
    const scroll = window.scrollY; render(); window.scrollTo(0, scroll);
    document.querySelector(`[data-period="${state.period}"]`)?.focus({ preventScroll: true }); return;
  }
  const tab = target.closest('[data-tab]'); if (tab) { setTab(tab.dataset.tab); return; }
  const taskButton = target.closest('[data-open-task]'); if (taskButton) { openDrawer(taskButton.dataset.openTask, null, taskButton); return; }
  const runButton = target.closest('[data-open-run]'); if (runButton) { openDrawer(null, runButton.dataset.openRun, runButton); return; }
  if (target.closest('[data-clear-filters]')) { state.search = ''; state.status = 'all'; state.category = ''; document.querySelector('#project-category').value = ''; document.querySelector('#project-search').value = ''; document.querySelector('#project-status').value = 'all'; updateProjectResults(); document.querySelector('#project-search').focus(); return; }
  const internalLink=target.closest('a[href^="#/"]');
  if (internalLink) { rememberOverview();if(state.drawer)closeDrawer(false);state.navOpen = false;syncNav(false);if(internalLink.getAttribute('href')===location.hash)document.querySelector('main')?.focus({preventScroll:true}); }
});
document.addEventListener('input', event => {
  if(event.target.matches('[data-team-filter="query"]')){updateTeamFilter(event.target);return;}
  if(event.target.matches('[data-person-task-filter="query"]')&&currentRoute.page==='employee'){const key=personScopeKey();state.personTaskFilters[key]={...state.personTaskFilters[key],query:event.target.value};refreshEmployeeTasks();return;}
  if(event.target.matches('[data-document-filter="query"]')){updateDocumentFilter(event.target);return;}
  if(event.target.matches('[data-task-search]')&&currentRoute.page==='project'){state.taskQueries[currentRoute.projectId]=event.target.value;refreshKanban();return;}
  if (event.target.id === 'project-search') { state.search = event.target.value; updateProjectResults(); }
});
document.addEventListener('change', event => {
  if(event.target.matches('[data-team-filter]')){updateTeamFilter(event.target);return;}
  if(event.target.matches('[data-person-task-filter="status"]')&&currentRoute.page==='employee'){const key=personScopeKey();state.personTaskFilters[key]={...state.personTaskFilters[key],status:event.target.value};refreshEmployeeTasks();return;}
  if(event.target.id==='employee-project'&&currentRoute.page==='employee'){location.hash=employeeHref(currentRoute.employeeId,event.target.value==='all'?null:event.target.value,currentRoute.tab||'overview');return;}
  if(event.target.id==='task-owner'&&currentRoute.page==='project'){state.taskOwnerFilters[currentRoute.projectId]=event.target.value;refreshKanban();return;}
  if(event.target.matches('[data-document-filter]')){updateDocumentFilter(event.target);return;}
  if(event.target.matches('[data-execution-filter]')){const scope=event.target.closest('[data-execution-scope]').dataset.executionScope;state.executionFilters[scope]=event.target.value;const scroll=window.scrollY;render();window.scrollTo(0,scroll);document.querySelector('[data-execution-filter]')?.focus({preventScroll:true});return;}
  if(event.target.matches('[data-timeline-filter]')){state.timelineFilters[currentRoute.projectId]=event.target.value;const scroll=window.scrollY;render();window.scrollTo(0,scroll);document.querySelector('[data-timeline-filter]')?.focus({preventScroll:true});return;}
  if(event.target.id==='task-module'){state.taskModules[currentRoute.projectId]=event.target.value;refreshKanban();return;}
  if (event.target.id === 'project-category') { state.category = event.target.value; updateProjectResults(); }
  if (event.target.id === 'project-status') { state.status = event.target.value; updateProjectResults(); }
  if (event.target.id === 'project-switch') { location.hash = `#/projects/${encodeURIComponent(event.target.value)}`; }
});
window.addEventListener('hashchange', () => {
  closeDrawer(false); state.navOpen = false; currentRoute = routeFrom(location.hash); render();
  requestAnimationFrame(() => {
    window.scrollTo(0, pendingRouteScroll??(currentRoute.page === 'overview' ? state.overviewScroll : 0));pendingRouteScroll=null;
    if(currentRoute.documentId){openDetail({kind:'document',documentId:currentRoute.documentId},null);return;}
    if(pendingEmployeeTabFocus){document.querySelector(`#person-tab-${pendingEmployeeTabFocus}`)?.focus({preventScroll:true});pendingEmployeeTabFocus=null;}
    else if(pendingTabFocus){document.querySelector(`#tab-${pendingTabFocus}`)?.focus({preventScroll:true});pendingTabFocus=null;}
    else if (focusSearchAfterRoute) { focusSearchAfterRoute = false; document.querySelector('#project-search')?.focus(); }
    else document.querySelector('main')?.focus({ preventScroll: true });
  });
});
window.addEventListener('pagehide', rememberOverview);
window.addEventListener('resize', () => { if (window.innerWidth >= 1024) state.navOpen = false;syncNav(false); });
document.addEventListener('keydown', event => {
  // 模态抽屉和窄屏导航约束焦点，关闭后回到触发控件。
  if ((state.drawer || state.navOpen) && event.key === 'Tab') {
    const container = state.drawer ? document.querySelector('.drawer') : document.querySelector('.sidebar');
    const focusable = [...container.querySelectorAll('button, a[href], input, select, [tabindex="0"]')].filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    return;
  }
  if (event.key === 'Escape') { if (state.drawer) closeDrawer(); else if (state.navOpen) { state.navOpen = false; syncNav(); } return; }
  if(state.drawer?.kind==='document'&&event.target.matches('[data-document-tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const tabs=['preview','relations','history'],index=tabs.indexOf(event.target.dataset.documentTab);
    setDocumentTab(event.key==='Home'?tabs[0]:event.key==='End'?tabs.at(-1):tabs[(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length]);return;
  }
  if (state.drawer || state.navOpen) return;
  if(event.target.matches('[data-person-tab][role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const index=employeeTabs.findIndex(item=>item.id===event.target.dataset.personTab);
    setEmployeeTab(event.key==='Home'?employeeTabs[0].id:event.key==='End'?employeeTabs.at(-1).id:employeeTabs[(index+(event.key==='ArrowRight'?1:employeeTabs.length-1))%employeeTabs.length].id);return;
  }
  if (event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();const index=projectTabs.findIndex(item=>item.id===event.target.dataset.tab);const tab=event.key==='Home'?projectTabs[0].id:event.key==='End'?projectTabs.at(-1).id:projectTabs[(index+(event.key==='ArrowRight'?1:projectTabs.length-1))%projectTabs.length].id;setTab(tab);return;
  }
  if (event.target.matches('input, select, textarea, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === '/') { event.preventDefault(); if (currentRoute.page === 'overview') document.querySelector('#project-search')?.focus(); else { focusSearchAfterRoute = true; location.hash = '#/overview'; } }
  if (event.key.toLowerCase() === 'g') { event.preventDefault(); location.hash = '#/overview'; }
});
function showChartTooltip(event) {
  const point = event.target.closest?.('[data-chart-tip]');
  if (!point) return;
  const tooltip = point.closest('[data-chart-surface]').querySelector('.chart-tooltip');
  tooltip.textContent = point.dataset.chartTip; tooltip.hidden = false;
}
function hideChartTooltip(event) {
  const point = event.target.closest?.('[data-chart-tip]');
  if (point) point.closest('[data-chart-surface]').querySelector('.chart-tooltip').hidden = true;
}
document.addEventListener('pointerover', showChartTooltip);
document.addEventListener('focusin', showChartTooltip);
document.addEventListener('pointerout', hideChartTooltip);
document.addEventListener('focusout', hideChartTooltip);

render();
requestAnimationFrame(() => { if (currentRoute.page === 'overview') window.scrollTo(0, state.overviewScroll);if(currentRoute.documentId)openDetail({kind:'document',documentId:currentRoute.documentId},null); });
