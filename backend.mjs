import { createHash, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = value => createHash('sha256').update(value).digest();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

function validate(report) {
  const arrays = ['sessions', 'agents', 'summaries', 'usage'];
  const hasQuota = report && Object.hasOwn(report,'quota');
  if (hasQuota) arrays.push('quota');
  const keys = (row, fields) => {
    if (!row || typeof row !== 'object' || Object.keys(row).sort().join(' ') !== fields.split(' ').sort().join(' ')) fail(422, 'invalid_fields');
  };
  keys(report, 'schema_version batch_id sent_at collector_version sessions agents summaries usage' + (hasQuota ? ' quota' : ''));
  if (report.schema_version !== 1 || !uuid.test(report.batch_id) ||
      arrays.some(key => !Array.isArray(report[key])) ||
      arrays.reduce((sum, key) => sum + report[key].length, 0) > 100) fail(422, 'invalid_batch');
  const fields = {
    sessions: 'session_id tool revision repository started_at last_activity_at project_observation',
    agents: 'agent_id session_id parent_agent_id kind role state last_activity_at revision',
    summaries: 'summary_id session_id observed_at summary summarizer_tool prompt_version',
    usage: 'event_id session_id agent_id occurred_at provider model accounting input_tokens cached_input_tokens output_tokens'
  };
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
  const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) && value.length <= 32;
  if (!timestamp(report.sent_at) || !version(report.collector_version)) fail(422, 'invalid_metadata');
  for (const row of report.quota || []) {
    keys(row,'account_key limit_id window_key observed_at window_minutes used_percent resets_at');
    if (!uuid.test(row.account_key) || !/^[a-z0-9_:-]{1,80}$/i.test(row.limit_id) ||
        !['primary','secondary'].includes(row.window_key) || !timestamp(row.observed_at) ||
        !Number.isInteger(row.window_minutes) || row.window_minutes<1 || row.window_minutes>525600 ||
        typeof row.used_percent!=='number' || !Number.isFinite(row.used_percent) || row.used_percent<0 ||
        (row.resets_at!==null && !timestamp(row.resets_at))) fail(422,'invalid_quota');
  }
  for (const [group, fieldList] of Object.entries(fields)) {
    for (const row of report[group]) {
      keys(row, fieldList);
      for (const [key, value] of Object.entries(row)) {
        if (value === null && ['repository','started_at','project_observation','parent_agent_id','role','provider','model','input_tokens','cached_input_tokens','output_tokens'].includes(key)) continue;
        if (key === 'agent_id' && group === 'usage' && value === null) continue;
        if (key.endsWith('_id') && !uuid.test(value)) fail(422, 'invalid_id');
        if (key.endsWith('_at') && !timestamp(value)) fail(422, 'invalid_timestamp');
        if (key === 'revision' && (!Number.isSafeInteger(value) || value < 1)) fail(422, 'invalid_revision');
        if (key.endsWith('_tokens') && (!Number.isSafeInteger(value) || value < 0)) fail(422, 'invalid_tokens');
        if (['repository','tool','kind','role','state','provider','model','accounting','summary','summarizer_tool','prompt_version'].includes(key) &&
            (typeof value !== 'string' || !value.trim() || [...value].length > (key === 'summary' || key === 'repository' ? 200 : 100))) fail(422, 'invalid_text');
      }
      if (row.project_observation !== undefined && row.project_observation !== null) {
        keys(row.project_observation, 'state reason_code observed_at');
        if (!timestamp(row.project_observation.observed_at)) fail(422, 'invalid_observation');
      }
    }
  }
}

async function upsert(client, table, key, record, revisioned = false, fixed = []) {
  const columns = Object.keys(record);
  const mutable = columns.filter(column => !key.includes(column) && !fixed.includes(column));
  const equal = (column, prefix = 'EXCLUDED') => `${table}.${column} IS NOT DISTINCT FROM ${prefix}.${column}`;
  const allowed = revisioned
    ? `(${table}.revision < EXCLUDED.revision OR (${columns.map(column => equal(column)).join(' AND ')}))`
    : columns.map(column => equal(column)).join(' AND ');
  const fixedCheck = fixed.length ? ' AND ' + fixed.map(column => equal(column)).join(' AND ') : '';
  const result = await client.query(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')})
     ON CONFLICT (${key.join(',')}) DO UPDATE SET ${mutable.map(column => `${column}=EXCLUDED.${column}`).join(',')}
     WHERE ${allowed}${fixedCheck} RETURNING 1`,
    Object.values(record)
  );
  if (result.rowCount) return;
  if (revisioned) {
    const checks = [...key, ...fixed].map((column, i) => `${column} IS NOT DISTINCT FROM $${i + 1}`);
    const existing = await client.query(`SELECT revision FROM ${table} WHERE ${checks.join(' AND ')}`,
      [...key, ...fixed].map(column => record[column]));
    if (existing.rowCount && BigInt(existing.rows[0].revision) > BigInt(record.revision)) return;
  }
  fail(409, 'record_conflict');
}

export async function ingest(pool, token, raw) {
  if (!token) fail(401, 'invalid_device');
  let report;
  try { report = JSON.parse(raw); } catch { fail(400, 'invalid_json'); }
  validate(report);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const auth = await client.query('SELECT device_id,developer_id FROM devices WHERE credential_digest=$1 AND revoked_at IS NULL FOR UPDATE', [digest(token)]);
    if (!auth.rowCount) fail(401, 'invalid_device');
    const device_id = auth.rows[0].device_id;
    const { batch_id, schema_version, collector_version, sent_at } = report;
    const hash = digest(raw);
    const batch = await client.query('SELECT request_digest FROM ingest_batches WHERE device_id=$1 AND batch_id=$2', [device_id,batch_id]);
    if (batch.rowCount) {
      if (!hash.equals(batch.rows[0].request_digest)) fail(409, 'batch_conflict');
    } else {
      await client.query('INSERT INTO ingest_batches (device_id,batch_id,request_digest,schema_version,collector_version,sent_at) VALUES ($1,$2,$3,$4,$5,$6)', [device_id,batch_id,hash,schema_version,collector_version,sent_at]);
      for (const {tool,repository,project_observation,...session} of report.sessions) {
        const repo = repository ? await client.query("SELECT repository_id FROM repositories WHERE lower(github_host)='github.com' AND lower(full_name)=lower($1)",[repository]) : null;
        await upsert(client,'sessions',['device_id','session_id'],{
          device_id,...session,tool_id:tool,repository_id:repo?.rows[0]?.repository_id ?? null,
          project_state:project_observation?.state ?? null,reason_code:project_observation?.reason_code ?? null,
          observed_at:project_observation?.observed_at ?? null
        },true,['tool_id']);
      }
      for (const row of report.agents) await upsert(client,'agents',['device_id','agent_id'],{device_id,...row},true,['session_id','parent_agent_id','kind']);
      if (report.agents.length) {
        const cycle = await client.query(`WITH RECURSIVE ancestry AS (
          SELECT agent_id,parent_agent_id,ARRAY[agent_id] AS path,false AS cycle FROM agents WHERE device_id=$1 AND agent_id=ANY($2::uuid[])
          UNION ALL
          SELECT a.agent_id,a.parent_agent_id,p.path || a.agent_id,a.agent_id=ANY(p.path)
          FROM ancestry p JOIN agents a ON a.device_id=$1 AND a.agent_id=p.parent_agent_id WHERE NOT p.cycle
        ) SELECT 1 FROM ancestry WHERE cycle LIMIT 1`,[device_id,report.agents.map(agent=>agent.agent_id)]);
        if (cycle.rowCount) fail(422,'agent_cycle');
      }
      for (const row of report.summaries) await upsert(client,'session_summaries',['device_id','summary_id'],{device_id,...row});
      for (const row of report.usage) await upsert(client,'usage_events',['device_id','event_id'],{device_id,...row});
      for (const {account_key,...row} of report.quota || []) {
        const {developer_id}=auth.rows[0];
        const account=await client.query(`INSERT INTO provider_accounts(account_id,developer_id,provider)
          VALUES ($1,$2,'openai') ON CONFLICT (account_id) DO UPDATE SET provider=EXCLUDED.provider
          WHERE provider_accounts.developer_id=EXCLUDED.developer_id AND provider_accounts.provider=EXCLUDED.provider
          RETURNING account_id`,[account_key,developer_id]);
        if(!account.rowCount) fail(409,'account_conflict');
        await upsert(client,'quota_snapshots',['account_id','limit_id','window_key','observed_at'],{account_id:account_key,developer_id,...row});
      }
    }
    await client.query('UPDATE devices SET last_seen_at=now() WHERE device_id=$1',[device_id]);
    await client.query('COMMIT');
    return { batch_id, status:'committed' };
  } catch (error) {
    await client.query('ROLLBACK');
    if (['23503','23514','22P02','22001','22008'].includes(error.code)) fail(422,'invalid_record');
    throw error;
  } finally { client.release(); }
}

export function dashboardCutoff(days, now = Date.now()) {
  // Shift UTC onto Singapore's calendar, then convert its midnight back to UTC.
  const day = 86_400_000;
  const offset = 8 * 3_600_000;
  return new Date((Math.floor((now + offset) / day) - days + 1) * day - offset);
}

export async function dashboard(pool, days) {
  const cutoff = dashboardCutoff(days);
  const queries = [
    [`SELECT d.display_name, t.last_seen_at, t.tool_id, t.full_name, t.last_activity_at
      FROM developers d LEFT JOIN LATERAL (
        SELECT v.last_seen_at,s.tool_id,r.full_name,s.last_activity_at FROM devices v
        LEFT JOIN sessions s USING (device_id) LEFT JOIN repositories r USING (repository_id)
        WHERE v.developer_id=d.developer_id AND v.revoked_at IS NULL
        ORDER BY s.last_activity_at DESC NULLS LAST,v.last_seen_at DESC NULLS LAST LIMIT 1
      ) t ON true ORDER BY d.display_name`,[]],
    [`SELECT r.repository_id,r.full_name,r.business_category,
      CASE WHEN r.completed_at IS NOT NULL THEN 'completed'
           WHEN o.observed_at < now()-interval '60 minutes' THEN 'unknown'
           ELSE coalesce(o.project_state,'unknown') END AS status,
      coalesce((SELECT json_agg(json_build_object('title',m.title,'state',m.state,'due_on',m.due_on) ORDER BY m.position) FROM project_milestones m WHERE m.repository_id=r.repository_id),'[]') AS milestones
      FROM repositories r LEFT JOIN LATERAL (
        SELECT project_state,observed_at FROM sessions WHERE repository_id=r.repository_id AND observed_at IS NOT NULL ORDER BY observed_at DESC,session_id LIMIT 1
      ) o ON true ORDER BY r.full_name`,[]],
    [`SELECT u.provider,u.model,sum(u.input_tokens) AS input_tokens,sum(u.cached_input_tokens) AS cached_input_tokens,
      sum(u.output_tokens) AS output_tokens FROM usage_events u WHERE u.accounting='billable' AND u.occurred_at >= $1
      GROUP BY u.provider,u.model ORDER BY sum(coalesce(u.input_tokens,0)+coalesce(u.output_tokens,0)) DESC`,[cutoff]],
    [`SELECT s.session_id,d.display_name,s.tool_id,r.full_name,s.last_activity_at,x.summary,x.summarizer_tool
      FROM sessions s JOIN devices v USING(device_id) JOIN developers d USING(developer_id) LEFT JOIN repositories r USING(repository_id)
      LEFT JOIN LATERAL (SELECT summary,summarizer_tool FROM session_summaries z WHERE z.device_id=s.device_id AND z.session_id=s.session_id
      ORDER BY observed_at DESC,summary_id LIMIT 1) x ON true WHERE s.last_activity_at >= $1 ORDER BY s.last_activity_at DESC LIMIT 100`,[cutoff]],
    [`SELECT a.kind,a.state,count(*)::int AS count FROM agents a WHERE a.last_activity_at >= $1 GROUP BY a.kind,a.state`,[cutoff]],
    [`SELECT count(*)::int AS count FROM agents WHERE state='running' AND last_activity_at >= now()-interval '60 minutes'`,[]],
    [`SELECT r.full_name,p.* FROM pull_requests p JOIN repositories r USING(repository_id) ORDER BY r.full_name,p.created_at DESC,p.number DESC LIMIT 500`,[]],
    [`SELECT DISTINCT ON (q.account_id,q.limit_id,q.window_key) d.display_name,a.provider,q.limit_id,q.window_key,q.used_percent,q.resets_at,q.observed_at
      FROM quota_snapshots q JOIN provider_accounts a USING(account_id) JOIN developers d ON d.developer_id=q.developer_id
      ORDER BY q.account_id,q.limit_id,q.window_key,q.observed_at DESC`,[]]
  ];
  const [people,projects,models,sessions,agents,running,pulls,quota] = await Promise.all(queries.map(args=>pool.query(...args)));
  return { people:people.rows,projects:projects.rows,models:models.rows,sessions:sessions.rows,agents:agents.rows,
    running:running.rows[0].count,pulls:pulls.rows,quota:quota.rows };
}

export function createApi() {
  if (!process.env.DATABASE_URL) return null;
  if (!process.env.PULSE_VIEW_TOKEN) throw new Error('PULSE_VIEW_TOKEN is required with DATABASE_URL');
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:3000,statement_timeout:5000});
  pool.on('error', error => console.error('Database pool:',error.code || 'error'));
  return {
    close:()=>pool.end(),
    async handle(req,res,url) {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      let data;
      try {
        if (req.method==='POST' && url.pathname==='/api/v1/reports') {
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415,'invalid_content_type');
          const chunks = [];
          let length = 0;
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 256 * 1024) { res.writeHead(413).end(); return; }
            chunks.push(chunk);
          }
          data = await ingest(pool,token,Buffer.concat(chunks));
        } else if (req.method==='GET' && url.pathname==='/api/v1/dashboard') {
          if (!token || !timingSafeEqual(digest(token),digest(process.env.PULSE_VIEW_TOKEN))) fail(401,'login_required');
          const days = Number(url.searchParams.get('days') || 7);
          if (![1,7,30].includes(days)) fail(422,'invalid_days');
          data = await dashboard(pool,days);
        } else fail(404,'not_found');
        res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(data));
      } catch (error) {
        if (!error.status) console.error('Request failed:',error.code || 'error');
        res.writeHead(error.status || 500,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.status ? error.message : 'internal_error'}));
      }
    }
  };
}
