import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { lookupGitHubUser, resolveGitHubDeveloper } from './github-identity.mjs';

const [action, value, extra] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !value) throw new Error('Set DATABASE_URL and provide an action and value.');
const githubUser = action === 'enroll-github' ? await lookupGitHubUser(value) : null;
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
const db = await pool.connect();
try {
  if (action==='enroll' || githubUser) {
    const device_id=randomUUID();
    const token=randomBytes(32).toString('base64url');
    await db.query('BEGIN');
    const developer_id = githubUser ? await resolveGitHubDeveloper(db, githubUser, extra) : extra || randomUUID();
    if(!githubUser && !extra) await db.query('INSERT INTO developers VALUES ($1,$2)',[developer_id,value]);
    await db.query('INSERT INTO devices(device_id,developer_id,credential_digest) VALUES ($1,$2,$3)',
      [device_id,developer_id,createHash('sha256').update(token).digest()]);
    await db.query('COMMIT');
    console.log(JSON.stringify({developer_id,device_id,device_token:token}));
  } else if(action==='tool') {
    if(!/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new Error('Use a lowercase tool ID.');
    await db.query('INSERT INTO tools (tool_id) VALUES ($1) ON CONFLICT DO NOTHING',[value]);
  } else if(action==='revoke') {
    await db.query('UPDATE devices SET revoked_at=now() WHERE device_id=$1',[value]);
  } else if(action==='repo') {
    if(!/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error('Use owner/repo.');
    const response=await fetch('https://api.github.com/repos/'+value,{headers:process.env.PULSE_GITHUB_TOKEN ? {Authorization:'Bearer '+process.env.PULSE_GITHUB_TOKEN} : {},signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error('GitHub request failed: '+response.status);
    const repo=await response.json();
    await db.query(`INSERT INTO repositories(repository_id,github_host,github_id,full_name,business_category) VALUES ($1,'github.com',$2,$3,$4)
      ON CONFLICT(github_host,github_id) DO UPDATE SET full_name=EXCLUDED.full_name,business_category=EXCLUDED.business_category`,
      [randomUUID(),repo.id,repo.full_name,extra || null]);
    console.log(repo.full_name);
  } else throw new Error('Use enroll NAME [developer_uuid], enroll-github USERNAME [developer_uuid], tool TOOL_ID, revoke DEVICE_UUID, or repo OWNER/REPO [category].');
} catch(error) {
  await db.query('ROLLBACK'); throw error;
} finally { db.release(); await pool.end(); }
