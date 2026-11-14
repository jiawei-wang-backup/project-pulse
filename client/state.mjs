import { readFile, stat, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tables = {config:'key',repo_cache:'cwd',files:'path',sessions:'id',child_agents:'id',counts:'id',seen:'id',windows:'id',outbox:'id'};

export async function loadState(root) {
  const path = join(root,'state.json');
  let rows;
  try { rows = JSON.parse(await readFile(path,'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    rows = {};
    try { await stat(join(root,'state.sqlite')).then(() => { rows = null; }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (rows === null) {
      const { DatabaseSync } = await import('node:sqlite');
      const legacy = new DatabaseSync(join(root,'state.sqlite'),{readOnly:true});
      try {
        rows = Object.fromEntries(Object.keys(tables).map(table => [table,
          legacy.prepare('SELECT 1 FROM sqlite_master WHERE name=? AND type=\'table\'').get(table)
            ? legacy.prepare('SELECT * FROM '+table+' ORDER BY rowid').all() : []]));
      } finally { legacy.close(); }
    }
  }
  const state = Object.fromEntries(Object.entries(tables).map(([table,key]) => [table,
    new Map((rows[table] || []).map(row => [row[key],row]))]));
  async function save() {
    const temp=path+'.'+randomUUID();
    const file=await open(temp,'wx',0o600);
    try {
      try {
        await file.writeFile(JSON.stringify(Object.fromEntries(Object.entries(state).map(([key,map])=>[key,[...map.values()]]))));
        await file.sync();
      } finally { await file.close(); }
      await rename(temp,path);
    } finally { await unlink(temp).catch(error=>{if(error.code!=='ENOENT') throw error;}); }
  }
  return {state,save};
}
