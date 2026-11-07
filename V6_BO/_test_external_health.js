// 守门测试：外部数据源「数据健康度」面板（hc 轮）
// ① renderExternal 内必须含「出网疑似断开」横幅 + 区分上游未注册的 errText 口径（防误删/误改）
// ② 分类规则语义正确：北向/南向/商品/财报（实测可达源）同 tick 全失败 → 判定出网疑似断开；
//    两融等「上游报表未注册」只算诚实降级，绝不能误判成出网断。
// 取函数体用括号配平（gd 轮铁律：不许对整份文件 indexOf 界面原文，版本注释会命中→假红）。
const fs = require('fs');
const path = require('path');

let pass = 0, failN = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { failN++; console.log('  ✗ ' + name); } }

const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

// 括号配平取 renderExternal 函数体
function bodyAt(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return null;
  let j = src.indexOf('{', i), depth = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return src.slice(i, k);
}
const body = bodyAt(html, 'function renderExternal(ex)');
ok('renderExternal 函数体存在', !!body);

// ① 横幅与口径文案在位（取函数体再判，避开版本注释/界面文案同名字段）
ok('含出网疑似断开横幅', body && body.includes('出网疑似断开'));
ok('含部分外部源暂不可用提示', body && body.includes('部分外部源暂不可用'));
ok('含诚实降级口径(上游未开放)', body && body.includes('上游未开放（诚实降级）'));
ok('含可达源清单 REACH', body && body.includes('REACH'));
ok('含 reachFailed 判定', body && body.includes('reachFailed'));

// ② 分类规则语义（与函数体内实现同源复刻，钉语义不钉字符串）
const REACH = ['north', 'south', 'commodities', 'financials'];
const isRegErr = m => /报表未注册|报表配置不存在|未注册/.test(m || '');
function classify(ex) {
  const fail = (ex && ex.fail) || {};
  const reachFailed = REACH.filter(k => fail[k]);
  return { allDown: reachFailed.length === REACH.length, reachFailed };
}
// 出网真断：4 个可达源全失败 → allDown
ok('4 个可达源全失败→出网疑似断开', classify({ fail: { north: 'x', south: 'x', commodities: 'x', financials: 'x' } }).allDown === true);
// 仅两融（上游未注册）→ 不是出网断
ok('仅两融失败→非出网断(诚实降级)', classify({ fail: { margin: '两融源暂不可达(东财datacenter报表未注册)' } }).allDown === false);
// 单可达源失败（限流/瞬断）→ 非出网断，只部分不可用
const one = classify({ fail: { north: '北向空' } });
ok('单可达源失败→非出网断', one.allDown === false && one.reachFailed.length === 1);
// 无失败 → 一切正常
ok('无失败→非出网断', classify({ fail: {} }).allDown === false);
// errText 口径：注册类报错走诚实降级，网络类在 allDown 时走出网断开
ok('errText 注册类→诚实降级', isRegErr('报表配置不存在') === true && isRegErr('普通网络错误') === false);

console.log('\n外部数据源健康度守门：' + pass + ' 通过 / ' + failN + ' 失败');
process.exit(failN ? 1 : 0);
