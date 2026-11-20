'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../public/nova');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('the two original V6 references remain one authenticated desktop/mobile application',()=>{
 const app=read('app.js');
 assert.match(app,/const REFERENCE_TOP=/);
 for(const label of ['首页','行情','选股','策略','回测','复盘','资讯','资金流','风控','模拟盘','我的'])
  assert.ok(app.includes("'"+label+"'"),'required desktop action: '+label);
 for(const label of ['首页','行情','选股','复盘','我的'])
  assert.ok(app.includes("'"+label+"'"),'required mobile destination: '+label);
 assert.match(app,/data-fy-sub/);
 assert.match(app,/renderReferenceReview\(ctx\)/);
 assert.match(app,/renderDailyReview\(ctx\)/);
 assert.match(app,/frame=h\('div',\{class:'fayo-app fy-reference-shell'/);
 assert.doesNotMatch(app,/<iframe\b|iframe\.src\s*=/i);
});

test('reference review is sourced from the same dashboard and preserves original detail route',()=>{
 const source=read('terminal-workbench.js');
 assert.match(source,/export function renderReferenceReview\(ctx\)/);
 assert.match(source,/const view=renderTerminalOverview\(ctx\)/);
 assert.match(source,/summarizeReview\(ctx\.state\?\.review\)/);
 assert.match(source,/referenceReviewStats/);
 assert.match(source,/moduleButton\('查看完整原始报告','pulse','review-details',ctx\)/);
 assert.match(source,/源端数量未核验时不填/);
 assert.match(source,/不是全市场炸板率/);
});

test('a reference layout cannot convert missing market values into example trades',()=>{
 const source=read('terminal-workbench.js');
 assert.match(source,/state\.snapshotFieldDays\?\.sectors\|\|state\.sectorsDay/);
 assert.match(source,/r\.mainInflowYuan/);
 assert.match(source,/state\.trading===false/);
 assert.match(source,/不能用旧日资金冒充今日排行/);
 assert.match(source,/不会升格为交易信号/);
 assert.match(source,/document\.createElementNS\('http:\/\/www\.w3\.org\/2000\/svg','svg'\)/);
 assert.doesNotMatch(source,/1,236,580|\+128\.6|3386\.24|002685.*86%/);
});

test('responsive screenshots have explicit desktop/sidebar, phone dock and separate reference sections',()=>{
 const css=read('fayo.css');
 assert.match(css,/V6 USER TWO-REFERENCE LAYOUT \/ 2026-11-19/);
 for(const item of ['fy-reference-topnav','fy-reference-topgrid','fy-reference-midgrid',
   'fy-reference-lowergrid','fy-reference-review-footer','fy-reference-review','fy-dock'])
  assert.ok(css.includes('.'+item)||css.includes(' '+item),'style group '+item);
 assert.match(css,/@media\(max-width:650px\) and \(orientation:portrait\)/);
 assert.match(css,/\.fy-reference-home>\.fy-terminal-stats,\.fy-reference-review>\.fy-terminal-stats\{order:2\}/);
});
