'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildSession,loadSession,saveSession,summary}=require('../src/core/paper-session');
function fixture(count=65){return {source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',name:'研究样本',market:'main',bars:Array.from({length:count},(_,i)=>{const p=10+i*.08;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:p,high:p+.25,low:p-.2,close:p+.1,volume:100000};})}]};}
test('append-only account persists, resumes, and reproduces a complete replay',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-paper-'));try{const file=path.join(dir,'account.json');const a=buildSession(fixture());saveSession(file,a.session);const loaded=loadSession(file);assert.equal(summary(loaded).revision,1);const b=buildSession(fixture(67),{},loaded);assert.equal(b.updated,true);assert.equal(b.session.revision,2);assert.equal(b.session.report.equity.length,36);saveSession(file,b.session);assert.deepEqual(loadSession(file),b.session);const again=buildSession(fixture(67),{},loadSession(file));assert.equal(again.updated,false);assert.equal(again.session.revision,2);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('old candles cannot be silently rewritten, removed, or reassigned',()=>{const a=buildSession(fixture()).session;const edited=fixture(66);edited.stocks[0].bars[1].close+=0.01;assert.throws(()=>buildSession(edited,{},a),/改写/);const short=fixture(64);assert.throws(()=>buildSession(short,{},a),/删除/);const source=fixture(66);source.source='imported';source.provider='fake';assert.throws(()=>buildSession(source,{},a),/来源/);});
test('tampered snapshot and report fail integrity check',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-paper-'));try{const f=path.join(dir,'s.json'),s=buildSession(fixture()).session;saveSession(f,s);const x=JSON.parse(fs.readFileSync(f));x.report.metrics.finalEquity=999999;fs.writeFileSync(f,JSON.stringify(x));assert.throws(()=>loadSession(f),/完整性/);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('account parameters cannot change during resume',()=>{const a=buildSession(fixture(),{maxPositions:2}).session;assert.throws(()=>buildSession(fixture(66),{maxPositions:3},a),/参数不可修改/);});
test('account rejects undated bars instead of inventing session dates',()=>{const f=fixture();delete f.stocks[0].bars[0].date;assert.throws(()=>buildSession(f),/真实交易日期|混用/);});
test('append-only update rejects inconsistent multi-stock growth',()=>{
 const initial=fixture(65);const second=JSON.parse(JSON.stringify(initial.stocks[0]));second.code='000002';initial.stocks.push(second);
 const a=buildSession(initial).session;
 const updated=fixture(67);updated.stocks.push({...second,bars:fixture(66).stocks[0].bars});
 assert.throws(()=>buildSession(updated,{},a),/未对齐|数量不一致/);
});
