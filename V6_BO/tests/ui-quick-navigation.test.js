const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');const css=fs.readFileSync(path.join(__dirname,'../public/assets/app.css'),'utf8');
const links=['v6-market','v6-stock','v6-paper','v6-news','v6-plan','v6-review','v6-strategy','v6-release'];
test('8 个快捷导航均指向唯一且存在的分区',()=>{for(const id of links){assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);assert.ok(html.includes('href="#'+id+'"'));}});
test('保留手机速览与开发者研究工作台入口',()=>{assert.match(html,/href="\/m"/);assert.match(html,/href="\/research.html" data-eo="hide"/)});
test('手机导航可横向滚动且不影响原有面板按钮',()=>{assert.match(css,/\.v6-quick-nav\{position:sticky/);assert.match(css,/overflow-x:auto/);assert.match(html,/id="btnPanelToggle"/);assert.match(html,/id="btnPanelPick"/);});
