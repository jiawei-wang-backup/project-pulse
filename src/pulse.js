const sessions = [
  ['林晓','Codex','monashmate/web','gpt-5.4',153200,42800,9],
  ['陈宇','Codex','monashmate/api','gpt-5.4',93400,31100,17],
  ['周宁','Codex','monashmate/web','gpt-5.3-codex',81200,15800,24],
  ['林晓','Codex','monashmate/api','gpt-5.3-codex',25300,7100,82],
  ['陈宇','Codex','monashmate/ops','gpt-5.4',44100,9600,158],
  ['周宁','Codex',null,null,null,null,220],
];
const pulls = [
  ['monashmate/web',48,'优化课程搜索和空结果提示'],
  ['monashmate/api',32,'加入课程检索缓存'],
  ['monashmate/ops',11,'增加服务启动检查'],
];
const repos = [...new Set(sessions.map(s => s[2]).filter(Boolean))].sort();
const repo = document.querySelector('#repo');
for (const [label, value] of [['全部仓库',''], ...repos.map(r => [r,r]), ['未归属','unknown']]) {
  repo.add(new Option(label, value));
}
const format = new Intl.NumberFormat('zh-CN');
const num = n => n == null ? '未采集' : format.format(n);
const time = n => n < 60 ? n + ' 分钟前' : Math.floor(n/60) + ' 小时前';
const table = (headers, rows) => rows.length ? '<div class="scroll"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>' : '<p class="empty">暂无数据</p>';
const set = (id, html) => { document.getElementById(id).innerHTML = html; };
function render() {
  const matches = r => !repo.value || (r ?? 'unknown') === repo.value;
  const rows = sessions.filter(s => matches(s[2]));
  const people = new Map();
  const models = new Map();
  for (const [name, tool, project, model, input, output, age] of rows) {
    if (!people.has(name)) people.set(name, [name,tool,project ?? '未归属',time(age)]);
    if (model) {
      const usage = models.get(model) ?? [0,0];
      usage[0] += input ?? 0;
      usage[1] += output ?? 0;
      models.set(model, usage);
    }
  }
  const usageRows = rows.filter(s => s[4] != null && s[5] != null);
  const tokens = usageRows.length ? usageRows.reduce((t,s)=>t+s[4]+s[5],0) : null;
  set('metrics', [['开发人员',people.size],['会话',rows.length],['模型',models.size],['已采集 Token',tokens]].map(([k,v])=>'<div class="metric">'+k+'<strong>'+num(v)+'</strong></div>').join(''));
  set('people',table(['人员','Agent','最近活跃仓库','最近活动'],[...people.values()]));
  set('models',table(['模型','输入 Token','输出 Token'],[...models].map(([m,u])=>[m,...u.map(num)])));
  set('pulls',pulls.filter(p=>matches(p[0])).map(([r,n,title])=>'<div class="row"><strong>#'+n+' '+title+'</strong><span class="muted">'+r+'</span></div>').join('') || '<p class="empty">暂无 PR</p>');
  set('sessions',table(['人员','工具','仓库','模型','Token','最近活动'],rows.map(([n,t,r,m,i,o,a])=>[n,t,r ?? '未归属',m ?? '未知',num(i == null || o == null ? null : i+o),time(a)])));
}
repo.addEventListener('change',render);
render();
