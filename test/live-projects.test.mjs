import test from 'node:test';
import assert from 'node:assert/strict';
import {researchProjectCount,memberProjectKeys,renderProjectDocuments,isRunningAgent} from '../src/live-projects.js';
import {dashboardCutoff} from '../backend.mjs';
import {escapeHtml} from '../src/domain.js';

test('在研包括阻塞，不依赖Agent或最近活动，不包括完成、暂停及未知',()=>{
  assert.equal(researchProjectCount(['on_track','blocked','completed','paused','unknown'].map(status=>({status,last_activity_at:'2000-01-01',agents:[]}))),2);
});
test('Agent窗口放宽到2小时，未知状态需近期用量证据，终止状态不冒充运行中',()=>{
  const now=Date.now(),agent=(state,minutes,extra={})=>({state,last_activity_at:new Date(now-minutes*60000).toISOString(),...extra});
  assert.equal(isRunningAgent(agent('running',90),now),true);
  assert.equal(isRunningAgent(agent('running',121),now),false);
  assert.equal(isRunningAgent(agent('unknown',10,{is_running:true}),now),true);
  assert.equal(isRunningAgent(agent('unknown',31,{is_running:true}),now),false);
  for(const state of ['idle','completed','failed']) assert.equal(isRunningAgent(agent(state,1,{is_running:true}),now),false);
});
test('成员项目始终合并长期关系和近期会话，不按同名仓库尾部误合并',()=>{
  const data={memberships:[{display_name:'A',full_name:'one/app'},{display_name:'A',full_name:'two/app'}],sessions:[{display_name:'A',full_name:'one/app'},{display_name:'A',full_name:'new/project'}]};
  assert.deepEqual(memberProjectKeys(data,'A',row=>row.full_name),['one/app','two/app','new/project']);
  assert.deepEqual(memberProjectKeys(data,'A',row=>row.full_name,'two/app'),['two/app']);
  assert.equal(memberProjectKeys({...data,sessions:[]},'A',row=>row.full_name).length,2);
});
test('文档按项目生成可折叠分组，首组展开，PR链接、草稿和转义保留',()=>{
  const html=renderProjectDocuments([
    {full_name:'owner/a',number:1,title:'<unsafe>',url:'https://github.com/owner/a/pull/1',state:'merged'},
    {full_name:'owner/b',number:2,title:'Draft',url:'javascript:bad',is_draft:true,state:'open'}
  ],{esc:escapeHtml,icon:()=>'',date:()=>'',projectName:x=>x,safeGithub:u=>u.startsWith('https://github.com/')?u:''});
  assert.equal((html.match(/<details /g)||[]).length,2);
  assert.equal((html.match(/live-doc-group" open/g)||[]).length,1);
  assert.ok(html.includes('&lt;unsafe&gt;'));
  assert.ok(html.includes('已合并')&&html.includes('草稿'));
  assert.ok(!html.includes('javascript:'));
});
test('今天采用固定UTC+8自然日，零点两侧归属明确',()=>{
  assert.equal(dashboardCutoff(1,Date.parse('2026-11-15T15:59:59Z')).toISOString(),'2026-11-14T16:00:00.000Z');
  assert.equal(dashboardCutoff(1,Date.parse('2026-11-15T16:00:00Z')).toISOString(),'2026-11-15T16:00:00.000Z');
});
