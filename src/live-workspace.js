import { icon } from './icons.js';
import {researchProjectCount,memberProjectKeys,renderProjectDocuments,isRunningAgent,splitDeferredPanels,adaptiveColumnsClass} from './live-projects.js';

const themeRoot = document.documentElement;
themeRoot.dataset.theme = localStorage.getItem('pulse-theme') === 'dark' ? 'dark' : 'light';
const themeAction = () => themeRoot.dataset.theme === 'light' ? '切换深色' : '切换浅色';
let archived = false;
const app = document.querySelector('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const date = value => value ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Singapore',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const status = {on_track:'在研',blocked:'已阻塞',completed:'已完成',paused:'已暂停'};
const tone = {on_track:'green',blocked:'red',unknown:'muted',completed:'green',paused:'muted'};
const periods = {1:'今天',7:'近 7 天',30:'近 30 天'};
let days = Number(sessionStorage.getItem('pulse-days')) || 7;
if (!periods[days]) days = 7;
let data = null;
let loading = false;
let error = '';

function count(value) {
  if (value == null) return '—';
  const n = BigInt(value);
  if (n < 10000n) return n.toLocaleString('zh-CN');
  const yi = n >= 100000000n, base = yi ? 10000000n : 1000n;
  const rounded = (n + base / 2n) / base;
  return `${(rounded / 10n).toLocaleString('zh-CN')}${rounded % 10n ? '.' + rounded % 10n : ''} ${yi ? '亿' : '万'}`;
}
function projectName(name) { return (name || '').split('/').at(-1) || '未关联项目'; }
function workspaceRepository(workspace) {
  if (workspace !== '监控面板') return '';
  return data.projects.find(project => project.full_name.toLowerCase() === 'jiawei-wang-dev/project-pulse')?.full_name || '';
}
function projectKey(row) {
  if (row.full_name) return row.full_name;
  if (row.agent_id && row.session_id) {
    const session=data.sessions.find(item=>item.session_id===row.session_id);
    if (session) return projectKey(session);
  }
  const workspace = row.workspace_name || '';
  const repository = workspaceRepository(workspace);
  if (repository) return repository;
  const normalized = value => String(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const folder = normalized(workspace);
  const matchingFolder = data.projects.find(project=>folder && normalized(project.full_name.split('/').at(-1))===folder);
  if (matchingFolder) return matchingFolder.full_name;
  const context = normalized([row.title,row.display_title,row.summary].filter(Boolean).join(' '));
  const matchingContext = data.projects.filter(project=>{
    const name=normalized(project.full_name.split('/').at(-1));
    return name.length>=8 && context.includes(name);
  });
  return matchingContext.length===1 ? matchingContext[0].full_name : workspace;
}
function safeGithub(value) {
  try { const url = new URL(value); return url.origin === 'https://github.com' ? url.href : ''; } catch { return ''; }
}
function section(title, body, extra='') { return `<section class="panel live-panel"><div class="panel-head"><h2 class="panel-title">${title}</h2>${extra}</div>${body}</section>`; }
function empty(label='暂无数据') { return `<p class="live-empty">${esc(label)}</p>`; }
function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash.startsWith('/projects/')) return {page:'project',key:workspaceRepository(hash.slice('/projects/'.length)) || hash.slice('/projects/'.length)};
  if (hash.startsWith('/team/')) return {page:'member',name:hash.slice('/team/'.length)};
  if (['/team','/outputs','/sessions'].includes(hash)) return {page:hash.slice(1)};
  return {page:'overview'};
}
function allocationProjectKey(key) {
  const repository = workspaceRepository(key);
  if (repository) return repository;
  if (data.projects.some(project => project.full_name === key)) return key;
  const matches = data.sessions.filter(session => session.workspace_name === key).map(projectKey).filter(Boolean);
  return matches.length && matches.every(match => match === matches[0]) ? matches[0] : key;
}
function allProjects() {
  const map = new Map(data.projects.map(item=>[item.full_name,{...item}]));
  for(const row of data.memberships||[]) if(projectKey(row) && !map.has(projectKey(row))) map.set(projectKey(row),{full_name:projectKey(row),business_category:'本地工作区',status:'unknown',local:true});
  for (const row of data.sessions) if (projectKey(row) && !map.has(projectKey(row))) map.set(projectKey(row),{full_name:projectKey(row),business_category:'本地工作区',status:'unknown',local:true});
  for (const row of data.project_reports||[]) {
    const key = workspaceRepository(row.project_key) || row.project_key;
    if (!map.has(key)) map.set(key,{full_name:key,business_category:'本地工作区',status:'unknown',local:true});
  }
  for (const row of data.project_usage || []) {
    if (!row.project_key) continue;
    const key = allocationProjectKey(row.project_key);
    if (!map.has(key)) map.set(key, {full_name:key,business_category:'本地工作区',status:'unknown',local:true});
  }
  for (const row of data.workspace_states || []) {
    const key = workspaceRepository(row.workspace_name) || row.workspace_name;
    const project = map.get(key);
    if (project?.status === 'unknown') project.status = row.status;
    else if (!project) map.set(key, {full_name:key,business_category:'本地工作区',status:row.status,local:true});
  }
  return [...map.values()];
}
function reportFor(key) { return (data.project_reports||[]).find(row=>row.project_key===key) || (data.project_reports||[]).find(row=>workspaceRepository(row.project_key)===key); }
function milestoneCard(key) {
  const report=reportFor(key);
  if (!report) return `<div class="live-goal-line">项目目标待总结</div><div class="milestones live-milestones"><div class="milestone is-pending"><span class="milestone-dot">1</span><strong>等待项目总结</strong><small>未完成</small></div></div>`;
  return `<div class="live-goal-line" title="${esc(report.goal)}">${esc(report.goal)}</div><div class="milestones live-milestones" aria-label="项目里程碑">${report.milestones.map((item,index)=>`<div class="milestone is-${item.state==='completed'?'accepted':'pending'}" title="${esc(item.evidence)}"><span class="milestone-dot">${item.state==='completed'?icon('check'):index+1}</span><strong>${esc(item.title)}</strong><small>${item.state==='completed'?'已完成':'未完成'}</small></div>`).join('')}</div>`;
}
function milestonePanel(key) {
  const report=reportFor(key);
  if (!report) return section(`${icon('flag')}项目里程碑`,empty('暂无项目总结；Codex 下次上报时会整理项目目标、已完成项与未完成项'));
  const completed=report.milestones.filter(item=>item.state==='completed').length;
  return section(`${icon('flag')}项目里程碑`,`<div class="live-goal"><span>项目目标</span><strong>${esc(report.goal)}</strong><small>更新于 ${date(report.observed_at)} · ${esc(report.summarizer_tool)}</small></div><div class="live-project-route"><div class="milestones">${report.milestones.map((item,index)=>`<div class="milestone is-${item.state==='completed'?'accepted':'pending'}"><span class="milestone-dot">${item.state==='completed'?icon('check'):index+1}</span><strong>${esc(item.title)}</strong><small>${item.state==='completed'?'已完成':'未完成'}</small></div>`).join('')}</div></div><div class="live-milestone-summary"><span>${completed} 项已完成</span><span>${report.milestones.length-completed} 项未完成</span></div><div class="live-milestone-list">${report.milestones.map((item,index)=>`<article class="live-milestone-item ${item.state==='completed'?'is-done':''}"><span class="live-milestone-node">${item.state==='completed'?icon('check'):index+1}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.evidence)}</p></div><span class="status-badge tone-${item.state==='completed'?'green':'muted'}">${item.state==='completed'?'已完成':'未完成'}</span></article>`).join('')}</div>`);
}
function side() {
  const current=route(), selected=key=>current.page==='project'&&current.key===key;
  return `<aside class="sidebar" id="sidebar"><div class="brand"><span class="brand-mark">${icon('pulse')}</span><span class="brand-name">Project Pulse<small>工作台</small></span></div>
    <a class="nav-main ${current.page==='overview'?'is-active':''}" href="#/overview">${icon('grid')}总览</a>
    <a class="nav-main ${current.page==='sessions'?'is-active':''}" href="#/sessions">${icon('activity')}会话</a>
    <a class="nav-main ${current.page==='outputs'?'is-active':''}" href="#/outputs">${icon('document')}产出文档</a>
    <a class="nav-main ${['team','member'].includes(current.page)?'is-active':''}" href="#/team">${icon('users')}团队成员</a>
    <div class="nav-section"><span>项目空间</span><span>${allProjects().length}</span></div>
    <nav class="project-nav">${allProjects().map(item=>`<a class="${selected(item.full_name)?'is-active':''}" href="#/projects/${encodeURIComponent(item.full_name)}">${icon('folder')}<span class="live-nav-name">${esc(projectName(item.full_name))}</span></a>`).join('')}</nav>
    <div class="sidebar-spacer"></div>${sidebarUsage(data.models || [])}<div class="workspace-user"><span class="avatar">P</span><div><strong>真实数据</strong><small>新加坡时间</small></div><span class="local-dot"></span></div></aside>`;
}
function topbar(title) { return `<div class="topbar"><div class="breadcrumbs"><button class="icon-button live-menu" id="menu" aria-label="打开导航">${icon('menu')}</button><a href="#/overview">工作空间</a>${icon('chevron')}<span class="current">${esc(title)}</span></div><div class="topbar-right">${data?.imported_at ? '<button class="button-secondary" id="archive-switch">' + (archived ? '返回实时' : '历史快照') + '</button>' : ''}<button class="button-secondary" id="theme-switch">${themeAction()}</button><button class="button-secondary" id="refresh">刷新</button></div></div>`; }
function heading(title, period=true) { return `<div class="page-heading"><div><h1>${esc(title)}</h1></div>${period?`<div class="period-control" role="group" aria-label="统计时间">${icon('calendar')}${[1,7,30].map(value=>`<button class="period-button ${days===value?'is-active':''}" data-days="${value}" aria-pressed="${days===value}">${periods[value]}</button>`).join('')}</div>`:''}</div>`; }
function metric(label, value, mark='grid', lime=false, {unit='', foot=''}={}) {
  return `<div class="metric">
    <div class="metric-label"><span>${esc(label)}</span>${icon(mark)}</div>
    <div class="metric-value ${lime?'is-lime':''}">${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
    ${foot ? `<div class="metric-foot">${esc(foot)}</div>` : ''}
  </div>`;
}
function projectCards(items) {
  if (!items.length) return empty('暂无项目');
  return `<div class="project-grid live-project-grid">${items.map((item,index)=>{
    const countSessions=data.sessions.filter(row=>projectKey(row)===item.full_name).length;
    const countPulls=data.pulls.filter(row=>row.full_name===item.full_name).length;
    const href=`#/projects/${encodeURIComponent(item.full_name)}`;
    return `<article class="project-card accent-${['lime','blue','purple','orange','teal'][index%5]}"><div class="card-header"><span class="project-symbol">${icon('folder')}</span><div class="card-name"><h3><a href="${href}">${esc(projectName(item.full_name))}</a></h3><p>${item.local ? '本地工作区' : item.repositories?.length>1 ? `已关联 ${item.repositories.length} 个 GitHub 仓库` : '已关联 GitHub 仓库'}</p></div>${status[item.status] ? `<span class="status-badge tone-${tone[item.status]||'muted'}">${status[item.status]}</span>` : ''}</div>${milestoneCard(item.full_name)}<div class="live-card-counts"><span>${countSessions} 个会话</span><span>${countPulls} 份 PR</span></div><a class="card-footer" href="${href}"><span>${esc(item.full_name)}</span><span class="card-card-link">进入看板 ${icon('arrow')}</span></a></article>`;
  }).join('')}</div>`;
}
function sessionRows(items,showProject=true) {
  if (!items.length) return empty('暂无会话');
  return `<div class="live-list">${items.map(row=>`<article class="live-session"><div class="live-session-main"><strong>${esc(row.display_title || row.title || '未命名会话')}</strong><p>${esc(row.summary && row.summary !== '观测到一轮 Codex 任务结束。' ? row.summary : '暂无工作摘要')}</p></div><div class="live-session-meta"><span>${esc(row.display_name)}</span>${showProject?`<span>${esc(projectName(projectKey(row)))}</span>`:''}<span>${esc(row.tool_id || '—')}</span><time>${date(row.last_activity_at)}</time></div></article>`).join('')}</div>`;
}
function sessionGroups(items) {
  if (!items.length) return empty('暂无会话');
  const groups=new Map();
  for (const row of items) {
    const key=projectKey(row)||'';
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  return `<div class="live-session-groups">${[...groups].map(([key,rows],index)=>`<details class="live-session-group" ${index===0?'open':''}><summary><span class="live-session-group-name">${icon('folder')}<strong>${esc(key?projectName(key):'未关联项目')}</strong><span class="section-count">${rows.length}</span></span><span class="live-session-group-latest">最近活动 ${date(rows[0].last_activity_at)}</span>${icon('down','live-session-group-chevron')}</summary>${sessionRows(rows,false)}</details>`).join('')}</div>`;
}
function pulls(items) {
  if (!items.length) return empty('暂无 PR');
  return renderProjectDocuments(items,{esc,icon,date,projectName,safeGithub});
}
function modelRows() {
  if (!data.models.length) return empty('暂无模型消耗');
  const rows = data.models.map(row => `<tr>
    <th scope="row"><div class="live-model-identity">
      <span class="live-model-mark">${icon('token')}</span>
      <span><strong>${esc(row.model || '未知模型')}</strong><small>${esc(row.provider || '未知提供商')}</small></span>
    </div></th>
    <td>${count(row.input_tokens)}</td>
    <td>${count(row.cached_input_tokens)}</td>
    <td>${count(row.output_tokens)}</td>
  </tr>`).join('');
  return `<div class="live-table-wrap live-model-wrap">
    <table class="live-table live-model-table">
      <thead><tr><th scope="col">模型 / 提供商</th><th scope="col">输入 Token</th><th scope="col">缓存输入</th><th scope="col">输出 Token</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
function peopleRows(items=data.people) {
  if (!items.length) return empty('暂无成员');
  const rows = items.map(row => {
    const projects = memberProjects(row.display_name);
    return `<tr>
      <th scope="row"><a class="live-member-identity" href="#/team/${encodeURIComponent(row.display_name)}">
        <span class="live-member-mark">${icon('users')}</span><strong>${esc(row.display_name)}</strong>
      </a></th>
      <td>${row.tool_id ? `<span class="live-member-tool">${esc(row.tool_id)}</span>` : '—'}</td>
      <td><div class="live-member-projects">${projects.length ? projects.map(key =>
        `<a href="#/projects/${encodeURIComponent(key)}">${esc(projectName(key))}</a>`
      ).join('') : '<span>未关联</span>'}</div></td>
      <td>${date(row.last_activity_at)}</td>
      <td>${date(row.last_seen_at)}</td>
    </tr>`;
  }).join('');
  return `<div class="live-table-wrap live-model-wrap">
    <table class="live-table live-member-table">
      <thead><tr><th scope="col">姓名</th><th scope="col">开发工具</th><th scope="col">项目</th><th scope="col">最近活动</th><th scope="col">设备同步</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
function memberProjects(name,key='') {
  return memberProjectKeys(data,name,projectKey,key);
}
function teamCards(key='') {
  const members=data.people.filter(person=>!key || memberProjects(person.display_name,key).length ||
    data.sessions.some(session=>session.display_name===person.display_name && projectKey(session)===key));
  return `<section class="panel team-snapshot live-team-snapshot"><div class="panel-head"><h2 class="panel-title">${icon('users')}${key?'项目成员':'团队协作'} <span class="section-count">${members.length}</span></h2>${route().page==='team'?'':`<a class="text-button" href="#/team">查看团队 ${icon('arrow')}</a>`}</div>${members.length?`<div class="live-team-grid">${members.map((person,index)=>{
    const name=person.display_name||'未命名成员';
    const projects=memberProjects(name,key);
    const active=runningAgents(key).filter(agent=>agent.display_name===name).length;
    const initials=name.trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase();
    return `<a class="live-team-card accent-${['lime','orange','blue','purple','teal'][index%5]}" href="#/team/${encodeURIComponent(name)}"><span class="person-avatar" aria-hidden="true">${esc(name.trim().slice(-1))}<small>${esc(initials)}</small></span><div class="live-team-name"><strong>${esc(name)}</strong><small>${esc(person.tool_id||'开发工具待上报')}</small></div><div class="live-team-stats"><strong>${projects.length} 个项目</strong><small>${active?`${active} 智能助手 运行中`:'查看工作详情'}</small></div><div class="live-team-projects">${projects.length?projects.map(project=>`<span>${esc(projectName(project))}</span>`).join(''):'<span>项目待关联</span>'}</div></a>`;
  }).join('')}</div>`:empty('暂无团队成员')}</section>`;
}
function agentCards(items) {
  if (!items.length) return empty('目前没有运行中的 智能助手');
  return `<div class="live-agent-grid">${items.map(row=>`<article class="live-agent-card"><div class="live-agent-top"><span class="model-mark" style="--model-color:var(--lime)">${esc((row.tool_id||'A').slice(0,1).toUpperCase())}</span><div><strong>${esc(row.tool_id||'开发工具')} · ${esc(row.kind==='subagent'?'子助手':'主助手')}</strong><small>${esc(row.model||'模型未知')}</small></div><span class="status-badge tone-green">运行中</span></div><h3>${esc(row.display_title||row.title||'未命名会话')}</h3><p>${esc(row.display_name)} · ${esc(projectName(projectKey(row)))}</p><time>${date(row.last_activity_at)}</time></article>`).join('')}</div>`;
}
function runningAgents(key='') {
  return (data.agent_details||[]).filter(row=>isRunningAgent(row) && (!key||projectKey(row)===key));
}
function activityPanel(key='') {
  const rows=data.sessions.filter(row=>!key||projectKey(row)===key).slice(0,6);
  const usage=new Map((data.session_usage||[]).map(row=>[row.session_id,BigInt(row.input_tokens||0)+BigInt(row.output_tokens||0)]));
  return `<section class="panel activity-panel live-activity-panel"><div class="panel-head"><h2 class="panel-title">近期 AI 活动 <span class="section-count">${rows.length}</span></h2><a class="text-button" href="#/sessions">全部会话 ${icon('arrow')}</a></div>${rows.length?`<div class="activity-header"><span>会话 / 开发工具</span><span class="activity-project">所属项目</span><span>状态</span><span>Token</span><span class="activity-time">最近更新</span></div><div class="activity-list">${rows.map(row=>{
    const agent=(data.agent_details||[]).find(item=>item.session_id===row.session_id);
    const running=isRunningAgent(agent);
    const used=usage.get(row.session_id);
    return `<div class="activity-row"><span class="activity-task"><span class="model-mark" style="--model-color:var(--lime)">${esc((row.tool_id||'A').slice(0,1).toUpperCase())}</span><span><strong title="${esc(row.display_title||row.title||'未命名会话')}">${esc(row.display_title||row.title||'未命名会话')}</strong><small>${esc(row.tool_id||'开发工具')} · ${esc(row.display_name||'')}</small></span></span><span class="activity-project">${esc(projectName(projectKey(row)))}</span><span class="status-badge tone-${running?'green':'muted'}">${running?'运行中':'已结束'}</span><span class="activity-cost">${used?`${count(used)} Token`:'暂无用量'}</span><time class="activity-time">${date(row.last_activity_at)}</time></div>`;
  }).join('')}</div>`:empty('暂无 AI 活动')}</section>`;
}
function usageTotal(row) { return BigInt(row.input_tokens||0)+BigInt(row.output_tokens||0); }
function analytics() {
  const daysRows=data.usage_days||[], modelRows=data.models||[];
  const total=modelRows.reduce((sum,row)=>sum+usageTotal(row),0n);
  const max=daysRows.reduce((high,row)=>usageTotal(row)>high?usageTotal(row):high,0n);
  const points=daysRows.map((row,index)=>{
    const x=daysRows.length===1?308:48+index*520/(daysRows.length-1);
    const y=max?180-Number(usageTotal(row)*130n/max):180;
    return [x,y];
  });
  const line=points.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area=points.length?`M ${points[0][0]} 180 L ${points.map(([x,y])=>`${x} ${y}`).join(' L ')} L ${points.at(-1)[0]} 180 Z`:'';
  const marker = points.length === 1
    ? `<circle cx="${points[0][0]}" cy="${points[0][1]}" r="5" fill="var(--lime)" stroke="var(--panel)" stroke-width="2"><title>${esc(daysRows[0].day)} · ${esc(count(max))} Token</title></circle>`
    : '';
  const colors=['#c9e76a','#dc9b77','#b8a6e8','#8cb7e6','#86c3b5'];
  let used=0;
  const circumference=2*Math.PI*48;
  const arcs=modelRows.filter(row=>usageTotal(row)>0n).map((row,index)=>{
    const percent=total?Number(usageTotal(row)*10000n/total)/10000:0;
    const arc=`<circle cx="70" cy="70" r="48" fill="none" stroke="${colors[index%colors.length]}" stroke-width="16" stroke-dasharray="${percent*circumference} ${circumference}" stroke-dashoffset="${-used*circumference}" transform="rotate(-90 70 70)"/>`;
    used+=percent;return arc;
  }).join('');
  return `<div class="analytics-grid"><section class="panel"><div class="panel-head"><h2 class="panel-title">消耗趋势</h2><span class="panel-unit">Token · ${periods[days]}</span></div><div class="chart-summary"><strong>${count(total)}</strong><span>输入 ${count(modelRows.reduce((sum,row)=>sum+BigInt(row.input_tokens||0),0n))} / 输出 ${count(modelRows.reduce((sum,row)=>sum+BigInt(row.output_tokens||0),0n))}</span></div>${points.length?`<div class="chart-surface"><svg class="trend-svg" viewBox="0 0 620 220" role="img" aria-label="按日 Token 消耗趋势"><line x1="48" y1="50" x2="568" y2="50" stroke="#42454a" stroke-dasharray="3 5"/><line x1="48" y1="115" x2="568" y2="115" stroke="#42454a" stroke-dasharray="3 5"/><line x1="48" y1="180" x2="568" y2="180" stroke="#42454a" stroke-dasharray="3 5"/><text x="4" y="53" class="axis-text">${esc(count(max))}</text><text x="23" y="183" class="axis-text">0</text><path d="${area}" fill="#c9e76a20"/><polyline points="${line}" fill="none" stroke="#c9e76a" stroke-width="2"/>${marker}${daysRows.map((row,index)=>`<text x="${points[index][0]}" y="207" text-anchor="middle" class="axis-text">${esc(String(row.day).slice(5))}</text>`).join('')}</svg></div>`:empty('所选时间内暂无 Token 记录')}</section><section class="panel"><div class="panel-head"><h2 class="panel-title">模型消耗分布</h2>${icon('token')}</div>${total?`<div class="model-breakdown"><div class="donut-wrap"><svg class="donut" viewBox="0 0 140 140" role="img" aria-label="模型 Token 占比"><circle cx="70" cy="70" r="48" fill="none" stroke="#303238" stroke-width="16"/>${arcs}<text x="70" y="66" text-anchor="middle" class="donut-caption">已采集 Token</text><text x="70" y="88" text-anchor="middle" class="donut-total">${esc(count(total))}</text></svg></div><div class="model-legend">${modelRows.map((row,index)=>`<div class="model-legend-item"><span class="legend-dot" style="--model-color:${colors[index%colors.length]}"></span><div><strong>${esc(row.model||'未知模型')}</strong><span>${esc(row.provider)}</span></div><div class="legend-amount"><strong>${count(usageTotal(row))}</strong><span>${total?Number(usageTotal(row)*100n/total):0}%</span></div></div>`).join('')}</div></div>`:empty('所选时间内暂无模型消耗')}</section></div>`;
}
function allocationPanel() {
  const rows=(data.project_usage||[]).filter(row=>row.project_key);
  const total=rows.reduce((sum,row)=>sum+usageTotal(row),0n);
  return `<section class="panel allocation-panel"><div class="panel-head"><h2 class="panel-title">${icon('layers')}项目投入分布</h2><span class="panel-unit">Token · ${periods[days]}</span></div>${rows.length?`<div class="allocation-grid">${rows.map((row,index)=>{
    const value=usageTotal(row),percent=total?Number(value*100n/total):0;
    const key = allocationProjectKey(row.project_key);
    return `<a href="#/projects/${encodeURIComponent(key)}" class="allocation-item accent-${['purple','blue','orange','lime','teal'][index%5]}"><div class="allocation-label"><strong>${esc(projectName(key))}</strong><b>${count(value)}</b></div><span class="progress-track"><span style="--progress:${percent}%"></span></span><div class="allocation-foot"><span>输入 ${count(row.input_tokens)} / 输出 ${count(row.output_tokens)}</span><span>${percent}%</span></div></a>`;
  }).join('')}</div>`:empty('暂无可归属项目的 Token 消耗')}</section>`;
}
function trendPanel() {
  const rows=data.usage_days||[];
  if (!rows.length) return empty('所选时间内暂无 Token 记录');
  const values=rows.map(row=>BigInt(row.input_tokens||0)+BigInt(row.output_tokens||0));
  const max=values.reduce((a,b)=>a>b?a:b,0n);
  return `<div class="live-trend">${rows.map((row,index)=>`<div class="live-trend-day"><div class="live-trend-track"><span style="height:${max?Math.max(3,Number(values[index]*100n/max)):0}%"></span></div><strong>${count(values[index])}</strong><time>${esc(String(row.day).slice(5,10))}</time></div>`).join('')}</div>`;
}
function distributionPanel() {
  if (!data.models.length) return empty('所选时间内暂无模型消耗');
  const rows=data.models.map(row=>({...row,total:BigInt(row.input_tokens||0)+BigInt(row.output_tokens||0)}));
  const total=rows.reduce((sum,row)=>sum+row.total,0n);
  return `<div class="live-distribution">${rows.map(row=>`<div class="live-distribution-row"><div><strong>${esc(row.model||'未知模型')}</strong><span>${count(row.total)} Token</span></div><div class="progress-track"><span style="--progress:${total?Number(row.total*100n/total):0}%"></span></div></div>`).join('')}</div>`;
}
function attentionPanel(projects) {
  const rows = projects.map(item => {
    const blocked = item.status === 'blocked';
    return `<a class="live-attention-item ${blocked ? 'is-blocked' : ''}" href="#/projects/${encodeURIComponent(item.full_name)}">
      <span class="live-attention-mark">${icon(blocked ? 'warning' : 'folder')}</span>
      <strong>${esc(projectName(item.full_name))}</strong>
      <span class="status-badge tone-${tone[item.status] || 'muted'}">${status[item.status] || '已阻塞'}</span>
      ${icon('chevron', 'live-attention-arrow')}
    </a>`;
  });
  const body = rows.length ? `<div class="live-attention">${rows.join('')}</div>` : empty('暂无需要关注的项目');
  return section(`${icon('warning')}需要你关注`, body, `<span class="section-count" aria-label="${rows.length} 个项目">${rows.length}</span>`);
}
function sidebarUsage(rows) {
  const totals = rows.map(usageTotal);
  const total = totals.reduce((sum, tokens) => sum + tokens, 0n);
  const colors = ['#c9e76a', '#dc9b77', '#b8a6e8', '#8cb7e6', '#86c3b5'];
  const segments = total ? totals.map((tokens, index) =>
    `<span style="width:${Number(tokens * 10000n / total) / 100}%;--model-color:${colors[index % colors.length]}"></span>`
  ).join('') : '';
  return `<div class="sidebar-usage">
    <div class="sidebar-usage-label"><span>${periods[days]} AI 投入</span>${icon('bolt')}</div>
    <div class="sidebar-usage-total"><strong>${count(total)}</strong><span>Token</span></div>
    <div class="stacked-bar" aria-hidden="true">${segments}</div>
    <div class="sidebar-usage-foot">全部项目</div>
  </div>`;
}

function overview() {
  const projects = allProjects();
  const activeProjects = researchProjectCount(projects);
  const attention = projects.filter(project => project.status === 'blocked');
  const agents = runningAgents();
  const attentionSection = attentionPanel(attention);
  const agentSection = section(`${icon('bot')}AI 工作现场`,agentCards(agents));
  const optional = splitDeferredPanels([
    {key:'attention',empty:attention.length===0,html:attentionSection},
    {key:'agents',empty:agents.length===0,html:agentSection}
  ]);
  const activePanel = key => optional.active.find(panel=>panel.key===key)?.html || '';
  const deferredPanels = optional.deferred.map(panel=>panel.html).join('');
  return `${heading('总览')}<div class="metric-grid live-overview-metrics">
    ${metric('在研项目', activeProjects, 'folder', false, {unit:`/ ${projects.length}`})}
    ${metric('运行中的 智能助手', data.running, 'bot', false, {unit:'个'})}
    ${metric('成果文档', new Set(data.pulls.map(row=>row.url)).size, 'document', false, {unit:'份'})}
    ${metric(`${periods[days]} Token 用量`, count((data.models || []).reduce((sum, row) => sum + usageTotal(row), 0n)), 'token', true)}
  </div>
    ${teamCards()}
    <div class="section-heading"><div class="section-title"><h2>项目空间</h2><span class="section-count">${allProjects().length}</span></div></div>${projectCards(allProjects())}
    ${activePanel('attention')}
    <div class="${adaptiveColumnsClass(agents.length?2:1)}">${activePanel('agents')}${section(`${icon('document')}产出文档`,pulls(data.pulls.slice(0,5)),`<a href="#/outputs" class="live-more">全部文档 ${icon('arrow')}</a>`)}</div>
    ${analytics()}${allocationPanel()}${activityPanel()}
    ${section(`${icon('chart')}模型消耗`,modelRows())}${deferredPanels}`;
}
const pulseModules = [
  {name:'客户端采集与上报',description:'从授权的 Codex 会话增量采集工作摘要、模型用量和 Token，并核对服务端回执。'},
  {name:'项目进度与里程碑',description:'汇总项目目标、已完成与待完成事项，以及在研、阻塞等状态。'},
  {name:'团队与 智能助手 活动',description:'查看成员参与的项目、近期会话和正在运行的 智能助手。'},
  {name:'GitHub 仓库与 PR',description:'一个项目可关联多个仓库，PR 按真实仓库归档并可跳转 GitHub。'},
  {name:'用量统计',description:'按时间、模型和项目查看输入、缓存输入及输出 Token。'},
  {name:'团队数据修正',description:'服务端启用后，登记设备可修正摘要、项目归属和进度，并保留审计记录。'}
];
function projectModules(key) {
  const reported=reportFor(key)?.modules;
  const modules=reported?.length ? reported : key.toLowerCase()==='jiawei-wang-dev/project-pulse' ? pulseModules : [];
  const cards=modules.map(({name,description})=>`<li><h3>${esc(name)}</h3><p>${esc(description)}</p></li>`).join('');
  const source=modules.length ? `<span class="live-module-source">${reported?.length ? '项目上报' : '仓库功能说明'} · ${modules.length} 个模块</span>` : '';
  return section(`${icon('layers')}功能模块`,cards ? `<ul class="live-module-grid">${cards}</ul>` : empty('暂无模块介绍，客户端上报后在此展示'),source);
}
function projectPage(key) {
  const project=allProjects().find(row=>row.full_name===key);
  if (!project) return `${heading('项目不存在',false)}${empty('返回总览选择项目')}`;
  const sessions=data.sessions.filter(row=>projectKey(row)===key), docs=data.pulls.filter(row=>row.full_name===key);
  const agents=runningAgents(key);
  const agentSection=`<div id="project-agents">${section(`${icon('bot')}AI 工作现场`,agentCards(agents))}</div>`;
  return `${heading(projectName(key))}<div class="live-project-info"><span>${project.local ? '本地工作区' : '已关联 GitHub 仓库'}</span>${status[project.status] ? `<span class="status-badge tone-${tone[project.status]||'muted'}">${status[project.status]}</span>` : ''}<span>${esc(key)}</span></div>
    <div class="metric-grid live-project-metrics">${metric('近期会话',sessions.length,'activity')}${metric('产出文档',docs.length,'document')}${metric('草稿',docs.filter(row=>row.is_draft).length,'document')}</div>
    <nav class="live-page-tabs" aria-label="项目内容"><button data-scroll-to="project-modules">功能模块</button><button data-scroll-to="project-milestones">项目里程碑</button><button data-scroll-to="project-agents">AI 工作现场</button><button data-scroll-to="project-sessions">近期会话</button><button data-scroll-to="project-docs">产出文档</button><button data-scroll-to="project-members">项目成员</button></nav>
    <div id="project-modules">${projectModules(key)}</div>
    <div id="project-milestones">${milestonePanel(key)}</div>
    ${agents.length?agentSection:''}
    <div id="project-sessions">${section(`${icon('activity')}近期会话与总结`,sessionRows(sessions))}</div>
    <div id="project-docs">${section(`${icon('document')}产出文档`,pulls(docs))}</div>
    <div id="project-members">${teamCards(key)}</div>
    ${section(`${icon('warning')}待处理事项`,project.status==='blocked'?`<div class="live-attention"><span class="status-badge tone-red">已阻塞</span><strong>${esc(projectName(key))}</strong></div>`:empty('暂无待处理事项'))}
    ${agents.length?'':agentSection}`;
}
function teamPage() {
  const subagents=data.agents.filter(row=>row.kind==='subagent').reduce((sum,row)=>sum+row.count,0);
  return `${heading('团队成员')}<div class="metric-grid live-team-metrics">${metric('团队员工',data.people.length,'users')}${metric('参与项目',allProjects().length,'folder')}${metric('运行中的 智能助手',data.running,'bot')}${metric('开发工具子助手',subagents,'bot')}</div>${teamCards()}${section(`${icon('users')}成员活动`,peopleRows())}`;
}
function memberPage(name) {
  const person=data.people.find(item=>item.display_name===name);
  if (!person) return `${heading('成员不存在',false)}${empty('返回团队成员选择一位成员')}`;
  const sessions=data.sessions.filter(item=>item.display_name===name);
  const projects=memberProjects(name);
  const active=runningAgents().filter(item=>item.display_name===name);
  return `${heading(name)}<div class="metric-grid live-team-metrics">${metric('参与项目',projects.length,'folder')}${metric('近期会话',sessions.length,'activity')}${metric('运行中的 智能助手',active.length,'bot')}${metric('最近活跃工具',person.tool_id||'—','code')}</div>${section(`${icon('folder')}参与项目`,projects.length?projectCards(allProjects().filter(item=>projects.includes(item.full_name))):empty('项目待关联'))}${section(`${icon('activity')}近期会话与总结`,sessionGroups(sessions))}${section(`${icon('bot')}AI 工作现场`,agentCards(active))}`;
}
function sessionsPage() { return `${heading('近期会话与总结')}${section(`${icon('activity')}会话`,sessionGroups(data.sessions))}`; }
function outputsPage() { return `${heading('产出文档')}${section(`${icon('document')}文档清单`,pulls(data.pulls))}`; }
function render() {
  if (!data) { app.innerHTML=`<div class="boot-state" role="status"><span class="boot-mark">P</span>${esc(error||'正在读取工作台…')} <button class="button-secondary" id="refresh">重试</button></div>`;return; }
  const current=route(), names={overview:'总览',team:'团队成员',member:current.name,sessions:'近期会话与总结',outputs:'产出文档',project:projectName(current.key)};
  const content=current.page==='project'?projectPage(current.key):current.page==='member'?memberPage(current.name):current.page==='team'?teamPage():current.page==='sessions'?sessionsPage():current.page==='outputs'?outputsPage():overview();
  document.title=`${names[current.page]} · Project Pulse`;
  app.innerHTML=`${side()}<div class="live-nav-backdrop" id="backdrop"></div><div class="content-shell">${topbar(names[current.page])}<main id="main-content" tabindex="-1">${error?`<p class="live-error" role="status">${esc(error)}</p>`:''}${content}<footer class="live-footer">Project Pulse · 数据按新加坡时间统计${archived ? ' · 历史快照 ' + date(data.imported_at) : data.usage_basis === 'local' ? ' · 用量按本机上报统计' : ''}</footer></main></div>`;
}
async function load() {
  if (loading) return;
  loading=true;error='';if (!data) render();
  try {
    const response=await fetch(`/api/v1/dashboard?days=${days}${archived ? '&archive=1' : ''}`);
    if (!response.ok) throw new Error('数据读取失败，请重试');
    data=await response.json();

  } catch (cause) {error=cause.message||'数据读取失败，请重试';}
  finally {loading=false;render();}
}
document.addEventListener('click',event=>{
  if (event.target.closest('#archive-switch') && !loading) {
    archived = !archived;
    void load();
    return;
  }
  const switcher = event.target.closest('#theme-switch');
  if (switcher) {
    themeRoot.dataset.theme = themeRoot.dataset.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('pulse-theme', themeRoot.dataset.theme);
    switcher.textContent = themeAction();
    return;
  }
  const period=event.target.closest('[data-days]');
  if (period) {days=Number(period.dataset.days);sessionStorage.setItem('pulse-days',String(days));void load();return;}
  if (event.target.closest('#refresh')) {void load();return;}
  const scrollTo=event.target.closest('[data-scroll-to]');
  if (scrollTo) {document.getElementById(scrollTo.dataset.scrollTo)?.scrollIntoView({behavior:'smooth',block:'start'});return;}
  if (event.target.closest('#menu')) {document.body.classList.add('live-nav-open');return;}
  if (event.target.closest('#backdrop, .sidebar a')) document.body.classList.remove('live-nav-open');
});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
void load();
