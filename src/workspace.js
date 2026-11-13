import { projects, runs } from './data.js';
import { documents, documentKinds, documentStates, projectProfiles, taskDetails } from './catalog.js';
import { icon } from './icons.js';
import { employeeById, employeeHref, employeeTaskOwner, documentOwner, documentReviewer } from './people-domain.js';
import { projectOwnerIds, riskOwnerIds } from './people-data.js';
import {
  escapeHtml as e, projectOf, taskOf, modelOf, projectTasks, projectRuns, currentExecutions, documentsFor, documentDigest,
  taskDigest, milestoneDigest, moduleRows, deliveryQueue, costAllocation, timelineFor, documentMarkdown,
  documentOf, money, tokens, relativeTime, shortDate, projectStates, runStates, usageForRun, executionCostBreakdown
} from './domain.js';

/** 每个入口共用同一份文档状态、来源和关联信息，预览不会另造一套数据。 */
export function documentBadge(status) {
  const state = documentStates[status];
  return `<span class="status-badge tone-${state.tone}">${state.label}</span>`;
}
export function timestamp(value) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Singapore', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
function noContent(title, text, symbol = 'document') {
  return `<div class="empty-state">${icon(symbol)}<strong>${e(title)}</strong><p>${e(text)}</p></div>`;
}
function documentSymbol(document) { const kind = documentKinds[document.kind]; return `<span class="document-symbol doc-tone-${kind.tone}">${icon(kind.icon)}</span>`; }
export function outputButtons(selected, compact = false) {
  return selected.map(document => `<button class="document-item ${compact ? 'is-compact' : ''}" data-open-document="${document.id}" aria-label="预览文档：${e(document.title)}">${documentSymbol(document)}<span class="document-item-copy"><strong>${e(document.title)}</strong><small>${e(projectOf(document.projectId).name)} <span>·</span> ${e(document.version)} <span>·</span> ${e(document.author)}</small>${compact ? '' : `<span class="document-item-summary">${e(document.summary)}</span>`}</span><span class="document-item-meta">${documentBadge(document.status)}<small>${timestamp(document.updatedAt)}</small></span>${icon('chevron')}</button>`).join('');
}
export function latestOutputs(projectId = null) {
  const outputs = documentsFor(projectId);
  const drafts = outputs.filter(output => output.status === 'draft').length;
  const href = projectId ? `#/projects/${projectId}?tab=documents` : '#/outputs';
  return `<section class="panel outputs-panel"><div class="panel-head"><h2 class="panel-title">${icon('document')}成果与文档</h2>${outputs.length > 1 ? `<a class="text-button" href="${href}">全部文档${icon('arrow')}</a>` : ''}</div><div class="output-counts"><span>文档 <strong>${outputs.length}</strong> 份</span><span>草稿 <strong>${drafts}</strong> 份</span></div><div class="document-item-list">${outputs.length === 1 ? outputButtons(outputs) : outputs.length ? '' : noContent('暂无产出文档', '')}</div></section>`;
}
export function executionPanel(projectId = null, selectedState = 'all', limit = 4) {
  const all = currentExecutions(projectId);
  const executions = currentExecutions(projectId, selectedState).slice(0, limit);
  return `<section class="panel execution-panel" data-execution-scope="${projectId || 'global'}"><div class="panel-head"><div><h2 class="panel-title">${icon('bot')}AI 工作现场</h2><p class="panel-kicker">${all.filter(item => item.state === 'running').length} 执行中 · ${all.filter(item => item.state === 'review').length} 待验收 · ${all.filter(item => item.state === 'blocked').length} 阻塞</p></div><label class="mini-select"><span class="sr-only">筛选 AI 执行状态</span><select data-execution-filter><option value="all">全部状态</option>${['running', 'review', 'blocked', 'idle'].map(key => `<option value="${key}" ${selectedState === key ? 'selected' : ''}>${runStates[key].label}</option>`).join('')}</select>${icon('down')}</label></div><div class="execution-grid">${executions.length ? executions.map(execution => {
    const task = taskOf(execution.taskId), model = modelOf(execution.modelId), consumption = usageForRun(execution.id);
    const completed = execution.steps.filter(step => step.state === 'done').length;
    const current = execution.steps.find(step => ['running', 'blocked', 'review'].includes(step.state));
    return `<button class="execution-card" data-open-run="${execution.id}" aria-label="查看${e(task.title)}的执行过程"><span class="execution-card-top"><span class="model-mark" style="--model-color:${model.color}">${e(model.mark)}</span><span class="execution-agent"><strong>${e(model.agent)}</strong><small>${e(model.name)}</small></span><span class="status-badge tone-${runStates[execution.state].tone}">${runStates[execution.state].label}</span></span><strong class="execution-title">${e(task.title)}</strong><span class="execution-project">${e(employeeTaskOwner(task.id).name)} 跟进 · ${e(projectOf(execution.projectId).name)} · ${taskDetails[task.id].module}</span><span class="execution-step-track" aria-label="${completed} / ${execution.steps.length} 步骤完成">${execution.steps.map(step => `<i class="is-${step.state}"></i>`).join('')}</span><span class="execution-current">${icon(execution.state === 'blocked' ? 'pause' : 'activity')}${e(current?.title || '工作已就绪，等待下一步')}</span><span class="execution-card-bottom"><span>${execution.minutes} 分钟 · ${completed}/${execution.steps.length} 步</span><strong>${money(consumption.costMicros)}</strong><span>${documentsFor(execution.projectId, { runId: execution.id }).length} 份产出${icon('chevron')}</span></span></button>`;
  }).join('') : noContent('当前没有匹配的 AI 任务', '切换状态查看其他执行，或等待安排新的工作。', 'bot')}</div></section>`;
}
export function deliveryFocus() {
  const attention = projects.filter(project => !['completed', 'on_track'].includes(project.status));
  return `<section class="panel attention-panel"><div class="panel-head"><h2 class="panel-title">${icon('warning')}需要你关注</h2><span class="section-count">${attention.length}</span></div>
    ${attention.map(project => `<a class="attention-item ${project.status === 'blocked' ? 'is-blocked' : ''}" href="#/projects/${project.id}"><span class="attention-mark">${icon('flag')}</span><span><strong>${e(project.name)}</strong><small>${projectStates[project.status].label}</small></span>${icon('chevron')}</a>`).join('') || noContent('暂无需要关注的项目', '')}
  </section>`;
}
export function allocationPanel(period) {
  const rows = costAllocation(period), maximum = Math.max(...rows.map(item => item.costMicros), 1);
  return `<section class="panel allocation-panel"><div class="panel-head"><div><h2 class="panel-title">${icon('layers')}项目投入分布</h2><p class="panel-kicker">相同时间范围下，各项目的 Token 与费用</p></div><span class="panel-unit">USD · 示例估算</span></div><div class="allocation-grid">${rows.map(item => `<a class="allocation-item accent-${item.project.accent}" href="#/projects/${item.project.id}?tab=usage"><span class="allocation-label"><strong>${e(item.project.name)}</strong><b>${money(item.costMicros)}</b></span><span class="progress-track"><span style="--progress:${item.costMicros / maximum * 100}%"></span></span><span class="allocation-foot"><span>输入 ${tokens(item.inputTokens)} / 输出 ${tokens(item.outputTokens)}</span><span>${item.share.toFixed(1)}%</span></span></a>`).join('')}</div></section>`;
}
export function executionCostPanel(projectId,period) {
  const breakdown=executionCostBreakdown(projectId,period);
  return `<section class="panel execution-cost-panel"><div class="panel-head"><div><h2 class="panel-title">${icon('token')}执行消耗明细 <span class="section-count">${breakdown.rows.length}</span></h2><p class="panel-kicker">按可追溯任务查看输入、输出、耗时与产出</p></div><span class="panel-unit">USD · 示例估算</span></div>${breakdown.rows.length?`<div class="execution-cost-head" aria-hidden="true"><span>任务 / AI 工具</span><span>耗时 / 产出</span><span>输入 Token</span><span>输出 Token</span><span>估算费用</span></div>${breakdown.rows.map(row=>{const model=modelOf(row.execution.modelId);return `<button class="execution-cost-row" data-open-run="${row.execution.id}" aria-label="查看${e(taskOf(row.execution.taskId).title)}的消耗明细"><span><strong>${e(taskOf(row.execution.taskId).title)}</strong><small>${e(model.agent)} · ${e(model.name)}</small></span><span>${row.execution.minutes} 分钟<small>${row.documents} 份关联文档</small></span><span>${tokens(row.inputTokens)}<small class="mobile-output-token">输出 ${tokens(row.outputTokens)}</small></span><span>${tokens(row.outputTokens)}</span><strong>${money(row.costMicros)}${icon('chevron')}</strong></button>`;}).join('')}`:noContent('所选时间内暂无可追溯执行','可以切换时间范围查看更早记录。','bot')}<div class="execution-cost-summary"><span>本期总计 <strong>${money(breakdown.total.costMicros)}</strong></span><span>上述执行 <strong>${money(breakdown.traced.costMicros)}</strong></span><span>其他历史汇总 <strong>${money(breakdown.otherCostMicros)}</strong></span></div></section>`;
}
export function projectBrief(project) {
  const profile = projectProfiles[project.id], taskSummary = taskDigest(project.id), docs = documentDigest(project.id);
  return `<section class="panel project-brief"><div class="panel-head"><h2 class="panel-title">${icon('target')}项目目标与范围</h2><span class="project-version">${e(profile.version)}</span></div><p class="project-context">${e(profile.context)}</p><dl class="brief-meta"><div><dt>项目负责人</dt><dd><span class="initial-avatar">${e(project.owner.slice(-1))}</span><a class="employee-inline-link" href="${employeeHref(projectOwnerIds[project.id],project.id)}">${e(project.owner)}</a></dd></div><div><dt>需求团队</dt><dd>${e(profile.sponsor)}</dd></div><div><dt>启动日期</dt><dd>${shortDate(profile.startDate)}</dd></div><div><dt>计划交付</dt><dd>${profile.targetDate ? shortDate(profile.targetDate) : '范围确认后规划'}</dd></div></dl><div class="outcomes-heading">预期交付结果</div><ul class="outcome-list">${profile.outcomes.map(outcome => `<li><span></span>${e(outcome)}</li>`).join('')}</ul><div class="brief-bottom"><span>${taskSummary.total} 项任务</span><span>${docs.total} 份文档</span><span>${docs.review} 份待确认</span></div></section>`;
}
export function workBreakdown(project) {
  return `<section class="panel work-breakdown"><div class="panel-head"><div><h2 class="panel-title">${icon('layers')}工作分解</h2><p class="panel-kicker">任务完成率按模块展示，总体进度仍以里程碑验收为准</p></div><button class="text-button" data-tab="board">查看任务${icon('arrow')}</button></div><div class="module-header" aria-hidden="true"><span>业务模块</span><span>执行中 / 待验收</span><span>产出</span><span>任务完成</span></div>${moduleRows(project.id).map(module => `<button class="module-row" data-task-module="${e(module.name)}" aria-label="查看${e(module.name)}模块任务"><strong>${e(module.name)}${module.blocked ? '<span class="tiny-warning">阻塞</span>' : ''}</strong><span>${module.doing} 执行中 <i>·</i> ${module.review} 待验收</span><span>${module.outputs} 份</span><span><span class="module-completion">${module.done}/${module.total}</span><span class="progress-track"><span style="--progress:${module.progress || 0}%"></span></span></span></button>`).join('')}</section>`;
}
export function projectTimeline(projectId, filter = 'all', limit = 30, compact = false) {
  const events = timelineFor(projectId, filter).slice(0, limit);
  return `<section class="panel timeline-panel" data-timeline-scope="${projectId}"><div class="panel-head"><div><h2 class="panel-title">${icon('history')}项目动态</h2><p class="panel-kicker">文档更新、执行记录与验收结果，按时间排列</p></div>${compact ? '<button class="text-button" data-tab="activity">全部动态' + icon('arrow') + '</button>' : `<label class="mini-select"><span class="sr-only">筛选项目动态</span><select data-timeline-filter>${[['all','全部动态'],['document','产出文档'],['ai','AI 执行'],['milestone','验收节点']].map(([key,label])=>`<option value="${key}" ${filter===key?'selected':''}>${label}</option>`).join('')}</select>${icon('down')}</label>`}</div><div class="timeline-list">${events.length ? events.map(event => `<button class="timeline-event" ${event.documentId ? `data-open-document="${event.documentId}"` : event.runId ? `data-open-run="${event.runId}"` : `data-open-milestone="${projectId}:${event.milestoneId}"`}><span class="timeline-event-symbol is-${event.kind}">${icon(event.kind === 'document' ? 'document' : event.kind === 'ai' ? 'bot' : 'flag')}</span><span class="timeline-event-body"><strong>${e(event.title)}</strong><small>${e(event.author)} · ${e(event.detail)}</small></span><time datetime="${e(event.at)}">${timestamp(event.at)}</time>${icon('chevron')}</button>`).join('') : noContent('还没有相关动态', '项目工作开始后，记录将在这里出现。', 'history')}</div></section>`;
}

export function documentFiltersFor(scope, filters) {
  return { ...filters, projectId: scope !== 'global' ? scope : filters.project && filters.project !== 'all' ? filters.project : null };
}
export function documentLibraryRows(scope, filters = {}) {
  const selected = documentFiltersFor(scope, filters);
  const items = documentsFor(selected.projectId, selected);
  if (!items.length) {
    return `${noContent('没有找到匹配的文档', '')}<button class="text-button document-reset" data-reset-documents>清除文档筛选${icon('arrow')}</button>`;
  }

  const groups = new Map();
  for (const document of items) {
    if (!groups.has(document.projectId)) groups.set(document.projectId, []);
    groups.get(document.projectId).push(document);
  }

  return [...groups].map(([projectId, documents]) => {
    const project = projectOf(projectId);
    const drafts = documents.filter(document => document.status === 'draft').length;
    return `<section class="document-project-group" aria-labelledby="document-group-${e(projectId)}">
      <div class="document-group-heading">
        <h3 id="document-group-${e(projectId)}">${e(project.name)}</h3>
        <span>${documents.length} 份文档</span><span>${drafts} 份草稿</span>
      </div>
      <div class="document-table-head" aria-hidden="true"><span>文档 / 类型</span><span>版本</span><span>产出方</span><span>更新于</span></div>
      <div class="document-table">${documents.map(document => {
        return `<button class="document-table-row" data-open-document="${document.id}" aria-label="预览文档：${e(document.title)}"><span class="document-table-name">${documentSymbol(document)}<span><strong>${e(document.title)}</strong><small>${documentKinds[document.kind].label}</small></span></span><span class="document-table-version"><b>${e(document.version)}${document.status === 'draft' ? documentBadge('draft') : ''}</b></span><span class="document-table-author">${icon(document.runId ? 'bot' : 'users')}<span>${e(document.author)}</span></span><span class="document-table-time">${timestamp(document.updatedAt)}${icon('chevron')}</span></button>`;
      }).join('')}</div>
    </section>`;
  }).join('');
}

export function documentLibrary(scope = 'global', filters = {}) {
  const selected = documentFiltersFor(scope, filters);
  const count = documentsFor(selected.projectId, selected).length;
  return `<section class="panel document-library" data-document-scope="${scope}"><div class="panel-head"><div><h2 class="panel-title">${icon('folder')}文档清单 <span class="section-count" data-document-count>${count}</span></h2></div></div><div class="document-toolbar"><label class="search-field">${icon('search')}<span class="sr-only">搜索产出文档</span><input type="search" data-document-filter="query" placeholder="搜索名称、内容或产出方…" maxlength="120" value="${e(filters.query || '')}"/></label>${scope === 'global' ? `<label class="mini-select"><span class="sr-only">筛选文档所属项目</span><select data-document-filter="project"><option value="all">全部项目</option>${projects.map(project => `<option value="${project.id}" ${filters.project === project.id ? 'selected' : ''}>${e(project.name)}</option>`).join('')}</select>${icon('down')}</label>` : ''}<label class="mini-select"><span class="sr-only">筛选文档类型</span><select data-document-filter="kind"><option value="all">全部类型</option>${Object.entries(documentKinds).map(([key,value])=>`<option value="${key}" ${filters.kind===key?'selected':''}>${value.label}</option>`).join('')}</select>${icon('down')}</label></div><div class="document-library-body">${documentLibraryRows(scope, filters)}</div></section>`;
}
export function documentPipeline(projectId = null) {
  const digest = documentDigest(projectId);
  return `<div class="document-pipeline" aria-label="文档确认状态分布">${[['draft','草稿',digest.draft],['review','待确认',digest.review],['approved','已确认',digest.approved]].map(([state,label,value],index)=>`<div class="pipeline-item"><span class="pipeline-step is-${state}">${icon(state==='approved'?'checkCircle':state==='review'?'clock':'pen')}</span><div><strong>${value}<small>份</small></strong><span>${label}</span></div>${index<2?icon('arrow'):''}</div>`).join('')}<div class="pipeline-note">文档确认与项目验收分别记录<br><strong>${digest.aiAuthored}</strong> 份可追溯到 AI 执行</div></div>`;
}
export function documentPreview(document, tab = 'preview') {
  const project = projectOf(document.projectId), kind = documentKinds[document.kind];
  const linkedMilestone = project.milestones.find(item => item.id === document.milestoneId);
  const size = (new TextEncoder().encode(documentMarkdown(document)).length / 1024).toFixed(1);
  const tabs = [['preview', '正文预览'], ['relations', '关联工作'], ['history', '版本记录']];
  return `<div class="eyebrow">${e(project.code)} · ${e(project.name)}</div><div class="drawer-badges"><span class="task-kind">${kind.label}</span>${documentBadge(document.status)}<span class="project-version">${e(document.version)}</span></div><h2 id="drawer-title">${e(document.title)}</h2><p class="drawer-description">${e(document.summary)}</p><div class="document-preview-meta"><span>${icon(document.runId?'bot':'users')}产出：${e(document.author)}</span><span>${icon('users')}负责：<a class="employee-inline-link" href="${employeeHref(documentOwner(document.id).id,project.id)}">${e(documentOwner(document.id).name)}</a></span><span>${icon('flag')}确认：<a class="employee-inline-link" href="${employeeHref(documentReviewer(document.id).id,project.id)}">${e(documentReviewer(document.id).name)}</a></span><span>${icon('clock')}${timestamp(document.updatedAt)}</span><span class="document-file-size">Markdown · ${size} KB</span><button class="button-secondary" data-download-document="${document.id}">${icon('download')}下载示例</button></div><div class="document-preview-tabs" role="tablist" aria-label="文档内容视图">${tabs.map(([key,label])=>`<button role="tab" id="document-tab-${key}" aria-selected="${tab===key}" aria-controls="document-preview-panel" tabindex="${tab===key?0:-1}" data-document-tab="${key}" class="${tab===key?'is-active':''}">${label}${key==='history'?`<span>${document.history.length}</span>`:''}</button>`).join('')}</div><div id="document-preview-panel" role="tabpanel" aria-labelledby="document-tab-${tab}">
    ${tab === 'preview' ? `<div class="document-reading-layout"><article class="document-article"><div class="document-demo-note">${icon('info')}示例文档 · 所有内容用于原型展示</div>${document.sections.map((section,index)=>`<section id="document-section-${index}"><h3><span>${String(index+1).padStart(2,'0')}</span>${e(section.title)}</h3>${section.type==='paragraph'?`<p>${e(section.content)}</p>`:section.type==='list'?`<ul>${section.content.map(item=>`<li>${e(item)}</li>`).join('')}</ul>`:`<div class="document-checklist">${section.content.map(item=>`<div class="document-check is-${item.state}"><span>${icon(item.state==='passed'?'checkCircle':item.state==='review'?'clock':'pause')}</span><p>${e(item.title)}</p><small>${{passed:'已核对',review:'待确认',pending:'待补充'}[item.state]}</small></div>`).join('')}</div>`}</section>`).join('')}</article><nav class="document-outline" aria-label="文档目录"><strong>本文目录</strong>${document.sections.map((section,index)=>`<button data-document-section="${index}">${String(index+1).padStart(2,'0')} ${e(section.title)}</button>`).join('')}<div><span>内容确认人</span><a class="employee-inline-link" href="${employeeHref(documentReviewer(document.id).id,project.id)}">${e(documentReviewer(document.id).name)}</a><small>${e(document.reviewer)}</small></div></nav></div>` : tab === 'relations' ? `<div class="document-relations"><section><h3>${icon('folder')}关联项目</h3><a class="relation-project" href="#/projects/${project.id}"><span class="project-symbol accent-${project.accent}">${icon(project.icon)}</span><span><strong>${e(project.name)}</strong><small>${e(project.goal)}</small></span>${icon('arrow')}</a></section><section><h3>${icon('flag')}关联里程碑</h3>${linkedMilestone?`<button class="relation-button" data-open-milestone="${project.id}:${linkedMilestone.id}"><span><strong>${e(linkedMilestone.title)}</strong><small>${shortDate(linkedMilestone.date)} · ${{accepted:'已验收',review:'待验收',planned:'计划中'}[linkedMilestone.state]}</small></span>${icon('chevron')}</button>`:'<p class="relation-empty">当前项目尚未规划里程碑。</p>'}</section><section><h3>${icon('board')}关联任务 <span class="section-count">${document.taskIds.length}</span></h3>${document.taskIds.length?document.taskIds.map(id=>`<button class="relation-button" data-open-task="${id}"><span><strong>${e(taskOf(id).title)}</strong><small>${e(taskDetails[id].module)} · ${e(taskOf(id).assignee)}</small></span>${icon('chevron')}</button>`).join(''):'<p class="relation-empty">该文档属于项目级资料，未关联具体任务。</p>'}</section><section><h3>${icon('bot')}产出来源</h3>${document.runId?`<button class="relation-button" data-open-run="${document.runId}"><span><strong>${e(document.author)} 的执行记录</strong><small>查看步骤、验证结论与消耗</small></span>${icon('chevron')}</button>`:`<p class="relation-empty">由 ${e(document.author)} 人工整理，内容确认人：${e(document.reviewer)}。</p>`}</section></div>` : `<div class="version-list">${document.history.map((version,index)=>`<div class="version-item"><span class="version-node ${index===0?'is-current':''}">${icon(index===0?'document':'history')}</span><div><div class="version-item-title"><strong>${e(version.version)}</strong>${index===0?'<span class="project-version">当前版本</span>':''}${documentBadge(version.status)}</div><p>${e(version.summary)}</p><small>${timestamp(version.date)} · ${e(version.author)}</small></div></div>`).join('')}</div>`}
  </div>`;
}
export function milestonePreview(projectId, milestoneId) {
  const project = projectOf(projectId), milestone = project.milestones.find(item => item.id === milestoneId);
  const relatedTasks = projectTasks(projectId).filter(item => item.milestoneId === milestoneId);
  const outputs = documentsFor(projectId, { milestoneId });
  const status = { accepted: ['已验收','green'], review:['待验收','amber'], planned:['计划中','muted'] }[milestone.state];
  return `<div class="eyebrow">${e(project.code)} · ${e(project.name)}</div><span class="status-badge tone-${status[1]}">${status[0]}</span><h2 id="drawer-title">${e(milestone.title)}</h2><p class="drawer-description">${milestone.state==='accepted'?'该节点已完成验收并计入总体进度。后续文档变更不会自动重新确认里程碑。':milestone.state==='review'?'该节点正在等待负责人验收。任务执行完成和文档确认分别展示，最终以节点验收结论为准。':'当前节点尚未验收，以下材料用于跟踪交付准备情况。'}</p><dl class="drawer-meta"><div><dt>计划 / 验收日期</dt><dd>${shortDate(milestone.date)}</dd></div><div><dt>负责人</dt><dd><a class="employee-inline-link" href="${employeeHref(projectOwnerIds[project.id],project.id)}">${e(project.owner)}</a></dd></div><div><dt>关联任务</dt><dd>${relatedTasks.filter(item=>item.column==='done').length} / ${relatedTasks.length} 已完成</dd></div><div><dt>交付文档</dt><dd>${outputs.filter(item=>item.status==='approved').length} / ${outputs.length} 已确认</dd></div></dl><section class="drawer-section"><h3>${icon('checkCircle')}验收检查项</h3><div class="document-checklist">${['交付范围与输入材料已确认','关联产出与执行记录齐备','验证结果与边界条件已复核','负责人确认本轮验收结论'].map((title,index)=>{const passed=milestone.state==='accepted'||milestone.state==='review'&&index<2;return `<div class="document-check is-${passed?'passed':milestone.state==='review'?'review':'pending'}">${icon(passed?'checkCircle':'clock')}<p>${title}</p><small>${passed?'已核对':milestone.state==='review'?'待确认':'待完成'}</small></div>`;}).join('')}</div></section><section class="drawer-section"><h3>${icon('document')}交付证据 <span class="section-count">${outputs.length}</span></h3>${outputs.length?outputButtons(outputs,true):noContent('暂无关联文档','文档产出后可与这个验收节点关联。')}</section><section class="drawer-section"><h3>${icon('board')}关联任务</h3>${relatedTasks.length?relatedTasks.map(task=>`<button class="relation-button" data-open-task="${task.id}"><span><strong>${e(task.title)}</strong><small>${taskDetails[task.id].module} · ${e(task.assignee)}</small></span>${icon('chevron')}</button>`).join(''):'<p class="relation-empty">这是项目级节点，暂未拆分为具体任务。</p>'}</section>`;
}
