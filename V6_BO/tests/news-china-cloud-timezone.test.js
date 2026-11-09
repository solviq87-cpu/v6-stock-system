'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { newsChinaClock } = require('../src/core/news-china-clock');

const repo = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(repo, 'server.js'), 'utf8');
const shanghai = text => Date.parse(text);

test('daily and weekend digest wall time is Shanghai, not the cloud host timezone', () => {
  const dates = [
    ['2026-11-08T20:59:59+08:00', '20261108', 0, 20*60+59, '2026-11-07'],
    ['2026-11-08T21:00:00+08:00', '20261108', 0, 21*60, '2026-11-07'],
    ['2026-11-08T23:59:59+08:00', '20261108', 0, 23*60+59, '2026-11-07'],
    ['2026-11-09T00:00:00+08:00', '20261109', 1, 0, '2026-11-08'],
    ['2026-11-07T21:15:00+08:00', '20261107', 6, 21*60+15, '2026-11-06'],
    ['2026-10-04T21:00:00+08:00', '20261004', 0, 21*60, '2026-10-03'],
    ['2027-01-01T21:00:00+08:00', '20270101', 5, 21*60, '2026-12-31']
  ];
  for (const [time, dayKey, weekday, minute, previous] of dates) {
    const c = newsChinaClock(shanghai(time));
    assert.equal(c.dayKey, dayKey, time);
    assert.equal(c.weekday, weekday, time);
    assert.equal(c.minute, minute, time);
    assert.equal(c.previousIsoDay, previous, time);
    assert.equal(c.getDay(),weekday);
    assert.equal(c.getHours()*60+c.getMinutes(),minute);
    assert.equal(c.isoDay,dayKey.slice(0,4)+'-'+dayKey.slice(4,6)+'-'+dayKey.slice(6,8));
  }
  assert.throws(() => newsChinaClock(NaN),/时钟/);
  assert.throws(() => newsChinaClock(-1),/时钟/);
});

test('China digest date/day/time do not drift under UTC, Tokyo or New York servers', () => {
  const at = shanghai('2026-11-08T23:15:00+08:00');
  const code = "const c=require('./src/core/news-china-clock').newsChinaClock(Number(process.argv[1]));console.log(JSON.stringify([c.dayKey,c.weekday,c.minute,c.previousIsoDay]))";
  const outputs = [];
  for (const tz of ['UTC','Asia/Tokyo','America/New_York','Asia/Shanghai']) {
    const result = spawnSync(process.execPath, ['-e',code,String(at)], {
      cwd:repo, encoding:'utf8',timeout:10000,env:{...process.env,TZ:tz}
    });
    assert.equal(result.status,0,tz+' '+result.stderr);
    outputs.push(JSON.parse(result.stdout.trim()));
  }
  for (const out of outputs) assert.deepEqual(out,['20261108',0,23*60+15,'2026-11-07']);
});

test('actual scheduled news and weekend pushes consume the China clock, but market gates stay separate', () => {
  const start=server.indexOf("const newsChinaClock = require('./src/core/news-china-clock').newsChinaClock;");
  const end=server.indexOf('// ═══ go 轮 B2+B3',start);
  assert.ok(start>0&&end>start&&end-start<12000);
  const segment=server.slice(start,end);
  assert.equal((segment.match(/const d = newsChinaClock\(\)/g)||[]).length,2);
  assert.equal((segment.match(/const ds = d\.dayKey;/g)||[]).length,2);
  assert.match(segment,/const dsLabel = \(\) => newsChinaClock\(\)\.isoDay;/);
  assert.match(segment,/const sat = d\.previousIsoDay/);
  assert.match(segment,/const sun = d\.isoDay/);
  assert.match(segment,/d\.getDay\(\) !== 0 && t >= 21 \* 60 && t < 24 \* 60/);
  assert.match(segment,/d\.getDay\(\) === 0 && t >= 21 \* 60 && t < 24 \* 60/);
  assert.match(segment,/!sentToday\(digestSentDate, ds/);
  assert.match(segment,/!sentToday\(weekendSentDate, ds/);
  assert.doesNotMatch(segment,/force=1|\/api\/paper\/action/);
  assert.match(server,/if \(!isTradeDay\(d\)\) return;/);
});
