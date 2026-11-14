const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../public/assets/app.css'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
test('手机卡片标题允许换行且不再被挤成竖排',()=>{assert.match(css,/card h2>span:first-child\s*\{[^}]*flex:1 1 170px/);assert.match(css,/overflow-wrap:break-word/);assert.match(css,/@media\(max-width:390px\)/)});
test('手机表格保持局部横向滚动，整页不横向溢出',()=>{assert.match(css,/\.tw\{max-width:100%;overflow-x:auto/);assert.match(css,/html,body\{max-width:100%;overflow-x:clip/)});
test('保留现有页面脚本与面板操作，更新CSS缓存版本',()=>{assert.match(html,/assets\/app\.js/);assert.match(html,/toggleAllPanels\(\)/);assert.match(html,/togglePanelPicker\(\)/);assert.match(html,/20261104ui1/)});
