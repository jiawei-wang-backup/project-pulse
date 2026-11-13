import { employees, employeeById, memberships, taskOwnerIds, documentPeople } from './people-data.js';
import { tasks, runs, DEMO_NOW } from './data.js';
import { documents, taskDetails } from './catalog.js';
import { projectOf, recordsFor, sumUsage, periodBounds, currentExecutions, activityFor } from './domain.js';

export { employees, employeeById };
export const employeeTaskOwner = taskId => employeeById(taskOwnerIds[taskId]);
export const documentOwner = documentId => employeeById(documentPeople[documentId]?.ownerId);
export const documentReviewer = documentId => employeeById(documentPeople[documentId]?.reviewerId);
export const employeeMemberships = (employeeId,projectId=null) => memberships.filter(item=>item.employeeId===employeeId&&(!projectId||item.projectId===projectId));
export const projectEmployees = projectId => memberships.filter(item=>item.projectId===projectId).map(item=>({...item,employee:employeeById(item.employeeId)}));
export function employeeHref(employeeId,projectId=null,tab=null){
  const params=new URLSearchParams();if(projectId)params.set('project',projectId);if(tab&&tab!=='overview')params.set('tab',tab);
  const query=params.toString();return `#/team/${encodeURIComponent(employeeId)}${query?'?'+query:''}`;
}
export function employeeTasks(employeeId,{projectId=null,status='all',query=''}={}){
  const normalized=query.trim().toLocaleLowerCase();
  return tasks.filter(task=>taskOwnerIds[task.id]===employeeId&&(!projectId||task.projectId===projectId)
    &&(status==='all'||task.column===status)
    &&`${task.title} ${task.assignee} ${taskDetails[task.id].module} ${projectOf(task.projectId).name}`.toLocaleLowerCase().includes(normalized))
    .sort((a,b)=>Date.parse(taskDetails[b.id].updatedAt)-Date.parse(taskDetails[a.id].updatedAt));
}
/** 只把带有可追溯执行与唯一员工负责人的记录归属给员工；其余用量留在未归属汇总内。 */
export function employeeUsageRecords(employeeId,period,projectId=null){
  return recordsFor(projectId,period).filter(record=>{
    const execution=runs.find(item=>item.id===record.runId);
    return execution&&taskOwnerIds[execution.taskId]===employeeId;
  });
}
export function employeeRuns(employeeId,period,projectId=null){
  return activityFor(projectId,period).filter(execution=>taskOwnerIds[execution.taskId]===employeeId);
}
export function employeeCurrentRuns(employeeId,projectId=null){return currentExecutions(projectId).filter(execution=>taskOwnerIds[execution.taskId]===employeeId);}
export function employeeDocuments(employeeId,{projectId=null,relation='owned',status='all',query=''}={}){
  const normalized=query.trim().toLocaleLowerCase();
  return documents.filter(document=>(!projectId||document.projectId===projectId)&&(status==='all'||document.status===status)
    &&(relation==='confirm'?documentPeople[document.id].reviewerId===employeeId:relation==='all'?[documentPeople[document.id].ownerId,documentPeople[document.id].reviewerId].includes(employeeId):documentPeople[document.id].ownerId===employeeId)
    &&`${document.title} ${document.summary} ${document.author}`.toLocaleLowerCase().includes(normalized))
    .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
}
/** 在办仅指进行中和待验收任务；没有在办任务不等于员工没有确认或协调工作。 */
export function employeeSummary(employeeId,period=7,projectId=null){
  const selected=employeeTasks(employeeId,{projectId});
  const current=employeeCurrentRuns(employeeId,projectId);
  const owned=employeeDocuments(employeeId,{projectId});
  return {employee:employeeById(employeeId),projects:employeeMemberships(employeeId,projectId).length,total:selected.length,
    todo:selected.filter(item=>item.column==='todo').length,doing:selected.filter(item=>item.column==='doing').length,review:selected.filter(item=>item.column==='review').length,done:selected.filter(item=>item.column==='done').length,
    active:selected.filter(item=>['doing','review'].includes(item.column)).length,blocked:selected.filter(item=>item.blocked).length,
    overdue:selected.filter(item=>item.column!=='done'&&taskDetails[item.id].dueDate&&Date.parse(`${taskDetails[item.id].dueDate}T23:59:59+08:00`)<Date.parse(DEMO_NOW)).length,
    outputs:owned.length,outputsAwaiting:owned.filter(item=>item.status==='review').length,
    confirmations:employeeDocuments(employeeId,{projectId,relation:'confirm',status:'review'}).length,
    running:current.filter(item=>item.state==='running').length,runs:employeeRuns(employeeId,period,projectId).length,
    ...sumUsage(employeeUsageRecords(employeeId,period,projectId))};
}
export function teamUsage(period,projectId=null){
  const total=sumUsage(recordsFor(projectId,period));
  const assigned=sumUsage(employees.map(employee=>sumUsage(employeeUsageRecords(employee.id,period,projectId))));
  return {total,assigned,unassigned:{inputTokens:total.inputTokens-assigned.inputTokens,outputTokens:total.outputTokens-assigned.outputTokens,costMicros:total.costMicros-assigned.costMicros}};
}
export function filteredEmployees({query='',department='all',project='all',work='all'}={},period=7){
  const normalized=query.trim().toLocaleLowerCase();
  return employees.filter(employee=>`${employee.name} ${employee.role} ${employee.department} ${employee.skills.join(' ')}`.toLocaleLowerCase().includes(normalized)
    &&(department==='all'||employee.department===department)&&(project==='all'||employeeMemberships(employee.id,project).length)
    &&(work==='all'||(work==='active'&&employeeSummary(employee.id,period,project==='all'?null:project).active>0)||(work==='confirm'&&employeeSummary(employee.id,period,project==='all'?null:project).confirmations>0)||(work==='no_active'&&employeeSummary(employee.id,period,project==='all'?null:project).active===0)));
}
export function employeeCurrentWork(employeeId,projectId=null){
  const pending=employeeTasks(employeeId,{projectId}).find(item=>['doing','review'].includes(item.column));
  if(pending)return {kind:'task',id:pending.id,title:pending.title,projectId:pending.projectId};
  const confirmation=employeeDocuments(employeeId,{projectId,relation:'confirm',status:'review'})[0];
  if(confirmation)return {kind:'document',id:confirmation.id,title:`确认：${confirmation.title}`,projectId:confirmation.projectId};
  const queued=employeeTasks(employeeId,{projectId}).find(item=>item.column==='todo');
  if(queued)return {kind:'task',id:queued.id,title:`待开始：${queued.title}`,projectId:queued.projectId};
  return null;
}
