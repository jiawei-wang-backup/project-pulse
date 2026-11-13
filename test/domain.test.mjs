import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { projects, tasks, runs, usage, models } from '../src/data.js';
import {
  progressOf, periodBounds, recordsFor, sumUsage, trendFor, breakdownFor, usageForRun,
  activityFor, filterProjects, routeFrom, overviewMetrics, escapeHtml, money
} from '../src/domain.js';
import { createPreviewServer } from '../server.mjs';
import { trendChart } from '../src/charts.js';

test('总体进度只统计已验收里程碑，并明确区分未规划', () => {
  assert.equal(progressOf({ milestones: [] }), null);
  assert.equal(progressOf({ milestones: [{ state: 'review' }, { state: 'planned' }] }), 0);
  assert.equal(progressOf({ milestones: [{ state: 'accepted' }, { state: 'review' }, { state: 'planned' }] }), 33);
  assert.equal(progressOf({ milestones: [{ state: 'accepted' }, { state: 'accepted' }] }), 100);
});
test('AI 完成和任务完成不会自动提高里程碑验收进度', () => {
  const project = structuredClone(projects[0]);
  project.tasks = [{ column: 'done' }];
  project.runs = [{ state: 'completed' }];
  assert.equal(progressOf(project), 60);
  project.milestones.find(item => item.state === 'review').state = 'accepted';
  assert.equal(progressOf(project), 80);
});
test('所有演示实体关联完整，状态覆盖所需场景', () => {
  assert.equal(projects.length, 6);
  assert.deepEqual(new Set(projects.map(item => item.status)), new Set(['on_track', 'attention', 'blocked', 'completed', 'planned']));
  for (const task of tasks) {
    const project = projects.find(item => item.id === task.projectId);
    assert.ok(project);
    assert.ok(!task.milestoneId || project.milestones.some(item => item.id === task.milestoneId));
  }
  for (const execution of runs) {
    assert.ok(tasks.some(item => item.id === execution.taskId && item.projectId === execution.projectId));
    assert.ok(models.some(item => item.id === execution.modelId));
    assert.ok(usage.some(item => item.runId === execution.id), `执行记录 ${execution.id} 应有可追溯用量`);
  }
  assert.deepEqual(new Set(runs.map(item => item.state)), new Set(['running', 'review', 'blocked', 'completed', 'idle']));
});
test('按 +08:00 自然日包含边界，排除前一天与快照之后的数据', () => {
  const { start, end } = periodBounds(1);
  assert.equal(new Date(start).toISOString(), '2026-11-11T16:00:00.000Z');
  const source = [start - 1, start, end, end + 1].map((timestamp, index) => ({ projectId: 'test', timestamp: new Date(timestamp).toISOString(), id: index }));
  assert.deepEqual(recordsFor('test', 1, source).map(item => item.id), [1, 2]);
  assert.equal(periodBounds('invalid').days, 7);
});
for (const period of [1, 7, 30]) {
  test(`${period} 天：全局、各项目、趋势图及模型分布完全同源`, () => {
    const global = sumUsage(recordsFor(null, period));
    assert.deepEqual(sumUsage(projects.map(project => sumUsage(recordsFor(project.id, period)))), global);
    assert.deepEqual(sumUsage(trendFor(null, period)), global);
    assert.deepEqual(sumUsage(breakdownFor(null, period)), global);
    assert.equal(overviewMetrics(period).costMicros, global.costMicros);
    // 演示值精确到美分，避免页面上各项目显示值相加出现一美分差异。
    assert.equal(global.costMicros % 10_000, 0);
    const displayedSum = projects.reduce((sum, project) => sum + Number(money(sumUsage(recordsFor(project.id, period)).costMicros).replace(/[$,]/g, '')), 0);
    assert.equal(Math.round(displayedSum * 100), global.costMicros / 10_000);
    for (const project of projects) {
      assert.deepEqual(sumUsage(trendFor(project.id, period)), sumUsage(recordsFor(project.id, period)));
      assert.deepEqual(sumUsage(breakdownFor(project.id, period)), sumUsage(recordsFor(project.id, period)));
    }
  });
}
test('抽屉消耗只属于对应执行，不扩大项目汇总', () => {
  assert.equal(new Set(usage.filter(item => item.runId).map(item => item.runId)).size, runs.length);
  for (const execution of runs) assert.deepEqual(usageForRun(execution.id), sumUsage(usage.filter(item => item.runId === execution.id)));
  assert.ok(sumUsage(usage).costMicros >= sumUsage(runs.map(item => usageForRun(item.id))).costMicros);
});
test('低消耗图表保留准确的坐标轴小数，避免标签重复', () => {
  const chart = trendChart('live-monitor', 1);
  const labels = [...chart.matchAll(/class="axis-text">\$([\d.]+)<\/text>/g)].map(match => Number(match[1]));
  assert.equal(labels.length, 4);
  assert.equal(new Set(labels).size, 4);
  assert.equal(labels.at(-1), 0);
  assert.ok(labels[1] > labels[2] && labels[2] > labels[3]);
});
test('没有里程碑、运行任务或用量的项目保留明确空状态', () => {
  const project = projects.find(item => item.status === 'planned');
  assert.equal(progressOf(project), null);
  assert.deepEqual(sumUsage(recordsFor(project.id, 30)), { inputTokens: 0, outputTokens: 0, costMicros: 0 });
  assert.equal(activityFor(project.id, 30).length, 0);
  assert.equal(trendFor(project.id, 7).length, 7);
});
test('时间范围影响历史活动，不改变当前运行数', () => {
  assert.ok(activityFor(null, 30).length > activityFor(null, 1).length);
  assert.equal(overviewMetrics(1).running, overviewMetrics(30).running);
  assert.equal(overviewMetrics(1).pending, overviewMetrics(30).pending);
  const completed = projects.find(item => item.status === 'completed');
  assert.equal(recordsFor(completed.id, 7).length, 0);
  assert.ok(recordsFor(completed.id, 30).length > 0);
});
test('项目搜索组合状态筛选，支持大小写与空白处理', () => {
  assert.equal(filterProjects().length, 6);
  assert.equal(filterProjects('  prj-001 ').at(0).id, 'live-monitor');
  assert.equal(filterProjects('直播', 'on_track').length, 2);
  assert.equal(filterProjects('<script>alert(1)</script>').length, 0);
  assert.equal(filterProjects('直播', 'blocked').length, 0);
});
test('路由识别正常路径、非法编码与不存在项目', () => {
  assert.deepEqual(routeFrom(''), { page: 'overview' });
  assert.deepEqual(routeFrom('#/projects/live-monitor'), { page: 'project', projectId: 'live-monitor' });
  assert.equal(routeFrom('#/projects/unknown').page, 'not-found');
  assert.equal(routeFrom('#/projects/%E0%A4%A').page, 'not-found');
});
test('动态文本按 HTML 文本和属性上下文转义', () => {
  assert.equal(escapeHtml('<img src="x" onerror=\'alert(1)\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;');
});
test('预览服务只暴露页面资源，拒绝目录穿越、项目配置与写请求', async () => {
  const server = createPreviewServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const read = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    req.on('error', reject); req.end();
  });
  try {
    const index = await read('/');
    assert.equal(index.status, 200);
    assert.ok(index.text.includes('Project Pulse'));
    assert.ok(index.headers['content-security-policy'].includes("default-src 'self'"));
    assert.equal((await read('/src/app.js')).status, 200);
    assert.equal((await read('/assets/styles.css')).status, 200);
    assert.equal((await read('/package.json')).status, 404);
    assert.equal((await read('/assets/%2e%2e/server.mjs')).status, 404);
    assert.equal((await read('/assets/..%5cserver.mjs')).status, 404);
    assert.equal((await read('/%E0%A4%A')).status, 400);
    assert.equal((await read('/', 'POST')).status, 405);
    assert.equal((await read('/', 'HEAD')).text, '');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
