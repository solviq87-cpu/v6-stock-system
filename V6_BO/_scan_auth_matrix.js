// 扫描器：路由鉴权矩阵（只读账号能不能执行写操作 / GET 路由有没有副作用）
// 只列事实，不做断言。定性结论与修复由守门测试 _test_auth_matrix.js 钉死。
//
// 切分方式：一条路由的处理段 = 该路由行 → 下一条路由判定行（或函数末尾）之前。
// 比大括号配平稳（模板串/正则里的花括号会骗过配平）。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');

const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const codeLines = stripNoise(SRC, { keepStrings: true }).split('\n');
const raw = SRC.split('\n');

// 路由判定行的特征
const ROUTE_HIT = /p\s*(?:===|==)\s*'\/api\/|p\.indexOf\(\s*'\/api\/|p\.startsWith\(\s*'\/api\//;
const ROUTE_NAME = /p\s*(?:===|==)\s*'([^']+)'|p\.indexOf\(\s*'([^']+)'|p\.startsWith\(\s*'([^']+)'/;

// 收集所有路由判定行
const marks = [];
for (let i = 0; i < codeLines.length; i++) {
  if (!ROUTE_HIT.test(codeLines[i])) continue;
  const m = codeLines[i].match(ROUTE_NAME);
  if (!m) continue;
  marks.push({ line: i + 1, name: m[1] || m[2] || m[3] });
}

const segEndOf = (idx) => (idx + 1 < marks.length ? marks[idx + 1].line - 1 : codeLines.length);

// 鉴权判据（含手写 roleOf 判等）
// ⚠️ 与 'edit' 的比较两种方向都要认：
//    `roleOf(...) === 'edit'` 放行、`roleOf(...) !== 'edit'` 拒绝 —— 后者漏检会误报成"无鉴权"
//    （实测 /api/holdings 的 GET 就是这么写的，第一轮扫描把它错列成漏鉴权）。
//    ⛔ 但 `!== 'view'` 不算：无令牌时 roleOf 返回 null，null !== 'view' 成立 → 照样放行。
const AUTH_RE = /requireEditor\s*\(|isEditorReq\s*\(|roleOf\s*\([^)]*\)\s*(?:!==?\s*'edit'|===?\s*'edit')/;
// 副作用（写盘 / 发消息 / 改台账 / 改持仓 / 重任务）
const EFFECT_RE = /\b(savePaper|saveCfg|savePushGov|saveNews|saveAccess|saveLearn|saveLearnHistory|atomicWrite|pushAll|pushWecom|feishuSend|feishuProbe|pushVerifyCode|govTake|logSignal|HD\.(add|remove|clear|update|set)[A-Za-z]*|_devGenBump|revokeDevice|issueDevice|runLearnallIngest|_rebuildLearnall|logHoldingsOp)\s*\(/;
// 名字带写词根
const WRITE_WORD = /(set|setup|unlock|change|reset|revoke|redeem|approve|bind|trust|update|save|clear|delete|remove|ingest|backfill|restore|refresh|export|kick|grant|rename|edit|write|apply)/i;

const rows = marks.map((mk, idx) => {
  const end = segEndOf(idx);
  const bodyCode = codeLines.slice(mk.line - 1, end).join('\n');
  const bodyRaw = raw.slice(mk.line - 1, end).join('\n');
  return {
    line: mk.line, name: mk.name,
    authed: AUTH_RE.test(bodyCode),
    isPost: /req\.method\s*===?\s*'POST'/.test(bodyCode),
    effect: (bodyRaw.match(EFFECT_RE) || [])[1] || (bodyRaw.match(EFFECT_RE) || [])[0] || '',
    nameWrite: WRITE_WORD.test(mk.name),
    end
  };
});

console.log('═══ A. 路由鉴权矩阵（/api/*）═══');
for (const r of rows) {
  const tag = r.authed ? '🔒 有鉴权' : (r.isPost ? '⚠️ 无·POST' : (r.effect ? '⚠️ 无·副作用' : '· 无·只读'));
  console.log(`  ${String(r.line).padStart(5)}─${String(r.end).padEnd(5)} ${r.name.padEnd(30)} ${tag}${r.effect ? '  [' + r.effect + ']' : ''}`);
}

console.log('\n═══ B. 疑似漏鉴权（POST / 有副作用 / 名字带写词根，但段内无鉴权判据）═══');
const miss = rows.filter(r => !r.authed && (r.isPost || r.effect || r.nameWrite));
for (const r of miss) console.log(`  ⚠️ 行 ${r.line} ${r.name}  POST=${r.isPost} 副作用=${r.effect || '无'} 写词根=${r.nameWrite}`);
console.log(`\n  小计 ${miss.length} 处`);

console.log('\n═══ C. 非 POST 却有副作用的路由（GET 语义里写盘/推送/改台账）═══');
const getEff = rows.filter(r => !r.isPost && r.effect);
for (const r of getEff) console.log(`  · 行 ${r.line} ${r.name} → ${r.effect}`);
console.log(`\n  小计 ${getEff.length} 处`);

console.log('\n（扫描器只列事实、不做断言；定性结论与修复由守门测试钉死。）');
