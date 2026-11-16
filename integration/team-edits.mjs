import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';
import { createApi } from '../backend.mjs';
import { createPreviewServer } from '../server.mjs';

if (!process.env.DATABASE_URL) throw new Error('Use a disposable database with migration 010.');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
process.env.PULSE_TEAM_EDITS='1';
const server=createPreviewServer(createApi({lanEnrollment:true}),{reportOnly:true}).listen(0,'127.0.0.1');
await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const editor=randomUUID(),owner=randomUUID(),session=randomUUID(),repo=randomUUID(),token=randomUUID();
const otherToken=randomUUID(),at=new Date().toISOString();
const request=async (path,body,credential=token)=>{
  const res=await fetch(base+path,{method:body ? 'POST' : 'GET',headers:{authorization:'Bearer '+credential,...(body ? {'content-type':'application/json'} : {})},
    ...(body ? {body:JSON.stringify(body)} : {})});
  return {status:res.status,body:await res.json()};
};
const target=`device_id=${owner}&session_id=${session}`;
try {
  for (const [id,credential] of [[editor,token],[owner,otherToken]]) {
    await pool.query('INSERT INTO developers VALUES ($1,$2)',[id,'成员 '+id.slice(0,4)]);
    await pool.query('INSERT INTO devices(device_id,developer_id,credential_digest) VALUES ($1,$1,$2)',[id,createHash('sha256').update(credential).digest()]);
  }
  await pool.query("INSERT INTO repositories(repository_id,github_host,github_id,full_name) VALUES ($1,'github.com',987654,'team/example')",[repo]);
  await pool.query("INSERT INTO sessions(device_id,session_id,tool_id,revision,last_activity_at,workspace_name) VALUES ($1,$2,'codex',10,$3,'本地目录')",[owner,session,at]);
  await pool.query("INSERT INTO report_cursors(device_id,source_id,byte_offset,context) VALUES ($1,$2,1234,'{}')",[owner,session]);
  await pool.query(`INSERT INTO usage_events(device_id,event_id,session_id,occurred_at,accounting,input_tokens,cached_input_tokens,output_tokens)
    VALUES ($1,$2,$3,$4,'billable',1000,800,50)`,[owner,randomUUID(),session,at]);
  const usageBefore=(await pool.query('SELECT * FROM usage_events ORDER BY device_id,event_id')).rows;
  const before=(await request('/api/v1/team-sessions?'+target)).body.sessions[0];
  assert.equal(before.device_id,owner);
  assert.equal((await request('/api/v1/team-sessions?'+target,null,'bad')).status,401);
  const body={request_id:randomUUID(),device_id:owner,session_id:session,tool:'codex',expected_version:before.version,
    reason:'根据仓库与已验证会话纠正项目进度',patch:{repository:'team/example',summary:'已完成接口并验证回执',goal:'提供可核验的团队看板',
      milestones:[{title:'多机验证',state:'pending',evidence:'仍需其他成员验证'}],status:{state:'blocked',reason_code:'dependency_unavailable',evidence:'缺少测试设备，需要补齐验证条件'}}};
  const result=await request('/api/v1/team-edits',body);
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.session.project_key,'team/example');
  assert.equal(result.body.session.project_state,'blocked');
  assert.equal(result.body.session.summary,body.patch.summary);
  assert.equal(result.body.session.last_activity_at,before.last_activity_at);
  assert.equal(result.body.session.revision,before.revision);
  assert.equal((await pool.query('SELECT byte_offset FROM report_cursors WHERE device_id=$1 AND source_id=$2',[owner,session])).rows[0].byte_offset,'1234');
  const replay=await request('/api/v1/team-edits',body);
  assert.equal(replay.body.replayed,true);
  assert.deepEqual(replay.body.session,result.body.session);
  assert.equal((await request('/api/v1/team-edits',{...body,reason:'另一个原因'})).body.error,'request_conflict');
  assert.equal((await request('/api/v1/team-edits',{...body,request_id:randomUUID()})).body.error,'edit_version_conflict');
  const history=(await request('/api/v1/team-edits?'+target)).body.edits;
  assert.equal(history.length,1);assert.equal(history[0].actor_device_id,editor);
  assert.equal(history[0].before_data.project_key,'本地目录');
  assert.equal(history[0].after_data.project_key,'team/example');
  const current=result.body.session;
  const partial={...body,request_id:randomUUID(),expected_version:current.version,patch:{summary:'下一步完成多机验证'}};
  const race=await Promise.all([request('/api/v1/team-edits',partial),request('/api/v1/team-edits',{...partial,request_id:randomUUID()})]);
  assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
  const latest=(await request('/api/v1/team-sessions?'+target)).body.sessions[0];
  assert.equal((await request('/api/v1/team-edits',{...partial,request_id:randomUUID(),expected_version:latest.version,patch:{input_tokens:999}})).status,422);
  assert.equal((await request('/api/v1/team-edits',{...partial,request_id:randomUUID(),expected_version:latest.version,patch:{repository:'unknown/repo'}})).status,422);
  assert.equal((await request('/api/v1/team-sessions?'+target)).body.sessions[0].version,latest.version);
  assert.deepEqual((await pool.query('SELECT * FROM usage_events ORDER BY device_id,event_id')).rows,usageBefore);
  const directory=await fetch(base+'/api/v1/report-directory',{headers:{'X-Pulse-LAN-Device':'a'.repeat(64)}});
  assert.ok((await directory.json()).capabilities.includes('team_metadata_edit'));
  const unknown=await fetch(base+'/api/v1/team-sessions',{headers:{'X-Pulse-LAN-Device':'a'.repeat(64)}});
  assert.equal(unknown.status,401);
  const lanDevice=randomUUID();
  await pool.query('INSERT INTO devices(device_id,developer_id,credential_digest) VALUES ($1,$2,$3)',
    [lanDevice,editor,createHash('sha256').update('lan:'+'a'.repeat(64)).digest()]);
  const lanRead=await fetch(base+'/api/v1/team-sessions?'+target,{headers:{'X-Pulse-LAN-Device':'a'.repeat(64)}});
  assert.equal(lanRead.status,200);assert.equal((await lanRead.json()).sessions[0].device_id,owner);
  process.env.PULSE_TEAM_EDITS='0';
  assert.equal((await request('/api/v1/team-sessions?'+target)).body.error,'team_edits_disabled');
  process.env.PULSE_TEAM_EDITS='1';
  await pool.query('UPDATE devices SET revoked_at=now() WHERE device_id=$1',[editor]);
  assert.equal((await request('/api/v1/team-edits',body)).status,401);
  console.log('Team edits: cross-member writes, audit, optimistic concurrency, idempotency, field restrictions, disabled/revoked access and cursor isolation passed.');
} finally {
  await new Promise(resolve=>server.close(resolve));
  await pool.end();
}
