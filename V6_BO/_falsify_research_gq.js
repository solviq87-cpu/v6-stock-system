// 反证测试：gq 轮守门 _test_research_gq.js 是不是真能抓到回归
// 做法：把 8 种「旧写法/错写法」分别注入临时副本，跑同一套守门，必须全部变红。
// 有一条变异后守门仍然全绿 = 那条断言是摆设，回头补。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const NODE = 'C:/Users/28957/.workbuddy/binaries/node/versions/22.22.2-6/node.exe';
const ROOT = __dirname;
const TMP = path.join(ROOT, '_falsify_gq');

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);
if (!fs.existsSync(path.join(TMP, 'public'))) fs.mkdirSync(path.join(TMP, 'public'));
// 守门运行所需的全部文件（含它读的研究产物与 learnall；public/index.html 按原相对路径）
for (const f of ['_test_research_gq.js', 'learnall.js', '_research_gq_out.json', 'server.js', 'analysis.js', 'public/index.html']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
}

const MUTS = [
  {
    name: 'M1 去掉大市值惩罚（模型不含 capYi 分支）',
    file: 'analysis.js',
    from: "  if (_cap >= 500) z -= 1.0;\n  else if (_cap >= 100) z -= 0.5;",
    to: "  void _cap;"
  },
  {
    name: 'M2 去掉中位惩罚（模型不含 rangePos 分支）',
    file: 'analysis.js',
    from: "  if (_rp >= 30 && _rp <= 70) z -= 0.6;",
    to: "  void _rp;"
  },
  {
    name: 'M3 判不出当看空（缺 capYi 按 100 亿罚）',
    file: 'analysis.js',
    from: "  const _cap = _n(capYi);",
    to: "  const _cap = _n(capYi) || 100;"
  },
  {
    name: 'M4 位置档位写开区间（30/70 边界不罚，与实测口径不符）',
    file: 'analysis.js',
    from: "  if (_rp >= 30 && _rp <= 70) z -= 0.6;",
    to: "  if (_rp > 30 && _rp < 70) z -= 0.6;"
  },
  {
    name: 'M5 ATR 钳制方向反了（变成只收紧不放宽）',
    file: 'server.js',
    from: "  return Math.min(Math.max(atrStop / 100, ATR_STOP_MAX_PCT / 100), floor);",
    to: "  return Math.max(Math.min(atrStop / 100, ATR_STOP_MAX_PCT / 100), floor);"
  },
  {
    name: 'M6 ATR 不封顶（最宽无界，纯 ATR 肥尾 -28.9% 那条）',
    file: 'server.js',
    from: "  return Math.min(Math.max(atrStop / 100, ATR_STOP_MAX_PCT / 100), floor);",
    to: "  return Math.min(atrStop / 100, floor);"
  },
  {
    name: 'M7 linkedStop 忽略第三参（ATR 基础线白算）',
    file: 'server.js',
    from: "  const bs = Number.isFinite(baseStop) ? baseStop : cfg.sl;",
    to: "  const bs = cfg.sl;"
  },
  {
    name: 'M8 一进二把本地市值 bump 加回来（同一因子双重计数）',
    file: 'server.js',
    from: "    else if (fc > 0 && fc < 5e9) why.push('小盘(<50亿)');",
    to: "    else if (fc > 0 && fc < 5e9) { prob += 4; why.push('小盘(<50亿)'); }"
  },
  {
    name: 'M9 统计脚注胜率门退回原始配置值（一屏两个数回归）',
    file: 'server.js',
    from: "    minProb: (typeof pushMinProbEff === 'function') ? pushMinProbEff() : pushMinProb(),",
    to: "    minProb: pushMinProb(),"
  }
];

let allRed = true;
for (const m of MUTS) {
  // 每次都用干净原稿重新拷（上一次的变异不许累积）
  for (const f of ['server.js', 'analysis.js', 'public/index.html']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
  }
  const p = path.join(TMP, m.file);
  const s = fs.readFileSync(p, 'utf8');
  if (!s.includes(m.from)) {
    console.log('⚠️  ' + m.name + ' → 变异串没命中（源码已变？），跳过');
    allRed = false;
    continue;
  }
  fs.writeFileSync(p, s.split(m.from).join(m.to));
  let red = false, detail = '';
  try {
    const out = execFileSync(NODE, [path.join(TMP, '_test_research_gq.js')], { encoding: 'utf8', stdio: 'pipe' });
    detail = (out.match(/结果：\d+ 通过 \/ \d+ 失败/) || ['(无结果行)'])[0];
  } catch (e) {
    red = true;   // 退出码非 0 = 守门红了（或崩了）
    const out = (e.stdout || '') + (e.stderr || '');
    const fails = (out.match(/❌[^\n]*/g) || []).slice(0, 2).join(' | ');
    detail = fails || '套件崩溃（注入漏符号也算红）';
  }
  console.log((red ? '✅ 变红 ' : '❌ 仍绿 ') + m.name + '  → ' + detail);
  if (!red) allRed = false;
}

// 清理（先删子目录里的文件，再删目录本体；第二跳跳过目录项）
for (const f of fs.readdirSync(path.join(TMP, 'public'))) fs.unlinkSync(path.join(TMP, 'public', f));
for (const f of fs.readdirSync(TMP)) {
  const p = path.join(TMP, f);
  if (fs.statSync(p).isFile()) fs.unlinkSync(p);
}
fs.rmdirSync(path.join(TMP, 'public'));
fs.rmdirSync(TMP);

console.log('\n' + (allRed ? '✅ 全部变异都被守门抓到（守门不是摆设）' : '❌ 有变异没被抓到，回头补断言'));
process.exit(allRed ? 0 : 1);
