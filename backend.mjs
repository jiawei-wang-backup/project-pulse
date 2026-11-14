import { createHash, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toolId = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value);
const digest = value => createHash('sha256').update(value).digest();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const safeNarrative = (value,max) => typeof value==='string' && value.trim() && [...value].length<=max &&
  !/https?:\/\/|(?:^|\s)\/\S|[\w.+-]+@[\w.-]+\.[a-z]{2,}|[\x00-\x1f]/i.test(value);

function validate(report) {
  const arrays = ['sessions', 'agents', 'summaries', 'usage'];
  const hasQuota = report && Object.hasOwn(report,'quota');
  const hasProjects = report && Object.hasOwn(report,'projects');
  const hasCursor = report && Object.hasOwn(report,'cursor');
  if (hasQuota) arrays.push('quota');
  if (hasProjects) arrays.push('projects');
  const keys = (row, fields) => {
    if (!row || typeof row !== 'object' || Object.keys(row).sort().join(' ') !== fields.split(' ').sort().join(' ')) fail(422, 'invalid_fields');
  };
  keys(report, 'schema_version batch_id sent_at collector_version sessions agents summaries usage' + (hasQuota ? ' quota' : '') + (hasProjects ? ' projects' : '') + (hasCursor ? ' cursor' : ''));
  if (report.schema_version !== 1 || !uuid.test(report.batch_id) ||
      arrays.some(key => !Array.isArray(report[key])) ||
      arrays.reduce((sum, key) => sum + report[key].length, 0) > 100) fail(422, 'invalid_batch');
  if (hasCursor) {
    const {cursor} = report;
    keys(cursor,'source_id from_offset to_offset context');
    if (!uuid.test(cursor.source_id) || !Number.isSafeInteger(cursor.from_offset) ||
        !Number.isSafeInteger(cursor.to_offset) || cursor.from_offset < 0 ||
        cursor.to_offset < cursor.from_offset) fail(422,'invalid_cursor');
    if (cursor.to_offset === cursor.from_offset && (
      cursor.from_offset === 0 || !report.projects?.length ||
      arrays.some(key => key !== 'projects' && report[key].length) ||
      report.projects.some(row => row?.source_session_id !== cursor.source_id)
    )) fail(422,'invalid_project_backfill');
    keys(cursor.context,'model input_tokens cached_input_tokens output_tokens');
    const {model,...counts} = cursor.context;
    if ((model !== null && (typeof model !== 'string' || !/^[\w./:-]{1,100}$/.test(model))) ||
        Object.values(counts).some(value => value !== null && (!Number.isSafeInteger(value) || value < 0))) {
      fail(422,'invalid_cursor_context');
    }
  }
  const fields = {
    sessions: 'session_id tool revision repository started_at last_activity_at project_observation',
    agents: 'agent_id session_id parent_agent_id kind role state last_activity_at revision',
    summaries: 'summary_id session_id observed_at summary summarizer_tool prompt_version',
    usage: 'event_id session_id agent_id occurred_at provider model accounting input_tokens cached_input_tokens output_tokens'
  };
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
  const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) && value.length <= 32;
  if (!timestamp(report.sent_at) || !version(report.collector_version)) fail(422, 'invalid_metadata');
  for (const row of report.projects || []) {
    keys(row,'report_id source_session_id project_key goal milestones observed_at summarizer_tool prompt_version');
    if (!uuid.test(row.report_id) || !uuid.test(row.source_session_id) || !timestamp(row.observed_at) ||
        !toolId(row.summarizer_tool) || !version(row.prompt_version) ||
        typeof row.project_key!=='string' || !/^(?:[\w.-]+\/[\w.-]+|[^\\/:\x00-\x1f\x7f]{1,120})$/.test(row.project_key) ||
        !safeNarrative(row.goal,200) ||
        !Array.isArray(row.milestones) || row.milestones.length<1 || row.milestones.length>12) fail(422,'invalid_project_report');
    for(const milestone of row.milestones) {
      keys(milestone,'title state evidence');
      if(!safeNarrative(milestone.title,120) || !['completed','pending'].includes(milestone.state) ||
         !safeNarrative(milestone.evidence,200)) fail(422,'invalid_project_milestone');
    }
  }
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
      keys(row, fieldList + (group === 'sessions' ? ['title','workspace_name'].filter(key => Object.hasOwn(row || {},key)).map(key => ' '+key).join('') : ''));
      if (row.workspace_name !== undefined && (typeof row.workspace_name !== 'string' ||
          !row.workspace_name.trim() || [...row.workspace_name].length > 120 ||
          /[\\/:\x00-\x1f\x7f]/.test(row.workspace_name) ||
          ['.','..'].includes(row.workspace_name))) fail(422,'invalid_workspace_name');
      if (hasCursor && group === 'summaries' && !safeNarrative(row.summary,200)) fail(422,'invalid_summary');
      if (row.title !== undefined && (typeof row.title !== 'string' || !row.title.trim() || [...row.title].length > 120)) fail(422, 'invalid_title');
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

function lanIdentity(deviceKey, labelHeader) {
  if (typeof deviceKey !== 'string' || !/^[a-f0-9]{64}$/.test(deviceKey)) fail(401,'invalid_lan_device');
  const hex = digest('project-pulse-lan:' + deviceKey).toString('hex');
  const id = [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
  let label = '';
  if (labelHeader !== undefined) {
    try { label = decodeURIComponent(labelHeader).trim(); }
    catch { fail(422,'invalid_lan_label'); }
    if (!/^[\p{L}\p{M}\p{N} _.@()-]{1,80}$/u.test(label)) fail(422,'invalid_lan_label');
  }
  const placeholder = '局域网设备 ' + hex.slice(0,12);
  return {id, credential: 'lan:' + deviceKey, placeholder, name: label ? label + ' · ' + hex.slice(0,12) : placeholder};
}

export async function ingest(pool, token, raw, lan = null) {
  if (!token && !lan) fail(401, 'invalid_device');
  let report;
  try { report = JSON.parse(raw); } catch { fail(400, 'invalid_json'); }
  validate(report);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (lan) {
      if (!report.cursor) fail(422,'cursor_required');
      await client.query('INSERT INTO developers(developer_id,display_name) VALUES ($1,$2) ON CONFLICT DO NOTHING',[lan.id,lan.name]);
      await client.query('INSERT INTO devices(device_id,developer_id,credential_digest) VALUES ($1,$1,$2) ON CONFLICT DO NOTHING',
        [lan.id,digest(lan.credential)]);
    }
    const auth = await client.query('SELECT device_id,developer_id FROM devices WHERE credential_digest=$1 AND revoked_at IS NULL FOR UPDATE', [digest(lan?.credential ?? token)]);
    if (!auth.rowCount) fail(401, 'invalid_device');
    const device_id = auth.rows[0].device_id;
    if (lan && lan.name !== lan.placeholder && auth.rows[0].developer_id === lan.id) {
      await client.query('UPDATE developers SET display_name=$2 WHERE developer_id=$1 AND display_name=$3',
        [lan.id,lan.name,lan.placeholder]);
    }
    const { batch_id, schema_version, collector_version, sent_at, cursor } = report;
    const hash = digest(raw);
    const batch = await client.query('SELECT request_digest FROM ingest_batches WHERE device_id=$1 AND batch_id=$2', [device_id,batch_id]);
    if (batch.rowCount) {
      if (!hash.equals(batch.rows[0].request_digest)) fail(409, 'batch_conflict');
    } else {
      if (cursor) {
        const previous = await client.query('SELECT byte_offset FROM report_cursors WHERE device_id=$1 AND source_id=$2',
          [device_id,cursor.source_id]);
        if (BigInt(previous.rows[0]?.byte_offset ?? 0) !== BigInt(cursor.from_offset)) fail(409,'cursor_conflict');
        if (cursor.to_offset > cursor.from_offset) await client.query(`INSERT INTO report_cursors(device_id,source_id,byte_offset,context) VALUES ($1,$2,$3,$4)
          ON CONFLICT(device_id,source_id) DO UPDATE SET byte_offset=EXCLUDED.byte_offset,context=EXCLUDED.context`,
          [device_id,cursor.source_id,cursor.to_offset,cursor.context]);
      }
      await client.query('INSERT INTO ingest_batches (device_id,batch_id,request_digest,schema_version,collector_version,sent_at) VALUES ($1,$2,$3,$4,$5,$6)', [device_id,batch_id,hash,schema_version,collector_version,sent_at]);
      for (const {tool,repository,project_observation,...session} of report.sessions) {
        const repo = repository ? await client.query("SELECT repository_id FROM repositories WHERE lower(github_host)='github.com' AND lower(full_name)=lower($1)",[repository]) : null;
        await upsert(client,'sessions',['device_id','session_id'],{
          device_id,...session,tool_id:tool,repository_id:repo?.rows[0]?.repository_id ?? null,
          ...(cursor && project_observation === null ? {} : {
            project_state:project_observation?.state ?? null,reason_code:project_observation?.reason_code ?? null,
            observed_at:project_observation?.observed_at ?? null
          })
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
      for (const row of report.projects || []) await upsert(client,'project_reports',['device_id','report_id'],{device_id,...row,milestones:JSON.stringify(row.milestones)});
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
    return { batch_id, status:'committed', ...(cursor ? {to_offset:cursor.to_offset} : {}) };
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
    [`SELECT d.display_name, t.last_seen_at, t.tool_id, t.full_name, t.workspace_name, t.last_activity_at
      FROM developers d LEFT JOIN LATERAL (
        SELECT v.last_seen_at,s.tool_id,r.full_name,s.workspace_name,s.last_activity_at FROM devices v
        LEFT JOIN sessions s USING (device_id) LEFT JOIN repositories r USING (repository_id)
        WHERE v.developer_id=d.developer_id AND v.revoked_at IS NULL
        ORDER BY s.last_activity_at DESC NULLS LAST,v.last_seen_at DESC NULLS LAST LIMIT 1
      ) t ON true ORDER BY d.display_name`,[]],
    [`SELECT r.repository_id,r.full_name,r.business_category,
      CASE WHEN r.completed_at IS NOT NULL THEN 'completed'
           ELSE coalesce(o.project_state,'unknown') END AS status,
      coalesce((SELECT json_agg(json_build_object('title',m.title,'state',m.state,'due_on',m.due_on) ORDER BY m.position) FROM project_milestones m WHERE m.repository_id=r.repository_id),'[]') AS milestones
      FROM repositories r LEFT JOIN LATERAL (
        SELECT project_state,observed_at FROM sessions WHERE repository_id=r.repository_id AND observed_at IS NOT NULL AND project_state IN ('blocked','on_track') ORDER BY observed_at DESC,session_id LIMIT 1
      ) o ON true ORDER BY r.full_name`,[]],
    [`SELECT u.provider,u.model,sum(u.input_tokens) AS input_tokens,sum(u.cached_input_tokens) AS cached_input_tokens,
      sum(u.output_tokens) AS output_tokens FROM usage_events u WHERE u.accounting='billable' AND u.occurred_at >= $1
      GROUP BY u.provider,u.model ORDER BY sum(coalesce(u.input_tokens,0)+coalesce(u.output_tokens,0)) DESC`,[cutoff]],
    [`SELECT s.session_id,s.title,coalesce(s.display_title, s.title) AS display_title,d.display_name,s.tool_id,r.full_name,s.workspace_name,s.last_activity_at,x.summary,x.summarizer_tool
      FROM sessions s JOIN devices v USING(device_id) JOIN developers d USING(developer_id) LEFT JOIN repositories r USING(repository_id)
      LEFT JOIN LATERAL (SELECT summary,summarizer_tool FROM session_summaries z WHERE z.device_id=s.device_id AND z.session_id=s.session_id
      ORDER BY observed_at DESC,summary_id LIMIT 1) x ON true WHERE s.last_activity_at >= $1 ORDER BY s.last_activity_at DESC LIMIT 100`,[cutoff]],
    [`SELECT a.kind,a.state,count(*)::int AS count FROM agents a WHERE a.last_activity_at >= $1 GROUP BY a.kind,a.state`,[cutoff]],
    [`SELECT count(*)::int AS count FROM agents WHERE state='running' AND last_activity_at >= now()-interval '60 minutes'`,[]],
    [`SELECT r.full_name,p.* FROM pull_requests p JOIN repositories r USING(repository_id) ORDER BY r.full_name,p.created_at DESC,p.number DESC LIMIT 500`,[]],
    [`SELECT DISTINCT ON (q.account_id,q.limit_id,q.window_key) d.display_name,a.provider,q.limit_id,q.window_key,q.used_percent,q.resets_at,q.observed_at
      FROM quota_snapshots q JOIN provider_accounts a USING(account_id) JOIN developers d ON d.developer_id=q.developer_id
      ORDER BY q.account_id,q.limit_id,q.window_key,q.observed_at DESC`,[]],
    [`SELECT a.agent_id,a.kind,a.role,a.state,a.last_activity_at,s.session_id,s.display_title,s.title,s.tool_id,s.workspace_name,r.full_name,d.display_name,u.provider,u.model
      FROM agents a JOIN sessions s ON s.device_id=a.device_id AND s.session_id=a.session_id
      JOIN devices v ON v.device_id=a.device_id JOIN developers d ON d.developer_id=v.developer_id
      LEFT JOIN repositories r ON r.repository_id=s.repository_id
      LEFT JOIN LATERAL (SELECT provider,model FROM usage_events WHERE device_id=a.device_id AND session_id=a.session_id
        ORDER BY occurred_at DESC LIMIT 1) u ON true
      WHERE a.last_activity_at >= $1 ORDER BY a.last_activity_at DESC LIMIT 100`,[cutoff]],
    [`SELECT to_char(u.occurred_at AT TIME ZONE 'Asia/Singapore','YYYY-MM-DD') AS day,
      sum(u.input_tokens) AS input_tokens,sum(u.output_tokens) AS output_tokens
      FROM usage_events u WHERE u.accounting='billable' AND u.occurred_at >= $1
      GROUP BY day ORDER BY day`,[cutoff]],
    [`SELECT DISTINCT ON (project_key) project_key,goal,milestones,observed_at,summarizer_tool
      FROM project_reports ORDER BY project_key,observed_at DESC,report_id DESC`,[]],
    [`SELECT coalesce(r.full_name,s.workspace_name) AS project_key,
      sum(coalesce(u.input_tokens,0)) AS input_tokens,sum(coalesce(u.output_tokens,0)) AS output_tokens
      FROM usage_events u JOIN sessions s ON s.device_id=u.device_id AND s.session_id=u.session_id
      LEFT JOIN repositories r ON r.repository_id=s.repository_id
      WHERE u.accounting='billable' AND u.occurred_at >= $1
      GROUP BY coalesce(r.full_name,s.workspace_name) ORDER BY sum(coalesce(u.input_tokens,0)+coalesce(u.output_tokens,0)) DESC`,[cutoff]],
    [`SELECT u.session_id,sum(coalesce(u.input_tokens,0)) AS input_tokens,
      sum(coalesce(u.output_tokens,0)) AS output_tokens
      FROM usage_events u WHERE u.accounting='billable' AND u.occurred_at >= $1
      GROUP BY u.session_id`,[cutoff]],
    [`SELECT d.display_name,r.full_name,s.workspace_name,count(DISTINCT s.session_id)::int AS session_count,
      max(s.last_activity_at) AS last_activity_at
      FROM sessions s JOIN devices v USING(device_id) JOIN developers d USING(developer_id)
      LEFT JOIN repositories r USING(repository_id)
      WHERE s.last_activity_at >= $1
      GROUP BY d.display_name,r.full_name,s.workspace_name ORDER BY d.display_name,last_activity_at DESC`,[cutoff]]
  ];
  queries.push([`SELECT DISTINCT ON (workspace_name) workspace_name,project_state AS status
    FROM sessions WHERE repository_id IS NULL AND workspace_name IS NOT NULL
      AND observed_at IS NOT NULL AND project_state IN ('blocked','on_track')
    ORDER BY workspace_name,observed_at DESC,session_id`,[]]);
  queries.push([`SELECT provider, model, sum(input_tokens) AS input_tokens,
    sum(cached_input_tokens) AS cached_input_tokens, sum(output_tokens) AS output_tokens
    FROM usage_events WHERE accounting='billable' AND occurred_at >= $1 AND occurred_at <= now()
    GROUP BY provider, model`, [dashboardCutoff(1)]]);
  const [people,projects,models,sessions,agents,running,pulls,quota,agentDetails,usageDays,projectReports,projectUsage,sessionUsage,memberships,workspaceStates,todayModels] = await Promise.all(queries.map(args=>pool.query(...args)));
  return { people:people.rows,projects:projects.rows,models:models.rows,sessions:sessions.rows,agents:agents.rows,
    running:running.rows[0].count,pulls:pulls.rows,quota:quota.rows,agent_details:agentDetails.rows,usage_days:usageDays.rows,
    project_reports:projectReports.rows,project_usage:projectUsage.rows,session_usage:sessionUsage.rows,memberships:memberships.rows,workspace_states:workspaceStates.rows,today_models:todayModels.rows };
}

async function reportCursor(pool, token, sourceId, lan = null) {
  if (!token && !lan) fail(401,'invalid_device');
  if (!uuid.test(sourceId ?? '')) fail(422,'invalid_source_id');
  const result = await pool.query(`SELECT c.byte_offset,c.context,project.report,
    ARRAY(SELECT full_name FROM repositories WHERE lower(github_host)='github.com' ORDER BY full_name) AS repositories
    FROM (SELECT 1) seed
    LEFT JOIN devices d ON d.credential_digest=$1
    LEFT JOIN report_cursors c ON c.device_id=d.device_id AND c.source_id=$2
    LEFT JOIN sessions s ON s.device_id=d.device_id AND s.session_id=$2
    LEFT JOIN repositories r USING (repository_id)
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('goal',p.goal,'milestones',p.milestones,'observed_at',p.observed_at) AS report
      FROM project_reports p WHERE p.device_id=d.device_id
        AND p.project_key=coalesce(r.full_name,s.workspace_name)
      ORDER BY p.observed_at DESC,p.report_id DESC LIMIT 1
    ) project ON true
    WHERE d.revoked_at IS NULL AND (d.device_id IS NOT NULL OR $3::boolean)`,
    [digest(lan?.credential ?? token),sourceId,Boolean(lan)]);
  if (!result.rowCount) fail(401,'invalid_device');
  const {byte_offset,context,repositories,report} = result.rows[0];
  return {source_id:sourceId,offset:Number(byte_offset ?? 0),context,repositories,project_report:report};
}

async function reportDirectory(pool, lan) {
  const [members, repositories, current] = await Promise.all([
    pool.query(`SELECT d.display_name,g.github_login,
      ARRAY(SELECT DISTINCT r.full_name FROM devices v JOIN sessions s USING (device_id)
        JOIN repositories r USING (repository_id)
        WHERE v.developer_id=d.developer_id AND v.revoked_at IS NULL ORDER BY r.full_name) AS observed_projects
      FROM developers d LEFT JOIN github_identities g USING (developer_id)
      WHERE g.github_user_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM devices v WHERE v.developer_id=d.developer_id AND v.device_id<>d.developer_id AND v.revoked_at IS NULL
      ) ORDER BY d.display_name,d.developer_id`),
    pool.query(`SELECT full_name,'https://github.com/' || full_name AS url
      FROM repositories WHERE lower(github_host)='github.com' ORDER BY full_name`),
    pool.query(`SELECT v.revoked_at,d.display_name FROM devices v JOIN developers d USING (developer_id)
      WHERE v.credential_digest=$1`,[digest(lan.credential)])
  ]);
  if (current.rows[0]?.revoked_at) fail(401,'invalid_device');
  return {members:members.rows,repositories:repositories.rows,
    current_display_name:current.rows[0]?.display_name ?? null};
}

export function createApi({localView = false, lanEnrollment = false} = {}) {
  if (!process.env.DATABASE_URL) return null;
  if (!localView && !process.env.PULSE_VIEW_TOKEN) throw new Error('PULSE_VIEW_TOKEN is required with DATABASE_URL');
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:3000,statement_timeout:5000});
  pool.on('error', error => console.error('Database pool:',error.code || 'error'));
  return {
    close:()=>pool.end(),
    async handle(req,res,url) {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      let data;
      try {
        const deviceKey = req.headers['x-pulse-lan-device'];
        const lan = lanEnrollment && !req.headers.authorization && deviceKey !== undefined ? lanIdentity(deviceKey,req.headers['x-pulse-lan-label']) : null;
        if (req.method==='POST' && url.pathname==='/api/v1/reports') {
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415,'invalid_content_type');
          const chunks = [];
          let length = 0;
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 256 * 1024) { res.writeHead(413).end(); return; }
            chunks.push(chunk);
          }
          data = await ingest(pool,token,Buffer.concat(chunks),lan);
        } else if (req.method==='GET' && url.pathname==='/api/v1/report-directory' && lanEnrollment) {
          if (!lan) fail(401,'invalid_lan_device');
          data = await reportDirectory(pool,lan);
        } else if (req.method==='GET' && url.pathname==='/api/v1/report-cursor') {
          res.setHeader('Cache-Control','no-store');
          data = await reportCursor(pool,token,url.searchParams.get('source_id'),lan);
        } else if (req.method==='GET' && url.pathname==='/api/v1/dashboard') {
          if (localView) {
            const host = req.headers.host || '';
            if (!/^(127\.0\.0\.1|localhost)(:[0-9]+)?$/i.test(host) ||
                !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
                (req.headers.origin && req.headers.origin !== 'http://' + host)) fail(403,'local_view_only');
          } else if (!token || !timingSafeEqual(digest(token),digest(process.env.PULSE_VIEW_TOKEN))) fail(401,'login_required');
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
