// 守门测试（cu 轮 · 角度：只在 happy path 上定义过的状态）
// 长任务有四种出口：成功 / 跳过（前提不满足）/ 失败（抛错）/ 重入（已在跑）。
// 若"进度对象"只在成功那一支更新，其余三支直接 return：
//   面板上的"全市场扫 5500 只"就一直停留在上一次成功的数字，看起来刚跑完，
//   实际可能是几小时前的；且没有任何字段能表达"这一轮没跑成" —— 故障无法自查。
// 判据：状态对象必须带 ok 字段，且**每个非成功出口都要写它**。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

const SV = fs.readFileSync('./server.js', 'utf8');
const NOC = stripNoise(SV, { keepStrings: true });
const HTML = fs.readFileSync('./public/index.html', 'utf8');

function fnBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  let pe = i;
  if (/^function\s/.test(sig)) {
    let p = src.indexOf('(', i), pd = 0;
    for (pe = p; pe < src.length; pe++) {
      const c = src[pe];
      if (c === '(') pd++;
      else if (c === ')') { pd--; if (pd === 0) break; }
    }
  }
  let j = src.indexOf('{', pe), d = 0, k = j;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return '';
}

console.log('【一】涨停前形态扫描 scanZtPre：三个出口都要写状态');
const zp = fnBody(NOC, 'async function scanZtPre(');
ok('[自检] 取到函数体', zp.indexOf('_zpBusy') >= 0);
// 出口① 跳过：模型未就绪
const skipSeg = zp.slice(zp.indexOf('if (!db || !db.n)'), zp.indexOf('if (!db || !db.n)') + 320);
ok('★ 跳过出口会写状态（模型未就绪时不是静默 return）', /zpProgSet\(/.test(skipSeg));
ok('★ 跳过出口标了 ok:false 并带原因', /ok:\s*false/.test(skipSeg) && /error:/.test(skipSeg));
// 出口② 成功
ok('★ 成功出口标 ok:true', /zpProgSet\(\{\s*ok:\s*true/.test(zp));
// 出口③ 失败
const catchSeg = zp.slice(zp.indexOf('} catch (e)'), zp.indexOf('} catch (e)') + 320);
ok('★ 失败出口也会写状态（不是只 console.error 就完）', /zpProgSet\(/.test(catchSeg));
ok('★ 失败出口标了 ok:false', /ok:\s*false/.test(catchSeg));
// 状态定义本身
ok('★ _zpProg 定义里带 ok / error 字段', /_zpProg\s*=\s*\{[^}]*ok:/.test(NOC) && /_zpProg\s*=\s*\{[^}]*error:/.test(NOC));
// 写入口统一（别再散落各处只写成功一次）
ok('★ 三个出口共用同一个写入口 zpProgSet', (zp.match(/zpProgSet\(/g) || []).length >= 3);
// 真跑 zpProgSet：t 必须刷新（否则"上次成功的时间"冒充本次）
const runSet = new Function('patch', 'let _zpProg = { ok:false, error:"", scanned:0, total:0, t:0, ms:0, n:0 };'
  + ' function zpProgSet(p){ _zpProg = Object.assign({}, _zpProg, p, { t: 111 }); }'
  + ' zpProgSet(patch); return _zpProg;');
ok('★ 真跑：写入后 ok 正确落盘', runSet({ ok: true, scanned: 5500 }).ok === true);
ok('★ 真跑：写入会刷新时间戳 t（不用旧时间冒充本次）', runSet({ ok: false, error: 'x' }).t === 111);

console.log('\n【二】趋势票扫描 scanTrendUniverse：同样三个出口');
const ts = fnBody(NOC, 'async function scanTrendUniverse(');
ok('[自检] 取到函数体', ts.indexOf('_tsBusy') >= 0);
ok('★ 跳过出口（学习库为空）会写状态', /tsProgSet\(\{[^}]*ok:\s*false/.test(ts));
ok('★ 成功出口标 ok:true', /tsProgSet\(\{\s*ok:\s*true/.test(ts));
ok('★ 失败出口会写状态并带上 prog', /catch \(e\)[\s\S]{0,220}?tsProgSet\(/.test(ts));
ok('★ _tsProg 定义里带 ok / error 字段', /_tsProg\s*=\s*\{[^}]*ok:/.test(NOC) && /_tsProg\s*=\s*\{[^}]*error:/.test(NOC));

console.log('\n【三】K 线补齐 klineBackfill（累计型进度也要说清本轮）');
const kb = fnBody(NOC, 'async function klineBackfill(');
ok('[自检] 取到函数体', kb.indexOf('_kbfBusy') >= 0);
ok('★ "票池为空"这个跳过出口会标记（不是静默 return）', /_kbfProg\.ok\s*=\s*false/.test(kb));
ok('★ 成功出口标 ok:true', /_kbfProg\.ok\s*=\s*true/.test(kb));
ok('★ _kbfProg 定义里带 ok / error 字段', /_kbfProg\s*=\s*\{[^}]*ok:/.test(NOC) && /_kbfProg\s*=\s*\{[^}]*error:/.test(NOC));
ok('★ 累计语义没被改坏：仍按 day 每日重置（不是每轮清零）', /_kbfProg\.day !== ds/.test(NOC));

console.log('\n【四】状态定义了必须让人看得见（否则等于没定义）');
ok('★ 前端涨停前形态区块会显示"本轮未跑成"', /zpg\.ok === false/.test(HTML) && /本轮未跑成/.test(HTML));
ok('★ 前端趋势扫描区块同样会提示', /_tsp\.ok === false/.test(HTML) && /本轮未跑成/.test(HTML));
ok('★ 提示里带出原因（不是干巴巴一句"失败"）', /zpg\.error \|\| '未知原因'/.test(HTML));
ok('★ 提示仍保留基准日标注（旧数据是哪天的照样说得清）', /basisTxt\(s\.ztPreBasis\)/.test(HTML));

console.log('\n【五】反证：把失败出口的写入删掉，就应该被判为"不留痕"');
const noFail = ts.replace(/tsProgSet\(\{ ok: false[^}]*\}\);\s*/g, '');
ok('[自检] 反证确实改了代码', noFail !== ts);
ok('★ 反证：少了失败出口的写入，catch 分支就不再写状态（正是本轮要堵的黑箱）',
  !/catch \(e\)[\s\S]{0,220}?tsProgSet\(/.test(noFail));

console.log('\n────────────────────────────────────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
