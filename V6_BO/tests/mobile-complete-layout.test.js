'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const mobile=fs.readFileSync(path.join(__dirname,'../public/mobile.html'),'utf8');
const research=fs.readFileSync(path.join(__dirname,'../public/research.html'),'utf8');
test('mobile links to actual decision research workspace without synthetic scores',()=>{
 assert.match(mobile,/href="\/research\.html#decisionWorkspace"/);
 assert.match(research,/id="decisionWorkspace"/);
 assert.match(mobile,/研究信号不等于买入指令/);
});
test('mobile covers small phones, tablet, touch and safe area',()=>{
 for(const token of ['max-width:360px','min-width:600px','safe-area-inset-bottom','min-height:48px','overflow-x:hidden','touch-action:manipulation'])assert.ok(mobile.includes(token),token);
});
test('mobile tabs expose selected and hidden state to assistive technology',()=>{
 assert.match(mobile,/role="tablist"/);
 assert.match(mobile,/aria-selected/);
 assert.match(mobile,/p\.setAttribute\('aria-hidden'/);
});
test('research screen handles narrow widths, scrollable tables and readable inputs',()=>{
 for(const token of ['max-width:600px','-webkit-overflow-scrolling:touch','font-size:16px','viewport-fit=cover','decision-grid'])assert.ok(research.includes(token),token);
});
