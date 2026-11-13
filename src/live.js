const byId = id => document.getElementById(id);
const form = byId('login'), status = byId('status'), view = byId('dashboard'), logout = byId('logout');
let access = sessionStorage.getItem('pulse-access') || '';
let request = 0;
const stateLabel = {on_track:'正常推进',blocked:'已阻塞',unknown:'未知',completed:'已完成'};
const date = value => value ? new Date(value).toLocaleString('zh-CN') : '—';
const count = value => value == null ? '—' : BigInt(value).toLocaleString('zh-CN');
function el(tag, value, className) {
  const item = document.createElement(tag);
  if (value != null) item.textContent = value;
  if (className) item.className = className;
  return item;
}
function table(id, columns, rows) {
  const root = byId(id);
  if (!rows.length) { root.replaceChildren(el('p','暂无数据','empty')); return; }
  const wrap=el('div',null,'scroll'), table=el('table'), head=el('tr'), thead=el('thead'), tbody=el('tbody');
  for (const col of columns) { const th=el('th',col); th.scope='col'; head.append(th); }
  thead.append(head);
  for (const values of rows) {
    const tr=el('tr');
    for (const value of values) tr.append(el('td',value ?? '—'));
    tbody.append(tr);
  }
  table.append(thead,tbody); wrap.append(table); root.replaceChildren(wrap);
}
function render(data) {
  const models=data.models;
  const usage=models.flatMap(row=>[row.input_tokens,row.output_tokens]).filter(value=>value!=null);
  const metrics=[
    ['团队成员',data.people.length],['运行中的 Agent',data.running],
    ['开发工具子 Agent',data.agents.filter(row=>row.kind==='subagent').reduce((sum,row)=>sum+row.count,0)],
    ['已采集 Token',usage.length ? count(usage.reduce((sum,value)=>sum+BigInt(value),0n)) : '—']
  ];
  byId('metrics').replaceChildren(...metrics.map(([label,value])=>{
    const item=el('div',label,'metric'); item.append(el('strong',value)); return item;
  }));
  const projects=byId('projects');
  projects.replaceChildren(...data.projects.map(project=>{
    const group=el('article',null,'group');
    group.append(el('h3',project.full_name),el('span',[project.business_category,stateLabel[project.status]].filter(Boolean).join(' · ')));
    if(project.milestones.length) {
      const list=el('ol',null,'timeline');
      for(const node of project.milestones) list.append(el('li',node.title+(node.state==='accepted'?' ✓':'')));
      group.append(list);
    }
    return group;
  }));
  if(!data.projects.length) projects.append(el('p','暂无项目','empty'));
  table('attention',['项目','状态'],data.projects.filter(row=>!['completed','on_track'].includes(row.status)).map(row=>[row.full_name,stateLabel[row.status]]));
  table('people',['姓名','最近活跃工具','项目','最近活动','设备同步'],data.people.map(row=>[row.display_name,row.tool_id,row.full_name,date(row.last_activity_at),date(row.last_seen_at)]));
  table('models',['提供商','模型','输入 Token','缓存输入','输出 Token'],models.map(row=>[row.provider,row.model ?? '未知',count(row.input_tokens),count(row.cached_input_tokens),count(row.output_tokens)]));
  table('sessions',['姓名','开发工具','项目','时间','总结','总结工具'],data.sessions.map(row=>[row.display_name,row.tool_id,row.full_name,date(row.last_activity_at),row.summary,row.summarizer_tool]));
  const groups=new Map();
  for(const pull of data.pulls) {
    if(!groups.has(pull.full_name)) groups.set(pull.full_name,[]);
    groups.get(pull.full_name).push(pull);
  }
  byId('pulls').replaceChildren(...[...groups].map(([name,items])=>{
    const group=el('article',null,'group');
    group.append(el('h3',name+' · '+items.length+' 份 · '+items.filter(item=>item.is_draft).length+' 份草稿'));
    for(const pull of items) {
      const row=el('p'), link=el('a','#'+pull.number+' '+pull.title);
      try { const url=new URL(pull.url); if(url.origin==='https://github.com') link.href=url.href; } catch {}
      row.append(link); if(pull.is_draft) row.append(' · 草稿'); group.append(row);
    }
    return group;
  }));
  if(!groups.size) byId('pulls').append(el('p','暂无 PR','empty'));
  byId('quota-panel').hidden=!data.quota.length;
  table('quota',['姓名','提供商','额度窗口','已用','重置时间','观测时间'],data.quota.map(row=>[row.display_name,row.provider,row.limit_id+' / '+row.window_key,row.used_percent==null?'—':row.used_percent+'%',date(row.resets_at),date(row.observed_at)]));
}
function signOut() {
  request++;
  access=''; sessionStorage.removeItem('pulse-access');
  view.hidden=true; logout.hidden=true; form.hidden=false; byId('access').value='';
}
async function load() {
  const current=++request;
  status.textContent='读取中…';
  try {
    const response=await fetch('/api/v1/dashboard?days='+byId('days').value,{headers:{Authorization:'Bearer '+access}});
    if(current!==request) return;
    if(response.status===401) { signOut(); status.textContent='访问令牌无效'; return; }
    if(!response.ok) throw new Error();
    const data=await response.json();
    if(current!==request) return;
    render(data); status.textContent=''; view.hidden=false; form.hidden=true; logout.hidden=false;
    sessionStorage.setItem('pulse-access',access);
  } catch { if(current===request) status.textContent='读取失败，请重试'; }
}
form.addEventListener('submit',event=>{event.preventDefault(); access=byId('access').value; void load();});
logout.addEventListener('click',()=>{signOut();status.textContent='';});
byId('days').addEventListener('change',load);
byId('refresh').addEventListener('click',load);
if(access) void load();
