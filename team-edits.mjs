import { createHash, randomUUID } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest();
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail = (status,message) => {throw Object.assign(new Error(message),{status})};
const text = (value,max=200) => typeof value==='string' && value.trim().length>0 && [...value].length<=max &&
  !/https?:\/\/|(?:^|\s)\/\S|[\w.+-]+@[\w.-]+\.[a-z]{2,}|[\x00-\x1f]/i.test(value);
const object = value => value && typeof value==='object' && !Array.isArray(value);
const reasons={on_track:['progress_observed'],blocked:['dependency_unavailable','repeated_failure'],completed:['goal_completed'],paused:['user_paused'],unknown:['insufficient_evidence']};

export function validateTeamEdit(body) {
  if (!object(body) || Object.keys(body).sort().join(' ')!=='device_id expected_version patch reason request_id session_id tool' ||
      !uuid(body.device_id) || !uuid(body.session_id) || !uuid(body.request_id) ||
      !/^[a-f0-9]{64}$/.test(body.expected_version ?? '') || !text(body.reason) ||
      typeof body.tool!=='string' || !/^[a-z][a-z0-9_]{0,63}$/.test(body.tool)) fail(422,'invalid_team_edit');
  const p=body.patch;
  if (!object(p) || !Object.keys(p).length || Object.keys(p).some(k=>!['summary','repository','workspace_name','goal','milestones','status'].includes(k))) fail(422,'invalid_edit_fields');
  if (Object.hasOwn(p,'summary') && !text(p.summary)) fail(422,'invalid_summary');
  if (Object.hasOwn(p,'repository') && p.repository!==null && (typeof p.repository!=='string' || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(p.repository))) fail(422,'invalid_repository');
  if (Object.hasOwn(p,'workspace_name') && !text(p.workspace_name,120)) fail(422,'invalid_workspace');
  if (Object.hasOwn(p,'goal') && !text(p.goal)) fail(422,'invalid_goal');
  if (Object.hasOwn(p,'milestones') && (!Array.isArray(p.milestones) || p.milestones.length<1 || p.milestones.length>12 || p.milestones.some(m=>
    !object(m) || Object.keys(m).sort().join(' ')!=='evidence state title' || !text(m.title,120) || !text(m.evidence) || !['completed','pending'].includes(m.state)))) fail(422,'invalid_milestones');
  if (Object.hasOwn(p,'status') && (!object(p.status) || Object.keys(p.status).sort().join(' ')!=='evidence reason_code state' ||
      !reasons[p.status.state]?.includes(p.status.reason_code) || !text(p.status.evidence))) fail(422,'invalid_project_status');
  return body;
}

async function actor(db,token,lan) {
  const credential=lan?.credential ?? token;
  if (!credential) fail(401,'invalid_device');
  const result=await db.query('SELECT device_id FROM devices WHERE credential_digest=$1 AND revoked_at IS NULL',[hash(credential)]);
  if (!result.rowCount) fail(401,'invalid_device');
  return result.rows[0].device_id;
}

// A single read produces the exact revision the caller must return on write.
const snapshotSql=`SELECT s.device_id,s.session_id,v.developer_id,d.display_name,s.workspace_name,s.repository_id,
  coalesce(r.full_name,s.workspace_name) AS project_key,r.completed_at,s.revision,s.last_activity_at,
  s.project_state,s.reason_code,s.observed_at,s.project_evidence,
  summary.summary_id,summary.summary,summary.observed_at AS summary_observed_at,
  report.report_id,report.goal,report.milestones,report.observed_at AS report_observed_at
  FROM sessions s JOIN devices v USING(device_id) JOIN developers d USING(developer_id)
  LEFT JOIN repositories r USING(repository_id)
  LEFT JOIN LATERAL (SELECT summary_id,summary,observed_at FROM session_summaries z
    WHERE z.device_id=s.device_id AND z.session_id=s.session_id ORDER BY observed_at DESC,summary_id DESC LIMIT 1) summary ON true
  LEFT JOIN LATERAL (SELECT report_id,goal,milestones,observed_at FROM project_reports p
    WHERE p.device_id=s.device_id AND p.source_session_id=s.session_id ORDER BY observed_at DESC,report_id DESC LIMIT 1) report ON true`;
const versioned = row => ({...row,version:hash(JSON.stringify(row)).toString('hex')});
async function snapshot(db,device,session) {
  const result=await db.query(snapshotSql+' WHERE s.device_id=$1 AND s.session_id=$2',[device,session]);
  if (!result.rowCount) fail(404,'session_not_found');
  return versioned(result.rows[0]);
}

export async function listTeamSessions(pool,token,lan,params) {
  await actor(pool,token,lan);
  const offset=Number(params.get('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset<0 || offset>1000000) fail(422,'invalid_offset');
  const device=params.get('device_id'),session=params.get('session_id');
  if ((device!==null && !uuid(device)) || (session!==null && !uuid(session))) fail(422,'invalid_target');
  const rows=await pool.query(snapshotSql+` WHERE ($1::uuid IS NULL OR s.device_id=$1) AND ($2::uuid IS NULL OR s.session_id=$2)
    ORDER BY s.device_id,s.session_id LIMIT 51 OFFSET $3`,[device,session,offset]);
  return {scope:'team',sessions:rows.rows.slice(0,50).map(versioned),next_offset:rows.rows.length>50 ? offset+50 : null};
}

export async function editTeamSession(pool,token,lan,raw) {
  let body;try {body=JSON.parse(raw)} catch {fail(400,'invalid_json')}
  validateTeamEdit(body);
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const editor=await actor(db,token,lan);
    // Same request may arrive concurrently after a transport timeout.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[editor+':'+body.request_id]);
    const prior=await db.query('SELECT request_digest,after_data FROM team_edits WHERE actor_device_id=$1 AND request_id=$2',[editor,body.request_id]);
    if (prior.rowCount) {
      if (!hash(raw).equals(prior.rows[0].request_digest)) fail(409,'request_conflict');
      await db.query('COMMIT');
      return {request_id:body.request_id,status:'committed',replayed:true,session:prior.rows[0].after_data};
    }
    // Ingestion also locks the target device: summaries/reports and sessions cannot race this edit.
    await db.query('SELECT device_id FROM devices WHERE device_id=$1 FOR UPDATE',[body.device_id]);
    const before=await snapshot(db,body.device_id,body.session_id);
    if (before.version!==body.expected_version) fail(409,'edit_version_conflict');
    if (!(await db.query('SELECT 1 FROM tools WHERE tool_id=$1',[body.tool])).rowCount) fail(422,'unknown_tool');
    const p=body.patch;
    let repo=before.repository_id,workspace=p.workspace_name ?? before.workspace_name,project=before.project_key;
    if (Object.hasOwn(p,'repository')) {
      if (p.repository===null) repo=null;
      else {
        const found=await db.query("SELECT repository_id,full_name FROM repositories WHERE lower(github_host)='github.com' AND lower(full_name)=lower($1)",[p.repository]);
        if (!found.rowCount) fail(422,'repository_not_registered');
        repo=found.rows[0].repository_id;project=found.rows[0].full_name;
      }
    }
    if (!repo) project=workspace;
    if (!project) fail(422,'project_identity_required');
    // Report snapshots are append-only; original summaries/reports remain available for audit.
    const goal=p.goal ?? before.goal,milestones=p.milestones ?? before.milestones;
    if ((Object.hasOwn(p,'goal') || Object.hasOwn(p,'milestones')) && (!goal || !milestones)) fail(422,'goal_and_milestones_required');
    await db.query('UPDATE sessions SET repository_id=$3,workspace_name=$4 WHERE device_id=$1 AND session_id=$2',[body.device_id,body.session_id,repo,workspace]);
    if (Object.hasOwn(p,'repository') || Object.hasOwn(p,'workspace_name')) {
      await db.query('UPDATE project_reports SET project_key=$3 WHERE device_id=$1 AND source_session_id=$2',[body.device_id,body.session_id,project]);
    }
    // Use server time, later than any existing imported observation, without changing activity or usage.
    const now=(await db.query(`SELECT greatest(clock_timestamp(),coalesce($1::timestamptz,'epoch')+interval '1 millisecond',
      coalesce($2::timestamptz,'epoch')+interval '1 millisecond',coalesce($3::timestamptz,'epoch')+interval '1 millisecond') AS at`,
      [before.summary_observed_at,before.report_observed_at,before.observed_at])).rows[0].at;
    if (p.summary) await db.query(`INSERT INTO session_summaries(device_id,summary_id,session_id,observed_at,summary,summarizer_tool,prompt_version)
      VALUES ($1,$2,$3,$4,$5,$6,'team-edit-v1')`,[body.device_id,randomUUID(),body.session_id,now,p.summary,body.tool]);
    if (Object.hasOwn(p,'goal') || Object.hasOwn(p,'milestones')) await db.query(`INSERT INTO project_reports
      (device_id,report_id,source_session_id,project_key,goal,milestones,observed_at,summarizer_tool,prompt_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'team-edit-v1')`,
      [body.device_id,randomUUID(),body.session_id,project,goal,JSON.stringify(milestones),now,body.tool]);
    if (p.status) await db.query('UPDATE sessions SET project_state=$3,reason_code=$4,observed_at=$5,project_evidence=$6 WHERE device_id=$1 AND session_id=$2',
      [body.device_id,body.session_id,p.status.state,p.status.reason_code,now,p.status.evidence]);
    if (p.status && repo) await db.query('UPDATE repositories SET completed_at=$2 WHERE repository_id=$1',
      [repo,p.status.state==='completed' ? now : null]);
    const after=await snapshot(db,body.device_id,body.session_id);
    await db.query(`INSERT INTO team_edits(actor_device_id,request_id,target_device_id,session_id,request_digest,reason,before_data,after_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[editor,body.request_id,body.device_id,body.session_id,hash(raw),body.reason,JSON.stringify(before),JSON.stringify(after)]);
    await db.query('COMMIT');
    return {request_id:body.request_id,status:'committed',replayed:false,session:after};
  } catch(error) {await db.query('ROLLBACK');throw error} finally {db.release()}
}

export async function teamEditHistory(pool,token,lan,params) {
  await actor(pool,token,lan);
  const device=params.get('device_id'),session=params.get('session_id');
  if (!uuid(device) || !uuid(session)) fail(422,'invalid_target');
  const result=await pool.query(`SELECT actor_device_id,request_id,reason,before_data,after_data,changed_at
    FROM team_edits WHERE target_device_id=$1 AND session_id=$2 ORDER BY changed_at DESC,request_id LIMIT 50`,[device,session]);
  return {edits:result.rows};
}
