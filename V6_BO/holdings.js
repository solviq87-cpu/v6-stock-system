// 引入统一涨停口径；analysis.js 是纯函数模块、自身无任何 require，不会形成循环依赖
const A = require('./analysis');
const {holdingEvidence,asHoldingsAct}=require('./src/strategy/holding-signal-evidence');
const {quoteSnapshotFields,quoteUseEligibility,fundsObservationView}=require('./src/core/quote-observation-view');

// 取某只票的利空标题（与 goodTitles 对称，用于综合判断）
function badTitlesJoin(news, code) {
  if (!news || !news.badAll) return '';
  const out = [];
  for (const b of news.badAll) {
    if (b && Array.isArray(b.codes) && b.codes.includes(code) && b.title) out.push(String(b.title));
    if (out.length >= 2) break;
  }
  return out.join('｜');
}
// 重大利好判定：收购/重组/回购/增持/停牌筹划这类，足以推翻技术面的短线看空信号
const GOOD_MAJOR_RE = /收购|重组|购买.*股份|回购|增持|停牌|中标|业绩预增|涨停.*计划|要约/;
// ---------------- 我的持仓：盯盘 · 风控 · 加减仓触发 ----------------
// 以「工厂函数」形式被 server.js 装载：依赖由主服务注入，避免循环 require。
// 存储 holdings.json = {capital, items:[{code,name,cost,shares,note,tags[],locked,addedAt}], stopPct, reducePct, takePct, maxPosPct}
// 权限：持仓属私密数据，仅「本机 / 开发者密码」可见与编辑，观看密码一律不可见也无法通过 API 改。
// 门槛语义遵循全局约定：一律「超过」才触发（>），等于不算。
// 标签/锁仓：每个持仓可挂多个标签（长线/波段/打板…自定义）；locked=true 表示锁仓，
//           锁仓期间不自动建议卖出（减仓/止损/清仓降级为只提示），避免短线噪音打乱长线计划。
module.exports = function createHoldings(dep) {
  // privReady：私密通道（只有本人的机器人）是否已配置。2026-10-05 用户要求：
  //   持仓推到单独机器人群里看不到，才敢把成本/金额/股数写出来；没配就必须继续脱敏。
  const { fs, path, dir, S, em, sseSend, sseSendEdit, pushAll, privReady, isReplica, nowDate, dataWindow } = dep;
  // ⛔ 可注入时钟（默认真实 Date）：watch() 用 getDay() 判「周末跳过止盈/回撤提醒」，
  //    单测若不注入就被"今天星期几"绑架（周六周日恒红、工作日恒绿）—— MEMORY §9 mute 漂红根因。
  //    生产不传 nowDate → 回落真实 Date，行为零变化。
  const _nowDate = typeof nowDate === 'function' ? nowDate : () => new Date();
  // la 轮：数据窗口闸（默认放行=不注入时行为零变化）。生产由 server.js 传 isDataWindow（9:15–15:40）：
  // watch() 的自动风控推送只在窗口内发，盘外只刷面板不打扰（凌晨价格是死的，告警零增量信息）。
  const _inDataWindow = typeof dataWindow === 'function' ? dataWindow : () => true;
  const _priv = () => { try { return typeof privReady === 'function' ? !!privReady() : false; } catch { return false; } };
  const HOLD_FILE = path.join(dir, 'holdings.json');
  const DEFAULTS = { capital: 0, items: [], stopPct: -8, reducePct: -4, takePct: 15, maxPosPct: 90 };
  // 常用标签：面板直接点击即可；也支持自定义输入
  const PRESET_TAGS = ['长线', '波段', '打板', '自选', '核心', '观察'];
  let HOLD = { ...DEFAULTS };
  try {
    const txt = fs.readFileSync(HOLD_FILE, 'utf8');
    try {
      const h = JSON.parse(txt);
      if (h && Array.isArray(h.items)) HOLD = Object.assign(HOLD, h);
    } catch (e) {
      // 半截持仓文件绝不能当成"没有持仓" —— 那正是用户两次遇到的「持仓又没有了」。
      // 留档坏文件，保持内存里的空结构，等面板/运维来恢复。
      try {
        const bad = HOLD_FILE + '.corrupt-' + Date.now();
        fs.renameSync(HOLD_FILE, bad);
        console.error(`[holdings] ⚠️ 持仓文件解析失败，已留档 ${bad}`);
      } catch {}
    }
  } catch {}
  let _cache = { t: 0, data: null };
  // ── 风控去重状态落盘（la 轮 2026-10-27）────────────────────────────────
  // 事故：watch() 的 30 分钟去重 pushed Map 与 oncePushed Set 原是纯内存 —— 线上托管容器
  // 每次回收/发布重启都清零，冷启动 25 秒后 watch 首跑必把还活着的风险条件原样再推一遍。
  // 10-23 晚 20:15–23:35 每 2~3 分钟一条「持仓风控警报」（pushlog 实证 40+ 条）就是
  // 「容器反复回收 × 内存去重清零」的放大结果；与 push_idem 轮修掉的 11 个「每日一条」
  // 内存闭锁是同一类病，这里是漏网的一只。现在跨重启持久化（只存 type:code→ts 与 once 键，
  // 不含成本/金额/股数，无脱敏红线）。
  const HOLD_PUSH_FILE = path.join(dir, '.holdings_push.json');
  const PUSH_STATE_TTL = 7 * 86400 * 1000;   // 过期条目自动清，防多年累积
  const _pushState = (() => {
    try {
      const o = JSON.parse(fs.readFileSync(HOLD_PUSH_FILE, 'utf8'));
      const now = Date.now();
      const rep = {};
      if (o && o.rep && typeof o.rep === 'object') {
        for (const k of Object.keys(o.rep)) {
          const t = Number(o.rep[k]) || 0;
          if (t && now - t < PUSH_STATE_TTL) rep[k] = t;   // 载入即剪枝：过期键不进内存
        }
      }
      const once = (o && Array.isArray(o.once)) ? o.once.filter(k => typeof k === 'string').slice(0, 500) : [];
      return { rep, once };
    } catch (e) {
      // ⛔ hi 轮教训：初始化期失败不许空 catch 静默吞 —— 按空表启动但必须留日志
      console.error('[holdings] 风控去重状态载入失败（按空表启动，可能重启后重推一次）:', e && e.message);
      return { rep: {}, once: [] };
    }
  })();
  const savePushState = () => {
    // ⛔ 单一事实源是内存里的 pushed / oncePushed 两张表（watch 只改它们），
    //    落盘前必须整体回写 —— 只写初始化时的 _pushState.rep 会永远存出空表（首轮实测踩中）。
    //    savePushState 只在 watch 初始化完成后被调用，此处引用后声明的 const 无 TDZ 风险。
    const now = Date.now();
    _pushState.rep = {};
    for (const [k, v] of pushed) { if (now - (v || 0) < PUSH_STATE_TTL) _pushState.rep[k] = v; }
    _pushState.once = [...oncePushed];
    if (_pushState.once.length > 500) _pushState.once = _pushState.once.slice(-500);
    const tmp = HOLD_PUSH_FILE + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(_pushState)); fs.renameSync(tmp, HOLD_PUSH_FILE); }
    catch (e) { console.error('[holdings] 风控去重状态落盘失败（下次重启可能重推）:', e && e.message); }
  };
  // 原子写：先写 .tmp 再 rename，进程被 kill 时不会留下半截 JSON
  const saveHold = () => {
    const tmp = HOLD_FILE + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(HOLD)); fs.renameSync(tmp, HOLD_FILE); }
    catch (e) { try { fs.unlinkSync(tmp); } catch {} }
  };
  // ── 持仓写操作审计 + 自动快照（HOUTAI_AUDIT_V1，2026-09-30 新增）────────────
  // 事故背景：用户两次发现「持仓又没有了」，而 remove / removeMany / clear 这三条写路径
  // 以前是直接改写 items 然后 saveHold —— 既不记「删之前是哪几只」，也不留任何旧文件，
  // 事后只能干瞪眼。典型的静默失败：数据没了，系统里却找不到半个字的痕迹。
  // 现在两条硬保障：
  //   ① 所有写操作登记审计流水 .holdings_ops.json（含增删前后的票清单，最多 500 条）；
  //   ② 只要持仓【条数变少】或【被清空】，额外在 .holdings_bak/ 落一份完整快照（留最近 12 份），
  //      面板「持仓 → 变更记录」可一键还原，不用再去翻 git。
  const HOLD_BAK_DIR = path.join(dir, '.holdings_bak');
  const OPS_FILE = path.join(dir, '.holdings_ops.json');
  const readOps = () => { try { const a = JSON.parse(fs.readFileSync(OPS_FILE, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } };
  function writeOps(list) {
    const tmp = OPS_FILE + '.tmp';   // 原子写：审计流水是"持仓没了"之后唯一的还原凭据，不能写坏
    try { fs.writeFileSync(tmp, JSON.stringify(list.slice(-500))); fs.renameSync(tmp, OPS_FILE); }
    catch (e) { try { fs.unlinkSync(tmp); } catch {} }
  }
  const _brief = items => (items || []).map(x => `${(x && x.code) || ''}${(x && x.name) ? '·' + x.name : ''}`).slice(0, 80);
  // ⛔⛔ 2026-10-06 修（本轮角度：错误分支里的资源与状态回滚 —— 而这里坏的是**回滚凭据本身**）：
  //    快照原来是 `JSON.stringify(HOLD)`，而 commit() 一律在【HOLD.items 已被改掉之后】才被调用，
  //    于是落下来的是**删完 / 清完**的那一份：
  //      · 删一只票 → 快照里只剩剩下的那些，被删的那只根本不在里面；
  //      · 一键清空 → 快照是空列表，还原出来还是空的（实测复现：2 只删 1 只，快照里只剩 1 只）。
  //    这套机制存在的全部意义就是「用户两次发现持仓又没有了，能自己救回来」，
  //    结果还原出来的是一个已经删完的状态 —— 按钮能点、流程走通、数据一条都回不来，
  //    而且比没有快照更糟：它会让人以为"存过档了"，从而不再去找别的补救办法。
  //    现在显式传入要保存的那一份（调用方一律传 before）：快照必须是**操作之前**的持仓。
  function snapshot(reason, items) {
    try {
      if (!fs.existsSync(HOLD_BAK_DIR)) fs.mkdirSync(HOLD_BAK_DIR);
      const fn = path.join(HOLD_BAK_DIR, 'holdings_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '_' + (reason || 'bak') + '.json');
      const snap = Object.assign({}, HOLD, { items: Array.isArray(items) ? items : HOLD.items });
      fs.writeFileSync(fn, JSON.stringify(snap));
      try {
        const files = fs.readdirSync(HOLD_BAK_DIR).filter(f => /^holdings_.*\.json$/.test(f)).sort();
        while (files.length > 12) { const old = files.shift(); try { fs.unlinkSync(path.join(HOLD_BAK_DIR, old)); } catch {} }
      } catch {}
      return fn;
    } catch { return null; }
  }
  // act / before / after / extra {removedCodes, addedCodes}
  function commit(act, before, after, extra) {
    before = before || []; after = after || [];
    try {
      const list = readOps();
      const rec = { t: Date.now(), act, beforeCount: before.length, afterCount: after.length,
        added: (extra && extra.addedCodes) || [], removed: (extra && extra.removedCodes) || [],
        beforeBrief: _brief(before), afterBrief: _brief(after) };
      // ⛔ 传 before：快照要留的是"动手之前"那份，传 HOLD.items 就等于留了个已经删完的
      if (after.length < before.length) rec.snapshot = snapshot(act, before) || '';
      list.push(rec); writeOps(list);
    } catch {}
    saveHold(); bust();
  }
  // 面板/接口用：谁删的、删了啥、能不能救回来
  function ops(n) { const l = readOps(); return l.slice(-Math.max(1, Math.min(500, n || 30))); }
  // 清空变更记录（2026-10-06 新增：治「总有测试持仓」）
  // 起因：守门测试直接打本机 8787 的真实服务建仓/删仓，测试数据写进真实 holdings.json，
  //   又经 syncUpstream 转发到线上 —— 线上 500 条审计流水**全部**是 999999/900001-900003/
  //   600519/000001/300750 这些测试码，用户自己的记录被挤得一条不剩，
  //   面板「持仓 → 变更记录」一打开满屏测试票，看着就像"持仓里有测试数据"。
  //   测试末尾只能删持仓、清不掉流水，所以必须给一条显式清理通道。
  // ⛔ 只清流水与快照，**绝不动 items**（清持仓另有 clear/remove，语义不能混）。
  function purgeOps() {
    const n = readOps().length;
    let snaps = 0;
    try {
      const files = fs.readdirSync(HOLD_BAK_DIR).filter(f => /^holdings_.*\.json$/.test(f));
      for (const f of files) { try { fs.unlinkSync(path.join(HOLD_BAK_DIR, f)); snaps++; } catch {} }
    } catch {}
    try { writeOps([]); } catch {}
    bust();
    return { ok: true, cleared: n, snapshots: snaps, msg: `已清空 ${n} 条变更记录与 ${snaps} 份快照（持仓本身未动）` };
  }
  function snapshots() {
    try {
      const files = fs.readdirSync(HOLD_BAK_DIR).filter(f => /^holdings_.*\.json$/.test(f)).sort();
      return files.slice(-12).map(f => {
        let it = [];
        try { it = (JSON.parse(fs.readFileSync(path.join(HOLD_BAK_DIR, f), 'utf8')).items) || []; } catch {}
        return { file: f, count: it.length, brief: _brief(it).slice(0, 12) };
      }).reverse();
    } catch { return []; }
  }
  function restore(file) {
    const fp = path.join(HOLD_BAK_DIR, String(file || '').replace(/[\\/]/g, ''));
    try {
      const h = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!h || !Array.isArray(h.items)) return { ok: false, error: '备份内容不是有效持仓' };
      const before = HOLD.items.slice();
      HOLD.items = h.items;
      commit('restore', before, HOLD.items, {});
      return { ok: true, count: h.items.length, msg: `已从备份恢复 ${h.items.length} 条持仓` };
    } catch (e) { return { ok: false, error: '读取备份失败: ' + ((e && e.message) || e) }; }
  }
  // 任何写操作后必须让汇总缓存失效，否则面板20秒内看到的还是旧数据
  // ⛔ 必须同时 bump _gen：只清 _cache 挡不住「删除前启动的慢重算跑完又把旧数据写回缓存」
  const bust = () => { _cache = { t: 0, data: null }; _gen = (_gen || 0) + 1; };

  // ---------- 基础读写 ----------
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  // ---------- 标签：支持 "长线,波段" 字符串或数组，去重去空、限量 ----------
  function normTags(v) {
    const arr = Array.isArray(v) ? v : String(v || '').split(/[,，、\s]+/);
    const out = [];
    for (const t of arr) {
      const s = String(t || '').trim().slice(0, 6);
      if (s && !out.includes(s) && out.length < 6) out.push(s);
    }
    return out;
  }
  function addItem(o) {
    const _beforeAdd = HOLD.items.slice();
    const code = String(o.code || '').trim();
    if (!/^\d{6}$/.test(code)) return { ok: false, error: '股票代码须为6位数字' };
    const cost = num(o.cost), shares = num(o.shares);
    if (cost <= 0) return { ok: false, error: '成本价须大于0' };
    if (shares <= 0) return { ok: false, error: '持仓股数须大于0' };
    const name = String(o.name || '').trim() || (S.stocks.find(s => s.code === code) || {}).name || code;
    const tags = normTags(o.tags);
    const locked = !!o.locked;
    const mute = !!o.mute;          // 暂停推送：只停手机提醒，面板照常看
    const hit = HOLD.items.find(x => x.code === code);
    if (hit) { // 已存在按加仓处理：加权平均成本
      const oldCost = num(hit.cost) * num(hit.shares);
      hit.shares = num(hit.shares) + shares;
      hit.cost = +((oldCost + cost * shares) / hit.shares).toFixed(4);
      if (o.note) hit.note = String(o.note).slice(0, 60);
      if (tags.length) hit.tags = normTags([...(hit.tags || []), ...tags]);
      // ⚠️ 加仓场景前端总是下发 locked/mute 布尔值（未勾选=false），直接覆盖会把
      //    用户之前设的锁仓/静音悄悄清掉。这里只允许「加」（false→true），不允许「减」；
      //    想解锁/恢复推送请走行内开关（setlocked/setmute）或「修改」流程（update 带明确意图）。
      if (locked) hit.locked = true;
      if (mute) hit.mute = true;
      // 只有当新名字不是「拿代码凑数的占位名」时才覆盖，别把已解析出的真实名称冲掉
      if (!(name === code && hit.name && hit.name !== code)) hit.name = name;
      hit.updatedAt = Date.now();
    } else {
      HOLD.items.push({ code, name, cost: +cost.toFixed(4), shares, note: String(o.note || '').slice(0, 60), tags, locked, mute, addedAt: Date.now() });
    }
    // 「用户到底加过没有」以前查不出 —— 现在增也留痕，配合删除流水可完整还原时间线
    commit('add', _beforeAdd, HOLD.items, { addedCodes: [code] });
    const tg = tags.length ? ` [${tags.join('/')}]` : '';
    const effL = hit ? hit.locked : locked, effM = hit ? hit.mute : mute;
    const ext = (effL ? '（已锁仓）' : '') + (effM ? '（🔇 已暂停推送）' : '');
    return { ok: true, msg: hit ? `${name} 已加仓，均价更新为 ${hit.cost}${tg}${ext}` : `${name} 已加入持仓盯盘${tg}${ext}` };
  }
  // 一键锁仓：只给「股票代码 + 仓位（股数）」即可锁定
  // 已存在 → 更新股数并置 locked=true；不存在 → 用当时现价建仓（浮盈从 0 起算）并锁定
  // ⛔ 2026-10-06 修：这是除 add 之外**唯一会往持仓里新增条目**的写路径，却走的是裸
  //    `saveHold(); bust();` —— 完全绕过 commit()，于是审计流水里**没有任何 add 记录**。
  //    后果：面板「持仓 → 变更记录」里凭空冒出一只票（线上实测 300750 反复出现），
  //    既查不到是谁加的、也查不到什么时候加的，用户删除它时流水只有 remove 没有 add，
  //    看起来就像「删不干净 / 不知道哪来的」。现在两条分支统一走 commit()。
  async function lockItem(o) {
    const code = String(o.code || '').trim();
    if (!/^\d{6}$/.test(code)) return { ok: false, error: '股票代码须为6位数字' };
    const shares = num(o.shares);
    if (shares <= 0) return { ok: false, error: '仓位（股数）须大于0' };
    const tags = normTags(o.tags);
    const before = HOLD.items.slice();
    const hit = HOLD.items.find(x => x.code === code);
    if (hit) {
      hit.shares = shares;
      hit.locked = true;
      if (o.mute != null) hit.mute = !!o.mute;
      if (tags.length) hit.tags = normTags([...(hit.tags || []), ...tags]);
      if (o.note) hit.note = String(o.note).slice(0, 60);
      hit.updatedAt = Date.now();
      commit('lock', before, HOLD.items, { addedCodes: [] });
      return { ok: true, msg: `🔒 ${hit.name}(${code}) 已锁仓 · ${shares} 股，期间不再自动给卖出建议` };
    }
    // 新建：先取一次现价当成本基准
    let price = 0, nm = '';
    try {
      const snaps = await em.fetchBatchSnapshot([code]);
      const s = (snaps || [])[0];
      price = num(s && s.price); nm = (s && s.name) || '';
    } catch {}
    if (!price) { const st = S.stocks.find(s => s.code === code); price = num(st && st.price); nm = nm || (st && st.name) || ''; }
    if (!price) return { ok: false, error: '取不到该股现价，请稍后再试（或先填成本价正常建仓）' };
    // ⛔ 2026-10-07 修：**判空与写入之间隔着一次 await**（上面拉现价）= 典型 TOCTOU。
    //    这段窗口里「线上→本地对账」可能已经把同一只票补进来（addRemoteItem 只在补的那一刻查重，
    //    看不见本机这条在途的新建），于是同一只票在持仓里出现两条 —— 面板上看是两只一模一样的票，
    //    删掉一只还剩一只，改一只另一只不动，用户只能干瞪眼。
    //    实测 _test_hold2.js 偶发「锁仓生效（3/2）」就是它：等现价那几秒里 300750 被补录了一次。
    //    addItem 那条路径是同步的（判空与 push 之间没有 await），所以只有这里需要补这一道。
    const again = HOLD.items.find(x => x.code === code);
    if (again) {
      again.shares = shares;
      again.locked = true;
      if (o.mute != null) again.mute = !!o.mute;
      if (tags.length) again.tags = normTags([...(again.tags || []), ...tags]);
      if (o.note) again.note = String(o.note).slice(0, 60);
      again.updatedAt = Date.now();
      commit('lock', before, HOLD.items, { addedCodes: [] });
      return { ok: true, msg: `🔒 ${again.name}(${code}) 已锁仓 · ${shares} 股，期间不再自动给卖出建议` };
    }
    HOLD.items.push({
      code, name: String(o.name || nm || code).slice(0, 20), cost: +price.toFixed(4), shares,
      note: String(o.note || '').slice(0, 60), tags: tags.length ? tags : ['自选'], locked: true, mute: !!o.mute, addedAt: Date.now()
    });
    commit('lock', before, HOLD.items, { addedCodes: [code] });
    return { ok: true, msg: `🔒 ${nm || code}(${code}) 已按现价 ${price} 建仓并锁仓 · ${shares} 股` };
  }
  // ── 线上→本地 对账（2026-10-06：治「持仓总是删除不干净」）────────────────
  // 同步是单向的（本机副本 → 线上），线上改的东西本机永远看不见：
  //   手机上删掉一只票 → 线上删了，本机 holdings.json 原封不动 → 回到电脑面板票还在，
  //   于是「明明删了却还在」，反复出现。
  // 这里提供两个只补、不覆盖的入口，由 server.js 的回拉任务调用：
  //   ① applyRemoteRemoval —— 线上确实执行过 remove 的票，本机跟着删（记 remote-remove 流水）
  //   ② addRemoteItem      —— 线上有、本机没有的票，本机补一条（不覆盖本机已有的同名票）
  // 两者都只做"补齐"，绝不拿线上列表整体覆盖本机，本机未同步的新增票不会被冲掉。
  function applyRemoteRemoval(keepCodes, removedCodes) {
    const keep = new Set((keepCodes || []).map(c => String(c)));
    const before = HOLD.items.slice();
    const gone = before.filter(x => !keep.has(String(x.code)));
    if (!gone.length) return { removed: 0 };
    HOLD.items = before.filter(x => keep.has(String(x.code)));
    commit('remote-remove', before, HOLD.items, {
      removedCodes: (removedCodes && removedCodes.length ? removedCodes : gone.map(x => String(x.code)))
    });
    return { removed: gone.length, codes: gone.map(x => String(x.code)) };
  }
  // 线上有、本机没有 → 补进来（只增不覆盖，本机已有的 code 一律跳过）
  function addRemoteItem(it) {
    const code = String((it && it.code) || '').trim();
    if (!/^\d{6}$/.test(code)) return false;
    if (HOLD.items.some(x => String(x.code) === code)) return false;   // 本机已有：绝不覆盖
    const before = HOLD.items.slice();
    HOLD.items.push({
      code,
      name: String(it.name || code).slice(0, 20),
      cost: +num(it.cost).toFixed(4), shares: num(it.shares),
      note: String(it.note || '').slice(0, 60), tags: normTags(it.tags),
      locked: !!it.locked, mute: !!it.muted, addedAt: Date.now()
    });
    commit('remote-add', before, HOLD.items, { addedCodes: [code] });
    return true;
  }
  // 本机某只票最后一次「本地新增」的时间（没有 add 记录则返回 0）
  function lastAddAt(code) {
    let t = 0;
    try {
      for (const r of readOps()) {
        const ad = r && r.added;
        if (Array.isArray(ad) && ad.some(c => String(c) === String(code)) && (r.t || 0) > t) t = r.t || 0;
      }
    } catch {}
    return t;
  }
  // 本机某只票最后一次「本地删除」的时间（没有 remove 记录则返回 0）
  // ⛔ 2026-10-07 加：线上→本地对账原来只问「线上有没有这只票」，**不问本机是不是刚删过它**。
  //    于是本机删掉一只票、而这次删除没能同步到线上时（网络抖动 / 线上正好重启 /
  //    显式 _noSync），线上那份还在 → 下轮对账无条件补回来 → 用户看到的就是
  //    「删了又回来」，这正是 2026-10-06 想治的「持仓总是删除不干净」的另一半。
  function lastRemoveAt(code) {
    let t = 0;
    try {
      for (const r of readOps()) {
        const rm = r && r.removed;
        if (Array.isArray(rm) && rm.some(c => String(c) === String(code)) && (r.t || 0) > t) t = r.t || 0;
      }
    } catch {}
    return t;
  }
  function setLocked(code, on) {
    const it = HOLD.items.find(x => x.code === code);
    if (!it) return { ok: false, error: '未找到该持仓' };
    it.locked = !!on; it.updatedAt = Date.now();
    saveHold(); bust();
    return { ok: true, msg: `${it.name} ${it.locked ? '🔒 已锁仓（不再自动建议卖出）' : '🔓 已解锁（恢复自动盯盘建议）'}` };
  }
  // 暂停推送（静音）：面板照样显示估值与建议，但不再往手机推任何提醒。
  // 与「锁仓」不同——锁仓是压制卖出类建议本身，静音只是不打扰，建议照算。
  function setMute(code, on) {
    const it = HOLD.items.find(x => x.code === code);
    if (!it) return { ok: false, error: '未找到该持仓' };
    it.mute = !!on; it.updatedAt = Date.now();
    saveHold(); bust();
    // 静音期间清掉去重标记：解除后能重新提醒，不会"一直没动静"
    return { ok: true, muted: it.mute, msg: `${it.name} ${it.mute ? '🔇 已暂停推送（面板仍可查看，手机不再提醒）' : '🔔 已恢复推送'}` };
  }
  function setTags(code, tags) {
    const it = HOLD.items.find(x => x.code === code);
    if (!it) return { ok: false, error: '未找到该持仓' };
    it.tags = normTags(tags); it.updatedAt = Date.now();
    saveHold(); bust();
    return { ok: true, msg: `${it.name} 标签已设为 ${it.tags.length ? it.tags.join('/') : '（无）'}` };
  }
  function updateItem(code, patch) {
    const it = HOLD.items.find(x => x.code === code);
    if (!it) return { ok: false, error: '未找到该持仓' };
    if (patch.name != null) it.name = String(patch.name).slice(0, 20);
    if (patch.cost != null) { const c = num(patch.cost); if (c <= 0) return { ok: false, error: '成本价须大于0' }; it.cost = +c.toFixed(4); }
    if (patch.shares != null) { const s = num(patch.shares); if (s < 0) return { ok: false, error: '股数不能为负' }; it.shares = s; }
    if (patch.note != null) it.note = String(patch.note).slice(0, 60);
    if (patch.tags != null) it.tags = normTags(patch.tags);
    if (patch.locked != null) it.locked = !!patch.locked;
    if (patch.mute != null) it.mute = !!patch.mute;
    it.updatedAt = Date.now();
    saveHold(); bust();
    return { ok: true, msg: `${it.name} 已更新` };
  }
  function removeItem(code) {
    const n = HOLD.items.length;
    const before = HOLD.items.slice();
    HOLD.items = HOLD.items.filter(x => x.code !== code);
    if (HOLD.items.length === n) return { ok: false, error: '未找到该持仓' };
    commit('remove', before, HOLD.items, { removedCodes: [String(code)] });
    return { ok: true, msg: '已从持仓中移除' };
  }
  // 批量删除：一次勾掉好几条旧数据，不用一条一条点
  function removeMany(codes) {
    const set = new Set((codes || []).map(c => String(c || '').trim()).filter(Boolean));
    if (!set.size) return { ok: false, error: '没有选中任何持仓' };
    const n = HOLD.items.length;
    const before = HOLD.items.slice();
    HOLD.items = HOLD.items.filter(x => !set.has(String(x.code)));
    const removed = n - HOLD.items.length;
    if (removed > 0) commit('removeMany', before, HOLD.items, { removedCodes: before.filter(x => set.has(String(x.code))).map(x => String(x.code)) });
    return { ok: removed > 0, removed, msg: removed ? `已删除 ${removed} 条旧数据` : '没有匹配的持仓' };
  }
  // 清空全部持仓：总资金与风控参数保留（那是设置，不是"旧数据"）
  let _lastClearPushAt = 0;   // 清空提醒节流（见下方 2026-10-06 说明）
  function clearAll() {
    const n = HOLD.items.length;
    const before = HOLD.items.slice();
    HOLD.items = [];
    if (n > 0) {
      commit('clear', before, HOLD.items, { removedCodes: before.map(x => String(x.code)) });
      // 清空是最容易被误点、后果又最重的一步。留痕还不够，必须让本人立刻知道：
      // 万一不是他本人操作（别人拿了设备 / 误触），这条提醒就是唯一的止损时机。
      try {
        // ⛔ 2026-10-05 修：pushAll 的签名是 (text, force, opts)，原先把"明细正文"写在了第二参
        //    force 的位置 → 标题是 text、正文被当成 force=true 吃掉，手机只收到一行
        //    「═══ 🗑 持仓已清空 ═══」，被清掉了哪几只根本看不到 —— 这条推送等于废的。
        //    现在正文并入 text，force 显式置 true（清空是最重的操作，夜间静默也要送）。
        //    私密通道开了就只发本人机器人（含被清掉的成本/股数），否则仍走群机器人且只列代码。
        // ⛔ 2026-10-06 修（用户："不用总推持仓已清空"）—— 两条降噪规则：
        //    ① 副本实例一律不推。本机面板点清空会经 syncUpstream 转发到线上再执行一次，
        //       手机于是【一次操作收到两条】一模一样的通知（10/5 凌晨实测成对，相隔 2 秒）。
        //       线上那条才是权威，副本闭嘴即可。
        //    ② 30 分钟节流：误触连点 / 脚本循环反复清空时只提醒第一次。
        //       ⚠️ 只是不刷手机 —— commit 留痕照常，面板「变更记录」一条不少，照样能一键还原。
        const _repl = typeof isReplica === 'function' ? isReplica() : false;
        const _now = Date.now();
        if (_repl) {
          console.log('[holdings] 副本实例：清空提醒不外发（线上那条才是权威，避免一次操作来两份）');
        } else if (_now - _lastClearPushAt < 30 * 60 * 1000) {
          console.log('[holdings] 清空提醒 30 分钟内已发过，本次只留痕、不再刷手机');
        } else {
          _lastClearPushAt = _now;
          const priv = _priv();
          const lines = before.slice(0, 20).map(x => {
            const nm = `${(x && x.name) || ''}(${(x && x.code) || ''})`;
            return priv && num(x.cost) > 0 && num(x.shares) > 0
              ? `▪ ${nm} · 成本 ${num(x.cost)} × ${num(x.shares)} 股`
              : `▪ ${nm}`;
          }).join('\n');
          pushAll('═══ 🗑 持仓已清空 ═══\n' +
            `你的持仓里 ${n} 条已被清空：\n` + lines +
            `\n若不是你本人操作，到面板「持仓 → 变更记录」可一键还原（已自动留快照）。` +
            (priv ? '\n（本条只发你的私密机器人，群里看不到）' : ''),
            true, { private: true });
        }
      } catch {}
    }
    return { ok: true, removed: n, msg: n ? `已清空全部 ${n} 条持仓（总资金/风控参数保留）` : '持仓本来就是空的' };
  }
  function setCapital(v) { HOLD.capital = Math.max(0, num(v)); saveHold(); bust(); return { ok: true, msg: `总资金已设为 ${HOLD.capital}` }; }
  function setThresholds(o) {
    if (o.stopPct != null) HOLD.stopPct = -Math.abs(num(o.stopPct));     // 止损线存负数，便于直接比较
    if (o.reducePct != null) HOLD.reducePct = -Math.abs(num(o.reducePct)); // 减仓预警线存负数
    if (o.takePct != null) HOLD.takePct = Math.abs(num(o.takePct));
    if (o.maxPosPct != null) HOLD.maxPosPct = Math.min(100, Math.abs(num(o.maxPosPct)));
    saveHold(); bust();
    return { ok: true, msg: '风控参数已更新' };
  }

  // ---------- 行情快照：东财优先，缺资金字段时用同花顺外盘/内盘兜底 ----------
  // K线：优先用服务端内存/磁盘缓存，没有才现拉一次（30天足够算5日线），拿回来后回填缓存
  async function klineOf(code) {
    const cur = S.klines.get(code);
    if (cur && cur.rows && cur.rows.length) return cur.rows;
    const cf = path.join(dir, '.kline_cache', code + '.json');
    try {
      const k = JSON.parse(fs.readFileSync(cf, 'utf8'));
      if (k && k.rows && k.rows.length && Date.now() - fs.statSync(cf).mtimeMs < 30 * 60 * 1000) {
        S.klines.set(code, k); return k.rows;
      }
    } catch {}
    try {
      const k = await em.fetchKline(code, 30);
      if (k && k.rows && k.rows.length) {
        S.klines.set(code, k);
        try { fs.writeFileSync(cf, JSON.stringify(k)); } catch {}
        return k.rows;
      }
    } catch {}
    return [];
  }
  async function quotes(codes) {
    const out = new Map();
    if (!codes.length) return out;
    try {
      const snaps = await em.fetchBatchSnapshot(codes);
      for (const s of snaps || []) if (s && s.code) out.set(s.code, s);
    } catch {}
    const needThs = [...out.keys()].filter(c => {
      const s = out.get(c);
      return !s || !s.price || (s.mainInflow == null && s.mainPct == null);
    });
    const miss = codes.filter(c => !out.has(c));
    const thsCodes = [...new Set([...needThs, ...miss])].slice(0, 60);
    if (thsCodes.length) {
      try {
        const t = await em.fetchThsActiveBatch(thsCodes);
        for (const [c, v] of t) {
          const s = out.get(c) || { code: c, name: '', pct: 0 };
          if(!s.price){s.price=v.price;s.quoteSource='ths';s.quoteAt=null;s.receivedAt=v.retrievedAt??null;
            s.quoteMode='active-order-estimate';s.canTrade=false;s.canNotify=false;}
          s.mainInflow = v.netAmt;
          s.mainPct = v.activePct;
          s.fundsSource='ths';s.fundsMethod=v.fundsMethod||'vendor-active-order-estimate';
          s.fundsRetrievedAt=v.retrievedAt??null;s.fundsSourceTimestamp=v.sourceTimestamp??null;s.fundsUnit=v.fundsUnit||v.unit||'CNY';
          s.proxy = true; // 标注为备用口径（主动买占比），便于前端说明
          out.set(c, s);
        }
      } catch {}
    }
    // 兜底仍有缺口时，用全A快照补齐价格/名称
    for (const c of codes) {
      if (out.get(c) && out.get(c).price) continue;
      const st = S.stocks.find(s => s.code === c);
      if (st) {const quality=quoteUseEligibility(st,_nowDate().getTime());out.set(c, { ...(out.get(c) || {}),
        ...quoteSnapshotFields(st),code:c,name:st.name,price:st.price,pct:st.pct,
        quoteMode:st.quoteMode||'full-a-fallback',canTrade:quality.canTrade,canNotify:quality.canNotify,
        mainInflow:st.mainInflow,mainPct:st.mainPct,fundsSource:st.fundsSource||null,fundsMethod:st.fundsMethod||null,
        fundsRetrievedAt:st.fundsRetrievedAt??null,fundsSourceTimestamp:st.fundsSourceTimestamp??null,fundsUnit:st.fundsUnit||null });}
    }
    return out;
  }

  // ---------- 判定：每一条都写明「触发了什么条件」 ----------
  // ctx: {positionPct} 总仓位占比，用于约束加仓建议
  function verdict(code, snap, rows, ctx) {
    const it = (HOLD.items || []).find(h => h.code === code) || {};
    const cost = num(it.cost), shares = num(it.shares);
    const price = num(snap && snap.price);
    if (!price || !cost) return { level: 'none', acts: [], note: '缺少行情或成本价，无法判定' };
    const pct = num(snap && snap.pct);
    const floatPct = +(((price - cost) / cost) * 100).toFixed(2);
    const profitAmt = Math.round((price - cost) * shares);
    const r = Array.isArray(rows) ? rows : [];
    const ma5 = r.length >= 5 ? +(r.slice(-5).reduce((s, x) => s + x.close, 0) / 5).toFixed(2) : null;
    const aboveMa5 = ma5 ? price > ma5 : null; // 严格站上（超过）才算站稳
    const mainIn = num(snap && snap.mainInflow);
    const mainPct = num(snap && snap.mainPct);
    const badNews = !!(S.news && S.news.badCodes && S.news.badCodes.has(code));
    // ⚠️ 2026-09-29 修复：以前只读 badCodes，**完全不看 goodCodes** ——
    //   后果是三峡新材(600293) 19:51 公告「筹划收购珠海赛纬司53.14%股份 + 停牌」这种级别的利好
    //   就躺在 news.json 里，系统照样按「跌破5日线/主力净流出」催用户减仓止损。
    //   更荒唐的是停牌期间根本没有新成交，那些"走弱证据"全是停牌前的陈旧数据。
    //   现在：利好/利空都要进建议，且重大利好要能把减仓类建议降级。
    const goodNews = !!(S.news && S.news.goodCodes && S.news.goodCodes.has(code));
    const goodTitles = [];
    if (goodNews && S.news.goodAll) {
      for (const g of S.news.goodAll) {
        if (g && Array.isArray(g.codes) && g.codes.includes(code) && g.title) {
          goodTitles.push(String(g.title).slice(0, 60));
          if (goodTitles.length >= 2) break;
        }
      }
    }
    // 停牌识别：筹划收购/重组类公告通常伴随停牌，此时量价指标全部失效
    const suspended = /停牌|筹划.*停牌|拟.*停牌/.test(goodTitles.join(' ')) ||
                      /停牌/.test(badTitlesJoin(S.news, code));
    const goodNote = goodTitles.length ? goodTitles.join('｜') : (goodNews ? '有利好消息' : '');
    // 重大利好判定放在停牌之前：停牌本身也是"重大事项"，两者都要能压制卖出类建议
    const majorGood = goodNews && GOOD_MAJOR_RE.test(goodNote);
    // 涨停判定必须按板块识别限幅（主板10% / 创业板·科创板20% / 北交所30%；ST 2026-04 起与主板同 ±10%）。
    // 以前写死 pct >= 9.8 → 创业板涨 10% 会被误判"涨停"，ST 的真涨停也看不见，
    // 而这直接决定持仓的"涨停可否卖出/持有观察"建议，判错就是给错操作指令。
    const isLimitUp = A.isLimitUp(code, (snap && snap.name) || '', pct);

    // 🅰️ 停牌股：屏幕上所有量价/涨跌/资金信号都是【停牌前的静态快照】，
    //   什么"跌破5日线""主力净流出""自高点回撤5%"统统是旧数据在说话。
    //   2026-09-29 教训：三峡新材(600293) 19:51 公告筹划收购+停牌，系统第二天还在
    //   拿停牌前的 K 线催「从高点回撤 5.3%，建议分批止盈」—— 停牌期间根本没有成交，
    //   这条建议在物理上无法执行，逻辑上也不成立。现在遇到停牌一律中止技术面判定。
    if (suspended) {
      const side = floatPct > 0 ? `浮盈 ${floatPct}%（+${profitAmt} 元）` : `浮亏 ${Math.abs(floatPct)}%（${profitAmt} 元）`;
      return {
        level: 'info',
        acts: [{
          type: '停牌中', urgent: false, color: 'info', once: true,
          text: `🔔 停牌中：${goodNote || badTitlesJoin(S.news, code) || '公司公告涉及停牌'}。停牌期间没有成交，看板上的涨跌、5日线、资金流向全是停牌前的旧数据，据此给出的任何买卖建议都不成立，已全部屏蔽。`,
          why: `触发条件：公告正文命中「停牌」；当前成本 ${cost}、停牌前最后价 ${price}，${side} —— 这只是停牌那一刻的静态快照，不等于当下强弱。`
        }, {
          type: '复牌待办', urgent: false, color: 'info', once: true,
          text: `📌 复牌首日再看：收购/重组类事项通常影响中性偏好。届时若封涨停可持有观察，若高开低走且资金流出，再谈离场。`,
          why: '停牌期间的判定无意义，推迟到复牌后第一笔真实成交数据出来再给结论'
        }],
        floatPct, profitAmt, ma5, aboveMa5, mainIn, mainPct, badNews, isLimitUp,
        locked: !!it.locked, tags: it.tags || [], drawdown: 0, hiRef: price,
        goodNews: true, goodNote, suspended: true
      };
    }

    const stop = HOLD.stopPct, reduce = HOLD.reducePct, take = HOLD.takePct, maxPos = HOLD.maxPosPct;
    const acts = [];
    // 重大利好 → 把"卖出类建议"降级为"持有观察"，理由写清楚，交给人做最后一判断
    // suspended 已提前 return，这里只需处理「重大利好压制技术面」这一种情况
    const goodGuard = (baseWhy) => majorGood
      ? `${baseWhy}；⚠️ 但当日有重大利好：${goodNote || '收购/重组类公告'}，技术面走弱可能是消息前的陈旧数据，建议先核实消息面再动手`
      : baseWhy;
    const downgrade = (act, altText, altWhy) => majorGood
      ? { type: '持有观察', urgent: true, color: 'warn', text: altText, why: altWhy }
      : act;

    // ① 止损：亏损「超过」止损线 → 强提示离场，先手规避继续扩大亏损
    if (floatPct < stop)
      acts.push(downgrade({
        type: '止损', urgent: true, color: 'danger',
        text: `亏损已${Math.abs(floatPct)}%，越过 ${Math.abs(stop)}% 止损线，建议离场，避免亏损继续扩大`,
        why: goodGuard(`触发条件：浮动亏损 ${floatPct}% ＞ 止损线 ${Math.abs(stop)}%（当前 ${profitAmt} 元）`)
      },
        `浮亏 ${Math.abs(floatPct)}% 已过止损线，但检测到重大利好【${goodNote || '收购/重组'}】${suspended ? '且疑似停牌' : ''}，暂缓机械止损，等消息落地后再判断`,
        `原触发止损（浮亏${floatPct}%＞${Math.abs(stop)}%），但 ${suspended ? '股票停牌中，量价数据失效' : '当日存在重大利好'}：${goodNote || '有公告利好'}，技术信号可信度下降，降级为持有观察`));
    // ② 减仓：进入预警区（亏损超过预警线但未到止损）+ 出现走弱证据 → 先减半仓锁风险
    else if (floatPct < reduce) {
      const evid = [];
      if (aboveMa5 === false) evid.push(`跌破5日线${ma5}`);
      if (mainIn < 0) evid.push(`主力净流出${Math.round(Math.abs(mainIn) / 1e4)}万`);
      if (pct < -3) evid.push(`当日大跌${pct}%`);
      if (badNews) evid.push('有利空消息');
      if (goodNews) evid.push(`✓同时存在利好：${goodNote || '有利好公告'}`);
      if (evid.length)
        acts.push(downgrade({
          type: '减仓', urgent: true, color: 'warn',
          text: `建议先减半仓观察：${evid.join('、')}`,
          why: goodGuard(`触发条件：浮亏 ${Math.abs(floatPct)}% ＞ 预警线 ${Math.abs(reduce)}%（未到止损 ${Math.abs(stop)}%）且 ${evid.length} 项走弱证据同时成立`)
        },
          `浮亏 ${Math.abs(floatPct)}% 进入预警区，但当日有重大利好【${goodNote || '收购/重组'}】，不建议只看技术面减半仓`,
          `原触发减仓预警（浮亏${Math.abs(floatPct)}%＞${Math.abs(reduce)}%），但存在重大利好：${goodNote || '有公告利好'}${suspended ? '；且该股疑似停牌，成交量价失真' : ''}，降级为持有观察，建议消息明朗后再定`
        ));
      else
        acts.push({
          type: '关注', urgent: false, color: 'warn',
          text: `浮亏已越过 ${Math.abs(reduce)}% 预警线，但还没有明确走弱信号，先设好防线盯紧（离止损线还剩 ${(Math.abs(stop) - Math.abs(floatPct)).toFixed(2)} 个点）`,
          why: `触发条件：浮亏 ${Math.abs(floatPct)}% ＞ 预警线 ${Math.abs(reduce)}%；走弱证据 0 项（未跌破5日线 / 主力未净流出 / 当日跌幅未超过3% / 无利空）`
        });
    }
    // ── 止盈提醒：到线要提醒一次（否则不知道该动手），之后交给「回撤」按级催 ──
    // 参考高点：近 10 个交易日的最高价，并与当前实时价取大，用来算「冲高回落」的回撤
    const _win = (rows || []).slice(-10);
    let hiRef = price;
    for (const r of _win) { const h = num(r && r.high); if (h > hiRef) hiRef = h; }
    const drawdown = hiRef > 0 ? +(((hiRef - price) / hiRef) * 100).toFixed(2) : 0;
    const DD_WARN = 3, DD_URGENT = 5;   // 回撤 3% 提醒一次；回撤 5% 起每 30 分钟提醒一次
    const ddHit = floatPct > 0 && drawdown >= DD_WARN;   // 已进入回撤区间

    // ③-1 回撤止盈：有浮盈且从高点回落 → 利润在缩水，这时才值得反复催
    //      3%~5% 只提醒一次（处理了或回到 3% 以内就不再打扰）；≥5% 每 30 分钟提醒一次
    if (ddHit) {
      const urgent = drawdown >= DD_URGENT;
      // 有重大利好时不催止盈：收购/重组落地前后，回撤往往是消息前的资金分歧而非趋势转坏
      acts.push(downgrade({
        type: urgent ? '回撤止盈' : '回撤提醒',
        urgent: true, once: !urgent, color: urgent ? 'warn' : 'good',
        text: `从近期高点 ${hiRef} 回撤 ${drawdown}%${urgent ? '（≥5%，利润明显缩水）' : '（≥3%）'}，当前浮盈 ${floatPct}%，建议分批止盈锁定利润`,
        why: `触发条件：浮盈为正 ${floatPct}% 且 现价 ${price} 较近10日高点 ${hiRef} 回撤 ${drawdown}% ≥ ${urgent ? DD_URGENT : DD_WARN}%` +
          (urgent ? '；≥5% 每30分钟提醒一次' : '；3%~5% 只提醒一次，回到3%以内不再打扰')
      },
        `自高点回撤 ${drawdown}%，但公司刚出重大利好【${goodNote}】：这种回撤更可能是消息落地前的资金分歧，不是趋势转坏，建议先让消息发酵`,
        `原触发${urgent ? '回撤止盈' : '回撤提醒'}（浮盈${floatPct}%、自高点${hiRef}回撤${drawdown}%），但当日存在重大利好：${goodNote}，技术信号可信度下降，降级为持有观察`
      ));
    }
    // ③-2 越过止盈线（还没回撤）：推一次让你知道「该动了」，不再是长期静音
    //      只提醒一次：卖掉一半或删除持仓后重新买入会重新提醒，不会一直催
    else if (floatPct > take) {
      // 到线了但公司有利好 → 主升段可能还没走完，别急着落袋
      acts.push(downgrade({
        type: '止盈', urgent: true, once: true, color: 'good',
        text: `浮盈 ${floatPct}% 越过 ${take}% 止盈线，建议分批止盈（先卖一半锁定利润，剩余看5日线）`,
        why: `触发条件：浮动盈利 ${floatPct}% ＞ 止盈线 ${take}%（当前 +${profitAmt} 元）。到线只提醒一次；之后若从高点回撤 ≥3% 会再提醒，≥5% 每30分钟催一次`
      },
        `浮盈 ${floatPct}% 已过止盈线，但公司当日有重大利好【${goodNote}】：这类消息往往还没走完，建议先不动，改按 5 日线跟随（跌破再走）`,
        `原触发止盈（浮盈${floatPct}%＞${take}%），但存在重大利好：${goodNote}，降级为持有观察，避免在主升段前被机械止盈扫出去`
      ));
    }
    // ④ 加仓：盈利中 + 站上5日线 + 当日温和上涨 + 资金净流入 + 总仓位未超限
    const posPct = ctx && ctx.positionPct != null ? ctx.positionPct : null;
    // ⚠️ 2026-10-02 改：加仓以前是 urgent:false，等于永远进不了手机推送（用户收不到加减仓提醒）。
    //    现在给 once:true —— 让 watch 的「加仓」分支可以一次性提醒：条件消失后允许再提醒，
    //    条件一直成立则不会反复刷屏（避免回到"推送太多像菜市场"的老毛病）。
    if (floatPct > 0 && aboveMa5 === true && pct > 0 && pct < 5 && mainIn > 0) {
      if (posPct != null && posPct > maxPos)
        acts.push({
          type: '加仓', urgent: false, once: true, color: 'info',
          text: `个股条件满足加仓，但总仓位 ${posPct}% 已超过上限 ${maxPos}%，建议先减其它仓位再考虑`,
          why: `个股条件：浮盈 ${floatPct}% + 站上5日线${ma5} + 当日温和涨 ${pct}% + 主力净流入${Math.round(mainIn / 1e4)}万；被总仓位上限 ${maxPos}% 拦截`
        });
      else
        acts.push({
          type: '加仓', urgent: false, once: true, color: 'good',
          text: `趋势完好且主力仍净流入${Math.round(mainIn / 1e4)}万，可小幅加仓（建议单次不超过原仓位1/3）`,
          why: `触发条件：浮盈为正 ${floatPct}% + 站上5日线${ma5} + 当日温和涨 ${pct}%（未超5%）+ 主力净流入${Math.round(mainIn / 1e4)}万`
        });
    }
    // ⑤ 涨停持有
    if (isLimitUp)
      acts.push({
        type: '持有', urgent: false, color: 'info',
        text: '当日涨停，持有观察；次日若不能封板再考虑减',
        // 文案里不能再写死「≥9.8%」：创业板/科创板是 20%、北交所 30%、主板 ST 只有 5%，
        // 写死会让用户以为只有涨到 9.8% 才算涨停，进而怀疑系统判错。
        why: `触发条件：当日涨幅达到该股涨停限制（${A.limitPctOf(code, (snap && snap.name) || '')}%），强势股不轻易下车`
      });
    // ⑥ 风险提示：破位/资金撤离/利空，但还没到减仓线
    if (!acts.some(a => a.type === '减仓' || a.type === '止损')) {
      const risk = [];
      if (aboveMa5 === false) risk.push(`跌破5日线${ma5}`);
      if (mainIn < 0) risk.push(`主力净流出${Math.round(Math.abs(mainIn) / 1e4)}万`);
      if (badNews) risk.push('有利空消息');
      if (risk.length >= 2)
        acts.push(majorGood ? {
          type: '持有观察', urgent: false, color: 'info',
          text: `有 ${risk.length} 项走弱信号（${risk.join('、')}），但当日存在重大利好【${goodNote}】，技术面可信度下降，暂不给减仓建议`,
          why: `走弱信号 ${risk.length} 项：${risk.join('、')}；被当日重大利好压制：${goodNote}`
        } : {
          type: '风险', urgent: true, color: 'warn',
          text: `⚠️ 走弱信号累积（${risk.length} 项）：${risk.join('、')}，尚未到减仓线但需盯紧`,
          why: `触发条件：未触发减仓线时，出现 ${risk.length} 项走弱信号（破5日线/资金撤离/利空）即预警`
        });
      else if (badNews)
        acts.push({
          type: '风险', urgent: true, color: 'warn',
          text: '⚠️ 个股出现利空消息，注意回撤风险',
          why: '触发条件：利空雷达命中该股'
        });
    }

    // ⑧ 清仓：多重恶化同时成立（浮亏越过止损线 + 破5日线 + 主力净流出 + 当日大跌）→ 不再建议减半，直接清
    //    有重大利好时【不下清仓结论】：此时"恶化"很可能是消息前的资金博弈，交给降级后的观察。
    if (!majorGood && floatPct < stop && aboveMa5 === false && mainIn < 0 && pct < -3 && !acts.some(a => a.type === '清仓'))
      acts.push({
        type: '清仓', urgent: true, color: 'danger',
        text: `亏损 ${Math.abs(floatPct)}% 已越过止损线，且多重恶化同时成立：跌破5日线、主力净流出、当日大跌${pct}%，建议直接清仓，不要再等反弹`,
        why: `触发条件：浮亏 ${Math.abs(floatPct)}% ＞ 止损线 ${Math.abs(stop)}%，同时满足「跌破5日线${ma5} + 主力净流出${Math.round(Math.abs(mainIn) / 1e4)}万 + 当日跌 ${Math.abs(pct)}% ＞ 3%」`
      });

    // 📰 利好在案：让用户一眼看到「这张卡是看过新闻的，不是只看 K 线」。
    //    以前 K 线说的和数据说的互相打架，用户完全看不出系统到底依据了什么 —— 这就是
    //    「三峡新材收购停牌，系统还在催止损」被判定为不看事实的直接原因。
    if (goodNews)
      acts.push({
        type: '利好在案', urgent: false, color: 'info', once: true,
        text: `📰 当日利好：${goodNote}`,
        why: `来源：财经快讯实时抓取（命中该股 ${code}）；已参与本张卡的判定${majorGood ? '，卖出类建议已据此降级' : '，未构成足以推翻技术面的重大事项'}`
      });

    // ⑦ 兜底结论：什么都没触发时也要说清楚"为什么没动"，让每张卡都有明确交代
    if (!acts.length) {
      const st = [];
      st.push(`浮${floatPct > 0 ? '+' : ''}${floatPct}%`);
      st.push(aboveMa5 === true ? `站上5日线${ma5}` : aboveMa5 === false ? `跌破5日线${ma5}` : '5日线暂无');
      st.push(mainIn > 0 ? `主力净流入${Math.round(mainIn / 1e4)}万` : mainIn < 0 ? `主力净流出${Math.round(Math.abs(mainIn) / 1e4)}万` : '资金流向暂无（非交易时段常见）');
      st.push(`当日${pct > 0 ? '+' : ''}${pct}%`);
      acts.push({
        type: '持有', urgent: false, color: 'info',
        text: '未触发任何加减仓条件，维持现有仓位继续观察',
        why: `当前状态：${st.join(' · ')}；未越过止损 ${Math.abs(stop)}% / 减仓预警 ${Math.abs(reduce)}% / 止盈 ${take}% 任何一条线`
      });
    }

    // 🔒 锁仓处理：锁定的票只做「告知」，不再给卖出类建议，也不再打扰手机
    // 这样长线仓/打板仓不会被短线止损噪音干扰，但价格、浮盈、风险信号照常显示
    if (it.locked) {
      const down = [];
      for (const a of acts) {
        // 「止盈」也是卖出类建议：锁仓的意思是「别催我卖」，漏了它就会出现
        // 卡片显示绿色没事、手机却收到「建议分批止盈」的矛盾。
        if (a.type === '止损' || a.type === '减仓' || a.type === '清仓' || a.type === '回撤止盈' || a.type === '回撤提醒' || a.type === '止盈') {
          const origin = a.type;                       // 先存原判定，改 type 后仍要回填文案
          down.push(origin);
          a.type = '锁仓提示'; a.urgent = false; a.color = 'info';
          a.text = `🔒 锁仓中：系统原本给出【${origin}】建议，已为你忽略 —— ${a.text}`;
          a.why = a.why + '；因已锁仓，仅作提示，不再计入风控也不推手机';
        }
      }
      const tail = (it.tags || []).length ? `标签：${it.tags.join('/')}` : '未设标签';
      acts.push({
        type: '已锁仓', urgent: false, color: 'info',
        text: `🔒 该股处于锁仓状态（${tail}）：不再自动推送减仓/止损建议，如需恢复请点卡片上的「解锁」`,
        why: '锁仓期间只跟踪盈亏与风险信号，卖出动作由你本人决定'
      });
    }

    // 等级只由"风控类"建议决定：止盈/持有/加仓这类中性提示不再把整仓标成「需关注」，
    // 否则一张赚钱的票会一直挂着一个提醒状态，等于变相的持续打扰。
    // 注意：止盈虽然会推送一次手机（once），但它属中性，不把卡片标黄——
    //      真正标黄的是「回撤提醒 / 回撤止盈」，那是利润在实打实缩水。
    const NEUTRAL = new Set(['止盈', '持有', '加仓', '已锁仓', '锁仓提示', '利好在案', '持有观察', '停牌中', '复牌待办']);
    const level = acts.some(a => a.color === 'danger') ? 'danger'
      : acts.some(a => a.urgent && !NEUTRAL.has(a.type)) ? 'warn'
        : acts.some(a => !NEUTRAL.has(a.type)) ? 'info' : 'ok';
    return { level, acts, floatPct, profitAmt, ma5, aboveMa5, mainIn, mainPct, badNews, isLimitUp, locked: !!it.locked, tags: it.tags || [], drawdown, hiRef, goodNews, goodNote: goodNote || '', suspended: false };
  }

  // ---------- 汇总计算（20秒结果缓存：面板5秒轮询不会打爆行情接口） ----------

  // ⛔ 2026-10-06：连续写操作会并发触发多次**强制**重算（force=true 绕过 20 秒缓存）。
  //   每一次重算都要拉批量行情 + 逐票 K 线；而 kick() 在每次写操作后都调 compute(true)，
  //   用户在面板上连续改静音/改标签/逐条删除 → 同一瞬间并发好几轮全量重算，
  //   等于自己打自己的数据源 → 触发限流 → 数据反而更旧。
  //   这里做「进行中复用」：已有重算在跑就直接复用它的 promise，不再开新的一轮。
  //
  // ⛔⛔ 2026-10-06 补（治「持仓删不掉」的第二个根因，比同步那个更隐蔽）：
  //   「进行中复用」有个致命副作用 —— 一次重算要拉批量行情 + 逐票 K 线，**慢的时候要好几秒**。
  //   如果它是在用户点删除【之前】启动的，那么它读到的还是删除前的持仓；等它算完会把
  //   `_cache` 用这份**旧数据**覆盖，并盖上"刚刚算出来"的时间戳。
  //   → 接下来 20 秒内所有 GET /api/holdings 全部返回删除前的列表，
  //     面板上那只票好端端躺着，看着就是"删不干净"（其实早删了，只是接口在撒谎）。
  //   修法：写操作 bump 一个世代戳 `_gen`；重算启动时记下当时的世代，
  //   算完只有【期间没发生过任何写操作】才允许落缓存 —— 否则这份结果已经是脏的，直接丢弃。
  let _inflight = null;   // { gen, p, tok }
  let _gen = 0;
  async function compute(force) {
    if (!force && _cache.data && Date.now() - _cache.t < 20000) return _cache.data;
    if (_inflight && _inflight.gen === _gen) return _inflight.p;   // 期间无写操作 → 可复用
    const g = _gen;
    // ⛔⛔ 2026-10-06 修（本轮角度：状态锁的获取与释放是否对称 —— **只能释放自己那把锁**）：
    //   原来两个 handler 里都是无条件的 `_inflight = null`。可 `_inflight` 是**全模块唯一**的槽位，
    //   跨代并发时会同时存在新旧两轮重算（写操作 bump _gen → 新一轮启动并覆盖这个槽位），
    //   此时【旧】一轮算完照样把槽位置空 —— 抹掉的却是【新】一轮的锁。
    //   后果：下一次强制重算看到"没有进行中的"→ 又开一轮；用户在面板上连续改静音/改标签/删除
    //   每点一次就多并发一轮全量重算（拉批量行情 + 逐票 K 线），
    //   正好是上面那段注释要治的"自己打自己的数据源 → 触发限流 → 数据反而更旧"。
    //   现在每次启动领一个 token，算完只有槽位里还是自己这一轮才清空；别人的锁一概不动。
    const tok = {};
    const clear = () => { if (_inflight && _inflight.tok === tok) _inflight = null; };
    const p = _computeCore(g).then(r => { clear(); return r; },
                                   e => { clear(); throw e; });
    _inflight = { gen: g, p, tok };
    return p;
  }
  async function _computeCore(gen) {
    const items = HOLD.items || [];
    if (!items.length) {
      const empty = {
        items: [], level: 'empty', time: new Date().toLocaleTimeString('zh-CN'), allTags: [],
        summary: { market: 0, cost: 0, profit: 0, floatPct: 0, dayPnl: 0, capital: HOLD.capital || 0, positionPct: 0, count: 0 },
        cfg: { stopPct: HOLD.stopPct, reducePct: HOLD.reducePct, takePct: HOLD.takePct, maxPosPct: HOLD.maxPosPct }
      };
      if (gen == null || gen === _gen) _cache = { t: Date.now(), data: empty };
      return empty;
    }
    const codes = items.map(h => h.code);
    const q = await quotes(codes);
    // 先按市值粗算总仓位，用于加仓建议的仓位约束
    let preMarket = 0;
    for (const h of items) preMarket += num((q.get(h.code) || {}).price) * num(h.shares);
    const positionPct = HOLD.capital ? +((preMarket / HOLD.capital) * 100).toFixed(1) : null;

    // 逐股取 K 线（5日线是减仓/加仓判断的关键依据），优先走缓存
    const rowMap = new Map();
    for (const h of items) rowMap.set(h.code, await klineOf(h.code));
    let _nameDirty = false;   // 是否补到了真实名称（补到就回写，避免下次再查）
    const list = items.map(h => {
      const snap = q.get(h.code) || {};
      const quoteQuality=quoteUseEligibility(snap,_nowDate().getTime());
      const rows = rowMap.get(h.code) || [];
      const v = verdict(h.code, snap, rows, { positionPct });
      const researchRisk=holdingEvidence({code:h.code,bars:rows,quote:snap,
        announcements:[...(Array.isArray(S.news?.badAll)?S.news.badAll:[]),
          ...(Array.isArray(S.news?.goodAll)?S.news.goodAll:[])],
        now:_nowDate().getTime()});
      const patternAct=asHoldingsAct(researchRisk,{locked:!!h.locked});
      // Unlike the established price-based rules, invalid/stale pattern signals
      // remain visible ONLY, never enter the notification stream.
      const observedActs=patternAct?[...v.acts,patternAct]:v.acts;
      const acts=quoteQuality.canNotify?observedActs.map(a=>({...a,canNotify:a.canNotify!==false})):[{
        type:'观察',urgent:false,quiet:true,canNotify:false,color:'info',
        text:'行情来源或原始时点证据不足，暂不给出交易动作',
        why:({'invalid-price':'缺少有效价格','missing-source':'未提供报价来源',
          'missing-original-time':'未提供供应商原始报价时点','missing-received-time':'未记录本次接收时点',
          'future-original-time':'原始报价时点晚于当前时刻','invalid-reception-time':'原始与接收时点顺序异常',
          'stale-original-time':'原始报价已超过15秒','different-trade-date':'报价属于其他交易日期',
          'observation-only-source':'该来源仅供观察','use-disabled-by-source':'本来源未允许交易提醒'})[quoteQuality.missingReason]||'报价使用条件尚未确认'}];
      const cost = num(h.cost), shares = num(h.shares);
      const price = num(snap.price);
      const prevClose = rows.length ? rows[rows.length - 1].close : null;
      const market = +(price * shares).toFixed(0);
      // 名称兜底：早年/手机录入时若留空名称，会把「代码」当成名字存下来（当时查不到名称）。
      // 存下来的假名字是 truthy，导致下面 snap.name 永远轮不上 → 手机上"只显示代码"。
      // 这里用行情快照里的真实名称覆盖这种假名字，并回写落盘，一劳永逸。
      let nm = h.name || '';
      if ((!nm || nm === h.code) && snap.name) {
        nm = snap.name;
        if (h.name !== nm) { h.name = nm; _nameDirty = true; }
      }
      // 浮动盈亏：缺行情或缺成本时不做"假装计算"（原来会拿 price=0 算出巨额假亏损、显示 null%）
      const okP = price > 0 && cost > 0;
      return {
        code: h.code, name: nm || snap.name || '',
        cost, shares, note: h.note || '', tags: h.tags || [], locked: !!h.locked, muted: !!h.mute,
        price, pct: num(snap.pct), proxy: !!snap.proxy,quoteQuality,fundsQuality:fundsObservationView(snap,_nowDate().getTime()),
        valuationOnly:!quoteQuality.canNotify,observedActs:quoteQuality.canNotify?undefined:observedActs,
        market, costAmt: +(cost * shares).toFixed(0),
        weight: preMarket ? +((market / preMarket) * 100).toFixed(1) : 0,
        profitAmt: okP ? Math.round((price - cost) * shares) : 0,
        floatPct: okP ? +(((price - cost) / cost) * 100).toFixed(2) : null,
        dayPnl: (prevClose && price) ? Math.round((price - prevClose) * shares) : 0,
        ma5: v.ma5, aboveMa5: v.aboveMa5,
        mainIn:typeof snap.mainInflow==='number'&&Number.isFinite(snap.mainInflow)?Math.round(snap.mainInflow):null,
        mainPct:typeof snap.mainPct==='number'&&Number.isFinite(snap.mainPct)?snap.mainPct:null,
        badNews: v.badNews, isLimitUp: v.isLimitUp,
        // 回撤：现价距近10日高点的回落幅度，止盈提醒的触发依据（3%提醒一次 / ≥5%每30分钟）
        drawdown: v.drawdown, hiRef: v.hiRef,
        // 事实面：当日存在针对该股的利好/停牌，参与上面的建议判定（不是只看 K 线）
        goodNews: !!v.goodNews, goodNote: v.goodNote || '', suspended: !!v.suspended,
        level:quoteQuality.canNotify?v.level:'info', researchRisk, acts
      };
    });
    if (_nameDirty) { try { saveHold(); } catch {} }   // 补到的真实名称立刻落盘
    const summary = list.reduce((a, x) => { a.market += x.market; a.cost += x.costAmt; a.profit += x.profitAmt; a.dayPnl += x.dayPnl; return a; }, { market: 0, cost: 0, profit: 0, dayPnl: 0 });
    summary.floatPct = summary.cost ? +((summary.profit / summary.cost) * 100).toFixed(2) : 0;
    summary.capital = HOLD.capital || 0;
    summary.positionPct = positionPct;
    summary.count = list.length;
    const level = list.some(x => x.level === 'danger') ? 'danger' : list.some(x => x.level === 'warn') ? 'warn' : 'ok';
    const ret = {
      items: list, summary, level, time: new Date().toLocaleTimeString('zh-CN'),
      // 标签总表：面板据此渲染筛选 chip（预设标签在前，自定义标签追加在后）
      allTags: (() => {
        const s = new Set();
        for (const x of list) for (const t of (x.tags || [])) s.add(t);
        const custom = [...s].filter(t => !PRESET_TAGS.includes(t));
        return [...PRESET_TAGS.filter(t => s.has(t)), ...custom];
      })(),
      cfg: { stopPct: HOLD.stopPct, reducePct: HOLD.reducePct, takePct: HOLD.takePct, maxPosPct: HOLD.maxPosPct }
    };
    // ⛔ 只有"算的过程中没人改过持仓"才准落缓存（详见 compute 上方 2026-10-06 说明）
    if (gen == null || gen === _gen) _cache = { t: Date.now(), data: ret };
    return ret;
  }

  // ---------- 定时盯盘：触发即强推送到手机（同股同动作30分钟去重）+ 实时刷新面板 ----------
  // ── 推送脱敏与风险标签（2026-10-02 用户要求：持仓推送只报风险，不显示金额/股数/成本）──
  // 持仓的【成本、持仓金额、浮盈金额、股数】属于仓位隐私，一旦进聊天记录就永久留存可被转发；
  // 而风控推送真正要传达的是「该不该动手」，那只需要：哪只票、什么风险、触发依据、建议动作。
  const RISK_TAG = t => (/止损|清仓/.test(t) ? '🔴 强风险'
    : /减仓|回撤|风险|持有观察/.test(t) ? '🟠 需处理'
      : /止盈/.test(t) ? '🟢 落袋提示'
        : /加仓/.test(t) ? '🔵 加减仓提示' : '⚪ 提示');
  // 抹掉「元 / 股 / 成本」三类泄露项，百分比与技术依据全部保留
  const stripAmt = s => String(s == null ? '' : s)
    .replace(/（当前\s*[+-]?[\d.]+\s*元）/g, '')
    .replace(/[+-]?\d+(\.\d+)?\s*元/g, '')
    .replace(/成本\s*[0-9.]+/g, '')
    .replace(/\d+(\.\d+)?\s*股/g, '')
    .replace(/（\s*）/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const lvlName = l => (l === 'danger' ? '危险' : l === 'warn' ? '警戒' : '正常');
  // 只推「这几类」动作：止损/减仓/清仓/回撤/风险/持有观察（风险类），以及 once 的加仓提示
  const pushable = a => a.quiet||a.canNotify===false ? false : a.urgent || (a.type === '加仓' && a.once);
  // 金额行：只有走私密通道才拼出来（2026-10-05）。缺行情/缺成本时不硬凑，
  // 否则 price=0 会算出 -成本×股数 的巨额假亏损，比不显示更糟。
  function amtLine(x) {
    const p = [];
    if (num(x.price) > 0) p.push(`现价 ${num(x.price)}`);
    if (num(x.cost) > 0) p.push(`成本 ${num(x.cost)}`);
    if (num(x.shares) > 0) p.push(`${num(x.shares)} 股`);
    if (num(x.market) > 0) p.push(`市值 ${num(x.market)} 元`);
    if (num(x.cost) > 0 && num(x.shares) > 0) p.push(`投入 ${num(x.costAmt)} 元`);
    if (num(x.cost) > 0 && num(x.price) > 0) p.push(x.profitAmt >= 0 ? `浮盈 +${x.profitAmt} 元` : `浮亏 ${x.profitAmt} 元`);
    if (x.floatPct != null && isFinite(x.floatPct)) p.push(`${x.floatPct > 0 ? '+' : ''}${x.floatPct}%`);
    if (num(x.dayPnl) !== 0) p.push(x.dayPnl > 0 ? `当日 +${x.dayPnl} 元` : `当日 ${x.dayPnl} 元`);
    return p.length ? `  💰 ${p.join(' · ')}` : '';
  }
  // ⚠️ 脱敏只跟"发到哪里"走：配了私密机器人 → 写全；没配（仍发群里）→ 照旧用 stripAmt 抹掉。
  //    绝不出现"配了私密却仍脱敏"（白配）或"没配却把金额发进群"（泄露）这两种错。
  const riskLine = ({ x, a }) => {
    const priv = _priv();
    const t = priv ? String(a.text || '') : stripAmt(a.text);
    const w = priv ? String(a.why || '') : stripAmt(a.why);
    const amt = priv ? amtLine(x) : '';
    return `▪ ${x.name}(${x.code}) ${RISK_TAG(a.type)}｜风险等级 ${lvlName(x.level)}\n` +
      `  【${a.type}】${t}\n` +
      `  依据：${w}` + (amt ? '\n' + amt : '');
  };
  // 尾注：私密通道已开就明说"金额已显示、仅本人可见"，没开就沿用"不显示金额"的旧说法。
  const pushTail = () => (_priv()
    ? '\n（含成本/金额/股数：本条只发你的私密机器人，群里看不到）'
    : '\n（本推送只报风险与动作；成本、金额、股数不在消息中显示，详见面板「我的持仓」）');

  // la 轮：两份去重表都改为「内存视图 + 落盘持久」（初始化时从 _pushState 恢复），
  // 重启后 30 分钟窗口照常有效，冷启动不再重放同一条风控。
  const pushed = new Map(Object.entries(_pushState.rep).map(([k, v]) => [k, Number(v) || 0]));   // "type:code" -> ts   （按固定间隔重复提醒，如止损/回撤≥5%）
  const oncePushed = new Set(_pushState.once.map(String)); // "type:code"        （只提醒一次，如到止盈线、回撤 3%~5%）
  let busy = false;
  async function watch() {
    if (busy || !(HOLD.items || []).length) return;
    busy = true;
    try {
      const r = await compute(true);
      const now = Date.now();
      const fired = [];
      // 「只提醒一次」的类型：条件消失（回到阈值内）就清除标记，下次再触发可以再提醒
      // 静音中的票不进 curOnce → 它的"已提醒过"标记会被清掉，解除静音后能重新提醒
      // 周末不开盘：止盈/回撤这类"该落袋"的提醒周末不打扰，止损/清仓等风险类照常
      const _wd = _nowDate().getDay();
      const weekend = (_wd === 0 || _wd === 6);
      const weekendSkip = t => weekend && (t === '止盈' || t === '回撤提醒' || t === '回撤止盈');
      const curOnce = new Set();
      for (const x of r.items) { if (x.muted) continue; for (const a of (x.acts || [])) if (a.once && !weekendSkip(a.type)) curOnce.add(a.type + ':' + x.code); }
      let _stateDirty = false;
      for (const k of [...oncePushed]) if (!curOnce.has(k)) { oncePushed.delete(k); _stateDirty = true; }
      for (const x of r.items) {
        if (x.muted) continue;   // 🔇 暂停推送：面板照常显示，但不打扰手机
        for (const a of (x.acts || [])) {
          if (weekendSkip(a.type)) continue;   // 周末不提醒止盈/回撤
          if (!pushable(a)) continue;          // quiet=只面板；加仓靠 once 走一次性提醒
          const key = a.type + ':' + x.code;
          if (a.once) {                          // 到止盈线 / 回撤 3%~5%：只提醒一次
            if (oncePushed.has(key)) continue;
            oncePushed.add(key); _stateDirty = true;
          } else {                               // 止损/减仓/清仓/风险/回撤≥5%：30 分钟去重
            if (now - (pushed.get(key) || 0) < 30 * 60000) continue;
            pushed.set(key, now); _stateDirty = true;
          }
          fired.push({ x, a });
        }
      }
      // 无论是否推送都实时刷新面板（手机端能实时看到估值与建议变动）
      sseSendEdit('holding', {
        time: r.time, level: r.level,
        items: r.items.map(i => ({ code: i.code, name: i.name, level: i.level, acts: (i.acts || []).map(a => a.type) }))
      });
      if (_stateDirty) savePushState();   // la 轮：去重标记变了就落盘（跨重启有效）
      if (!fired.length) return;
      // la 轮：盘外不自动打扰 —— A 股价格只在数据窗口（9:15–15:40）内变动，凌晨/深夜的
      // 「风控警报」用的是上一收盘价，零增量信息、纯属重复轰炸（用户"两天弹了将近20次"）。
      // 命中的条目本tick已记入去重标记（已落盘）：若标记 30 分钟窗口在开盘前过期，窗口开启
      // 后会推一次；若仍在窗口内则不再重放 —— 无论哪种，夜间都是零推送。
      // ⛔ 只闸 watch 的自动推送：上方面板刷新照常，手动「立即盯一次」（checkNow）不受影响。
      if (!_inDataWindow()) return;
      const hasAddReduce = fired.some(f => f.a.type === '加仓');
      const head = fired.some(f => f.a.type === '止损' || f.a.type === '减仓' || f.a.type === '清仓' || f.a.type === '回撤止盈')
        ? '═══ 🚨 持仓风控警报 · 建议立即处理 ═══'
        : hasAddReduce ? '═══ ⚖️ 加减仓风险提醒 ═══'
          : '═══ 📦 持仓盯盘提醒 ═══';
      pushAll(head + '\n' + fired.map(riskLine).join('\n') + pushTail(), false, { private: true });
    } catch (e) { console.error('[holdings]', e && e.message); }
    finally { busy = false; }
  }

  // 手动点「立即盯一次」时可复用：忽略30分钟去重，只看当下有没有该处理的
  async function checkNow() {
    const r = await compute(true);
    sseSendEdit('holding', { time: r.time, level: r.level, items: r.items.map(i => ({ code: i.code, name: i.name, level: i.level, acts: (i.acts || []).map(a => a.type) })) });
    const urgent = [];
    // 手动巡检同样只报 urgent 动作（面板提示类的 quiet 不占手机消息额度）；静音的票跳过
    for (const x of r.items) { if (x.muted) continue; for (const a of (x.acts || [])) if (pushable(a)) urgent.push({ x, a }); }
    const hasAddReduce = urgent.some(u => u.a.type === '加仓');
    if (urgent.length) {
      // 是否带金额由私密通道决定（_priv 里判），此处不再写死"一律脱敏"
      pushAll((hasAddReduce ? '═══ ⚖️ 持仓盯盘 · 手动巡检（加减仓） ═══' : '═══ 📦 持仓盯盘 · 手动巡检 ═══') + '\n'
        + urgent.map(riskLine).join('\n') + pushTail(), true, { private: true });
    }
    return { ok: true, fired: urgent.length, time: r.time };
  }

  return {
    ops, snapshots, restore, purgeOps,   // 持仓变更记录 / 备份列表 / 一键还原 / 清空流水（HOUTAI_AUDIT_V1）
    applyRemoteRemoval, addRemoteItem, lastAddAt, lastRemoveAt,   // 线上→本地对账（治「删不干净」）
    add: addItem, update: updateItem, remove: removeItem, removeMany, clearAll,
    lock: lockItem, setLocked, setMute, setTags, PRESET_TAGS, normTags,
    setCapital, setThresholds, compute, watch, checkNow, verdict,
    get raw() { return HOLD; }
  };
};
