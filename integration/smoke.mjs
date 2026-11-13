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
import { createApi, ingest } from '../backend.mjs';

if (!process.env.DATABASE_URL) throw new Error('Use a disposable migrated database.');
const run=promisify(execFile);
const temp=await mkdtemp(join(tmpdir(),'pulse-smoke-'));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const token=randomUUID(), developer=randomUUID(), device=randomUUID();
process.env.PULSE_VIEW_TOKEN=randomUUID();
const server=createPreviewServer(createApi()).listen(0,'127.0.0.1');
await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
const at=new Date().toISOString();
const root=join(temp,'codex');
const claude=join(temp,'claude');
const env={...process.env,PULSE_STATE_DIR:join(temp,'state'),PULSE_CODEX_DIR:root,PULSE_CLAUDE_DIR:claude,
  PULSE_SUMMARIZER_TOOL:'claude_code',PULSE_CODEX_ACCOUNT_ID:randomUUID(),PULSE_SERVER_URL:base,PULSE_DEVICE_TOKEN:token,PULSE_REPOSITORIES:'example/pulse'};
delete env.DATABASE_URL;
delete env.PULSE_VIEW_TOKEN;
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
  const window=await cli('prepare');
  assert.equal(window.evidence.length,2);
  assert.notEqual(window.evidence[0].session_id,window.evidence[1].session_id);
  const submitted=await cli('submit',{window_id:window.window_id,summaries:window.evidence.map(row=>({
    session_id:row.session_id,observed_at:row.observed_at,summary:'已观测到开发活动',state:'unknown',reason_code:'insufficient_evidence'
  }))});
  assert.equal(submitted.sent_batches,2);
  assert.equal((await cli('flush')).sent_batches,2);
  assert.equal((await cli('prepare')).evidence.length,0);
  assert.equal((await fetch(base+'/api/v1/dashboard')).status,401);
  const data=await (await fetch(base+'/api/v1/dashboard',{headers:{Authorization:'Bearer '+process.env.PULSE_VIEW_TOKEN}})).json();
  assert.equal(data.sessions.length,2);
  assert.equal(data.quota[0].used_percent,'23');
  assert.ok(data.sessions.every(row=>row.summarizer_tool==='claude_code'));
  assert.equal(data.models.find(row=>row.model==='codex-fixture').input_tokens,'10');
  assert.equal(data.models.find(row=>row.model==='claude-fixture').input_tokens,'7');
  const heartbeat={schema_version:1,batch_id:randomUUID(),sent_at:at,collector_version:'1.0.0',sessions:[],agents:[],summaries:[],usage:[]};
  const raw=Buffer.from(JSON.stringify(heartbeat));
  await Promise.all([ingest(pool,token,raw),ingest(pool,token,raw)]);
  await assert.rejects(ingest(pool,token,Buffer.from(JSON.stringify({...heartbeat,collector_version:'1.0.1'}))),{status:409});
  assert.equal((await pool.query('SELECT count(*) FROM ingest_batches WHERE batch_id=$1',[heartbeat.batch_id])).rows[0].count,'1');
  console.log('PostgreSQL smoke test passed');
} finally {
  await new Promise(resolve=>server.close(resolve));
  await pool.end();
  await rm(temp,{recursive:true,force:true});
}
