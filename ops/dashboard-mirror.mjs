// Keep the imported dashboard intact. Raw events and upload receipts live in PostgreSQL.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createApi, dashboard, dashboardCutoff } from '../backend.mjs';
import { createPreviewServer } from '../server.mjs';
import { isRunningAgent } from '../src/live-projects.js';

const saved = JSON.parse(await readFile(new URL('../.pulse/dashboard-mirror/current.json', import.meta.url)));
const api = createApi({lanEnrollment:true});
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL, max:4});
const packagePath = new URL('../../project-pulse-report-local-lan.zip', import.meta.url);

// For a replayed session or PR, keep the newest actual observation.
function combine(records, updates, columns, timestamp) {
  const rows = new Map();
  for (const row of [...records, ...updates]) {
    const key = JSON.stringify(columns.map(k => typeof row[k] === 'string' ? row[k].toLowerCase() : row[k]));
    const prior = rows.get(key);
    if (!prior || !timestamp || (row[timestamp] || '') >= (prior[timestamp] || '')) rows.set(key,row);
  }
  return [...rows.values()];
}
function currentView(local,days) {
  const history = saved.windows[30];
  const cutoff = dashboardCutoff(days);
  const recent = row => Date.parse(row.last_activity_at) >= cutoff.getTime();
  const lists = [
    ['projects',['full_name']], ['project_reports',['project_key'],'observed_at'],
    ['people',['display_name'],'last_activity_at'], ['sessions',['session_id'],'last_activity_at'],
    ['agent_details',['agent_id'],'last_activity_at'], ['pulls',['full_name','repository_full_name','number'],'updated_at'],
    ['memberships',['display_name','full_name','workspace_name'],'last_activity_at'],
    ['workspace_states',['workspace_name']], ['quota',['display_name','provider','limit_id','window_key'],'observed_at']
  ];
  for (const [name, keys, time] of lists) {
    const base = ['sessions','agent_details'].includes(name) ? history[name].filter(recent) : history[name];
    local[name] = combine(base,local[name],keys,time);
  }
  local.sessions.sort((a,b)=>b.last_activity_at.localeCompare(a.last_activity_at));
  local.running = local.agent_details.filter(row=>isRunningAgent(row)).length;
  const counts = new Map();
  for (const {kind,state} of local.agent_details) {
    const key = kind + '/' + state;
    const item = counts.get(key) || {kind,state,count:0};
    item.count++;
    counts.set(key,item);
  }
  local.agents = [...counts.values()];
  // Window totals from the old server cannot be added to replays without event IDs.
  // Use its exact totals until local accounting starts or the original window rolls over.
  const sameWindow = +cutoff === +dashboardCutoff(days, Date.parse(saved.capturedAt));
  local.usage_basis = sameWindow && !local.usage_days.length ? 'import' : 'local';
  if (local.usage_basis === 'import') {
    for (const field of ['usage_days','project_usage','session_usage','today_models','models']) local[field] = saved.windows[days][field];
  }
  return local;
}
const server = createPreviewServer({
  async handle(req,res,url) {
    try {
      if (url.pathname === '/api/v1/client-package' && req.method === 'GET') {
        const file = await readFile(packagePath);
        res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="project-pulse-report-local-lan.zip"'}).end(file);
        return;
      }
      if (url.pathname !== '/api/v1/dashboard') return await api.handle(req,res,url);
      if (req.method !== 'GET') return res.writeHead(405).end();
      const days = Number(url.searchParams.get('days') || 7);
      if (![1,7,30].includes(days)) return res.writeHead(422).end();
      const archived = url.searchParams.get('archive') === '1';
      const data = archived ? saved.windows[days] : currentView(JSON.parse(JSON.stringify(await dashboard(pool,days))),days);
      data.imported_at = saved.capturedAt;
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(data));
    } catch (e) {
      console.error('本机看板请求失败',e.code || e.name);
      res.writeHead(503).end();
    }
  },
  async close() { await Promise.all([api.close(),pool.end()]); }
});
server.listen(Number(process.env.PORT || 4185),process.env.PULSE_HOST || '127.0.0.1');
