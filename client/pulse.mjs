import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { open, readdir, stat, mkdir, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadState } from './state.mjs';

const run = promisify(execFile);
const root = process.env.PULSE_STATE_DIR || join(homedir(), '.project-pulse');
const command = process.argv[2];
const deadline = Date.now() + 12000;
const version = '1.0.0';
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const repoName = value => typeof value === 'string' ? /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(value)?.[1]?.toLowerCase() ?? null : null;
const token = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const safeModel = value => typeof value === 'string' && /^[\w./:-]{1,100}$/.test(value) ? value : null;
const safeNarrative = (value,max) => typeof value==='string' && value.trim() && [...value].length<=max &&
  !/https?:\/\/|(?:^|\s)\/\S|[\w.+-]+@[\w.-]+\.[a-z]{2,}|[\x00-\x1f]/i.test(value);
const json = value => JSON.stringify(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const output = value => process.stdout.write(json(value) + '\n');

await mkdir(root, {recursive:true,mode:0o700});
process.umask(0o077);
const lockPath = join(root,'collector.lock');
const lock = await open(lockPath,'wx',0o600);
await lock.writeFile(String(process.pid));
try {
const config = await readFile(join(root,'config.json'),'utf8').then(JSON.parse).catch(error=>{
  if(error.code==='ENOENT') return {};
  throw error;
});
const {state,save} = await loadState(root);
if (!state.config.has('id_seed')) state.config.set('id_seed',{key:'id_seed',value:randomBytes(32).toString('hex')});
const seed = state.config.get('id_seed').value;
function id(...parts) {
  const hex = createHmac('sha256',seed).update(json(parts)).digest('hex');
  return [hex.slice(0,8),hex.slice(8,12),'8'+hex.slice(13,16),'8'+hex.slice(17,20),hex.slice(20,32)].join('-');
}
function queue({sessions=[],agents=[],summaries=[],usage=[],quota=[],projects=[]}) {
  const batch_id=randomUUID();
  const body=json({schema_version:1,batch_id,sent_at:new Date().toISOString(),collector_version:version,sessions,agents,summaries,usage,...(quota.length ? {quota} : {}),...(projects.length ? {projects} : {})});
  if (Buffer.byteLength(body)>256*1024) throw new Error('batch_size');
  state.outbox.set(batch_id,{id:batch_id,body,attempts:0,retry_at:0,rejected:0});
}

async function* files(directory, depth=0) {
  if (depth>6 || Date.now()>deadline) return;
  let entries;
  try { entries=await readdir(directory,{withFileTypes:true}); }
  catch(error) { if(error.code==='ENOENT') return; throw error; }
  entries.sort((a,b)=>b.name.localeCompare(a.name));
  for (const entry of entries) {
    if(Date.now()>deadline) return;
    const path=join(directory,entry.name);
    if(entry.isDirectory()) yield* files(path,depth+1);
    else if(entry.isFile() && entry.name.endsWith('.jsonl')) yield path;
  }
}

async function repository(cwd) {
  if(typeof cwd!=='string' || !cwd || Date.now()>=deadline) return null;
  const cached=state.repo_cache.get(cwd);
  if(cached && cached.checked_at>Date.now()-3600000) return cached.name;
  let name=null;
  try {
    const {stdout}=await run('git',['-C',cwd,'config','--get','remote.origin.url'],{timeout:500,maxBuffer:8192});
    name=repoName(stdout.trim());
  } catch {}
  state.repo_cache.set(cwd,{cwd,name,checked_at:Date.now()});
  return name;
}

const includeSummaryContext = process.env.PULSE_SUMMARY_CONTEXT === '1';

function excerpt(role, value) {
  if (!includeSummaryContext || typeof value !== 'string') return null;
  const text = value.replace(/```[\s\S]*?(?:```|$)/g, '[代码省略]')
    .replace(/https?:\/\/\S+|(?:^|\s)(?:~\/|\/|[A-Za-z]:\\)\S+/g, ' [链接或路径省略]')
    .replace(/\s+/g, ' ').trim();
  return text ? {role, text: [...text].slice(0, 240).join('')} : null;
}

function codex(row, context) {
  const p=row.payload || {};
  if (row.type==='session_meta' && typeof p.id==='string') {
    return {context:{...context,native:p.id,parent:p.parent_thread_id || p.source?.subagent?.thread_spawn?.parent_thread_id,child:!!p.source?.subagent,repo:repoName(p.git?.repository_url),cwd:p.cwd,started:stamp(p.timestamp||row.timestamp)}};
  }
  if (row.type==='turn_context') return {context:{...context,model:safeModel(p.model)}};
  if (row.type!=='event_msg') return {};
  const at=stamp(row.timestamp);
  if(!at) return {};
  if (p.type==='task_started') return {at,state:'running',evidence:'task_started'};
  if (p.type==='user_message') return {at,excerpt:excerpt('request',p.message)};
  if (p.type==='task_complete') return {at,state:'completed',evidence:'task_completed',excerpt:excerpt('outcome',p.last_agent_message)};
  if (p.type==='exec_command_end') {
    const code=token(p.exit_code);
    return code===null ? {} : {at,evidence:code===0 ? 'command_succeeded' : 'command_failed'};
  }
  if (p.type==='turn_aborted') return {at,state:'idle',evidence:'turn_aborted'};
  if (p.type==='token_count' && p.info?.total_token_usage) {
    const t=p.info.total_token_usage;
    return {at,model:context.model,counts:[token(t.input_tokens),token(t.cached_input_tokens),token(t.output_tokens)],cumulative:true,limits:p.rate_limits};
  }
  return {};
}

function claude(row, context) {
  if(typeof row.sessionId!=='string' || row.isSidechain) return {};
  const at=stamp(row.timestamp);
  if(!at) return {};
  const next={...context,native:row.sessionId,repo:null,cwd:row.cwd || context.cwd};
  if(row.type==='user' && Array.isArray(row.message?.content)) {
    const results=row.message.content.filter(part=>part.type==='tool_result');
    if(results.length) return {context:next,at,evidence:results.some(part=>part.is_error) ? 'tool_failed' : 'tool_succeeded'};
  }
  if(row.type==='user') return {context:next,at,state:'running',evidence:'user_turn'};
  if(row.type!=='assistant') return {context:next};
  const m=row.message || {}, t=m.usage;
  const input=t && [token(t.input_tokens),token(t.cache_read_input_tokens ?? 0),token(t.cache_creation_input_tokens ?? 0)];
  return {context:next,at,state:m.stop_reason ? 'idle' : 'running',
    evidence:m.stop_reason ? 'assistant_turn_completed' : null,
    excerpt:m.stop_reason ? excerpt('outcome',Array.isArray(m.content) ? m.content.filter(part=>part.type==='text').map(part=>part.text).join(' ') : m.content) : null,
    model:safeModel(m.model),key:m.id,counts:input && typeof m.id==='string' ?
      [input.every(x=>x!==null) ? token(input.reduce((a,b)=>a+b,0)) : null,input[1],token(t.output_tokens)] : null};
}

async function refreshCodexTitles() {
  const directory = process.env.PULSE_CODEX_DIR;
  if (!directory || process.env.PULSE_SHARE_SESSION_TITLES !== '1') return new Map();
  const index = join(dirname(directory), 'session_index.jsonl');
  const info = await stat(index).catch(() => null);
  if (!info?.isFile() || info.size > 4 * 1024 * 1024) return new Map();

  const titles = new Map();
  for (const line of (await readFile(index, 'utf8')).split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (typeof entry?.id !== 'string' || typeof entry.thread_name !== 'string') continue;
    const title = [...entry.thread_name.replace(/[\x00-\x1f\x7f]/g, ' ').trim()].slice(0, 120).join('');
    if (title) titles.set(id('codex', entry.id), title);
  }

  {
    const changed = [];
    for (const [sessionId, title] of titles) {
      const stored = state.sessions.get(sessionId);
      if (!stored) continue;
      const next = JSON.parse(stored.value);
      if (next.title === title) continue;
      next.title = title;
      next.revision++;
      state.sessions.set(sessionId,{id:sessionId,value:json(next)});
      const {state: agentState, evidence, ...session} = next;
      changed.push(session);
      if (changed.length === 100) break;
    }
    if (changed.length) queue({sessions:changed});
  }
  return titles;
}

async function prepare() {
  const titles = await refreshCodexTitles();
  const project_candidates=(process.env.PULSE_REPOSITORIES || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
  const existing=state.windows.values().next().value;
  if(existing) return {window_id:existing.id,evidence:JSON.parse(existing.evidence),project_candidates};
  const pending=[...state.outbox.values()].reduce((sum,batch)=>sum+Buffer.byteLength(batch.body),0);
  if(pending>=63*1024*1024) return {window_id:null,evidence:[],status:'queue_full'};
  const sources=[
    ['codex',process.env.PULSE_CODEX_DIR,codex,'openai'],
    ['claude_code',process.env.PULSE_CLAUDE_DIR,claude,'anthropic']
  ];
  const evidence=[];
  const quotaAccount=/^[0-9a-f-]{36}$/i.test(process.env.PULSE_CODEX_ACCOUNT_ID || '') ? process.env.PULSE_CODEX_ACCOUNT_ID : null;
  const allowed=new Set((process.env.PULSE_REPOSITORIES || '').toLowerCase().split(',').map(s=>s.trim()));
  let remaining=8*1024*1024, events=0, inspected=0;
  for (const [tool,directory,parse,provider] of sources) {
    if(!directory) continue;
    for await (const path of files(directory)) {
      if(remaining<=0 || events>=2000 || evidence.length>=10 || Date.now()>deadline || inspected++>=2000) break;
      const info=await stat(path).catch(()=>null);
      if(!info || info.mtimeMs < Date.now()-7*86400000) continue;
      const saved=state.files.get(path);
      const identity=[info.dev,info.ino,info.birthtimeMs].join(':');
      const same=saved?.identity===identity && saved.offset<=info.size;
      let context=same ? JSON.parse(saved.context) : {};
      let offset=same ? saved.offset : 0;
      if(offset===info.size) continue;
      const file=await open(path,'r').catch(()=>null);
      if(!file) continue;
      const buffer=Buffer.alloc(Math.min(remaining,info.size-offset));
      let bytes;
      try { ({bytesRead:bytes}=await file.read(buffer,0,buffer.length,offset)); }
      finally { await file.close(); }
      remaining-=bytes;
      if (!context.repo && !context.cwd) {
        // Resolve a checkout once per file rather than invoking Git for every event.
        const newline=buffer.indexOf(10);
        if(newline>=0 && newline<bytes) {
          try {
            const first=JSON.parse(buffer.subarray(0,newline));
            context.cwd=first.payload?.cwd || first.cwd;
          } catch {}
        }
      }
      const fallbackRepo=context.repo || await repository(context.cwd);
      {
        const changes=new Map();
        const excerpts=new Map();
        const usage=[];
        const childAgents=new Map();
        const quota=new Map();
        for(let start=0;start<bytes && events<2000 && Date.now()<deadline;) {
          const end=buffer.indexOf(10,start);
          if(end<0 || end>=bytes) break;
          const line=buffer.subarray(start,end);
          offset+=end-start+1;
          start=end+1;
          events++;
          let row;
          try { row=JSON.parse(line); } catch { continue; }
          const parsed=parse(row,context);
          context=parsed.context || context;
          if(!context.native || !parsed.at) continue;
          const session_id=id(tool,context.native);
          if(tool==='codex' && (context.child || context.parent)) {
            if(typeof context.parent!=='string') continue;
            const parentThread=id(tool,context.parent);
            const parentSession=state.sessions.has(parentThread);
            const parentChild=state.child_agents.get(parentThread);
            if(!parentSession && !parentChild) {
              offset-=line.length+1;
              break;
            }
            const parent=parentChild ? JSON.parse(parentChild.value) : null;
            const agent_id=id(session_id,'subagent');
            const previous=childAgents.get(agent_id) || JSON.parse(state.child_agents.get(session_id)?.value || 'null');
            if(previous && parsed.at<previous.last_activity_at) continue;
            const agent={agent_id,session_id:parent?.session_id || parentThread,
              parent_agent_id:parent?.agent_id || id(parentThread,'main'),kind:'subagent',role:null,
              state:parsed.state || previous?.state || 'unknown',last_activity_at:parsed.at,revision:(previous?.revision || 0)+1};
            childAgents.set(agent_id,agent);
            state.child_agents.set(session_id,{id:session_id,value:json(agent)});
            // Child rollouts can inherit parent history and cumulative counters.
            continue;
          }
          if (!changes.has(session_id) && evidence.length+changes.size>=10) {
            offset-=line.length+1;
            break;
          }
          const stored=state.sessions.get(session_id);
          const old=changes.get(session_id) || (stored && JSON.parse(stored.value));
          const latest=!old || parsed.at>=old.last_activity_at;
          const title = titles.get(session_id) || old?.title;
          const folder = typeof context.cwd === 'string' ? context.cwd.split(/[\\/]/).filter(Boolean).at(-1) : null;
          const workspace_name = folder && !/[/:\x00-\x1f\x7f]/.test(folder) && !['.','..'].includes(folder) ? [...folder.trim()].slice(0,120).join('') : old?.workspace_name;
          const next={session_id,tool,...(workspace_name ? {workspace_name} : {}),...(title ? {title} : {}),revision:(old?.revision || 0)+1,
            repository:allowed.has(context.repo || fallbackRepo) ? (context.repo || fallbackRepo) : null,
            started_at:[old?.started_at,context.started,parsed.at].filter(Boolean).sort()[0],
            last_activity_at:latest ? parsed.at : old.last_activity_at,
            project_observation:old?.project_observation ?? null,
            state:latest && parsed.state ? parsed.state : old?.state ?? 'unknown',
            evidence:parsed.evidence ? [...(old?.evidence || []),parsed.evidence].slice(-8) : old?.evidence || []};
          changes.set(session_id,next);
          if (parsed.excerpt) {
            const list = excerpts.get(session_id) || [];
            excerpts.set(session_id,[...list,parsed.excerpt].slice(-2));
          }
          if(quotaAccount && parsed.limits) {
            const limit_id=parsed.limits.limit_id || 'codex';
            if(/^[a-z0-9_:-]{1,80}$/i.test(limit_id)) {
              for(const window_key of ['primary','secondary']) {
                const window=parsed.limits[window_key];
                if(!window || !Number.isInteger(window.window_minutes) || window.window_minutes<1 ||
                    window.window_minutes>525600 || !Number.isFinite(window.used_percent) || window.used_percent<0) continue;
                const resets_at=Number.isFinite(window.resets_at) && window.resets_at>0 && window.resets_at<253402300799 ?
                  new Date(window.resets_at*1000).toISOString() : null;
                quota.set(limit_id+':'+window_key,{account_key:quotaAccount,limit_id,window_key,
                  observed_at:parsed.at,window_minutes:window.window_minutes,used_percent:window.used_percent,resets_at});
              }
            }
          }
          if(!parsed.counts) continue;
          const event_id=id(session_id,parsed.key || digest(line));
          if(state.seen.has(event_id)) continue;
          state.seen.set(event_id,{id:event_id});
          let counts=parsed.counts;
          if(parsed.cumulative) {
            const last=state.counts.get(session_id);
            const previous=last && JSON.parse(last.value);
            state.counts.set(session_id,{id:session_id,value:json(counts)});
            counts=counts.map((value,i)=>value===null || (previous && (previous[i]===null || value<previous[i])) ? null : value-(previous?.[i] || 0));
          }
          usage.push({event_id,session_id,agent_id:id(session_id,'main'),occurred_at:parsed.at,provider,
            model:parsed.model ?? null,accounting:'billable',input_tokens:counts[0],cached_input_tokens:counts[1]!==null && counts[0]!==null && counts[1]>counts[0] ? null : counts[1],output_tokens:counts[2]});
        }
        state.files.set(path,{path,identity,offset,context:json(context)});
        const sessions=[], agents=[];
        for(const next of changes.values()) {
          state.sessions.set(next.session_id,{id:next.session_id,value:json(next)});
          const {state: agentState,evidence:signals,...session}=next;
          sessions.push(session);
          agents.push({agent_id:id(session.session_id,'main'),session_id:session.session_id,parent_agent_id:null,
            kind:'main',role:null,state:agentState,last_activity_at:session.last_activity_at,revision:session.revision});
          const item={session_id:session.session_id,tool,repository:session.repository,workspace_name:session.workspace_name || null,
            observed_at:session.last_activity_at,signals,activity:excerpts.get(session.session_id) || []};
          const index=evidence.findIndex(entry=>entry.session_id===session.session_id);
          if(index>=0) {
            item.activity=[...(evidence[index].activity || []),...item.activity].slice(-2);
            evidence[index]=item;
          }
          else evidence.push(item);
        }
        if(sessions.length) {
          const firstUsage=usage.splice(0,100-sessions.length-agents.length);
          queue({sessions,agents,usage:firstUsage});
        }
        for(let index=0;index<usage.length;index+=100) queue({usage:usage.slice(index,index+100)});
        const children=[...childAgents.values()];
        for(let i=0;i<children.length;i+=100) queue({agents:children.slice(i,i+100)});
        const snapshots=[...quota.values()];
        for(let i=0;i<snapshots.length;i+=100) queue({quota:snapshots.slice(i,i+100)});
        if(changes.size) {
          const window_id=id('evidence',evidence);
          state.windows.clear();
          state.windows.set(window_id,{id:window_id,evidence:json(evidence)});
        }
      }
    }
  }
  const window=state.windows.values().next().value;
  return window ? {window_id:window.id,evidence:JSON.parse(window.evidence),project_candidates} : {window_id:null,evidence:[],project_candidates};
}

function submit(data) {
  if (!data.window_id) return;
  {
    const window=state.windows.get(data.window_id);
    if(!window && state.config.has('submitted:'+data.window_id)) return;
    if(!window) throw new Error('unknown_window');
    const evidence=JSON.parse(window.evidence);
    const tool=process.env.PULSE_SUMMARIZER_TOOL || config.summarizer_tool;
    if(!['codex','claude_code'].includes(tool) || !Array.isArray(data.summaries) || data.summaries.length!==evidence.length) throw new Error('invalid_summary');
    const sessions=[], summaries=[], projects=[], seen=new Set();
    for(const row of data.summaries) {
      const item=evidence.find(entry=>entry.session_id===row.session_id && entry.observed_at===row.observed_at);
      const reasons={on_track:['progress_observed'],blocked:['dependency_unavailable','repeated_failure'],unknown:['insufficient_evidence']};
      if(!item || seen.has(row.session_id) || !Object.hasOwn(reasons,row.state) || !reasons[row.state].includes(row.reason_code) ||
         typeof row.summary!=='string' || !row.summary.trim() || [...row.summary].length>200 ||
         /https?:\/\/|(?:^|\s)\/\S|[\w.+-]+@[\w.-]+\.[a-z]{2,}|[\x00-\x1f]/i.test(row.summary)) throw new Error('invalid_summary');
      seen.add(row.session_id);
      const next=JSON.parse(state.sessions.get(row.session_id).value);
      if(next.last_activity_at===row.observed_at) {
        next.revision++;
        if (row.state !== 'unknown' || !next.project_observation) {
          next.project_observation={state:row.state,reason_code:row.reason_code,observed_at:row.observed_at};
        }
        state.sessions.set(row.session_id,{id:row.session_id,value:json(next)});
        const {state: agentState,evidence:signals,...session}=next;
        sessions.push(session);
      }
      summaries.push({summary_id:id(data.window_id,row.session_id),session_id:row.session_id,observed_at:row.observed_at,
        summary:row.summary,summarizer_tool:tool,prompt_version:version});
    }
    if(data.projects !== undefined && (!Array.isArray(data.projects) || data.projects.length>5)) throw new Error('invalid_projects');
    const reported=new Set();
    const allowed=new Set((process.env.PULSE_REPOSITORIES || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean));
    for(const row of data.projects || []) {
      const source=evidence.find(item=>item.session_id===row.source_session_id && item.observed_at===row.observed_at);
      const key=typeof row.project_key==='string' ? row.project_key.trim() : '';
      const validKey=source && (key===source.repository || key===source.workspace_name || allowed.has(key.toLowerCase()));
      if(!validKey || reported.has(key) || !safeNarrative(row.goal,200) ||
        !Array.isArray(row.milestones) || row.milestones.length<1 || row.milestones.length>12) throw new Error('invalid_project_report');
      for(const milestone of row.milestones) {
        if(!milestone || !safeNarrative(milestone.title,120) ||
          !['completed','pending'].includes(milestone.state) || !safeNarrative(milestone.evidence,200)) throw new Error('invalid_project_milestone');
      }
      reported.add(key);
      projects.push({report_id:id(data.window_id,key),source_session_id:source.session_id,project_key:key,
        goal:row.goal,milestones:row.milestones,observed_at:source.observed_at,summarizer_tool:tool,prompt_version:version});
    }
    queue({sessions,summaries,projects});
    state.config.set('submitted:'+data.window_id,{key:'submitted:'+data.window_id,value:'1'});
    state.windows.delete(data.window_id);
  }
}

async function flush() {
  const pending = () => [...state.outbox.values()].filter(batch=>!batch.rejected);
  let sent=0;
  if(pending().length) {
    const url=new URL(process.env.PULSE_SERVER_URL || config.server_url);
    const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    const privateLan=/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname);
    const allowedHttp=url.protocol==='http:' && (loopback || (config.allow_lan_http===true && privateLan));
    if(url.protocol!=='https:' && !allowedHttp) throw new Error('https_required');
    const deviceToken=process.env.PULSE_DEVICE_TOKEN || config.device_token;
    if(typeof deviceToken!=='string' || !/^[A-Za-z0-9._~-]+$/.test(deviceToken)) throw new Error('invalid_device_token');
    for(const batch of pending().slice(0,2)) {
      if(batch.retry_at>Date.now() || Date.now()>=deadline) break;
      let status, retryAfter;
      try {
        const params=[
          '--max-time',String(Math.min(4,(deadline-Date.now())/1000)),
          '--silent','--show-error','--include','--config','-',
          '--header','Content-Type: application/json','--request','POST',
          new URL('/api/v1/reports',url).href
        ];
        const child=run('curl',['-q',...params],{maxBuffer:512*1024});
        child.child.stdin.on('error',()=>{});
        child.child.stdin.end('header = '+json('Authorization: Bearer '+deviceToken)+'\ndata-binary = '+json(batch.body)+'\n');
        const {stdout}=await child;
        const boundary=stdout.lastIndexOf('\r\n\r\n');
        const headers=stdout.slice(0,boundary);
        status=Number([...headers.matchAll(/^HTTP\/[^ ]+ (\d+)/gm)].at(-1)?.[1]);
        retryAfter=headers.match(/^retry-after:\s*([^\r\n]+)/im)?.[1];
        if(status===200) {
          const receipt=JSON.parse(stdout.slice(boundary+4));
          if(receipt.batch_id===batch.id && receipt.status==='committed') {
            state.outbox.delete(batch.id);
            await save();
            sent++;
            continue;
          }
        }
      } catch {}
      const retryAt=retryAfter ? (/^\d+$/.test(retryAfter) ? Date.now()+Number(retryAfter)*1000 : Date.parse(retryAfter)) : 0;
      batch.retry_at=Math.max(Date.now()+Math.min(30,2**Math.min(5,batch.attempts))*60000,retryAt || 0);
      batch.attempts++;
      batch.rejected=Number([400,409,413,415,422].includes(status));
      await save();
      break;
    }
  }
  return {sent_batches:sent,pending_batches:pending().length,rejected_batches:state.outbox.size-pending().length};
}

try {
  if(command==='prepare') { const window=await prepare(); await save(); output(window); }
  else if(command==='submit') {
    const parts=[];
    let size=0;
    for await(const chunk of process.stdin) {
      size+=chunk.length;
      if(size>16384) throw new Error('summary_too_large');
      parts.push(chunk);
    }
    submit(JSON.parse(Buffer.concat(parts).toString() || '{}'));
    await save();
    output(await flush());
  } else if(command==='flush') output(await flush());
  else throw new Error('usage: pulse.mjs prepare|submit|flush');
} catch(error) {
  const message=/^[\w: |.-]{1,80}$/.test(error.message) ? error.message : 'collector_failed';
  output({status:'error',error_code:message});
  process.exitCode=1;
}
} finally { await lock.close(); await unlink(lockPath); }
