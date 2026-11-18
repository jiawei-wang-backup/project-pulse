import test from 'node:test';
import assert from 'node:assert/strict';
import {validServiceToken,projectGranted,projectSnapshot} from '../project-api.mjs';
test('service authentication fails closed and repository grants are exact',()=>{
  const key='a'.repeat(64),id='11111111-1111-4111-8111-111111111111';
  assert(validServiceToken(`Bearer ${key}`,key));
  assert(!validServiceToken('Bearer wrong',key));assert(!validServiceToken(undefined,key));assert(!validServiceToken('Bearer ',''));
  assert(projectGranted(id,id));assert(!projectGranted('111',id));assert(!projectGranted(id,''));
});
test('all SQL reads are bound to one repository and absent evidence is not invented',async()=>{
  const id='11111111-1111-4111-8111-111111111111';const calls=[];
  const pool={async query(sql,args){calls.push({sql,args});if(sql.startsWith('SELECT repository_id'))return{rows:[{repository_id:id,full_name:'example/test',completed_at:null}]};if(sql.includes('AS events'))return{rows:[{events:0,input_tokens:null,cached_input_tokens:null,output_tokens:null,updated_at:null}]};return{rows:[]};}};
  const data=await projectSnapshot(pool,id,7);
  assert(calls.every(c=>c.args[0]===id));
  assert(calls.filter(c=>c.sql.includes('usage_events')).every(c=>c.sql.includes('s.repository_id=$1')&&c.sql.includes('device_id,session_id')));
  assert.equal(data.project.owner,null);assert.equal(data.milestone_progress,null);assert.equal(data.cost.amount,null);assert.equal(data.quota.status,'not_shared');assert.deepEqual(data.members,[]);
});
