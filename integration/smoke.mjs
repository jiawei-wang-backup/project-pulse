import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { once } from 'node:events';
import pg from 'pg';
import { createPreviewServer } from '../server.mjs';
import { createApi, ingest, dashboard, dashboardCutoff } from '../backend.mjs';
import { resolveGitHubDeveloper } from '../db/github-identity.mjs';

if (!process.env.DATABASE_URL) throw new Error('Use a disposable migrated database.');
const run=promisify(execFile);
const temp=await mkdtemp(join(tmpdir(),'pulse-smoke-'));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const token=randomUUID(), developer=randomUUID(), device=randomUUID();
const server=createPreviewServer(createApi({lanEnrollment:true})).listen(0,'127.0.0.1');
await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
const at=new Date().toISOString();
const root=join(temp,'codex');
const claude=join(temp,'claude');
const env={...process.env,PULSE_STATE_DIR:join(temp,'state'),PULSE_CODEX_DIR:root,PULSE_CLAUDE_DIR:claude,
  PULSE_SUMMARIZER_TOOL:'claude_code',PULSE_CODEX_ACCOUNT_ID:randomUUID(),PULSE_SERVER_URL:base,PULSE_DEVICE_TOKEN:token,PULSE_REPOSITORIES:'example/pulse'};
delete env.DATABASE_URL;
const cli=async (command,input)=>{
  const child=run(process.execPath,['client/pulse.mjs',command],{env});
  child.child.stdin.end(input ? JSON.stringify(input) : undefined);
  return JSON.parse((await child).stdout);
};
try {
  await pool.query('INSERT INTO developers VALUES ($1,$2)',[developer,'开发者']);
  await pool.query('INSERT INTO devices(device_id,developer_id,credential_digest) VALUES ($1,$2,$3)',[device,developer,createHash('sha256').update(token).digest()]);
  await pool.query("INSERT INTO repositories(repository_id,github_host,github_id,full_name) VALUES ($1,'github.com',42,'example/pulse')",[randomUUID()]);
  await mkdir(root); await mkdir(claude);
  await writeFile(join(root,'test.jsonl'),[
    {type:'session_meta',timestamp:at,payload:{id:'session-a',git:{repository_url:'https://github.com/example/pulse.git'}}},
    {type:'turn_context',payload:{model:'codex-fixture'}},
    {type:'event_msg',timestamp:at,payload:{type:'task_started'}},
    {type:'event_msg',timestamp:at,payload:{type:'token_count',info:{total_token_usage:{input_tokens:10,cached_input_tokens:2,output_tokens:3}},rate_limits:{limit_id:'codex',primary:{used_percent:23,window_minutes:300}}}}
  ].map(item=>JSON.stringify(item)).join('\n')+'\n');
  await writeFile(join(claude,'test.jsonl'),[
    {type:'assistant',sessionId:'session-a',timestamp:at,message:{id:'message-1',model:'claude-fixture',stop_reason:'end_turn',
      usage:{input_tokens:4,cache_read_input_tokens:2,cache_creation_input_tokens:1,output_tokens:5}}}
  ].map(item=>JSON.stringify(item)).join('\n')+'\n');
  await writeFile(join(root,'child.jsonl'),[
    {type:'session_meta',timestamp:at,payload:{id:'child-a',parent_thread_id:'session-a',source:{subagent:{}}}},
    {type:'event_msg',timestamp:at,payload:{type:'task_complete'}},
    {type:'event_msg',timestamp:at,payload:{type:'token_count',info:{total_token_usage:{input_tokens:10,output_tokens:3}}}}
  ].map(item=>JSON.stringify(item)).join('\n')+'\n');
  const window=await cli('prepare');
  assert.equal(window.evidence.length,2);
  assert.notEqual(window.evidence[0].session_id,window.evidence[1].session_id);
  const source=window.evidence.find(row=>row.repository==='example/pulse');
  const submitted=await cli('submit',{window_id:window.window_id,summaries:window.evidence.map(row=>({
    session_id:row.session_id,observed_at:row.observed_at,summary:'已观测到开发活动',state:'unknown',reason_code:'insufficient_evidence'
  })),projects:[{project_key:'example/pulse',source_session_id:source.session_id,observed_at:source.observed_at,
    goal:'采集并展示开发活动',milestones:[{title:'采集会话',state:'completed',evidence:'测试会话已进入上报窗口'},
      {title:'接入真实设备',state:'pending',evidence:'当前仅有测试设备'}]}]});
  assert.equal(submitted.sent_batches,2);
  let pending=submitted.pending_batches;
  for(let i=0;i<5 && pending;i++) pending=(await cli('flush')).pending_batches;
  assert.equal(pending,0);
  assert.equal((await cli('prepare')).evidence.length,0);
  const dashboardResponse=await fetch(base+'/api/v1/dashboard');
  assert.equal(dashboardResponse.status,200);
  const data=await dashboardResponse.json();
  assert.equal(data.sessions.length,2);
  assert.equal(data.agents.find(row=>row.kind==='subagent').count,1);
  assert.equal(data.quota[0].used_percent,'23');
  assert.ok(data.sessions.every(row=>row.summarizer_tool==='claude_code'));
  assert.equal(data.project_reports[0].project_key,'example/pulse');
  assert.equal(data.project_reports[0].milestones[0].state,'completed');
  assert.ok(Array.isArray(data.project_usage));
  assert.equal(data.session_usage.find(row=>row.session_id===source.session_id).input_tokens,'10');
  assert.ok(data.memberships.some(row=>row.display_name==='开发者'));
  assert.equal(data.models.find(row=>row.model==='codex-fixture').input_tokens,'10');
  assert.equal(data.models.find(row=>row.model==='claude-fixture').input_tokens,'7');
  const heartbeat={schema_version:1,batch_id:randomUUID(),sent_at:at,collector_version:'1.0.0',sessions:[],agents:[],summaries:[],usage:[]};
  const caseVariant={...heartbeat,batch_id:randomUUID(),projects:[{
    report_id:randomUUID(),source_session_id:source.session_id,project_key:'EXAMPLE/PULSE',
    goal:'验证仓库键大小写归一化',milestones:[{title:'合并项目键',state:'completed',evidence:'大小写变体已归入登记仓库'}],
    observed_at:new Date(Date.parse(at)+100).toISOString(),summarizer_tool:'claude_code',prompt_version:'2.0.0'
  }]};
  await ingest(pool,token,Buffer.from(JSON.stringify(caseVariant)));
  const canonicalData=await (await fetch(base+'/api/v1/dashboard')).json();
  assert.deepEqual(canonicalData.project_reports.map(row=>row.project_key),['example/pulse']);
  const raw=Buffer.from(JSON.stringify(heartbeat));
  await Promise.all([ingest(pool,token,raw),ingest(pool,token,raw)]);
  await assert.rejects(ingest(pool,token,Buffer.from(JSON.stringify({...heartbeat,collector_version:'1.0.1'}))),{status:409});
  assert.equal((await pool.query('SELECT count(*) FROM ingest_batches WHERE batch_id=$1',[heartbeat.batch_id])).rows[0].count,'1');
  const sourceId=randomUUID();
  const cursorUrl=base+'/api/v1/report-cursor?source_id='+sourceId;
  const authHeader='Authorization: Bearer '+token;
  const curl=async (headers,...args)=>{
    const command=run('curl',['-q','-sS','--max-time','5','-H','@-',...args]);
    command.child.stdin.end(headers);
    return JSON.parse((await command).stdout);
  };
  const readCursor=()=>curl(authHeader,cursorUrl);
  assert.equal((await curl('',cursorUrl)).error,'invalid_device');
  assert.equal((await readCursor()).offset,0);
  const context={model:'codex-fixture',input_tokens:10,cached_input_tokens:2,output_tokens:3};
  const direct={...heartbeat,batch_id:randomUUID(),collector_version:'2.0.0',
    cursor:{source_id:sourceId,from_offset:0,to_offset:250,context}};
  const sendDirect=async payload=>{
    const path=join(temp,'direct.json');
    await writeFile(path,JSON.stringify(payload));
    return curl(authHeader,'-H','Content-Type: application/json',
      '--data-binary','@'+path,base+'/api/v1/reports');
  };
  const invalid={...direct,usage:[{
    event_id:randomUUID(),session_id:sourceId,agent_id:null,occurred_at:at,provider:'openai',
    model:context.model,accounting:'billable',input_tokens:10,cached_input_tokens:2,output_tokens:3
  }]};
  assert.equal((await sendDirect(invalid)).error,'invalid_record');
  assert.equal((await readCursor()).offset,0);
  const valid={...invalid,sessions:[{session_id:sourceId,tool:'codex',revision:250,repository:'example/pulse',
    started_at:at,last_activity_at:at,project_observation:{state:'on_track',reason_code:'progress_observed',observed_at:at}}],
    summaries:[{summary_id:randomUUID(),session_id:sourceId,observed_at:at,summary:'验证了直报事件的事务写入',
      summarizer_tool:'codex',prompt_version:'2.0.0'}]};
  const receipt={batch_id:valid.batch_id,status:'committed',to_offset:250,
    usage:{events:1,input_tokens:'10',cached_input_tokens:'2',output_tokens:'3'}};
  assert.deepEqual(await sendDirect(valid),receipt);
  assert.deepEqual(await sendDirect(valid),receipt);
  const {project_report: previousProject,latest_summary,agent_state,project_key,session_exists,project_status,...position} = await readCursor();
  assert.deepEqual(position,{source_id:sourceId,offset:250,context,repositories:['example/pulse']});
  assert.equal(latest_summary,'验证了直报事件的事务写入');
  assert.equal(agent_state,null);
  assert.equal(previousProject.goal,'验证仓库键大小写归一化');
  assert.equal((await sendDirect({...direct,batch_id:randomUUID()})).error,'cursor_conflict');
  const backfill={...direct,batch_id:randomUUID(),cursor:{...direct.cursor,from_offset:250,to_offset:250},
    projects:[{report_id:randomUUID(),source_session_id:sourceId,project_key:'example/pulse',
      goal:'补齐项目目标',milestones:[{title:'测试上报',state:'completed',evidence:'已通过集成测试'}],
      observed_at:new Date(Date.parse(at)+1000).toISOString(),summarizer_tool:'codex',prompt_version:'2.0.0'}]};
  assert.equal((await sendDirect({...backfill,usage:valid.usage})).error,'invalid_project_backfill');
  assert.equal((await sendDirect(backfill)).to_offset,250);
  assert.equal((await sendDirect(backfill)).status,'committed');
  assert.equal((await readCursor()).project_report.goal,'补齐项目目标');
  const next={...direct,batch_id:randomUUID(),cursor:{...direct.cursor,from_offset:250,to_offset:300},
    sessions:[{...valid.sessions[0],revision:300,project_observation:null}]};
  assert.equal((await sendDirect(next)).to_offset,300);
  assert.equal((await pool.query('SELECT project_state FROM sessions WHERE device_id=$1 AND session_id=$2',
    [device,sourceId])).rows[0].project_state,'on_track');
  assert.equal((await pool.query('SELECT count(*) FROM usage_events WHERE device_id=$1 AND session_id=$2',
    [device,sourceId])).rows[0].count,'1');
  const mapping={...heartbeat,batch_id:randomUUID(),projects:[],mappings:[{session_id:sourceId,repository:'example/moved'}],
    cursor:{source_id:sourceId,from_offset:300,to_offset:300,context}};
  assert.equal((await sendDirect(mapping)).status,'committed');
  assert.equal((await readCursor()).project_key,'example/moved');
  assert.equal((await readCursor()).offset,300);
  assert.equal((await readCursor()).project_report.goal,'补齐项目目标');
  assert.equal((await pool.query('SELECT count(*) FROM usage_events WHERE device_id=$1 AND session_id=$2',[device,sourceId])).rows[0].count,'1');
  assert.equal((await sendDirect({...mapping,batch_id:randomUUID(),mappings:[{session_id:randomUUID(),repository:'example/moved'}]})).error,'invalid_project_backfill');
  const prBatch={schema_version:1,batch_id:randomUUID(),sent_at:at,pulls:[{
    source_session_id:sourceId,repository:'example/moved',github_id:43,number:7,title:'Client discovered PR',
    url:'https://github.com/example/moved/pull/7',state:'merged',is_draft:false,created_at:at,updated_at:at}]};
  const submitPr=async body=>(await fetch(base+'/api/v1/report-pulls',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
  assert.deepEqual(await submitPr(prBatch),{status:'committed',batch_id:prBatch.batch_id,pulls:1});
  assert.deepEqual(await submitPr(prBatch),{status:'committed',batch_id:prBatch.batch_id,pulls:1});
  assert.equal((await submitPr({...prBatch,sent_at:new Date(Date.now()+1000).toISOString()})).error,'batch_conflict');
  assert.equal((await submitPr({...prBatch,batch_id:randomUUID(),pulls:[{...prBatch.pulls[0],source_session_id:randomUUID()}]})).error,'pr_session_missing');
  assert.equal((await submitPr({...prBatch,batch_id:randomUUID(),pulls:[{...prBatch.pulls[0],url:'https://example.com/other'}]})).error,'invalid_pr_record');
  const prData=await (await fetch(base+'/api/v1/dashboard')).json();
  assert.equal(prData.pulls.filter(p=>p.full_name==='example/moved'&&p.number==='7').length,1);
  assert.equal((await readCursor()).offset,300);
  assert.equal((await pool.query('SELECT count(*) FROM usage_events WHERE device_id=$1 AND session_id=$2',[device,sourceId])).rows[0].count,'1');
  const lifecycleSource=randomUUID(),lifecycleRepo=randomUUID();
  const oldAt=new Date(Date.now()-40*86400000).toISOString();
  await pool.query("INSERT INTO repositories(repository_id,github_host,github_id,full_name) VALUES ($1,'github.com',44,'example/lifecycle')",[lifecycleRepo]);
  await pool.query("INSERT INTO sessions(device_id,session_id,tool_id,repository_id,revision,last_activity_at) VALUES ($1,$2,'codex',$3,1,$4)",[device,lifecycleSource,lifecycleRepo,oldAt]);
  const assess=async(state,reason_code,observed_at=oldAt,source=lifecycleSource)=>{
    const body={schema_version:1,batch_id:randomUUID(),sent_at:at,statuses:[{source_session_id:source,state,reason_code,observed_at,evidence:'根据项目目标和会话中的未完成项判断'}]};
    const response=await fetch(base+'/api/v1/report-statuses',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {body,result:await response.json()};
  };
  assert.equal((await assess('blocked','dependency_unavailable')).result.status,'committed');
  let life=await dashboard(pool,1);
  assert.equal(life.projects.find(p=>p.full_name==='example/lifecycle').status,'blocked');
  assert.ok(life.memberships.some(p=>p.full_name==='example/lifecycle'));
  assert.ok(!life.sessions.some(p=>p.session_id===lifecycleSource));
  for(const [index,state,reason] of [[1,'completed','goal_completed'],[2,'paused','user_paused'],[3,'on_track','progress_observed']]) {
    assert.equal((await assess(state,reason,new Date(Date.parse(oldAt)+index*1000).toISOString())).result.status,'committed');
    assert.equal((await dashboard(pool,1)).projects.find(p=>p.full_name==='example/lifecycle').status,state);
  }
  await assess('blocked','repeated_failure');
  assert.equal((await dashboard(pool,1)).projects.find(p=>p.full_name==='example/lifecycle').status,'on_track');
  assert.equal((await assess('paused','progress_observed')).result.error,'invalid_project_status');
  assert.equal((await assess('blocked','repeated_failure',oldAt,randomUUID())).result.error,'status_session_missing');
  const start=+dashboardCutoff(1),snapshot=start+12*3600000;
  for(const [time,input,cached,output] of [[start-1,1000,800,100],[start,3,2,1],[snapshot,5,2,2],[snapshot+1,9000,8000,900]]) {
    await pool.query("INSERT INTO usage_events(device_id,event_id,session_id,occurred_at,model,accounting,input_tokens,cached_input_tokens,output_tokens) VALUES ($1,$2,$3,$4,'boundary-fixture','billable',$5,$6,$7)",[device,randomUUID(),sourceId,new Date(time),input,cached,output]);
  }
  const boundary=await dashboard(pool,1,snapshot);
  const exact=boundary.models.find(m=>m.model==='boundary-fixture');
  assert.equal(exact.input_tokens,'8');assert.equal(exact.cached_input_tokens,'4');assert.equal(exact.output_tokens,'3');
  const total=rows=>rows.reduce((sum,r)=>sum+BigInt(r.input_tokens??0)+BigInt(r.output_tokens??0),0n);
  assert.equal(total(boundary.models),total(boundary.usage_days));
  assert.equal(total(boundary.models),total(boundary.today_models));
  assert.equal(total(boundary.models),total(boundary.session_usage));
  const enrollGitHub = async (user, existingId) => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const developerId = await resolveGitHubDeveloper(db,user,existingId);
      await db.query('INSERT INTO devices(device_id,developer_id,credential_digest) VALUES ($1,$2,$3)',
        [randomUUID(),developerId,createHash('sha256').update(randomUUID()).digest()]);
      await db.query('COMMIT');
      return developerId;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  };
  const githubUser = {id:101,login:'example-user',name:'开发者'};
  assert.equal(await enrollGitHub(githubUser,developer),developer);
  assert.equal(await enrollGitHub({...githubUser,login:'renamed-user'}),developer);
  const other = {id:102,login:'other-user',name:'开发者'};
  await assert.rejects(enrollGitHub(other,developer),/already bound to another GitHub account/);
  const otherIds = await Promise.all([enrollGitHub(other),enrollGitHub(other)]);
  assert.equal(otherIds[0],otherIds[1]);
  assert.notEqual(otherIds[0],developer);
  await assert.rejects(enrollGitHub(githubUser,otherIds[0]),/already bound to another team member/);
  const enrollment = await pool.query(`SELECT g.github_login, count(d.device_id)::int AS devices
    FROM github_identities g JOIN devices d USING (developer_id)
    GROUP BY g.github_login ORDER BY g.github_login`);
  assert.deepEqual(enrollment.rows,[{github_login:'other-user',devices:2},{github_login:'renamed-user',devices:3}]);
  // LAN clients share a registered member only after an explicit account claim,
  // never merely because they use the same repository or display label.
  const lanKey=createHash('sha256').update(randomUUID()).digest('hex');
  const lanHeaders={'X-Pulse-LAN-Device':lanKey,'X-Pulse-LAN-GitHub':'renamed-user','Content-Type':'application/json'};
  const directory=await (await fetch(base+'/api/v1/report-directory',{headers:lanHeaders})).json();
  assert.equal(directory.protocol_version,3);
  assert.ok(directory.capabilities.includes('usage_receipt'));
  const lanSource=randomUUID();
  const lanReport={...valid,batch_id:randomUUID(),cursor:{source_id:lanSource,from_offset:0,to_offset:1,
    context:{...context,report_from:'2026-01-01T00:00:00Z'}},summaries:[],usage:[],
    sessions:[{...valid.sessions[0],session_id:lanSource,revision:1,repository:'unregistered/app'}]};
  const lanReceipt=await (await fetch(base+'/api/v1/reports',{method:'POST',headers:lanHeaders,body:JSON.stringify(lanReport)})).json();
  assert.equal(lanReceipt.status,'committed');
  const developerCount=(await pool.query('SELECT count(*) FROM developers')).rows[0].count;
  await fetch(base+'/api/v1/reports',{method:'POST',headers:lanHeaders,body:JSON.stringify(lanReport)});
  assert.equal((await pool.query('SELECT count(*) FROM developers')).rows[0].count,developerCount);
  assert.deepEqual(lanReceipt.usage,{events:0,input_tokens:'0',cached_input_tokens:'0',output_tokens:'0'});
  const lanDevice=await pool.query('SELECT developer_id FROM devices WHERE credential_digest=$1',[createHash('sha256').update('lan:'+lanKey).digest()]);
  assert.equal(lanDevice.rows[0].developer_id,developer);
  const workspace=await pool.query('SELECT workspace_name FROM sessions WHERE session_id=$1',[lanSource]);
  assert.equal(workspace.rows[0].workspace_name,'unregistered/app');
  const updatedDirectory=await (await fetch(base+'/api/v1/report-directory',{headers:lanHeaders})).json();
  assert.equal(updatedDirectory.sources[0].source_id,lanSource);
  console.log('PostgreSQL smoke test passed');
} finally {
  await new Promise(resolve=>server.close(resolve));
  await pool.end();
  await rm(temp,{recursive:true,force:true});
}
