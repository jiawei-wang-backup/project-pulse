import test from 'node:test';
import assert from 'node:assert/strict';
import { tasks, projects, runs } from '../src/data.js';
import { documents } from '../src/catalog.js';
import { employees, employeeById, memberships, taskOwnerIds, documentPeople, projectOwnerIds } from '../src/people-data.js';
import {
  employeeTaskOwner, employeeTasks, employeeMemberships, employeeDocuments, employeeSummary,
  employeeUsageRecords, teamUsage, filteredEmployees, employeeHref, projectEmployees
} from '../src/people-domain.js';
import { routeFrom, recordsFor, sumUsage, documentMarkdown, documentOf } from '../src/domain.js';
import { teamPage, employeePage, employeeTaskRows } from '../src/people-views.js';
import { documentPreview } from '../src/workspace.js';
import { networkPreviewUrls } from '../server.mjs';

test('9 位演示员工与项目成员职责唯一，每个任务有项目内的员工负责人',()=>{
  assert.equal(employees.length,9);
  assert.equal(new Set(employees.map(item=>item.id)).size,9);
  assert.equal(new Set(memberships.map(item=>`${item.projectId}:${item.employeeId}`)).size,memberships.length);
  for(const membership of memberships){assert.ok(employeeById(membership.employeeId));assert.ok(projects.some(item=>item.id===membership.projectId));}
  for(const project of projects){assert.ok(projectEmployees(project.id).some(item=>item.employeeId===projectOwnerIds[project.id]));}
  for(const task of tasks){
    const owner=employeeTaskOwner(task.id);assert.ok(owner);
    assert.ok(employeeMemberships(owner.id,task.projectId).length);
    const existingHuman=employees.find(item=>item.name===task.assignee);
    if(existingHuman)assert.equal(owner.id,existingHuman.id,'保留已有人工执行任务的人员归属');
  }
  assert.equal(Object.keys(taskOwnerIds).length,tasks.length);
  assert.equal(employeeTaskOwner('live-monitor-task-3').name,'林屿');
  assert.equal(tasks.find(item=>item.id==='live-monitor-task-3').assignee,'Codex');
});
test('员工任务分布按唯一负责人汇总，跨项目参与不会重复统计',()=>{
  const summaries=employees.map(employee=>employeeSummary(employee.id,7));
  assert.equal(summaries.reduce((sum,item)=>sum+item.total,0),tasks.length);
  assert.equal(summaries.reduce((sum,item)=>sum+item.done,0),tasks.filter(item=>item.column==='done').length);
  assert.equal(summaries.reduce((sum,item)=>sum+item.active,0),10);
  assert.equal(employeeTasks('lin-yu',{projectId:'live-monitor'}).length,5);
  assert.equal(employeeTasks('lin-yu',{projectId:'agent-gateway'}).length,0);
  assert.equal(employeeTasks('lin-yu',{query:'Codex'}).length,1);
  assert.equal(employeeTasks('lin-yu',{status:'doing'}).length,1);
});
test('文档责任与确认职责独立，所有文档都能找到项目内的员工',()=>{
  for(const output of documents){
    const people=documentPeople[output.id];assert.ok(employeeById(people.ownerId));assert.ok(employeeById(people.reviewerId));
    assert.ok(employeeMemberships(people.ownerId,output.projectId).length);
    assert.ok(employeeMemberships(people.reviewerId,output.projectId).length);
  }
  assert.equal(employees.reduce((sum,item)=>sum+employeeDocuments(item.id).length,0),documents.length);
  assert.equal(employees.reduce((sum,item)=>sum+employeeSummary(item.id).confirmations,0),6);
  assert.equal(employeeSummary('su-he').confirmations,2);
  assert.equal(employeeSummary('gu-yuan').confirmations,4);
  assert.equal(documentPeople['live-monitor-sync-contract'].ownerId,'lin-yu');
  assert.equal(documentOf('live-monitor-sync-contract').author,'Codex');
});
for(const period of [1,7,30])test(`${period} 天：员工已归属与未归属历史用量之和等于原项目和全局总额`,()=>{
  for(const projectId of [null,...projects.map(item=>item.id)]){
    const attribution=teamUsage(period,projectId);
    assert.deepEqual(attribution.total,sumUsage(recordsFor(projectId,period)));
    assert.deepEqual(sumUsage([attribution.assigned,attribution.unassigned]),attribution.total);
    assert.ok(attribution.unassigned.costMicros>=0&&attribution.unassigned.inputTokens>=0&&attribution.unassigned.outputTokens>=0);
    const employeeRecords=employees.flatMap(employee=>employeeUsageRecords(employee.id,period,projectId));
    assert.equal(new Set(employeeRecords.map(item=>item.id)).size,employeeRecords.length,'同一用量不能重复归属多个员工');
    assert.deepEqual(sumUsage(employeeRecords),attribution.assigned);
  }
  assert.equal(employeeSummary('gu-yuan',period).costMicros,0,'确认与监督职责不能自动承担整个项目消耗');
});
test('无执行任务的负责人仍可查看参与项目',()=>{
  const manager=employeeSummary('gu-yuan',7);
  assert.equal(manager.total,0);assert.equal(manager.confirmations,4);assert.equal(manager.projects,6);
  const page=employeePage('gu-yuan',{period:7});
  assert.ok(page.includes('当前没有在办任务'));
  assert.ok(!page.includes('待我确认'));
  assert.ok(page.includes('参与项目与职责'));
});
test('姓名、分组、项目与工作状态可以组合，项目筛选按项目内工作量判断',()=>{
  assert.equal(filteredEmployees({query:'罗安'}).length,1);
  assert.equal(filteredEmployees({department:'产品研发'}).length,4);
  assert.equal(filteredEmployees({project:'design-system',work:'active'}).length,0);
  assert.equal(filteredEmployees({work:'confirm'}).length,2);
  assert.equal(filteredEmployees({query:'不存在'}).length,0);
  const unsafe=teamPage(7,{query:'<img src=x onerror=alert(1)>'},'');
  assert.ok(!unsafe.includes('<img src=x'));
  assert.ok(unsafe.includes('&lt;img'));
});
test('员工页面、页签与项目视角有稳定深链接，未知员工和错误项目不被采用',()=>{
  assert.deepEqual(routeFrom('#/team'),{page:'team'});
  assert.deepEqual(routeFrom(employeeHref('lin-yu','live-monitor','tasks')),{page:'employee',employeeId:'lin-yu',tab:'tasks',projectId:'live-monitor'});
  assert.equal(routeFrom('#/team/lin-yu?project=agent-gateway').projectId,undefined);
  assert.equal(routeFrom('#/team/unknown').page,'not-found');
  assert.equal(routeFrom('#/projects/live-monitor?tab=members').tab,'members');
  assert.ok(employeeTaskRows('lin-yu','live-monitor').includes('实际执行方'));
});
test('AI 文档保留作者，并能从预览和导出追溯员工负责人及确认人',()=>{
  const output=documentOf('live-monitor-sync-contract');
  const markdown=documentMarkdown(output);
  assert.ok(markdown.includes('作者：Codex'));
  assert.ok(markdown.includes('员工负责人：林屿'));
  assert.ok(markdown.includes('内容确认人：苏禾'));
  const preview=documentPreview(output);
  assert.ok(preview.includes(employeeHref('lin-yu','live-monitor')));
  assert.ok(preview.includes(employeeHref('su-he','live-monitor')));
});
test('内网预览地址仅列出私有 IPv4，并去重、排除回环与公网',()=>{
  const ipv4=(address,internal=false)=>({address,internal,family:'IPv4'});
  const urls=networkPreviewUrls(4174,{ethernet:[ipv4('192.168.16.62'),ipv4('10.1.2.3'),ipv4('172.16.0.5'),ipv4('172.15.0.5'),ipv4('8.8.8.8')],other:[ipv4('192.168.16.62'),ipv4('127.0.0.1',true),{address:'::1',family:'IPv6',internal:true}]});
  assert.deepEqual(new Set(urls),new Set(['http://192.168.16.62:4174/','http://10.1.2.3:4174/','http://172.16.0.5:4174/']));
});
