// 最终重建涨停前学习库：必须走 Z.ingestAll 而不是自己拼 stat，
// 否则 prog（幂等游标）/ days（日期分布）不会被维护 ——
// 手写拼库那次实测 prog=0，服务下一轮入库会把 21.8 万样本**整份重复累加**。
const fs = require('fs');
const path = require('path');
const Z = require('./ztpre.js');
const A = require('./analysis.js');

const CACHE = path.join(__dirname, '.kline_cache');
const files = fs.readdirSync(CACHE).filter(f => /^\d{6}\.json$/.test(f));
const T0 = Date.now();
const rowsByCode = {}, names = {};
for (const fn of files) {
  const code = fn.slice(0, 6);
  let d; try { d = JSON.parse(fs.readFileSync(path.join(CACHE, fn), 'utf8')); } catch { continue; }
  const rows = (d && d.rows) || [];
  if (rows.length < 40) continue;
  names[code] = d.name || '';
  rowsByCode[code] = rows;
}
console.log(`读入 ${Object.keys(rowsByCode).length} 只票，开始入库（含二维组合统计）...`);

const r = Z.ingestAll(rowsByCode, {
  names,
  limitOf: (code, name) => A.limitPctOf(code, name)
});
console.log(`入库完成：+${r.added} 条 / ${r.codes} 只 / 累计 ${r.n} 条 / 基准封板 ${(r.baseZt * 100).toFixed(2)}% / 耗时 ${((Date.now() - T0) / 1000).toFixed(0)}s`);

const db = Z.db();
console.log(`prog ${Object.keys(db.prog || {}).length} 条 · days ${Object.keys(db.days || {}).length} 条 · stat ${Object.keys(db.stat).length} 个键（组合 ${Object.keys(db.stat).filter(k => k[0] === 'P').length}）`);

const prev = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).calib : null;
db.calib = prev || db.calib;
db.rules = Z.mineRules(db);
Z.save();
const sr = db.rules.filter(x => x.key[0] === 'S').length, pr = db.rules.filter(x => x.key[0] === 'P').length;
console.log(`规则：单维 ${sr} 条 + 组合 ${pr} 条`);
console.log(`标定：${JSON.stringify(db.calib)}`);
console.log(`文件：${(fs.statSync('ztpre.json').size / 1024).toFixed(0)}KB`);
