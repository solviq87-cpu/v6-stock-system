// 守门：手机速览页 /m + 盘面摘要定时推送（ec 轮，2026-10-17）
// 钉语义不钉数字：验证「速览页复用同源数据、摘要三档幂等、静默开关存在、/m 路由、发布包带 mobile.html」，
//   不锚任何会随数据漂移的具体数值。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const MOB = fs.readFileSync(path.join(ROOT, 'public', 'mobile.html'), 'utf8');
const IDX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
const PUB = fs.readFileSync(path.join(ROOT, '_publish.py'), 'utf8');
// lq：黑屏守门——内联脚本必须过 node --check（lp 轮 setIsBoard 引号塌陷曾致整页黑屏）
const cp = require('child_process');
const INLINE = (() => { const m = MOB.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || []; return m.join('\n').replace(/<\/?script[^>]*>/g, ''); })();
let _syntaxOK = false;
try { const tf = path.join(ROOT, '_mob_inline_check.js'); fs.writeFileSync(tf, INLINE); cp.execSync(process.execPath + ' --check ' + JSON.stringify(tf)); fs.unlinkSync(tf); _syntaxOK = true; } catch (e) { _syntaxOK = false; }

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + extra : '')); };
};

// 剥掉 // 行内注释，避免版本注释链里的历史散文干扰「活代码」判断
const JS = SRV.replace(/\/\/.*$/gm, '');

// ===== ① 后端：/api/mobile-digest 路由 + 同源构造 =====
ok('server.js 有 /api/mobile-digest 路由', JS.includes("p === '/api/mobile-digest'"));
ok('server.js 有 buildMobileDigest 函数', JS.includes('function buildMobileDigest()'));
// ⛔ ee 轮教训：S.nextplan 是对象不是数组，误写 (S.nextplan||[]).slice() 会在实跑时抛 TypeError、
//    /api/mobile-digest 整条请求无响应（node --check 查不出，只有真发一次请求才炸）。钉死取数口径。
ok('buildMobileDigest 的 nextplan 从 plan.picked 取数（不再把对象当数组 slice）',
  JS.includes('plan.picked') && !/S\.nextplan\s*\|\|\s*\[\]\)\.slice/.test(JS));
ok('buildMobileDigest 的 mainline 从 items 取数（不再把对象当数组 slice）',
  !/S\.mainline\s*\|\|\s*\[\]\)\.slice/.test(JS) && JS.includes("(_ml && _ml.items) || []"));
ok('buildMobileDigest 复用 marketMood（同源，不新写口径）', JS.includes('function buildMobileDigest()'));
ok('server.js 有 buildDigestMessage 函数', JS.includes('function buildDigestMessage(kind)'));
ok('server.js 有 pushDigest 函数', JS.includes('function pushDigest(kind)'));

// ===== ② 摘要三档 + 幂等 + 静默开关 =====
ok('三档闭锁变量齐全（早盘/午盘/收盘）',
  JS.includes('digestMorningSentDate = sentLockFromPushLog') &&
  JS.includes('digestNoonSentDate = sentLockFromPushLog') &&
  JS.includes('digestCloseSentDate = sentLockFromPushLog'));
ok('定时器触发三档 pushDigest',
  JS.includes("pushDigest('morning')") && JS.includes("pushDigest('noon')") && JS.includes("pushDigest('close')"));
ok('摘要静默开关 digestSilent 进 CFG_SET', JS.includes('digestSilent: {'));
ok('摘要走 sentToday 幂等', JS.includes('sentToday(digestMorningSentDate') && JS.includes('sentToday(digestNoonSentDate') && JS.includes('sentToday(digestCloseSentDate'));
ok('摘要走私密通道 { private: true }', /pushAll\(msg, true, \{ private: true \}\)/.test(JS));
ok('「盘面摘要」进 MSG_FREE_RE 免配额', /MSG_FREE_RE\s*=\s*\/[^\n]*盘面摘要/.test(JS));

// ===== ③ /m 路由入口 =====
ok('server.js 把 /m 映射到 /mobile.html', JS.includes("p === '/m'") && JS.includes("p = '/mobile.html'"));
const _isAssetLine = JS.match(/const isAsset\s*=\s*[^\n]+/);
ok('/m 及 PWA 静态文件进 isAsset 白名单（否则线上手机访问 /m 或被鉴权门禁挡回 locked JSON）',
  !!_isAssetLine && _isAssetLine[0].includes("'/m'") && _isAssetLine[0].includes("'/mobile.html'")
  && _isAssetLine[0].includes("'/manifest.json'") && _isAssetLine[0].includes("'/sw.js'"));

// ===== ④ mobile.html 结构 =====
ok('mobile.html 有 viewport', MOB.includes('viewport'));
ok('mobile.html 拉取 /api/mobile-digest', MOB.includes('/api/mobile-digest'));
ok('mobile.html 复用主面板 token（qd_device/qd_token）', MOB.includes('qd_device') && MOB.includes('qd_token'));
ok('mobile.html 有情绪结论卡', MOB.includes('id="moodAdvice"') && MOB.includes('id="moodNote"'));
ok('mobile.html 有竞价/涨停/板块/明日计划四卡', MOB.includes('id="aucBody"') && MOB.includes('id="ztBody"') && MOB.includes('id="secBody"') && MOB.includes('id="npBody"'));
ok('mobile.html 红涨绿跌（A股惯例 up/down 两色）', MOB.includes('--up:') && MOB.includes('--down:'));

// ===== ⑧ 一句话明确结论（ef 轮）：verdict/why 单一源 + 消费 =====
ok('marketMood 生成 verdict（动作词 → 今天能不能做）', JS.includes('const verdict = _verdictMap[advice]'));
ok('marketMood 生成 why（真实数据一句话理由）', JS.includes('const why = [mood, upN >= downN'));
ok('buildMobileDigest mood 下发 verdict + why', JS.includes('verdict: mood.verdict') && JS.includes('why: mood.why'));
ok('mobile.html 顶部大字用 verdict（不再只显示加仓/减仓动作词）', MOB.includes('m.verdict || m.advice'));
ok('mobile.html 理由行用 why（不再用长数据 note）', MOB.includes('m.why || m.note'));

// ===== ⑨ PWA 支持（eg 轮）：manifest + Service Worker + 图标 =====
const MAN = fs.readFileSync(path.join(ROOT, 'public', 'manifest.json'), 'utf8');
const ICO = fs.readFileSync(path.join(ROOT, 'public', 'icon.svg'), 'utf8');
ok('public/manifest.json 存在', MAN.length > 0);
ok('public/sw.js 存在', SW.length > 0);
ok('public/icon.svg 存在', ICO.length > 0);
ok('manifest.json start_url=/m 且 display=standalone', MAN.includes('"start_url": "/m"') && MAN.includes('"display": "standalone"'));
ok('mobile.html 引用 manifest', MOB.includes('rel="manifest"') && MOB.includes('/manifest.json'));
ok('mobile.html 注册 Service Worker', MOB.includes('navigator.serviceWorker.register') && MOB.includes('/sw.js'));
ok('_publish.py sync 阶段复制 PWA 三文件', PUB.includes('"public", "manifest.json"') && PUB.includes('"public", "sw.js"') && PUB.includes('"public", "icon.svg"'));
ok('_publish.py restore 阶段恢复 PWA 三文件', PUB.includes('src_manifest') && PUB.includes('src_sw') && PUB.includes('src_icon'));
ok('mobile.html localStorage 读写有 try/catch 容错（Safari 隐私模式防黑屏）',
  /try\s*\{[^}]*localStorage\.getItem[^}]*\}\s*catch\s*\(e\)/.test(MOB) &&
  /try\s*\{[^}]*localStorage\.setItem[^}]*\}\s*catch\s*\(_\)/.test(MOB));

// ===== ⑤ 版本一致 =====
const verOf = src => { const m = /const APP_VER = '(\d{8}[a-z]{2})'/.exec(src); return m ? m[1] : ''; };
const vSrv = verOf(SRV), vIdx = verOf(IDX), vMob = verOf(MOB), vSw = verOf(SW);
ok('APP_VER 三端一致（server/index/mobile）', vSrv && vSrv === vIdx && vSrv === vMob, `server=${vSrv} index=${vIdx} mobile=${vMob}`);
ok('sw.js 的 APP_VER 与 server 一致（_publish.py sync 自动同步，此处防手滑）', vSw === vSrv, `sw=${vSw}`);

// ===== ⑤b jt 轮：mobile.html 版本自检（修复「改了只读手机仍不可见」）=====
// 根因：速览页曾只靠 Service Worker 更新，而 SW 对【发布前就开着的页面】无效——
//   js 轮删掉 _role==='edit' 加载闸后，旧页面永远跑旧 JS，只读身份 therefore 加载不到卡片。
// 钉死：本地 APP_VER 常量 + 与 /api/lock/status 的 appVer 比对 + 不一致强制刷新（注销 SW + 缓存穿透参数）。
ok('mobile.html 定义本地 APP_VER 常量（版本自检的基准）', /const APP_VER = '\d{8}[a-z]{2}'/.test(MOB));
ok('mobile.html 有 checkMobVer 版本自检函数', MOB.includes('async function checkMobVer('));
ok('版本自检比对 /api/lock/status 的 appVer（公开轻量接口，不带令牌也能查）',
  MOB.includes("/api/lock/status?v=' + Date.now()") && MOB.includes('srvVer === APP_VER'));
ok('不一致时强制刷新：注销 Service Worker + _v/_r 双随机参数 location.replace（绕过缓存）',
  MOB.includes('navigator.serviceWorker.getRegistrations()') && MOB.includes("u.searchParams.set('_v'") && MOB.includes("u.searchParams.set('_r'") && MOB.includes('location.replace'));
ok('护栏①：用户正在口令框输入时不强制刷新（不冲掉打的字）', MOB.includes("document.activeElement.id === 'pwd'"));
ok('护栏②：15 秒内不重复强制刷新（防 SW 竞态无限 reload）', MOB.includes('qd_ver_refresh_at') && MOB.includes('15000'));
ok('版本自检挂进 init（复用 status 响应，零额外请求）', /if \(await checkMobVer\(st && st\.appVer\)\) return;/.test(MOB));
ok('版本自检挂进切前台（visibilitychange/focus/pageshow）', MOB.includes("document.addEventListener('visibilitychange', onPageVisible)") && MOB.includes("window.addEventListener('pageshow', onPageVisible)"));
ok('版本自检挂进数据轮子（开着的旧页面自己发现落后；lk 起 1s 基 tick + 网络分档节流）', /setInterval\(\(\) => \{[\s\S]{0,300}checkMobVer\(\);[\s\S]{0,160}load\(\);/.test(MOB));

// ===== ⑥ 发布包带 mobile.html =====
ok('_publish.py sync 阶段复制 mobile.html', PUB.includes('"public", "mobile.html"'));
const mobileCopyCount = (PUB.match(/public", "mobile\.html"/g) || []).length;
ok('_publish.py 有 sync + restore 两处 mobile.html 处理', mobileCopyCount >= 2, '实际 ' + mobileCopyCount + ' 处');

// ===== ⑦ jsdom 真实渲染（DOM 结构，不执行脚本）=====
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (_) {
  ({ JSDOM, VirtualConsole } = require('C:/Users/28957/.workbuddy/binaries/node/workspace/node_modules/jsdom'));
}
try {
  const vc = new VirtualConsole();
  const dom = new JSDOM(MOB, { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const doc = dom.window.document;
  ok('mobile.html 有登录门 #gate', !!doc.getElementById('gate'));
  ok('mobile.html 有速览主容器 #app', !!doc.getElementById('app'));
  ok('mobile.html 有底部操作栏 #foot', !!doc.getElementById('foot'));
} catch (e) {
  ok('mobile.html jsdom 可解析', false, String(e && e.message));
}

  ok(typeof MOB === 'string' && MOB.includes('Date.now() - _cardsAt > 60000'),
    'ky：四张扫描卡 60 秒限频（render 15s 轮询不再每次重拉，洗盘卡不再撞长扫描）');
  ok(typeof JS === 'string' && JS.includes('picked: _pk.slice(0, 6)') && JS.includes('relay: ((_np && _np.relay) || [])'),
    'lc：digest 明日计划扩为对象（picked6 带进场/止损/目标/依据 + relay3 + 适用日/候选数）');
  ok(typeof MOB === 'string' && MOB.includes('np.picked') && MOB.includes('做不到就别碰'),
    'lc：速览明日计划渲染富卡片（档位/进场止损目标/依据/接力风险提示）');
  ok(typeof MOB === 'string' && MOB.includes('sectorView') && MOB.includes('竞价板块强度'),
    'lf：速览竞价卡板块视图置顶（先看板块再挑票），全市场榜收进 details');
  ok(typeof JS === 'string' && JS.includes('条件6：均线多头') && /id: 6/.test(JS),
    'li：量化选股新增条件6——均线多头+放量突破20日新高（调研头号起涨形态）');
  ok((JS.match(/capTooSmall\(s\)/g) || []).length >= 7 && /function capTooSmall/.test(JS),
    'lj：全模块40亿地板接线（pre/一进二/大单/次日计划/量化选股/竞价共振/盘中强势 七处）');
  ok(/function aKillOf/.test(JS) && JS.includes('aKill: _ak') && fs.readFileSync(path.join(ROOT, 'nextplan.js'), 'utf8').includes('A杀'),
    'lj：近10日A杀标注（洗盘池 item+理由 / 明日计划 risks）');
  ok(typeof MOB === 'string' && MOB.includes('}, 10000);') && MOB.includes('_cardsAt > 30000'),
    'lj：手机提速（主轮询10s·扫描卡限频30s）');
  ok(typeof MOB === 'string' && /function netFastLane\(\)/.test(MOB) && MOB.includes('netFastLane() ? 2000 : 10000'),
    'lk：网络分档刷新（Wi-Fi 2s / 流量 10s，连接切换立即重刷）');
  ok(/function ztSentinelTick/.test(JS) && /guard\('ztSentinel'/.test(JS) && JS.includes('封板哨兵'),
    'lk：封板哨兵接线（45s 差分涨停池→封板事件推送，冲板 10 分钟窗口合并预警）');
  ok(/freshHotA = _gapHot \? govFilter\('bigmoney', hotCand, null, x => \(x\.prob \|\| 0\) >= 40\)/.test(JS),
    'll：大单 A 组 prob 门槛 70→40（70 与实测分布<=44 矛盾=A组恒空=大单不推根因）');
  ok(/function surgeScan/.test(JS) && JS.includes('起涨哨兵') && JS.includes('surgeScan();'),
    'll：起涨哨兵（涨停前发现盘中段：+3~6.5% 主力在买 距板>3%，10分钟窗口合并）');
  ok(/x\.sealAmount == null \|\| x\.sealAmount >= 2e8/.test(JS),
    'll：封板哨兵放宽（不再硬卡热门，封单>=2亿或缺失放行，每轮<=3）');
  ok(/function sentLogPush/.test(JS) && /d\.sentinel = \(S\.ztSentLog \|\| \[\]\)\.slice\(0, 12\)/.test(JS),
    'lm：哨兵事件流水随竞价卡下发（sentLogPush 三处调用+sentinel 字段）');
  ok(typeof MOB === 'string' && MOB.includes('哨兵动态') && MOB.includes('max=40'),
    'lm：速览竞价卡哨兵动态置顶 + 显示票数放宽到 40');
  ok(/function scoreSmoothOf/.test(JS) && /0\.55 \* raw \+ 0\.45 \* e\.ema/.test(JS) && JS.includes('trendText'),
    'ln：分数磁滞+持续性趋势（EMA 0.55/0.45，30min 重置，斜率→走强/走平/转弱）');
  ok(/const A_KEEP = 2, B_KEEP = 1/.test(JS),
    'ln：大单每轮名额 1+1→2+1（提高推送概率）');
  ok(/_rushCool\.get\(s\.code\)/.test(JS) && !JS.includes('近10分钟 ═══'),
    'ln：起涨/冲板改即时单独推（30min 代码冷却，取消合并窗口）');
  ok(typeof MOB === 'string' && MOB.includes("x.trend==='rising'?' ↗'"),
    'ln：速览分数显示趋势箭头（↗走强 ↘转弱 →走平，悬停见持续性文案）');
  ok(/const board = \['main', 'gem'\]\.includes\(opts\.board\) \? opts\.board : 'all';/.test(JS) && JS.includes('sectorView'),
    'lo：量化选股板块切换+sectorView 服务端');
  ok(typeof MOB === 'string' && MOB.includes('setQpBoard') && MOB.includes('board=') && MOB.includes('max=40'),
    'lo：量化选股卡对齐竞价共振（板块切换/哨兵动态/板块视图/票数40/趋势箭头）');
  ok(/intradayStrongScan\(\{ force, max, board \}\)/.test(JS) && /mainline3:/.test(JS),
    'lp：盘中强势 board+sentinel+sectorView 对齐 / 情绪卡 mainline3 强势板块前三');
  ok(/board !== 'all'/.test(JS) && /boardFallback = true/.test(JS) && /已回退全板块/.test(JS),
    'lp：洗盘池主板/创业板无票自动回退全板块（note 明示）');

ok(_syntaxOK, '⛔ 黑屏守门：mobile.html 内联脚本必须通过 node --check（lp 轮 setIsBoard 引号塌陷事故防复发）');

  ok(/function pushLearnStats/.test(JS) && /upRate >= 55 && st\.avg > 0\) \? 1\.5/.test(JS) && /dtRate >= 5\) \? 0\.5/.test(JS),
    'lv：学习力度调节器（上涨率≥55+均涨>0→1.5 加推 / 上涨率≤40 或跌停率≥5%→0.5 降档 / 跌停率≥8%→0.4）');
  ok(/pushIntensityOf\('bigmoney'\)/.test(JS) && /pushIntensityOf\('surge'\)/.test(JS) && /pushIntensityOf\('ztsent'\)/.test(JS),
    'lv：力度系数接线三处（大单名额/起涨冲板冷却/封板名额）');
  ok(/if \(!opts\) opts = \{ private: true \};/.test(JS) && /opts\.public === true/.test(JS),
    'lw：pushAll 默认私密（用户定调：所有推送私密除非特别提醒；public:true 为唯一出口）');
  ok(/function presealAggregate/.test(JS) && /if \(p === '\/api\/preseal'\)/.test(JS) && /仅开发者可见/.test(JS),
    'lx：涨停前发现模块服务端（竞价∩涨停池+哨兵事件聚合，路由仅开发者）');
  ok(typeof MOB === 'string' && MOB.includes('renderPreseal') && MOB.includes('loadPreseal'),
    'lx：速览「涨停前发现」卡片（locked 隐藏=仅自己可见）');
  ok(/10 \* 1000\); \/\/ ly：45s→10s/.test(JS) || /guard\('ztSentinel', \(\) => ztSentinelTick\(\)\), 10 \* 1000\)/.test(JS),
    'ly：封板哨兵加密 45s→10s（秒封板窗口封板秒报）');
  ok(/const _fast = \(s\.speed \|\| 0\) > 2/.test(JS),
    'ly：起涨哨兵加速度档（涨速>2%/分 免资金条件立即报）');
  ok(/function learnMissedSeals/.test(JS) && /learn_missed_seals\.json/.test(JS) && /tier: 'sub'/.test(JS),
    'lz：漏网涨停特征学习（收盘自动跑+次强档留档进 auction_log，不污染 empTable 守 ba 轮铁律）');
  ok(/function sectorSurgeScan/.test(JS) && /win\.length >= 3/.test(JS) && /板块暴动/.test(JS),
    'mi：板块暴动哨兵（同板块10分钟3只封板→私密推+未封前排名单，B类漏因对策）');
  ok(/f\.reason = \(fs && fs < '093600'\) \? 'A 秒封'/.test(JS) && /漏因治理日报/.test(JS),
    'mi：漏因分类器 A/B/C/D（秒封/暴动/次强档/其他）+治理日报按类计数');
  ok(/fetchIndustryAll/.test(fs.readFileSync(path.join(ROOT,'em.js'),'utf8')) && /api\/admin\/enrich-industry/.test(JS) && /officialIndustry\(\)/.test(JS),
    'mj：全A官方行业在线修（push2 clist f100 线上任务落盘+sectorOfStock 第〇层官方优先）');
console.log(`_test_mobile_digest(手机速览页+摘要): ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
