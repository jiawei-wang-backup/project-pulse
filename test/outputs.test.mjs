import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_NOW, projects, tasks, runs } from '../src/data.js';
import { documents, documentKinds, documentStates, projectProfiles, taskDetails } from '../src/catalog.js';
import {
  documentOf, documentsFor, documentDigest, projectOf, taskOf, progressOf, taskDigest, moduleRows,
  costAllocation, sumUsage, recordsFor, routeFrom, timelineFor, documentMarkdown, deliveryQueue, executionCostBreakdown
} from '../src/domain.js';
import { documentPreview, documentLibraryRows, milestonePreview } from '../src/workspace.js';

test('32 份文档的项目、任务、AI 来源与版本记录都可追溯', () => {
  assert.equal(documents.length, 32);
  assert.equal(new Set(documents.map(item => item.id)).size, documents.length);
  for (const output of documents) {
    const project = projectOf(output.projectId);
    assert.ok(project);
    assert.ok(documentKinds[output.kind]);
    assert.ok(documentStates[output.status]);
    assert.ok(!output.milestoneId || project.milestones.some(item => item.id === output.milestoneId));
    for (const taskId of output.taskIds) assert.equal(taskOf(taskId).projectId, project.id);
    if (output.runId) {
      const execution = runs.find(item => item.id === output.runId);
      assert.equal(execution.projectId, project.id);
      assert.ok(output.taskIds.includes(execution.taskId));
    }
    assert.ok(Date.parse(output.updatedAt) <= Date.parse(DEMO_NOW));
    assert.equal(output.history[0].version, output.version);
    assert.ok(Date.parse(output.history[0].date) >= Date.parse(output.history[1].date));
    assert.ok(output.sections.length >= 4);
  }
  for (const project of projects) {
    assert.ok(documentsFor(project.id).length);
    for(const milestone of project.milestones.filter(item=>item.state==='accepted')) assert.ok(documentsFor(project.id,{milestoneId:milestone.id}).length,'已验收演示节点应能查看交付证据');
  }
  for (const execution of runs) assert.ok(documentsFor(execution.projectId, { runId: execution.id }).length);
});
test('项目、类型、状态与文档全文搜索可组合，跨项目任务不会串入结果', () => {
  const selected = documentsFor('live-monitor', { status: 'review', kind: 'review', query: '异常' });
  assert.ok(selected.length);
  assert.ok(selected.every(item => item.projectId === 'live-monitor' && item.kind === 'review' && item.status === 'review'));
  assert.equal(documentsFor('agent-gateway', { taskId: 'live-monitor-task-3' }).length, 0);
  assert.equal(documentsFor(null, { query: '<script>alert(1)</script>' }).length, 0);
  assert.ok(documentsFor(null, { query: 'codex' }).every(item => item.author.toLowerCase().includes('codex')));
  assert.ok(documentsFor(null, { period: 1 }).every(item => item.updatedAt.startsWith('2026-11-12')));
});
test('文档确认、任务完成与里程碑验收采用独立口径', () => {
  for (const project of projects) {
    const digest = documentDigest(project.id);
    assert.equal(digest.total, digest.approved + digest.review + digest.draft);
  }
  assert.equal(documentDigest().total, 32);
  const project = projectOf('live-monitor');
  assert.equal(progressOf(project), 60);
  assert.equal(taskDigest(project.id).done / taskDigest(project.id).total * 100, 25);
  const clonedProject = structuredClone(project);
  clonedProject.documents = documentsFor(project.id).map(item => ({ ...item, status: 'approved' }));
  assert.equal(progressOf(clonedProject), 60);
});
test('工作模块覆盖所有任务，检查项与前置依赖在同项目内且没有环', () => {
  for (const project of projects) {
    assert.ok(projectProfiles[project.id]);
    const modules = moduleRows(project.id);
    assert.equal(modules.reduce((sum, item) => sum + item.total, 0), taskDigest(project.id).total);
    assert.equal(modules.reduce((sum, item) => sum + item.done, 0), taskDigest(project.id).done);
  }
  const walk = (taskId, ancestors = new Set()) => {
    assert.ok(!ancestors.has(taskId), '前置任务不能循环依赖');
    const task = taskOf(taskId), detail = taskDetails[taskId];
    assert.ok(detail.checklist.length >= 3);
    assert.ok(detail.acceptance.length >= 3);
    for (const dependency of detail.dependencyIds) {
      assert.equal(taskOf(dependency).projectId, task.projectId);
      walk(dependency, new Set([...ancestors, taskId]));
    }
  };
  for (const task of tasks) walk(task.id);
});
for (const period of [1, 7, 30]) {
  test(`${period} 天的项目投入分布与总费用一致`, () => {
    const rows = costAllocation(period);
    assert.deepEqual(sumUsage(rows), sumUsage(recordsFor(null, period)));
    assert.ok(Math.abs(rows.reduce((sum, item) => sum + item.share, 0) - 100) < 0.0001);
    assert.ok(rows.every((item, index) => !index || rows[index - 1].costMicros >= item.costMicros));
  });
}
test('产出文档与项目页签支持深链接及刷新，跨项目文档参数不被采用', () => {
  assert.deepEqual(routeFrom('#/outputs'), { page: 'outputs' });
  assert.deepEqual(routeFrom('#/projects/live-monitor?tab=board'), { page: 'project', projectId: 'live-monitor', tab: 'board' });
  const output = documentOf('live-monitor-alert-review');
  assert.deepEqual(routeFrom(`#/projects/live-monitor?doc=${output.id}`), { page: 'project', projectId: 'live-monitor', tab: 'documents', documentId: output.id });
  assert.equal(routeFrom(`#/projects/agent-gateway?doc=${output.id}`).documentId, undefined);
  assert.equal(routeFrom('#/projects/live-monitor?tab=unknown').tab, undefined);
});
test('执行消耗与其他历史用量明确拆分，合计始终等于本期项目费用',()=>{
  for(const project of projects)for(const period of [1,7,30]){
    const breakdown=executionCostBreakdown(project.id,period);
    assert.ok(breakdown.otherCostMicros>=0);
    assert.equal(breakdown.traced.costMicros+breakdown.otherCostMicros,breakdown.total.costMicros);
    assert.deepEqual(breakdown.total,sumUsage(recordsFor(project.id,period)));
  }
});
test('正文、来源关系与版本预览都有实际内容，动态文本经过转义', () => {
  const output = documentOf('live-monitor-alert-review');
  for (const tab of ['preview', 'relations', 'history']) assert.ok(documentPreview(output, tab).includes('document-preview-panel'));
  assert.ok(documentPreview(output).includes('核对短暂断线与持续离线的分级边界'));
  assert.ok(documentPreview(output, 'relations').includes('data-open-run="run-lm-2"'));
  assert.ok(documentPreview(output, 'history').includes('建立初稿'));
  const unsafe = documentPreview({ ...output, title: '<img src=x onerror=alert(1)>', summary: '<script>alert(1)</script>' });
  assert.ok(!unsafe.includes('<img src=x'));
  assert.ok(unsafe.includes('&lt;script&gt;'));
  assert.ok(documentLibraryRows('global', { query: '不存在' }).includes('没有找到匹配的文档'));
  assert.ok(milestonePreview('live-monitor', 'm4').includes(`data-open-document="${output.id}"`));
});
test('下载内容与当前预览正文一致，并保留演示与待确认标识', () => {
  const output = documentOf('live-monitor-alert-review');
  const markdown = documentMarkdown(output);
  assert.ok(markdown.startsWith(`# ${output.title}`));
  assert.ok(markdown.includes('不代表真实项目交付或验收结果'));
  assert.ok(markdown.includes('状态：待确认'));
  for (const section of output.sections) assert.ok(markdown.includes(`## ${section.title}`));
  assert.ok(markdown.includes('（待确认）'));
  assert.ok(markdown.includes('版本：v0.9'));
});
test('项目动态按时间排序、支持类型筛选，并只关联当前项目', () => {
  const timeline = timelineFor('live-monitor');
  assert.ok(timeline.length > 10);
  assert.ok(timeline.every((item, index) => !index || Date.parse(timeline[index - 1].at) >= Date.parse(item.at)));
  assert.equal(timelineFor('live-monitor', 'document').length, documentsFor('live-monitor').length);
  assert.equal(timelineFor('live-monitor', 'milestone').length, 3);
  assert.ok(timelineFor('content-strategy', 'ai').length === 0);
  const queue = deliveryQueue();
  assert.ok(queue.some(item => item.overdue));
  assert.ok(queue.every((item, index) => !index || queue[index - 1].date <= item.date));
});
