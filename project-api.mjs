import { createHash, timingSafeEqual } from 'node:crypto';

export function validServiceToken(header, secret) {
  if (!secret || secret.length < 32 || typeof header !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(header).digest(), createHash('sha256').update(`Bearer ${secret}`).digest());
}
export function projectGranted(id, grants = '') {
  return /^[0-9a-f-]{36}$/i.test(id) && grants.split(',').map(x => x.trim()).includes(id);
}

/** Every query is anchored to the repository UUID. No global dashboard is fetched or filtered. */
export async function projectSnapshot(pool, id, days = 7) {
  const result = await pool.query('SELECT repository_id,full_name,completed_at FROM repositories WHERE repository_id=$1', [id]);
  if (!result.rows[0]) return null;
  const now = new Date();
  const since = new Date(now.getTime() - days * 86400000);
  const params = [id, since, now];
  const [usage, models, members, activity, pulls, milestones, reports, observations] = await Promise.all([
    pool.query(`SELECT sum(u.input_tokens)::text AS input_tokens,sum(u.cached_input_tokens)::text AS cached_input_tokens,sum(u.output_tokens)::text AS output_tokens,count(*)::int AS events,max(u.occurred_at) AS updated_at FROM usage_events u JOIN sessions s USING(device_id,session_id) WHERE s.repository_id=$1 AND u.accounting='billable' AND u.occurred_at BETWEEN $2 AND $3`,params),
    pool.query(`SELECT u.provider,u.model,sum(u.input_tokens)::text AS input_tokens,sum(u.cached_input_tokens)::text AS cached_input_tokens,sum(u.output_tokens)::text AS output_tokens FROM usage_events u JOIN sessions s USING(device_id,session_id) WHERE s.repository_id=$1 AND u.accounting='billable' AND u.occurred_at BETWEEN $2 AND $3 GROUP BY u.provider,u.model ORDER BY sum(coalesce(u.input_tokens,0)+coalesce(u.output_tokens,0)) DESC`,params),
    pool.query(`SELECT d.developer_id,d.display_name,max(s.last_activity_at) AS last_activity_at,count(DISTINCT (s.device_id,s.session_id))::int AS sessions FROM sessions s JOIN devices v USING(device_id) JOIN developers d USING(developer_id) WHERE s.repository_id=$1 GROUP BY d.developer_id,d.display_name ORDER BY max(s.last_activity_at) DESC LIMIT 100`,[id]),
    pool.query(`SELECT d.developer_id,d.display_name,sum(u.input_tokens)::text AS input_tokens,sum(u.cached_input_tokens)::text AS cached_input_tokens,sum(u.output_tokens)::text AS output_tokens FROM usage_events u JOIN sessions s USING(device_id,session_id) JOIN devices v ON v.device_id=s.device_id JOIN developers d USING(developer_id) WHERE s.repository_id=$1 AND u.accounting='billable' AND u.occurred_at BETWEEN $2 AND $3 GROUP BY d.developer_id,d.display_name`,params),
    pool.query('SELECT number,title,url,state,is_draft,created_at,updated_at FROM pull_requests WHERE repository_id=$1 ORDER BY updated_at DESC LIMIT 50',[id]),
    pool.query('SELECT milestone_id,title,state,due_on FROM project_milestones WHERE repository_id=$1 ORDER BY position LIMIT 100',[id]),
    pool.query(`SELECT p.goal,p.milestones,p.observed_at FROM project_reports p JOIN sessions s ON s.device_id=p.device_id AND s.session_id=p.source_session_id WHERE s.repository_id=$1 ORDER BY p.observed_at DESC LIMIT 1`,[id]),
    pool.query(`SELECT project_state,to_jsonb(s)->>'project_evidence' AS project_evidence,observed_at FROM sessions s WHERE repository_id=$1 AND observed_at IS NOT NULL ORDER BY observed_at DESC LIMIT 1`,[id]),
  ]);
  const recent = await pool.query(`SELECT s.session_id,coalesce(s.display_title,s.title) AS title,s.last_activity_at,d.developer_id,d.display_name,x.summary FROM sessions s JOIN devices v USING(device_id) JOIN developers d USING(developer_id) LEFT JOIN LATERAL (SELECT summary FROM session_summaries z WHERE z.device_id=s.device_id AND z.session_id=s.session_id ORDER BY observed_at DESC LIMIT 1) x ON true WHERE s.repository_id=$1 AND s.last_activity_at BETWEEN $2 AND $3 ORDER BY s.last_activity_at DESC LIMIT 30`,params);
  const owners = JSON.parse(process.env.PULSE_PROJECT_OWNERS || '{}');
  const ownerId = owners[id];
  const owner = ownerId ? (await pool.query('SELECT developer_id,display_name FROM developers WHERE developer_id=$1',[ownerId])).rows[0] ?? null : null;
  const accepted = milestones.rows.filter(m => m.state === 'accepted').length;
  return {
    project: {...result.rows[0],status:result.rows[0].completed_at ? 'completed' : observations.rows[0]?.project_state ?? 'unknown',owner},
    window:{days,since:since.toISOString(),until:now.toISOString()},
    fetched_at:now.toISOString(), source:'Project Pulse PostgreSQL / repository_id',
    usage:usage.rows[0],models:models.rows,
    members:members.rows.map(m => ({...m,role:m.developer_id === ownerId ? '负责人（显式配置）' : '参与成员（岗位未配置）',usage:activity.rows.find(a => a.developer_id===m.developer_id) ?? null})),
    activities:recent.rows,pulls:pulls.rows,milestones:milestones.rows,
    milestone_progress:milestones.rows.length ? {accepted,total:milestones.rows.length,percent:Math.round(100*accepted/milestones.rows.length)} : null,
    latest_report:reports.rows[0] ?? null, observation:observations.rows[0] ?? null,
    cost:{amount:null,label:'缺少已核对的模型价格或账单，不估造费用'},
    quota:{scope:'account',status:'not_shared',reason:'账号级额度不归属于单个项目；未单独授权展示'},
    caveats:['cached_input_tokens 是 input_tokens 的子集，不重复累加','Token 为所选时间窗，不是项目生命周期累计','参与成员不等于项目负责人；Agent 结束不等于项目完成','PR 合并不等于业务验收；缺少任务系统时不推测延期'],
  };
}
