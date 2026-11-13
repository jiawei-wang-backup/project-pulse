import pg from 'pg';

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const db=await pool.connect();
const headers={Accept:'application/vnd.github+json'};
if(process.env.PULSE_GITHUB_TOKEN) headers.Authorization='Bearer '+process.env.PULSE_GITHUB_TOKEN;

async function sync(repo) {
  const started=new Date();
  const cutoff=repo.pr_sync_cursor ? +repo.pr_sync_cursor-5*60000 : null;
  const rows=[];
  for(let page=1;page<=10;page++) {
    const url=new URL('https://api.github.com/repos/'+repo.full_name+'/pulls');
    url.search=new URLSearchParams({state:'all',sort:cutoff?'updated':'created',direction:'desc',per_page:100,page});
    const response=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error('GitHub status '+response.status);
    const items=await response.json();
    rows.push(...items.filter(item=>!cutoff || Date.parse(item.updated_at)>=cutoff));
    if(!cutoff || items.length<100 || Date.parse(items.at(-1)?.updated_at)<cutoff) break;
    if(page===10) throw new Error('PR delta exceeds page budget');
  }
  await db.query('BEGIN');
  try {
    for(const item of rows) await db.query(`INSERT INTO pull_requests(repository_id,number,title,url,state,is_draft,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (repository_id,number) DO UPDATE SET title=EXCLUDED.title,url=EXCLUDED.url,state=EXCLUDED.state,
        is_draft=EXCLUDED.is_draft,updated_at=EXCLUDED.updated_at WHERE pull_requests.updated_at <= EXCLUDED.updated_at`,
      [repo.repository_id,item.number,item.title,item.html_url,item.merged_at?'merged':item.state,!!item.draft,item.created_at,item.updated_at]);
    await db.query('UPDATE repositories SET last_pr_sync_at=now(),pr_sync_cursor=$2 WHERE repository_id=$1',[repo.repository_id,started]);
    await db.query('COMMIT');
  } catch(error) { await db.query('ROLLBACK'); throw error; }
}
try {
  const lock=await db.query('SELECT pg_try_advisory_lock(1791607) AS acquired');
  if(lock.rows[0].acquired) {
    const repos=await db.query("SELECT repository_id,full_name,pr_sync_cursor FROM repositories WHERE lower(github_host)='github.com'");
    for(const repo of repos.rows) {
      try { await sync(repo); } catch(error) { console.error(repo.full_name,error.message); process.exitCode=1; }
    }
  }
} finally { db.release(); await pool.end(); }
