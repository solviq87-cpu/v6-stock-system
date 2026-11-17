'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('review screenshot ranking cards reuse three existing legacy sources',()=>{
 const src=read('public/assets/reference-portal.js');
 const legacy=read('public/assets/app.js');
 for(const id of ['mainline','ztBySector','sectors']){
  assert.match(src,new RegExp("id:'"+id+"'"));
  assert.match(legacy,new RegExp("getElementById\\('"+id+"'\\)"));
 }
 assert.match(src,/source\?\[\.\.\.source\.children\]/);
 assert.match(src,/source\.children/);
 assert.match(src,/rankObserver\.observe\(source/);
 assert.match(src,/rankHosts\[index\]/);
 assert.doesNotMatch(src,/fetch\(|setInterval\(|Math\.random\(/);
});
test('rankings retain unknown state and source timestamp caveat',()=>{
 const src=read('public/assets/reference-portal.js');
 assert.match(src,/暂无可核验的原系统排行数据/);
 assert.match(src,/请点开核验时点/);
 assert.match(src,/row\.textContent/);
 assert.match(src,/textContent=parts\.slice/);
});
