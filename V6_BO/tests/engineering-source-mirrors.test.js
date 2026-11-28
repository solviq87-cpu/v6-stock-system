'use strict';
// The standalone browser research bundle retains deliberate copies of pure
// engine modules. A changed canonical implementation must not silently leave
// an old copy behind. Historical-session already has its own exact guard in
// phase4-execution-limit-integrity.test.js. Do not require byte identity for
// different historical-universe/feed-quality implementations or UI assets.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const pairs=[
 ...['a-share-patterns.js','historical-indicators.js','kline-bar-validation.js','model-features.js','model-selection-conditions.js']
  .map(name=>['V6_BO/src/strategy/'+name,'V6_WEB/src/vendor/'+name]),
 ['V6_BO/strategies/extended-factor-pack.json','V6_BO/public/assets/v6-extended-factors.json']
];
for(const [canonical,mirror] of pairs)test('shared source stays byte-identical: '+mirror,()=>{
 for(const file of [canonical,mirror])assert.ok(fs.lstatSync(path.join(root,file)).isFile(),'expected an ordinary source file: '+file);
 const source=fs.readFileSync(path.join(root,canonical)),copy=fs.readFileSync(path.join(root,mirror));
 assert.ok(source.length>0&&source.equals(copy),'source drift: '+canonical+' -> '+mirror+'; review compatibility and update the dependent mirror in the same change');
});
