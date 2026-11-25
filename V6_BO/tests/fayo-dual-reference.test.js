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
 const primary=app.slice(app.indexOf('const REFERENCE_TOP='),app.indexOf('const REFERENCE_MOBILE='));
 assert.deepEqual([...primary.matchAll(/\['([^']+)'/g)].map(x=>x[1]),['大盘','机会','我的票','提醒','复盘']);
 assert.match(app,/const REFERENCE_MOBILE=REFERENCE_TOP/);
 for(const sub of ['shortline-library','shortline-versions','backtest','scan','authority','release','history'])
  assert.ok(app.includes("'"+sub+"'"),'preserve secondary route '+sub);
 assert.match(app,/data-fy-sub/);
 assert.match(app,/renderReferenceReview\(ctx\)/);
 assert.match(app,/renderDailyReview\(ctx\)/);
 assert.match(app,/frame=h\('div',\{class:'fayo-app fy-reference-shell'/);
 assert.doesNotMatch(app,/<iframe\b|iframe\.src\s*=/i);
});

test('reference review is sourced from the same dashboard and preserves original detail route',()=>{
 const source=read('terminal-workbench.js');
 assert.match(source,/export function renderReferenceReview\(ctx\)/);
 assert.match(source,/return renderCloseReview\(ctx,more\)/);
 const close=read('close-review.js');
 for(const title of ['市场情绪总览','题材主线划分','完整连板梯队','龙虎榜梳理','市场矛盾与风险','下一交易日观察清单'])
  assert.ok(close.includes(title),title);
 assert.match(close,/supplement\?\.day===day/);
 assert.match(source,/const view=renderTerminalOverview\(ctx,\{reviewOnly:true\}\)/);
 assert.match(source,/summarizeReview\(ctx\.state\?\.review\)/);
 assert.match(source,/referenceReviewStats/);
 assert.match(source,/moduleButton\('查看完整原始报告','pulse','review-details',ctx\)/);
 assert.match(source,/source\?'来源池涨停总数':'复盘涨停样本'/);
 assert.match(source,/source\?number\(source\.reportedCount\):review\?number\(summary\.rows\.length\)/);
 assert.match(source,/不是全市场炸板率/);
});

test('a reference layout cannot convert missing market values into example trades',()=>{
 const source=read('terminal-workbench.js');
 assert.match(source,/state\.snapshotFieldDays\?\.sectors\|\|state\.sectorsDay/);
 assert.match(source,/import \{projectSectorFlows\} from '\.\/decision-sector-context\.mjs'/);
 assert.match(source,/const flows=aligned\?sectorEvidence\.rows/);
 assert.match(source,/money\(r\.value\)/);
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
 assert.match(css,/\.fy-reference-review>\.fy-terminal-stats\{order:2\}/);
});
