// 排查：do 轮里其它断言会不会也被 APP_VER 那行超长版本注释污染
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const sc = SV.split('\n').filter(l => !l.startsWith('const APP_VER = ')).join('\n');
const hc = HV.split('\n').filter(l => !l.startsWith('const APP_VER = ')).join('\n');
// 也顺便看看哪些断言在「带注释版」与「剥注释版」下结论不同 = 会被污染
const tests = [
  ['server: stateCut 下发', sc, /stateCut:\s*stateCut\(\)/],
  ['server: trendPool slice(0,50)', sc, /trendPool:\s*\(S\.trendPool \|\| \[\]\)\.slice\(0,\s*50\)/],
  ['server: outN 下发', sc, /outN:\s*outNState\(\)/],
  ['server: poolSize 来源', sc, /poolSize:\s*S\.candidatePool\.length/],
  ['server: STATE_CUT 定义', sc, /const STATE_CUT = \{/],
  ['html: cutN 定义', hc, /function cutN\(s, key, fallback\)/],
  ['html: cutShown 定义', hc, /function cutShown\(s, key, fallback\)/],
  ['html: tpInfo 走 cutN', hc, /tpInfo'\)\.textContent = `共 \$\{cutN\(s, 'trendPool'/],
  ['html: smallyang 走 cutN', hc, /\$\{cutN\(s, 'smallyang'/],
  ['html: 无裸用 trendPool.length', hc, /共 \$\{s\.trendPool\.length\}/]   // 期望：false
];
for (const [name, src, re] of tests) {
  const clean = re.test(src);
  const raw = re.test(name.startsWith('server') ? SV : HV);
  const flag = (clean !== raw) ? '⚠ 被注释污染（剥/不剥结论不同）' : (clean ? '✅' : '·  未命中');
  console.log('  %s  %-30s 剥注释=%s  原始=%s', flag.padEnd(28), name, clean, raw);
}
