import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { open, readdir, stat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const run = promisify(execFile);
const root = process.env.PULSE_STATE_DIR || join(homedir(), '.project-pulse');
const command = process.argv[2];
const deadline = Date.now() + 12000;
const version = '1.0.0';
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const repoName = value => typeof value === 'string' ? /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(value)?.[1]?.toLowerCase() ?? null : null;
const token = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const safeModel = value => typeof value === 'string' && /^[\w./:-]{1,100}$/.test(value) ? value : null;
const json = value => JSON.stringify(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const output = value => process.stdout.write(json(value) + '\n');

await mkdir(root, {recursive:true,mode:0o700});
process.umask(0o077);
const db = new DatabaseSync(join(root,'state.sqlite'));
db.exec(`PRAGMA busy_timeout=1000;
  CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS repo_cache (cwd TEXT PRIMARY KEY, name TEXT, checked_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, identity TEXT NOT NULL, offset INTEGER NOT NULL, context TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS counts (id TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS windows (id TEXT PRIMARY KEY, evidence TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, body TEXT NOT NULL, attempts INTEGER DEFAULT 0, retry_at INTEGER DEFAULT 0, rejected INTEGER DEFAULT 0);
`);
db.prepare('INSERT OR IGNORE INTO config VALUES (?,?)').run('id_seed',randomBytes(32).toString('hex'));
const seed = db.prepare('SELECT value FROM config WHERE key=?').get('id_seed').value;
function id(...parts) {
  const hex = createHmac('sha256',seed).update(json(parts)).digest('hex');
  return [hex.slice(0,8),hex.slice(8,12),'8'+hex.slice(13,16),'8'+hex.slice(17,20),hex.slice(20,32)].join('-');
}
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function queue({sessions=[],agents=[],summaries=[],usage=[],quota=[]}) {
  const batch_id=randomUUID();
  const body=json({schema_version:1,batch_id,sent_at:new Date().toISOString(),collector_version:version,sessions,agents,summaries,usage,...(quota.length ? {quota} : {})});
  if (Buffer.byteLength(body)>256*1024) throw new Error('batch_size');
  db.prepare('INSERT INTO outbox(id,body) VALUES (?,?)').run(batch_id,body);
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
  const cached=db.prepare('SELECT * FROM repo_cache WHERE cwd=?').get(cwd);
  if(cached && cached.checked_at>Date.now()-3600000) return cached.name;
  let name=null;
  try {
    const {stdout}=await run('git',['-C',cwd,'config','--get','remote.origin.url'],{timeout:500,maxBuffer:8192});
    name=repoName(stdout.trim());
  } catch {}
  db.prepare('INSERT OR REPLACE INTO repo_cache VALUES (?,?,?)').run(cwd,name,Date.now());
  return name;
}

function codex(row, context) {
  const p=row.payload || {};
  if (row.type==='session_meta' && typeof p.id==='string') {
    return {context:{...context,native:p.id,repo:repoName(p.git?.repository_url),cwd:p.cwd,started:stamp(p.timestamp||row.timestamp)}};
  }
  if (row.type==='turn_context') return {context:{...context,model:safeModel(p.model)}};
  if (row.type!=='event_msg') return {};
  const at=stamp(row.timestamp);
  if(!at) return {};
  if (p.type==='task_started') return {at,state:'running',evidence:'task_started'};
  if (p.type==='task_complete') return {at,state:'completed',evidence:'task_completed'};
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
    model:safeModel(m.model),key:m.id,counts:input && typeof m.id==='string' ?
      [input.every(x=>x!==null) ? token(input.reduce((a,b)=>a+b,0)) : null,input[1],token(t.output_tokens)] : null};
}

async function prepare() {
  const existing=db.prepare('SELECT * FROM windows ORDER BY rowid LIMIT 1').get();
  if(existing) return {window_id:existing.id,evidence:JSON.parse(existing.evidence)};
  const pending=db.prepare('SELECT coalesce(sum(length(body)),0) AS bytes FROM outbox').get().bytes;
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
      const saved=db.prepare('SELECT * FROM files WHERE path=?').get(path);
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
      transaction(()=>{
        const changes=new Map();
        const usage=[];
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
          if (!changes.has(session_id) && evidence.length+changes.size>=10) {
            offset-=line.length+1;
            break;
          }
          const stored=db.prepare('SELECT value FROM sessions WHERE id=?').get(session_id);
          const old=changes.get(session_id) || (stored && JSON.parse(stored.value));
          const latest=!old || parsed.at>=old.last_activity_at;
          const next={session_id,tool,revision:(old?.revision || 0)+1,
            repository:allowed.has(context.repo || fallbackRepo) ? (context.repo || fallbackRepo) : null,
            started_at:[old?.started_at,context.started,parsed.at].filter(Boolean).sort()[0],
            last_activity_at:latest ? parsed.at : old.last_activity_at,
            project_observation:old?.project_observation ?? null,
            state:latest && parsed.state ? parsed.state : old?.state ?? 'unknown',
            evidence:parsed.evidence ? [...(old?.evidence || []),parsed.evidence].slice(-8) : old?.evidence || []};
          changes.set(session_id,next);
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
          if(!db.prepare('INSERT OR IGNORE INTO seen VALUES (?)').run(event_id).changes) continue;
          let counts=parsed.counts;
          if(parsed.cumulative) {
            const last=db.prepare('SELECT value FROM counts WHERE id=?').get(session_id);
            const previous=last && JSON.parse(last.value);
            db.prepare('INSERT OR REPLACE INTO counts VALUES (?,?)').run(session_id,json(counts));
            counts=counts.map((value,i)=>value===null || (previous && (previous[i]===null || value<previous[i])) ? null : value-(previous?.[i] || 0));
          }
          usage.push({event_id,session_id,agent_id:id(session_id,'main'),occurred_at:parsed.at,provider,
            model:parsed.model ?? null,accounting:'billable',input_tokens:counts[0],cached_input_tokens:counts[1]!==null && counts[0]!==null && counts[1]>counts[0] ? null : counts[1],output_tokens:counts[2]});
        }
        db.prepare('INSERT OR REPLACE INTO files VALUES (?,?,?,?)').run(path,identity,offset,json(context));
        const sessions=[], agents=[];
        for(const next of changes.values()) {
          db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?)').run(next.session_id,json(next));
          const {state,evidence:signals,...session}=next;
          sessions.push(session);
          agents.push({agent_id:id(session.session_id,'main'),session_id:session.session_id,parent_agent_id:null,
            kind:'main',role:null,state,last_activity_at:session.last_activity_at,revision:session.revision});
          const item={session_id:session.session_id,tool,repository:session.repository,observed_at:session.last_activity_at,signals};
          const index=evidence.findIndex(entry=>entry.session_id===session.session_id);
          if(index>=0) evidence[index]=item;
          else evidence.push(item);
        }
        if(sessions.length) {
          const firstUsage=usage.splice(0,100-sessions.length-agents.length);
          queue({sessions,agents,usage:firstUsage});
        }
        for(let index=0;index<usage.length;index+=100) queue({usage:usage.slice(index,index+100)});
        const snapshots=[...quota.values()];
        for(let i=0;i<snapshots.length;i+=100) queue({quota:snapshots.slice(i,i+100)});
        if(changes.size) {
          const window_id=id('evidence',evidence);
          db.prepare('DELETE FROM windows').run();
          db.prepare('INSERT INTO windows VALUES (?,?)').run(window_id,json(evidence));
        }
      });
    }
  }
  const window=db.prepare('SELECT * FROM windows LIMIT 1').get();
  return window ? {window_id:window.id,evidence:JSON.parse(window.evidence)} : {window_id:null,evidence:[]};
}

function submit(data) {
  if (!data.window_id) return;
  transaction(()=>{
    const window=db.prepare('SELECT * FROM windows WHERE id=?').get(data.window_id);
    if(!window && db.prepare('SELECT value FROM config WHERE key=?').get('submitted:'+data.window_id)) return;
    if(!window) throw new Error('unknown_window');
    const evidence=JSON.parse(window.evidence);
    const tool=process.env.PULSE_SUMMARIZER_TOOL;
    if(!['codex','claude_code'].includes(tool) || !Array.isArray(data.summaries) || data.summaries.length!==evidence.length) throw new Error('invalid_summary');
    const sessions=[], summaries=[], seen=new Set();
    for(const row of data.summaries) {
      const item=evidence.find(entry=>entry.session_id===row.session_id && entry.observed_at===row.observed_at);
      const reasons={on_track:['progress_observed'],blocked:['dependency_unavailable','repeated_failure'],unknown:['insufficient_evidence']};
      if(!item || seen.has(row.session_id) || !Object.hasOwn(reasons,row.state) || !reasons[row.state].includes(row.reason_code) ||
         typeof row.summary!=='string' || !row.summary.trim() || [...row.summary].length>200 ||
         /https?:\/\/|(?:^|\s)\/\S|[\w.+-]+@[\w.-]+\.[a-z]{2,}|[\x00-\x1f]/i.test(row.summary)) throw new Error('invalid_summary');
      seen.add(row.session_id);
      const next=JSON.parse(db.prepare('SELECT value FROM sessions WHERE id=?').get(row.session_id).value);
      if(next.last_activity_at===row.observed_at) {
        next.revision++;
        next.project_observation={state:row.state,reason_code:row.reason_code,observed_at:row.observed_at};
        db.prepare('UPDATE sessions SET value=? WHERE id=?').run(json(next),row.session_id);
        const {state,evidence:signals,...session}=next;
        sessions.push(session);
      }
      summaries.push({summary_id:id(data.window_id,row.session_id),session_id:row.session_id,observed_at:row.observed_at,
        summary:row.summary,summarizer_tool:tool,prompt_version:version});
    }
    queue({sessions,summaries});
    db.prepare('INSERT OR IGNORE INTO config VALUES (?,?)').run('submitted:'+data.window_id,'1');
    db.prepare('DELETE FROM windows WHERE id=?').run(data.window_id);
  });
}

async function flush() {
  const first=db.prepare('SELECT * FROM outbox WHERE rejected=0 ORDER BY rowid LIMIT 2').all();
  if(!first.length) return {sent_batches:0,pending_batches:0};
  const url=new URL(process.env.PULSE_SERVER_URL);
  if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('https_required');
  if(!process.env.PULSE_DEVICE_TOKEN) throw new Error('missing_device_token');
  let sent=0;
  for(const batch of first) {
    if(batch.retry_at>Date.now() || Date.now()>=deadline) break;
    let response;
    try {
      response=await fetch(new URL('/api/v1/reports',url),{
        method:'POST',body:batch.body,redirect:'error',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.PULSE_DEVICE_TOKEN},
        signal:AbortSignal.timeout(Math.max(1,Math.min(4000,deadline-Date.now())))
      });
      if(response.ok && (await response.json()).batch_id===batch.id) {
        db.prepare('DELETE FROM outbox WHERE id=?').run(batch.id); sent++; continue;
      }
    } catch {}
    const status=response?.status;
    const retryHeader=response?.headers.get('Retry-After');
    const retryAfter=retryHeader ? (/^\d+$/.test(retryHeader) ? Date.now()+Number(retryHeader)*1000 : Date.parse(retryHeader)) : 0;
    const delay=Math.min(30,2**Math.min(5,batch.attempts))*60000 + Math.floor(Math.random()*15000);
    db.prepare('UPDATE outbox SET attempts=attempts+1,retry_at=?,rejected=? WHERE id=?')
      .run(Math.max(Date.now()+delay,retryAfter || 0),[400,409,413,415,422].includes(status) ? 1 : 0,batch.id);
    break;
  }
  return {sent_batches:sent,pending_batches:db.prepare('SELECT count(*) AS n FROM outbox WHERE rejected=0').get().n,
    rejected_batches:db.prepare('SELECT count(*) AS n FROM outbox WHERE rejected=1').get().n};
}
try {
  if(command==='prepare') output(await prepare());
  else if(command==='submit') {
    const parts=[];
    let size=0;
    for await(const chunk of process.stdin) {
      size+=chunk.length;
      if(size>16384) throw new Error('summary_too_large');
      parts.push(chunk);
    }
    submit(JSON.parse(Buffer.concat(parts).toString() || '{}'));
    output(await flush());
  } else if(command==='flush') output(await flush());
  else throw new Error('usage: pulse.mjs prepare|submit|flush');
} catch(error) {
  const message=/^[\w: |.-]{1,80}$/.test(error.message) ? error.message : 'collector_failed';
  output({status:'error',error_code:message});
  process.exitCode=1;
} finally { db.close(); }
