import { projects, tasks, runs } from './data.js';
import { documents } from './catalog.js';

/**
 * @typedef {Object} Employee
 * @property {string} id 员工稳定标识；原型名单与岗位均为虚构演示资料。
 * @property {string} department 用于团队筛选的组织分组，不代表登录权限。
 * @property {string} role 展示岗位，与各项目承担的职责分别记录。
 * @property {string[]} skills 展示员工的协作方向，不用于能力打分或绩效排序。
 */
export const employees = [
  { id:'lin-yu', name:'林屿', initials:'LY', role:'前端工程师', department:'产品研发', accent:'lime', skills:['业务研发','监控体验'], bio:'负责监控体验与交付协调，跟进状态同步和业务验收。' },
  { id:'xu-yan', name:'许言', initials:'XY', role:'多媒体工程师', department:'内容技术', accent:'orange', skills:['素材处理','高光识别'], bio:'负责素材处理与剪辑工作流，推动候选片段质量验收。' },
  { id:'zhou-ning', name:'周宁', initials:'ZN', role:'前端工程师', department:'产品研发', accent:'blue', skills:['组件研发','设计落地'], bio:'负责互动组件研发，协同设计规范与交付检查。' },
  { id:'chen-xu', name:'陈序', initials:'CX', role:'平台工程师', department:'产品研发', accent:'purple', skills:['AI 接入','用量观测'], bio:'负责 AI 接入方案与服务验证，跟进外部依赖和异常记录。' },
  { id:'shen-qing', name:'沈青', initials:'SQ', role:'产品设计师', department:'产品设计', accent:'pink', skills:['设计系统','交互规范'], bio:'负责设计规范与页面体验，参与项目范围和交互方案讨论。' },
  { id:'su-he', name:'苏禾', initials:'SH', role:'产品经理', department:'产品设计', accent:'teal', skills:['需求梳理','业务验收'], bio:'梳理业务范围与验收边界，协调内容策略和监控业务确认。' },
  { id:'luo-an', name:'罗安', initials:'LA', role:'测试工程师', department:'质量保障', accent:'blue', skills:['回归验证','场景覆盖'], bio:'负责跨项目回归验证与测试材料，协同 AI 补齐边界场景。' },
  { id:'liang-mu', name:'梁沐', initials:'LM', role:'后端工程师', department:'产品研发', accent:'purple', skills:['数据链路','服务联调'], bio:'负责数据链路和服务联调，跟进技术方案与 AI 执行结果。' },
  { id:'gu-yuan', name:'顾远', initials:'GY', role:'部门负责人', department:'项目管理', accent:'lime', skills:['交付协调','验收确认'], bio:'关注项目交付与依赖协调，负责所分配文档的内容确认。' }
];
export const employeeById = employeeId => employees.find(item=>item.id===employeeId);

/** 项目成员与项目职责显式声明；员工可以参与多个项目，员工数量按唯一人员去重。 */
const membershipSpecs = {
  'live-monitor': [['lin-yu','项目负责人','推进监控功能与整体交付'],['liang-mu','服务研发','采集链路与异常技术审查'],['luo-an','质量验证','连接与重试场景回归'],['su-he','业务确认','核对异常分级及业务验收'],['gu-yuan','交付协调','跟进资源与交付事项']],
  'highlight-studio': [['xu-yan','项目负责人','素材链路与剪辑质量'],['liang-mu','数据协作','素材索引与追溯关系'],['luo-an','质量协作','参与样本验证与复核'],['su-he','产品协作','审核与交付流程梳理'],['gu-yuan','验收确认','确认阶段交付材料']],
  'live-components': [['zhou-ning','项目负责人','互动组件与交付推进'],['liang-mu','联调协作','配置兼容与活动联调'],['luo-an','质量验证','窄屏场景与反馈状态'],['shen-qing','设计协作','组件视觉与使用规范'],['gu-yuan','验收确认','确认最终交付材料']],
  'agent-gateway': [['chen-xu','项目负责人','接入方案与链路验证'],['liang-mu','服务研发','接入样例与数据归属'],['su-he','产品协作','用量展示及场景确认'],['gu-yuan','依赖协调','跟进服务配额与验收']],
  'design-system': [['shen-qing','项目负责人','视觉规范与最终交付'],['zhou-ning','组件研发','组件状态与规范落地'],['luo-an','质量验证','典型页面一致性校验'],['gu-yuan','验收确认','确认设计交付材料']],
  'content-strategy': [['su-he','项目负责人','需求调研与范围确认'],['shen-qing','设计协作','参与工作流与交互讨论'],['gu-yuan','范围确认','协调首版范围与交付计划']]
};
export const memberships = Object.entries(membershipSpecs).flatMap(([projectId,items])=>items.map(([employeeId,role,responsibility])=>({projectId,employeeId,role,responsibility})));
export const projectOwnerIds = Object.fromEntries(projects.map(project=>[project.id,employees.find(employee=>employee.name===project.owner).id]));

/**
 * 员工对任务负责，task.assignee 仍表示实际执行方（员工或 AI），两者不能混为一项。
 * 以下名单按现有任务顺序显式分配，不从项目负责人或 AI 工具名称猜测员工归属。
 */
const taskOwnerSpecs = {
  'live-monitor': ['lin-yu','lin-yu','lin-yu','luo-an','liang-mu','lin-yu','liang-mu','lin-yu'],
  'highlight-studio': ['xu-yan','xu-yan','xu-yan','xu-yan','xu-yan','liang-mu'],
  'live-components': ['zhou-ning','liang-mu','luo-an','zhou-ning','zhou-ning','liang-mu'],
  'agent-gateway': ['chen-xu','chen-xu','chen-xu','chen-xu','liang-mu'],
  'design-system': ['shen-qing','zhou-ning','luo-an','shen-qing'],
  'content-strategy': ['su-he','su-he','su-he']
};
export const taskOwnerIds = Object.fromEntries(projects.flatMap(project=>tasks.filter(task=>task.projectId===project.id).map((task,index)=>[task.id,taskOwnerSpecs[project.id][index]])));
/** 文档确认职责独立于编写与任务执行，分配给项目内的演示员工。 */
const projectReviewerIds = { 'live-monitor':'su-he','highlight-studio':'gu-yuan','live-components':'gu-yuan','agent-gateway':'gu-yuan','design-system':'gu-yuan','content-strategy':'gu-yuan' };
export const documentPeople = Object.fromEntries(documents.map(document=>{
  const humanAuthor=employees.find(employee=>employee.name===document.author);
  const execution=runs.find(run=>run.id===document.runId);
  return [document.id,{ownerId:humanAuthor?.id||taskOwnerIds[execution?.taskId]||projectOwnerIds[document.projectId],reviewerId:projectReviewerIds[document.projectId]}];
}));
/** 当前待处理事项的协作员工，不从岗位文字自动推断。 */
export const riskOwnerIds = {'live-monitor':'su-he','highlight-studio':'xu-yan','live-components':'gu-yuan','agent-gateway':'gu-yuan'};
