import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNewsEvents} from '../public/nova/event-research.mjs';
import {parseSelectionCommand,evaluateSelectionCommand} from '../public/nova/command-selection.mjs';
const t=Date.parse('2026-11-25T10:00:00+08:00');
const original={eventHash:'a'.repeat(64),sequence:1,recordedAt:t,evidence:{source:'isolated-test',eventId:'event',kind:'original',supersedes:null,receivedAt:t-1000,publishedAt:t-2000,revisedAt:null,securities:['600000'],title:'网传中标',body:'金额10亿元',bodyScope:'provider-summary'}};
const retract={...original,eventHash:'b'.repeat(64),sequence:2,recordedAt:t+1000,evidence:{...original.evidence,kind:'retracted',supersedes:original.eventHash,receivedAt:t+500,revisedAt:t+400,title:'撤稿'}};
test('late retraction cannot change historical evidence',()=>{
 const early=projectNewsEvents([retract,original],t,t+2000),later=projectNewsEvents([retract,original],t+1000,t+2000);
 assert.equal(early.rows[0].row.eventHash,original.eventHash);
 assert.equal(later.rows[0].revisionStatus,'已撤稿');assert.equal(later.rows[0].chainComplete,true);
 assert.equal(early.rows[0].versions.length,1);assert.equal(later.rows[0].versions.length,2);
 assert.equal(early.rows[0].formalDisclosure,'未独立核实');
 assert.equal(early.rows[0].canTrade,false);assert.equal(early.rows[0].canNotify,false);
 assert.deepEqual(early.rows[0].amounts,['10亿元']);assert.equal(early.rows[0].effectiveAt,null);
});
test('missing earlier version and future or invalid clocks remain unknown',()=>{
 assert.equal(projectNewsEvents([retract],t+1000,t+2000).rows[0].chainComplete,false);
 assert.equal(projectNewsEvents([original],t-1,t+2000).rows.length,0);
 assert.equal(projectNewsEvents([original],t+3000,t+2000).status,'unknown');
 assert.equal(projectNewsEvents([{...original,recordedAt:t-2000}],t,t+2000).rows.length,0);
});
test('explicit all-market scope cannot silently become a candidate-pool ranking',()=>{
 const q=parseSelectionCommand('全市场精选评分前3');
 assert.equal(q.explicitAllMarket,true);
 const r=evaluateSelectionCommand(q,{day:'2026-11-25',now:t});
 assert.equal(r.status,'unsupported-scope');assert.deepEqual(r.items,[]);
});
test('unfinished condition never executes',()=>{
 for(const input of ['评分前3且','评分前3，，涨幅小于5%','且评分前3'])assert.equal(parseSelectionCommand(input).ok,false,input);
});
