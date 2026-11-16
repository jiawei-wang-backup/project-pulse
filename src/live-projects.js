export const researchProjectCount = projects => projects.filter(project=>['on_track','blocked'].includes(project.status)).length;

export function splitDeferredPanels(panels) {
  return {
    active: panels.filter(panel=>!panel.empty),
    deferred: panels.filter(panel=>panel.empty)
  };
}

export const adaptiveColumnsClass = visiblePanels => `live-columns${visiblePanels === 1 ? ' is-single' : ''}`;

export function isRunningAgent(agent,now=Date.now()) {
  if(!agent) return false;
  const age=now-Date.parse(agent.last_activity_at);
  if(!Number.isFinite(age)||age<0) return false;
  if(agent.state==='running') return age<=2*3600000;
  return agent.state==='unknown' && agent.is_running===true && age<=30*60000;
}

export function memberProjectKeys(data,name,projectKey,key='') {
  const rows=[...(data.memberships||[]),...(data.sessions||[])].filter(row=>row.display_name===name);
  const names=[...new Set(rows.map(projectKey).filter(Boolean))];
  return key ? names.filter(project=>project===key) : names;
}

export function renderProjectDocuments(items,{esc,icon,date,projectName,safeGithub}) {
  const groups=new Map();
  for(const row of items) {
    const key=row.full_name||'未关联项目';
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups].map(([name,rows],index)=>`<details class="live-session-group live-doc-group" ${index===0?'open':''}>
    <summary><span class="live-session-group-name">${icon('folder')}<strong>${esc(projectName(name))}</strong><span class="section-count">${rows.length}</span></span><span class="live-session-group-latest">${rows.filter(row=>row.is_draft).length} 份草稿</span>${icon('down','live-session-group-chevron')}</summary>
    <div class="live-doc-rows">${rows.map(row=>{
      const link=safeGithub(row.url),label=`${row.repository_full_name ? row.repository_full_name+' ' : ''}#${row.number} ${row.title}`;
      const state={open:'开放中',closed:'已关闭',merged:'已合并'}[row.state]||row.state||'—';
      return `<div class="live-doc-row"><span class="live-doc-icon">${icon('document')}</span><div><strong>${link?`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:esc(label)}</strong><span>${esc(state)}</span></div>${row.is_draft?'<span class="status-badge tone-amber">草稿</span>':''}<time>${date(row.updated_at)}</time></div>`;
    }).join('')}</div></details>`).join('');
}
