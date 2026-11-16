import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {networkInterfaces,tmpdir} from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,utimes,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';

const run=promisify(execFile);
const host=Object.values(networkInterfaces()).flat().find(x=>x.family==='IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address))?.address;
if (process.env.CI && !host && ['darwin','win32','linux'].includes(process.platform)) throw new Error('No private test interface; portable collector verification cannot be skipped in CI.');
test('portable collector: long metadata, baseline/reset, retry, stale backlog, exclusion, usage receipts',
  {skip:!host || !['darwin','win32','linux'].includes(process.platform)}, async()=>{
  const root=await mkdtemp(join(tmpdir(),'pulse-fast-test-'));
  const logs=join(root,'codex','sessions','2026','01','01');
  const state=join(root,'state');
  await mkdir(logs,{recursive:true});
  await mkdir(join(root,'home'));
  let activeHome=join(root,'codex');
  const cursors=new Map(); let committed=0; let rejectNext=false; let corruptReceipt=false;
  const totals={input_tokens:0,cached_input_tokens:0,output_tokens:0};
  const prBatches=new Map();
  const statusBatches=new Map();
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://local');
    let result;
    if(url.pathname==='/api/v1/report-directory') result={protocol_version:3,capabilities:['project_mapping_backfill','client_pr_ingest','client_project_status'],members:[],repositories:[],sources:[...cursors].map(([source_id,c])=>({source_id,offset:c.offset}))};
    else if(url.pathname==='/api/v1/report-cursor') result=cursors.get(url.searchParams.get('source_id')) ?? {offset:0,context:{},repositories:[]};
    else if(req.method==='POST' && url.pathname==='/api/v1/report-statuses') {
      const chunks=[];for await(const chunk of req) chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks));
      if(rejectNext){rejectNext=false;res.writeHead(503).end();return;}
      assert.ok(Array.isArray(body.statuses));
      for(const row of body.statuses) assert.ok(cursors.has(row.source_session_id));
      if(statusBatches.has(body.batch_id)) assert.deepEqual(statusBatches.get(body.batch_id),body);
      statusBatches.set(body.batch_id,body);
      result={status:'committed',batch_id:body.batch_id,statuses:body.statuses.length};
    }
    else if(req.method==='POST' && url.pathname==='/api/v1/report-pulls') {
      const chunks=[];for await(const chunk of req) chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks));
      if(rejectNext){rejectNext=false;res.writeHead(503).end();return;}
      for(const p of body.pulls) assert.ok(cursors.has(p.source_session_id),JSON.stringify({keys:Object.keys(p),isArray:Array.isArray(p)}));
      if(prBatches.has(body.batch_id)) assert.deepEqual(prBatches.get(body.batch_id),body);
      prBatches.set(body.batch_id,body);
      result={status:'committed',batch_id:body.batch_id,pulls:body.pulls.length};
    }
    else if(req.method==='POST') {
      const chunks=[]; for await(const chunk of req) chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks));
      if(rejectNext) {rejectNext=false;res.writeHead(503).end();return;}
      const previous=cursors.get(body.cursor.source_id);
      if(previous?.offset !== body.cursor.to_offset) {
        assert.equal(body.cursor.from_offset,previous?.offset ?? 0);
        cursors.set(body.cursor.source_id,{offset:body.cursor.to_offset,context:body.cursor.context,repositories:[],
          session_exists:body.sessions.length>0,project_key:body.sessions[0]?.repository??'unresolved'});
        for(const row of body.usage) for(const key of Object.keys(totals)) totals[key]+=row[key] ?? 0;
        committed++;
      }
      for(const mapping of body.mappings??[]) cursors.get(mapping.session_id).project_key=mapping.repository;
      const usage={events:body.usage.length};
      for(const key of Object.keys(totals)) usage[key]=String(body.usage.reduce((n,r)=>n+(r[key]??0),0));
      if(corruptReceipt) usage.input_tokens='999999';
      result={status:'committed',batch_id:body.batch_id,to_offset:body.cursor.to_offset,usage};
    } else {res.writeHead(404).end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }).listen(0,host);
  await once(server,'listening');
  const origin=`http://${host}:${server.address().port}`;
  const windows=process.platform==='win32';
  const invoke=async(action,work,extra=[])=>{
    const script=resolve('ops/report',windows?'pulse-report.ps1':'pulse-report.pl');
    const args=windows?['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Action',action,'-WorkDir',work,'-StateDir',state,'-Server',origin]
      :[script,'--action',action,'--work-dir',work,'--state-dir',state,'--server',origin];
    args.push(...extra);
    const command=windows?'powershell.exe':process.platform==='linux'?'/bin/sh':'/usr/bin/perl';
    if(process.platform==='linux') args[0]=resolve('ops/report/pulse-report-linux.sh');
    const output=await run(command,args,{env:{...process.env,CODEX_HOME:activeHome,
      HOME:join(root,'home'),USERPROFILE:join(root,'home'),APPDATA:join(root,'home','AppData','Roaming'),
      LOCALAPPDATA:join(root,'home','AppData','Local'),XDG_DATA_HOME:join(root,'home','.local','share')},maxBuffer:1024*1024});
    return JSON.parse(output.stdout);
  };
  const at=new Date().toISOString();
  const source=randomUUID();
  const file=join(logs,`${source}.jsonl`);
  const meta={type:'session_meta',timestamp:at,payload:{id:source,timestamp:at,cwd:root,base_instructions:'PROJECT_PULSE_AUTOMATION '+ 'x'.repeat(90000)}};
  const token=(input,cached,output,last)=>({type:'event_msg',timestamp:at,payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,cached_input_tokens:cached,output_tokens:output},...(last?{last_token_usage:last}:{})}}});
  const lines=[meta,{type:'event_msg',timestamp:at,payload:{type:'user_message',message:'Implement the requested feature'}},
    {type:'turn_context',payload:{model:'fixture-model'}},token(100,40,10),token(100,40,10),token(120,50,12),
    token(5,2,1,{input_tokens:5,cached_input_tokens:2,output_tokens:1}),token(5,2,1)];
  try {
    await writeFile(file,lines.map(JSON.stringify).join('\n')+'\n');
    const work=join(root,'work1');
    const prepared=await invoke('Prepare',work);
    assert.equal(prepared.prepared_batches,1);
    assert.equal(prepared.usage.input_tokens,125);
    assert.equal(prepared.usage.cached_input_tokens,52);
    assert.equal(prepared.usage.output_tokens,13);
    assert.equal(prepared.diagnostics.counter_resets,1);
    const outside=windows?['-OnlySource',randomUUID()]:['--only-source',randomUUID()];
    await assert.rejects(invoke('Submit',work,outside),/outside selected project scope/);
    assert.equal(committed,0);
    rejectNext=true;
    await assert.rejects(invoke('Submit',work));
    await assert.rejects(invoke('Prepare',join(root,'outside-pending'),outside),/outside selected project scope/);
    assert.equal(committed,0);
    // Prepare automatically retries the saved immutable request before scanning.
    await invoke('Prepare',join(root,'retry'));
    assert.deepEqual(totals,{input_tokens:125,cached_input_tokens:52,output_tokens:13});
    assert.equal(committed,1);
    await invoke('Submit',work);
    assert.equal(committed,1);
    // The cursor's saved cutoff must survive old mtimes and a missing local state.
    await writeFile(file,lines.concat(token(8,3,2)).map(JSON.stringify).join('\n')+'\n');
    const old=new Date(Date.now()-20*86400000);await utimes(file,old,old);
    await rm(state,{recursive:true,force:true});
    const next=join(root,'work2');const nextPlan=await invoke('Prepare',next);
    assert.equal(nextPlan.usage.input_tokens,3);
    corruptReceipt=true;await assert.rejects(invoke('Submit',next));
    corruptReceipt=false;assert.equal((await invoke('Submit',next)).usage_verified,true);
    // An explicit automation user request is excluded, not the metadata text.
    const reportSource=randomUUID();
    await writeFile(join(logs,`${reportSource}.jsonl`),[
      {...meta,payload:{...meta.payload,id:reportSource}},
      {type:'event_msg',timestamp:at,payload:{type:'user_message',message:'PROJECT_PULSE_AUTOMATION。Run report'}},token(999,0,0)
    ].map(JSON.stringify).join('\n')+'\n');
    const excluded=await invoke('Prepare',join(root,'work3'));
    assert.equal(excluded.usage.events,0);
    assert.ok(Object.values(excluded.diagnostics.skipped).includes('reporting_session'));
    const plan=JSON.parse(await readFile(join(next,'plan.json')));
    assert.ok(plan.batches[0].cursor.context.report_from);
    // Never advance over a partial trailing JSONL record.
    const partial=JSON.stringify(token(11,4,3));
    await writeFile(file,lines.concat(token(8,3,2)).map(JSON.stringify).join('\n')+'\n'+partial.slice(0,20));
    const half=await invoke('Prepare',join(root,'half'));
    assert.equal(half.usage.events,0);
    await writeFile(file,lines.concat(token(8,3,2)).map(JSON.stringify).join('\n')+'\n'+partial+'\n');
    const fullWork=join(root,'full');
    assert.equal((await invoke('Prepare',fullWork)).usage.input_tokens,3);
    await invoke('Submit',fullWork);
    // A cross-window initial snapshot must not import its historic cumulative total.
    const oldSource=randomUUID();
    await writeFile(join(logs,`${oldSource}.jsonl`),[
      {...meta,timestamp:old.toISOString(),payload:{...meta.payload,id:oldSource,timestamp:old.toISOString()}},
      token(1000000,500000,1000,{input_tokens:2,cached_input_tokens:1,output_tokens:1})
    ].map(JSON.stringify).join('\n')+'\n');
    const oldWork=join(root,'old');
    assert.equal((await invoke('Prepare',oldWork)).usage.input_tokens,2);
    await invoke('Submit',oldWork);
    // Updating CODEX_HOME / switching an account preserves cursors across copied logs.
    activeHome=join(root,'home','.codex-new','accounts','account-b');
    const migrated=join(activeHome,'sessions','2026','01','01');
    await mkdir(migrated,{recursive:true});
    const migratedFile=join(migrated,`${source}.jsonl`);
    await copyFile(file,migratedFile);
    const original=await readFile(migratedFile,'utf8');
    await writeFile(migratedFile,original+JSON.stringify(token(20,5,5))+'\n');
    const migratedWork=join(root,'migrated');
    const migration=await invoke('Prepare',migratedWork);
    assert.ok(migration.diagnostics.session_roots_found>=2);
    assert.equal(migration.usage.input_tokens,9);
    await invoke('Submit',migratedWork);
    // A nonstandard account directory is found even after CODEX_HOME is unset.
    activeHome='';
    const rediscovered=await invoke('Prepare',join(root,'rediscovered'));
    assert.ok(rediscovered.diagnostics.session_roots_found>=2);
    assert.equal(rediscovered.usage.events,0);
    // Explicit old -> new workspace mapping repairs a session even with no new bytes.
    const repoDir=join(root,'renamed-project');await mkdir(repoDir);
    await run('git',['init',repoDir]);
    await run('git',['-C',repoDir,'remote','add','origin','https://github.com/example/moved.git']);
    const mappingFile=join(state,'.pulse-project-paths.json');
    await writeFile(mappingFile,JSON.stringify([{old_path:root,new_path:repoDir}]));
    const before={...totals};const oldOffset=cursors.get(source).offset;
    const mappingWork=join(root,'mapping');
    await invoke('Prepare',mappingWork,windows?['-ResolveGit']:['--resolve-git']);
    const mappingPlan=JSON.parse(await readFile(join(mappingWork,'plan.json')));
    assert.ok(mappingPlan.batches.some(b=>b.mappings?.some(m=>m.session_id===source && m.repository==='example/moved')));
    await invoke('Submit',mappingWork);
    assert.equal(cursors.get(source).project_key,'example/moved');
    // Checked PR metadata can be uploaded without new log bytes and resumes
    // after failure, using an immutable request separate from token batches.
    await rm(repoDir,{recursive:true,force:true});
    const prWork=join(root,'pr-work');await invoke('Prepare',prWork);
    const pr={source_session_id:source,repository:'example/moved',github_id:43,number:7,
      title:'Verified client PR',url:'https://github.com/example/moved/pull/7',state:'merged',is_draft:false,created_at:at,updated_at:at};
    await writeFile(join(prWork,'pulls.json'),JSON.stringify([pr]));
    rejectNext=true;await assert.rejects(invoke('Submit',prWork));
    await invoke('Prepare',join(root,'pr-recovery'));
    const prResult=await invoke('Submit',prWork);
    assert.equal(prResult.pr_receipt.pulls,1);
    assert.equal(prBatches.size,1);
    assert.equal(cursors.get(source).offset,oldOffset);
    assert.deepEqual(totals,before);
    // Saved, verified remote still works if neither old nor new directory exists.
    await rm(repoDir,{recursive:true,force:true});
    const cached=await invoke('Prepare',join(root,'mapping-cached'));
    assert.ok(!cached.diagnostics.project_unresolved.some(x=>x.source_id===source));
    await mkdir(repoDir);await run('git',['init',repoDir]);
    await run('git',['-C',repoDir,'remote','add','origin','https://github.com/example/different.git']);
    const conflict=await invoke('Prepare',join(root,'mapping-conflict'),windows?['-ResolveGit']:['--resolve-git']);
    assert.ok(conflict.diagnostics.project_unresolved.some(x=>x.source_id===source && x.reason==='conflicting_repository_evidence'));
    assert.equal(cursors.get(source).project_key,'example/moved');
    const statusWork=join(root,'status-work');await invoke('Prepare',statusWork);
    await writeFile(join(statusWork,'statuses.json'),JSON.stringify([{source_session_id:source,state:'blocked',reason_code:'dependency_unavailable',observed_at:at,evidence:'等待尚未解决的外部依赖'}]));
    const beforeStatus={...totals},offsetBeforeStatus=cursors.get(source).offset;
    rejectNext=true;await assert.rejects(invoke('Submit',statusWork));
    await invoke('Prepare',join(root,'status-recovery'));
    assert.equal((await invoke('Submit',statusWork)).status_receipt.statuses,1);
    assert.equal(statusBatches.size,1);
    assert.deepEqual(totals,beforeStatus);
    assert.equal(cursors.get(source).offset,offsetBeforeStatus);
    // A missing start event must not hide actual activity; terminal events
    // still win over trailing accounting snapshots.
    const activitySource=randomUUID(),activityFile=join(migrated,`${activitySource}.jsonl`);
    const activityMeta={...meta,payload:{...meta.payload,id:activitySource}};
    const activeRows=[activityMeta,{type:'response_item',timestamp:at,payload:{type:'function_call'}},token(10,5,1)];
    await writeFile(activityFile,activeRows.map(JSON.stringify).join('\n')+'\n');
    const activeWork=join(root,'active-no-start');await invoke('Prepare',activeWork);
    let activePlan=JSON.parse(await readFile(join(activeWork,'plan.json')));
    assert.equal(activePlan.batches.find(b=>b.cursor.source_id===activitySource).agents[0].state,'running');
    await invoke('Submit',activeWork);
    await writeFile(activityFile,activeRows.concat({type:'event_msg',timestamp:at,payload:{type:'task_complete'}},token(12,6,2)).map(JSON.stringify).join('\n')+'\n');
    const completedWork=join(root,'completed-with-trailing-usage');await invoke('Prepare',completedWork);
    activePlan=JSON.parse(await readFile(join(completedWork,'plan.json')));
    assert.equal(activePlan.batches.find(b=>b.cursor.source_id===activitySource).agents[0].state,'completed');
    await invoke('Submit',completedWork);
    const scopedWork=join(root,'scoped');
    const scoped=await invoke('Prepare',scopedWork,windows?['-OnlySource',randomUUID()]:['--only-source',randomUUID()]);
    assert.equal(scoped.prepared_batches,0);
    assert.equal(scoped.usage.events,0);
    // Scope is persisted in the plan: adding a foreign PR must not bypass it
    // even if the Submit invocation omits OnlySource.
    await writeFile(join(scopedWork,'pulls.json'),JSON.stringify([pr]));
    await assert.rejects(invoke('Submit',scopedWork),/outside selected project scope/);
    await writeFile(join(state,'.pulse-project-selection.json'),JSON.stringify({schema_version:1,projects:[]}));
    await assert.rejects(invoke('Prepare',join(root,'missing-scope')),/require explicit OnlySource scope/);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});
