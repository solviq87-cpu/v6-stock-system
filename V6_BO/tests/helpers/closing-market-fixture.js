'use strict';
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { createFixture } = require('./v6-studio-fixture');
const at = (s) => Date.parse('2026-11-16T' + s + '+08:00');
async function createClosingFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'close-freeze-http-')),
    clock = path.join(dir, 'clock');
  fs.writeFileSync(clock, String(at('14:59:40')));
  let f;
  let source = fs.readFileSync(
    path.resolve(__dirname, '../../server.js'),
    'utf8',
  );
  const anchor = 'let _quantPicksCache = { ts: 0, data: null, busy: false };';
  const inject = `\nconst fixtureStage=()=>Date.now()<${at('14:59:50')}?1:Date.now()<${at('15:00:00')}?2:99;const fixtureRow=()=>({code:'600000',name:'合成收盘验收',price:fixtureStage(),pct:fixtureStage(),quoteAt:${at('14:59:30')},quoteSource:'synthetic-test-only',score:80});
S.stocks=S.stocks.map(x=>({...x,quoteAt:${at('14:59:30')},quoteSource:'synthetic-test-only'}));S.stocksAt=${at('14:59:30')};
Object.defineProperty(S,'candidatePool',{enumerable:true,configurable:true,get:()=>[fixtureRow()]});Object.defineProperty(S,'global',{enumerable:true,configurable:true,get:()=>[{code:'test',price:fixtureStage()}]});
Object.defineProperty(S,'review',{enumerable:true,configurable:true,get:()=>({date:'20261116',value:fixtureStage()})});Object.defineProperty(S,'yierList',{enumerable:true,configurable:true,get:()=>[fixtureRow()]});Object.defineProperty(S,'lianbanList',{enumerable:true,configurable:true,get:()=>[fixtureRow()]});\n`;
  source = source.replace(anchor, anchor + inject);
  f = await createFixture({ count: 1, serverSource: source, clockFile: clock });

  const close = f.close;
  f.close = async () => {
    try {
      await close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  f.setTime = (value) => fs.writeFileSync(clock, String(at(value)));
  return f;
}
module.exports = { createClosingFixture, at };
