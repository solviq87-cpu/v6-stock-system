let timer = null, countdown = 5;
const fmtY = v => v == null || v === '-' ? '-' : (v >= 1e8 ? (v / 1e8).toFixed(1) + '亿' : (v / 1e4).toFixed(0) + '万');
const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
const sign = v => (v == null || v === '') ? '-' : (Number(v) > 0 ? '+' + v : v);
// 外部接口来的文本（涨停题材/原因由同花顺返回）必须转义后再插进 innerHTML，
// 否则一个尖括号就能把面板打穿。别嫌麻烦：这类"随手拼 HTML"正是 XSS 的入口。
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── 发布看板（修改请求联动管理）────────────────────────────────────────────
// ⛔ 真凶修复（2026-10-28）：localStorage.getItem 在 Safari 隐私模式/部分插件下会抛
//    SecurityError，而它在 loadReleaseBoard 的 try-catch 外面 → async 函数 reject →
//    unhandledrejection → showRenderError 红框每 60 秒弹一次（loadReleaseBoard 的 setInterval）。
//    手机端不调这个函数所以手机端正常——"仅电脑端报错"的完整解释。
function getRelToken() {
  try {
    return (typeof GATE !== 'undefined' && GATE.token) || (typeof LOCK !== 'undefined' && LOCK.token)
      || localStorage.getItem('qd_device') || localStorage.getItem('qd_token') || '';
  } catch { return ''; }
}
function relRole() {
  try { return localStorage.getItem('qd_role') || 'view'; } catch { return 'view'; }
}
async function loadReleaseBoard() {
  // ⛔ 整个函数体兜底 try-catch：async 函数经 setInterval 每 60s 调用，
  //    任何未捕获异常都会变成 unhandledrejection → 弹"面板刷新出错"红框（电脑端专属故障）。
  //    这里保证：无论内部哪里出错，都写进 relBoard（或静默吞掉），绝不向上抛。
  try {
    const box = document.getElementById('relBoard');
    if (!box) return;
    const stat = document.getElementById('relStat');
    const t = getRelToken();
    if (!t) { box.innerHTML = '<span class="muted">未登录，无法读取发布看板</span>'; return; }
    const r = await fetch('/api/release/requests?token=' + encodeURIComponent(t), { cache: 'no-store' }).then(x => x.json());
    if (!r.ok) { box.innerHTML = '<span class="muted">读取失败：' + esc(r.error || '未知') + '</span>'; return; }
    window._relLastRelease = r.lastRelease || null;
    renderReleaseBoard(r.requests || []);
    if (stat) stat.textContent = '共 ' + (r.requests || []).length + ' 个 · 线上 v' + (r.onlineVer || '—');
  } catch (e) {
    try {
      const box = document.getElementById('relBoard');
      if (box) box.innerHTML = '<span class="muted">发布看板加载异常：' + esc(e.message) + '</span>';
    } catch (_) {}
  }
}
function renderReleaseBoard(reqs) {
  const box = document.getElementById('relBoard');
  if (!box) return;
  const _localC = relLocalConfirmed();
  const isEdit = relRole() === 'edit';
  if (!Array.isArray(reqs) || !reqs.length) { box.innerHTML = '<span class="muted">当前没有待处理请求</span>'; return; }
  const pending = reqs.filter(x => (x.status || 'pending') === 'pending' || String(x.status).indexOf('pending') === 0);
  // 上次发布记录（成功/改了什么一目了然）
  const lastRel = window._relLastRelease || null;
  let lastHtml = '';
  if (lastRel && lastRel.version) {
    const t = new Date(lastRel.at);
    const tt = String(t.getMonth() + 1) + '/' + String(t.getDate()) + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    const items = (lastRel.details || []).map((d, i) =>
      '<div style="font-size:12px;padding:2px 0">' + (i + 1) + '.【' + esc(d.space) + '】' + esc(d.summary) + '</div>').join('');
    lastHtml = '<div style="background:#ebfbee;border:1px solid #8ce99a;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:12px">'
      + '<b>📦 上次发布：v' + esc(lastRel.version) + '</b> · ' + tt + ' · ' + lastRel.count + ' 个请求'
      + '<span class="muted">（复核结果看飞书推送）</span>' + items + '</div>';
  }
  const stageName = s => {
    if (!s || s === 'pending') return '🟠 待确认';
    if (s === 'confirmed') return '🔵 已确认';
    if (s.indexOf('published-') === 0) return '🟢 已发布 ' + s.slice(10);
    if (s.indexOf('verified-') === 0) return '✅ 已复核 ' + s.slice(9);
    if (s === 'rejected') return '⚪ 已驳回';
    if (s === 'verifying') return '⏳ 复核中';
    return esc(s);
  };
  const rows = reqs.map((r, idx) => {
    // ⛔ 单个请求对象异常（null/缺字段）时不许拖垮整张表
    try {
      let isPend = r && ((r.status || 'pending') === 'pending' || String(r.status).indexOf('pending') === 0);
      // 本地已确认：显示"已确认(执行中)"，不再给确认按钮；真正发布后清标记
      if (isPend && r && _localC[r.file]) r.status = 'confirmed';
      if (!isPend && r && _localC[r.file]) relClearConfirmed(r.file);
      const oneBtn = (isPend && r && !_localC[r.file])
        ? '<button onclick="relConfirmOne(\'' + esc(r.file) + '\', this)" style="padding:3px 10px;border:1px solid #339af0;background:#e7f5ff;color:#1971c2;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">✓ 确认</button>'
        : '';
      return '<tr style="' + (r && r.urgent ? 'background:#fff5f5' : '') + '">' +
      '<td><b>' + esc(r && r.space) + '</b>' + (r && r.urgent ? ' <span style="color:#c92a2a">🔥急修</span>' : '') + '<br><span class="muted">' + esc(r && r.ts) + '</span></td>' +
      '<td>' + esc(r && r.summary) + '<br><span class="muted">' + esc(r && r.files) + '</span></td>' +
      '<td>' + stageName(r && r.status) + '</td>' +
      '<td>' + oneBtn + '</td>' +
      '</tr>';
    } catch (e) { return '<tr><td colspan="4" class="muted">（一条记录渲染异常）</td></tr>'; }
  }).join('');
  const btn = (isEdit && pending.length) ? `<div style="margin-bottom:10px"><button class="btn" onclick="relPublish()">🚀 确定发布 ${pending.length} 个待处理请求</button> <span class="muted">自动 bump 版本号 → git commit → sync+apply → 标记 published → 回告 → 复核</span></div>` : '';
  box.innerHTML = lastHtml + btn + '<div class="scrolly" style="max-height:360px"><table><tr><th>空间/时间</th><th>改动摘要</th><th>状态</th><th>操作</th></tr>' + rows + '</table></div>';
}
// 单个请求确认发布（每行独立按钮，2026-10-28）
// ⛔ 本地确认标记（2026-10-28）：点了确认立刻标记，不再重复显示"待确认"（同 mobile.html）
function relLocalConfirmed() { try { return JSON.parse(localStorage.getItem('rel_confirmed') || '{}'); } catch (e) { return {}; } }
function relMarkConfirmed(file) {
  const m = relLocalConfirmed(); m[file] = Date.now();
  try { localStorage.setItem('rel_confirmed', JSON.stringify(m)); } catch (e) {}
}
function relClearConfirmed(file) {
  const m = relLocalConfirmed();
  if (m[file]) { delete m[file]; try { localStorage.setItem('rel_confirmed', JSON.stringify(m)); } catch (e) {} }
}
async function relConfirmOne(file, btn) {
  const t = getRelToken();
  if (!t) { pageMsg('未登录', 'err'); return; }
  if (btn) { btn.textContent = '提交中…'; btn.disabled = true; }
  pageMsg('已提交「' + file.slice(15, -3) + '」，本地执行中…', 'ok');
  try {
    const r = await fetch('/api/release/publish?token=' + encodeURIComponent(t), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t, files: [file] })
    }).then(x => x.json());
    if (!r.ok) {
      if (btn) { btn.textContent = '✓ 重试'; btn.disabled = false; }
      pageMsg('提交失败：' + (r.error || '未知'), 'err');
      return;
    }
    relMarkConfirmed(file);
    if (btn) { btn.textContent = '已确认 ✓'; btn.style.background = '#ebfbee'; btn.style.borderColor = '#8ce99a'; btn.style.color = '#2b8a3e'; }
    pageMsg('已确认，本地执行中，完成后推送版本号', 'ok');
    setTimeout(loadReleaseBoard, 2000);
  } catch (e) {
    if (btn) { btn.textContent = '✓ 重试'; btn.disabled = false; }
    pageMsg('网络异常：' + e.message, 'err');
  }
}
async function relPublish() {
  const t = getRelToken();
  if (!t) { await uiAlert('未登录'); return; }
  if (!(await uiConfirm('确认发布所有待处理请求？\n将自动 bump 版本号、提交 git、标记 published、回告、触发复核。', '确认发布', '取消'))) return;
  try {
    const r = await fetch('/api/release/publish?token=' + encodeURIComponent(t), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t })
    }).then(x => x.json());
    if (!r.ok) {
      let msg = '发布失败：' + (r.error || '未知');
      if (r.checkResult && r.checkResult.red && r.checkResult.red.length) {
        msg += '\n\n联检红灯：' + r.checkResult.red.join('、');
        if (await uiConfirm(msg + '\n\n是否强制发布？', '强制发布', '取消')) {
          const r2 = await fetch('/api/release/publish?token=' + encodeURIComponent(t), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: t, force: true })
          }).then(x => x.json());
          if (r2.ok) await uiAlert('✅ 已强制发布：' + r2.version);
          else await uiAlert('强制发布失败：' + (r2.error || '未知'));
          loadReleaseBoard();
          return;
        }
      }
      await uiAlert(msg);
      loadReleaseBoard();
      return;
    }
    if (r.queued) await uiAlert('✅ 已收到发布确认（' + r.count + ' 个请求）\n本地副本正在执行，完成后推送版本号。');
    else await uiAlert('✅ 已发布：' + r.version + '\n共 ' + r.count + ' 个请求');
    loadReleaseBoard();
  } catch (e) { await uiAlert('网络异常：' + e.message); }
}
async function relUpdate(file, stage) {
  // 保留手动单条更新入口（复核/驳回用）
  const t = getRelToken();
  if (!t) { await uiAlert('未登录'); return; }
  // ⛔ 取消必须是「什么都不做」：原生 prompt 取消返回 null，旧代码 `|| ''` 把它变成空串，
  //    接着照样发请求 —— 于是「驳回」会以空原因落库、「标记已发布」会以空版本号落库。
  //    现在取消直接 return，不留半截数据。
  let detail = '';
  if (stage === 'published') { const v = await uiPrompt('请输入发布版本号（如 20261027mq）：', ''); if (v === null) return; detail = v; }
  if (stage === 'verified') { const v = await uiPrompt('请输入复核版本号（如 20261027mq）：', ''); if (v === null) return; detail = v; }
  if (stage === 'rejected') { const v = await uiPrompt('请输入驳回原因：', ''); if (v === null) return; detail = v; }
  try {
    const r = await fetch('/api/release/update?token=' + encodeURIComponent(t), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t, file, stage, detail })
    }).then(x => x.json());
    if (!r.ok) { await uiAlert('操作失败：' + (r.error || '未知')); return; }
    await uiAlert('已标记为：' + stage + (detail ? '（' + detail + '）' : ''));
    loadReleaseBoard();
  } catch (e) { await uiAlert('网络异常：' + e.message); }
}

// ── 状态拉取的超时与「最后成功时刻」（dy 轮，2026-10-17）────────────────────
// ⛔⛔ 用户反馈「为啥一直显示出来连续多轮没拉到数据」，实测根因不是拉取失败本身，
//    而是**防堆叠锁没有时限**：/api/state 一次请求既不抛错也不返回（云端容器回收时的
//    半开连接、手机 WiFi↔4G 切换后的死连接，都会这样），`_rfBusy` 就永远挂着，
//    之后每 5 秒的轮询全被 `if (_rfBusy) return` 挡回去 —— 面板从此不再更新，
//    那个红框**再也没有机会被 _stateFailOK 摘掉**。
//    jsdom 真跑取证（_forensic_statefail.js 场景 C）：失败 3 轮 → 一次请求挂住 →
//    之后两轮数据全部正常返回，红框依然常驻。
//    修法两层：① 这里给 fetch 加 12 秒超时，超时按「本轮没拿到」计数；
//             ② 给 _rfBusy 加 25 秒兜底放行（AbortController 不灵的极端环境也能自愈）。
//    ⛔ 超时绝不当「成功」放过去 —— 那等于拿上一轮数据冒充这一轮。
//    ⛔ 12 秒是「比 5 秒轮询长、比用户耐心短」的折中：线上 /api/state 实测 0.3~0.6 秒，
//       本机 0.02 秒；手机弱网一次 12 秒还回不来，基本可以判定这一轮废了。
const STATE_FETCH_TIMEOUT_MS = 12000;
const STATE_BUSY_MAX_MS = 25000;
let _lastStateAttemptAt = 0;   // 上一次发起拉取的时刻（判断「页面是不是被冻结了很久」）
let _lastStateOKAt = 0;        // 最后一次拿到数据的时刻（红框里要写明「停在哪一刻的数据」）
// ⛔ 失败计数必须定义在 showRenderError 之前：红框文案要读它。
//    （hi 轮教训：模块初始化期调「函数体读后置 let/const」的函数 = TDZ 静默故障）
let _stateFailN = 0;
async function fetchStateOnce() {
  if (typeof AbortController !== 'function') return (await fetch('/api/state', { cache: 'no-store' })).json();
  const ac = new AbortController();
  const tid = setTimeout(() => { try { ac.abort(); } catch (_) {} }, STATE_FETCH_TIMEOUT_MS);
  try {
    return await (await fetch('/api/state', { cache: 'no-store', signal: ac.signal })).json();
  } catch (e) {
    // abort 的原文是 "The operation was aborted"，对用户没有信息量 —— 换成能自查的话
    const _ab = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
    if (_ab) throw new Error('请求 ' + Math.round(STATE_FETCH_TIMEOUT_MS / 1000) + ' 秒没有响应（已主动断开，避免轮询永久卡住）');
    throw e;
  } finally { clearTimeout(tid); }
}
async function refresh() {
  // 锁定滚动：刷新重建DOM后恢复每个窗口的滚动位置（防止看不到正在看的详情）
  const scrollKeep = document.querySelectorAll('.scrolly').length
    ? [...document.querySelectorAll('.scrolly')].map(el => ({ el, top: el.scrollTop })) : [];
  try {
    // 复盘快捷筛选（减少长表翻滚）
    window.rvFilter = window.rvFilter || 'all';
    window.rvGroup = window.rvGroup || 'theme';
    window.rvSetMode = k => { if (k === 'theme' || k === 'flat') window.rvGroup = k; else window.rvFilter = k; countdown = 5; refresh(); };
    window.rvSetFilter = f => window.rvSetMode(f);
    window.ltabShow = i => {
      for (let j = 0; j < 3; j++) {
        document.getElementById('ltab' + j).style.display = i === j ? '' : 'none';
        document.getElementById('ltabB' + j).classList.toggle('on', i === j);
      }
    };
    // ⛔ gj 轮实测：「这一轮没拉到」≠「面板坏了」。云端冷启动/实例回收时 /api/state 会返回
    //    502 HTML、手机弱网直接断连，两者都让下面这行抛错，页面随即弹出那句
    //    「⚠️ 面板刷新出错（数据可能已停止更新）」—— 可面板上还是上一轮的数据，5 秒后的
    //    下一轮通常就成功了。把一次没拉到达当成渲染坏来报警 = 误报，而且那个框不会自己消失。
    //    现在拉取失败单独走 stateFetchFail（中性提示 + 计数，连续 3 轮才升级成红框）。
    let s = null;
    _lastStateAttemptAt = Date.now();
    try { s = await fetchStateOnce(); }
    catch (e) { stateFetchFail(e); return; }
    _lastStateOKAt = Date.now();
    _stateFailOK();
    // ⛔⛔ hv+1 轮：数组含 null 元素让整页渲染抛错 —— 「面板渲染出错怎么改不好」的根因。
    //    ar/gj/gk 三轮修的都是「字段缺失」（置 null/删除，jsdom 模糊测试全绿），
    //    但漏了这个形态：JSON 序列化会把数组里的 NaN/undefined 变成 null 元素
    //    （JSON.stringify([NaN]) === '[null]'），而 /api/state 正是 res.json(state)
    //    走同一条序列化 —— 后端任何一处算出 NaN（除以 0、空数组求均值）都会变成
    //    一个 null 元素塞进数组，前端 `.map(x => x.score)` 裸取即抛
    //    「Cannot read properties of null (reading 'score')」，window.onerror 兜底
    //    弹出 render 框，而数据本身是好的、下一轮刷新又恢复正常 —— 用户看到的就是
    //    「偶发 · 怎么改不好」。jsdom 实测（_forensic_render2.js）：79 个顶层字段
    //    逐个置 null/删除全不炸，但 15 个数组字段置 [null] 全炸
    //    （global/sectors/ztTopics/ztPre/ztPreRules/trendScan/steadyUp/ztBySector/
    //     pool/learnHistory/trendPool/signals/yierList/lianbanList）。
    //    修法：序列化边界不可信 —— 渲染前统一滤掉数组里的 null/undefined 元素。
    //    ⛔ 只滤元素不清内容：滤掉的元素「判不出是什么」，不猜、不补默认对象；
    //       深度 2（顶层数组 + 一层容器内的数组，如 S.auction.strong），
    //       巨型字段（stocks 等几千个对象的快照）不进递归，只滤顶层自身。
    normalizeState(s);
    window.__v6Dashboard=s.dashboard||null;window.dispatchEvent(new CustomEvent('v6-dashboard-data',{detail:window.__v6Dashboard}));
    // ── 市场情绪卡片（盘面总览首卡）──
    {
      const mood = s.mood ? s.mood : null;
      const box = document.getElementById('moodBox');
      const time = document.getElementById('moodTime');
      const _off = (s.trading === false) ? ' <span class="muted">（盘后·基于最近交易日快照）</span>' : '';
      if (box && mood) {
        const advice = mood.advice || '观望';
        const evidence = mood.evidence || [];
        const color = advice === '加仓' ? 'up' : advice === '空仓' ? 'down' : '';
        const icon = advice === '加仓' ? '📈' : advice === '减仓' ? '⚠️' : advice === '空仓' ? '🛡️' : '➖';
              box.innerHTML = `<b class="${color}">${icon} ${advice}</b> <span class="muted">${mood.mood || '-'} · ${(mood.evidence || []).slice(0,3).map(e => e).join('；')}</span>${_off}`;
      } else if (box) {
        box.innerHTML = '<span class="muted">情绪数据未就绪</span>';
      }
      if (time && mood) {
        // ⛔ if 轮：把各分量的数据时刻摆出来 —— 指数 15s 实时、全A 快照 2 分钟一轮、
        //    板块流 30s，「实时到什么程度」不许靠猜（缺哪个时刻就不显示哪个）。
        const _hm = at => { if (!at) return ''; const t = new Date(at); return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
        const _age = n => {
          if (n == null || !Number.isFinite(n)) return '';
          if (n < 60) return `${n}秒前`;
          if (n < 3600) return `${Math.round(n / 60)}分钟前`;
          return `${Math.round(n / 3600)}小时前`;
        };
        const _parts = ['外围+全A+资金', `建议${mood.advice || '观望'}`];
        const _snap = _hm(mood.snapAt), _idx = _hm(mood.idxAt);
        if (_snap) _parts.push(`全A ${_snap}${s.stocksAgeSec != null ? '（' + _age(s.stocksAgeSec) + '）' : ''}`);
        if (_idx) _parts.push(`指数 ${_idx}`);
        time.textContent = _parts.join(' · ');
        // 快照精确时点（悬停可看）：解决「手机端/面板显示的到底是几点数据」这一核心疑虑
        if (s.stocksAt) time.title = '快照时间：' + new Date(s.stocksAt).toLocaleString();
      }
    }
    // ⛔ 面板上「每 N 分钟 / ≥N% 自动推送」这类承诺一律读后端这一份（de 轮）——
    //    以前在 HTML 里写死，同一面板两处各写一个数（补涨龙 60 vs 75）、跟实现也对不上。
    //    ⛔ const 有 TDZ：必须定义在所有使用点之前，否则整页渲染静默中断（踩过）。
    const _pn = s.panelNotes || { tick: 5, bigmoney: '盘中识别', pool: '盘中重算', buzhang: '', ztInfer: '', auction: 5, gate: '', refreshWin: '' };
    // ⛔ 「30秒刷新 / 60秒刷新」只在数据窗口内成立，休市与夜间不拉 —— 挂在 title 上说清楚
    for (const _id of ['sectFlowNote', 'globalNote']) { const _e = document.getElementById(_id); if (_e) _e.title = _pn.refreshWin; }
    // ── 板块突增基线的时点（dq 轮）────────────────────────────────────────
    //    主力净流入是**当日累计**，跨天归零；基线跨了天就不能拿来做差，否则开盘会误报突增。
    //    ⛔ 只在日志里说的结论等于没说 —— 这里把「基线是哪天建的」摆在板块标题旁边。
    {
      const _e = document.getElementById('sectFlowNote');
      if (_e) {
        const _ps = (s.prevSnap || {}).sectorFlow || null;
        const _base = !_ps ? '突增基线未建立'
          : _ps.usable ? `突增基线 ${_ps.day}（今日）`
          : (_ps.day ? `突增基线为 ${_ps.day}，本轮只建档不做差` : '突增基线未建立');
        _e.textContent = `主力净流入 · 30秒刷新 · ${_base}`;
      }
    }
    { const _e = document.getElementById('holdWatchNote'); if (_e && _pn.hold) _e.textContent = '平台' + _pn.hold; }
    // 凭证失效（被撤销/过期/口令已改）：弹出内联口令层，不用浏览器 alert
    // ⛔ 2026-10-07 补（本轮角度：系统承诺的时限 —— 到期那一刻到底发生了什么）：
    //    后端已经把失败原因分成了 expired / revoked / superseded 三种并写在 s.msg 里，
    //    可这里原来写死一句「凭证已失效，请重新输入口令」，把后端的区分**全部盖掉** ——
    //    用户看到的还是那一句笼统的话。最要命的是 revoked（授权被收回）：
    //    对方只会以为是自己密码记错了 → 反复试密码 → 走「忘记密码」→ 每轮一条验证码推送。
    //    现在优先用后端给的原因文案，拿不到才退回兜底那句。
    if (s && (s.locked || s.needPassword)) {
      if (GATE.passed) { GATE.passed = false; GATE.token = ''; showGate(s.msg || '凭证已失效，请重新输入口令'); }
      return;
    }
    document.getElementById('mkt').textContent = s.trading ? '交易时段 · 监控中' : '非交易时段';
    document.getElementById('mkt').className = 'badge ' + (s.trading ? 'on' : '');
    // ⛔ 后端这两个字段恒存在，但前端不许赌这件事（gj 轮字段级模糊测试实测：
    //    删掉 loop / ztPool 任一个都会让整页渲染抛错、弹出红框）。判空在取属性之前。
    const _lp = s.loop || {};
    document.getElementById('tickinfo').textContent = `已扫描 ${_lp.tickCount || 0} 次` + (_lp.lastError ? ' · ' + _lp.lastError : '');
    // 龙头
    const au = s.auction;
    if (au) {
      // 竞价进行中（9:15-9:25）后端每 12 秒重拉一次 → 显示实时状态与距 9:25 倒计时
      let _at = au.time || '';
      let _live = !!au.live;
      if (_live) {
        const n = new Date();
        const sec = n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
        const left = Math.max(0, 9 * 3600 + 25 * 60 - sec);
        _at = `🔴 竞价进行中 ${au.time} · 实时刷新(${_pn.auction}s) · 距9:25 ${Math.floor(left / 60)}分${String(left % 60).padStart(2, '0')}秒` + (au.stage ? ` · ${au.stage}` : '');
      } else if (au.pxSrc) {
        _at = `${au.time || ''} · 取价口径 ${au.pxSrc}` + (au.stage ? ` · ${au.stage}` : '') + (au.amtReliable === false ? ' · 成交额为当日累计值' : '');
      }
      const _el = document.getElementById('aucTime');
      _el.textContent = _at;
      _el.className = _live ? 'up' : '';
      _el.style.fontWeight = _live ? '700' : '';
      let html = '';
      // ⛔ 次新股闸门未生效必须显示（见服务端 newGateUnknown）：备用源缺上市日期时，
      //    auctionBlocked 的 `ago != null && ago < 60` 恒不成立 → 次新股照进不误。
      if (au.newGateUnknown > 0) {
        html += `<div class="muted" style="margin-bottom:6px;color:#a15c00">⚠️ 本批 ${au.newGateUnknown} 只缺上市日期（行情源降级中），次新股闸门本轮未生效，下面可能混入次新股</div>`;
      }
      if (au.globalLeader) {
        const L = au.globalLeader;
        html += `<div style="margin-bottom:8px">🎯 竞价龙头推断：<b style="color:var(--up)">${L.leaderName}(${L.leaderCode})</b>
          <span class="${cls(L.leaderPct)}">${sign(L.leaderPct)}%</span>
          <span class="muted">板块【${L.sector}】主力净流入 ${fmtY(L.sectorInflow)}，板块内上涨 ${L.upCount}/${L.totalCount}</span></div>`;
      }
      html += (au.strong || []).slice(0, 6).map(x =>
        `<span class="tag">${x.name} 竞价<span class="${cls(x.auctionPct)}">${sign(x.auctionPct)}%</span> 主力${fmtY(x.mainInflow)}${x.score != null ? ` <span class="muted">分${x.score}</span>` : ''}</span>`).join('');
      // 涨停推断：模型估值的当日封板概率（非回测胜率）；推送阈值由后端 AUCZT_PUSH_PROB 定（下面读 _pn.ztInferN）
      if ((au.ztInfers || []).length) {
        html += `<div style="margin:8px 0 4px"><b>🔥 涨停推断 · 模型概率</b> <span class="muted">${_pn.ztInfer} · 信号回验持续学习</span> <span class="muted" style="cursor:help" title="${_pn.gate}">ⓘ</span></div>`;
        html += au.ztInfers.map(x =>
          `<div style="margin-bottom:6px;padding:6px 8px;border:1px solid var(--line);border-radius:8px">
            <b class="${x.prob >= (_pn.ztInferN || 18) ? 'up' : ''}">${x.prob}%</b> <span>${x.name}</span> <span class="muted">${x.code}</span>
            <span class="${cls(x.auctionPct)}">竞价${sign(x.auctionPct)}%</span>
            ${x.score != null ? `<span class="muted">竞价分 ${x.score}</span>` : ''}
            <div class="muted" style="white-space:normal;margin-top:2px">推断依据: ${x.reason || '-'}</div>
            ${x.risk ? `<div class="muted" style="white-space:normal">⚠️ ${x.risk}</div>` : ''}
          </div>`).join('');
      }
      document.getElementById('leader').innerHTML = html || '暂无竞价异动';
      document.getElementById('aucSectors').innerHTML = (au.sectors || []).slice(0, 6).map(x =>
        `<tr><td>${x.name}</td><td class="${cls(x.pct)}">${sign(x.pct)}%</td><td class="${cls(x.mainInflow)}">${fmtY(x.mainInflow)}</td><td class="muted">领涨 ${x.leader}</td></tr>`).join('');
    }
    // 板块
    // ig 轮 #263 声明层：资金流是**当日累计**快照，必须说清「截至何时、归属哪天」——
    //   盘前/休市这份数是上一交易日收盘拉的那份，不说就会被当成今天盘中的实时资金（dd/da 轮同款病）。
    {
      const _sn = document.getElementById('sectFlowNote');
      if (_sn) {
        const _at = s.sectorsAt ? new Date(s.sectorsAt) : null;
        const _atTxt = _at && isFinite(_at.getTime())
          ? `${String(_at.getMonth() + 1).padStart(2, '0')}-${String(_at.getDate()).padStart(2, '0')} ${String(_at.getHours()).padStart(2, '0')}:${String(_at.getMinutes()).padStart(2, '0')}` : '';
        const _d8 = String(s.sectorsDay || '').replace(/-/g, '');
        const _dayTxt = /^\d{8}$/.test(_d8) ? ` · 归属 ${_d8.slice(4, 6)}-${_d8.slice(6, 8)}` : '';
        const _age = typeof s.sectorsAgeSec === 'number' ? ` · ${s.sectorsAgeSec}秒前` : '';
        _sn.innerHTML = `主力净流入 · 当日累计${_atTxt ? ` · 截至 <b>${_atTxt}</b>` : ''}${_age}${_dayTxt}（10秒刷新；盘前/休市为上一交易日收盘快照，非实时）`;
      }
    }
    document.getElementById('sectors').innerHTML = '<tr><th>板块</th><th>涨跌</th><th>主力净流入</th><th>上涨/总数</th><th>领涨股</th></tr>' +
      (s.sectors || []).slice(0, 15).map(x =>
        `<tr><td>${x.name}</td><td class="${cls(x.pct)}">${sign(x.pct)}%</td><td class="${cls(x.mainInflow)}">${fmtY(x.mainInflow)}</td><td>${x.upCount}/${x.totalCount}</td><td class="${cls(x.leaderPct)}">${x.leader} ${sign(x.leaderPct)}%</td></tr>`).join('');
    // 涨停分类（角色颜色图例：红=龙头 橙=龙二 金=中军 灰=跟风，对应CSS .r-leader/.r-deputy/.r-mid/.r-follow）
    // ⛔ 池子是哪一天的必须说出来（dd 轮）：写死"今日"在竞价时段/休市日说的是反的 ——
    //    那份池子其实是上一交易日收盘的。日子由后端 S.ztDay（真正喂给数据源的参数）说了算，
    //    认不出来就只报只数、不带日子（宁可少说，也不许说错）。
    {
      // ⛔ 日子由后端 S.ztDay（真正喂给数据源的那个参数）说了算，认不出来就只报只数、不带日子
      const _ztEl = document.getElementById('ztCount');
      const _ztTag = s.ztDayTag || '';
      // ig 轮 #263 声明层：盖戳探测失败要留痕（server S.ztDayProbed）——探测不到数据归属日时，
      //    盘前时段会把昨日池子盖成今日戳。这种时候别把"今日"说得那么确定：加⚠ + title 说清
      //    「这个日子没验证过」。缺字段（旧状态）当正常处理，不制造差异。
      const _probed = s.ztDayProbed !== false;
      // ⛔ 2026-10-28 用户口径「退市整理期股不计入涨停家数」：池里已经剔除，这里把「少的那只去哪了」
      //    说出来（后端 ztExcluded 留痕）。⛔ 不加进池长度，只做解释——数字口径只认 s.ztPool.length。
      const _ztEx = (s.ztExcluded && +s.ztExcluded.count > 0) ? s.ztExcluded : null;
      _ztEl.textContent = `${_probed ? '' : '⚠️'}${_ztTag ? _ztTag + (/^\d\d-\d\d$/.test(_ztTag) ? ' ' : '') : ''}涨停 ${(s.ztPool || []).length} 只`
        + (_ztEx ? `（另剔退市 ${_ztEx.count}）` : '');
      _ztEl.title = (s.ztDay ? '涨停池归属交易日 ' + s.ztDay : '') +
        (_probed ? '' : '（⚠️ 归属日未经行情数据验证：探测失败，盘前/休市时段可能是上一交易日）') +
        (_ztEx ? `；不含退市整理期股 ${(_ztEx.items || []).map(x => x && x.name).filter(Boolean).join('、')}（按口径不计入涨停家数）` : '');
    }
    // 涨停题材：同花顺涨停原因聚合（只显示≥2只的，单只是个股独立事件不算题材）。
    // 拉不到时明说"未取到"，不显示空白让人以为今天没题材。
    {
      const tp = (s.ztTopics || []).filter(x => x[1] >= 2);
      const el = document.getElementById('ztTopics');
      if (el) {
        // 题材来源要可追溯：同花顺涨停原因 / 东财题材统计，取不到时明说是哪条路断的
        const _srcTxt = s.ztTopicSrc ? `<span class="muted"> · 来源 ${esc(s.ztTopicSrc)}</span>` : '';
        el.innerHTML = tp.length
          ? `<span class="muted">题材:</span> ` + tp.slice(0, 6).map(x =>
              `<span class="rtag r-mid">${esc(x[0])} ${x[1]}只</span>`).join('') + _srcTxt
          : `<span class="muted">题材: 未取到${s.ztReasonHit ? '（命中 ' + esc(s.ztReasonHit) + '）' : ''}</span>` + _srcTxt;
      }
    }
    document.getElementById('ztBySector').innerHTML =
      `<div style="margin-bottom:6px"><span class="muted">角色图例:</span> ` +
      `<span class="rtag r-leader">👑 龙头</span><span class="rtag r-deputy">🥈 龙二</span><span class="rtag r-mid">💰 中军</span><span class="rtag r-follow">跟风</span> ` +
      `<span class="muted">（红=连板最高·人气核心 / 橙=第二连板高度≥2板 / 金=成交额最大·大资金 / 灰=同板其余；⭐题材强=未涨停但带动性强，同样参评龙一/龙二/中军）</span></div>` +
      (s.ztBySector || []).map(g =>
        `<div style="margin-bottom:8px"><span class="tag"><b>${g.count}只</b> ${g.sector}</span> ` +
        (g.stocks || []).map(x => {
          const c = x.role === 'leader' ? 'r-leader' : x.role === 'deputy' ? 'r-deputy' : x.role === 'mid' ? 'r-mid' : 'r-follow';
          const ic = x.role === 'leader' ? '👑' : x.role === 'deputy' ? '🥈' : x.role === 'mid' ? '💰' : '';
          const lbTxt = x.lb > 1 ? `·${x.lb}板` : (x.strong ? '·⭐题材强' : '');
          return `<span class="rtag ${c}">${ic}${x.name}${lbTxt}</span>`;
        }).join('') + `</div>`).join('') || '<span class="muted">暂无涨停</span>';
    // 信号
    document.getElementById('signals').innerHTML = (s.signals || []).map(x =>
      `<div class="sig ${x.type === '涨停' ? 'zt' : ''}">${new Date(x.ts).toLocaleTimeString('zh-CN')} ${x.msg}${x.prob ? ' <b>' + x.prob + '%</b>' : ''}</div>`).join('')
      || `<div class="muted">暂无信号（交易时段每${_pn.tick}秒扫描）</div>`;
    // 🌗 买卖两侧摊开：资金永远一进一出，只给一个「主力净额」答不上"到底流入多还是流出多"。
    //    四级（超大单/大单/中单/小单）净额恒等于 0，看各自正负就知道谁在买、谁在卖。
    const balanceRow = x => {
      const f = x && x.flow;
      if (!f || f.dir === 'unknown') return '';
      if (!x.superNet && !x.bigNet && !x.midNet && !x.smallNet) return '';
      const DIR = { in: ['#c92a2a', '买方占优'], out: ['#2b8a3e', '卖方占优'], mixed: ['#e8590c', '资金分歧'], flat: ['#868e96', '主力缺席'] };
      const c = DIR[f.dir] || DIR.flat;
      const cell = (lab, v) => `<span>${lab} <b class="${cls(v)}">${v > 0 ? '+' : ''}${fmtY(Math.abs(v))}</b></span>`;
      return `<div class="rvc-g" style="border-top:1px dashed rgba(128,128,128,.25);padding-top:5px;margin-top:3px">
        <span style="color:${c[0]};font-weight:600" title="${f.label}">🌗 ${c[1]}</span>
        ${cell('超大单', f.superNet)}${cell('大单', f.bigNet)}${cell('中单', f.midNet)}${cell('小单', f.smallNet)}
      </div>
      <div class="rvc-g"><span class="muted" title="恒等式：超大单+大单+中单+小单=0（买到的金额必然等于卖出的金额），所以正负就能定论谁在买谁在卖">→ ${f.label}</span></div>`;
    };
    // 市场温度：不只看大盘指数 —— 用全A个股真实涨跌 + 市值分层，看穿"护指数拉权重"
    if (document.getElementById('brBody')) {
      const b = s.breadth || null;
      const el = document.getElementById('brBody'), ei = document.getElementById('brInfo');
      if (b && Number.isFinite(b.avg)) {
        const capCell = (label, v, tip) => `<span class="tag" style="cursor:help" title="${tip}">${label} <b class="${(v || 0) >= 0 ? 'up' : 'down'}">${v == null ? '-' : (v > 0 ? '+' : '') + v + '%'}</b></span>`;
        // ⛔ 2026-10-08 补（da 轮）：这份宽度属于哪个交易日必须写出来。
        //    休市日/开盘前拿到的是上一交易日收盘的快照，只写时间会让人以为是今天盘中算的。
        const _bd = (b.isToday === false && b.basisDay)
          ? ` · 🕒 截至 ${String(b.basisDay).slice(4, 6)}/${String(b.basisDay).slice(6, 8)} 收盘`
          : '';
        ei.textContent = `${b.n} 只个股 · ${b.time}${_bd}` + (b.distort ? ' · ⚠️ 指数与个股背离' : '');
        el.innerHTML =
          `<div style="margin-bottom:5px">
            <span>全市场个股均值 <b class="${b.avg >= 0 ? 'up' : 'down'}">${b.avg > 0 ? '+' : ''}${b.avg}%</b></span>
            <span>中位 <b class="${b.med >= 0 ? 'up' : 'down'}">${b.med > 0 ? '+' : ''}${b.med}%</b></span>
            <span>上涨 <b class="up">${b.up}</b> / 下跌 <b class="down">${b.down}</b>（上涨占比 <b class="${b.upRatio >= 50 ? 'up' : 'down'}">${b.upRatio}%</b>）</span>
            <span class="muted">指数 ${b.idx == null ? '-' : (b.idx > 0 ? '+' : '') + b.idx + '%'}</span>
          </div>
          <div>${capCell('超大≥500亿', b.xl, '流通市值500亿以上，权重股集中地')}${capCell('大100-500', b.l, '')}${capCell('中50-100', b.m, '')}${capCell('小20-50', b.s, '')}${capCell('微<20亿', b.xs, '小微盘，最能代表散户真实体验')}</div>
          ${b.distort ? `<div style="margin-top:5px;color:#c92a2a;font-weight:600">⚠️ ${b.note}</div>` : '<div class="muted" style="margin-top:4px">指数与个股一致，按正常标准判断</div>'}`;
      } else {
        ei.textContent = '需全市场快照（盘中自动刷新）';
        el.innerHTML = '<div class="muted">暂无数据</div>';
      }
    }
    // 主力大单流入实时识别（原因：资金真实买入，非情绪追板）
    if (s.bigMoney) {
      const _st = s.bigMoney.stat || {};
      document.getElementById('bmInfo').textContent = `${staleTime(s, 'bigMoney', s.bigMoney.time)} · 当日主力净占比>6% · 温和上涨未涨停 · ${poolN(s, 'bigmoney', (s.bigMoney.items || []).length)} 只`
        + (_st.total ? `（其中 ${_st.down || 0} 只处下跌通道·已降权，${_st.cold || 0} 只冷门板块）` : '')
        + ' · 权重股≤4个名额 · 名次=净占比×位置×板块冷热';
      document.getElementById('bigMoney').innerHTML = (s.bigMoney.items || []).map(x => {
        // 涨停概率：同一套校准过的逻辑回归模型，越高说明封板概率越大
        const p = Math.max(0, Math.min(100, +x.prob || 0));
        const pc = p >= 60 ? '#c92a2a' : p >= 40 ? '#e8590c' : p >= 20 ? '#f08c00' : '#868e96';
        const start = x.startSignal
          ? `<span class="tag" style="background:#fff0f6;color:#a61e4d;cursor:help" title="现价仍小于前20日新高 ${x.prevHigh20}，上方还有 ${x.gapToHigh20}% 空间，属于启动位">🚀 启动信号 · 距20日新高 ${x.gapToHigh20}%</span>`
          : (x.belowHigh20 ? `<span class="tag" style="background:#f8f9fa;color:#868e96;cursor:help" title="现价低于前20日新高 ${x.prevHigh20}，但距离已达 ${x.gapToHigh20}%，启动信号需小于20%">低于20日新高 ${x.gapToHigh20}%</span>`
            : (x.prevHigh20 ? `<span class="tag" style="background:#fff9db;color:#e67700;cursor:help" title="已站上前20日新高 ${x.prevHigh20}，进入压力区">⚡ 已破20日新高 ${x.prevHigh20}</span>` : ''));
        // 大单性质：这笔钱是在上升通道里加仓，还是在下降通道里接盘？（下跌途中的大单多为护盘/接盘，不是买点）
        const K = {
          '趋势中加仓': ['📈', '#ebfbee', '#2b8a3e'], '回踩承接': ['↩️', '#e6fcf5', '#0c8599'],
          '震荡整理': ['↔️', '#f8f9fa', '#868e96'], '深跌后承接': ['🕳️', '#f1f3f5', '#868e96'],
          '下跌途中接盘': ['⚠️', '#f1f3f5', '#495057']
        };
        const c = x.ctx || null;
        const kt = c ? (K[c.flowKind] || K['震荡整理']) : null;
        const kindTag = kt ? `<span class="tag" style="background:${kt[1]};color:${kt[2]};cursor:help" title="${(c.note || '').replace(/"/g, '')}">${kt[0]} ${c.flowKind}</span>` : '';
        const riskTag = (c && (c.risks || []).length)
          ? `<span class="tag" style="background:#fff5f5;color:#c92a2a;cursor:help" title="${(c.risks || []).join('；').replace(/"/g, '')}">⚠ ${c.risks.length}项风险</span>` : '';
        // 权重股（流通市值≥500亿）单独打标：这类票大单占比天然高，看得到才知道是不是又被权重股塞满
        const hv = x.capYi != null && x.capYi >= 500;
        const capTag = x.capYi == null ? '' : `<span class="tag" style="background:${hv ? '#f1f3f5' : '#f8f9fa'};color:${hv ? '#495057' : '#868e96'};cursor:help" title="流通市值${x.capYi}亿${hv ? ' —— 属权重股，全池最多占4个名额' : ''}">${hv ? '🏛权重 ' : ''}${x.capYi >= 1000 ? (x.capYi / 1000).toFixed(1) + '千亿' : x.capYi + '亿'}</span>`;
        const h = x.heat || null;
        const heatTag = h ? `<span class="tag" style="background:${h.hot ? '#fff0f6' : '#f1f3f5'};color:${h.hot ? '#a61e4d' : '#868e96'};cursor:help" title="${(h.label || '').replace(/"/g, '')}">${h.short || (h.hot ? '🔥热门' : '❄️冷门')}</span>` : '';
        const posRow = c ? `<div class="rvc-g"><span class="muted" title="这笔大单发生的位置：站不站得住中期均线，决定它是加仓还是接盘">位置</span>` +
          `<span>20日线 ${c.ma20} <b class="${c.aboveMa20 ? 'up' : 'down'}">${c.aboveMa20 ? '上方' : '下方'}</b></span>` +
          (c.ma60 ? `<span>60日线 ${c.ma60} <b class="${c.aboveMa60 ? 'up' : 'down'}">${c.aboveMa60 ? '上方' : '下方'}</b></span>` : '') +
          (c.r20 != null ? `<span>近20日 <b class="${c.r20 >= 0 ? 'up' : 'down'}">${c.r20 > 0 ? '+' : ''}${c.r20}%</b></span>` : '') +
          (c.dd60 != null ? `<span class="muted">距60日高 -${c.dd60}%</span>` : '') +
          `<span class="muted">综合分 ${x.bmScore == null ? '-' : x.bmScore}</span></div>` : '';
        return `<div class="rvc">
          <div class="rvc-h"><b class="up">${x.mainPct}%</b><span>${x.name}</span><span class="muted">${x.code}</span>${x.sector ? `<span class="tag">${x.sector}</span>` : ''}${heatTag}${kindTag}${riskTag}${capTag}${start}</div>
          ${posRow}
          <div class="prob-wrap"><span class="muted">当日封板概率预测</span><div class="prob-bar"><i style="width:${p}%;background:${pc}"></i></div><b style="color:${pc}">${p}%</b><span class="muted">距涨停还有 ${x.gapToLimit == null ? '-' : x.gapToLimit} 个点</span></div>
          <div class="rvc-g"><span>现价 ${x.price} <b class="${cls(x.pct)}">${sign(x.pct)}%</b></span><span>主力净额 <b class="up">${fmtY(x.mainInflow)}</b>（当日累计）</span><span class="muted">净占比=主力净流入/成交额，越高说明大资金越集中</span></div>
          ${balanceRow(x)}
        </div>`;
      }).join('') || '<div class="muted">暂无大单显著流入个股（${_pn.bigmoney}）</div>';
    }
    // jp 轮：涨幅异动池渲染（按已触发/临近分组，默认展开、显示全部返回项）
    if (s.abMove) {
      const _am = s.abMove || {};
      const all = (_am.items || []);
      const topItems = all.filter(x => x.status === 'top');
      const nearItems = all.filter(x => x.status !== 'top');
      const total = _am.total != null ? _am.total : all.length;
      document.getElementById('amInfo').textContent = (_am.note || '近 3 个交易日累计涨幅：主板≥16% 临近 / ≥20% 顶异动；创业板/科创板≥24% 临近 / ≥30% 顶异动；北交所≥32% 临近 / ≥40% 顶异动')
        + ` · 已触发 ${topItems.length} / 临近 ${nearItems.length} / 命中 ${total} 只`;
      const amCard = x => {
        const isTop = x.status === 'top';
        const need = isTop ? 0 : +(x.threshold - x.gain).toFixed(2);
        const statusTag = isTop
          ? `<span class="tag" style="background:#fff5f5;color:#c92a2a;cursor:help" title="近3日累计涨幅已达到交易所异常波动披露阈值">🔴 顶异动</span>`
          : `<span class="tag" style="background:#fff9db;color:#e67700;cursor:help" title="近3日累计涨幅达到披露阈值的80%，即将触发异常波动">🟠 临近异动</span>`;
        const needTxt = isTop ? '' : `<span class="muted">再涨 ${need}% 触顶</span>`;
        return `<div class="rvc">
          <div class="rvc-h"><b class="${cls(x.gain)}">${sign(x.gain)}${x.gain}%</b><span>${x.name}</span><span class="muted">${x.code}</span>${x.sector ? `<span class="tag">${x.sector}</span>` : ''}${statusTag}</div>
          <div class="rvc-g"><span>现价 ${x.price} <b class="${cls(x.pct)}">${sign(x.pct)}%</b></span><span>阈值 ${x.threshold}%</span>${needTxt}</div>
        </div>`;
      };
      document.getElementById('amTopCnt').textContent = topItems.length;
      document.getElementById('amNearCnt').textContent = nearItems.length;
      document.getElementById('amTopBox').innerHTML = topItems.length ? topItems.map(amCard).join('') : '<div class="muted" style="padding:8px">暂已达异常波动披露阈值的个股</div>';
      document.getElementById('amNearBox').innerHTML = nearItems.length ? nearItems.map(amCard).join('') : '<div class="muted" style="padding:8px">暂无临近异常波动阈值的个股</div>';
    }
    // 评分榜：复盘同款卡片式文字格式（信息分组展示，无需横向滚动表格）
    // 选股逻辑标签说明（悬浮可见每条路径的判定规则）
    const PATH_DESC = {
      '温和连阳': '获利盘≥70% 且近5日≥3天上涨',
      '高换手': '两日换手均值排名≤300 且获利盘≥70%',
      '涨停基因': '获利盘≥85% 且90日内≥2次涨停',
      '碎阳向上': '近8日≥5根小阳(0~5%)、累计2~15%、无单日>6%脉冲、站上5日线',
      '低位启动': '距95日低点<20%、近3日累计>4%、今日量≥昨日1.5倍、站上5日线',
      '横盘放量': '前10日振幅<25% 且今日量≥前5日均量1.6倍',
      '主力吸筹': '近3日主力+大单净额为正且涨幅温和(<6%)，价平钱进',
      'MACD水上金叉': 'MACD(12,26,9) DIF上穿DEA 且均在零轴上方',
      '周线金叉': '周线MA5上穿MA10',
      '筹码峰<11%': '获利筹码比例<11%，低位筹码密集、抛压小',
      '大单流入': '当日主力净占比超过门槛且涨幅0~7%未涨停'
    };
    // ⛔ 基准日标注（2026-10-06）：形态三池的 price/pct 取自 K 线最后一根，K 线回填没跟上时
    //    那是【上一交易日收盘】，而同屏的精选池/涨停池/持仓用的是实时行情 → 同一只票一屏两个价；
    //    精选池的评分/获利筹码/八字四维同样由 K 线算，拉新失败时会退回最多 8 天前的缓存。
    //    与推送文案里的 basisLine 同源（同一份 S.xxxBasis 对象），口径必须一致。
    //    ⚠️ 必须定义在使用点之前（const 有 TDZ，写在后面会在精选池那一行 ReferenceError）。
    const basisTxt = b => {
      if (!b || !b.day) return '';
      const d = String(b.day).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
      if (b.expect && b.day !== b.expect) return ` · ⏰基准日 ${d} 收盘（今日K线未回填，非实时价）`;
      if (b.expect && b.totalN > 0 && b.freshN < b.totalN * 0.9) return ` · ⏰基准日 ${d}（已回填 ${b.freshN}/${b.totalN}）`;
      return ` · 基准日 ${d}`;
    };
    // 「够了」的尺子（di 轮）：入池只要 5 根，而完整评分与学习样本要 45 根 ——
    //    同一把「评分线」量的是两把尺子，这一行必须让用户看得见，否则短数据票
    //    分数天然偏低，用户只会以为它「真的差」。
    const nr = s.needRule || {};
    const wr = s.winRule || {};
    // 「最近 N 日」的窗口：名义 N 日，实际按手里有几根 K 线算（dj 轮）——
    //    数据不足时窗口会短，每只票上都已标注实际窗口，这一行说明口径。
    const winTxt = wr.zt90 ? ` · 涨停窗口按实际K线（名义${wr.zt90.n}日）` : '';
    const needTxt = (nr.pool && nr.backtest)
      ? ` · 入池≥${nr.pool.n}根K线（完整评分/学习样本需≥${nr.backtest.n}根）` : '';
    document.getElementById('poolInfo').textContent = `池内 ${s.poolSize} 只 · ${_pn.pool} · 概率推送线 ${(s.probThreshold * 100).toFixed(0)}%` + basisTxt(s.poolBasis) + needTxt + winTxt +
      // ig 轮 #263 声明层：评分是**技术面综合分**（0-100），不是涨停概率、也没按实盘胜率校准过——
      // 不说清楚，用户会把 75 分当成 75% 概率（if/ig 轮 EV 实测：全场费后为负，分数高≠买了赚）
      ' · 评分=技术面综合分（非概率·未经胜率校准；概率以推送线/模型概率为准）';
    document.getElementById('pool').innerHTML = (s.pool || []).map(x => {
      const c = x.score >= 70 ? 's-h' : x.score >= 50 ? 's-m' : 's-l';
      const pTag = x.focused ? '<span class="tag" style="background:#d3f9d8;color:#2b8a3e">聚焦</span>' : '';
      // ⛔ 评分「数据不足」必须看得见（di 轮）：同一个 62 分，可能是全项算过的 62，
      //    也可能只算过 4 个分项 —— 后者会被同一条评分线判死，面板上却看不出原因。
      const snTag = x.scoreNote ? `<span class="tag" style="background:#fff4e6;color:#a15c00;cursor:help" title="${String(x.scoreNote).replace(/"/g, '&quot;')}">⚠评分未满项</span>` : '';
      // 每条路径显示「命中原因（本次真实数据）」，悬浮显示「判定规则」
      const pStr = (x.paths || []).map(p => {
        const rule = String(PATH_DESC[p] || '').replace(/"/g, '');
        const why = (x.pathWhy || {})[p] || rule;
        return `<span class="tag" style="cursor:help" title="判定规则：${rule}">${p} · ${why}</span>`;
      }).join(' ') || '<span class="muted">-</span>';
      const f3 = x.fund3dSum == null ? '-' : `<b class="${x.fund3dSum > 0 ? 'up' : 'down'}">${sign(x.fund3dSum)}万</b>`;
      // ⛔ 资金留存的窗口是隐式的（名义 10 分钟，实际跨度随轨迹长度变化）：
      //    刚启动时可能只覆盖几秒，+500 万在 30 秒窗口里与在 10 分钟窗口里是完全不同的强度。
      //    后端已把实际窗口算进 retainTxt，这里直接用整句，不再只用裸数字。
      const retain = (x.retainTxt != null && x.retainTxt !== '') ? `<b class="${x.retain > 0 ? 'up' : x.retain < 0 ? 'down' : ''}">${x.retainTxt}</b>` : (x.retain == null ? '-' : `<b class="${x.retain > 0 ? 'up' : x.retain < 0 ? 'down' : ''}">${x.retain > 0 ? '+' : ''}${x.retain}万</b>`);
      const lv = x.levels;
      const lvlRow = lv ? `<span>压力 <span class="muted">${lv.r1}/${lv.r2}</span></span><span>止损 <b class="down">${lv.stop}</b></span><span>止盈 <b class="up">${lv.t1}→${lv.t2}</b>${lv.rr != null ? ` <span class="muted">1:${lv.rr}</span>` : ''}</span>` : '<span class="muted">暂无点位数据</span>';
      const adv = lv && lv.advice && lv.advice.length ? lv.advice.map(a => `<div><b class="${a.type === '止损' ? 'down' : a.type === '减仓' ? '' : 'up'}">${a.type}</b> <span class="muted">${a.text}</span></div>`).join('') : '';
      // ── 八字选股（趋势/资金/位置/承接）2026-10-02 新增 ──
      // 面板上必须看得见四个维度各自的分数与理由，而不是只报一个总分让人盲信。
      // 悬停（title）可看每一维的判据原文，鼠标一点就知道"为什么这么判"。
      let bzRow = '';
      if (x.bazi && x.baziDims) {
        const d = x.baziDims, w = x.baziWhy || {};
        const dimSpan = (nm, v, why) => `<span style="cursor:help" title="${(why || '').replace(/"/g, '&quot;')}">${nm} <b class="${v >= 60 ? 'up' : v < 45 ? 'down' : ''}">${v == null ? '-' : v}</b></span>`;
        const verdictColor = x.bazi.verdict === '可介入' ? 'up' : x.bazi.verdict === '回避' ? 'down' : '';
        bzRow = `<div class="rvc-g" style="border-top:1px dashed #e9ecef;padding-top:4px;margin-top:2px">
          <span style="cursor:help" title="八字选股总分（趋势30%+资金30%+位置20%+承接20%）"><b>八字 ${x.bazi.total}</b></span>
          ${dimSpan('趋势', d.trend, w.trend)}${dimSpan('资金', d.fund, w.fund)}${dimSpan('位置', d.position, w.position)}${dimSpan('承接', d.support, w.support)}
          <span style="cursor:help" title="${(x.bazi.advise || '').replace(/"/g, '&quot;')}"><span class="tag">${x.bazi.stage}</span> <b class="${verdictColor}">${x.bazi.verdict}</b></span>
        </div>`;
      } else if (x.baziMiss) {
        // ⛔ 八字**判不出来**必须显示出来（见服务端 baziUnknown）：留白会被当成"八字没问题"，
        //    而真相是这只票压根没经过「高位加速 / 破位整理」这一票否决（多为次新股，K线不足25根）。
        bzRow = `<div class="rvc-g" style="border-top:1px dashed #e9ecef;padding-top:4px;margin-top:2px">
          <span class="tag" style="background:#fff4e6;color:#a15c00" title="${(x.baziMiss || '').replace(/"/g, '&quot;')}">八字未判定</span>
          <span class="muted">${x.baziMiss || ''} —— 未经「高位加速/破位整理」否决</span>
        </div>`;
      }
      return `<div class="rvc sm"${x.bad ? ' style="background:#fff5f5"' : x.focused ? ' style="background:#fffdf0"' : ''}>
        <div class="rvc-h"><span class="score ${c}" title="技术面综合评分（0-100）：非涨停概率、未经胜率校准${x.scoreNote ? ' · ' + String(x.scoreNote).replace(/"/g, '&quot;') : ''}">${x.score == null ? '-' : x.score}</span>${snTag}<b class="kl-link" onclick="openKline('${x.code}')" title="点开看K线：算法信号/模拟盘成交/做T/锁仓/量能/大单资金/洗盘出货判定">${x.name}</b><span class="muted">${x.code}</span>${pTag}${x.bad ? '<span class="tag" style="background:#ffe3e3;color:#c92a2a">⚠️利空</span>' : ''}</div>
        ${bzRow}
        <div class="rvc-g"><span>现价 ${x.price} <b class="${cls(x.pct)}">${sign(x.pct)}%</b></span><span>多日净流入 ${f3}</span><span>资金留存 ${retain}</span><span>获利盘 ${x.profitRatio == null ? '-' : x.profitRatio + '%'}</span><span>${x.zt90Txt || '90日'}涨停 ${x.zt90}次</span></div>
        ${x.chipVol ? `<div class="rvc-g" style="color:#8a6d3b" title="筹码峰 + 十日量能：与量化选股/竞价共振/盘中强势/洗盘池同一把尺子（筹码 站上密集峰顶+2·上方≤5%压力峰-2；量能 bad-4/warn-2），已计入上方综合评分">🧱📊 ${String(x.chipVol).replace(/</g, '&lt;')}</div>` : (x.chipVolMiss ? `<div class="rvc-g"><span class="muted" style="cursor:help" title="${String(x.chipVolMiss).replace(/"/g, '&quot;')}">🧱📊 筹码/量能未作结论（样本不足，不加分也不扣分）</span></div>` : '')}
        <div class="rvc-g">${lvlRow}</div>
        <div class="rvc-g">${pStr}</div>
        ${adv ? `<div class="rvc-g">${adv}</div>` : ''}
      </div>`;
    }).join('') || `<div class="muted">精选池暂无达标标的（${_pn.pool}）</div>`;
    // 外围市场
    if (s.global && s.global.length) {
      const mood = s.mood ? s.mood : null;
      document.getElementById('global').innerHTML =
        s.global.map(g => `<div style="margin-bottom:6px"><span class="tag">${g.name} <b class="${cls(g.pct)}">${sign(g.pct)}%</b> <span class="muted">${g.price}</span></span>` +
          (g.up && g.sectors && g.sectors.length ? `<span class="muted"> ↳ 受益板块: ` + g.sectors.map(x => `<span class="tag" style="margin:1px 2px">${x.name} <b class="${cls(x.pct)}">${sign(x.pct)}%</b></span>`).join('') + `</span>` : ``) + `</div>`).join('') +
        (mood ? `<div style="margin-top:8px">情绪研判：<b>${mood.mood}</b> <span class="muted">(美股均值${sign(mood.usAvg)}%，港股均值${sign(mood.cnAvg)}%)</span><br>
        <span>全市场主力净流入：${mood.mktFlow == null ? '<span class="muted">数据暂缺</span>' : `<b class="${mood.mktFlow > 0 ? 'up' : 'down'}">${(mood.mktFlow > 0 ? '+' : '') + mood.mktFlow + '亿'}</b> · ${mood.mktFlow > 0 ? '✅' : '⚠️'}`} ${mood.note || ''}</span></div>` : '');
    }
    // 外部数据源（北向/商品/两融；外围/板块见上方卡片，由 em/lhbMapCached 已接）
    renderExternal(s.external);
    function renderExternal(ex) {
      const box = document.getElementById('external');
      if (!box) return;
      if (!ex || !ex.items) { box.innerHTML = '<span class="muted">外部数据源未就绪</span>'; return; }
      const it = ex.items; let h = '';
      // ⛔ 数据健康度：出网断时显「出网疑似断开」而非「没数据」
      //   判定口径：北向/南向/商品/财报是实测可达源（hb 轮已验证两端 HTTP 200）——若它们同一 tick 全失败，
      //   高概率是出网断了（不是真没数据，mergeExt 会保留上次有效值，恢复后 60s 自动刷新）。
      //   两融/解禁等属「上游报表未注册」的诚实降级，绝不能误报成出网断。
      const REACH = ['north', 'south', 'commodities', 'financials'];
      const fail = ex.fail || {};
      const reachFailed = REACH.filter(k => fail[k]);
      const allDown = reachFailed.length === REACH.length;
      const isRegErr = msg => /报表未注册|报表配置不存在|未注册/.test(msg || '');
      const errText = msg => isRegErr(msg) ? '上游未开放（诚实降级）'
        : (allDown ? '拉取失败（出网疑似断开）' : '本次拉取失败（稍后自动重试）');
      if (allDown) h += '<div style="margin:4px 0 8px;padding:6px 8px;border-radius:6px;background:#fff5f5;color:#c92a2a;border:1px solid #ffc9c9">⚠️ <b>出网疑似断开</b>：北向/南向/商品/财报本次均拉取失败。这<b>不是「没有数据」</b>——网络恢复后每 60 秒自动刷新；下方为最近一次成功获取的值（若有）。</div>';
      else if (reachFailed.length) h += '<div style="margin:4px 0 8px;padding:6px 8px;border-radius:6px;background:#fff9db;color:#e67700;border:1px solid #ffe066">⚠️ 部分外部源暂不可用（' + reachFailed.join('、') + '），其余正常。</div>';
      const yi = v => (v == null ? '-' : (v / 1e8).toFixed(2) + '亿');
      const n = it.north;
      if (n) {
        if (n.error) h += '<div style="margin:4px 0"><b>🇭🇰 北向资金</b> <span class="muted">' + errText(n.error) + '</span></div>';
        else { const cell = (b, lbl) => b ? (lbl + ' <b class="' + (b.dayNet >= 0 ? 'up' : 'down') + '">' + (b.dayNet >= 0 ? '+' : '') + yi(b.dayNet) + '</b> <span class="muted">月' + yi(b.monthNet) + '</span>') : '';
          const parts = [cell(n.sh, '沪股通'), cell(n.sz, '深股通')].filter(Boolean);
          h += '<div style="margin:4px 0"><b>🇭🇰 北向资金</b><br>' + (parts.join(' · ') || '数据缺失') + ' <span class="muted">' + (n.date || '') + '</span></div>'; }
      }
      const so = it.south;
      if (so) {
        if (so.error) h += '<div style="margin:4px 0"><b>🇭🇰 南向资金</b> <span class="muted">' + errText(so.error) + '</span></div>';
        else h += '<div style="margin:4px 0"><b>🇭🇰 南向资金（港股通）</b> <b class="' + (so.dayNet >= 0 ? 'up' : 'down') + '">' + (so.dayNet >= 0 ? '+' : '') + yi(so.dayNet) + '</b> <span class="muted">月' + yi(so.monthNet) + ' · ' + (so.date || '') + '</span></div>';
      }
      const c = it.commodities;
      if (c) {
        if (c.error) h += '<div style="margin:4px 0"><b>🪙 商品</b> <span class="muted">' + errText(c.error) + '</span></div>';
        else { const one = (x, lbl) => x ? '<span class="tag">' + lbl + ' <b class="' + cls(x.pct) + '">' + sign(x.pct) + '%</b> <span class="muted">' + x.price + '</span></span>' : '';
          h += '<div style="margin:4px 0"><b>🪙 商品（纽约）</b><br>' + one(c.gold, '黄金') + ' ' + one(c.oil, '原油') + ' ' + one(c.silver, '白银') + '</div>'; }
      }
      const m = it.margin;
      if (m) {
        if (m.error) h += '<div style="margin:4px 0"><b>💰 两融余额</b> <span class="muted">' + errText(m.error) + '</span></div>';
        else h += '<div style="margin:4px 0"><b>💰 两融余额</b> <span class="tag">融资 <b>' + (m.rzBalance / 1e8).toFixed(0) + '亿</b></span> <span class="tag">融券 <b>' + (m.rqBalance / 1e8).toFixed(0) + '亿</b></span> <span class="muted">' + (m.date || '') + '</span></div>';
      }
      const f = it.financials;
      if (f) {
        if (f.error) h += '<div style="margin:4px 0"><b>📊 财报季（业绩预告）</b> <span class="muted">' + errText(f.error) + '</span></div>';
        else {
          const top = (f.top || []).map(x => x.name + '<b class="' + (x.sjltz >= 0 ? 'up' : 'down') + '">' + (x.sjltz >= 0 ? '+' : '') + (x.sjltz == null ? '-' : x.sjltz.toFixed(0) + '%') + '</b>').join('、');
          h += '<div style="margin:4px 0"><b>📊 财报季（业绩预告）</b> <span class="tag">A股' + (f.total || 0) + '家</span> <span class="tag" style="background:#e6fcf5;color:#0c8599">高增&gt;50% ' + (f.highGrow || 0) + '</span> <span class="tag" style="background:#fff0f6;color:#a61e4d">预忧&lt;0 ' + (f.lowGrow || 0) + '</span> <span class="muted">' + (f.updated || '') + '</span></div>';
          if (top) h += '<div class="muted" style="margin:2px 0 0 18px">净利润同比居前：' + top + '</div>';
        }
      }
      h += '<div class="muted" style="font-size:11px;margin-top:4px">更新 ' + (ex.time || '-') + ' · 外围/板块见上方卡片 · 解禁/增减持/调研/舆情/汇率本网络源未注册→诚实降级</div>';
      box.innerHTML = h || '<span class="muted">暂无外部数据</span>';
    }
    // 涨停预选
    if (s.preselect && s.preselect.items) {
      document.getElementById('psTime').textContent = `更新于 ${s.preselect.time} · 情绪: ${s.mood ? s.mood.mood : '-'}`;
      document.getElementById('preselect').innerHTML = '<tr><th>涨停概率</th><th>股票</th><th>现价</th><th>涨跌</th><th>获利筹码</th><th>预选理由</th></tr>' +
        s.preselect.items.map(x => `<tr><td><b class="${x.prob >= 60 ? 'up' : ''}">${x.prob}%</b></td><td>${x.name} <span class="muted">${x.code}</span></td><td>${x.price}</td><td class="${cls(x.pct)}">${sign(x.pct)}%</td><td>${x.profitRatio == null ? '-' : x.profitRatio + '%'}</td><td class="muted">${x.reason}</td></tr>`).join('');
    }
    // 趋势票池
    if (s.trendPool) {
      const _rj = s.trendRej || {};
      const _vCount = s.trendPool.filter(x => x.channel === 'V反').length;
      document.getElementById('tpInfo').textContent = `共 ${cutN(s, 'trendPool', s.trendPool.length)} 只${poolCut(cutN(s, 'trendPool', s.trendPool.length), cutShown(s, 'trendPool', s.trendPool.length))} · 流通市值>50亿 · 已剔除上蹿下跳 · 含V反放量起涨 ${_vCount} 只 · 按趋势强度排`
        + ((_rj.cap || _rj.jumpy) ? `（拦下：市值<50亿 ${_rj.cap || 0} 只、上蹿下跳 ${_rj.jumpy || 0} 只）` : '');
      document.getElementById('trendPool').innerHTML = (s.trendPool.length ? s.trendPool.map(x => {
        // 与精选池同款卡片结构，尺寸压缩一档；首格用模型涨停概率替代评分
        const pc = (x.prob || 0) >= 70 ? 's-h' : (x.prob || 0) >= 50 ? 's-m' : 's-l';
        const hot = (x.prob || 0) >= 60;
        // 东财限流时用同花顺主动净买顶上，只有两者都没有才显示"资金流限流中"
        const f3 = x.fund3dSum == null
          ? (x.thsNetAmt != null ? `<b class="${x.thsNetAmt > 0 ? 'up' : 'down'}">${sign(Math.round(x.thsNetAmt / 1e4))}万</b>` : '<span class="muted">资金流限流中</span>')
          : `<b class="${x.fund3dSum > 0 ? 'up' : 'down'}">${sign(x.fund3dSum)}万</b>`;
        const fundLabel = x.fund3dSum != null ? '3日主线' : (x.thsNetAmt != null ? '主动净买' : '3日主线');
        const sec = x.sector && x.sector !== '未知' ? `<span class="tag">${x.sector}</span>` : '';
        // 连续小阳线拉升：每天一点点往上抬，回撤小、趋势真 —— 用户点名要多看这类，单独打标
        const yangTag = x.steadyRun
          ? `<span class="tag" style="background:#e6fcf5;color:#0c8599;cursor:help" title="近8日${x.yang8}根小阳、累计${sign(x.sum8)}%、最长连涨${x.runMax}天。不靠一根大阳拉起来，是每天一点点往上抬">📶 连涨${x.runMax}天</span>`
          : (x.smallYang ? `<span class="tag" style="background:#f8f9fa;color:#0c8599;cursor:help" title="近8日${x.yang8}根小阳、累计${sign(x.sum8)}%">📶 小阳为主</span>` : '');
        const vfanTag = x.channel === 'V反'
          ? `<span class="tag" style="background:#fff9db;color:#e67700;cursor:help" title="低位放量长阳/V型起涨：今日+${x.todayPct != null ? x.todayPct : '?'}%，成交量${x.volRatio != null ? x.volRatio + '倍' : '突增'}于前5日均量">🚀 V反</span>`
          : '';
        return `<div class="rvc sm">
          <div class="rvc-h"><span class="score ${pc}" title="模型涨停概率">${x.prob == null ? '-' : x.prob + '%'}</span><b>${x.name}</b><span class="muted">${x.code}</span>${sec}${yangTag}${vfanTag}${hot ? '<span class="tag" style="background:#fff0f6;color:#a61e4d">⚡可能涨停</span>' : ''}</div>
          <div class="rvc-g"><span>现价 ${x.price} <b class="${cls(x.pct)}">${sign(x.pct)}%</b></span><span>5日线 ${x.ma5}</span><span>乖离 <b class="${x.dev >= 0 ? 'up' : 'down'}">${sign(x.dev)}%</b></span><span>${fundLabel} ${f3}</span><span>距涨停 ${x.gapToLimit == null ? '-' : x.gapToLimit + '%'}</span></div>
          <div class="rvc-g">${(x.flags || []).map(f => `<span class="tag">${f}</span>`).join('')}</div>
          <div class="rvc-g muted">选股逻辑: ${x.why || (x.flags || []).join('、')}</div>
        </div>`;
      }).join('') : '<div class="muted">暂无符合条件的趋势票（盘中检测到资金流入会自动纳入）</div>');
      // 系统自己全市场扫出来的「连续小阳线拉升」（用户要求：你自己也都多看看）
      const syBox = document.getElementById('smallyangBox');
      if (syBox) {
        const sy = s.smallyang || null;
        if (sy && (sy.items || []).length) {
          document.getElementById('syInfo').textContent =
            `全市场扫出真连涨 ${sy.total} 只，剔除小市值(<50亿)与上蹿下跳后剩 ${cutN(s, 'smallyang', sy.kept)} 只${poolCut(cutN(s, 'smallyang', sy.kept), cutShown(s, 'smallyang', (sy.items || []).length))} · ${sy.time}`;
          syBox.innerHTML = sy.items.map(x => {
            const inPool = x.inTrend ? '<span class="tag" style="background:#ebfbee;color:#2b8a3e">已在趋势池</span>' : '';
            return `<div class="rvc sm">
              <div class="rvc-h"><span class="tag" style="background:#e6fcf5;color:#0c8599">📶 连涨${x.runMax}天</span><b>${x.name}</b><span class="muted">${x.code}</span>${x.sector && x.sector !== '未知' ? `<span class="tag">${x.sector}</span>` : ''}${inPool}</div>
              <div class="rvc-g"><span>现价 ${x.price} <b class="${cls(x.pct)}">${sign(x.pct)}%</b></span><span>近8日 <b class="${cls(x.sum8)}">${sign(x.sum8)}%</b>（${x.yang8}根小阳）</span><span>流通市值 <b>${x.capYi == null ? '-' : (x.capYi >= 1000 ? (x.capYi / 1000).toFixed(1) + '千亿' : x.capYi + '亿')}</b></span><span>日均振幅 ${x.amp20 == null ? '-' : x.amp20 + '%'}</span><span class="muted">距60日高 -${x.dd60}%</span></div>
            </div>`;
          }).join('');
        } else {
          document.getElementById('syInfo').textContent = '暂无（需K线数据，盘中自动扫描）';
          syBox.innerHTML = '<div class="muted">当前没有既满足连续小阳、又通过市值与波动体检的票</div>';
        }
      }
      // ── 涨停前形态（2026-10-01 新增面板）──
      const zpBox = document.getElementById('ztPreBox');
      if (zpBox) {
        const zp = s.ztPre || [];
        if (zp.length) {
          const p0 = zp[0] || {};
          // ⛔ 2026-10-07 补（本轮角度：只在 happy path 上定义过的状态）：
          //    扫描进度过去只有"成功"这一种状态 —— 失败/跳过时不更新任何字段，
          //    于是这里照样显示"全市场扫 5500 只"，看着像刚跑完，实际是上一次的数字。
          //    现在后端三个出口都写 ok/error，跑没跑成必须让面板说得出来。
          const zpg = s.ztPreProg || {};
          const zpWarn = zpg.ok === false
            ? ` ⚠️ 本轮未跑成(${zpg.error || '未知原因'})，以下为上次结果`
            : '';
          document.getElementById('zpInfo').textContent =
            `全市场扫 ${zpg.scanned || 0} 只 → 有效 ${poolN(s, 'ztpre', zpg.total || 0)} 只${poolCut(poolN(s, 'ztpre', zpg.total || 0), poolShown(s, 'ztpre', (s.ztPre || []).length))} · 次日封板基准 ${p0.base != null ? p0.base + '%' : '—'}${zpWarn}` + basisTxt(s.ztPreBasis);
          // 把机器挖出来的规律直接摆在面板上：只给结论不给依据 = 用户没法判断该不该信
          const zpr = document.getElementById('zpRules');
          if (zpr) {
            const rs = s.ztPreRules || [];
            // ⛔⛔ hv+1 轮：jsdom 模糊测试实测（_forensic_render2.js）—— rs 里的元素
            //    是空对象 {} 时，下面 fmt 的 r.key.charAt(0) 直接抛
            //    「Cannot read properties of undefined (reading 'charAt')」整页中断。
            //    缺 key 的规律条目 = 「这条不完整」，判不出就不渲染（⛔ 不猜内容补默认值）。
            const fmt = r => `${r.key.charAt(0) === 'P' ? '组合' : '单维'} <b>${r.name}=${r.bin}</b> 历史${r.n}例 → 次日封板 <b>${r.rate}%</b>`;
            zpr.innerHTML = rs.length
              ? '📚 机器学到的规律（全A回测）：<br>' + rs.filter(r => r && r.key).map(r => '· ' + fmt(r)).join('<br>')
              : '';
          }
          zpBox.innerHTML = zp.slice(0, 12).map(x => `
            <div class="rvc sm">
              <div class="rvc-h"><span class="tag" style="background:#fff0f6;color:#c2255c">🎯 封板${x.ztP}%</span><b>${x.name}</b><span class="muted">${x.code}</span>${x.sector && x.sector !== '未知' ? `<span class="tag">${x.sector}${x.secZT ? `·${x.secZT}只涨停` : ''}</span>` : ''}${x.brk ? '<span class="tag" style="background:#fff9db">刚突破20日高</span>' : ''}${x.cons ? '<span class="tag">平台整理中</span>' : ''}</div>
              <div class="rvc-g"><span>现价 ${x.price} <b class="${cls(x.pct)}">${sign(x.pct)}%</b></span><span>较基准 <b class="${cls(x.lift)}">${sign(x.lift)}pp</b></span><span>连涨 ${x.run}天</span><span>5日 <b class="${cls(x.sum5)}">${sign(x.sum5)}%</b></span><span>量能 ${x.volR}倍</span><span class="muted">振幅 ${x.amp}%</span></div>
              <div class="rvc-x">${(x.feat || []).slice(0, 4).join(' · ')}</div>
              ${x.why ? `<div class="rvc-x muted">📚 ${x.why}</div>` : ''}
            </div>`).join('');
        } else {
          zpBox.innerHTML = '<div class="muted">模型还没扫（启动约 10 分钟后自动跑一次全市场扫描）</div>';
        }
      }
      // ── 全市场趋势扫描 ──
      const tsBox = document.getElementById('trendScanBox');
      if (tsBox) {
        const ts = s.trendScan || [];
        if (ts.length) {
          // ⛔ 2026-10-07 补：与上面的「涨停前形态」区块对齐 —— 那一块显示了 ztPreProg 的扫描进度，
          //    这一块却没接 trendScanProg（后端一直有发），同样是全市场扫描，一个显示一个不显示。
          //    s.learnall 以前后端压根没下发，所以样本数恒为 0，看着像"模型没学"。
          const _tsp = s.trendScanProg || {};
          // ⛔ 同上：本轮没跑成时必须看得出来，别拿上一次的数字冒充"刚扫完"
          const _tsWarn = _tsp.ok === false
            ? ` ⚠️ 本轮未跑成(${_tsp.error || '未知原因'})，以下为上次结果`
            : '';
          document.getElementById('tsInfo').textContent = `学习库 ${(s.learnall && s.learnall.n) || 0} 条样本 · 全市场扫 ${_tsp.scanned || 0} 只 → 有效 ${poolN(s, 'trendScan', _tsp.total || 0)} 只${poolCut(poolN(s, 'trendScan', _tsp.total || 0), poolShown(s, 'trendScan', (s.trendScan || []).length))} · 按相对基准溢价排序${_tsWarn}` + basisTxt(s.trendScanBasis);
          tsBox.innerHTML = ts.slice(0, 12).map(x => `
            <div class="rvc sm">
              <div class="rvc-h"><span class="tag" style="background:#e7f5ff;color:#1971c2" title="相对全市场基准的封板概率溢价，单位是百分点（pp），不是百分比">溢价${sign(x.lift)}pp</span><b>${x.name}</b><span class="muted">${x.code}</span></div>
              <div class="rvc-g"><span>现价 ${x.price} <b class="${cls(x.pct)}">${sign(x.pct)}%</b></span><span>封板 ${x.ztP}%</span><span class="muted">基准 ${x.baseZt}%</span><span>连涨 ${x.runUp}天</span><span class="muted">60日${x.zt60}板</span></div>
              <div class="rvc-x">${x.why || ''}</div>
            </div>`).join('');
        } else {
          tsBox.innerHTML = '<div class="muted">尚未扫描（盘中不跑，收盘后与启动约 10 分钟后各跑一次）</div>';
        }
      }
      // ── 连续收涨 ──
      const suBox = document.getElementById('steadyUpBox');
      if (suBox) {
        const su = s.steadyUp || [];
        if (su.length) {
          document.getElementById('suInfo').textContent = `全市场扫出 ${poolN(s, 'steadyUp', su.length)} 只符合条件的连续收涨${poolCut(poolN(s, 'steadyUp', su.length), poolShown(s, 'steadyUp', su.length))}` + basisTxt(s.steadyUpBasis);
          suBox.innerHTML = su.slice(0, 12).map(x => `
            <div class="rvc sm">
              <div class="rvc-h"><span class="tag" style="background:#e6fcf5;color:#0c8599">连涨${x.run}天</span><b>${x.name}</b><span class="muted">${x.code}</span>${x.sector && x.sector !== '未知' ? `<span class="tag">${x.sector}</span>` : ''}</div>
              <div class="rvc-g"><span>现价 ${x.price} <b class="${cls(x.pct)}">${sign(x.pct)}%</b></span><span>累计 <b class="${cls(x.cum)}">${sign(x.cum)}%</b></span><span>20日线 ${x.ma20}</span><span class="muted">${x.why || ''}</span></div>
            </div>`).join('');
        } else {
          suBox.innerHTML = '<div class="muted">当前没有满足「连涨≥3天 + 站上向上的20日线」的票</div>';
        }
      }
    }
    // 市场主线
    if (s.mainline && s.mainline.items) {
      document.getElementById('mlTime').textContent = `更新于 ${s.mainline.time} · 按涨停家数×2+连板高度排序`;
      document.getElementById('mainline').innerHTML = s.mainline.items.map((g, i) => {
        const rank = ['🥇','🥈','🥉','4️⃣','5️⃣'][i] || '';
        const stockStr = (g.stocks || []).slice(0, 4).map(x => `${x.name}(${x.lb}板)`).join('、');
        return `<div style="flex:1;min-width:220px;border:1px solid #e0e0e0;border-radius:8px;padding:10px;background:${i === 0 ? '#fffbe6' : '#fafafa'}">
          <div style="font-weight:600">${rank} ${g.sector} <span class="muted">涨停${g.count}家 · 最高${g.maxLb}板 · 连板总高${g.lbSum}</span></div>
          <div style="margin-top:4px" class="muted">${stockStr}${g.inflow != null ? ` · 主力净流入${(g.inflow / 1e8).toFixed(1)}亿` : ''}</div>
        </div>`;
      }).join('');
    }
    // 外围联动
    if (s.extLink) {
      document.getElementById('extTime').textContent = `更新于 ${s.extLink.time} · 外盘基准(三大指数均值) ${sign(s.extLink.basePct)}%`;
      document.getElementById('extGroups').innerHTML = (s.extLink.groups || []).map(g =>
        `<span class="tag" style="margin-right:6px">${g.name} ${sign(g.extPct)}% <span class="muted">超额${sign(g.strength)}% → ${(g.sectors || []).slice(0, 2).map(x => x.name + sign(x.pct) + '%').join('、') || '无匹配板块'}</span></span>`
      ).join('');
      document.getElementById('extPicks').innerHTML = '<tr><th>联动板块</th><th>股票</th><th>现价</th><th>涨跌</th><th>换手</th></tr>' +
        (s.extLink.picks || []).map(x => `<tr><td class="muted">${x.group} · ${x.sector}</td><td>${x.name} <span class="muted">${x.code}</span></td><td>${x.price}</td><td class="${cls(x.pct)}">${sign(x.pct)}%</td><td>${x.turnover == null ? '-' : x.turnover + '%'}</td></tr>`).join('');
    }
    // 机器学习校准
    if (s.learn) {
      const L = s.learn;
      // 日等权 + 大盘beta：让用户能看出「是不是大盘拖累」而不是模型失灵
      const B = L.base || {};
      const raw = L.samples ? Math.round(L.hits / L.samples * 100) : 0;
      const tb = L.todayBeta;
      const betaTag = (tb == null) ? '' :
        ` · 今日大盘 <b class="${tb >= 0 ? 'up' : 'down'}">${tb > 0 ? '+' : ''}${tb}%</b>` +
        (tb < -1 ? ' <span class="tag">普跌日·已免罚</span>' : '');
      document.getElementById('learnState').innerHTML = `累计信号 ${L.samples} 个 · 命中 ${L.hits} 个（样本口径 ${raw}%）` +
        (B.days ? ` · <b>跨${B.days}日等权基准 ${B.dayRate}%</b>` : '') + betaTag;
      // ★ 三口径拆开：让用户一眼看出「我看到的命中率到底是哪一种」
      // （以前回测样本和实盘样本混算，43.5% 这个数既不反映回测也不反映实盘，是安慰剂）
      const SP = L.split;
      document.getElementById('learnSplit').innerHTML = SP ? (
        `<div class="splitrow"><span class="tag ${(SP.live && SP.live.rate >= 45) ? 'up' : 'down'}">实盘预测 ${SP.live ? SP.live.rate : '-'}%</span>` +
        `<span class="muted">${SP.live ? SP.live.n : 0} 样本 / 命中 ${SP.live ? SP.live.h : 0}</span>` +
        `<span class="mut2">盘中预判后推送的那一批，真正代表能不能抓到</span></div>` +
        `<div class="splitrow"><span class="tag">历史回测 ${SP.backtest ? SP.backtest.rate : '-'}%</span>` +
        `<span class="muted">${SP.backtest ? SP.backtest.n : 0} 样本</span>` +
        `<span class="mut2">已知当天涨停往回倒推，天然偏高，不参与上表命中率</span></div>` +
        `<div class="splitrow"><span class="tag">已涨停后登记 ${SP.posthoc ? SP.posthoc.rate : '-'}%</span>` +
        `<span class="muted">${SP.posthoc ? SP.posthoc.n : 0} 样本</span>` +
        `<span class="mut2">封板后才录入，物理上没空间，已剔除出分母</span></div>`
      ) : '';
      // ★ A/B 对照实验：模型组🅰️（按模型概率排序推送） vs 实证组🅱️（按实测命中率排序推送）
      //   两组独立登记独立回验，B 组样本积累起来后直接对比 rate —— 「概率越高命中越低」真伪自证
      const AB = L.groups;
      document.getElementById('learnAB').innerHTML = (AB && AB.A) ? (
        `<div class="splitrow"><span class="tag ${!AB.B || AB.A.rate >= AB.B.rate ? 'up' : 'down'}">🅰️模型组 ${AB.A.rate}%</span>` +
        `<span class="muted">${AB.A.n} 样本 / 命中 ${AB.A.h}</span>` +
        `<span class="mut2">按模型概率排序推送的实盘样本</span></div>` +
        `<div class="splitrow"><span class="tag ${AB.B && AB.B.rate > AB.A.rate ? 'up' : 'down'}">🅱️实证组 ${AB.B ? AB.B.rate : 0}%</span>` +
        `<span class="muted">${AB.B ? AB.B.n : 0} 样本 / 命中 ${AB.B ? AB.B.h : 0}</span>` +
        `<span class="mut2">${!AB.B || AB.B.n < 10 ? '样本积累中（大单推送·按实测命中率排序）' : '按实测命中率排序推送 — 若持续高于模型组，说明「概率越高命中越低」是真的'}</span></div>`
      ) : '';
      document.getElementById('learnBody').textContent = L.samples
        ? `命中定义：信号次日最高涨幅≥3%。【日等权】= 每天各算一次再平均，防止某天灌爆样本淹没历史；【beta中性化】= 剔除当天大盘涨跌的影响，只看选股本身。` +
          `所有校准需覆盖 ≥${L.minLearnDays || 5} 个交易日才会生效 —— 少于这个数一律不动，避免拿单日行情错杀条件。`
        : '暂无样本：盘中每推送一次信号即累积一个样本，次日自动回验。';
      document.getElementById('learnTable').innerHTML = '<tr><th>概率档</th><th>样本</th><th>交易日</th><th>命中</th><th>实际命中率</th><th>修正系数</th></tr>' +
        Object.entries(L.buckets || {}).map(([b, v]) => `<tr><td>${b}%</td><td>${v.n}</td><td class="${(v.days || 1) >= (L.minLearnDays || 5) ? '' : 'down'}">${v.days || 1}</td><td>${v.hit}</td><td class="${v.rate >= 70 ? 'up' : 'down'}">${v.rate}%</td>` +
          (v.locked ? `<td class="muted" title="${v.locked}">1.00 🔒</td>` : `<td>${v.corr}</td>`) + `</tr>`).join('') +
        (function(){
          const _pkd = s.probKind || {};
          if (!_pkd.note) return '';
          const _n = _pkd.sampleN || {};
          const _ks = (_pkd.kinds || []).map(k => k.type + '=' + k.label).join('、');
          return `<tr><td colspan="6" class="muted" style="white-space:normal" title="${(_pkd.kinds||[]).map(k=>k.why).join(' ')}">分档口径：${_pkd.note}。当前样本 概率 ${_n.prob||0} 条 / 评分 ${_n.score||0} 条${_ks ? '（' + _ks + '）' : ''}</td></tr>`;
        })() +
        // ⛔ dv 轮：命中率的分母必须看得见 —— 实测样本库 1959 条只有 368 条进得了档，
        //    另外 1591 条（回测 600／缺次日口径 737／缺概率 242…）被静默跳过。
        //    不说出来，用户会把「证据不足」误读成「样本还没积累够」，从而干等。
        (function(){
          const _es = s.empSkip || {};
          if (!_es.scanned) return '';
          const _top = (_es.by || []).slice(0, 4).map(x => `${x.label} ${x.n}`).join('、');
          return `<tr><td colspan="6" class="muted" style="white-space:normal">样本存活：${_es.note || ''}${_top ? '　排除：' + _top : ''}（排除项按设计不参与实测标定，不是数据丢失）</td></tr>`;
        })() +
        (function(){
          const _sk = s.skipStat || {};
          if (!_sk.total) return '';
          const _top = (_sk.top || []).slice(0, 5).map(x => `${x.label} ${x.n}`).join('、');
          return `<tr><td colspan="6" class="muted" style="white-space:normal">跳过台账：累计 ${_sk.total} 次${_top ? '　' + _top : ''}（被判据正常排除的计数，非报错）</td></tr>`;
        })();
      const pe = Object.entries(L.paths || {}).sort((a, b) => b[1].n - a[1].n);
      document.getElementById('learnPaths').innerHTML = '<tr><th>选股条件</th><th>样本</th><th>交易日</th><th>命中率</th><th>判定</th><th>评分修正</th></tr>' +
        (pe.length ? pe.map(([pp, v]) => `<tr><td>${pp}</td><td>${v.n}</td><td class="${(v.days || 1) >= (L.minLearnDays || 5) ? '' : 'down'}">${v.days || 1}</td><td class="${v.rate >= 50 ? 'up' : 'down'}">${v.rate}%</td><td>${v.verdict}</td><td class="${v.adj > 0 ? 'up' : v.adj < 0 ? 'down' : 'muted'}">${v.adj > 0 ? '+' : ''}${v.adj}分</td></tr>`).join('') : `<tr><td colspan="6" class="muted">样本积累中：需覆盖≥${L.minLearnDays || 5}个交易日才会加权/降权</td></tr>`);
      // 自主改善留档
      const hist = s.learnHistory || [];
      document.getElementById('learnHistCount').textContent = hist.length ? `共 ${hist.length} 次自动修正留档` : '条件样本≥8且命中率偏离50%时自动触发修正并在此留档';
      document.getElementById('learnHist').innerHTML = '<tr><th>时间</th><th>类型</th><th>改善项</th><th>改善内容</th></tr>' +
        (hist.length ? hist.map(h => `<tr><td class="muted" style="white-space:nowrap">${h.date} ${h.time || ''}</td><td><span class="tag">${h.kind || '条件修正'}</span></td><td style="white-space:nowrap"><b>${h.item || ''}</b>${h.n != null ? ` <span class="muted">${h.n}样本/${h.rate}%</span>` : ''}</td><td style="white-space:normal;min-width:320px">${h.note || h.verdict || ''}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">暂无修正记录：系统会在条件命中率偏离后自动修正并留档</td></tr>');
    }
    // ══ 接力策略两张卡：一进二 / 连板接力（2026-10-08 用户要求独立成卡）══
    //    ⛔ 两张卡都必须体现【板块联动】：这里展示的是**归并后的主线强度**，
    //       不是那个被拆成「电池/电池技术/储能概念/锂电池概念」多个名字的孤立板块。
    {
      const _roleTag = r => r === 'leader' ? '🟥龙头' : r === 'deputy' ? '🟧龙二' : r === 'mid' ? '🟨中军' : '跟风';
      const _money = v => (v || 0) >= 1e8 ? ((v || 0) / 1e8).toFixed(1) + '亿' : Math.round((v || 0) / 1e4) + '万';
      // 板块联动一行：主线 + 强度 + 同主线涨停家数 + 最高板 + 梯队完整度
      const _link = ss => {
        if (!ss) return '';
        const g = ss.grade === '强' ? 'up' : (ss.grade === '弱' ? 'down' : '');
        const tier = (ss.roleScore >= 20) ? '梯队完整' : (ss.roleScore >= 12) ? '有龙二' : '缺龙二';
        return `<div class="muted" style="white-space:normal;margin-top:3px">🔥 板块联动：<b class="${g}">${ss.theme || '-'} ${ss.score}分·${ss.grade}</b> · 同主线涨停 ${ss.sectorZT} 只 · 最高 ${ss.maxLb} 板 · ${tier}</div>`;
      };
      const _relayCard = x => {
        const ss = x.sectorStrength;
        const lbTxt = x.level ? `<span class="tag">${x.level}进${x.level + 1}</span>` : '';
        const probTxt = (x.fused != null ? x.fused : x.prob);
        // ge 轮：被主流板块闸门留下的票，打「主流板块」蓝徽标，把"有依据"写在脸上
        const _mlTag = x.mainline ? `<span class="tag" style="background:#e7f5ff;color:#1971c2;font-weight:600">主流板块</span>` : '';
        return `<div class="rvc">
          <div class="rvc-h"><b>${probTxt}%</b><span class="kl-link" onclick="openKline('${x.code}')" title="点开看K线：算法信号/模拟盘成交/做T/锁仓/量能/大单资金/洗盘出货判定">${x.name}</span><span class="muted">${x.code}</span>
            <span class="tag">${_roleTag(x.role)}</span>${_mlTag}${lbTxt}${x.sector ? `<span class="tag">${x.sector}</span>` : ''}</div>
          <div class="rvc-g"><span>现价 <b>${x.price}</b></span><span>封板 <b>${Math.round(Math.min(x.sealRatio || 0, 1.5) * 100)}%</b></span><span>开板 <b>${x.breakCount || 0}次</b></span><span>换手 <b>${(x.turnover || 0).toFixed(1)}%</b></span></div>
          <div class="rvc-g"><span>封单 <b>${_money(x.sealAmount)}</b></span><span>流通 <b>${(x.floatCap || 0) >= 1e8 ? ((x.floatCap || 0) / 1e8).toFixed(1) + '亿' : Math.round((x.floatCap || 0) / 1e4) + '万'}</b></span><span>主力 <b class="${(x.mainInflow || 0) > 0 ? 'up' : ''}">${_money(x.mainInflow)}</b></span></div>
          ${_link(ss)}
          ${x.why ? `<div class="muted" style="white-space:normal;margin-top:3px">📌 ${x.why}</div>` : ''}
        </div>`;
      };
      const yeArr = s.yierList || [];
      const lbArr = s.lianbanList || [];
      // ⛔ gb 轮：这两张卡按用户要求「保持到次日 9:20 前」—— 昨天收盘算的候选，今天开盘前还要看得见。
      //    既然允许跨日，**就必须把"这是哪天算的"写在脸上**，否则就变成拿昨天的冒充今天的。
      const _ofDay = v => (String(v || '').length === 8 ? String(v).slice(4, 6) + '-' + String(v).slice(6, 8) : '');
      const _yeOf = _ofDay(s.yierAsOf), _lbOf = _ofDay(s.lianbanAsOf);
      const yeEl = document.getElementById('yierList');
      const lbEl = document.getElementById('lianbanList');
      if (yeEl) yeEl.innerHTML = yeArr.length
        ? `<div class="rvgrid">${yeArr.map(_relayCard).join('')}</div>`
        : `<div class="muted" style="padding:10px">暂无候选 —— 收盘后 15:30 自动扫描并推手机；也可点右上 🔄 立即扫描（纯计算，秒级）</div>`;
      if (lbEl) lbEl.innerHTML = lbArr.length
        ? `<div class="rvgrid">${lbArr.map(_relayCard).join('')}</div>`
        : `<div class="muted" style="padding:10px">暂无候选 —— 需要有 2 板/3 板票在板上；三进四仅在最高板≥7 板（情绪高涨期）才参与</div>`;
      const yeT = document.getElementById('yeTime');
      if (yeT) yeT.textContent = yeArr.length
        ? `${_yeOf ? _yeOf + ' 收盘算出 · ' : ''}${yeArr.length} 只候选 · 仅主流板块入选 · 按融合概率排序`
        : '暂无候选';
      const lbT = document.getElementById('lbTime');
      if (lbT) lbT.textContent = lbArr.length
        ? `${_lbOf ? _lbOf + ' 收盘算出 · ' : ''}${lbArr.length} 只候选 · 仅主流板块入选 · 板块联动已计入`
        : '暂无候选';
      const yeI = document.getElementById('yeInfo');
      if (yeI) yeI.innerHTML = yeArr.length ? `<span class="tag">首板 ${yeArr.length} 只入选</span><span class="muted">融合概率 = 模型分 × 实测校准</span>` : '';
      const lbI = document.getElementById('lbInfo');
      if (lbI) lbI.innerHTML = lbArr.length ? `<span class="tag">连板 ${lbArr.length} 只入选</span><span class="muted">越往上越吃板块联动</span>` : '';
    }
    // ══ 次日作战计划：明天买谁 / 多少钱进 / 跌到哪算错 / 次日怎么验证 ══
    {
      const np = s.nextplan || {};
      const pk = (np.plan && np.plan.picked) || [];
      const npEl = document.getElementById('nextplan');
      const npInfo = document.getElementById('npInfo');
      // ⛔ 这份计划是给【下一交易日】用的，光写"更新于 21:00"看不出是哪天生成的、更看不出给哪天用。
      //    两个日期都要摆出来（与推送标题、正文首行同一口径）。
      const _npAd = np.applyDate || (np.plan && np.plan.applyDate) || '';
      const _npGd = (np.date || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2-$3');
      document.getElementById('npTime').textContent = np.time
        ? `${_npAd ? '适用于 ' + _npAd + ' · ' : '适用于下一交易日 · '}${_npGd ? '生成于 ' + _npGd + ' ' : ''}${staleTime(s, 'nextplan', np.time)} · 候选${poolN(s, 'nextplan', np.cand || 0)}只 / K线充足${np.universeN || 0}只 / 入围${(np.plan && np.plan.count) || 0}只`
        : '尚未生成 · 点右上🔄重算（收盘后自动推送手机）';
      if (npInfo) npInfo.innerHTML = np.missKline
        ? `<span class="tag">缺K线被跳过 <b>${np.missKline}</b> 只</span><span class="muted">补齐后会自动纳入</span>`
        : '';
      // 涨停接力：今日封板的票被纪律项扣 14 分，主推 55 分门槛下基本全灭，
      // 所以单列一段（45 分）—— 用户问的就是"涨停的票明天能干吗"，不能让他一个都看不到。
      const relayHtml = (np.relay || []).length
        ? `<div style="margin-top:10px"><b style="color:#e67700">⚡ 涨停接力（高风险 · 只在你能盯盘时做）</b>
           <div class="muted" style="margin:2px 0 6px">以下今日已封板，纪律分已扣；不是推荐追板，是把接力的前置条件摆清楚</div><div class="rvgrid">` +
          np.relay.map(x => {
            const lb = x.limitUpCount > 1 ? `<b class="up">${x.limitUpCount}连板</b>` : '首板';
            const seal = x.sealAmount ? `封单 ${(x.sealAmount / 1e8).toFixed(1)}亿` : '';
            return `<div class="rvc">
              <div class="rvc-h"><b>${x.score}分</b><span>${x.name}</span><span class="muted">${x.code}</span><span class="tag">${lb}</span>${seal ? `<span class="tag">${seal}</span>` : ''}${x.sector ? `<span class="tag">${x.sector}</span>` : ''}</div>
              <div class="rvc-g"><span>现价 <b>${x.price}</b></span><span>进场 <b>${x.entry ? x.entry[0] + '~' + x.entry[1] : '-'}</b></span><span>止损 <b class="down">${x.stop}</b></span><span>目标 <b class="up">${x.target}</b></span></div>
              ${x.reason ? `<div class="muted" style="white-space:normal;margin-top:4px">依据: ${x.reason}</div>` : ''}
              ${x.risk ? `<div style="white-space:normal;margin-top:4px;color:#e67700">⚠️ ${x.risk}</div>` : ''}
              ${(x.confirm || []).map(c => `<div class="muted" style="white-space:normal">✔ 做不到就别碰: ${c}</div>`).join('')}
            </div>`;
          }).join('') + `</div></div>`
        : '';
      // ⛔ hv+1 轮（用户原话「卡片那么多留空的铺满」）：计划还没生成时不再只有一行小字+820px 大白片。
      //    把「明天要评估谁」用今天的真数据摆出来（今日涨停池就是 nextplan 的候选来源），
      //    外加评分口径与市场环境 —— 全部取自 state 现有字段，⛔ 不预演打分、不造假分数。
      const _npPreview = () => {
        const _zt = s.ztPool || [];
        const _first = _zt.filter(x => (x.limitUpCount || 1) === 1).length;
        const _lb = _zt.length - _first;
        const _maxLb = _zt.length ? Math.max(..._zt.map(x => x.limitUpCount || 1)) : 0;
        const _mood = s.mood || {};
        const _ml = ((s.mainline && s.mainline.items) || []).slice(0, 3);
        const _rows = _zt.slice().sort((a, b) => (b.sealAmount || 0) - (a.sealAmount || 0)).slice(0, 5).map(x =>
          `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px">· <b>${esc(x.name)}</b><span class="muted"> ${esc(x.code)}</span> ${x.limitUpCount > 1 ? `<b class="up">${x.limitUpCount}连板</b>` : '首板'} · 封单 ${fmtY(x.sealAmount)} · 开板${x.breakCount || 0}次${x.sector ? ' · ' + esc(x.sector) : ''}</div>`).join('');
        return `<div style="padding:4px 2px">
          <div style="margin-bottom:6px"><b>📋 明日作战计划 · 生成前预览</b></div>
          <div class="muted" style="white-space:normal;line-height:1.7;margin-bottom:8px">
            口径：收盘后 <b>15:45</b> 自动算并推到手机（也可点右上 🔄 立即重算，需补拉K线约20-40秒）。<br>
            门槛：五维综合评分（板块/资金/量比/技术/纪律）<b>≥55 分</b>才上榜 —— 达不到就空仓，不凑数。</div>
          <div style="margin-bottom:4px"><b>🎯 明天要评估的候选池</b><span class="muted">（= 今日涨停池 ${_zt.length} 只：首板 ${_first} / 连板 ${_lb}${_maxLb ? `，最高 ${_maxLb} 板` : ''}；下面按封单取前5 —— <b>只是评估范围，不是推荐</b>，55分门槛下多数会被刷掉）</span></div>
          <div style="line-height:1.9;margin-bottom:8px">${_rows || '<span class="muted">今日涨停池为空（休市或数据未就绪）</span>'}</div>
          <div style="font-size:12px;white-space:normal;line-height:1.7"><b>🌡️ 当前市场环境</b><span class="muted">（明日计划的环境输入）：${_mood.mood ? `情绪<b>${esc(_mood.mood)}</b>` : '情绪数据未就绪'}${_mood.upN != null ? ` · 涨${_mood.upN}/跌${_mood.downN}` : ''}${_mood.ztN != null ? ` · 涨停${_mood.ztN}/跌停${_mood.dtN || 0}` : ''}${_mood.avgPct != null ? ` · 均幅<span class="${cls(_mood.avgPct)}">${sign(_mood.avgPct)}%</span>` : ''}${_ml.length ? ` · 主线 ${_ml.map(g => esc(g.sector) + '(' + g.count + '板)').join('、')}` : ''}</span></div>
        </div>`;
      };
      if (!pk.length) {
        npEl.innerHTML = `<div class="muted" style="padding:10px">${np.plan ? '今日没有一只达到 55 分门槛 —— 宁可空仓，也不凑数。' : '尚未生成。收盘后 15:45 自动算并推到手机；也可点右上 🔄 立即重算（要补拉K线，约20-40秒）。'}</div>` + (np.plan ? '' : _npPreview()) + relayHtml;
      } else {
        npEl.innerHTML = `<div class="rvgrid">` + pk.map(x => {
          const gc = x.score >= 75 ? 'up' : x.score >= 60 ? 'up' : '';
          const d = x.dims || {};
          const li = arr => (arr || []).slice(0, 3).map(t => `<div>· ${t}</div>`).join('') || '<div class="muted">—</div>';
          return `<div class="rvc">
            <div class="rvc-h"><b class="${gc}">${x.score}分</b><span>${x.name}</span><span class="muted">${x.code}</span><span class="tag">${x.grade}</span>${x.sector ? `<span class="tag">${x.sector}</span>` : ''}${x.from ? `<span class="tag">来自${x.from}</span>` : ''}</div>
            <div class="rvc-g"><span>现价 <b>${x.price}</b></span><span>进场 <b>${x.entry ? x.entry[0] + '~' + x.entry[1] : '-'}</b></span><span>止损 <b class="down">${x.stop}</b></span><span>目标 <b class="up">${x.target}</b></span></div>
            <div class="rvc-g"><span class="muted">分项 板${d.板块 || 0} 资${d.资金 || 0} 量${d.量比 || 0} 技${d.技术 || 0} 纪${d.纪律 || 0}</span><span class="muted">量比 ${x.volumeRatio == null ? '-' : x.volumeRatio}（${x.volumeVerdict || '-'}）</span></div>
            <div style="white-space:normal;margin-top:4px"><b>为什么选它</b>${li(x.reasons)}</div>
            <div style="white-space:normal;margin-top:4px"><b class="down">什么情况算我错了</b>${li(x.invalid)}</div>
            <div style="white-space:normal;margin-top:4px"><b>次日怎么验证</b>${li(x.confirm)}</div>
            ${(x.risks || []).length ? `<div style="white-space:normal;margin-top:4px"><b style="color:#e67700">风险</b>${li(x.risks)}</div>` : ''}
            ${(x.rules || []).length ? `<div class="muted" style="white-space:normal;margin-top:4px">${(x.rules || []).slice(0, 2).map(t => '· ' + t).join(' ')}</div>` : ''}
          </div>`;
        }).join('') + `</div>` + relayHtml;
      }
    }
    // ══ 我的十四条：逐条判定，命中/未命中/缺数据三态分明 ══
    {
      const mr = s.myrules || {};
      const passed = mr.items || [];
      const list = passed.length ? passed : (mr.all || []).slice(0, 8);
      document.getElementById('mrTime').textContent = mr.time
        ? `${staleTime(s, 'myrules', mr.time)} · 扫描 ${mr.scanned || 0} 只 · 符合体系 ${poolN(s, 'myrules', mr.count || 0)} 只`
        : '尚未扫描 · 盘中每6分钟自动扫（或点右上 🔄 立即扫）';
      const el = document.getElementById('myrules');
      const info = document.getElementById('mrInfo');
      if (info) info.innerHTML = (mr.count || 0) === 0 && mr.scanned
        ? '<span class="tag">本次无人全部符合</span><span class="muted">下面列出最接近的（按命中条数排序）</span>'
        : '';
      if (!list.length) {
        el.innerHTML = `<div class="muted" style="padding:10px">${mr.scanned ? '暂无结果' : '尚未扫描。候选来自涨停池/补涨龙/大单池/趋势池，盘中每6分钟自动扫描；也可点标题右侧 🔄 立即扫。'}</div>`;
      } else {
        el.innerHTML = list.map(x => {
          const rowsHtml = (x.items || []).map(t => {
            const mark = t.unknown ? '<span class="muted">？</span>' : (t.ok ? '<b class="up">✔</b>' : '<span class="down">✘</span>');
            const cls = t.unknown ? 'muted' : (t.ok ? '' : 'muted');
            return `<div class="${cls}" style="white-space:normal">${mark} [${t.i}] ${t.name}：${t.note}</div>`;
          }).join('');
          return `<div class="rvc">
            <div class="rvc-h"><b class="${x.pass ? 'up' : ''}">${x.hits}/${x.known}</b><span>${x.name}</span><span class="muted">${x.code}</span><span class="tag">${x.pass ? '✅符合体系' : '未达标'}</span>${x.unknown ? `<span class="tag">${x.unknown}条缺数据</span>` : ''}</div>
            ${(x.excluded || []).length ? `<div class="down" style="white-space:normal">⛔ ${x.excluded.join('；')}</div>` : ''}
            <div style="white-space:normal;margin-top:2px">${rowsHtml}</div>
          </div>`;
        }).join('');
      }
    }
    // 复盘
    if (s.review) {
      const it = s.review.items || [];
      // ⛔ 复盘是落盘的（review.json），重启读回来可能是上一个交易日的 —— 日期必须显示出来，
      //    否则「更新于 15:41:30」看着像刚刚算的，其实是昨天的。
      const _rd = (s.review.date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$2-$3');
      const _pre = s.reviewStale === true
        ? '⚠️ ' + (_rd ? '非当日(' + _rd + ')' : '日期未知/可能非当日') + ' · '
        : (_rd ? _rd + ' ' : '');
      document.getElementById('rvTime').textContent = `${_pre}${staleTime(s, 'review', s.review.time)} · 共 ${it.length} 只涨停`;
      const cnt = k => it.filter(x => x[k]).length;
      // ⛔ fv 轮 redesign：summary 增加首板/连板/题材数，并显示原因来源（同花顺涨停原因）
      const firstBoards = it.filter(x => (x.limitUpCount || 1) === 1).length;
      const lianBans = it.length - firstBoards;
      const themeSet = new Set(it.map(x => x.sector).filter(Boolean));
      const _src = (s.review && s.review.themeSrc) || (it[0] && it[0].reasonSrc) || '';
      document.getElementById('rvSummary').innerHTML =
        `<span class="tag">涨停 <b>${it.length}</b> 只</span>` +
        `<span class="tag">首板 <b>${firstBoards}</b></span>` +
        `<span class="tag">连板 <b>${lianBans}</b></span>` +
        `<span class="tag">题材 <b>${themeSet.size}</b> 条</span>` +
        `<span class="tag">站5日线 <b>${cnt('aboveMa5')}</b></span>` +
        `<span class="tag">破前高 <b>${cnt('brokeHighHold')}</b></span>` +
        `<span class="tag">量价齐升 <b>${cnt('volPriceUp')}</b></span>` +
        (_src ? `<span class="tag src">原因来源:${_src}</span>` : '');
      // 筛选 + 分组切换（按题材分组是 fv 轮 redesign 的核心）
      document.getElementById('rvFilters').innerHTML = [
        ['theme', '按题材'], ['flat', '平铺'],
        ['top10', 'Top10'], ['all', `全部${it.length}`], ['p60', '概率≥60'], ['hard', '硬板0开'], ['seal', '极强封板']
      ].map(([k, t]) => {
        const n = k === 'all' ? it.length : k === 'p60' ? it.filter(x => x.prob >= 60).length : k === 'hard' ? it.filter(x => x.breakCount === 0).length : k === 'seal' ? it.filter(x => (x.sealRatio || 0) >= 0.6).length : '';
        const on = (k === 'theme' && window.rvGroup !== 'flat') || (k === 'flat' && window.rvGroup === 'flat') || (window.rvFilter === k && ['top10', 'all', 'p60', 'hard', 'seal'].includes(k));
        return `<span class="fbtn ${on ? 'on' : ''}" onclick="rvSetMode('${k}')">${t}${n !== '' ? '·' + n : ''}</span>`;
      }).join('');
      let view = it;
      const f = window.rvFilter || 'all';
      if (f === 'p60') view = it.filter(x => x.prob >= 60);
      else if (f === 'hard') view = it.filter(x => x.breakCount === 0);
      else if (f === 'seal') view = it.filter(x => (x.sealRatio || 0) >= 0.6);
      else if (f === 'top10') view = it.slice(0, 10);
      // ══ 复盘单卡：涨停原因（同花顺题材词）高亮置顶 ══
      const rvCard = x => {
        const sr = x.sealRatio == null ? null : Math.min(Math.round(x.sealRatio * 100), 150);
        const seal = sr == null ? '-' : (sr >= 60 ? `<b class="up">极强 ${sr}%</b>` : sr >= 30 ? `<b class="up">强 ${sr}%</b>` : sr >= 15 ? `<span style="color:#e67700">中 ${sr}%</span>` : `<span class="down">弱 ${sr}%</span>`) + (x.sealAmount ? ` <span class="muted">(${fmtY(x.sealAmount)})</span>` : '');
        const brk = x.breakCount == null ? '-' : (x.breakCount === 0 ? '<span style="color:#2b8a3e">0次·硬板</span>' : `<span style="color:#e67700">${x.breakCount}次</span>`);
        const amt = x.amount == null ? '-' : fmtY(x.amount);
        const fc = x.floatCap ? fmtY(x.floatCap) : '-';
        const mp = x.mainPct == null ? '-' : `<b class="${x.mainPct > 0 ? 'up' : 'down'}">${sign(x.mainPct)}%</b>`;
        const flag = (n, v) => v == null ? '' : `<span class="muted">${n} ${v ? '✅' : '—'}</span>`;
        // ⛔ fv 轮：涨停原因（同花顺详细题材词）高亮置顶，原因来源可追溯
        const themes = (x.themes && x.themes.length) ? x.themes.map(t => `<span class="th">${t}</span>`).join('') : (x.reasonRaw ? `<span class="th">${x.reasonRaw}</span>` : '<span class="muted">原因未取到</span>');
        const peers = (x.peers || []).map(p => {
          const o = typeof p === 'string' ? { n: p, lb: 0, role: 'follow' } : p;
          const pc = o.role === 'leader' ? 'r-leader' : o.role === 'deputy' ? 'r-deputy' : o.role === 'mid' ? 'r-mid' : 'r-follow';
          const ic = o.role === 'leader' ? '👑' : o.role === 'deputy' ? '🥈' : o.role === 'mid' ? '💰' : '';
          const lbTxt = o.lb > 1 ? `·${o.lb}板` : (o.strong ? '·⭐题材强' : '');
          return `<span class="rtag ${pc}">${ic}${o.n}${lbTxt}</span>`;
        }).join('') || '<span class="muted">无</span>';
        const ld = x.leader ? `<span class="muted">领涨: ${x.leader}${x.sectorInflow ? ' · 板块净流入' + fmtY(x.sectorInflow) : ''}</span>` : '';
        return `<div class="rvc">
          <div class="rvc-h"><b class="${x.prob >= 40 ? 'up' : ''}">${x.prob}%</b><span>${x.name}</span><span class="muted">${x.code}</span><span class="tag">${x.sector}</span><span class="tag ${x.limitUpCount > 1 ? 'hl' : ''}">${x.limitUpCount > 1 ? '<b>' + x.limitUpCount + '连板</b>' : '首板'}</span></div>
          <div class="rvc-reason">🔥 涨停原因：${themes}</div>
          <div class="rvc-g"><span>封板 ${seal}</span><span>开板 ${brk}</span><span>成交额 ${amt}</span><span>流通市值 ${fc}</span><span>主力 ${mp}</span>${x.turnover ? `<span class="muted">换手${x.turnover}%</span>` : ''}</div>
          <div class="rvc-g">${flag('5日线', x.aboveMa5)}${flag('破前高', x.brokeHighHold)}${flag('量价齐升', x.volPriceUp)}</div>
          <div class="rvc-g">${peers} ${ld}</div>
          <div class="muted" style="white-space:normal;margin-top:4px">${x.reason || ''}</div>
        </div>`;
      };
      // 按题材分组（默认）或平铺
      const grouped = window.rvGroup !== 'flat';
      let html;
      if (grouped && view.length) {
        const groups = {};
        for (const x of view) { const k = x.sector || '其他题材'; (groups[k] = groups[k] || []).push(x); }
        const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
        html = keys.map(k => {
          const arr = groups[k].slice().sort((a, b) => b.prob - a.prob);
          const _th = (arr[0].themes && arr[0].themes.length) ? arr[0].themes.slice(0, 4).join(' · ') : '';
          return `<div class="rvgrp"><div class="rvgrp-h">🔥 ${k} <b>${arr.length}</b>只${_th ? ` <span class="muted">· ${_th}</span>` : ''}</div><div class="rvgrid">${arr.map(rvCard).join('')}</div></div>`;
        }).join('');
      } else {
        html = `<div class="rvgrid">${view.map(rvCard).join('')}</div>`;
      }
      document.getElementById('review').innerHTML = html;
    } else {
      document.getElementById('rvTime').textContent = '复盘生成中 · 点右上🔄强制拉取最近交易日';
      document.getElementById('review').innerHTML = '<div class="muted" style="padding:10px">正在拉取涨停池与K线（约1-2分钟），完成后自动显示；也可点标题右侧 🔄 强制刷新</div>';
    }
    // 补涨龙·大数据回测推算（推算原因写在每只候选后面）
    if (s.buzhang && s.buzhang.items) {
      document.getElementById('bzTime').textContent = `${staleTime(s, 'buzhang', s.buzhang.time)} · ${_pn.buzhang}`;
    document.getElementById('bzTime').title = _pn.gate;
      document.getElementById('buzhang').innerHTML = s.buzhang.items.length ?
        `<div class="rvgrid">` + s.buzhang.items.map(x =>
          `<div class="rvc">
            <div class="rvc-h"><b class="${x.prob >= 75 ? 'up' : ''}">${x.prob}%</b><span>${x.name}</span><span class="muted">${x.code}</span><span class="tag">${x.sector}</span></div>
            <div class="rvc-g"><span>现价 ${x.price}</span><span class="${cls(x.pct)}">${sign(x.pct)}%</span><span>主力净流入 ${x.mainInflow == null ? '待确认' : fmtY(x.mainInflow)}</span></div>
            <div style="white-space:normal;margin-top:5px;font-size:12px">推算原因: <b class="up">${x.reason || '龙头连板扩散+板块效应'}</b></div>
            <div class="muted" style="white-space:normal;margin-top:3px">龙头: ${x.leaderName}${x.leaderLb}板 · 板块${x.secZT}只涨停</div>
          </div>`).join('') + '</div>'
        : '<span class="muted">暂无补涨候选（需板块龙头连板≥2 且同板存在低位滞涨股）</span>';
    }
    // 🌱 板块效应·启动前埋伏：热点板块里还没启动的票（每张卡都写清"凭什么说它可能起"）
    if (document.getElementById('preBox')) {
      const P = s.pre || {};
      document.getElementById('preTime').textContent = `${staleTime(s, 'pre', P.time)} · 热点板块内当日涨幅 -1.5%~+4% 且未涨停 · ${poolN(s, 'pre', (P.items || []).length)} 只`;
      document.getElementById('preBox').innerHTML = (P.items || []).length ?
        `<div class="rvgrid">` + P.items.map(x => {
          const pc = x.prob >= 70 ? '#c92a2a' : x.prob >= 55 ? '#e8590c' : '#868e96';
          const tg = [];
          if (x.volRatio >= 1.5) tg.push(`<span class="tag">量能${x.volRatio}倍</span>`);
          if (x.aboveMa5 === true) tg.push('<span class="tag">站上5日线</span>');
          if (x.amp != null && x.amp <= 25) tg.push(`<span class="tag">平台整理${x.amp}%</span>`);
          if (x.gapToHigh20 >= 5) tg.push(`<span class="tag">上方${x.gapToHigh20}%空间</span>`);
          return `<div class="rvc">
            <div class="rvc-h"><b style="color:${pc}">${x.prob}</b><span>${x.name}</span><span class="muted">${x.code}</span><span class="tag">${x.sector}${x.secZT ? ' ' + x.secZT + '板' : ''}</span>${tg.join('')}</div>
            <div class="rvc-g"><span>现价 ${x.price}</span><span class="${cls(x.pct)}">${sign(x.pct)}%</span><span>主力净占比 <b class="${cls(x.mainPct)}">${x.mainPct}%</b></span><span>净额 ${fmtY(x.mainInflow)}</span></div>
            <div style="white-space:normal;margin-top:5px;font-size:12px">埋伏依据: <b class="up">${x.reason || '-'}</b></div>
            <div class="muted" style="white-space:normal;margin-top:3px">注意：这是<b>尚未启动</b>的票，优点是成本低，代价是要等；不属于追涨。</div>
          </div>`;
        }).join('') + '</div>'
        : (function(){
          // ⛔ hv+1 轮（用户原话「卡片那么多留空的铺满」）：空态不再只有一行小字+大白片。
          //    埋伏扫描的「取数范围」（热点板块）是 state 里现成的（ztBySector/sectors）——
          //    摆出来用户才知道它在盯什么，也才分得清「空」是没票还是模块没跑。
          //    ⛔ 只摆后端真有的数据，不猜不造；外部文本一律 esc() 后再进 innerHTML。
          const _secMap = new Map((s.sectors || []).map(x => [x.name, x]));
          const _hot = (s.ztBySector || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 6);
          const _chips = _hot.map(g => {
            const sec = _secMap.get(g.sector);
            const lb = Math.max(0, ...((g.stocks || []).map(x => x.lb || 1)));
            const leader = (g.stocks || []).find(x => x.role === 'leader') || (g.stocks || [])[0] || {};
            return `<span class="tag" style="margin:2px 4px 2px 0;display:inline-block;white-space:normal">🔥 <b>${esc(g.sector)}</b> 涨停${g.count}家 · 最高${lb}板${leader.name ? ' · 龙头' + esc(leader.name) : ''}${sec ? ` · 板块<span class="${cls(sec.pct)}">${sign(sec.pct)}%</span> · 主力${fmtY(sec.mainInflow)}` : ''}</span>`;
          }).join('');
          return `<div style="padding:4px 2px">
            <div style="margin-bottom:6px"><b>📡 埋伏扫描正在盯的热点板块</b><span class="muted">（取数口径：板块内涨停≥2家，或仅1家但它是≥2连板/板块当日涨≥2%；盘中每12分钟重扫一次）</span></div>
            <div style="margin-bottom:8px;line-height:2">${_chips || '<span class="muted">今日暂无够热的话题（没有涨停扎堆的板块），监控范围本身是空的</span>'}</div>
            <div class="muted" style="white-space:normal;line-height:1.7">为什么一只都没有：<br>
            · 热点板块里的成员股<b>要么已经涨过</b>（当日涨幅超出 -1.5%~+4% 的埋伏区间）—— 那时进去就是追涨，系统宁可不埋；<br>
            · <b>要么还没动</b>（在等资金）—— 起爆第一时间会上榜并推手机；<br>
            · <b>要么形态/资金不够</b>（主力净占比、平台整理、站上5日线至少占一样）。<br>
            这是「空仓等机会」的正常状态，不是模块坏了；符合条件的票会自动出现。</div>
          </div>`;
        })();
    }
    // 模拟盘双账户
    // 只读（观看）身份：后端只回 {hidden:true}，这里显示一行说明而不是空白区块
    if (s.paper && s.paper.hidden) {
      try {
        const ei = document.getElementById('ppPoolInfo');
        if (ei) ei.textContent = '🔒 模拟盘账户属私密数据，只读（观看）权限不可查看';
        ['ppPoolSummary', 'ppPreSummary'].forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = ''; });
        ['ppPoolPos', 'ppPrePos'].forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = ''; });
      } catch (e) {}
    } else if (s.paper) {
      // ⛔ gd 轮：mirror（副本身份）交给 renderPaper 自己拼进账户摘要 ——
      //    以前它单独写 ppPoolInfo/ppPreInfo 那一行，紧接着 renderPaper 第一行又把同一行覆盖掉，等于没写。
      renderPaper('Pool', s.paper.pool, !!s.paper.mirror); renderPaper('Pre', s.paper.pre, !!s.paper.mirror);
    }
    // 每条消息的直接影响个股（新闻点名）+ 板块间接影响个股（涨红跌绿，中国股市惯例）
    const relHtml = x => {
      if (!x || !x.related) return '';
      const col = p => `color:${p.pct > 0 ? '#c92a2a' : p.pct < 0 ? '#2b8a3e' : '#495057'}`;
      const fmt = p => `<b style="${col(p)}">${p.name}(${p.code}) ${(+p.pct || 0) > 0 ? '+' : ''}${(+p.pct || 0).toFixed(1)}%</b>`;
      const d = (x.related.direct || []).map(fmt).join('、');
      const i = (x.related.indirect || []).map(fmt).join('、');
      return (d ? `<br><span style="font-size:12px">📌 直接影响: ${d}</span>` : '') +
             (i ? `<br><span style="font-size:12px">🔗 板块间接: <span class="muted">[${x.related.indirect[0].via}]</span> ${i}</span>` : '');
    };
    // 利空雷达
    if (s.badNews) {
      document.getElementById('bnTime').textContent = s.badNews.time ? `更新于 ${s.badNews.time} · 利空关联股 ${(s.badNews.codes || []).length} 只` : '加载中';
      document.getElementById('bnSectors').innerHTML = (s.badNews.sectors || []).map(x =>
        `<span class="tag" style="background:#ffe3e3;color:#c92a2a">⚠️ ${x.name}${x.pct != null ? ' ' + x.pct + '%' : ''} <span class="muted">${x.from}${x.mainInflow != null ? ' · 主力' + (x.mainInflow / 1e8).toFixed(1) + '亿' : ''}</span></span>`).join('') || '<span class="muted">暂无利空板块</span>';
      document.getElementById('bnList').innerHTML = (s.badNews.items || []).map(x =>
        `<div class="sig zt" style="font-size:12px"><span class="tag" style="background:#ffe3e3;color:#c92a2a">利空</span> <b>${(x.t || '').slice(5, 16)}</b> ${x.title}${(x.stocks || []).length ? '<br>关联个股: ' + x.stocks.join('、') : ''}<br><span class="muted">判定: ${x.why || ''}</span>${x.stat ? `<br><span style="font-size:12px;color:#c92a2a">📊 受累个股统计: ${x.stat.total}只 · 下跌${x.stat.down} · 上涨${x.stat.up} · 均幅${x.stat.avgPct}% · 主力净流出${fmtY(Math.abs(x.stat.mainSum))}${x.stat.mainSum > 0 ? '（反转为净流入）' : ''}</span>` : ''}${relHtml(x)}</div>`).join('') || '<div class="muted">近3日暂无利空快讯</div>';
    }
    // 利好消息近3日
    if (s.goodNews) {
      document.getElementById('gnTime').textContent = s.goodNews.time ? `更新于 ${s.goodNews.time} · 3日利好 ${(s.goodNews.items || []).length} 条` : '加载中';
      document.getElementById('gnHot').innerHTML =
        (s.goodNews.hotSectors || []).map(x => `<span class="tag">🔥 ${x.name} <b>${x.count}次</b></span>`).join(' ') +
        ((s.goodNews.hotStocks || []).length ? '<br>' + s.goodNews.hotStocks.map(x => `<span class="tag" style="background:#d3f9d8;color:#2b8a3e">${x.name || x.code} <b>${x.count}次</b></span>`).join(' ') : '');
      document.getElementById('gnList').innerHTML = (s.goodNews.items || []).map(x => {
        const tag = x.type === 'good' ? '<span class="tag" style="background:#d3f9d8;color:#2b8a3e">利好</span>' : '<span class="tag" style="background:#e9ecef;color:#495057">中性</span>';
        // 每条利好/中性消息后的关联个股实时统计分析
        const stat = x.stat ? `<br><span style="font-size:12px;color:#2b8a3e">📊 关联个股统计: ${x.stat.total}只 · 上涨${x.stat.up} · 涨停${x.stat.limit} · 均幅${x.stat.avgPct > 0 ? '+' : ''}${x.stat.avgPct}% · 主力净流入${fmtY(x.stat.mainSum)}</span>` : '';
        return `<div class="sig" style="font-size:12px">${tag} <b>${(x.t || '').slice(5, 16)}</b> ${x.title}${(x.stocks || []).length ? '<br>关联个股: ' + x.stocks.join('、') : ''}<br><span class="muted">判定: ${x.why || ''}</span>${stat}${relHtml(x)}</div>`;
      }).join('') || '<div class="muted">近3日暂无利好快讯</div>';
    }
    // wecom / mail
    document.getElementById('wecomState').textContent = s.wecomInvalid ? '❌ 飞书地址无效(应含 /open-apis/bot/v2/hook/)'
      : s.wecomReady ? ('✅ 飞书 ' + (s.feishuMask || '已配置')) : '⚠️ 飞书未配置(信号不会推送)';
    document.getElementById('wecomState').className = 'badge ' + (s.wecomReady ? 'ok' : '');
    document.getElementById('mailState').textContent = s.mailReady ? '邮箱已配置' : '邮箱未配置';
    document.getElementById('mailState').className = 'badge ' + (s.mailReady ? 'ok' : '');
    try { renderCfgSet(s); } catch (e) { console.error('[cfgSet]', e && e.message); }
    try { renderCfgRange(s); } catch (e) { console.error('[cfgRange]', e && e.message); }
    try { renderTaskState(s); } catch (e) { console.error('[taskState]', e && e.message); }
    // ⛔ hv+1 轮（用户原话「卡片那么多留空的铺满」）：两个月回测卡在用户点「运行回测」
    //    之前是一整片空白。回测口径是现成的知识，摆出来比留白有用；
    //    ⛔ 结果本就不落盘（每次点运行重新计算），刷新后变空是设计如此，
    //    所以只在 btResult 真为空时写占位，绝不拿旧结果冒充。
    try {
      const _btR = document.getElementById('btResult');
      if (_btR && !_btR.innerHTML.trim()) {
        _btR.innerHTML = `<div class="muted" style="white-space:normal;line-height:1.9;padding:4px 2px">
          <b>📐 回测口径</b>：逐日回放最近 <b>40 个交易日</b>的筛选逻辑，对每个评分段统计「次日涨停或涨5%」的概率。<br>
          <b>📈 怎么看</b>：评分段命中率就是概率模型的校准依据；高分段（≥70分）的样本胜率决定 &gt;80% 推送线是否站得住。<br>
          <b>⏱ 注意</b>：结果<b>不落盘</b>，每次点「运行回测」都重新计算（逐股回放，约20-40秒）；刷新页面后这里会重新变空。<br>
          <span class="mut2">统计参考，不构成投资建议。</span></div>`;
      }
    } catch (e) {}
    try { renderStaleState(s); } catch (e) { console.error('[staleState]', e && e.message); }
    // 2026-10-03：输入框不再被填成"(已保存)"——那三个字既看不出当前用的是哪个机器人，
    // 又容易被当成真地址一起提交。改成动态提示语 + 右上角状态徽标显示打码地址。
    try {
      const wh = document.getElementById('webhook');
      if (wh) {
        if (wh.value === '(已保存)') wh.value = '';
        wh.placeholder = s.wecomReady ? ('留空=保持 ' + (s.feishuMask || '现有通道') + '；粘贴新地址即更换') : '飞书机器人 Webhook（必填）';
      }
    } catch (e) {}
    if (document.getElementById('mailUser').value === '' && s.mailReady) { document.getElementById('mailUser').value = '(已保存)'; document.getElementById('mailAuth').value = '(已保存)'; }
    // 私密通道状态：没配就明说（不然用户以为已经私密了，结果金额还在群里裸奔）
    try {
      const ss = document.getElementById('secState');
      if (ss) {
        ss.textContent = s.feishuSecReady ? ('🔐 私密 ' + (s.feishuSecMask || '已配置')) : '私密通道未配置（验证码/持仓仍走主通道）';
        ss.className = 'badge ' + (s.feishuSecReady ? 'ok' : '');
      }
      const sw = document.getElementById('secWebhook');
      if (sw) sw.placeholder = s.feishuSecReady
        ? ('留空=保持 ' + (s.feishuSecMask || '现有私密通道') + '；粘贴新地址即更换')
        : '私密机器人 Webhook（可选·建议只有你本人）';
    } catch (e) {}
  } catch (e) { console.error(e); showRenderError(e, '面板渲染'); }
  for (const { el, top } of scrollKeep) { try { if (el && el.scrollHeight > el.clientHeight) el.scrollTop = top; } catch {} }
}

// 弱网/手机保护：上一次 refresh 还没回来就不再发第二次。
// 手机网络慢时一次请求可能要好几秒，若 5 秒一到就再发，请求会越堆越多 → 越用越卡。
// ⛔⛔ dy 轮：这把锁**必须有上限**。原来只有 `if (_rfBusy) return`，一旦某次请求既不抛错
//    也不返回（容器回收的半开连接 / 切网后的死连接），_rfBusy 永久为 true → 之后每 5 秒
//    的轮询全部被挡回 → 面板不再更新、红框永远摘不掉（用户看到的就是「一直显示
//    连续多轮没拉到数据」）。现在配 AbortController 12 秒超时 + 这里 25 秒兜底放行，
//    两层任何一层生效都能自愈；强制放行时如实记一次「上一轮没返回」，不静默跳过。
const _refreshCore = refresh;
let _rfBusy = false, _rfBusyAt = 0;
refresh = async function () {
  if (_rfBusy) {
    if (Date.now() - _rfBusyAt < STATE_BUSY_MAX_MS) return;
    stateFetchFail(new Error('上一轮请求超过 ' + Math.round(STATE_BUSY_MAX_MS / 1000) + ' 秒没有返回，已强制放行（否则轮询会永久卡死）'));
  }
  _rfBusy = true; _rfBusyAt = Date.now();
  try { await _refreshCore(); } finally { _rfBusy = false; }
};

// ── 手机"数据更新不及时"的根因与对策 ──────────────────────────────
// 微信内置浏览器 / iOS Safari 会把切到后台的页面整体冻结，setInterval 直接停摆。
// 回到前台时定时器才继续走，页面显示的还是你离开那一刻的旧数据，且要等满一个周期才更新。
// 对策：① 页面重新可见（visibilitychange / focus / pageshow）立刻拉一次；
//       ② 页面不可见时干脆不轮询，别在后台白耗电白耗流量。
function resumeNow() {
  countdown = 5;
  const cdEl = document.getElementById('cd');
  if (cdEl) cdEl.textContent = countdown;
  // ⛔ dy 轮：页面被冻结/后台待机很久之后切回来，之前攒下的失败计数与红框
  //    **已经不代表现在**（哪怕服务一直好好的，昨晚断网那三次也会让框挂到今天）。
  //    距上次发起拉取超过 30 秒才算「隔了一个时代」，清一次重新起算；
  //    紧接着 refresh() 会立刻重试，真故障照样从第 1 轮重新累计、15 秒后重新标红。
  //    ⛔ 30 秒门槛是为了防抖：点一下窗口就 focus 一次，不设门槛会让红框闪来闪去。
  if (Date.now() - _lastStateAttemptAt > 30000) _stateFailOK();
  refresh();
  // 持仓单独有一套 20 秒轮询，一起补上，省得回来还要干等
  if (typeof holdLoad === 'function') holdLoad(true);
}
// ⛔ gj 轮补（用户反馈"还是不行"后实测发现的真漏修）：版本自检 checkAppVer() 原来
//    **只在页面加载时跑一次**。于是那个从昨天开到现在的标签页会一直跑旧代码 ——
//    旧代码遇到 /api/state 抖动就弹红框、confirm 还是黑的，而页面自己永远不会更新，
//    服务端明明是新的也没用（线上首页 Cache-Control 已是 no-store，缓存不背这个锅）。
//    现在切回前台也查一次：30 秒节流，且 checkAppVer 内部对"正在输入/有草稿"只提示
//    不刷新，不会冲掉用户正在打的内容。
let _verChkAt = 0;
function onPageVisible() {
  if (document.hidden) return;
  if (Date.now() - _verChkAt > 15000) { _verChkAt = Date.now(); checkAppVer(); } // H3：桌面/手机版本自检口径统一为 15s
  resumeNow();
}
document.addEventListener('visibilitychange', onPageVisible);
window.addEventListener('focus', onPageVisible);
// H2：桌面端持续自检——标签常驻聚焦、不切前台时也定时比对服务端版本，堵住 checkAppVer 只在切前台事件触发的探测盲窗。
// 与手机端 checkMobVer 同口径 15s；请求走 /api/lock/status（轻量 no-store），后台标签自动跳过（刷新与本地存活专项）。
setInterval(() => {
  if (document.hidden) return;
  if (Date.now() - _verChkAt > 15000) { _verChkAt = Date.now(); checkAppVer(); }
}, 15000);
// iOS 从后台恢复 / 走前进后退缓存时经常只触发 pageshow，必须一起监听
window.addEventListener('pageshow', onPageVisible);

setInterval(() => {
  if (document.hidden) return;   // 后台不空转
  countdown--;
  if (countdown <= 0) { countdown = 5; refresh(); }
  const cdEl = document.getElementById('cd');
  if (cdEl) cdEl.textContent = countdown;
}, 1000);

// 手动刷新：单个窗口强制重拉后端数据（复盘/新闻/外围/模拟盘/池子/竞价）
const _amCollapsed = new Set();
function abMoveToggle(sec) {
  const body = document.getElementById('am' + (sec === 'top' ? 'Top' : 'Near') + 'Box');
  const chev = document.getElementById('am' + (sec === 'top' ? 'Top' : 'Near') + 'Chev');
  if (!body) return;
  if (_amCollapsed.has(sec)) {
    _amCollapsed.delete(sec); body.style.display = ''; if (chev) chev.textContent = '▾';
  } else {
    _amCollapsed.add(sec); body.style.display = 'none'; if (chev) chev.textContent = '▸';
  }
}
async function doRefresh(mod, el) {
  if (el) { el.classList.add('spin'); setTimeout(() => el.classList.remove('spin'), 1500); }
  try {
    // ⛔ 2026-10-07 改：原来拿回响应直接丢掉 —— 后端给的降级说明（如副本上点模拟盘刷新
    //    是改为回拉线上，而不是啥也没干）用户永远看不到，只会以为"刷新坏了"。
    //    只在后端真有话要说时才提示，正常刷新保持安静。
    const rp = await fetch('/api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: mod }) });
    const rj = await rp.json().catch(() => null);
    if (rj && rj.note) pageMsg('ℹ️ ' + rj.note, rj.ok === false ? 'err' : 'ok');
  } catch {}
  countdown = 5;
  refresh();
}
// ───────── 开发者锁 + 跨设备口令门 ─────────
// 规则：本机(127.0.0.1)完全免密；其它任何设备首次访问必须输口令，验证一次后该设备长期自动免密
const LOCK = { unlocked: false, token: '', hasPassword: false };
// role: 'edit'=开发者(可编辑,含查看持仓) / 'view'=观看密码(只读,看不到持仓)
const GATE = { passed: false, hasPassword: false, hasViewPassword: false, tried: 0, token: '', device: false, mode: 'view', role: null };
let CUR_ROLE = null;
// 前端版本号：必须与 server.js 顶部 APP_VER 保持一致。页面启动会比对服务端返回值，
// 不一致（手机/微信缓存了旧页）就强制刷新，从根本上杜绝"改了代码手机还是旧版"的问题。
const APP_VER = '20261107br'; // mv 轮：随 server.js 同步升版（启动扫描让出+注释链瘦身，详见 server.js:46）｜ // mu 轮：随 server.js 同步升版（S.fundDays 启动竞态修复，详见 server.js:46）｜ // mq 轮：线上推送身份恢复——发布包内 config 必剥离 pushRole/syncUpstream（本次线上被副本配置覆盖导致推送全停，靠重新发布恢复）+ 模拟盘仅连续竞价成交随版上线。
// ｜上一版 20261010gc：gc 轮（gb 发布后普查发现的两处同源遗漏）。① 面板手动刷新分支（/api/refresh 的 yier/lianban）原来裸写 S.yierList = scanYiEr() || [] —— 扫空（周末/出网抖动池子为 0）就把已有卡片抹成空白，不打 asOf、不落盘，与定时/推送那路两个口径（同一份数据在不同模块被当不同东西，第 4 次踩）；统一收口到 refreshStrategyCards（单卡刷单卡、全部刷新合并跑一次、guard 同名 strategycards 互斥）。② asOf 语义改『数据日期』：优先取涨停池的 S.ztDay 而非本机 todayStr() —— 周末手动刷新时池子还是上个交易日的，盖今天就是拿昨天的冒充今天的，正是 asOf 要防的；交易日盘中两者一致无差别。gb 轮内容见下：
// ｜上一版 20261009gb：① 竞价异动窗口收窄到 9:25~9:26、开盘自检收窄到 9:15~9:20（用户指定）—— 这两类消息只在特定时点成立，窗口一过补发就是马后炮；② 修「一进二 / 二进三卡片怎么空了」—— 卡片数据以前挂在推送函数里的去重判断之后，发布后永远算不出来，现已与推送彻底脱钩（refreshStrategyCards 排在 sentToday 之前）、算空不覆盖上一份有效数据、落盘 strategy_cards.json 跨重启保留；③ 卡片按用户要求保持到次日 9:20 前，9:25 后覆盖刷新当日数据，并在卡片标题显示数据是哪天算的（asOf），避免拿昨天的结论冒充今天的。
// ｜上一版 20261009ga：接 fz 轮「飞书重复推送」的第二半（fz 首发被实测证伪：发布后仍连发 5 条+1 条学习日报）。① 兜底改用**启动那一刻**的流水快照（启动后自己发出的流水不算证据，否则第一条发出去兜底就失效、剩下几条照发）；② 揪出 3 处漏网裸判（涨停复盘/竞价预览/开盘自检）收口走统一判据 sentToday，守门入口登记表 10→16 项。前版 20261009fz：飞书重复推送三处根因一次修完（用户原话「飞书你又重复推送」）。① 超时/断连不再被当「确认没送到」：sendResultUnknown() 区分「结果未知」与「明确拒绝」，未知时不撤销去重占位（撤销=下一轮再发一遍，且网络越差越自我放大），私密未知也不再退回群机器人（既重复又泄露）；② 跨进程：「送达结果未知」的流水也算今天已外发，重启/换 worker 不会重推（真失败的 ❌ 仍照旧补推）；③ 发布即新容器：线上每次发布磁盘不保留，当天流水为零时 sentToday 按「今天已发」处理，不再把复盘/一进二/连板接力/学习日报/次日计划全部重发一遍（真没收到可在面板手动补发）。守门 _test_push_unknown.js（51 断言）。前版 20261009fy：① 各池「上涨原因」全覆盖（用户原话「不是只加精选池，是全加，包括复盘趋势池啥的」）——poolReasonSection 通用渲染 + whySelected/whyTrend/whyBigMoney/whyBuzhang 四个解析器，精选·趋势·大单·补涨四池各认自己字段；② 复盘涨停原因显示修复——数据其实取到了（本地 ztReasonHit=69/69），旧文案只渲合成归因，现在显式打「涨停原因(同花顺)」，取不到明说「同花顺未取到」；③ K线补齐改按新鲜度筛选（原只补没文件的票，5911 只已有缓存的永不刷新，79% 今日K线陈旧）。渠道健壮性沿用 fw（快照+冷启动+同花顺兜底）。前版 20261009fw：⑦⑭接入东财竞价分时→竞价红柱/尾盘抢筹上翘真参与判定。前版 fq：十四条选股体系挂定时扫描（修「14条卡片一直没票」）。computeMyRules 挂 setInterval(guard('myrules'),6min)，与手动刷新共用锁；补 MYRULES_SCAN_MS 常量、panelNotes.myrules、前端两条文案改「盘中每6分钟自动扫」。fp 版竞价连板梯队归并不变。
// ｜上一版 20261009en：口径普查——修板块效应静默失效。① analyzePreBuy 里 sectorOfStock(c.code) 传字符串(函数要对象)+对返回值取 .name(返回的是字符串)，双重错误致 secZT 恒为 0，板块效应+8/+4分从未生效；② 板块异动选股拿东财BK涨幅榜名直查 S.ztBySector(键为主线口径)，两套命名对不上同恒 0，改为 themeOfSec 归并后查。竞价一进二推送维持 9:25~9:26 不变。
// ｜上一版 20261005cc：20261005cc：错误分支里的资源与状态回滚 —— 飞书队列不再被一次"永不回调"永久锁死（看门狗 + 请求超时 + 四条出口都给回调），一键还原的快照改存"操作之前"（以前存的是删完之后，救不回来），双通道任一送到就不退占位（否则邮箱收到两份），只读设备放行落盘失败一律撤回，授权码改先签后烧。守门 _test_rollback.js…

// ｜上一版 20261005cb：外部可控参数的边界 —— 撤销设备的空 id 不再等于"删光所有设备"，申请号不再被当成对象键（原型链污染），整数入参统一钳制，请求体封顶 8 MB，口令与推送正文封顶。守门 _test_param_boundary.js
// ｜上一版 20261005ca：保存不再"看着成功其实没写进磁盘" —— 配置、模拟盘、改密码、找回密码、撤销设备这几处都会确认真的落了盘才回成功；写不进去会如实说明"本次已生效但重启后会回退"。板块数据与源码也都改成原子写入，不会再留下半截文件。守门 _test_disk_state.js。
// ｜上一版 bc：新股「无涨跌幅限制期」不许被判成涨停（本轮新角度：数值量纲 / 规则边界）：A.limitPctOf 只按代码前缀+名字定限幅（主板10/创业科创20/北交所30/主板ST5），**认不出新股** —— 而新股上市前 5 个交易日**不设涨跌幅限制**，这段时间压根不存在涨停。实测后果：一只上市第 2 天的主板新股涨 30%，会被判成「10cm 涨停」→ ①混进涨停池、连板梯队、板块龙头，把真主线挤掉 ②被 seedLearnFromHistory 当成涨停日灌进学习样本，学出来的规律是假的 ③模拟盘按「涨停不可买入」把一只完全可以买的票拦掉。注册制下创业板/科创板新股同样前 5 日无限制，北交所新股首日无限制。修法不能改 isLimitUp 的签名（11 处调用点、绝大多数拿不到上市日期），改用**注入钩子** setNoLimitFn：server 把全A快照里的上市日期喂进去，上市未满 8 个自然日（≈5 个交易日含周末，宁可多排除两天）一律不判涨停；拿不到上市日期时退化为原行为，钩子抛异常也有 catch 兜底，绝不比修之前更差。上市日期索引走 Map（O(1)），不能写成 O(n) 的 find —— 全市场扫描要查几千只票。
// ｜上一版 bb：同一份外部数据不许被重复打（本轮新角度：异步竞态 / TOCTOU）：全项目 9 处 fetchKline、3 处 ensureSectorStocks（**全是裸调用不 await**，天然并发）、2 处 ensureStockBoards，多个定时器在同一秒里要同一份数据是常态 —— 补涨龙/启动前埋伏/新闻关联会拉同一个板块的成分股，大单扫描与板块刷新会补同一批票的题材，回验/打分/模拟盘会要同一只票的K线。而 em.js 里**没有任何请求合并**：N 路同时要就是 N 次网络，全部计入同一条限流计数。ax 那轮给 fetchBoardStocks 加退避，正是因为实测它被自己打封了一整天（补涨龙/启动前埋伏整栏 0 输出）—— 但退避只治「失败后继续猛打」，治不了「同一份数据被重复打」，后者才是请求量的大头。现在在 em.js 加统一 dedup：同一 key 的并发请求复用同一个 Promise，落地即注销（**必须写在 finally 里** —— 失败不注销会让该 key 永久占着一个 rejected Promise，这只票/这个板块被永久判死，比重复请求严重得多）；fetchKline/fetchBoardStocks/fetchStockBoards 三个入口全部包一层（底层拆成 *_Core，避免包装递归调自己）。另修 ensureSectorStocks 的补拉配额：原来的 let fetched=0 是**每个调用方各自的局部计数器**，三路并发时各允许 3 个 = 一轮最多 9 个请求，防请求风暴的意图被完全抵消；改成 60 秒窗口的全局配额（6 个），无论成败都先占位（失败也占位，限流时才会真正降频；若改成成功才占位，限流时会对 30 个板块逐个重试，反而打得更凶）。｜上一版 ba：事后样本（hindsight）不许参与校准：seedLearnFromHistory 是「先知道当天涨停了，才倒推登记一条信号」，决策时刻并不知道它会涨停 —— 教科书式的事后选择偏差。本机实测回测样本 600 条次日命中 75%、同期实盘预判只有 36%，而 empTable（实测重标定）只要求 s.nd，把这 600 条 100% 收进标定表：未启动类|65-74 档混合 67% vs 实盘 23%（虚高 44 点）、|55-64 混合 74% vs 43%（虚高 31 点）、全部|<70 混合 61% vs 36%（虚高 25 点）。污染链是 empInfo → fusedProb → 推送门槛，以及 S.learn.buckets[].corr → calibratedProb（6 处调用）。口径分离早就做了（S.learn.split 三口径），但只用在面板展示，empTable 这条后加的链路漏了继承。现在统一 isLiveSample/isBacktestSample/isPostHocSample 三个判定，empTable、recomputeBuckets（res=live，不再拿回测凑证据厚度）、learnFusedReport、trendSelfOptimize、bigMoneyStats、similarStats、bmEmpBuckets 七处全部只认实盘；另补单向「强证伪」通道：剔除后实盘样本常只跨 2~3 个交易日（实测 1092 条仅跨 09-28/29/30），距 MIN_LEARN_DAYS=5 永远差一口气，若一律判证据不足就退回 corr=1（完全不打折），比用被污染数据算出的结果还要激进 —— 修完偏差反而放松闸门等于白修；故样本厚（n≥80）且实测低于该档期望 ≥15 点时照样打折，只认这一个方向（实测高于期望更可能是运气抬分，放行只会放宽闸门）。｜上一版 az：模拟盘不许按陈旧价卖出（本轮新角度：同一份数据的多个视图是否自洽 + 既定原则两端是否一致）：`paperBuy` 早就写明「休市日不买 —— 拿陈旧价买＝假成交」，`paperCheck` 却**只判休市日、没判价格新鲜度**。持仓票若不在本次行情快照里（全A列表拉取失败/限流、停牌、代码已换），价格会退回 `pos.lastPrice`（可能是昨天甚至更早的），然后照样算收益、照样判止盈/止损/到期换股 → **按一个根本没观察到的价格把持仓卖了**，成交记录与收益率一起失真。2026-10-06 本机实测正是全A拉取失败的状态，此时所有持仓都会用陈旧价过一遍判定。现在区分「真实行情价」与「陈旧兜底价」：无真实价时只更新 lastPrice 保证面板不丢显示、并打 `pxStale` 标记，但**绝不触发任何卖出**（止盈/止损/到期换股三个方向全堵住）；快照一恢复真实价立即恢复正常工作，不会永久冻结持仓。｜上一版 ay：板块缓存回填（ax 的自查补漏）：ax 给补涨龙/启动前埋伏加了「退避期退回 S.secStocks 旧名单」的兜底，但漏了另一半 —— **拉到名单时并没有回填这个缓存**。而 S.secStocks 原本只由新闻模块按「每轮最多补 3 个板块」慢慢填，刚发布重启时几乎是空的，补涨龙一轮却要扫 8 个板块 → 真到退避发生时缓存里往往还没有这些板块，兜底形同虚设。现在两处调用方成功拉到名单就回填一份，退避期才真的有旧名单可用。守门测试补两条断言钉死「拉到必须回填」。本轮另做 8 个角度复查均干净：①TTL 秒/毫秒混用 0 处 ②配置启动期冻结（`isReplica` 是箭头函数非冻结；`probThreshold` 直读不经过 `||`，设 0 能生效）③空数组展开进 Math.max —— `analysis.js:489/493` 被 L478 `rows.length<25` 守住、`scoreStock` 两个调用点分别有 `rows.length<45` 与 `!k.rows.length` 拦截 ④`dayKeyOf` 与 `todayStr` 同为 YYYYMMDD，T+1 锁正确生效（若格式不一致会恒 false → 当日买入当日就能卖）⑤`paperCheckAll` 有 isTradeDay 闸门，休市不按陈旧价误卖 ⑥涨停判定全走 isLimitUp ⑦时间窗无恒 false ⑧按天重置三处同口径。｜上一版 ax：板块成分源限流退避（本轮新角度：数据源被限流之后系统会怎么做）：补涨龙一轮拉 8 个板块、启动前埋伏 6 个、新闻关联十几个，每 8 分钟一轮 —— 而 `em.fetchBoardStocks` 是**全项目唯一没有退避的东财通道**（竞价那路早有 EM_BACKOFF）。东财一开始限流，这里照旧每轮猛打十几个请求，等于自己把 IP 往死里封：限流 → 继续打 → 封更久 → 两个模块整天零输出。2026-10-06 线上实测复现：涨停池 52、精选池 30、趋势池 50、ztPre 20 全部正常，唯独「补涨龙 items 0」「启动前埋伏 items 0」，日志满屏「成分股拉取失败」——正是这段注释里早就预警过、却一直没治根的故障。现在补上阶梯退避（30s→60s→…封顶 300s），退避期间**一次网络都不打**直接快速失败，成功即清零；另给两处调用方加「陈旧缓存兜底」：退避中退回 S.secStocks 上一次的名单（成分名单一天内几乎不变，旧名单照样判得准），并给每条候选打 `stale` 标记、reason 里写明「成分名单为缓存(板块源限流中)」——宁可标注着用旧数据，也不让整栏空白，更不能悄悄用旧数据不吭声。｜上一版 aw：日期口径统一为本地时间（本轮新角度：UTC 与本地混用）：within3Days() 用 toISOString()（**UTC**）算「近3日」的下界，而项目里所有日期键（todayStr / dayKeyOf / normDate / 新闻 x.t，全是 toLocaleString）清一色本地口径 —— 北京时间 UTC+8，每天 00:00–08:00 这 8 小时里 UTC 日期比本地晚一天，下界就少算一天，「近3日归档」实际留了 4 天，面板口径跟文案对不上。这里只当下界所以是多留（宽松、不丢数据），但一旦有人拿它当上界就会把当天整漏掉，属于埋雷。现在改用本地年月日拼串，与 S.marketBeta / S.breadth / byDay 的键同口径；守门测试把时钟拨到「北京 10-06 05:00 = UTC 10-05 21:00」这个两种口径正好差一天的时刻做行为验证。同轮另扫两类：① replace 忘记 /g —— 7 处非全局全是 /^…/ 或 /…$/ 锚定（去尾部斜杠、去前缀），不带 g 正是意图，无问题；② 遍历中就改集合 —— 177 个 for-of 全部只读，无漏项/无限增长。｜上一版 av：定时器不许「同一件事两把锁」（本轮新角度：32 个定时器的调度体检）：guard(name, fn) 是**按名字**加锁的，两路定时器若用不同 guard 名（或一路用 guard、一路用自己的 busy 标记）跑同一个重函数，两把锁互不相认，到点就是并发跑两次 —— ① computeBreadth 同时挂在 guard('breadth') 5 分钟 与 guard('beta') 30 分钟两路下，30 分钟是 5 分钟整数倍且起始时刻几乎相同 → 每半小时并发两遍全 A 遍历，而 computeBreadth 内部会 atomicWrite(BREADTH_FILE)，等于双倍写盘算同一份数据；现在宽度只由 breadth 一路负责。② resolveSignalsDeep + resolveSignals 在复盘块（靠 reviewBusy）与 learn 定时器（guard('learn')）各跑一遍 → 15:30 后复盘每 20 秒重试、learn 每 30 分钟一轮，撞上就是两路同时补拉 K 线、同时写 stats.json，等于自己打自己的数据源，越忙越容易撞限流、回验结果反而更旧；现在抽成共用的 runLearnCycle（同一把 guard('learn') 锁），谁先占到谁跑，另一方本轮跳过、下轮自然补上。｜上一版 au：SSE 事件契约补闭环（本轮新角度：后端发了什么 vs 前端接了什么）：后端 sseSend/sseSendEdit 一共发 7 类事件（alert/holding/pushed/bigmoney/similar/signal/auction），而前端 EventSource 只订阅了 4 类 —— pushed / similar / auction 三类**零接收方**，后端白算白推、前端永远不刷新，而且**没有任何报错**（SSE 发出去没人听，不像接口会 404，这类故障 100% 无法自查）。其中 auction 是**每 3 秒**算一次的竞价实时，是全场时效性最强的一路，前端却只靠 5 秒轮询拿 S.auction —— 9:15-9:25 最需要秒级更新的那十分钟，"竞价实时"实际只跑了一半。现在三类都接上（只静默刷新、不弹提示，避免竞价 3 秒一条刷屏）。另查「面板点了没反应」：79 个内联事件绑定的函数全部有定义，无死按钮。｜上一版 at：落盘失败不许静默（本轮新角度：全项目扫「空 catch 包着写操作」的静默失败点，已修 6 处）：savePaper（模拟盘成交与持仓的唯一落盘口，写失败 = 重启后整段交易蒸发）、touchDevice 与过期只读申请清理（设备台账，写失败 = 撤销过的设备可能"复活"）、HD.addRemoteItem（线上→本地持仓补录，写失败 = 手机加了票电脑上没有且无任何提示）、板块流兜底重拉（失败 = 板块栏与补涨龙整段无源）、非交易日样本迁移（失败 = 周末样本永久污染命中率统计）。这几处的共同点是：失败后系统照样跑、面板照样显示，但数据是真的没了，且没有任何一行日志能说明原因。另扫「除零/NaN」80 处与「sort 比较器返回布尔」4 处，逐条复核后确认全部有守卫，无真问题。｜上一版 as：模拟盘「钱的逻辑」两处真 bug：①买入预算没扣手续费 —— budget = min(现金, 权益/仓数*0.98) 最多就等于现金，A 股整手取整后 cost 常常正好等于 budget（现金 1000、股价 10 元 → 100 股 = 1000 元整），再减 5 元最低佣金 → **现金被买成 -5 元**，面板上出现「剩余现金 -5 元」。现在按「毛预算 − 该预算对应的佣金」算净额再取整手，并加 cost+fee>cash 兜底。②收益联动止损是一条**死分支**：linkedStop(cfg, profit) 拿【当前收益】当锚，返回值恒为 profit − tp*0.4 < profit，而判定是 profit <= 那个返回值 → **恒为 false**，这条移动保护线从来没生效过：收益从 7% 回落时本该在 3.8% 离场，实际要一路跌到 0.5%（保本档）甚至 -3%（固定止损）才卖，等于主动放弃已实现的浮盈。现在锚改成【收益峰值 pos.peak】（只上不下），保护线由峰值推出；另加 paperTouch 60 秒节流落盘（以前只有买卖才写文件，重启后存活持仓的 lastPrice 一律退回买入价、峰值也归零）。｜上一版 ar：前端异常不再静默：public/index.html 里 refresh() 是 650 行渲染，外层只有一个 `catch (e) { console.error(e) }`，而全项目**连 window.onerror 都没有** —— 任何一处抛错（后端少返回一个字段、元素 id 变了、数据里冒出 null）都会被整块吞掉，面板从此停在旧数据，手机上打不开控制台，用户只会以为"今天没行情"，这类故障 100% 无法自查。现在报错会显式显示在页面右下角（带重试按钮），并补上 window error + unhandledrejection 两层全局兜底。｜上一版 aq：配置项「设 0 = 完全不限」此前是**假的**：/api/config 的写入端早就允许 0（注释明写"0 是合法值，被 || 吃掉就永远关不掉"），但**读取**端 14 处仍是 `+(S.config.X || 默认)` → 用户在面板把大单概率门槛/相似度门槛/净占比门槛设成 0 想关掉过滤，存进去了、读出来却是默认值，设置项静默失效（不报错不提示）。现在这 10 个键全部改走 `_govCfg(k, 默认)`，它用 `Number.isFinite(n) && n >= 0` 判定，0 能正常通过。｜上一版 ap：持仓重算缓存加「世代戳」（治「删了还显示在面板上」的**第二个**根因）：重算要拉行情+逐票K线，慢的时候好几秒；若它是用户点删除【之前】启动的，读完还会把那份**删除前**的数据写进缓存并盖上"刚刚算出来"的时间戳 → 之后 20 秒所有 /api/holdings 都返回删除前的列表，面板上那只票好端端躺着，看着就是"删不掉"（第一个根因是同步单向，上一版已修）。现在写操作 bump 世代，重算跑完发现世代变了就丢弃结果、不落缓存。｜推送「先发后置位」补漏：pushAll 永不抛异常、被闸门拦下只是静默 return，而复盘/次日作战计划/竞价异动/大单流入/补涨龙五处把去重或当日闭锁标记写在了 pushAll **之前** → 推送一条没出去、"今天已发"却已打上 → 当天再也不会重试，消息永久消失。现在 pushAll 返回「本轮是否已终结」，五处改为发完才置位；返回值只把【夜间静默】判为 false（时段一过自动解除，值得重试），副本永不外发 / 条数闸门按天重置 / 未配置通道 一律判 true 让本轮终结 —— 否则本地副本会每 20 秒重跑一次复盘（拉涨停池+补拉K线）直到午夜，等于自己打自己的数据源。本轮另做两项全项目扫描：①async 未 await/未 .catch（已修 sendPwdCard + 2×ensureSectorStocks 三处真裸调用，其余经人工确认全是声明行/已 await/已 then-catch/箭头内返回）②长跑容器无界增长（73 个 Map/Set/数组全部有清理或上限）——均干净。上一版 ao：持仓强制重算做「进行中复用」：kick() 在每次写操作后都调 compute(true)（force 绕过 20 秒缓存），而每次重算都要拉批量行情 + 逐票 K 线 —— 在面板上连续改静音/改标签/逐条删除，会同一瞬间并发好几轮全量重算，等于自己打自己的数据源 → 触发限流 → 数据反而更旧。现在 compute 内部用 _inflight 复用正在跑的那一次，算完自动释放（不影响下次强制刷新）。本轮另做了三项扫描均干净：①顶层无重复定义（同名 function/const 定义两次会让前一版静默作废）②持仓前后端字段契约一致（前端没有读后端不返回的字段）③配置项孤儿键（读了但 config.json 里没有的键都是有默认值的可选项，非拼写错误）。上一版 an：/api/refresh 接防重入锁（面板点🔄以前是裸调用、绕开 guard，paperCheckAll 并发会让模拟盘重复下单）+ 接口权限矩阵扫描（62 个接口，8 个无 token 检查的均由全局登录锁兜住，无越权）+ 守门测试自净防连锁误报。

/* ══════════ 输入防丢（2026-09-29 事故后补：用户打了大量字，点发送后全没了）══════════
   事故链：① 页面版本与服务端不一致 → checkAppVer() 无条件 location.reload(true)；
          ② 那天连发 3 个版本 → 用户每次打开都被强制刷新；
          ③ 用户在输入框里的内容只存在于页面内存 → 一刷新全部蒸发，服务端根本没收到。
   三层防护：
     A. 草稿实时落盘 —— 任何文本框输入即刻写入 localStorage（密码框除外，不能明文存）
     B. 刷新/更新前必存 —— 恢复时只回填【当前为空】的框，绝不覆盖服务端已下发的内容
     C. 不再无条件强刷 —— 检测到【有未提交输入】时改为顶部提示条，由用户决定何时更新
   ================================================================================ */
const DRAFT_KEY = 'qd_draft_v1';
// 强制刷新到最新版：注销 Service Worker + 清缓存 + 带随机参数跳转。
// 微信/ Safari 对 location.replace 仍可能读 Service Worker / 浏览器缓存，这里组合几种手段确保新页被请求。
function forceRefreshToLatest() {
  const u = new URL(location.href);
  u.searchParams.set('_v', Date.now());
  u.searchParams.set('_r', Math.random().toString(36).slice(2));
  const go = () => { location.replace(u.toString()); };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      if (!regs || !regs.length) { go(); return; }
      Promise.all(regs.map(r => r.unregister())).then(go).catch(go);
    }).catch(go);
  } else {
    go();
  }
}
// 密码框绝不进草稿（明文落 localStorage 是安全事故）；checkbox/radio 不进（属于状态不是"打的字"）
const draftSel = () => document.querySelectorAll(
  'input:not([type=password]):not([type=checkbox]):not([type=radio]), textarea');
function draftSnap(silent) {
  try {
    const d = {};
    for (const el of draftSel()) {
      if (!el.id) continue;
      const v = String(el.value || '');
      if (v.trim()) d[el.id] = v;          // 只记非空的，省空间也避免把空串回填到有内容的框
    }
    if (Object.keys(d).length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ ts: Date.now(), d }));
    else localStorage.removeItem(DRAFT_KEY);
  } catch (e) { }
  return silent;
}
function draftHas() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return 0;
  try { return Object.keys((JSON.parse(raw).d) || {}).length; } catch { return 0; }
}
function draftRestore() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return 0;
  let obj; try { obj = JSON.parse(raw); } catch { return 0; }
  const d = obj.d || {};
  let n = 0;
  for (const [id, v] of Object.entries(d)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (String(el.value || '').trim()) continue;   // 服务端已填 content → 不覆盖
    el.value = v; n++;
  }
  return n;
}
function draftDiscard() { try { localStorage.removeItem(DRAFT_KEY); } catch { } }
// 提示条（通用的顶部浮条，也用于版本更新提示）
function topBar(html, opts = {}) {
  let bar = document.getElementById('topBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'topBar';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  bar.className = 'topbar' + (opts.warn ? ' topbar-warn' : '');
  bar.innerHTML = html;
  bar.style.display = '';
}
function hideTopBar() { const b = document.getElementById('topBar'); if (b) b.style.display = 'none'; }

// ── 渲染异常不再静默吞掉（2026-10-06）───────────────────────────────────────
// refresh() 是 650 行渲染，外层只有一个 `catch (e) { console.error(e) }`。
// 任何一处抛错（后端少返回一个字段、某个元素 id 变了、数据里冒出 null）都会被整块吞掉：
//   面板从此停在旧数据，**手机上打不开控制台，用户只会以为"今天没行情"**。
//   以前全项目连 window.onerror 都没有 —— 这类故障 100% 静默。
// 现在把错误显式摆到页面右下角，并给一个重试按钮；外面再补一层全局兜底，
// 接住 refresh() 之外（事件回调 / 未 await 的 Promise）漏出来的异常。
// 前端错误上报到服务端（2026-10-09）：手机打不开控制台，"页面异常"过去无法自查。
// 经 sendBeacon 异步上报，不阻塞渲染、不弹二次错误。
function reportClientError(msg, where, stack) {
  try {
    const payload = JSON.stringify({ msg: String(msg || ''), where: String(where || ''), stack: String(stack || ''), ua: navigator.userAgent || '', url: location.href || '' });
    if (navigator.sendBeacon) { try { navigator.sendBeacon('/api/client-error', new Blob([payload], { type: 'application/json' })); return; } catch (_) {} }
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  } catch (_) {}
}
function showRenderError(e, where) {
  try {
    const msg = e ? String((e && e.message) || e) : '未知错误';
    const stack = (e && e.stack) ? String(e.stack) : '';
    reportClientError(msg, where, stack);
    let box = document.getElementById('renderErrBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'renderErrBox';
      box.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:9999;max-width:72vw;' +
        'background:#fff5f5;border:1px solid #ffc9c9;border-radius:8px;padding:8px 10px;' +
        'font-size:12px;line-height:1.5;color:#c92a2a;box-shadow:0 2px 10px rgba(0,0,0,.12)';
      document.body.appendChild(box);
    }
    // ⛔ gj 轮：框要能自报身份。'数据拉取' 是"这一轮没拉到"（会自动好），
    //    数据一恢复就该自己消失；其余（面板渲染/全局）是**真的**渲染抛错，必须留着等人看。
    box.setAttribute('data-why', where === '数据拉取' ? 'statefetch' : 'render');
    // ⛔ 文案不许再说"数据可能已停止更新"——那只对渲染抛错成立。
    //    拉取失败时面板上明明还是上一轮的数据，说这句话是谎话。
    const isFetch = where === '数据拉取';
    // ⛔ dy 轮：光说「连续多轮」用户没法判断这是刚刚的事还是昨晚留下的老框。
    //    把「连续几轮 / 最后成功几点几分几秒 / 会自动重试并自动消失」摆出来 ——
    //    面板上的每个数字都要能被核实，提示语同样。
    const _okAt = _lastStateOKAt ? (() => {
      const t = new Date(_lastStateOKAt);
      return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    })() : '';
    const _fact = isFetch
      ? '<div style="margin-top:3px;color:#868e96">' + (_okAt ? '最后一次拿到数据 ' + _okAt + ' · ' : '') + '每 5 秒自动重试，恢复后本框自动消失</div>'
      : '';
    // ⛔ 环境诊断（2026-10-28）：连续 Failed to fetch 最常见根因是「在访问不到服务器的环境
    //    打开了本地面板」——127.0.0.1 只代表设备自己，手机/其他设备访问必然全挂。
    //    识别出这种情况时不只提示，直接给可点击的线上地址，一键跳过去问题即解。
    let _envTip = '';
    try {
      if (isFetch && /^(127\.0\.0\.1|localhost|0\.0\.0\.0)$/i.test(location.hostname)) {
        _envTip = '<div style="margin-top:5px;padding:6px 8px;background:#fff9db;border:1px solid #ffe066;border-radius:6px;color:#8a5a00">'
          + '当前访问的是<b>本地面板</b>（' + esc(location.host) + '），仅这台电脑自身能连。<br>'
          + '手机或其他设备请用线上地址：'
          + '<a href="https://quant-dashboard-77614.app.workbuddy.host/" style="color:#1971c2;font-weight:700">https://quant-dashboard-77614.app.workbuddy.host/</a></div>';
      }
    } catch (_) {}
    box.innerHTML = (isFetch ? '⚠️ 连续多轮没拉到数据（面板显示的是上一轮的数据）' : '⚠️ 面板刷新出错（数据可能已停止更新）') +
      (where ? ' · ' + esc(where) : '') +
      '<div style="margin-top:4px;color:#868e96;word-break:break-all">' + esc(msg) + '</div>' + _fact + _envTip +
      '<div style="margin-top:6px"><button class="btn ghost" onclick="refresh();var b=document.getElementById(\'renderErrBox\');if(b)b.remove()">重试</button></div>';
  } catch (_) {}
}
// ── 「这一轮没拉到」与「面板坏了」分开处置（gj 轮实测，2026-10-12）────────
// 实测取证：让 /api/state 返回 502 HTML（云端冷启动/实例回收的典型响应）或直接拒绝
// （手机弱网断连），都会让 refresh() 在 fetch 那一行抛错 → 弹出上面那个红框。
// 可真相只是**这一轮**没拉到：面板还是上一轮的数据，5 秒后的下一轮通常就成功了。
// 把一次没拉到达当成渲染坏来报警 = 误报 + 文案不实 + 框不会自己消失（用户只能手点重试）。
// 现在：拉取失败 → 中性 toast（2.6 秒自动消失）+ 计数；连续 STATE_FAIL_RED 轮都失败才升级成红框；
//       只要有一轮成功，立刻摘掉那个框并把计数清零。
let _stateFailBoxTimer = null;
// ⛔ 阈值必须是**单一常量**（2026-10-28 修）：原来门槛从 3 调到 5 时只改了 if 那一行，
//    toast 里的「再失败 N 次将标红」还按 3 算 —— 第 4 次失败时算出 3-4 = **-1**，
//    用户看到「再失败 -1 次将标红」。门槛和文案从此共用这里，不许再各写各的数。
const STATE_FAIL_RED = 5;
function stateFetchFail(e) {
  _stateFailN++;
  const msg = (e && e.message) ? String(e.message).slice(0, 80) : '未知原因';
  // ⛔ 阈值 3→5：手机弱网/云端冷启动时 3 轮太容易误标红；5 轮（约 25 秒）仍失败才提示
  if (_stateFailN >= STATE_FAIL_RED) {
    showRenderError(new Error('连续 ' + _stateFailN + ' 轮没拉到数据（' + msg + '）'), '数据拉取');
    // ⛔ 数据拉取红框 60 秒自动消失：即便中途没有成功轮次，也不让旧框永远挂着吓人
    clearTimeout(_stateFailBoxTimer);
    _stateFailBoxTimer = setTimeout(() => {
      const b = document.getElementById('renderErrBox');
      if (b && b.getAttribute('data-why') === 'statefetch') b.remove();
    }, 60000);
  } else {
    // ⛔ dy 轮：提示语自身失败绝不许拖垮刷新流程。pageMsg 曾因裸 `el` 每次必抛，
    //    结果「一次弱网失败」没有被提示，而是让 refresh 整体 reject → window.onerror
    //    兜成 data-why=render 的常驻红框（那种框不会被 _stateFailOK 摘掉）。
    //    一行提示的异常半径，就应该是这一行。
    try { pageMsg('⚠️ 本轮数据没拉到（' + msg + '）· 面板仍是上一轮的数据 · 再失败 ' + Math.max(0, STATE_FAIL_RED - _stateFailN) + ' 次将标红', 'warn'); } catch (_) {}
  }
}
function _stateFailOK() {
  _stateFailN = 0;
  const b = document.getElementById('renderErrBox');
  // ⛔ 只摘自己插的那块：渲染真错的框（data-why=render）必须留着，那才是要人看的
  if (b && b.getAttribute('data-why') === 'statefetch') b.remove();
}
// ⛔⛔ hv+1 轮：序列化边界不可信 —— /api/state 走 res.json(state)，内部 JSON.stringify
//    会把数组里的 NaN/undefined 变成 null 元素（JSON.stringify([NaN]) === '[null]'），
//    后端任何一处算出 NaN（除以 0、空数组求均值、Infinity）都会变成 null 元素塞进数组，
//    前端 `.map(x => x.score)` 裸取即抛「Cannot read properties of null」整页渲染中断。
//    jsdom 实测（_forensic_render2.js，79 字段模糊测试）：字段置 null/删除全不炸，
//    数组置 [null] 15 个字段全炸 —— ar/gj/gk 三轮修的都是前者，这个形态一直漏着，
//    就是用户说的「面板渲染出错怎么改不好」（偶发、数据是好的、下一轮又恢复）。
//    修法：渲染前统一滤掉数组里的 null/undefined 元素。
//    ⛔ 只滤元素不清内容：滤掉的元素「判不出是什么」，不猜不补；
//       ⛔ 滤了多少必须留痕（console.warn），静默清洗=下次照样查不出；
//       深度 2（顶层数组 + 一层容器内的数组如 S.auction.strong）；
//       巨型快照字段（stocks/ztPool/klines）只滤自身那一层，不进每个元素内部。
function normalizeState(s) {
  if (!s || typeof s !== 'object') return s;
  const SKIP_DEEP = new Set(['stocks', 'ztPool', 'klines']);
  let dropped = 0;
  const walk = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 2) return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v)) {
        const clean = v.filter(x => x != null);
        if (clean.length !== v.length) { dropped += v.length - clean.length; obj[k] = clean; }
        if (depth < 2 && !SKIP_DEEP.has(k)) for (const el of clean) { if (el && typeof el === 'object') walk(el, depth + 1); }
      } else if (v && typeof v === 'object' && depth < 2 && !SKIP_DEEP.has(k)) {
        walk(v, depth + 1);
      }
    }
  };
  walk(s, 0);
  if (dropped > 0) console.warn('[面板] 渲染前清洗：滤掉 ' + dropped + ' 个 null 数组元素（后端序列化产生，已跳过不渲染）');
  return s;
}
window.addEventListener('error', ev => {
  console.error('[前端异常]', ev && ev.error);
  showRenderError((ev && ev.error) || (ev && ev.message), '全局');
});
window.addEventListener('unhandledrejection', ev => {
  console.error('[前端未捕获的 Promise]', ev && ev.reason);
  showRenderError(ev && ev.reason, '未捕获的异步错误');
});
// 版本自检：拉服务端版本，与本地内置版本比对。
// ⚠️ 以前是不一致就 location.reload(true) —— 用户正在输入的内容会被冲没。
//    现在：先存草稿；若页面上有未提交的输入，就不自动刷新，改为提示用户手动更新。
async function checkAppVer() {
  let st;
  try {
    st = await fetch('/api/lock/status?v=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
  } catch (e) { return false; } // 自检失败不影响正常进入
  if (!st || typeof st.appVer !== 'string' || !st.appVer || st.appVer === APP_VER) return false;

  const busy = draftHas();                       // 有草稿 = 用户很可能还在编辑
  const typing = document.activeElement &&
    /INPUT|TEXTAREA/.test(document.activeElement.tagName || '');   // 焦点正在输入框里
  draftSnap();                                   // 无论如何先把字存住，刷新也不丢
  if (busy || typing) {
    // 不打断正在编辑的人：给一条提示条，他自己点更新（更新前同样会先存草稿）
    topBar('🆕 有新版本 <b>' + st.appVer + '</b>（当前页 ' + APP_VER + '）· 你正在输入的内容<b>已暂存</b>，点右侧按钮更新后会自动填回' +
      ' <button class="btn" style="padding:3px 10px;font-size:12px;margin-left:8px" onclick="applyUpdate()">立即更新</button>' +
      ' <button class="btn ghost" style="padding:3px 10px;font-size:12px" onclick="hideTopBar()">稍后</button>', { warn: true });
    return false;                                // 不 return true —— 让后面的登录/渲染流程照常跑完
  }
  console.log('[版本自检] 本地 ' + APP_VER + ' ≠ 服务端 ' + st.appVer + ' → 刷新到最新版（已暂存草稿）');
  draftSnap();
  forceRefreshToLatest();
  return true;
}
function applyUpdate() {
  draftSnap();
  forceRefreshToLatest();
}

// —— 初始化守卫：DOM 就绪后立刻 ① 回填上次未提交的字 ② 挂上实时暂存 ——
// 用【捕获阶段】的事件委托，页面上任何输入框（包括以后 JS 动态插入的）都自动受保护，
// 不用逐个 id 去绑定，避免以后加输入框时漏掉。
(function initDraftGuard() {
  let _t = null;
  const snapSoon = () => { clearTimeout(_t); _t = setTimeout(draftSnap, 250); };
  try {
    window.addEventListener('input', snapSoon, true);
    window.addEventListener('change', snapSoon, true);
    // 关页/切后台/被刷新前都兜一次（reload 不一定给 input 事件机会）
    window.addEventListener('beforeunload', draftSnap);
    window.addEventListener('pagehide', draftSnap);
  } catch (e) { }

  function boot() {
    const n = draftRestore();
    if (n > 0) {
      const raw = localStorage.getItem(DRAFT_KEY);
      let age = '';
      try { const ts = JSON.parse(raw).ts; age = new Date(ts).toLocaleString('zh-CN'); } catch (e) { }
      topBar('✏️ 已恢复你上次<b>未提交就丢失</b>的输入（' + n + ' 处' + (age ? '，约 ' + age : '') +
        '）—— 这是本页面的兜底保护，内容存在你本机浏览器里，不会上传。' +
        ' <button class="btn ghost" style="padding:3px 10px;font-size:12px;margin-left:8px" onclick="draftDiscardAndClear()">不是我要的·清空</button>' +
        ' <button class="btn ghost" style="padding:3px 10px;font-size:12px" onclick="hideTopBar()">知道了</button>', { warn: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
function draftDiscardAndClear() {
  draftDiscard();
  // 同时把已回填的内容抹掉，避免"不是我要的"还赖在框里
  try { for (const el of draftSel()) if (el.id) el.value = ''; } catch (e) { }
  hideTopBar();
}

// 依据当前身份切换界面：只读身份隐藏所有编辑入口与私密区（推送配置/源码/模拟盘操作/我的持仓）
function applyRoleUI() {
  const v = CUR_ROLE === 'view';
  try {
    document.querySelectorAll('[data-eo="hide"]').forEach(el => el.classList.toggle('eo-hide', v));
    document.querySelectorAll('[data-eo="off"]').forEach(el => el.classList.toggle('eo-off', v));
  } catch {}
  // 身份切换会改变可见面板集合（持仓等），重算折叠/勾选状态与选择器列表
  try {
    if (typeof initPanelCollapse === 'function') initPanelCollapse();
    else if (typeof applyAllPanels === 'function') applyAllPanels();
    if (typeof buildPanelPicker === 'function') buildPanelPicker();
  } catch {}
  const rs = document.getElementById('roleState');
  if (rs) {
    if (CUR_ROLE === 'edit') { rs.textContent = '🔓 开发者·可编辑'; rs.className = 'badge ok'; rs.title = '本机或已验证开发者密码：可编辑配置/源码/持仓'; }
    else if (CUR_ROLE === 'view') { rs.textContent = '👁 只读·观看'; rs.className = 'badge'; rs.title = '观看密码登录：只能看行情，不能改任何东西，也看不到持仓'; }
    else { rs.textContent = '—'; rs.className = 'badge'; }
  }
  const b = document.getElementById('btnLock');
  if (b) {
    if (CUR_ROLE === 'edit') { b.textContent = LOCK.unlocked ? '🔓 开发者已解锁' : '🔒 开发者未解锁'; b.className = 'btn ' + (LOCK.unlocked ? '' : 'ghost'); }
    else { b.textContent = '🔑 切换为开发者'; b.className = 'btn ghost'; }
  }
  buildSecNav();
}
function identBtn() { if (CUR_ROLE === 'edit') toggleLockPanel(); else showGate(); }
async function syncRole() {
  try {
    const t = GATE.token || LOCK.token || localStorage.getItem('qd_device') || localStorage.getItem('qd_token') || '';
    const st = await fetch('/api/lock/status' + (t ? '?token=' + encodeURIComponent(t) : '')).then(r => r.json());
    CUR_ROLE = st.local ? 'edit' : (st.role || 'view');
    GATE.role = CUR_ROLE;
    GATE.hasPassword = !!st.hasPassword; LOCK.hasPassword = !!st.hasPassword;
    GATE.hasViewPassword = !!st.hasViewPassword;
  } catch { if (!CUR_ROLE) CUR_ROLE = 'view'; }
  applyRoleUI();
  if (CUR_ROLE !== 'view' && typeof loadBindPhone === 'function') loadBindPhone();
  if (typeof holdLoad === 'function') holdLoad(true);
}

// 统一给 /api/* 请求注入凭证：原先只有个别接口带 token，这里做一次收口，跨设备不再漏传
const _rawFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  try {
    const t = GATE.token || LOCK.token || '';
    if (t && typeof input === 'string' && input.indexOf('/api/') === 0 && input.indexOf('/api/lock/status') !== 0) {
      input += (input.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(t);
    }
  } catch {}
  return _rawFetch(input, init);
};
async function post(p, obj) {
  try {
    const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj || {}) });
    return await r.json();
  } catch { return { ok: false, error: '网络错误' }; }
}
// 本设备短 ID：开发者端「在线设备」里靠它区分是谁（例如手机是仅查看端，电脑是开发者端）
function myDeviceId() {
  try {
    let id = localStorage.getItem('qd_did');
    if (!id) {
      id = (navigator.userAgent && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 'P' : 'D') +
        Math.random().toString(36).slice(2, 8).toUpperCase();
      localStorage.setItem('qd_did', id);
    }
    return id;
  } catch { return 'D------'; }
}
const MY_DID = myDeviceId();
// 本机指纹：一台设备一个，登录时交给服务端。同一个电脑反复登录只更新那一条记录，
// 不再像旧版那样每解锁一次就堆一条（面板里「已授权设备」曾多达几十条）。
function myDeviceFp() {
  try {
    let fp = localStorage.getItem('qd_fp');
    if (!fp) { fp = 'F' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem('qd_fp', fp); }
    return fp;
  } catch { return ''; }
}
const MY_FP = myDeviceFp();
function deviceName() {
  const ua = navigator.userAgent || '';
  let os = '设备';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iPhone/iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return os + ' ' + new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function paintLock() {
  const a = document.getElementById('srcArea');
  if (a) a.style.display = (LOCK.unlocked && LOCK.hasPassword && CUR_ROLE !== 'view') ? '' : 'none';
  applyRoleUI();
}
// 开发者面板标签页切换
function lockTab(name) {
  document.querySelectorAll('#lockPanel .locktab').forEach(d => { d.style.display = (d.getAttribute('data-tab') === name) ? 'block' : 'none'; });
  document.querySelectorAll('#lockTabs .ltab-btn').forEach(b => { b.classList.toggle('active', b.getAttribute('data-t') === name); });
  // 切到"观看"就顺手把当前只读口令与失效策略显示出来：省得第一步就得先点一下才知道有没有设过
  if (name === 'view' && typeof renderViewPwdState === 'function') renderViewPwdState();
}
// 顶部速跳导航：把每个 .sec 区块做成可点击的药丸，开发者/只读都能一键跳转，不用一路往下翻
function buildSecNav() {
  const nav = document.getElementById('secNav');
  if (!nav) return;
  nav.innerHTML = '';
  document.querySelectorAll('div.sec').forEach((s, i) => {
    if (s.id === 'holdSec1' && CUR_ROLE !== 'edit') return;   // 只读看不到「我的持仓」
    if (!s.id) s.id = 'secNav_' + i;
    const a = document.createElement('a');
    a.textContent = s.textContent.trim();
    a.href = 'javascript:void(0)';
    a.onclick = () => navJump(s, a);
    nav.appendChild(a);
  });
}
// 跳转到指定区块：用 window.scrollTo 显式算出落点，避开吸顶导航条的遮挡。
// 关键点：导航条在手机上会换行成多行、实际高度远大于写死的 56px，
// 用固定的 scroll-margin-top 会让目标落在导航条下面（看起来像「没跳/跳歪」）。
// 这里实时量导航条真实高度来偏置；目标被隐藏时回退到下一个可见块；点击给高亮反馈。
function navJump(s, a) {
  let t = s;
  if (t.offsetParent === null) {                 // 目标隐藏（如持仓区尚未加载）→ 滚到后面第一个可见块
    let n = t.nextElementSibling;
    while (n && n.offsetParent === null) n = n.nextElementSibling;
    if (n) t = n;
  }
  const nav = document.getElementById('secNav');
  const navH = nav ? nav.getBoundingClientRect().height : 0;
  const y = t.getBoundingClientRect().top + window.pageYOffset - navH - 8;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  document.querySelectorAll('#secNav a.cur').forEach(x => x.classList.remove('cur'));
  if (a) a.classList.add('cur');
}
function lockTip(t, isErr) {
  const el = document.getElementById('lockTip');
  if (el) { el.textContent = t; el.style.color = isErr ? '#c92a2a' : '#2b8a3e'; }
  pageMsg(t, isErr ? 'err' : 'ok');
}
function toggleLockPanel() {
  const p = document.getElementById('lockPanel');
  if (!p) return;
  p.style.display = p.style.display === 'none' ? '' : 'none';
  if (p.style.display !== 'none' && LOCK.unlocked) { loadDevices(); loadOnlineDevices(); }
}
// 开发者锁面板打开时，在线设备列表自动刷新，手机（仅查看端）一上线就能看到
setInterval(() => {
  const p = document.getElementById('lockPanel');
  if (p && p.style.display !== 'none' && LOCK.unlocked && typeof loadOnlineDevices === 'function') loadOnlineDevices();
}, 15000);
// 开发者锁面板的粘贴兜底（和登录弹窗同一套）
function lockClean() {
  const i = document.getElementById('lockPwd'); if (!i) return;
  const v = (i.value || '').replace(/[\s\u200b-\u200f\ufeff]/g, '');
  if (v !== i.value) i.value = v;
}
async function lockPaste() {
  const i = document.getElementById('lockPwd'); if (!i) return;
  try {
    const txt = await navigator.clipboard.readText();
    const v = (txt || '').replace(/[\s\u200b-\u200f\ufeff]/g, '');
    if (!v) return lockTip('剪贴板是空的，或浏览器不允许读取', true);
    i.value = v; i.focus(); lockTip('已从剪贴板填入 ' + v.length + ' 位');
  } catch (e) { i.focus(); try { i.select(); } catch {} lockTip('浏览器不允许自动读剪贴板，请按 Ctrl+V', true); }
}
function lockEye() {
  const i = document.getElementById('lockPwd'); if (!i) return;
  i.type = i.type === 'password' ? 'text' : 'password'; i.focus();
}
async function doUnlock() {
  const pwd = (document.getElementById('lockPwd').value || '').replace(/[\s\u200b-\u200f\ufeff]/g, '');
  if ((document.getElementById('lockPwd2').value || '').trim()) return doChangePwd();
  if (!pwd) return lockTip('请输入口令', true);
  let r = await post('/api/lock/unlock', { password: pwd, role: 'edit' });
  if (r.needSetup || (!r.ok && !LOCK.hasPassword)) {
    r = await post('/api/lock/setup', { password: pwd, role: 'edit' });
    if (!r.ok) return lockTip('设置失败：' + (r.error || ''), true);
  }
  if (!r.ok) return lockTip('❌ ' + (r.error || '口令错误'), true);
  const tr = await post('/api/lock/trust', { password: pwd, name: deviceName(), role: 'edit', fp: MY_FP });
  LOCK.hasPassword = true;
  LOCK.token = (tr && tr.deviceToken) || r.token || '';
  GATE.token = LOCK.token; GATE.passed = true; GATE.device = !!(tr && tr.deviceToken);
  if (GATE.device) localStorage.setItem('qd_device', LOCK.token);
  LOCK.unlocked = true;
  document.getElementById('lockPwd').value = '';
  lockTip(GATE.device ? '✅ 已解锁，本设备已加入信任名单（长期免密·开发者）' : '✅ 已解锁（60分钟有效·开发者）');
  paintLock(); syncRole(); loadDevices();
}
async function doChangePwd() {
  const pwd = (document.getElementById('lockPwd').value || '').replace(/[\s\u200b-\u200f\ufeff]/g, '');
  const npwd = (document.getElementById('lockPwd2').value || '').replace(/[\s\u200b-\u200f\ufeff]/g, '');
  if (!pwd || !npwd) return lockTip('改密需填写：原密码 + 新密码', true);
  const r = await post('/api/lock/change', { password: pwd, newPassword: npwd, token: LOCK.token });
  if (!r.ok) return lockTip('❌ ' + (r.error || '改密失败'), true);
  LOCK.token = r.token; GATE.token = r.token; LOCK.unlocked = true;
  if (GATE.device) localStorage.setItem('qd_device', r.token);
  document.getElementById('lockPwd').value = ''; document.getElementById('lockPwd2').value = '';
  lockTip('✅ 密码已更新'); paintLock(); loadDevices();
}
function doLock() {
  LOCK.unlocked = false; LOCK.token = ''; GATE.token = '';
  document.getElementById('lockPwd').value = ''; document.getElementById('lockPwd2').value = '';
  lockTip('🔒 已锁定，修改源码/清盘/改配置需重新验证'); paintLock();
}
// ── 设备台账统一渲染：同一个 IP（同一台电脑 / 同一个网络出口）自动归为一组，默认折叠 ──
// 同一个 IP 不再拉成几十行：组标题上一眼看到「这个 IP 有几台、几个开发者几个只读、最近谁在」，
// 点标题展开看明细。折叠状态记在 localStorage，下次打开保持原样。
const DEVFOLD_KEY = 'qd_devfold';
let _devFold = (() => { try { return new Set(JSON.parse(localStorage.getItem(DEVFOLD_KEY) || '[]')); } catch { return new Set(); } })();
function _saveDevFold() { try { localStorage.setItem(DEVFOLD_KEY, JSON.stringify([..._devFold])); } catch {} }
function _foldKey(ip) { return 'ip_' + String(ip || '未知').replace(/[^0-9a-zA-Z.]/g, '_'); }
function devFoldToggle(key) {
  if (_devFold.has(key)) _devFold.delete(key); else _devFold.add(key);
  _saveDevFold();
  const box = document.getElementById('rows_' + key); if (box) box.style.display = _devFold.has(key) ? 'none' : '';
  const ico = document.getElementById('ico_' + key); if (ico) ico.textContent = _devFold.has(key) ? '▶' : '▼';
}
function devFoldAll(open) {
  document.querySelectorAll('[id^="rows_ip_"]').forEach(b => {
    const key = b.id.slice(5);
    if (open) _devFold.delete(key); else _devFold.add(key);
    b.style.display = open ? '' : 'none';
    const ico = document.getElementById('ico_' + key); if (ico) ico.textContent = open ? '▼' : '▶';
  });
  _saveDevFold();
}
function _ago(ts) {
  if (!ts) return '-';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? s + ' 秒前' : s < 3600 ? Math.round(s / 60) + ' 分钟前' : s < 86400 ? Math.round(s / 3600) + ' 小时前' : Math.round(s / 86400) + ' 天前';
}
function _roleBadge(role) {
  return role === 'edit'
    ? '<span class="tag" style="background:#d3f9d8;color:#2b8a3e;font-size:11px">🔓 开发者</span>'
    : '<span class="tag" style="font-size:11px">👁 只读</span>';
}
// groups 由服务端按 IP 归好类，这里只负责画成可折叠的小组
function renderDevGroups(groups, opt) {
  opt = opt || {};
  return (groups || []).map(g => {
    const key = _foldKey(g.ip);
    const open = !_devFold.has(key);
    const names = (g.names || []).join('、') || '未命名设备';
    const cnt = opt.online ? `🔓 ${g.edit || 0} · 👁 ${g.view || 0}` : `🔓 开发者 ${g.edit || 0} · 👁 只读 ${g.view || 0}`;
    const rows = (g.items || []).map(d => {
      const mine = opt.online && d.id === MY_DID ? ' <span class="muted">(本机)</span>' : '';
      // ⛔ #291：只读设备被自动清理前要能提前看到（后端按交易日口径算好 idleLeftDays，
      //    与真正动手清理的 expireIdleViewDevices 同一把尺子；⛔ 前端不自己算天数，
      //    否则两套口径迟早分叉 —— 「面板剩余小时数与服务端清理时间不一致」正是要避免的）。
      const _left = (d.role === 'view' && typeof d.idleLeftHours === 'number')
        ? (d.idleLeftHours > 0
          ? ` <span class="muted" style="font-size:11px">· 约 ${d.idleLeftHours} 小时后自动清理</span>`
          : ` <span style="font-size:11px;color:#c92a2a">· 已超期，下次清理即移除</span>`)
        : '';
      const tail = opt.online
        ? `<td class="dev-name" data-label="设备">${d.dev || ''} ${d.name || ''}</td><td class="dev-meta" data-label="活跃">${_ago(d.at)}</td>`
        : `<td class="dev-name" data-label="设备">${d.name || '未命名设备'}${_left}</td><td class="dev-meta" data-label="授权时间">${d.at || '-'}</td>` +
          (opt.canRevoke ? `<td class="dev-revoke" data-label=""><button class="btn ghost" style="padding:2px 10px;font-size:12px" onclick="revokeDevice('${d.id}',this)">撤销</button></td>` : '');
      return `<tr><td class="dev-role" data-label="身份">${_roleBadge(d.role)}</td>` +
        `<td class="dev-id" data-label="设备 ID"><b>${d.id || '-'}</b>${mine}</td>${tail}</tr>`;
    }).join('');
    const head = opt.online
      ? '<tr><th>身份</th><th>设备 ID</th><th>设备</th><th>活跃</th></tr>'
      : '<tr><th>身份</th><th>设备 ID</th><th>设备</th><th>授权时间</th>' + (opt.canRevoke ? '<th>操作</th>' : '') + '</tr>';
    return `<div style="border:1px solid #e9ecef;border-radius:6px;margin:4px 0;background:#fff;overflow:hidden">
      <div onclick="devFoldToggle('${key}')" style="cursor:pointer;display:flex;gap:8px;align-items:center;padding:5px 8px;background:#f8f9fa;flex-wrap:wrap">
        <span id="ico_${key}" style="width:12px;color:#868e96">${open ? '▼' : '▶'}</span>
        <span style="font-size:12px">📍 <b>${g.ip || '未知 IP'}</b></span>
        <span class="tag" style="font-size:11px">${g.n} 台</span>
        <span class="muted" style="font-size:11px">${cnt}</span>
        <span class="muted" style="font-size:11px;white-space:normal">${names}</span>
        <span class="muted" style="font-size:11px;margin-left:auto">${_ago(g.last)}</span>
      </div>
      <div id="rows_${key}" style="display:${open ? '' : 'none'};padding:4px 8px"><table class="dev-table" style="font-size:12px">${head}${rows}</table></div>
    </div>`;
  }).join('');
}
function _groupsHead(groups, items, unit) {
  const n = (items || []).length, ips = (groups || []).length;
  return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
    <span style="font-size:12px">共 <b>${n}</b> ${unit || '条授权'} · <b>${ips}</b> 个 IP（同一个 IP 已自动归为一组）</span>
    <button class="btn ghost" style="padding:2px 10px;font-size:12px" onclick="devFoldAll(true)">全部展开</button>
    <button class="btn ghost" style="padding:2px 10px;font-size:12px" onclick="devFoldAll(false)">全部收起</button>
  </div>`;
}
function _dedupeByIpRole(items){
  const m = new Map();
  for (const it of items || []) {
    const k = (it.ip || '-') + '|' + (it.role || 'view');
    const old = m.get(k);
    if (!old || (it.ts || 0) > (old.ts || 0)) m.set(k, it);
  }
  return [...m.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
async function loadDevices() {
  const box = document.getElementById('devList');
  if (!box) return;
  if (!LOCK.unlocked) { box.textContent = '解锁后可查看'; return; }
  const r = await fetch('/api/lock/devices?token=' + encodeURIComponent(LOCK.token)).then(x => x.json()).catch(() => ({}));
  if (!r.ok) { box.innerHTML = '<span style="color:#c92a2a">读取失败：' + (r.error || '') + '</span>'; return; }
  const allItems = r.items || [];
  if (!allItems.length) { box.textContent = '暂无授权设备（本机无需授权）'; return; }
  const showAll = box.dataset.showAll === '1';
  const RECENT_MS = 7 * 24 * 3600 * 1000;
  const now = Date.now();
  const activeItems = allItems.filter(d => !d.revoked && (d.ts || 0) > now - RECENT_MS);
  const displayItems = showAll ? allItems : _dedupeByIpRole(activeItems.length ? activeItems : allItems).slice(0, 5);
  const dispIds = new Set(displayItems.map(d => d.id));
  const groups = r.groups
    ? (r.groups || []).map(g => ({ ...g, items: (g.items || []).filter(d => dispIds.has(d.id)) })).filter(g => g.items.length)
    : groupByIpLocal(displayItems);
  const hidden = allItems.length - displayItems.length;
  const toggleBtn = hidden > 0
    ? `<button class="btn ghost" style="padding:2px 10px;font-size:12px" onclick="document.getElementById('devList').dataset.showAll='${showAll?'0':'1'}';loadDevices()">${showAll?'收起':'显示全部 (' + hidden + ' 条历史记录)'}</button>`
    : '';
  box.innerHTML = _groupsHead(groups, displayItems, '台有效设备') +
    renderDevGroups(groups, { canRevoke: true }) +
    `<div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap">${toggleBtn}<button class="btn ghost" style="padding:2px 10px;font-size:12px" onclick="pruneDevices()">🧹 合并重复 / 清理 30 天没露面的</button></div>` +
    '<span class="muted" style="font-size:11px;white-space:normal">默认每台设备（同一 IP + 身份）只显示最新一条，避免同一设备反复登录把页面撑满；撤销后该设备下次打开需重新输口令。</span>';
  loadPending();   // 顺带刷新待确认只读设备
}
// 有待确认申请时能自动冒出来，不用手动点刷新（页面在后台时不空转）
setInterval(() => { if (!document.hidden && LOCK.unlocked) loadPending(); }, 15000);
// 🔐 待确认只读设备：开发者在这里放行/拒绝
async function loadPending() {
  const box = document.getElementById('pendingList');
  if (!box) return;
  if (!LOCK.unlocked) { box.textContent = '解锁后可查看'; return; }
  const r = await post('/api/lock/pending-list', { token: LOCK.token });
  if (!r.ok) { box.innerHTML = '<span style="color:#c92a2a">读取失败：' + (r.error || '') + '</span>'; return; }
  const list = r.list || [];
  const ST = { pending: '⏳ 待确认', allowed: '✅ 已放行', denied: '✖ 已拒绝', superseded: '♻️ 已作废（被该设备的新申请取代）' };
  const recent = r.recent || [];
  const tail = '<span class="muted" style="font-size:11px;white-space:normal">'
    + '允许后对方页面会自动进入；同一台设备以后免确认。同一台设备/IP 只保留最新一条申请，旧的自动作废。'
    + '状态：⏳待确认 / ✅已放行（对方取走令牌即消除）/ ✖已拒绝 / ♻️已作废 / 24小时未处理自动清除。'
    + '</span>';
  const recentHtml = recent.length
    ? '<div class="muted" style="font-size:11px;white-space:normal;margin-top:4px">最近处理：'
      + recent.map(x => `${x.name || '只读设备'}（${x.ip || '-'}）${ST[x.state] || x.state}`).join('；') + '</div>'
    : '';
  if (!list.length) {
    box.innerHTML = '<span class="muted">暂无待确认申请（对方输对观看密码后会出现在这里）</span>' + recentHtml + tail;
    return;
  }
  box.innerHTML = list.map(it =>
    `<div style="border:1px solid #ffd8a8;background:#fffbf2;border-radius:8px;padding:6px 8px;margin:3px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
       <b>${it.name || '只读设备'}</b>
       <span class="muted">IP ${it.ip || '-'}</span>
       <span class="muted">${it.at || ''}</span>
       <span style="flex:1"></span>
       <button class="btn" style="padding:4px 12px;font-size:12px" onclick="approvePending('${it.req}',true)">✅ 允许</button>
       <button class="btn ghost" style="padding:4px 12px;font-size:12px;color:#c92a2a" onclick="approvePending('${it.req}',false)">✖ 拒绝</button>
     </div>`).join('') + recentHtml + tail;
}
async function approvePending(req, allow) {
  const r = await post('/api/lock/pending-approve', { req, allow, token: LOCK.token });
  if (!r.ok) return pageMsg('❌ ' + (r.error || '操作失败'), 'err');
  pageMsg(allow ? '✅ 已放行，对方页面会自动进入' : '已拒绝该设备', 'ok');
  loadPending(); loadViewDevices();
}
async function pruneDevices() {
  const r = await post('/api/lock/devices', { action: 'prune', days: 30, token: LOCK.token });
  pageMsg(r.ok ? ('✅ ' + (r.note || '已清理')) : ('清理失败：' + (r.error || '')), r.ok ? 'ok' : 'err');
  if (r.ok) { loadDevices(); loadViewDevices(); }
}
// 服务端没返回 groups 时的本地兜底归类（老版本服务端兼容）
function groupByIpLocal(items) {
  const m = new Map();
  for (const it of items || []) {
    const k = (it.ip || '未知 IP') || '未知 IP';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return [...m.entries()].map(([ip, list]) => ({
    ip, n: list.length,
    edit: list.filter(x => x.role === 'edit').length,
    view: list.filter(x => x.role === 'view').length,
    last: Math.max(0, ...list.map(x => x.ts || 0)),
    names: [...new Set(list.map(x => x.name || '未命名设备'))].slice(0, 3),
    items: list
  })).sort((a, b) => b.last - a.last);
}
// 只看「通过观看密码登录」的设备：在观看密码分区就地渲染，避免点了没反应
async function loadViewDevices() {
  const box = document.getElementById('viewDevList');
  if (!box) return;
  if (!LOCK.unlocked) { box.textContent = '解锁后可查看'; return; }
  const r = await fetch('/api/lock/devices?token=' + encodeURIComponent(LOCK.token)).then(x => x.json()).catch(() => ({}));
  if (!r.ok) { box.innerHTML = '<span style="color:#c92a2a">读取失败：' + (r.error || '') + '</span>'; return; }
  const items = (r.items || []).filter(d => d.role === 'view');
  if (!items.length) { box.innerHTML = '暂无通过观看密码登录的设备（本机无需授权；别人用观看密码登录后才会出现在这里）'; return; }
  const groups = groupByIpLocal(items);
  box.innerHTML = _groupsHead(groups, items, '个只读设备') +
    renderDevGroups(groups, { canRevoke: true }) +
    '<span class="muted" style="font-size:11px">撤销后该观看设备下次打开需重新输观看密码。</span>';
}
// 生成 6 位登录授权码：给另一台设备手打登录用（同时推一份到手机）
async function genAuthCode() {
  const box = document.getElementById('authCodeBox'); if (!box) return;
  if (!LOCK.unlocked) { box.textContent = '解锁开发者后可生成'; return; }
  box.textContent = '生成中…';
  const r = await post('/api/auth/code', { token: LOCK.token, role: 'edit' });
  if (!r.ok) { box.innerHTML = '<span style="color:#c92a2a">生成失败：' + (r.error || '') + '</span>'; return; }
  box.innerHTML = `<div style="font-size:30px;font-weight:800;letter-spacing:10px;color:#4263eb;line-height:1.4">${r.code}</div>` +
    '<div class="muted" style="font-size:12px;white-space:normal">10 分钟内有效，用后即焚（已同时推送到你的手机）。' +
    '在另一台设备：<b>右上角「🔑 身份」→ 打开登录窗口</b>，把这 6 位数字敲进「6位授权码」框 → 点「🔢 用授权码登录」。</div>' +
    '<div style="margin-top:4px"><button class="btn ghost" style="padding:2px 10px;font-size:12px" onclick="copyAuthCode(\'' + r.code + '\')">📋 复制这 6 位</button>' +
    '<button class="btn ghost" style="padding:2px 10px;font-size:12px;margin-left:6px" onclick="openLogin()">🔑 在本机打开登录窗口</button></div>';
}
async function copyAuthCode(code) {
  try {
    await navigator.clipboard.writeText(String(code));
    pageMsg('已复制授权码 ' + code, 'ok');
  } catch { pageMsg('浏览器不允许复制，请手动记下：' + code, 'warn'); }
}
// 在线设备（实时）：SSE 长连接台账，能看到「仅查看端」的 ID 与登录身份
async function loadOnlineDevices() {
  const box = document.getElementById('onlineDevList');
  if (!box) return;
  const my = document.getElementById('myDid'); if (my) my.textContent = MY_DID;
  if (!LOCK.unlocked) { box.textContent = '解锁后可查看'; return; }
  const r = await fetch('/api/devices?token=' + encodeURIComponent(LOCK.token || GATE.token || '') + '&_=' + Date.now())
    .then(x => x.json()).catch(() => ({}));
  if (!r.ok) { box.innerHTML = '<span style="color:#c92a2a">读取失败：' + (r.error || '需要开发者权限') + '</span>'; return; }
  const items = r.items || [];
  if (!items.length) { box.innerHTML = '当前没有其他在线页面（只有本机自己）'; return; }
  box.innerHTML = `<div style="font-size:12px;margin-bottom:4px">共 <b>${items.length}</b> 台在线：🔓 开发者 ${r.edit || 0} · 👁 仅查看 ${r.view || 0}</div>` +
    _groupsHead(r.groups, items, '台在线') +
    renderDevGroups(r.groups || groupByIpLocal(items), { online: true }) +
    '<span class="muted" style="font-size:11px;white-space:normal">「仅查看」= 用观看密码登录的设备，看不到你的持仓、也改不了任何东西。想收回它的观看权，到上面「观看密码」区撤销对应设备。</span>';
}
// 只读密码：当前到底是什么、多久不用会失效，都得在面板里看得见。
// 开发者自己的密码明文回显（2026-10-03 用户要求：开发者页面要能看到开发者密码）
// 与只读密码同一套口径：服务端只存加盐哈希、不可能反推，所以能不能显示取决于
// 「本次进程里有没有人设置/登录/修改/找回过」。如实区分「没值」和「没设置」，别让人误以为丢了。
async function renderDevPwdState() {
  const t0 = document.getElementById('devPwdTip');
  if (!t0) return;
  let st = {};
  // ⛔ 同 renderViewPwdState：必须带令牌，否则远程开发者会话认不出身份 → 拿不到明文。
  const _dt = GATE.token || LOCK.token || localStorage.getItem('qd_device') || localStorage.getItem('qd_token') || '';
  try { st = await fetch('/api/lock/status' + (_dt ? '?token=' + encodeURIComponent(_dt) : ''), { cache: 'no-store' }).then(r => r.json()); } catch { return; }
  if (!st.hasPassword) { t0.innerHTML = '⚠️ 还没有设置开发者密码：在左边填一个（≥4 位）再点「解锁 / 首次设置」'; return; }
  t0.textContent = '✅ 开发者密码已设置（安全起见不显示原密码）。可使用修改密码功能更换。';
}
// 过去只有"设置一个新口令"这一条路，想知道现在是什么只能去问人 —— 服务端只存哈希、
// 明文仅保留在内存里，重启后就空了。这里如实区分「不知道」和「没设置」，别让人误以为丢了。
async function renderViewPwdState() {
  const t0 = document.getElementById('viewPwdTip');
  if (!t0) return;
  let st = {};
  // ⛔ 必须带上令牌，不能裸 GET：/api/lock/status 只在认出「开发者本人」时才回 viewPwd，
  //    而 SERVER 侧认人的渠道是 token（远程会话不是 isLocalReq）。不带 → role0=null →
  //    明明设过密码、你本人也刚解锁，面板却显示"重启后还没人用过"——一句假话。
  //    跟 syncRole() 用同一套取令牌顺序，两处口径一致。
  const _dt = GATE.token || LOCK.token || localStorage.getItem('qd_device') || localStorage.getItem('qd_token') || '';
  try { st = await fetch('/api/lock/status' + (_dt ? '?token=' + encodeURIComponent(_dt) : ''), { cache: 'no-store' }).then(r => r.json()); } catch { return; }
  const idle = st.viewIdleHours || 0;
  const policy = idle ? `<br><span class="muted">⏳ 只读设备如果连续 ${idle} 小时没有任何在线访问会自动失效，再次使用必须重新向你申请放行。</span>` : '';
  if (!st.hasViewPassword) {
    t0.innerHTML = '⚠️ 还没有设置只读密码：在左边填一个（≥4 位）再点「设置 / 修改」' + policy;
    return;
  }
  t0.textContent = '✅ 只读密码已设置（安全起见不显示原密码）。如需更换，请在左侧设置新密码。';
}
// 设置/重置 只读密码（需先解锁开发者身份）
async function setViewPwd() {
  const inp = document.getElementById('viewPwd');
  const p = (inp && inp.value || '').trim();
  if (!p || p.length < 4) return lockTip('只读密码至少 4 位', true);
  // ⛔ 修改 = 全部只读设备当场作废（它们要重新申请）。这是有代价的操作，必须先说清楚再动手，
  //    不能像"改个昵称"一样点了才发现看盘的人都掉线了。
  // ⛔ gj 轮：改成页内确认框。原生 confirm 在深色模式下是近黑底色的对话框（用户反馈的
  //    "偶发黑色弹窗"就是它），而且塞不进这么长的说明、不支持 Esc 取消。
  if (GATE.hasViewPassword && !(await uiConfirm('修改只读密码会让【所有已授权的只读设备】立即失效，它们下次需要重新向你申请、由你放行。\n\n确定要改成新的吗？', '确定修改', '取消'))) {
    return lockTip('已取消：只读密码未改动', true);
  }
  if (!await requireUnlock('修改只读密码')) return;
  const r = await post('/api/lock/change', { role: 'view', newPassword: p, token: LOCK.token });
  if (!r.ok) return lockTip('❌ ' + (r.error || '修改失败'), true);
  if (inp) inp.value = '';
  GATE.hasViewPassword = true;
  lockTip((r.unchanged ? '✅ 只读密码没变（已授权的只读设备不受影响）' : '✅ 只读密码已修改：' + (r.note || '')));
  renderViewPwdState();
  loadDevices();
}
// ── 找回手机号：忘记开发者密码时的自救通道（只保留加盐哈希，明文不出服务端）──
async function loadBindPhone() {
  try {
    const st = await fetch('/api/lock/phone').then(r => r.json());
    const t = document.getElementById('bindPhoneTip');
    if (!t) return;
    if (st.bound) t.innerHTML = '✅ 已绑定找回手机号：<b style="font-family:monospace">' + (st.masked || '') + '</b>　忘记密码时用它在登录页取验证码';
    else t.innerHTML = '⚠️ 尚未绑定找回手机号，忘记密码将无法自救';
  } catch {}
}
async function saveBindPhone() {
  const inp = document.getElementById('bindPhone');
  const ph = (inp && inp.value || '').trim();
  if (!/^\d{7,15}$/.test(ph.replace(/[^\d]/g, ''))) return lockTip('手机号格式不对（只要数字，7-15位）', true);
  if (!await requireUnlock('修改找回手机号')) return;
  const r = await post('/api/lock/bind-phone', { phone: ph, token: LOCK.token });
  if (!r.ok) return lockTip('❌ ' + (r.error || '绑定失败'), true);
  if (inp) inp.value = '';
  loadBindPhone();
  lockTip('✅ 找回手机号已更新为 ' + (r.masked || ''));
}
// 发一条真实验证码到手机：顺便验证飞书通道此刻是通的
async function testOtp() {
  if (!await requireUnlock('发送测试验证码')) return;
  const r = await post('/api/lock/forgot', { phone: (document.getElementById('bindPhone') || {}).value || '0' });
  const t = document.getElementById('bindPhoneTip');
  if (r.ok) {
    lockTip('✅ 验证码已推送到手机' + (r.devCode ? '（本机可见：' + r.devCode + '）' : '') + '，5 分钟内有效');
  } else lockTip('⚠️ ' + (r.error || '发送失败'), true);
}
async function revokeDevice(id, btn) {
  if (btn && btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1'; btn.textContent = '再点确认';
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = '撤销'; }, 4000);
    pageMsg('再点一次确认撤销该设备授权', 'warn'); return;
  }
  const r = await post('/api/lock/revoke', { id, token: LOCK.token });
  pageMsg(r.ok ? ('已撤销 ' + (r.revoked || 0) + ' 个设备授权，该设备需重新输口令') : ('撤销失败：' + (r.error || '')), r.ok ? 'ok' : 'err');
  loadDevices();
}
async function requireUnlock(what) {
  if (CUR_ROLE === 'view') {
    pageMsg('当前是只读（观看）权限，' + (what || '该操作') + '不被允许', 'err');
    return false;
  }
  if (LOCK.unlocked) return true;
  pageMsg((what || '该操作需要验证密码') + '：请先在开发者锁面板解锁', 'warn');
  const p = document.getElementById('lockPanel'); if (p) p.style.display = '';
  const i = document.getElementById('lockPwd'); if (i) i.focus();
  return false;
}
async function loadSrc() {
  const f = document.getElementById('srcFile').value;
  if (!await requireUnlock('读取源码')) return;
  const r = await fetch('/api/source?file=' + encodeURIComponent(f) + '&token=' + encodeURIComponent(LOCK.token)).then(x => x.json()).catch(() => ({}));
  if (!r.ok) return pageMsg('读取失败：' + (r.error || ''), 'err');
  document.getElementById('srcEdit').value = r.content;
  pageMsg('已读取 ' + f + '（' + r.content.length + ' 字符）', 'ok');
}
async function saveSrc() {
  const f = document.getElementById('srcFile').value;
  const content = document.getElementById('srcEdit').value;
  if (!await requireUnlock('修改源码')) return;
  if (!content || !content.trim()) return pageMsg('内容为空，拒绝保存', 'err');
  const r = await post('/api/source', { file: f, content, token: LOCK.token });
  pageMsg(r.ok ? ('✅ ' + f + ' 已保存于 ' + r.time + '（原文件已备份 .bak）') : ('保存失败：' + (r.error || '')), r.ok ? 'ok' : 'err');
}


// 复制所有源码：聚合白名单源码（server.js + 全部根目录 *.js + public/index.html + package.json，
// 排除 node_modules/.kline_cache/凭据与业务数据 json/自动生成的 package-lock.json）复制到剪贴板；
// 内容过大（剪贴板有上限）时自动下载为 all-source.txt，保证总能拿到完整源码。仅开发者可触发。
async function copyAllSource() {
  const st = document.getElementById('copySrcState');
  try {
    if (!await requireUnlock('复制源码')) return;
    st.textContent = '正在拉取源码…';
    // 后端返回 JSON：{ ok, count, size, source }（与 /api/source 一致；routes_smoke 要求 200 均为合法 JSON）
    const data = await fetch('/api/source-all?token=' + encodeURIComponent(LOCK.token)).then(x => x.json()).catch(() => null);
    if (!data || typeof data.source !== 'string' || !data.source.length) { st.textContent = '拉取失败（网络/鉴权/空内容）'; return; }
    const r = data.source;
    const sizeKB = (r.length / 1024).toFixed(0);
    try {
      await navigator.clipboard.writeText(r);
      st.textContent = '✅ 已复制全部源码到剪贴板（约 ' + sizeKB + ' KB）';
    } catch (_) {
      const blob = new Blob([r], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'all-source.txt';
      document.body.appendChild(a); a.click(); a.remove();
      st.textContent = '⚠️ 剪贴板不可用，已自动下载 all-source.txt（约 ' + sizeKB + ' KB）';
    }
  } catch (e) {
    st.textContent = '复制失败：' + ((e && e.message) || e);
  }
}
// 本机免密；手机/其它电脑首次打开必须先输口令（或首次设定口令），验证通过后该设备长期免密
(async () => {
  try {
    if (await checkAppVer()) return; // 版本不一致已强制刷新，后续不再执行
    const st = await fetch('/api/lock/status').then(r => r.json());
    GATE.hasPassword = !!st.hasPassword; LOCK.hasPassword = !!st.hasPassword;
    GATE.hasViewPassword = !!st.hasViewPassword;
    const savedMode = localStorage.getItem('qd_role');
    if (st.local) { GATE.passed = true; GATE.device = true; LOCK.unlocked = true; paintLock(); await syncRole(); return; } // 本机免密
    if (savedMode) GATE.mode = savedMode === 'edit' ? 'edit' : 'view';
    const dev = localStorage.getItem('qd_device');
    // probe 返回 null = 网络问题无法判定 → 也放行（弱网下绝不把已授权设备踢回登录页）
    if (dev && await probe(dev) !== false) return applyToken(dev, true);   // 已授权设备：长期免密
    const saved = localStorage.getItem('qd_token');
    if (saved && await probe(saved) !== false) return applyToken(saved, false); // 兼容旧的会话 token
    // 之前提交过只读申请还没被处理：直接回到等待页，不用重新输密码
    const pend = localStorage.getItem(PENDING_KEY);
    if (pend) { showGate(); gateWaitApproval(pend); return; }
    showGate();
  } catch { GATE.passed = true; }
})();
async function probe(t) {
  // ⚠️ 手机登录不稳定的根因就在这里：旧实现用 /api/state 判定令牌是否有效，
  //    而手机上这个接口常因为弱网/后台冻结而超时，一超时 catch 就返回 false，
  //    于是「明明已经授权过的设备」每次开页面都被踢回登录页，看起来像登录失效。
  //  改法：① 改用极轻量的 /api/lock/status 判定（不再拉全量行情）；
  //        ② 网络失败 ≠ 令牌失效，重试 2 次仍失败就返回 null（无法判定），调用方按"有效"放行。
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch('/api/lock/status?token=' + encodeURIComponent(t), { cache: 'no-store' });
      if (!r.ok) { await new Promise(s => setTimeout(s, 800)); continue; }
      const j = await r.json();
      if (j && j.locked) return false;
      return !!(j && (j.local || j.role));   // 明确拿到身份才算有效
    } catch { await new Promise(s => setTimeout(s, 800)); }
  }
  return null;   // 两次都栽在网络上：不做判定，避免误踢
}
function applyToken(t, isDevice, role) {
  role = role || 'edit';
  // 只读令牌不能当作开发者令牌使用：只有开发者才能拿到 LOCK 写权限
  if (role === 'view') { LOCK.unlocked = false; LOCK.token = ''; }
  else { LOCK.token = t; LOCK.unlocked = true; }
  GATE.passed = true; GATE.token = t; GATE.device = !!isDevice; GATE.role = role;
  localStorage.setItem(isDevice ? 'qd_device' : 'qd_token', t);
  localStorage.setItem('qd_role', role);
  const g = document.getElementById('gate'); if (g) g.style.display = 'none';
  const el = document.getElementById('lockTip');
  if (el) {
    el.textContent = role === 'view'
      ? '👁 观看模式：可看行情，不能修改，也看不到「我的持仓」'
      : (isDevice ? '✅ 本设备已授权：长期免密（开发者）' : '✅ 已解锁（60分钟有效·开发者）');
    el.style.color = role === 'view' ? '#495057' : '#2b8a3e';
  }
  connectStream(); // 带上凭证重建实时通道
  paintLock(); syncRole(); refresh();
}
function gateRoleUI() {
  const m = GATE.mode || 'edit';
  const bv = document.getElementById('gateTabView'), be = document.getElementById('gateTabEdit');
  if (bv) bv.className = 'btn ' + (m === 'view' ? '' : 'ghost');
  if (be) be.className = 'btn ' + (m === 'edit' ? '' : 'ghost');
  const i = document.getElementById('gatePwd');
  if (i) i.placeholder = m === 'view' ? '请输入观看密码（只读）' : '请输入开发者密码（可编辑）';
  const tip = document.getElementById('gateHint');
  if (tip) tip.textContent = m === 'view'
    ? '观看模式：可看全部行情与信号，不能改配置/源码/模拟盘，也不显示「我的持仓」'
    : '开发者模式：可修改推送配置、源码、模拟盘，并能查看与管理「我的持仓」';
}
function gateRole(m) {
  GATE.mode = m;
  localStorage.setItem('qd_role', m);
  gateRoleUI();
  // 只切身份，不再清空输入框：以前粘完密码再点身份按钮，密码会被抹掉，看着就像"粘贴无效"
  const i = document.getElementById('gatePwd'); if (i) i.focus();
  const t = document.getElementById('gateTip'); if (t) t.textContent = '';
}
// 粘贴兜底：Ctrl+V 在某些浏览器/远程桌面/手机上会失效，这里给一个按钮直接读剪贴板
async function gatePaste() {
  const i = document.getElementById('gatePwd'); if (!i) return;
  const tip = (msg, err) => { const t = document.getElementById('gateTip'); if (t) { t.textContent = msg; t.style.color = err ? '#c92a2a' : '#2b8a3e'; } };
  try {
    const txt = await navigator.clipboard.readText();
    const v = (txt || '').replace(/[\s\u200b-\u200f\ufeff]/g, '');
    if (!v) { tip('剪贴板是空的，或浏览器不允许读取 —— 请先复制口令再点这里', true); i.focus(); return; }
    i.value = v; i.focus(); gateLen();
    tip('已从剪贴板填入 ' + v.length + ' 位，点「验证 / 设置」进入');
  } catch (e) {
    // 浏览器拒绝读剪贴板：退化成"帮你选中输入框，手动 Ctrl+V"
    i.focus(); try { i.select(); } catch {}
    tip('浏览器不允许自动读剪贴板，已选中输入框，请按 Ctrl+V（或右键→粘贴）', true);
  }
}
// 清掉粘贴带来的空格/换行/不可见字符，避免"看着输进去了却提示密码错误"
function gateClean() {
  const i = document.getElementById('gatePwd'); if (!i) return;
  const v = (i.value || '').replace(/[\s\u200b-\u200f\ufeff]/g, '');
  if (v !== i.value) i.value = v;
  gateLen();
}
function gateLen() {
  const i = document.getElementById('gatePwd'); const t = document.getElementById('gatePwdLen');
  if (i && t) { const n = (i.value || '').length; t.textContent = n ? `已输入 ${n} 位` : ''; }
}
function gateEye() {
  const i = document.getElementById('gatePwd'); if (!i) return;
  i.type = i.type === 'password' ? 'text' : 'password';
  i.focus();
}
// 备用登录通道：6 位授权码，纯数字手打，彻底绕开"粘贴不上"
async function gateRedeem() {
  const i = document.getElementById('gateCode'); if (!i) return;
  const tip = (m, err) => { const t = document.getElementById('gateTip'); if (t) { t.textContent = m; t.style.color = err ? '#c92a2a' : '#2b8a3e'; } };
  const code = (i.value || '').replace(/\D/g, '');
  if (code.length !== 6) return tip('请输入 6 位授权码（纯数字）', true);
  tip('正在验证…');
  const r = await post('/api/auth/redeem', { code, name: deviceName(), fp: MY_FP });
  if (!r.ok) return tip('❌ ' + (r.error || '授权码无效'), true);
  tip('✅ 授权码正确，正在进入…');
  return applyToken(r.deviceToken || r.token, true, r.role || 'edit');
}
// 已登录状态下也能随时叫出登录窗口：换身份登录 / 给另一台设备用授权码登录
function openLogin(msg) {
  GATE.mode = GATE.mode || 'edit';
  showGate(msg || '');
  const i = document.getElementById('gatePwd'); if (i) setTimeout(() => i.focus(), 80);
}
// 退出本机授权：只清本浏览器保存的免密凭证，服务端台账与其它设备不受影响
function logoutHere() {
  try { localStorage.removeItem('qd_device'); localStorage.removeItem('qd_token'); localStorage.removeItem('qd_role'); } catch {}
  GATE.passed = false; GATE.token = ''; GATE.device = false; LOCK.unlocked = false; LOCK.token = '';
  paintLock();
  openLogin('已清除本机凭证，重新输口令或用 6 位授权码登录');
}
function showGate(msg) {
  let g = document.getElementById('gate');
  if (!g) {
    g = document.createElement('div'); g.id = 'gate';
    g.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#f8f9fa;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:inherit;text-align:center;padding:18px';
    g.innerHTML = '<div style="font-size:22px;font-weight:800">📈 量化看盘平台</div>' +
      '<div class="muted" style="font-size:13px;max-width:520px;white-space:normal;line-height:1.6">该设备需验证口令后才能查看数据。请选身份：<b>观看密码</b>＝只看行情；<b>开发者密码</b>＝可编辑，并能查看「我的持仓」。</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
      '<button class="btn ghost" id="gateTabView" onclick="gateRole(\'view\')">👁 观看密码（只读）</button>' +
      '<button class="btn ghost" id="gateTabEdit" onclick="gateRole(\'edit\')">🔓 开发者密码（可编辑）</button></div>' +
      '<div style="display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap">' +
      '<input type="password" id="gatePwd" placeholder="请输入口令" style="padding:10px 14px;width:230px;font-size:15px;border:1px solid #ced4da;border-radius:8px" autocomplete="current-password" spellcheck="false" autocorrect="off" autocapitalize="off" onpaste="setTimeout(gateClean,0)">' +
      '<button class="btn ghost" style="padding:9px 12px;font-size:13px" onclick="gatePaste()" title="Ctrl+V 粘不进来时点这里，直接从剪贴板读取">📋 粘贴</button>' +
      '<button class="btn ghost" style="padding:9px 10px;font-size:13px" onclick="gateEye()" title="显示/隐藏密码，确认自己粘对了没">👁</button>' +
      '</div>' +
      '<div class="muted" id="gatePwdLen" style="font-size:12px;min-height:16px"></div>' +
      '<button class="btn" onclick="gateSubmit()" style="padding:8px 22px;font-size:14px">验证 / 设置</button>' +
      // 备用通道：6 位授权码，纯数字手打即可，绕开一切粘贴问题
      '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #adb5bd;display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap">' +
      '<span class="muted" style="font-size:12px">密码粘不进来？</span>' +
      '<input type="text" id="gateCode" placeholder="6位授权码" maxlength="6" inputmode="numeric" autocomplete="one-time-code" style="padding:8px 10px;width:130px;font-size:16px;text-align:center;letter-spacing:5px;border:1px solid #ced4da;border-radius:8px">' +
      '<button class="btn ghost" style="padding:8px 12px;font-size:13px" onclick="gateRedeem()">🔢 用授权码登录</button>' +
      '</div>' +
      '<div class="muted" style="font-size:12px;max-width:520px;white-space:normal">在<b>已经登录</b>的那台设备（手机或电脑）打开「🔒 开发者锁 → 🔢 登录授权码」点一下生成，把这 6 位数字手打到这里就行 —— 不用粘密码，10 分钟内有效。</div>' +
      '<label class="muted" style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="gateRemember" checked> 记住此设备，以后自动进入</label>' +
      '<div class="muted" style="font-size:12px;max-width:520px;white-space:normal;min-height:18px" id="gateHint"></div>' +
      '<div class="muted" style="font-size:12px;min-height:18px;color:#c92a2a" id="gateTip">' + (msg || '') + '</div>' +
      // ⚠️ 「忘记开发者密码」入口默认隐藏：没绑定找回手机号时点进去才发现走不通，
      //     而且这个按钮挂在登录页上——用户每次被弹回登录都看到它，观感就成了
      //     「你怎么总弹密码找回」。改成查到有绑定号码才显示，并把掩码号写在按钮上。
      '<button class="btn ghost" id="gateForgot" onclick="showForgot()" style="padding:4px 14px;font-size:12px;display:none">🔑 忘记开发者密码？</button>';
    document.body.appendChild(g);
    document.getElementById('gatePwd').onkeydown = e => { if (e.key === 'Enter') gateSubmit(); };
    setTimeout(() => { const i = document.getElementById('gatePwd'); if (i) i.focus(); }, 100);
  }
  g.style.display = 'flex';
  fgMaybeShow();
  gateRoleUI();
  const tip = document.getElementById('gateTip'); if (tip && msg) tip.textContent = msg;
}
async function gateSubmit() {
  // 粘贴口令常带上空格/换行/不可见字符，统一清掉再校验，避免"明明粘对了却提示错误"
  const pwd = (document.getElementById('gatePwd').value || '').replace(/[\s\u200b-\u200f\ufeff]/g, '');
  const remember = (document.getElementById('gateRemember') || {}).checked !== false;
  const role = GATE.mode || 'view';
  if (!pwd) return showGate('请输入口令');
  // ── 观看密码（只读）──
  if (role === 'view') {
    if (!GATE.hasViewPassword) return showGate('❌ 尚未设置观看密码：请先用「开发者密码」登录并在本机面板设置');
    // 自动识别身份：不管选的是哪个页签，服务端根据密码本身判断是开发者还是观看，杜绝"输错页签被判只读/密码错误"
    if (remember) {
      const tr = await post('/api/lock/trust', { password: pwd, name: deviceName(), role: 'auto', fp: MY_FP });
      if (tr.pending && tr.req) return gateWaitApproval(tr.req);   // 只读：需开发者放行
      if (tr.ok && tr.deviceToken) return applyToken(tr.deviceToken, true, tr.role === 'view' ? 'view' : 'edit');
    }
    // ⚠️ 必须带 fp：服务端靠它认定「同一台设备」。不带的话只能按 IP 认，
    //    而手机网络的出口 IP 每次请求都可能变 → 点一次登录被当成好几台新设备，
    //    每建一条申请就给开发者推一条通知，变成"点一次弹出一堆通知"。
    const r = await post('/api/lock/unlock', { password: pwd, role: 'auto', fp: MY_FP });
    if (r.denied) { GATE.tried++; return showGate('❌ ' + (r.error || '开发者已拒绝这台设备')); }
    if (r.pending && r.req) return gateWaitApproval(r.req);        // 只读：需开发者放行
    if (r.ok) return applyToken(r.deviceToken || r.token, !!r.deviceToken, r.role === 'view' ? 'view' : 'edit');
    GATE.tried++;
    return showGate('❌ ' + (r.error || '口令错误'));
  }
  // ── 开发者密码（可编辑）──
  if (!GATE.hasPassword) {
    const s = await post('/api/lock/setup', { password: pwd, role: 'edit' });
    if (!s.ok) return showGate('设置失败：' + (s.error || ''));
    GATE.hasPassword = true; LOCK.hasPassword = true;
  }
  if (remember) {
    const tr = await post('/api/lock/trust', { password: pwd, name: deviceName(), role: 'auto', fp: MY_FP });
    if (tr.ok && tr.deviceToken) return applyToken(tr.deviceToken, true, tr.role === 'view' ? 'view' : 'edit');
  }
  // 带上 fp/name：服务端据此认定「同一台物理设备」，登录时签发长期令牌（重启不登出）
  const r = await post('/api/lock/unlock', { password: pwd, role: 'auto', fp: MY_FP, name: deviceName() });
  if (r.ok) return applyToken(r.deviceToken || r.token, !!r.deviceToken, r.role === 'view' ? 'view' : 'edit');
  GATE.tried++;
  showGate('❌ ' + (r.error || '口令错误') + (GATE.tried >= 3 ? '（请到本机面板确认）' : ''));
}
// ───────── 只读设备：等待开发者确认 ─────────
// 知道观看密码不等于能进：口令正确后进入待确认列表，开发者在电脑端点「允许」才放行。
// 这里把 reqId 存进 localStorage：手机刷新/微信重开页面后能接着等，不用重新输密码。
let _gatePoll = null;
const PENDING_KEY = 'qd_pending_req';
function gateWaitApproval(req) {
  const g = document.getElementById('gate'); if (!g) return;
  g.style.display = 'flex';
  g.innerHTML = '<div style="font-size:22px;font-weight:800">⏳ 等待开发者确认</div>' +
    '<div class="muted" style="font-size:13px;max-width:520px;white-space:normal;line-height:1.6">口令正确。已通知开发者，请在电脑端面板 <b>「🔐 待确认只读设备」</b> 里点「允许」。<br>放行后本页会<b>自动进入</b>，不用重新输入密码，也不用刷新。</div>' +
    '<div class="muted" style="font-size:12px;min-height:18px" id="gateWaitTip">正在等待确认…（每 3 秒自动查询一次）</div>' +
    '<button class="btn ghost" onclick="gateStopWait()" style="padding:6px 16px;font-size:13px">← 换个口令重新登录</button>';
  try { localStorage.setItem(PENDING_KEY, req); } catch {}
  if (_gatePoll) clearInterval(_gatePoll);
  let n = 0;
  _gatePoll = setInterval(async () => {
    if (document.hidden) return;                       // 后台不空转，省电省流量
    n++;
    const tip = document.getElementById('gateWaitTip');
    if (tip) tip.textContent = `正在等待确认…（已等待 ${n * 3} 秒）`;
    const r = await fetch('/api/lock/pending-status?req=' + encodeURIComponent(req)).then(x => x.json()).catch(() => ({}));
    if (r && r.state === 'allowed' && r.token) {
      clearInterval(_gatePoll); _gatePoll = null;
      try { localStorage.removeItem(PENDING_KEY); } catch {}
      applyToken(r.token, true, 'view');
    } else if (r && r.state === 'denied') {
      clearInterval(_gatePoll); _gatePoll = null;
      try { localStorage.removeItem(PENDING_KEY); } catch {}
      showGate('❌ 开发者拒绝了该设备的访问申请');
    } else if (r && r.state === 'gone') {
      clearInterval(_gatePoll); _gatePoll = null;
      try { localStorage.removeItem(PENDING_KEY); } catch {}
      showGate('申请已失效，请重新输入口令');
    }
  }, 3000);
}
function gateStopWait() {
  if (_gatePoll) { clearInterval(_gatePoll); _gatePoll = null; }
  try { localStorage.removeItem(PENDING_KEY); } catch {}
  showGate();
}

// ───────── 忘记开发者密码：绑定手机号 → 验证码 → 重置密码 ─────────
// 没有短信网关，验证码走飞书直推本人手机，等价于短信验证码
const FG = { step: 0, ticket: '', resetToken: '', masked: '' };
// 只在【已绑定找回手机号】时才露出「忘记开发者密码」入口。
// 没绑的话点了也走不通（服务端直接拒绝），不如不显示；同时把掩码号写在按钮上，
// 让人一眼认出这是自己的找回通道，而不是又一个不知所谓的弹窗。
let _fgProbed = false;
async function fgMaybeShow() {
  const btn = document.getElementById('gateForgot');
  if (!btn) return;
  try {
    if (!_fgProbed) {
      const st = await fetch('/api/lock/phone').then(r => r.json()).catch(() => ({}));
      FG.masked = st && st.masked || '';
      FG.bound = !!(st && st.bound);
      _fgProbed = true;
    }
    btn.style.display = FG.bound ? '' : 'none';
    btn.textContent = FG.bound ? `🔑 忘记开发者密码？（用 ${FG.masked} 找回）` : '🔑 忘记开发者密码？';
  } catch {}
}
function showForgot() {
  const g = document.getElementById('gate'); if (!g) return;
  FG.step = 1; GATE.role = GATE.role || 'edit'; GATE.mode = 'edit';
  g.innerHTML = '<div style="font-size:22px;font-weight:800">🔑 找回开发者密码</div>' +
    '<div class="muted" style="font-size:13px;max-width:520px;white-space:normal;line-height:1.6">用你在平台绑定的手机号做身份验证。<b>系统只会认这一个号码</b>，验证码通过飞书直推到你的手机。<br><span id="fgMask" class="muted" style="font-size:12px"></span></div>' +
    '<div id="fgBody"></div>' +
    '<div class="muted" style="font-size:12px;min-height:18px;color:#c92a2a" id="gateTip"></div>' +
    '<button class="btn ghost" onclick="showGate()" style="padding:4px 14px;font-size:12px">← 返回登录</button>';
  fgLoadMask();
  fgStep1();
}
async function fgLoadMask() {
  try {
    const st = await fetch('/api/lock/phone').then(r => r.json());
    FG.masked = st.masked || '';
    const el = document.getElementById('fgMask');
    if (el) el.textContent = st.bound ? ('已绑定手机号：' + st.masked) : '⚠️ 尚未绑定手机号，无法找回';
  } catch {}
}
function fgTip(t, err) { const el = document.getElementById('gateTip'); if (el) { el.textContent = t; el.style.color = err ? '#c92a2a' : '#2b8a3e'; } }
function fgBox(inner) { const b = document.getElementById('fgBody'); if (b) b.innerHTML = inner; }
function fgStep1() {
  FG.step = 1;
  fgBox('<input type="tel" id="fgPhone" placeholder="输入绑定的手机号" style="padding:10px 14px;width:250px;font-size:15px;border:1px solid #ced4da;border-radius:8px">' +
    '<br><br><button class="btn" onclick="fgSend()">获取验证码</button>');
  const i = document.getElementById('fgPhone');
  if (i) { i.focus(); i.onkeydown = e => { if (e.key === 'Enter') fgSend(); }; }
}
async function fgSend() {
  const ph = (document.getElementById('fgPhone').value || '').trim();
  if (!ph) return fgTip('请输入手机号', true);
  fgTip('正在发送…');
  const r = await post('/api/lock/forgot', { phone: ph });
  if (!r.ok) return fgTip('❌ ' + (r.error || '发送失败'), true);
  FG.ticket = r.ticket; FG.masked = r.masked || FG.masked;
  fgStep2(r.devCode ? ('验证码已推送（本机可见：' + r.devCode + '）') : '验证码已推送到你手机上绑定的飞书');
}
function fgStep2(msg) {
  FG.step = 2;
  fgBox('<input type="text" id="fgCode" placeholder="6位验证码" maxlength="6" style="padding:10px 14px;width:200px;font-size:20px;letter-spacing:6px;text-align:center;border:1px solid #ced4da;border-radius:8px">' +
    '<br><br><button class="btn" onclick="fgVerify()">验证</button>' +
    '<button class="btn ghost" onclick="fgStep1()" style="margin-left:8px">重发</button>');
  fgTip(msg || '验证码已发送，5 分钟内有效');
  const i = document.getElementById('fgCode');
  if (i) { i.focus(); i.onkeydown = e => { if (e.key === 'Enter') fgVerify(); }; }
}
async function fgVerify() {
  const c = (document.getElementById('fgCode').value || '').trim();
  if (!c) return fgTip('请输入验证码', true);
  const r = await post('/api/lock/verify-code', { ticket: FG.ticket, code: c });
  if (!r.ok) return fgTip('❌ ' + (r.error || '验证失败'), true);
  FG.resetToken = r.resetToken;
  fgStep3();
}
function fgStep3() {
  FG.step = 3;
  fgBox('<input type="password" id="fgPwd1" placeholder="新开发者密码（≥4位）" style="padding:10px 14px;width:250px;font-size:15px;border:1px solid #ced4da;border-radius:8px"><br>' +
    '<input type="password" id="fgPwd2" placeholder="再输一次" style="padding:10px 14px;width:250px;font-size:15px;border:1px solid #ced4da;border-radius:8px;margin-top:8px"><br><br>' +
    '<button class="btn" onclick="fgReset()">确认重置</button>');
  fgTip('✅ 身份已确认，请设置新的开发者密码');
  const i = document.getElementById('fgPwd1'); if (i) i.focus();
}
async function fgReset() {
  const p1 = (document.getElementById('fgPwd1').value || '').trim();
  const p2 = (document.getElementById('fgPwd2').value || '').trim();
  if (p1.length < 4) return fgTip('❌ 新密码至少 4 位', true);
  if (p1 !== p2) return fgTip('❌ 两次输入不一致', true);
  // ⚠️ reset-pwd 已经直接回 deviceToken（server.js 里当场签发）。
  //    以前这里还要用新密码再调一次 trust —— 那一步一撞上 IP 限流就失败，
  //    表现为「找回明明成功了，还是被晾在登录页」，于是用户又点一次忘记密码。
  const r = await post('/api/lock/reset-pwd', { resetToken: FG.resetToken, newPassword: p1, fp: MY_FP, name: deviceName() });
  if (!r.ok) return fgTip('❌ ' + (r.error || '重置失败'), true);
  if (r.deviceToken) { applyToken(r.deviceToken, true, 'edit'); return; }
  // 兜底：没拿到长期令牌时再走 trust / 短令牌两条路，任何一条通了都算成功进入
  const tr = await post('/api/lock/trust', { password: p1, name: deviceName(), role: 'edit', fp: MY_FP });
  if (tr.ok && tr.deviceToken) { applyToken(tr.deviceToken, true, 'edit'); return; }
  applyToken(r.token || tr.deviceToken || '', false, 'edit');
}
// ───────── 实时通道（SSE）：服务端一有推送/新信号，页面立即刷新，不等轮询 ─────────
let _es = null, _esRetry = 0;
function rtState(txt, on) { const el = document.getElementById('rtState'); if (el) { el.textContent = txt; el.className = 'badge' + (on ? ' on' : ''); } }
function connectStream() {
  try {
    if (_es) { try { _es.close(); } catch {} _es = null; }
    const t = GATE.token || LOCK.token || localStorage.getItem('qd_device') || localStorage.getItem('qd_token') || '';
    // 带上本设备短 ID：开发者端据此列出「谁在线 / 哪台是仅查看端」
    const qs = (t ? '?token=' + encodeURIComponent(t) : '?') +
      '&dev=' + encodeURIComponent(MY_DID) +
      '&dname=' + encodeURIComponent(deviceName());
    const es = new EventSource('/api/stream' + qs);
    es.onopen = () => { _esRetry = 0; rtState('⚡ 实时连接正常', true); };
    es.addEventListener('alert', e => {
      try { const d = JSON.parse(e.data || '{}'); countdown = 5; refresh(); pageMsg('📢 ' + (d.time || '') + ' ' + (d.preview || '').slice(0, 80) + '…', 'ok'); } catch {}
    });
    es.addEventListener('bigmoney', e => {
      try { const d = JSON.parse(e.data || '{}'); countdown = 5; refresh(); const h = d.hot || []; if (h.length) pageMsg(`⚡ 大单流入·涨停候选 ${h.length} 只：${h.map(x => x.name + ' ' + x.prob + '%').join('、')}`, 'ok'); } catch {}
    });
    es.addEventListener('signal', e => {
      try { const d = JSON.parse(e.data || '{}'); countdown = 5; refresh(); const it = d.items || []; if (it.length) pageMsg(`⚡ ${it.map(x => x.name + (x.prob ? ' ' + x.prob + '%' : '')).join('、')}`, 'ok'); } catch {}
    });
    es.addEventListener('holding', e => {
      // 持仓估值/建议刷新：服务端每30秒盯一次，面板跟着实时变，不用等轮询
      try {
        const d = JSON.parse(e.data || '{}');
        holdLoad(true);
        if (d.level === 'danger' || d.level === 'warn') {
          const nameTxt = (d.items || []).filter(i => i.level === 'danger' || i.level === 'warn')
            .map(i => `${i.name || i.code}[${(i.acts || []).join('·') || '预警'}]`).join('、');
          if (nameTxt) pageMsg('💼 持仓预警：' + nameTxt, 'warn');
        }
      } catch {}
    });
    // ⛔ 2026-10-06 补：后端一共发 7 类事件，这里原先只订阅了 4 类 ——
    //    pushed / similar / auction 三类**一个接收方都没有**，后端白算白推：
    //    · auction 竞价实时是**每 3 秒**算一次并发的，是全场时效性最强的一路，
    //      前端却只靠 5 秒轮询拿 S.auction，"竞价实时"实际只跑了一半（9:15-9:25 最需要秒级更新）。
    //    · similar 扫完相似走势、pushed 推完一条消息后同样只发不收，面板要等下一轮轮询才动。
    //    现在三类都接上：只做静默刷新，不弹提示（竞价 3 秒一条，弹提示会刷屏）。
    es.addEventListener('auction', e => {
      try { const d = JSON.parse(e.data || '{}'); if (d.live) { countdown = 5; refresh(); } } catch {}
    });
    es.addEventListener('similar', e => {
      try { JSON.parse(e.data || '{}'); countdown = 5; refresh(); } catch {}
    });
    es.addEventListener('pushed', e => {
      try { JSON.parse(e.data || '{}'); countdown = 5; refresh(); } catch {}
    });
    es.addEventListener('release', e => {
      // 发布看板状态流转实时刷新：published / verifying / verified / verify_failed
      try {
        const d = JSON.parse(e.data || '{}');
        loadReleaseBoard();
        if (d.stage === 'verified') pageMsg('✅ 版本 ' + (d.version || '') + ' 复核通过', 'ok');
        if (d.stage === 'verify_failed') pageMsg('⚠️ 版本 ' + (d.version || '') + ' 复核未通过', 'warn');
      } catch {}
    });
    es.onerror = () => {
      try { es.close(); } catch {}
      if (_es === es) _es = null;
      rtState('⚪ 实时连接中断·重连中', false);
      _esRetry++; setTimeout(connectStream, Math.min(30000, 3000 * _esRetry));
    };
    _es = es;
  } catch {}
}
// ── 各票池面板整体折叠：点面板标题前的箭头（或标题文字）即收起整块，状态记在 localStorage ──
const PANEL_KEY = 'qd_panel';             // 折叠状态
const PANEL_HIDE_KEY = 'qd_panel_hide';   // 「想看哪个就看哪个」里没被勾选的面板
let _panelCollapsed = (() => { try { return new Set(JSON.parse(localStorage.getItem(PANEL_KEY) || '[]')); } catch { return new Set(); } })();
let _panelHidden = (() => { try { return new Set(JSON.parse(localStorage.getItem(PANEL_HIDE_KEY) || '[]')); } catch { return new Set(); } })();
function _savePanel() { try { localStorage.setItem(PANEL_KEY, JSON.stringify([..._panelCollapsed])); } catch {} }
function _savePanelHide() { try { localStorage.setItem(PANEL_HIDE_KEY, JSON.stringify([..._panelHidden])); } catch {} }
function _panelParts(card) {
  const h = card.querySelector('h2');
  return {
    h,
    sec: (card.previousElementSibling && card.previousElementSibling.classList.contains('sec')) ? card.previousElementSibling : null,
    chev: h ? h.querySelector('.pchev') : null
  };
}
// hide = 没勾选（整块不显示）；col = 折叠（只留标题栏）
function _panelApply(card) {
  const { h, sec, chev } = _panelParts(card);
  const hide = _panelHidden.has(card.id);
  const col = _panelCollapsed.has(card.id);
  card.style.display = hide ? 'none' : '';
  if (sec) sec.style.display = (hide || col) ? 'none' : '';
  if (chev) chev.textContent = col ? '▸' : '▾';
  if (h) Array.from(card.children).forEach(el => { if (el !== h) el.style.display = col ? 'none' : ''; });
}
function _panelToggle(card) {
  if (_panelCollapsed.has(card.id)) _panelCollapsed.delete(card.id); else _panelCollapsed.add(card.id);
  _savePanel(); _panelApply(card); _syncPanelBtn();
}
// 只统计「当前身份真正看得见」的面板：只读身份下带 eo-hide 的（持仓/模拟盘操作等）不参与折叠与勾选
function panelCards() {
  return Array.from(document.querySelectorAll('.card'))
    .filter(c => c.querySelector('h2') && !c.classList.contains('eo-hide'));
}
function panelTitle(card) {
  const h = card.querySelector('h2'); if (!h) return card.id;
  const s = h.querySelector('span:not(.rf):not(.pchev)');
  const t = ((s ? s.textContent : h.textContent) || '').replace(/[▸▾]/g, '').trim();
  return t.slice(0, 22) || card.id;
}
function initPanelCollapse() {
  panelCards().forEach((card, i) => {
    const h = card.querySelector('h2');
    if (!h) return;
    if (!card.id) card.id = 'qcpanel' + i;
    if (h.dataset.pinit === '1') { _panelApply(card); return; }
    h.dataset.pinit = '1';
    let chev = h.querySelector('.pchev');
    if (!chev) {
      chev = document.createElement('span');
      chev.className = 'pchev';
      chev.title = '点击折叠/展开本面板';
      chev.style.cssText = 'cursor:pointer;display:inline-block;width:14px;color:#868e96;user-select:none';
      h.insertBefore(chev, h.firstChild);
    }
    const doToggle = e => { if (e) { try { e.stopPropagation(); e.preventDefault(); } catch {} } _panelToggle(card); };
    chev.addEventListener('click', doToggle);
    const title = h.querySelector('span:not(.rf):not(.pchev)');
    if (title && !title.dataset.ptgl) {
      title.dataset.ptgl = '1'; title.style.cursor = 'pointer'; title.title = '点击折叠/展开本面板';
      title.addEventListener('click', doToggle);
    }
    _panelApply(card);
  });
  _syncPanelBtn();
}
function applyAllPanels() { panelCards().forEach(c => _panelApply(c)); _syncPanelBtn(); }
function _syncPanelBtn() {
  const b = document.getElementById('btnPanelToggle'); if (!b) return;
  b.textContent = _panelCollapsed.size ? '🔽 面板展开' : '🔼 面板收起';
}
// 一键收起/展开全部面板
function toggleAllPanels() {
  const cards = panelCards();
  if (_panelCollapsed.size) _panelCollapsed.clear(); else cards.forEach(c => _panelCollapsed.add(c.id));
  _savePanel(); applyAllPanels();
}
// ── 「想看哪个就看哪个」：勾选要显示的面板，未勾选的整块隐藏 ──
function setPanelVisible(key, on) {
  if (on) _panelHidden.delete(key); else _panelHidden.add(key);
  _savePanelHide(); applyAllPanels(); buildPanelPicker();
}
function setAllPanelsVisible(on) {
  const cards = panelCards();
  if (on) _panelHidden.clear(); else cards.forEach(c => _panelHidden.add(c.id));
  _savePanelHide(); applyAllPanels(); buildPanelPicker();
}
function buildPanelPicker() {
  const box = document.getElementById('panelPickerList'); if (!box) return;
  box.innerHTML = panelCards().map(c => {
    const on = !_panelHidden.has(c.id);
    return `<label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;cursor:pointer">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="setPanelVisible('${c.id}', this.checked)">${panelTitle(c)}</label>`;
  }).join('');
}
function togglePanelPicker() {
  const b = document.getElementById('panelPicker'); if (!b) return;
  if (b.style.display === 'none') { buildPanelPicker(); b.style.display = ''; } else b.style.display = 'none';
}
// 🛠 顶部工具抽屉：平时只留一个按钮，展开后才占一行。
//    为什么非要它 —— 用户原话「保存/换通道什么的用的很少」。原来那 9 个控件常年横在
//    标题栏里把 身份/实时连接 这些真正要看的状态挤到屏幕外去了。
const HDR_TOOLS_KEY = 'qd_hdr_tools';
function toggleHdrTools(force) {
  const b = document.getElementById('hdrTools');
  const btn = document.getElementById('btnHdrTools');
  if (!b) return;
  const open = (typeof force === 'boolean') ? force : (b.style.display === 'none');
  b.style.display = open ? '' : 'none';
  if (btn) { btn.textContent = open ? '🛠 工具 ✕' : '🛠 工具'; btn.className = 'btn ' + (open ? '' : 'ghost'); }
  try { localStorage.setItem(HDR_TOOLS_KEY, open ? '1' : '0'); } catch {}
}
function initHdrTools() {
  let want = false;
  try { want = localStorage.getItem(HDR_TOOLS_KEY) === '1'; } catch {}
  toggleHdrTools(want);
}
initHdrTools();
initPanelCollapse();
connectStream();
refresh();
loadReleaseBoard();
setInterval(loadReleaseBoard, 60000);
// 打开页面：立即全量强制刷新 + 15秒内每2.5秒高频轮询，确保所有窗口快速出数据
(async () => {
  try { fetch('/api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: 'all' }) }); } catch {}
  const t0 = Date.now();
  const fast = setInterval(() => { refresh(); if (Date.now() - t0 > 15000) clearInterval(fast); }, 2500);
})();

function renderPaper(suf, p, mirror) {
  if (!p) return;
  const info = document.getElementById('pp' + suf + 'Info');
  // ⛔ gd 轮：副本提示原先写在调用处（ppPoolInfo/ppPreInfo），而这里第一行就把同一行文字覆盖掉了
  //    —— 那句「本机为副本实例·模拟盘由线上运行」从来没显示过一次（写了等于没写）。
  //    现在由渲染方统一拼出来：副本身份 + 运行态 + 策略参数，一行说清楚。
  if (info) info.textContent = (mirror ? '🖥 副本实例 · 模拟盘由线上运行（此处为同步过来的账） · ' : '') +
    `${p.enabled && !mirror ? '▶ 自动交易中' : (mirror ? '' : '⏸ 已暂停')} · 初始 ${(p.initial / 10000).toFixed(0)} 万 · ${suf === 'Pool' ? '新进池买入·止盈8%/止损-3%·收益联动' : '涨停预选买入·止盈10%/止损-3%·收益联动'}`;
  const pnl = v => `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${v}</span>`;
  document.getElementById('pp' + suf + 'Summary').innerHTML =
    `<span class="tag">总资产 <b>${Math.round(p.equity).toLocaleString()}</b></span>` +
    `<span class="tag">总收益 ${pnl(p.totalPnl)}（<b class="${p.totalPct > 0 ? 'up' : p.totalPct < 0 ? 'down' : ''}">${p.totalPct > 0 ? '+' : ''}${p.totalPct}%</b>）</span>` +
    `<span class="tag">已实现盈亏 ${pnl(p.realized)}</span>` +
    `<span class="tag">现金 <b>${Math.round(p.cash).toLocaleString()}</b></span>` +
    `<span class="tag">持仓市值 ${Math.round(p.marketValue).toLocaleString()}</span>` +
    `<span class="tag">持仓 ${(p.positions || []).length} 只</span>` +
    // ⛔ 2026-10-08 补（cz 轮）：账户余额与逐笔流水是两份独立记录的账，以前从没对过。
    //    对不上时（改过本金 / 回拉把两套来源的流水归并 / 有成交没写进流水）以前完全看不出来，
    //    现在直接在账户摘要里挂一条警示，点开即知差多少、可能是什么原因。
    // ⛔ du 轮：流水被容量上限裁过 → 这是「证据不全」，不是「账记错了」。
    //    红色「账目对不上」会把人引向重置（把剩下的几百笔也删掉，不可逆）。
    //    实测：pre 账户丢掉最老 20 笔后报「差 37.5 万」，真相只是历史流水没了。
    ((p.audit && p.audit.incomplete)
      ? `<span class="tag" style="background:#fffbe6;color:#8a6d00" title="${(p.audit.why || '').replace(/"/g, '&quot;')}">⚠️ 证据不全：流水已达上限 ${p.audit.cap} 笔，无法判定（勿重置）</span>`
      // ⛔ gd 轮：副本实例的账户是"线上状态 + 本机历史流水"两份来源，天生对不上（详见服务端 mkPaper 的 audit 注释）。
      //    以前一律按红色「账目对不上」告警显示，文案还建议「可用『重置』清空重来」——
      //    而这条红字每晚都挂在本机面板上，既骗人又把人推向不可逆的清空流水。中性蓝标，把"以线上账为准"说清楚。
      : (p.audit && p.audit.ok === false)
      ? (p.audit.replica
        ? `<span class="tag" style="background:#eef3ff;color:#1c5fb0" title="${(p.audit.why || '').replace(/"/g, '&quot;')}">🖥 副本视图：本机不跑自动交易，账户已随线上同步（本机保留的历史流水为只读留档，二者口径不同属正常）· 权威账在线上</span>`
        : (p.audit.explained
        ? `<span class="tag" style="background:#fffbe6;color:#8a6d00" title="${(p.audit.why || '').replace(/"/g, '&quot;')}">ℹ️ 老口径遗留：${p.audit.basisGapN} 笔差 ${p.audit.basisGap} 元，无需重置</span>`
        : `<span class="tag" style="background:#fff5f5;color:#c92a2a" title="${(p.audit.why || '').replace(/"/g, '&quot;')}">⚠️ 账目对不上：${p.audit.why || '账户与流水不一致'}</span>`))
      : (p.audit ? `<span class="tag muted" title="账户余额与逐笔流水已对账一致（${p.audit.trades} 笔）">✓ 账目已对账</span>` : '')) +
    // ⛔ 2026-10-08 补（da 轮）：休市日/开盘前，行情快照冻在上一交易日收盘，
    //    「总资产 / 持仓市值 / 总收益」其实是那个时刻的数。不标注就会被当成当下的资产。
    ((p.pxBasis && p.pxBasis.stale && p.pxBasis.day)
      ? `<span class="tag" style="background:#fff4e6;color:#e8590c" title="休市或行情未刷新，持仓按 ${p.pxBasis.label} 价估值">🕒 按 ${p.pxBasis.label}价估值</span>`
      : '');
  const pos = p.positions || [];
  document.getElementById('pp' + suf + 'Pos').innerHTML = '<tr><th>股票</th><th>买入价</th><th>现价</th><th>盈亏</th><th>盈亏%</th><th>股数</th><th>持有</th><th>买入理由</th></tr>' +
    (pos.length ? pos.map(x => `<tr${x.bad ? ' style="background:#fff5f5"' : ''}><td><b class="kl-link" onclick="openKline('${x.code}')" title="点开看K线：成本/止损/止盈线、买卖点、做T/锁仓、量能/大单资金/洗盘出货判定">${x.name}</b> <span class="muted">${x.code}</span>${x.bad ? ' <span class="tag" style="background:#ffe3e3;color:#c92a2a">⚠️利空</span>' : ''}</td><td>${x.buyPrice}</td><td>${x.lastPrice}</td><td>${pnl(x.pnl)}</td><td class="${x.pnlPct > 0 ? 'up' : x.pnlPct < 0 ? 'down' : ''}">${x.pnlPct > 0 ? '+' : ''}${x.pnlPct}%</td><td>${x.shares}</td><td>${x.days}交易日</td><td class="muted">${x.reason || ''}</td></tr>`).join('') : '<tr><td colspan="8" class="muted">暂无持仓（等待新信号触发自动买入）</td></tr>');
  const tr = (p.trades || []).slice(0, 12);
  // ⛔ du 轮：同一份流水在系统里其实是三个数 —— 这里只画 12 笔、接口只给 30 笔、
  //    而对账按全量算。不把真实总数标出来，用户会以为看到的就是全部。
  const trTotal = Number(p.tradesTotal) || tr.length;
  document.getElementById('pp' + suf + 'Trades').innerHTML = tr.length ? tr.map(x =>
    `<div class="sig ${x.side === '卖出' && x.pnl < 0 ? 'zt' : ''}" style="font-size:12px">${new Date(x.t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} <b>${x.side}</b> ${x.name}(${x.code}) ${x.shares}股 @${x.price}${x.side === '卖出' ? ' 盈亏' + (x.pnl > 0 ? '+' : '') + x.pnl : ''} <span class="muted">${x.reason || ''}</span></div>`).join('')
    + (trTotal > tr.length ? `<div class="muted" style="font-size:11px;padding-top:4px">共 ${trTotal} 笔，此处显示最近 ${tr.length} 笔</div>` : '')
    : '<div class="muted" style="font-size:12px">暂无交易记录</div>';
}
// ═══ hj 轮：应用内 K 线面板（用户 2026-10-14 原话：「点开个股直接查看，买卖T点锁仓直接标出来，不用跨软件」+「K线和量能以及大单情况洗盘还是出货都要显示出来哦」）═══
// 设计铁律（与服务端 klineMarksOf / washVsDistribute 注释一一对应）：
//   ① 数据只走 /api/kline + /api/kline-marks：日K 走本地三级缓存，不新开数据通道；
//      实时性 = 打开面板时副本后台向线上回拉一次（后端 syncedAt 可见）+ 面板内 15s 定时刷新。
//   ② 算法信号层（当时认为该买）与模拟盘成交层（真的买了）是两个可切换图层，语义不同绝不混画；
//      只读（观看）身份后端 canSeePaper=false → 不显示该图层与开关。
//   ③ ⛔ 判不出就显「判不出」：洗盘/出货 evidence 不足时后端给 unknown，面板照实显示，不涂色蒙人。
//   ④ 红涨绿跌（A 股惯例）：K 线实体、量能柱、资金流净额全部同口径。
//   ⑤ 面板可折叠（localStorage qd_kline_folded 记住），折叠成横条仍显示股票名与洗盘/出货结论。
const KL = { code: null, name: '', rows: [], ma: null, marks: null, i0: 0, visN: 60, layers: { algo: true, paper: true }, timer: null, folded: localStorage.getItem('qd_kline_folded') === '1', crossIdx: -1, canPaper: true, busy: false, focus: null, loadingOlder: false };
let _klPan = null;   // 拖拽平移态（跨 klDraw 重渲染保持，避免每次重画丢失拖动中状态）
const KL_COLOR = { pool: '#3b5bdb', fastin: '#0ca678', auczt: '#e8590c', yier: '#ae3ec9', lianban: '#9c36b5', trend: '#0b7285', bigmoney: '#d9480f', bigmoney_repeat: '#d9480f', buzhang: '#5f3dc4', similar: '#2f9e44', pre: '#1864ab', ztprob: '#c92a2a', trendsig: '#0b7285', zt: '#c92a2a' };
const klMoney = v => { v = Number(v) || 0; const a = Math.abs(v); if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿'; if (a >= 1e4) return (v / 1e4).toFixed(0) + '万'; return String(Math.round(v)); };
function klWrapEl() { let w = document.getElementById('klWrap'); return w; }
function openKline(code) {
  const c = String(code || '').replace(/[^0-9]/g, '');
  if (!/^[0-9]{6}$/.test(c)) { pageMsg('股票代码格式不正确', 'err'); return; }
  KL.requestEpoch = (KL.requestEpoch || 0) + 1;
  KL.busy = false; KL.rows = []; KL.ma = {}; KL.marks = null; KL.name = ''; KL.canPaper = false;
  KL.code = c;
  let w = klWrapEl();
  if (!w) { w = klBuildPanel(); }
  w.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  klRenderAll();
  klLoad(true);
  if (KL.timer) clearInterval(KL.timer);
  // 面板打开期间 15s 静默刷新（与主轮询同频；不影响用户已选的缩放/图层）
  KL.timer = setInterval(() => { if (!document.hidden && klWrapEl() && klWrapEl().style.display !== 'none') klLoad(false); else { clearInterval(KL.timer); KL.timer = null; } }, 15000);
}
function closeKline() {
  KL.requestEpoch = (KL.requestEpoch || 0) + 1; KL.busy = false;
  const w = klWrapEl(); if (w) w.style.display = 'none';
  document.body.style.overflow = '';
  if (KL.timer) { clearInterval(KL.timer); KL.timer = null; }
}
function klBuildPanel() {
  const w = document.createElement('div');
  w.id = 'klWrap';
  w.innerHTML = `
  <div id="klPanel" role="dialog" aria-label="个股K线">
    <div id="klHead" style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e5e8ec;flex-wrap:wrap">
      <b id="klName" style="font-size:15px">…</b>
      <span class="muted" id="klCode"></span>
      <span id="klWash" style="display:none"></span>
      <span style="flex:1"></span>
      <span class="muted" id="klAsOf" style="font-size:11.5px"></span>
      <button class="btn ghost" id="klFold" style="font-size:12px;padding:3px 9px">折叠</button>
      <button class="btn ghost" id="klClose" style="font-size:12px;padding:3px 9px">关闭</button>
    </div>
    <div id="klBody" style="flex:1;overflow-y:auto;padding:10px 12px">
      <div id="klProviders" style="margin-bottom:8px"></div>
      <div id="klFocus"></div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <span class="muted" style="font-size:11.5px">图层：</span>
        <label style="font-size:12px;cursor:pointer"><input type="checkbox" id="klLayerAlgo" checked> 算法信号</label>
        <label style="font-size:12px;cursor:pointer" id="klPaperLbl"><input type="checkbox" id="klLayerPaper" checked> 模拟盘成交</label>
        <span style="flex:1"></span>
        <span class="muted" style="font-size:11.5px">窗口</span>
        <button class="btn ghost" id="klPrev" style="font-size:12px;padding:2px 8px">‹</button>
        <span id="klRange" class="muted" style="font-size:11.5px"></span>
        <button class="btn ghost" id="klNext" style="font-size:12px;padding:2px 8px">›</button>
        <button class="btn ghost" id="klZoomOut" style="font-size:12px;padding:2px 8px">＋</button>
        <button class="btn ghost" id="klZoomIn" style="font-size:12px;padding:2px 8px">－</button>
        <button class="btn ghost" id="klRefresh" style="font-size:12px;padding:2px 8px">🔄</button>
      </div>
      <div id="klInfoBar" style="min-height:18px;font-size:11.5px;color:#697386;margin-bottom:4px"></div>
      <div id="klChart" style="width:100%"></div>
      <div id="klLegend" style="font-size:11.5px;color:#697386;margin-top:4px;line-height:1.7"></div>
      <div id="klWashBox" style="margin-top:10px"></div>
      <div id="klFlowBox" style="margin-top:8px"></div>
      <div id="klPaperBox" style="margin-top:8px"></div>
      <div id="klSync" style="margin-top:8px;font-size:11.5px;color:#697386"></div>
    </div>
  </div>`;
  document.body.appendChild(w);
  w.addEventListener('click', e => { if (e.target === w) closeKline(); });
  w.querySelector('#klClose').onclick = closeKline;
  w.querySelector('#klFold').onclick = () => {
    KL.folded = !KL.folded;
    localStorage.setItem('qd_kline_folded', KL.folded ? '1' : '0');
    klApplyFold(w);
  };
  w.querySelector('#klLayerAlgo').onchange = e => { KL.layers.algo = e.target.checked; klDraw(); };
  w.querySelector('#klLayerPaper').onchange = e => { KL.layers.paper = e.target.checked; klDraw(); };
  w.querySelector('#klPrev').onclick = () => { KL.i0 = Math.max(0, KL.i0 - Math.ceil(KL.visN / 2)); klDraw(); };
  w.querySelector('#klNext').onclick = () => { KL.i0 = Math.min(Math.max(0, KL.rows.length - KL.visN), KL.i0 + Math.ceil(KL.visN / 2)); klDraw(); };
  w.querySelector('#klZoomIn').onclick = () => { KL.visN = Math.max(20, KL.visN - 20); KL.i0 = Math.max(0, Math.min(KL.i0, KL.rows.length - KL.visN)); klDraw(); };
  w.querySelector('#klZoomOut').onclick = () => { KL.visN = Math.min(60, KL.visN + 20); KL.i0 = Math.max(0, Math.min(KL.i0, KL.rows.length - KL.visN)); klDraw(); };
  w.querySelector('#klRefresh').onclick = () => klLoad(true);
  klApplyFold(w);
  return w;
}
function klApplyFold(w) {
  const body = w.querySelector('#klBody');
  const btn = w.querySelector('#klFold');
  if (body) body.style.display = KL.folded ? 'none' : '';
  if (btn) btn.textContent = KL.folded ? '展开' : '折叠';
}
// ═══ ①-4 竞价复盘 UI：竞价分时 + 次日K线同屏归因 ═══
let AR = { code: null, date: null };
function toggleAuctionReview() {
  const el = document.getElementById('aucReview');
  if (!el) return;
  if (el.style.display === 'none' || !el.innerHTML) { el.style.display = 'block'; loadAuctionReview(); }
  else { el.style.display = 'none'; }
}
// dy 轮 #290（用户 2026-10-17 决策表议题1·推荐A，「全部按推荐来」第二项）：竞价复盘顶部加双口径聚合头。
// 实证依据（198 条 auczt 非 void 样本，决策单 _decision_4topics_20261017.html + MEMORY §8bis）：
//   日内口径（次日最高≥+3% 39.9% / 触板 7.1%）显著好于持股口径（收盘≥+3% 17.7% /
//   收跌 64.1% / 收盘中位 -1.42%）→ 竞价信号是「日内型」：冲高兑现有戏、持股过夜挨跌。
//   旧 UI 逐条 badge 把两个口径混读（nd_limit/nd_p3 是日内高点、closeUp 是持股收盘，却合成
//   一个徽章，且 nd_limit 标「次日涨停」名不副实——它是最高触板、不是收盘封板），
//   用户观感被数据在持股口径证伪 → 「感觉风险大于机会」一半是呈现问题、一半是真实现实。
// 聚合头四件：① 日内/持股两卡片并列（各自算各自的，⛔ 不把高点算进持股口径）；
//   ② prob 档小表（prob=当日封板预测，§8bis 实证绝对值虚高 2~3 倍、次日口径不单调
//   → 只呈现分布，不禁任何事、不作依据）；③ 定位文案「日内型信号 · 冲高兑现，非次日持股依据」；
//   ④ 条目 badge 拆高/收双列。
// ⛔ 纯前端聚合（/api/auction-log 契约零改动）；pending（次日K未生成）一律剔除出统计——
//   判不出不当通过，⛔ 不把未出结果的算成 0 命中；样本 <10 条显式标注噪声大；
//   窗口按接口实际返回的最近 40 条计算并写明起止日期（当前 10-15 单日 40 条，单日样本弱，
//   要看更长窗口需抬 n，⛔ 不偷换口径）。
// 中位数（偶数个取中间两值均值）；空/全非法返回 null（⛔ 不返回 0 冒充）。
// ⛔ 先过滤再 map(Number)：反序会把 null 变成 0 混进中位数（缺数据的票被当成 0% 收益）。
function arMedian(arr) {
  const v = (arr || []).filter(x => x != null && x !== '' && isFinite(Number(x))).map(Number).sort((a, b) => a - b);
  const n = v.length; if (!n) return null;
  const m = n >> 1; return n % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
// 小数收益率 → 百分比串（null/非法 → '—'，⛔ 不显示 0.00% 冒充有数据）
function arPctFmt(x) {
  if (x == null || !isFinite(Number(x))) return '—';
  const v = Number(x);
  return (v > 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
}
// 条目徽章 / 详情弹窗共用的一对（⛔ 同一概念只许这一份实现，两边都调它）；
// 「高」= 日内口径（次日盘中高点），「收」= 持股口径（次日收盘）。
function arOutcomeBadges(o) {
  if (!o || o.pending) return '<span class="muted">次日待生成</span>';
  const hi = o.nd_limit ? '<span class="tag" style="background:#ffe3e3;color:#c92a2a">高·触板</span>'
    : o.nd_p3 ? '<span class="tag" style="background:#fff3bf;color:#92400e">高·+3%</span>'
    : '<span class="tag" style="background:#f1f3f5;color:#868e96">高·&lt;3%</span>';
  const cp = (o.closePct == null || !isFinite(Number(o.closePct))) ? null : Number(o.closePct);
  const cl = cp == null ? '<span class="muted">收·?</span>'
    : cp >= 0.03 ? '<span class="tag" style="background:#ffe3e3;color:#c92a2a">收·+3%</span>'
    : cp > 0 ? '<span class="tag" style="background:#fff0f0;color:#c92a2a">收·涨</span>'
    : '<span class="tag" style="background:#e6fcf5;color:#087f5b">收·跌</span>';
  return hi + cl;
}
// 双口径聚合头（items = /api/auction-log 的 r.items，每项带 outcome）。
// 纯函数、不碰 DOM —— 守门 _test_auction_review.js 直接 eval 真跑（⛔ 别引入 esc/sign/cls 等
// 文件内其他符号，沙箱没有它们，一引就整段 ReferenceError）。
function arAggregate(items) {
  const list = (items || []).filter(x => x && x.outcome);
  const rs = list.filter(x => !x.outcome.pending);   // 只统计已出次日结果的
  const n = rs.length;
  const ds = list.map(x => x.date).filter(d => /^\d{8}$/.test(d)).sort();
  const md = d => (d && d.length === 8) ? d.slice(4, 6) + '-' + d.slice(6, 8) : (d || '-');
  const win = ds.length ? md(ds[0]) + ' ~ ' + md(ds[ds.length - 1]) : '-';
  let h = '<div style="border:1px solid var(--line,#e5e8ec);border-radius:10px;padding:10px 12px;margin-bottom:10px;background:var(--card,#fff)">';
  h += '<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px"><b>🎯 聚合口径</b><span style="font-size:12px;color:#c92a2a">日内型信号 · 冲高兑现，非次日持股依据</span></div>';
  h += '<div class="muted" style="font-size:11.5px;margin:3px 0 8px">窗口 ' + win + ' 共 ' + list.length + ' 条留档，其中 ' + n + ' 条已出次日结果（T+1 收盘后可见；未出结果的不计入、不按 0 命中算）' + (n > 0 && n < 10 ? ' · ⚠ 样本 &lt;10，比率噪声大' : '') + '</div>';
  // ⛔ dz+ 轮（决策表 D9）：必须写明样本来源 —— 这些票是「每日 09:25 竞价强势池」，
  //    不是全市场。不写这一句，读者会把「强势池命中率」当成「全市场竞价命中率」放大解读。
  h += '<div class="muted" style="font-size:11.5px;margin:-4px 0 8px">样本来源：每日 09:25 竞价强势池（当天筛出来的几十只），<b>不是全市场基线</b> —— 比率只在这批票内部可比。</div>';
  // ⛔ dz+ 轮（决策表 D3）：prob 档小表改成「prob 档 vs 当日封板率」。
  //    原因：prob 预测的是**信号日当天封板**（§8bis），而次日结果 T+1 才有 ——
  //    原来把「次日最高≥3% / 收盘中位」摆在 prob 档旁边，两个不同语义并排，
  //    读者必然理解成「prob 准不准」，等于用错口径检验模型。
  //    ⛔ 当日口径**不依赖次日结果**：只要信号日 K 线在（收盘+前收）就能判，
  //       所以这张表用 list 而不是 rs —— 否则 T+1 收盘前整张表消失，白等一天。
  //    ⛔ sameDayLimit=null 是「判不出」（缺前收/缺信号日K线），单列计数、不进分母。
  const sd = list.filter(x => x.outcome && x.outcome.sameDayLimit != null);
  const sdUnknown = list.length - sd.length;
  const probTable = () => {
    const BK = [[0, 40, '&lt;40'], [40, 50, '40-49'], [50, 60, '50-59'], [60, 70, '60-69'], [70, 80, '70-79'], [80, Infinity, '80+']];
    let rows = '';
    for (const b of BK) {
      const g = sd.filter(x => { const p = Number(x.prob); return x.prob != null && isFinite(p) && p >= b[0] && p < b[1]; });
      if (!g.length) { rows += '<tr><td>' + b[2] + '</td><td class="muted">0</td><td class="muted">—</td><td class="muted">—</td></tr>'; continue; }
      const hit = g.filter(x => x.outcome.sameDayLimit === true).length;
      rows += '<tr><td>' + b[2] + '</td><td>' + g.length + '</td><td>' + hit + '</td><td><b>' + (hit / g.length * 100).toFixed(0) + '%</b></td></tr>';
    }
    const noProb = sd.filter(x => x.prob == null || !isFinite(Number(x.prob))).length;
    let t = '<div class="muted" style="font-size:11px;margin:9px 0 3px">prob 档位 vs 当日封板（<b>同口径</b>：prob 就是「当日封板」的预测值，所以这里拿它检验 prob；当日封板＝收盘价达涨停价，严口径）'
      + (noProb ? ' · ' + noProb + ' 条 prob 未记录不计入' : '')
      + (sdUnknown ? ' · ' + sdUnknown + ' 条判不出当日封板（缺前收或信号日K线）不计入' : '') + '</div>';
    t += '<table style="width:100%;max-width:440px;border-collapse:collapse;font-size:12px"><tr class="muted"><td>prob 档位</td><td>n</td><td>当日封板</td><td>封板率</td></tr>' + rows + '</table>';
    return t;
  };
  if (!n) {
    h += '<div class="muted" style="font-size:12px">暂无已出次日结果的样本——两个「次日」口径要等 T+1 收盘后才有；下面这张表看的是<b>当日封板</b>，不受影响。</div>' + probTable() + '</div>';
    return h;
  }
  const cnt = f => rs.filter(f).length;
  const hiP3 = cnt(x => x.outcome.nd_p3), hiLim = cnt(x => x.outcome.nd_limit);
  const clP3 = cnt(x => { const c = Number(x.outcome.closePct); return isFinite(c) && c >= 0.03; });
  const clDn = cnt(x => { const c = Number(x.outcome.closePct); return isFinite(c) && !(c > 0); });
  const med = arMedian(rs.map(x => x.outcome.closePct));
  const p1 = k => (k / n * 100).toFixed(1) + '%';
  const cmed = med == null ? '' : (med > 0 ? 'up' : med < 0 ? 'down' : '');
  h += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
  h += '<div style="flex:1;min-width:230px;padding:8px 10px;border:1px solid var(--line,#e5e8ec);border-radius:8px">'
    + '<div class="muted" style="font-size:11px">日内口径 · 看次日盘中高点（冲高兑现）</div>'
    + '<div style="margin-top:5px;font-size:13px">最高≥+3% <b style="color:#c92a2a">' + p1(hiP3) + '</b> <span class="muted">(' + hiP3 + '/' + n + ')</span></div>'
    + '<div style="margin-top:3px;font-size:13px">最高触板 <b>' + p1(hiLim) + '</b> <span class="muted">(' + hiLim + '/' + n + ')</span></div></div>';
  h += '<div style="flex:1;min-width:230px;padding:8px 10px;border:1px solid var(--line,#e5e8ec);border-radius:8px">'
    + '<div class="muted" style="font-size:11px">持股口径 · 看次日收盘（过夜说话）</div>'
    + '<div style="margin-top:5px;font-size:13px">收盘≥+3% <b>' + p1(clP3) + '</b> <span class="muted">(' + clP3 + '/' + n + ')</span> · 收跌 <b style="color:#0ca678">' + p1(clDn) + '</b> <span class="muted">(' + clDn + '/' + n + ')</span></div>'
    + '<div style="margin-top:3px;font-size:13px">收盘中位收益 <b class="' + cmed + '">' + arPctFmt(med) + '</b></div></div>';
  h += '</div>';
  h += probTable();
  h += '</div>';
  return h;
}
async function loadAuctionReview() {
  const el = document.getElementById('aucReview'); if (!el) return;
  el.innerHTML = '<div class="muted">加载竞价复盘数据…</div>';
  try {
    // ⛔ dz+ 轮（决策表 D1）：40 → 80（接口上限）。原来 n=40 实际只覆盖「单日 40 只」，
    //    聚合成了一张单日快照，比率受当天行情影响极大。抬到 80 后窗口约 2 天、样本翻倍，
    //    且列表与聚合仍是同一批（⛔ 不做「聚合 80、列表 40」—— 两批数据口径会打架）。
    const r = await fetch('/api/auction-log?n=80&_=' + Date.now()).then(x => x.json());
    if (!r || !r.ok || !r.items || !r.items.length) { el.innerHTML = '<div class="muted">暂无竞价信号留档（每日 9:25 后自动留档，T+1 收盘后可见次日结果）</div>'; return; }
    el.innerHTML = '<div style="margin-bottom:6px"><b>📊 竞价复盘</b> <span class="muted">竞价分时 + 次日K线同屏归因 · 点任一行看详情</span></div>' + arAggregate(r.items) + '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
      r.items.map(x => `<div class="tag" style="cursor:pointer" onclick="openAuctionReview('${x.code}','${x.date}')" title="点开看竞价分时+次日K线">
        <b>${esc(x.name || x.code)}</b> ${x.date.slice(4,6)}-${x.date.slice(6,8)} · 竞价${sign(x.auctionPct)}%${x.score != null ? ` 分${x.score}` : ''}${x.trap ? ' <span style="color:#c92a2a">诱多</span>' : ''} ${arOutcomeBadges(x.outcome)}</div>`).join('') + '</div>';
  } catch (e) { el.innerHTML = '<div class="muted">加载失败：' + (e && e.message || e) + '</div>'; }
}
function openAuctionReview(code, date) {
  AR.code = code; AR.date = date;
  let w = document.getElementById('arWrap');
  if (!w) { w = document.createElement('div'); w.id = 'arWrap'; document.body.appendChild(w); }
  w.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:60';
  w.innerHTML = `<div role="dialog" aria-label="竞价复盘" style="background:var(--bg,#fff);width:min(900px,94vw);max-height:92vh;overflow:auto;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.3)">
    <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line,#e5e8ec);flex-wrap:wrap">
      <b id="arName" style="font-size:15px">…</b><span class="muted" id="arCode"></span><span id="arBadge"></span>
      <span style="flex:1"></span><button class="btn ghost" id="arClose" style="font-size:12px;padding:3px 9px">关闭</button>
    </div>
    <div id="arBody" style="padding:12px"><div class="muted">加载中…</div></div>
  </div>`;
  w.addEventListener('click', e => { if (e.target === w) w.style.display = 'none'; });
  w.querySelector('#arClose').onclick = () => { w.style.display = 'none'; };
  arLoad();
}
async function arLoad() {
  const body = document.getElementById('arBody'); if (!body) return;
  body.innerHTML = '<div class="muted">加载竞价复盘…</div>';
  try {
    const r = await fetch('/api/auction-review?code=' + AR.code + '&date=' + AR.date + '&_=' + Date.now()).then(x => x.json());
    if (!r || !r.ok) { body.innerHTML = '<div class="muted">未能加载：' + ((r && r.error) || '未知错误') + '</div>'; return; }
    const rec = r.signal, o = r.outcome || {}, sd = r.sigDay;
    document.getElementById('arName').textContent = rec.name || rec.code;
    document.getElementById('arCode').textContent = rec.code + ' · ' + rec.date.slice(4, 6) + '-' + rec.date.slice(6, 8);
    // dy 轮 #290：弹窗与列表共用 arOutcomeBadges（高/收双列，⛔ 同一概念两份实现）；
    // 旧四分支把日内/持股混成一个徽章，且 nd_limit 标「次日涨停」名不副实（最高触板≠收盘封板）。
    const badge = o.pending ? '<span class="muted">次日K线未生成（T+1 收盘后可见）</span>' : arOutcomeBadges(o);
    document.getElementById('arBadge').innerHTML = badge;
    let m = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 12px">';
    m += `<div style="padding:6px 10px;border:1px solid var(--line,#e5e8ec);border-radius:8px"><div class="muted" style="font-size:11px">竞价涨幅</div><b class="${cls(rec.auctionPct)}">${sign(rec.auctionPct)}%</b></div>`;
    m += `<div style="padding:6px 10px;border:1px solid var(--line,#e5e8ec);border-radius:8px"><div class="muted" style="font-size:11px">竞价分</div><b>${rec.score != null ? rec.score : '-'}</b></div>`;
    m += `<div style="padding:6px 10px;border:1px solid var(--line,#e5e8ec);border-radius:8px"><div class="muted" style="font-size:11px">回测涨停概率</div><b>${rec.prob != null ? rec.prob + '%' : '-'}</b></div>`;
    m += `<div style="padding:6px 10px;border:1px solid var(--line,#e5e8ec);border-radius:8px"><div class="muted" style="font-size:11px">市场环境</div><b>${rec.mktUpRatio == null ? '未知' : (rec.mktUpRatio < 0.35 ? '普跌·降权' : rec.mktUpRatio < 0.5 ? '偏弱' : '正常')}</b></div>`;
    m += `<div style="padding:6px 10px;border:1px solid var(--line,#e5e8ec);border-radius:8px"><div class="muted" style="font-size:11px">撤单陷阱</div><b style="color:${rec.trap ? '#c92a2a' : ''}">${rec.trap ? '是 · ' + esc(rec.trapWhy || '') : '否'}</b></div>`;
    m += '</div>';
    if ((rec.why || []).length) m += '<div class="muted" style="white-space:normal">选股逻辑: ' + esc(rec.why.join(' + ')) + '</div>';
    if ((rec.risk || []).length) m += '<div class="muted" style="white-space:normal">⚠️ ' + esc(rec.risk.join(' | ')) + '</div>';
    body.innerHTML = m + '<div style="margin-top:10px"><b>竞价分时（09:15–09:25）</b><div id="arAuc"></div></div>';
    arDrawAuction(rec);
    const ndBox = document.createElement('div'); ndBox.style.marginTop = '12px';
    ndBox.innerHTML = '<b>次日K线（nd 归因）</b><div id="arNd"></div>';
    body.appendChild(ndBox);
    arDrawNextDay(o, sd);
  } catch (e) { body.innerHTML = '<div class="muted">加载失败：' + (e && e.message || e) + '</div>'; }
}
function arDrawAuction(rec) {
  const el = document.getElementById('arAuc'); if (!el) return;
  const tk = rec.ticks;
  if (!tk || !tk.bars || !tk.bars.length) { el.innerHTML = '<div class="muted" style="font-size:12px">该信号当日未留存竞价分时（仅 9:25 窗口抓取的强势票才留档；或竞价为空）</div>'; return; }
  const bars = tk.bars, pre = Number(tk.preClose) || 0;
  const prices = bars.map(b => Number(b.price) || 0).filter(Boolean);
  const W = 820, H = 240, pl = 40, pr = 10, pt = 12, pb = 46;
  const x0 = pl, x1 = W - pr, y0 = pt, y1 = H - pb;
  const pmin = Math.min(pre * 1.001, ...prices), pmax = Math.max(pre * 0.999, ...prices, pre * 1.06);
  const Y = p => y1 - (p - pmin) / (pmax - pmin || 1) * (y1 - y0);
  const X = i => x0 + (x1 - x0) * (i / (bars.length - 1 || 1));
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#fbfcfe">`;
  svg += `<line x1="${x0}" y1="${Y(pre)}" x2="${x1}" y2="${Y(pre)}" stroke="#adb5bd" stroke-dasharray="4 3" /><text x="${x1 - 2}" y="${Y(pre) - 3}" font-size="10" fill="#868e96" text-anchor="end">昨收 ${pre.toFixed(2)}</text>`;
  const p5 = pre * 1.05;
  if (p5 <= pmax) svg += `<line x1="${x0}" y1="${Y(p5)}" x2="${x1}" y2="${Y(p5)}" stroke="#ffa94d" stroke-dasharray="2 3" /><text x="${x1 - 2}" y="${Y(p5) - 3}" font-size="10" fill="#e8590c" text-anchor="end">+5% 诱多阈值</text>`;
  svg += `<polyline points="${bars.map((b, i) => X(i) + ',' + Y(Number(b.price) || 0)).join(' ')}" fill="none" stroke="#3b5bdb" stroke-width="1.6" />`;
  const vmax = Math.max(...bars.map(b => Number(b.volume) || 0), 1);
  bars.forEach((b, i) => {
    const v = Number(b.volume) || 0, bx = X(i), bw = Math.max(1, (x1 - x0) / bars.length * 0.6), bh = v / vmax * (pb - 8);
    svg += `<rect x="${bx - bw / 2}" y="${H - 8 - bh}" width="${bw}" height="${bh}" fill="#bac8ff" />`;
  });
  svg += `<text x="${X(0)}" y="${H - 2}" font-size="10" fill="#868e96">09:15</text>`;
  svg += `<text x="${X(Math.floor((bars.length - 1) * 0.5))}" y="${H - 2}" font-size="10" fill="#868e96" text-anchor="middle">09:20</text>`;
  svg += `<text x="${X(bars.length - 1)}" y="${H - 2}" font-size="10" fill="#868e96" text-anchor="end">09:25</text>`;
  svg += '</svg>';
  el.innerHTML = svg;
}
function arDrawNextDay(o, sd) {
  const el = document.getElementById('arNd'); if (!el) return;
  if (o.pending) {
    let h = '<div class="muted" style="font-size:12px">' + esc(o.reason || '次日K线未生成（T+1 收盘后可见）') + '</div>';
    if (sd) h += `<div style="margin-top:6px" class="muted">信号日当日K（上下文）：开 ${sd.open} 高 ${sd.high} 低 ${sd.low} 收 ${sd.close}</div>`;
    el.innerHTML = h; return;
  }
  const W = 220, H = 200, cx = W / 2, top = 18, bot = H - 30;
  const hi = Math.max(o.high, o.open, o.close), lo = Math.min(o.low, o.open, o.close), rg = (hi - lo) || 1;
  const Y = p => bot - (p - lo) / rg * (bot - top);
  const up = o.close >= o.open, col = up ? '#e03131' : '#2f9e44';
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="200" style="background:#fbfcfe">`;
  svg += `<line x1="${cx}" y1="${Y(o.high)}" x2="${cx}" y2="${Y(o.low)}" stroke="${col}" stroke-width="2" />`;
  const yO = Y(o.open), yC = Y(o.close);
  svg += `<rect x="${cx - 26}" y="${Math.min(yO, yC)}" width="52" height="${Math.abs(yC - yO) || 2}" fill="${col}" />`;
  svg += `<text x="${cx}" y="${top - 4}" font-size="10" fill="#495057" text-anchor="middle">次日 ${o.date}</text>`;
  svg += `<text x="${cx}" y="${bot + 16}" font-size="10" fill="#495057" text-anchor="middle">最高 ${(o.highPct * 100).toFixed(1)}% / 收盘 ${(o.closePct * 100).toFixed(1)}%</text>`;
  svg += '</svg>';
  let info = '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap"><div>' + svg + '</div><div style="font-size:12px;line-height:1.8">';
  info += `开盘跳空: <b class="${cls(o.openGap * 100)}">${(o.openGap * 100).toFixed(1)}%</b><br>`;
  info += `次日最高: <b class="${o.nd_limit ? 'up' : ''}">${(o.highPct * 100).toFixed(1)}%</b> ${o.nd_limit ? '（触板）' : ''}<br>`;
  info += `次日最低: ${(o.lowPct * 100).toFixed(1)}%<br>`;
  info += `次日收盘: <b class="${o.closeUp ? 'up' : 'down'}">${(o.closePct * 100).toFixed(1)}%</b><br>`;
  info += `次日最高触板: <b>${o.nd_limit ? '是 ✓' : '否'}</b><br>`;
  info += `nd +3%(最高): <b>${o.nd_p3 ? '是 ✓' : '否'}</b>`;
  info += '</div></div>';
  el.innerHTML = info;
}

async function klLoad(full) {
  if (!KL.code || KL.busy) return;
  KL.busy = true;
  const requestEpoch = KL.requestEpoch || 0;
  const tok = (typeof LOCK !== 'undefined' && LOCK.token) || '';
  try {
    const proms = [
      fetch('/api/kline?code=' + KL.code + '&_=' + Date.now()).then(x => x.json()).catch(() => null),
      fetch('/api/kline-marks?code=' + KL.code + '&token=' + encodeURIComponent(tok) + '&_=' + Date.now()).then(x => x.json()).catch(() => null),
    ];
    const [kr, mr] = await Promise.all(proms);
    if (requestEpoch !== (KL.requestEpoch || 0)) return;
    if (kr && kr.ok && kr.rows && kr.rows.length) {
      KL.rows = kr.rows; KL.ma = kr.ma;
      if (full) { KL.visN = Math.min(60, KL.rows.length); KL.i0 = Math.max(0, KL.rows.length - KL.visN); }
      if (KL.i0 + KL.visN > KL.rows.length) { KL.i0 = Math.max(0, KL.rows.length - KL.visN); }
    }
    if (mr && mr.ok) {
      KL.marks = mr; KL.name = mr.name || KL.name;
      KL.canPaper = !!mr.canSeePaper;
    }
    klRenderAll();
  } catch (e) {
    const bar = document.getElementById('klInfoBar');
    if (bar) bar.textContent = '加载失败：' + (e && e.message || e) + '（稍后自动重试）';
  }
  if (requestEpoch === (KL.requestEpoch || 0)) KL.busy = false;
}
function klRenderAll() {
  const w = klWrapEl(); if (!w) return;
  const nm = w.querySelector('#klName');
  if (nm) { nm.innerHTML = esc(KL.name || KL.code) + ' <span class="kl-link" style="font-weight:400" title="K线数据截止日"></span>'; }
  const cd = w.querySelector('#klCode'); if (cd) cd.textContent = KL.code;
  const providers = w.querySelector('#klProviders');
  if (providers) providers.innerHTML = typeof V6StockProviders === 'object' ? V6StockProviders.render(KL.code) : '外部行情入口未加载';
  // 洗盘/出货徽标（头部 + 详情区共用同一份判定）
  const wash = KL.marks && KL.marks.wash;
  const wl = w.querySelector('#klWash');
  if (wl && wash) {
    const v = wash.verdict;
    const map = { wash: ['洗盘倾向', '#e7f5ff', '#1971c2'], distribute: ['出货倾向', '#fff4e6', '#d9480f'], mixed: ['多空交织', '#f1f3f5', '#495057'], unknown: ['判不出', '#f1f3f5', '#868e96'] };
    const m = map[v] || map.unknown;
    wl.style.display = '';
    wl.innerHTML = `<span class="tag" style="background:${m[1]};color:${m[2]};font-weight:600" title="量价+均线+资金流加权判定，证据不足时如实显示「判不出」">${m[0]}</span>`;
  } else if (wl) wl.style.display = 'none';
  const asOf = w.querySelector('#klAsOf');
  if (asOf) {
    const d = KL.marks && KL.marks.asOf ? String(KL.marks.asOf).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : '';
    const sy = KL.marks && KL.marks.syncedAt ? new Date(KL.marks.syncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    asOf.textContent = (d ? 'K线截至 ' + d : '') + (sy ? ' · 持仓同步于 ' + sy : '');
  }
  const pl = w.querySelector('#klPaperLbl');
  if (pl) pl.style.display = KL.canPaper ? '' : 'none';
  klDraw();
  klRenderWash();
  klRenderFlow();
  klRenderPaper();
  klRenderFocus();
  const sy2 = w.querySelector('#klSync');
  if (sy2) sy2.textContent = KL.marks && KL.marks.replica ? '🖥 副本视图：K线为本机缓存，模拟盘账户已随线上同步（syncedAt 为最近一次成功同步时刻）' : '';
}
function klDraw() {
  const box = document.getElementById('klChart'); if (!box) return;
  const rows = KL.rows;
  if (!rows || !rows.length) { box.innerHTML = '<div class="muted" style="padding:18px">暂无K线数据</div>'; return; }
  const i0 = Math.max(0, Math.min(KL.i0, rows.length - KL.visN));
  const i1 = Math.min(rows.length, i0 + KL.visN);
  const vis = rows.slice(i0, i1);
  const n = vis.length;
  const W = 680, PL = 46, PR = 632, PW = PR - PL;
  const PT = 12, PH = 236;                 // 主图（K线）
  const VT = PT + PH + 18, VH = 62;        // 量能副图
  const H = VT + VH + 20;
  const barW = Math.max(2, PW / n);
  const bodyW = Math.max(1.5, barW * 0.62);
  // 价格域（含 MA 值，防 MA 出界被裁掉）
  let lo = Infinity, hi = -Infinity;
  const mk = KL.marks || {};
  const ma = klMaOfClient(rows);   // 前端实时算（懒加载更早数据后也准确，不依赖服务端窗口）
  const maArr = k => (ma && ma['ma' + k]) || [];
  for (const r of vis) { lo = Math.min(lo, +r.low); hi = Math.max(hi, +r.high); }
  for (const k of [5, 10, 20]) { const a = maArr(k).slice(i0, i1); for (const v of a) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  const holds = (KL.layers.paper && mk.paper && mk.paper.holds) || [];
  for (const h of holds) { if (h.stop) lo = Math.min(lo, h.stop); if (h.takeProfit) hi = Math.max(hi, h.takeProfit); if (h.buyPrice) { lo = Math.min(lo, h.buyPrice); hi = Math.max(hi, h.buyPrice); } }
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) { lo = (lo || 1) * 0.98; hi = (hi || 1) * 1.02; }
  const pad = (hi - lo) * 0.04; lo -= pad; hi += pad;
  const yP = v => PT + PH - (v - lo) / (hi - lo) * PH;
  const xI = i => PL + (i + 0.5) * barW;
  const dOf = d => String(d || '').replace(/-/g, '');
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;touch-action:pan-y" id="klSvg">`;
  s += `<rect x="${PL}" y="${PT}" width="${PW}" height="${PH}" fill="#fbfcfd" stroke="#e5e8ec"/>`;
  s += `<rect x="${PL}" y="${VT}" width="${PW}" height="${VH}" fill="#fbfcfd" stroke="#e5e8ec"/>`;
  // 网格 + 价格轴（4 档）
  for (let g = 0; g <= 4; g++) {
    const v = lo + (hi - lo) * g / 4, y = yP(v);
    s += `<line x1="${PL}" y1="${y}" x2="${PR}" y2="${y}" stroke="#eef1f4"/>`;
    s += `<text x="${PR + 4}" y="${y + 3.5}" font-size="9.5" fill="#697386">${v.toFixed(2)}</text>`;
  }
  // 量能轴上限
  const vmax = Math.max(1, ...vis.map(r => +r.volume || 0));
  const yV = v => VT + VH - (v / vmax) * VH;
  s += `<text x="${PR + 4}" y="${VT + 8}" font-size="9.5" fill="#697386">量${vmax >= 1e4 ? (vmax / 1e4).toFixed(0) + '万' : vmax}</text>`;
  // 做T区（最底层，半透明）
  const tArr = (KL.layers.algo && mk.algo && mk.algo.t) || [];
  for (const t of tArr) {
    const idx = vis.findIndex(r => dOf(r.date) === t.date);
    if (idx < 0) continue;
    s += `<rect x="${PL + idx * barW}" y="${yP(t.high)}" width="${barW}" height="${Math.max(1, yP(t.low) - yP(t.high))}" fill="rgba(245,159,0,.14)" stroke="rgba(245,159,0,.45)" stroke-dasharray="2 2"><title>做T区 ${t.date} 振幅${t.amp}%（${t.low}~${t.high}）</title></rect>`;
  }
  // K 线实体 + 影线 + 量能柱
  for (let i = 0; i < n; i++) {
    const r = vis[i], o = +r.open, c = +r.close, h = +r.high, l = +r.low, v = +r.volume || 0;
    const up = c >= o;
    const col = up ? '#e03131' : '#0ca678';
    const x = xI(i);
    s += `<line x1="${x}" y1="${yP(h)}" x2="${x}" y2="${yP(l)}" stroke="${col}" stroke-width="1"/>`;
    const yTop = yP(Math.max(o, c)), yBot = yP(Math.min(o, c));
    s += `<rect x="${x - bodyW / 2}" y="${yTop}" width="${bodyW}" height="${Math.max(1, yBot - yTop)}" fill="${col}"><title>${r.date} 开${o} 高${h} 低${l} 收${c}（${up ? '+' : ''}${(+r.pct || 0).toFixed(2)}%）量${(v / 1e4).toFixed(0)}万手</title></rect>`;
    const vh = Math.max(1, (v / vmax) * VH);
    s += `<rect x="${x - bodyW / 2}" y="${VT + VH - vh}" width="${bodyW}" height="${vh}" fill="${col}" opacity="0.75"/>`;
  }
  // 均线（MA5/10/20/60）
  const maCol = { 5: '#f59f00', 10: '#7048e8', 20: '#1c7ed6', 60: '#2b8a3e' };
  for (const k of [5, 10, 20, 60]) {
    const full = maArr(k);
    if (!full.length) continue;
    const pts = [];
    for (let i = i0; i < i1; i++) { const v = full[i]; if (v != null) pts.push(xI(i - i0).toFixed(1) + ',' + yP(v).toFixed(1)); }
    if (pts.length > 1) s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${maCol[k]}" stroke-width="1.3"/>`;
  }
  // 均量线（MA5/MA10 volume）
  const vfull = rows.map(r => +r.volume || 0);
  for (const [k, col] of [[5, '#f59f00'], [10, '#7048e8']]) {
    const pts = [];
    for (let i = i0; i < i1; i++) {
      if (i + 1 < k) continue;
      let sum = 0; for (let j = i - k + 1; j <= i; j++) sum += vfull[j];
      pts.push(xI(i - i0).toFixed(1) + ',' + yV(sum / k).toFixed(1));
    }
    if (pts.length > 1) s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1" opacity="0.8"/>`;
  }
  // ── 算法层标注 ──
  if (KL.layers.algo && mk.algo) {
    for (const b of (mk.algo.buy || [])) {
      const idx = vis.findIndex(r => dOf(r.date) === b.date);
      if (idx < 0) continue;
      const x = xI(idx), y = yP(+vis[idx].low) + 9;
      const col = KL_COLOR[b.type] || '#495057';
      s += `<path d="M ${x - 4} ${y - 6} L ${x + 4} ${y - 6} L ${x} ${y} Z" fill="${col}"><title>${b.label}${b.prob != null ? ' · 概率' + b.prob + '%' : ''}${b.price ? ' · ' + b.price : ''}</title></path>`;
    }
    for (const l of (mk.algo.lock || [])) {
      const idx = vis.findIndex(r => dOf(r.date) === l.date);
      if (idx < 0) continue;
      s += `<circle cx="${xI(idx)}" cy="${PT + PH - 3}" r="2.4" fill="#2b8a3e"><title>锁仓依据：${l.note}</title></circle>`;
    }
  }
  // ── 模拟盘成交层 ──
  if (KL.layers.paper && mk.paper) {
    for (const h of holds) {
      const lines = [[h.buyPrice, '#3b5bdb', '成本'], [h.stop, '#c92a2a', '止损'], [h.takeProfit, '#2b8a3e', '止盈']];
      for (const [v, col, lb] of lines) {
        if (v == null) continue;
        if (v < lo || v > hi) continue;
        s += `<line x1="${PL}" y1="${yP(v)}" x2="${PR}" y2="${yP(v)}" stroke="${col}" stroke-width="1" stroke-dasharray="5 3" opacity="0.85"><title>${lb}线 ${v}（${h.accName}）</title></line>`;
        s += `<text x="${PL + 3}" y="${yP(v) - 2.5}" font-size="9" fill="${col}">${lb} ${v}</text>`;
      }
    }
    for (const t of (mk.paper.trades || [])) {
      const idx = vis.findIndex(r => dOf(r.date) === t.date);
      if (idx < 0 || t.price == null) continue;
      const x = xI(idx), y = yP(t.price);
      if (t.side === '买入') s += `<path d="M ${x - 4.5} ${y + 8} L ${x + 4.5} ${y + 8} L ${x} ${y + 1} Z" fill="#3b5bdb" stroke="#fff" stroke-width="0.6"><title>买入 @${t.price}${t.reason ? ' · ' + t.reason : ''}</title></path>`;
      else s += `<path d="M ${x - 4.5} ${y - 8} L ${x + 4.5} ${y - 8} L ${x} ${y - 1} Z" fill="#d9480f" stroke="#fff" stroke-width="0.6"><title>卖出 @${t.price}${t.pnl != null ? ' · 盈亏' + t.pnl : ''}${t.reason ? ' · ' + t.reason : ''}</title></path>`;
    }
  }
  // 日期轴（首/中/末）
  const dIdx = [0, Math.floor(n / 2), n - 1];
  for (const i of dIdx) {
    const d = String(vis[i].date || '');
    s += `<text x="${xI(i)}" y="${H - 6}" font-size="9.5" fill="#697386" text-anchor="middle">${d.slice(5)}</text>`;
  }
  // 十字光标（默认跟最后一根）
  const ci = KL.crossIdx >= 0 && KL.crossIdx < n ? KL.crossIdx : n - 1;
  s += `<line x1="${xI(ci)}" y1="${PT}" x2="${xI(ci)}" y2="${VT + VH}" stroke="#adb5bd" stroke-width="0.8" stroke-dasharray="3 2"/>`;
  s += '</svg>';
  box.innerHTML = s;
  const rng = document.getElementById('klRange');
  if (rng) rng.textContent = `${vis[0].date.slice(5)}~${vis[n - 1].date.slice(5)}（${n}日）`;
  // 信息条：光标列明细（默认最后一根）
  klShowCross(ci);
  // 光标 / 拖拽平移 / 点蜡烛看当日分析（鼠标 + 触摸）
  const svg = document.getElementById('klSvg');
  if (svg) {
    const idxAt = e => {
      const rect = svg.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const vx = cx / rect.width * W;
      return Math.round((vx - PL) / barW - 0.5);
    };
    const down = e => { _klPan = { sx: (e.touches ? e.touches[0].clientX : e.clientX), si0: KL.i0, moved: false }; };
    const mmove = e => {
      if (_klPan) {
        const cx = (e.touches ? e.touches[0].clientX : e.clientX);
        const dx = cx - _klPan.sx;
        if (Math.abs(dx) > 4) _klPan.moved = true;
        const PWp = PR - PL, dIdx = Math.round(dx / (PWp / Math.max(1, n)));
        let ni = Math.max(0, Math.min(KL.rows.length - n, _klPan.si0 - dIdx));
        if (ni !== KL.i0) { KL.i0 = ni; klDraw(); }
        if (e.cancelable) e.preventDefault();
        if (ni <= 1 && !KL.loadingOlder) klLazyOlder();   // 左滑到头 → 懒加载更早
      } else {
        const idx = idxAt(e);
        if (idx >= 0 && idx < n && idx !== KL.crossIdx) { KL.crossIdx = idx; klDraw(); }
      }
    };
    const up = e => {
      if (_klPan && !_klPan.moved) {
        const idx = idxAt(e);
        if (idx >= 0 && idx < n) { const r = vis[idx]; if (r) focusDay(String(r.date).replace(/-/g, '')); }
      }
      _klPan = null;
    };
    svg.addEventListener('mousedown', down);
    svg.addEventListener('mousemove', mmove);
    svg.addEventListener('mouseup', up);
    svg.addEventListener('mouseleave', () => { _klPan = null; if (KL.crossIdx !== -1) { KL.crossIdx = -1; klDraw(); } });
    svg.addEventListener('touchstart', down, { passive: true });
    svg.addEventListener('touchmove', mmove, { passive: false });
    svg.addEventListener('touchend', up);
  }
  // jy 轮：K线面板图例——把 MA5/10/20/60 的颜色对应关系显式标出来。
  const leg = document.getElementById('klLegend');
  if (leg) {
    const dot = c => `<span style="display:inline-block;width:10px;height:3px;background:${c};margin-right:3px;vertical-align:middle"></span>`;
    leg.innerHTML = `${dot('#f59f00')}MA5 ${dot('#7048e8')}MA10 ${dot('#1c7ed6')}MA20 ${dot('#2b8a3e')}MA60<span class="muted" style="margin-left:8px">（红涨绿跌 · 量能与K线同色）</span>`;
  }
}
// 前端实时算 MA（与 server 端 klineMaOf 同口径，避免服务端窗口与懒加载错位）
function klMaOfClient(rows) {
  const one = k => rows.map((r, i) => {
    if (i + 1 < k) return null;
    let s = 0; for (let j = i - k + 1; j <= i; j++) s += (Number(rows[j].close) || 0);
    return +(s / k).toFixed(4);
  });
  // jy 轮：K线面板后续——补 MA60 中长期均线。
  return { ma5: one(5), ma10: one(10), ma20: one(20), ma60: one(60) };
}
// 蜡烛图左滑到头 → 懒加载更早数据（server /api/kline?end=）
async function klLazyOlder() {
  if (KL.loadingOlder || !KL.rows.length) return;
  KL.loadingOlder = true;
  const oldest = String(KL.rows[0].date).replace(/-/g, '');
  try {
    const r = await fetch('/api/kline?code=' + KL.code + '&end=' + oldest + '&n=60&_=' + Date.now()).then(x => x.json());
    if (r && r.ok && r.rows && r.rows.length) {
      const set = new Set(KL.rows.map(x => String(x.date).replace(/-/g, '')));
      const add = r.rows.filter(x => !set.has(String(x.date).replace(/-/g, '')));
      if (add.length) { KL.rows = add.concat(KL.rows); KL.i0 += add.length; klDraw(); }
    }
  } catch (e) {} finally { KL.loadingOlder = false; }
}
// 点蜡烛图 → 当日聚焦分析（server /api/kline-marks?date=）
async function focusDay(date) {
  if (!KL.code) return;
  const tok = (typeof LOCK !== 'undefined' && LOCK.token) || '';
  try {
    const mr = await fetch('/api/kline-marks?code=' + KL.code + '&date=' + date + '&token=' + encodeURIComponent(tok) + '&_=' + Date.now()).then(x => x.json());
    if (mr && mr.ok) { KL.focus = mr.focus; klRenderFocus(); }
  } catch (e) {}
}
function klRenderFocus() {
  const box = document.getElementById('klFocus'); if (!box) return;
  const f = KL.focus;
  if (!f) { box.innerHTML = ''; return; }
  box.innerHTML = '<div style="padding:8px 10px;border:1px solid #e5e8ec;border-radius:8px;margin-top:8px">' +
    '<div style="font-weight:700;font-size:12.5px">📅 当日分析 ' + f.date + ' <span class="muted" style="font-weight:400">（点蜡烛图切换日期）</span></div>' +
    '<div style="font-size:12px;margin-top:3px">' + esc(f.brief) + '</div>' +
    (f.trades && f.trades.length ? '<div style="font-size:12px;margin-top:2px">模拟盘：' + f.trades.map(t => esc(t.date) + ' ' + esc(t.side) + '@' + t.price).join(' · ') + '</div>' : '') +
    '</div>';
}
function klShowCross(ci) {
  const bar = document.getElementById('klInfoBar'); if (!bar) return;
  const rows = KL.rows; if (!rows || !rows.length) { bar.textContent = ''; return; }
  const i0 = Math.max(0, Math.min(KL.i0, rows.length - KL.visN));
  const r = rows[i0 + ci]; if (!r) { bar.textContent = ''; return; }
  const up = (+r.close || 0) >= (+r.open || 0);
  bar.innerHTML = `<b>${r.date}</b> 开${r.open} 高${r.high} 低${r.low} 收<b style="color:${up ? '#e03131' : '#0ca678'}">${r.close}</b> <span style="color:${up ? '#e03131' : '#0ca678'}">${up ? '+' : ''}${(+r.pct || 0).toFixed(2)}%</span> · 量${(r.volume / 1e4).toFixed(0)}万手 · 换手${(+r.turnover || 0).toFixed(1)}%`;
}
function klRenderWash() {
  const box = document.getElementById('klWashBox'); if (!box) return;
  const w = KL.marks && KL.marks.wash;
  if (!w) { box.innerHTML = ''; return; }
  const map = { wash: ['🧊 洗盘倾向', '#e7f5ff', '#1971c2', '量价与资金流证据加权后偏向「缩量整理、承接强」——不是恐慌抛售'], distribute: ['📤 出货倾向', '#fff4e6', '#d9480f', '量价与资金流证据加权后偏向「放量派发、承接弱」——警惕高位风险'], mixed: ['⚖️ 多空交织', '#f1f3f5', '#495057', '洗盘与出货证据相当，方向未明，等下一根K线或资金流确认'], unknown: ['❓ 判不出', '#f1f3f5', '#868e96', '数据不足，不硬判'] };
  const m = map[w.verdict] || map.unknown;
  const colOf = side => side === 'wash' ? '#1971c2' : side === 'distribute' ? '#d9480f' : '#868e96';
  const preOf = side => side === 'wash' ? '＋' : side === 'distribute' ? '－' : '·';
  box.innerHTML = `<div style="padding:8px 10px;border-radius:8px;background:${m[1]};border:1px solid ${m[2]}33">
    <div style="font-weight:700;color:${m[2]}">${m[0]} <span class="muted" style="font-weight:400">（证据分 ${w.score > 0 ? '+' : ''}${w.score}）</span></div>
    <div class="muted" style="font-size:11.5px;margin:2px 0 6px">${m[3]}</div>
    ${(w.reasons || []).map(r => `<div style="font-size:12px;color:${colOf(r.side)};line-height:1.6"><b>${preOf(r.side)}</b> ${esc(r.text)}</div>`).join('')}
    <div class="muted" style="font-size:11px;margin-top:5px">量能比 ${w.volRatio == null ? '-' : (w.volRatio * 100).toFixed(0) + '%'}（近5日/20日均量）· 收盘位置 ${w.closePos == null ? '-' : (w.closePos * 100).toFixed(0) + '%'} · 20日区间位置 ${w.rangePos == null ? '-' : (w.rangePos * 100).toFixed(0) + '%'} · ${w.ma20 == null ? 'MA20判不出' : 'MA20 ' + w.ma20 + '（' + (w.aboveMa ? '上方' : '下方') + '·' + (w.maUp === true ? '上行' : w.maUp === false ? '下行' : '斜率判不出') + '）'}</div>
  </div>`;
}
function klRenderFlow() {
  const box = document.getElementById('klFlowBox'); if (!box) return;
  const mk = KL.marks || {};
  const f = mk.flow;
  if (!f) { box.innerHTML = `<div class="muted" style="font-size:12px">💧 当日大单资金流：${esc(mk.flowWhy || '未取到')}</div>`; return; }
  // ③b：同花顺兜底源（仅给主动净买占比，无四级拆分）→ 显式标注口径差异
  if (f.source === 'ths') {
    const cls = f.mainPct > 0 ? 'up' : f.mainPct < 0 ? 'down' : '';
    box.innerHTML = `<div style="padding:8px 10px;border:1px solid #e5e8ec;border-radius:8px">
      <div style="font-weight:600;font-size:12.5px">💧 当日大单资金流（同花顺兜底） <span class="muted" style="font-weight:400">主动净买占比 <b class="${cls}" style="font-size:14px">${f.mainPct > 0 ? '+' : ''}${f.mainPct}%</b></span></div>
      <div style="font-size:12px;margin-top:3px">主动净买额 <b class="${cls}">${f.today > 0 ? '+' : ''}${klMoney(f.today)}</b></div>
      <div class="muted" style="font-size:11px;margin-top:3px">${esc(f.note || '东财资金流未返回，已用同花顺主动净买占比兜底（无超大/大/中/小单四级拆分）')}。数据源：同花顺。</div>
    </div>`;
    return;
  }
  const net = (v, lb) => `<span style="margin-right:10px">${lb} <b class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${klMoney(v)}</b></span>`;
  box.innerHTML = `<div style="padding:8px 10px;border:1px solid #e5e8ec;border-radius:8px">
    <div style="font-weight:600;font-size:12.5px">💧 当日大单资金流（四级·东财） <span class="muted" style="font-weight:400">主力净占比 <b class="${f.mainPct > 0 ? 'up' : f.mainPct < 0 ? 'down' : ''}" style="font-size:14px">${f.mainPct > 0 ? '+' : ''}${f.mainPct}%</b></span></div>
    <div style="font-size:12px;margin-top:3px">${net(f.superNet, '超大单')}${net(f.bigNet, '大单')}${net(f.midNet, '中单')}${net(f.smallNet, '小单')}</div>
    <div class="muted" style="font-size:11px;margin-top:3px">净额＝主动买入−主动卖出；红=净流入、绿=净流出。数据为当日盘中/收盘值，非交易时段显示最近一个交易日的定格值。数据源：东财。</div>
  </div>`;
}
function klRenderPaper() {
  const box = document.getElementById('klPaperBox'); if (!box) return;
  const mk = KL.marks || {};
  if (!mk.canSeePaper) { box.innerHTML = `<div class="muted" style="font-size:12px">🔒 模拟盘成交层属私密数据，只读（观看）权限不可查看</div>`; return; }
  const p = mk.paper || {};
  const holds = p.holds || [], trades = p.trades || [];
  if (!holds.length && !trades.length) { box.innerHTML = `<div class="muted" style="font-size:12px">模拟盘双账户当前无该票持仓与成交记录</div>`; return; }
  box.innerHTML = `<div style="padding:8px 10px;border:1px solid #e5e8ec;border-radius:8px">
    <div style="font-weight:600;font-size:12.5px">📈 模拟盘成交层（真实成交，非预测）</div>
    ${holds.map(h => `<div style="font-size:12px;margin-top:3px">【${esc(h.accName)}】成本 <b>${h.buyPrice}</b>（${h.buyDate}）· 止损 <b class="down">${h.stop}</b>（${h.stopPct}%）· 止盈 <b class="up">${h.takeProfit}</b>${h.lastPrice ? ' · 现价 ' + h.lastPrice : ''}${h.reason ? ' · ' + esc(h.reason) : ''}</div>`).join('')}
    ${trades.map(t => `<div style="font-size:12px;margin-top:2px">${t.date} <b style="color:${t.side === '买入' ? '#3b5bdb' : '#d9480f'}">${t.side}</b> @${t.price}${t.pnl != null ? ' 盈亏 <b class="' + (t.pnl > 0 ? 'up' : 'down') + '">' + (t.pnl > 0 ? '+' : '') + t.pnl + '</b>' : ''} <span class="muted">${esc(t.reason || '')}</span></div>`).join('')}
  </div>`;
}
// ═══ ⑤ 个股搜索 + 分析（用户 2026-10-14：「加一个搜索票的功能，我给你票你给我分析」）═══
let _searchTimer = null;
function onSearchInput() {
  const q = (document.getElementById('searchBox') || {}).value || '';
  const qv = q.trim();
  const hint = document.getElementById('searchHint');
  if (hint) hint.textContent = qv ? '输入中…' : '';
  if (!qv) { const c = document.getElementById('searchCands'); if (c) c.innerHTML = ''; return; }
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(doSearch, 250);
}
async function doSearch() {
  const q = ((document.getElementById('searchBox') || {}).value || '').trim();
  if (!q) return;
  const hint = document.getElementById('searchHint'), cands = document.getElementById('searchCands');
  hint.textContent = '搜索中…';
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q)).then(x => x.json());
    if (r && r.items && r.items.length) {
      hint.textContent = '匹配 ' + r.items.length + ' 只（点选或回车分析第一只）';
      cands.innerHTML = r.items.map(it => `<span class="tag" style="cursor:pointer;background:#e7f5ff;color:#1971c2" onclick="pickAnalyze('${it.code}')">${esc(it.name)} <span class="muted">${it.code}</span></span>`).join('');
    } else { hint.textContent = '未匹配到股票（试试代码或名称关键字）'; cands.innerHTML = ''; }
  } catch (e) { hint.textContent = '搜索失败'; }
}
function searchPickFirst() {
  const q = ((document.getElementById('searchBox') || {}).value || '').trim();
  if (/^\d{6}$/.test(q)) { pickAnalyze(q); return; }
  const first = document.querySelector('#searchCands .tag');
  if (first) first.click(); else doSearch();
}
async function pickAnalyze(code) {
  const box = document.getElementById('analyzeBox'); if (!box) return;
  box.innerHTML = '<div class="muted">分析中…</div>';
  try {
    const r = await fetch('/api/analyze?code=' + encodeURIComponent(code) + '&token=' + encodeURIComponent(LOCK.token || '')).then(x => x.json());
    renderAnalyze(r);
  } catch (e) { box.innerHTML = '<div class="muted">分析失败：' + esc(e && e.message ? e.message : String(e)) + '</div>'; }
}
function renderAnalyze(d) {
  const box = document.getElementById('analyzeBox'); if (!box) return;
  if (!d || !d.ok) { box.innerHTML = '<div class="muted">' + esc((d && d.error) || '无数据') + '</div>'; return; }
  const up = Number(d.pct) >= 0;
  const pctTxt = (d.pct == null ? '' : (up ? '+' : '') + d.pct + '%');
  const ma = d.ma || {};
  const algo = d.algo || {};
  const buyN = (algo.buy || []).length, tN = (algo.t || []).length, lockN = (algo.lock || []).length;
  // 洗盘/出货（与 K线面板同一份配色与口径）
  const w = d.wash;
  const wmap = { wash: ['🧊 洗盘倾向', '#e7f5ff', '#1971c2', '量价与资金流证据加权后偏向「缩量整理、承接强」——不是恐慌抛售'], distribute: ['📤 出货倾向', '#fff4e6', '#d9480f', '量价与资金流证据加权后偏向「放量派发、承接弱」——警惕高位风险'], mixed: ['⚖️ 多空交织', '#f1f3f5', '#495057', '洗盘与出货证据相当，方向未明，等下一根K线或资金流确认'], unknown: ['❓ 判不出', '#f1f3f5', '#868e96', '数据不足，不硬判'] };
  const wm = wmap[(w && w.verdict) || 'unknown'] || wmap.unknown;
  const colOf = side => side === 'wash' ? '#1971c2' : side === 'distribute' ? '#d9480f' : '#868e96';
  const preOf = side => side === 'wash' ? '＋' : side === 'distribute' ? '－' : '·';
  const washHtml = w ? `<div style="padding:8px 10px;border-radius:8px;background:${wm[1]};border:1px solid ${wm[2]}33">
    <div style="font-weight:700;color:${wm[2]}">${wm[0]} <span class="muted" style="font-weight:400">（证据分 ${w.score > 0 ? '+' : ''}${w.score}）</span></div>
    <div class="muted" style="font-size:11.5px;margin:2px 0 6px">${wm[3]}</div>
    ${(w.reasons || []).map(r => `<div style="font-size:12px;color:${colOf(r.side)};line-height:1.6"><b>${preOf(r.side)}</b> ${esc(r.text)}</div>`).join('')}
    <div class="muted" style="font-size:11px;margin-top:5px">量能比 ${w.volRatio == null ? '-' : (w.volRatio * 100).toFixed(0) + '%'} · 收盘位置 ${w.closePos == null ? '-' : (w.closePos * 100).toFixed(0) + '%'} · 20日区间位置 ${w.rangePos == null ? '-' : (w.rangePos * 100).toFixed(0) + '%'} · ${w.ma20 == null ? 'MA20判不出' : 'MA20 ' + w.ma20 + '（' + (w.aboveMa ? '上方' : '下方') + '·' + (w.maUp === true ? '上行' : w.maUp === false ? '下行' : '斜率判不出') + '）'}</div>
  </div>` : '';
  // 当日大单资金流（四级东财 / 同花顺兜底，与 K线面板同源口径）
  const f = d.flow;
  let flowHtml;
  if (!f) flowHtml = `<div class="muted" style="font-size:12px">💧 当日大单资金流：${esc(d.flowWhy || '未取到')}</div>`;
  else if (f.source === 'ths') {
    const cls = f.mainPct > 0 ? 'up' : f.mainPct < 0 ? 'down' : '';
    flowHtml = `<div style="padding:8px 10px;border:1px solid #e5e8ec;border-radius:8px">
      <div style="font-weight:600;font-size:12.5px">💧 当日大单资金流（同花顺兜底） <span class="muted" style="font-weight:400">主动净买占比 <b class="${cls}" style="font-size:14px">${f.mainPct > 0 ? '+' : ''}${f.mainPct}%</b></span></div>
      <div style="font-size:12px;margin-top:3px">主动净买额 <b class="${cls}">${f.today > 0 ? '+' : ''}${klMoney(f.today)}</b></div>
      <div class="muted" style="font-size:11px;margin-top:3px">${esc(f.note || '东财资金流未返回，已用同花顺主动净买占比兜底（无超大/大/中/小单四级拆分）')}。数据源：同花顺。</div>
    </div>`;
  } else {
    const net = (v, lb) => `<span style="margin-right:10px">${lb} <b class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${klMoney(v)}</b></span>`;
    flowHtml = `<div style="padding:8px 10px;border:1px solid #e5e8ec;border-radius:8px">
      <div style="font-weight:600;font-size:12.5px">💧 当日大单资金流（四级·东财） <span class="muted" style="font-weight:400">主力净占比 <b class="${f.mainPct > 0 ? 'up' : f.mainPct < 0 ? 'down' : ''}" style="font-size:14px">${f.mainPct > 0 ? '+' : ''}${f.mainPct}%</b></span></div>
      <div style="font-size:12px;margin-top:3px">${net(f.superNet, '超大单')}${net(f.bigNet, '大单')}${net(f.midNet, '中单')}${net(f.smallNet, '小单')}</div>
      <div class="muted" style="font-size:11px;margin-top:3px">数据为当日盘中/收盘值。数据源：东财。</div>
    </div>`;
  }
  const briefHtml = d.brief ? `<div style="font-size:12.5px;line-height:1.7;margin-top:8px;padding:8px 10px;background:#f8f9fa;border-radius:8px">${esc(d.brief)}</div>` : '';
  box.innerHTML = `<div style="padding:10px 12px;border:1px solid #e5e8ec;border-radius:10px">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <b style="font-size:16px">${esc(d.name || d.code)}</b><span class="muted">${d.code}</span>
      <span style="font-weight:700;color:${up ? '#d9480f' : '#2f9e44'}">${d.price == null ? '' : d.price}</span>
      <span class="${up ? 'up' : 'down'}">${pctTxt}</span>
    </div>
    <div class="muted" style="font-size:12px;margin-top:2px">K线截至 ${String(d.asOf).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')} · 均线 MA5 ${ma.ma5 == null ? '-' : ma.ma5} / MA10 ${ma.ma10 == null ? '-' : ma.ma10} / MA20 ${ma.ma20 == null ? '-' : ma.ma20} / MA60 ${ma.ma60 == null ? '-' : ma.ma60}</div>
    <div style="margin-top:8px;font-size:12px">算法标注：买点 <b>${buyN}</b> · 做T <b>${tN}</b> · 锁仓 <b>${lockN}</b>${algo.fuse != null ? ' · 融合概率 ' + algo.fuse + '%' : ''}</div>
    <div style="margin-top:8px">${washHtml}</div>
    <div style="margin-top:8px">${flowHtml}</div>
    ${briefHtml}
    <div style="margin-top:8px"><button class="btn ghost" onclick="openKline('${d.code}')">📈 打开K线面板看买卖点/量能</button></div>
    ${d.paperHidden ? `<div class="muted" style="font-size:11px;margin-top:6px">${esc(d.paperHidden)}</div>` : ''}
  </div>`;
}
// 页面内提示条：全面替代 alert/confirm，杜绝浏览器弹窗
// ⛔⛔ dy 轮（2026-10-17）：这里原来是裸 `el` —— 全项目既没有 `let el`、也没有 id="el"
//    的元素，于是 pageMsg() **第一次调用就抛 ReferenceError: el is not defined**，
//    67 个调用点的提示全部静默失效（每个调用点外面都有 try/catch 或 window.onerror
//    兜着，所以既不报错也不显示，表现就是"点了没反应"）。
//    更要命的是 stateFetchFail 也调它：一次弱网失败本该弹中性 toast，实际却让
//    refresh 整体 reject → 被 window.onerror 兜成 data-why=render 的红框，
//    而那种框**永远不会被 _stateFailOK 摘掉**（它只摘 statefetch）——
//    这就是用户看到的「红框一直挂在那儿」的第一真凶。
//    jsdom 真跑取证（_forensic_statefail.js）：mock 一次 Failed to fetch，
//    弹出的就是「面板刷新出错」而不是中性提示。
//    ⛔ 变量名用 _toastEl 而不是 el：页面里几十处 `const el = getElementById(...)`，
//       同一个名字迟早还会被人误读成同一个东西。
let _toastTimer = null, _toastEl = null;
function pageMsg(text, type) {
  // ⛔ dy 轮：isConnected 必须一起判 —— toast 被别处 remove 掉之后 _toastEl 仍然指着
  //    那个脱离文档的节点，之后所有提示都会写进"空气里"，一个字也看不见。
  if (!_toastEl || !_toastEl.isConnected) {
    _toastEl = document.createElement('div'); _toastEl.id = 'pageToast';
    _toastEl.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9999;padding:10px 18px;border-radius:8px;' +
      'font-size:13px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.15);background:#fff;color:#212529;border:1px solid #dee2e6;transition:opacity .25s';
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = text;
  _toastEl.style.borderColor = type === 'ok' ? '#8ce99a' : type === 'err' ? '#ffa8a8' : '#dee2e6';
  _toastEl.style.background = type === 'ok' ? '#ebfbee' : type === 'err' ? '#fff5f5' : '#fff';
  _toastEl.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { _toastEl.style.opacity = '0'; }, 2600);
}
// ── 页内确认框 / 输入框（gj 轮，替代 confirm()/prompt()）──────────────
// 2026-10-12 用户反馈「偶发黑色弹窗」：系统/浏览器处于深色模式时，原生 confirm/prompt
// 会渲染成近黑底色的对话框，与整站浅色主题完全不搭，也没法展示长说明、不支持 Esc 取消。
// 本项目在 pageMsg 那里早就立下"全面替代 alert/confirm、杜绝浏览器弹窗"的目标，
// 却仍剩 4 处漏网（改只读密码 / 设模拟盘本金 / 删选中持仓 / 清空全部持仓）—— 就是它们。
// ⛔ 一律浅色：卡片白色、遮罩浅色半透明，绝不引入深色面；Esc=取消，Enter=确定。
function uiModalOpen(inner, onKey) {
  const wrap = document.createElement('div');
  wrap.id = 'uiModal';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(245,246,248,.82);' +
    'display:flex;align-items:center;justify-content:center;padding:18px';
  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;color:#212529;border:1px solid #dee2e6;border-radius:12px;' +
    'box-shadow:0 10px 34px rgba(0,0,0,.16);max-width:min(460px,94vw);width:100%;padding:16px 18px;font-size:13.5px;line-height:1.6';
  card.innerHTML = inner;
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', kh, true); };
  const kh = e => {
    const ae = document.activeElement;
    const onBtn = !!(ae && ae.tagName === 'BUTTON');
    if (e.key === 'Escape') { e.preventDefault(); onKey('esc'); }
    else if (e.key === 'Enter' && !onBtn) { e.preventDefault(); onKey('enter'); }
  };
  document.addEventListener('keydown', kh, true);
  return { wrap, card, close };
}
// 返回 Promise<boolean>；取消（Esc / 点遮罩 / 点取消）= false
function uiConfirm(text, okLabel, cancelLabel) {
  return new Promise(resolve => {
    let done = false;
    const m = uiModalOpen(
      '<div style="white-space:pre-wrap;word-break:break-word">' + esc(text) + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button class="btn ghost" id="uiMNo">' + esc(cancelLabel || '取消') + '</button>' +
      '<button class="btn" id="uiMYes">' + esc(okLabel || '确定') + '</button></div>',
      k => { if (k === 'enter') fin(true); else if (k === 'esc') fin(false); });
    const fin = v => { if (done) return; done = true; m.close(); resolve(v); };
    m.card.querySelector('#uiMYes').onclick = () => fin(true);
    m.card.querySelector('#uiMNo').onclick = () => fin(false);
    m.wrap.addEventListener('click', e => { if (e.target === m.wrap) fin(false); });
    setTimeout(() => { const b = m.card.querySelector('#uiMYes'); if (b) b.focus(); }, 30);
  });
}
// 返回 Promise<string|null>；取消 = null（与 prompt() 语义一致），空串按"没填"由调用方处理
function uiPrompt(text, def) {
  return new Promise(resolve => {
    let done = false;
    const m = uiModalOpen(
      '<div style="white-space:pre-wrap;word-break:break-word;margin-bottom:8px">' + esc(text) + '</div>' +
      '<input id="uiMIn" type="text" style="width:100%;padding:9px 11px;font-size:15px;border:1px solid #ced4da;border-radius:8px" />' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button class="btn ghost" id="uiMNo">取消</button>' +
      '<button class="btn" id="uiMYes">确定</button></div>',
      k => { if (k === 'enter') fin(true); else if (k === 'esc') fin(false); });
    const inp = m.card.querySelector('#uiMIn');
    inp.value = def == null ? '' : String(def);
    const fin = ok => { if (done) return; done = true; const v = inp.value; m.close(); resolve(ok ? v : null); };
    m.card.querySelector('#uiMYes').onclick = () => fin(true);
    m.card.querySelector('#uiMNo').onclick = () => fin(false);
    m.wrap.addEventListener('click', e => { if (e.target === m.wrap) fin(false); });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}
// 返回 Promise<void>；只有一个「确定」按钮 —— 与 alert() 的「必须看一眼才能继续」等价，
// 但走页内浅色卡片：系统/浏览器深色模式下原生 alert 是近黑底对话框（用户反馈的「偶发黑色弹窗」）。
// ⛔ 发布链路的失败原因、联检红灯、发布版本号必须走这里，不能走 pageMsg：
//    toast 2.6 秒自动消失，而紧接着的 loadReleaseBoard() 会拿新一轮提示把它覆盖掉 ——
//    版本号这种「看过就要记住」的信息，在 toast 里等于没显示。
function uiAlert(text, okLabel) {
  return new Promise(resolve => {
    let done = false;
    const m = uiModalOpen(
      '<div style="white-space:pre-wrap;word-break:break-word">' + esc(text) + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button class="btn" id="uiMOk">' + esc(okLabel || '知道了') + '</button></div>',
      () => fin());
    const fin = () => { if (done) return; done = true; m.close(); resolve(); };
    m.card.querySelector('#uiMOk').onclick = () => fin();
    // 点遮罩也关：alert 只有一个出口，不该出现「关不掉」的第二种状态
    m.wrap.addEventListener('click', e => { if (e.target === m.wrap) fin(); });
    setTimeout(() => { const b = m.card.querySelector('#uiMOk'); if (b) b.focus(); }, 30);
  });
}
// 推送流水：定时推送（9:25竞价/15:30复盘/21:00新闻/盘中快报）到底发没发出去，一眼可查。
// 以前失败了只在服务器日志里留一行，手机上只能凭"好像没收到"判断 —— 现在直接看结果。
// ⛔⛔ hw 轮（2026-10-15）：面板「推送流水」以前只拿得到最新 30 条，而大单拦截 60 秒一条，
//   30 条窗口不到半小时就被噪音铺满 —— 早上 9:25 的竞价到底发没发，接口永远翻不到，
//   用户只能得到「没看到」而不是「没发过」。现在默认取 200 条，并可一键只看「已送达」。
let _pushLogSentOnly = false;
async function showPushLog() {
  let el = document.getElementById('pushLogBox');
  if (!el) {
    el = document.createElement('div'); el.id = 'pushLogBox';
    el.style.cssText = 'position:fixed;left:50%;top:44px;transform:translateX(-50%);z-index:10000;width:min(680px,94vw);max-height:70vh;overflow:auto;' +
      'padding:14px 16px;border-radius:10px;background:#fff;color:#212529;border:1px solid #dee2e6;box-shadow:0 8px 28px rgba(0,0,0,.22);font-size:12.5px';
    document.body.appendChild(el);
  }
  const _tok2 = (typeof LOCK !== 'undefined' && LOCK.token) || localStorage.getItem('qd_device') || localStorage.getItem('qd_token') || '';
  el.innerHTML = '<b>📋 推送流水</b> <span class="muted">加载中…</span>';
  let r = { ok: false, log: [] };
  const _plq = '/api/push-log?token=' + encodeURIComponent(_tok2) + '&n=200' + (_pushLogSentOnly ? '&only=sent' : '') + '&_=' + Date.now();
  try { r = await fetch(_plq).then(x => x.json()).catch(() => ({ ok: false })); } catch (e) {}
  if (!r.ok) {
    el.innerHTML = '<b>📋 推送流水</b><div style="margin-top:8px;color:#c92a2a">读取失败（需开发者身份；外网请先用开发者密码登录）</div>' +
      '<div style="margin-top:10px;text-align:right"><button class="btn ghost" onclick="document.getElementById(\'pushLogBox\').remove()">关闭</button></div>';
    return;
  }
  const rows = (r.log || []);
  const color = s => /已送达/.test(s) ? '#2f9e44' : (/拦截|未配置/.test(s) ? '#b08900' : '#c92a2a');
  // 节流器状态（与 /api/state 的 pushGov 同一份 pushGovStat）：今天还剩多少名额、拦了几条
  const g = r.gov || {};
  const gm = g.msgs || {};
  const govLine = (r.gov ? '<div style="margin-top:6px;padding:6px 8px;background:#f8f9fa;border-radius:6px">'
    + '<b>今日额度</b> '
    + (g.unlimited ? '<span class="muted">不限</span>' : '<span>剩 ' + (g.left != null ? g.left : '—') + ' / ' + (g.quota || 0) + '</span>')
    // gq 轮：胜率门显示【当前生效值】；偏冷环境生效值高于配置值时一并注明（go 轮 C2 降级）
    //   —— 否则承诺区写「60%」、这里写「52%」，同一屏两个数，用户只会以为系统算错了
    + ' <span class="muted">· 已发 ' + (g.used || 0) + ' 条 / ' + (g.codes != null ? g.codes : '—') + ' 只票 · 胜率门 ' + (g.minProb != null ? g.minProb : '—') + '%'
    + (g.minProb != null && g.minProbCfg != null && g.minProb > g.minProbCfg ? '（偏冷环境·配置 ' + g.minProbCfg + '%）' : '') + '</span>'
    + '<div class="muted" style="margin-top:2px">条数闸门 ' + (gm.total || 0) + '/' + (gm.cap || 0)
    + '（拦下 ' + (gm.blocked || 0) + ' 条）· 单票上限 ' + (g.maxPerCode != null ? g.maxPerCode : '—') + ' 条/日 · 冷却 ' + (g.cooldownMin != null ? g.cooldownMin : '—') + ' 分钟'
    + ' · 低概率拦下 ' + (g.lowProb || 0) + ' 条 · 重复/冷却拦下 ' + (g.throttled != null ? g.throttled : (g.dropped || 0)) + ' 条</div>'
    + '</div>' : '');
  // 合并计数：同一句拦截在当天被合并成一条，n 是它实际发生了多少次（hw 轮推流水降噪）
  const _nTimes = x => (x && Number(x.n) > 1 ? ' <span class="muted" style="background:#f1f3f5;border-radius:8px;padding:0 6px">×' + x.n + '（最近 ' + (x.last || x.time || '') + '）</span>' : '');
  el.innerHTML = '<b>📋 推送流水</b> <span class="muted">共 ' + (r.count || 0) + ' 条 · 今日<b style="color:#2f9e44">已送达 ' + (r.sentToday || 0) + '</b> 条 · '
    + (r.replica ? '本实例为副本（定时不外发，仅线上实例推送）' : '本实例为推送源') + '</span>'
    + '<button class="btn ghost" style="float:right;padding:1px 8px;font-size:11.5px" onclick="_pushLogSentOnly=!_pushLogSentOnly;showPushLog()">'
    + (_pushLogSentOnly ? '看全部' : '只看已送达') + '</button>'
    + govLine
    + '<div style="margin-top:8px">'
    + (rows.length ? rows.map(x => '<div style="padding:6px 0;border-top:1px solid #f1f3f5">'
      + '<span style="color:' + color(x.status) + ';font-weight:700">' + (x.status || '') + '</span> '
      + '<span class="muted">' + (x.time || '') + '</span>' + _nTimes(x)
      + (x.channel ? ' <span class="muted">· ' + x.channel + '</span>' : '')
      + '<div style="margin-top:2px">' + (x.title || '') + '</div>'
      + ((x.error || x.note) ? '<div class="muted" style="margin-top:2px">' + (x.error || x.note) + '</div>' : '')
      + '</div>').join('') : '<div class="muted">' + (_pushLogSentOnly ? '今天还没有已送达的记录（可点右上角「看全部」看被拦下的）' : '暂无记录') + '</div>')
    + '</div><div style="margin-top:12px;text-align:right"><button class="btn ghost" onclick="document.getElementById(\'pushLogBox\').remove()">关闭</button></div>';
}
async function paperAction(acc, action) {
  if (action === 'reset') {
    const btn = document.getElementById('btnReset' + acc.toUpperCase());
    if (!btn || btn.dataset.confirm !== '1') { // 首次点击改为按钮二次确认，不用 confirm 弹窗
      if (btn) { btn.dataset.confirm = '1'; const old = btn.textContent; btn.textContent = '再点一次确认清空'; setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = old; }, 4000); }
      pageMsg('确认清空请再点一次「清空」按钮', 'warn');
      return;
    }
    btn.dataset.confirm = '';
  }
  // ⚠️ 必须带 token：/api/paper 走 requireEditor，不带 token 时只有本机 127.0.0.1 能过，
  //    从线上域名（手机/外网）点「重置」会被权限校验挡掉 → 表现就是"点了没反应/重置不了"。
  const _tok = (typeof LOCK !== 'undefined' && LOCK.token) || localStorage.getItem('qd_device') || localStorage.getItem('qd_token') || '';
  let r = {};
  try {
    const resp = await fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: acc, action, token: _tok }) });
    r = await resp.json();
  } catch (e) { r = { ok: false, error: '网络请求失败' }; }
  pageMsg(r.ok ? (action === 'reset' ? '已清空该模拟盘' : '操作成功') : ('操作失败：' + (r.error || '无权限或网络异常')), r.ok ? 'ok' : 'err');
  refresh();
}
// 自定义模拟盘本金（改完后「重置」也会回到这个本金）
async function paperSetInitial(acc) {
  const name = acc === 'pre' ? 'B·预选盘(50万)' : 'A·跟单盘(10万)';
  // ⛔ gj 轮：prompt() 同样在深色模式下是黑底对话框，且没法校验输入；换成页内输入框
  const v = await uiPrompt(`设置模拟盘${name}的本金（元，至少 1 万）：`, String(acc === 'pre' ? 500000 : 100000));
  if (!v) return;
  const amt = Number(String(v).replace(/[^\d]/g, ''));
  if (!Number.isFinite(amt) || amt < 10000) { pageMsg('本金至少 1 万元', 'err'); return; }
  const _tok = (typeof LOCK !== 'undefined' && LOCK.token) || localStorage.getItem('qd_device') || localStorage.getItem('qd_token') || '';
  let r = {};
  try {
    const resp = await fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: acc, action: 'setInitial', amount: amt, token: _tok }) });
    r = await resp.json();
  } catch (e) { r = { ok: false, error: '网络请求失败' }; }
  pageMsg(r.ok ? (r.msg || '本金已更新') : ('设置失败：' + (r.error || '无权限或网络异常')), r.ok ? 'ok' : 'err');
  refresh();
}

// ═══════════ 我的持仓：录入 / 盯盘 / 加减仓 ═══════════
let _holdData = null, _holdTs = 0, _hEdit = null;
let HOLD_FILTER = '';                       // 当前标签筛选（'' = 全部）
const HOLD_PRESET = ['长线', '波段', '打板', '自选', '核心', '观察'];
// 持仓「不见了」必须给出原因，不能一声不吭地消失。
// 2026-09-29 教训：用户在手机上看到持仓整栏消失，跑来问是不是数据被删了 ——
// 查下来服务端两条持仓完好无损，纯粹是当次会话是只读身份，前端holdLoad直接return了，
// 界面上没有任何解释。以后任何隐藏都要留一句人话。
function holdHidden(reason, detail) {
  const s1 = document.getElementById('holdSec1'), s2 = document.getElementById('holdSec2');
  // 用户在「面板显示设置」里主动勾掉的不算异常，尊重用户选择、保持隐藏
  const byUser = (typeof _panelHidden !== 'undefined' && _panelHidden.has('holdSec2')) ||
                 (typeof _panelCollapsed !== 'undefined' && _panelCollapsed.has('holdSec2'));
  if (byUser) { if (s1) s1.style.display = 'none'; if (s2) s2.style.display = 'none'; return; }
  if (s1) s1.style.display = '';
  if (s2) s2.style.display = '';
  const box = document.getElementById('holdSummary');
  if (!box) return;
  const tip = document.getElementById('holdTagBar');
  if (tip) tip.innerHTML = '';
  box.innerHTML = `<div class="act act-info" style="margin:2px 0">
    <b>【持仓未显示】</b>${reason}
    <div class="why">${detail || ''}</div>
    <div style="margin-top:6px"><button class="btn" onclick="showGate()">🔓 输入开发者密码</button></div>
  </div>`;
}
async function holdLoad(force) {
  // 只读身份看不到持仓（隐私保护），但必须告诉他为什么看不到
  if (CUR_ROLE !== 'edit') return holdHidden('当前是<b>只读（观看）</b>身份，出于隐私考虑，持仓不对观看身份显示。',
    '用<b>开发者密码</b>登录即可查看与编辑持仓；观看密码只能看行情。若你确认输入的就是开发者密码，请退出后重新登录一次。');
  if (!force && Date.now() - _holdTs < 15000) return;
  _holdTs = Date.now();
  const r = await fetch('/api/holdings').then(x => x.json()).catch(() => ({}));
  const s1 = document.getElementById('holdSec1'), s2 = document.getElementById('holdSec2');
  if (!r.ok) {
    return holdHidden((r && r.error) || '持仓接口返回失败',
      r && r.hidden ? '这是服务端的隐私限制，不是数据丢失 —— 你的持仓仍在服务器上，换开发者身份登录后原样显示。'
        : '可能是登录状态过期或网络异常，点下面的按钮重新认证即可。');
  }
  // 尊重面板显示设置：被折叠 / 被取消勾选时，持仓刷新都不要强行把它展开
  const _secHidden = (typeof _panelHidden !== 'undefined' && _panelHidden.has('holdSec2'));
  const _secFolded = (typeof _panelCollapsed !== 'undefined' && _panelCollapsed.has('holdSec2'));
  if (s2) s2.style.display = _secHidden ? 'none' : '';
  if (s1) s1.style.display = (_secHidden || _secFolded) ? 'none' : '';
  _holdData = r;
  holdRender(r);
}
const _pnlCls = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const _sg = v => (v > 0 ? '+' : '') + v;
function holdCard(x) {
  const lvName = { danger: '🚨 需处理', warn: '⚠️ 预警', ok: '✅ 正常', info: 'ℹ️ 关注' };
  const acts = (x.acts || []).map(a =>
    `<div class="act act-${a.color || 'info'}"><b>【${a.type}】</b>${a.text}<div class="why">${a.why}</div></div>`
  ).join('') || '<div class="act act-info">未触发任何条件：既没到止损/减仓线，也没到止盈线，继续持有观察。<div class="why">说明：所有门槛都是「超过」才触发，等于不算。</div></div>';
  const tagHtml = (x.tags || []).map(t =>
    `<span class="tag" style="cursor:pointer" title="点一下只看这一类；再次点击取消" onclick="holdPickTag('${t}')">🏷${t}</span>`
  ).join(' ');
  return `<div class="hcard lv-${x.level}" id="hc-${x.code}"${x.locked ? ' style="border-left:4px solid #7048e8"' : ''}>
    <div class="rvc-h">
      ${_holdPickMode ? `<input type="checkbox" ${_holdPicked.has(x.code) ? 'checked' : ''} onchange="holdPickOne('${x.code}',this.checked)" title="勾选后可一键删除" style="width:17px;height:17px;cursor:pointer;flex:0 0 auto">` : ''}
      <b class="${_pnlCls(x.floatPct)}" title="相对【成本价】的浮动盈亏比例（不是当日涨幅）">${x.floatPct == null ? '—' : '浮盈' + (x.floatPct > 0 ? '+' : '') + x.floatPct + '%'}</b>
      <span>${x.name || x.code}</span><span class="muted">${x.code}</span>
      <span class="tag">${lvName[x.level] || x.level}</span>
      ${x.locked ? '<span class="tag" style="background:#f3f0ff;color:#7048e8">🔒 锁仓</span>' : ''}
      ${x.muted ? '<span class="tag" style="background:#e9ecef;color:#495057" title="已暂停手机推送，面板照常显示">🔇 暂停推送</span>' : ''}
      ${x.proxy ? '<span class="tag" title="主力资金字段取备用口径（主动买占比），因主数据源当时未返回资金数据">备用口径</span>' : ''}
      ${x.badNews ? '<span class="tag" style="background:#ffe3e3;color:#c92a2a">⚠️利空</span>' : ''}
      ${x.isLimitUp ? '<span class="tag" style="background:#ffe3e3;color:#c92a2a">涨停</span>' : ''}
      <span class="hgap"></span>
      <!-- ⚠️ 按钮尺寸一律用 .hbtn 类控制：以前写在行内 style 里，行内样式优先级高于
           媒体查询，导致手机上"放大按钮"的适配完全失效——手指根本点不准。 -->
      <div class="hbtns">
        <button class="btn ghost hbtn" ${x.muted ? 'style="color:#c92a2a"' : ''} title="${x.muted ? '恢复后手机会重新收到这只票的提醒' : '暂停后手机不再收到这只票的提醒，面板照常显示估值与建议'}" onclick="holdToggleMute('${x.code}',${!x.muted})">${x.muted ? '🔔 恢复' : '🔇 暂停'}</button>
        <button class="btn ghost hbtn" onclick="holdToggleLock('${x.code}',${!x.locked})" title="${x.locked ? '解锁后恢复自动卖出建议' : '锁仓后不再自动推卖出建议'}">${x.locked ? '🔓 解锁' : '🔒 锁定'}</button>
        <button class="btn ghost hbtn" onclick="holdEdit('${x.code}')" title="改成本/股数/备注">✏️ 改</button>
        <button class="btn hbtn hdel" onclick="holdDel('${x.code}',this)" title="删除这条持仓">🗑 删</button>
      </div>
    </div>
    ${tagHtml ? `<div style="margin:3px 0">${tagHtml}<span class="tag" style="cursor:pointer" onclick="holdEditTags('${x.code}')">＋标签</span></div>` : `<div style="margin:3px 0"><span class="tag" style="cursor:pointer" onclick="holdEditTags('${x.code}')">＋加标签</span></div>`}
    <div class="rvc-g">
      <span>现价 <b>${x.price}</b> <b class="${_pnlCls(x.pct)}">当日${_sg(x.pct)}%</b></span>
      <span>成本 ${x.cost}</span><span>股数 ${x.shares}</span>
      <span>市值 ${Math.round(x.market).toLocaleString()}</span>
      <span class="${_pnlCls(x.profitAmt)}">浮盈亏 ${_sg(x.profitAmt)}元</span>
      <span class="${_pnlCls(x.dayPnl)}">当日 ${_sg(x.dayPnl)}元</span>
      <span class="muted">占总仓 ${x.weight}%</span>
      ${x.drawdown != null && x.hiRef ? `<span class="${x.drawdown >= 5 ? 'down' : x.drawdown >= 3 ? 'down' : 'muted'}" title="现价较近10日高点 ${x.hiRef} 的回落幅度；≥3% 提醒一次止盈，≥5% 每30分钟提醒一次">回撤 ${x.drawdown}%</span>` : ''}
      <span class="muted">5日线 ${x.ma5 == null ? '-' : x.ma5}${x.aboveMa5 === true ? '（站上）' : x.aboveMa5 === false ? '（跌破）' : ''}</span>
      <span class="${x.mainIn > 0 ? 'up' : x.mainIn < 0 ? 'down' : 'muted'}">主力 ${x.mainIn > 0 ? '+' : ''}${Math.round(x.mainIn / 1e4)}万${x.mainPct ? ' / ' + x.mainPct + '%' : ''}</span>
      ${x.note ? `<span class="muted">${x.note}</span>` : ''}
    </div>
    <div style="margin-top:5px">${x.muted ? '<div class="act act-info" style="opacity:.75">🔇 该股已暂停手机推送：以下建议只在面板显示，不会发到手机。<div class="why">恢复方法：点本卡右上角的「🔔 恢复推送」，或取消表单里的「🔇 暂停推送」勾选。</div></div>' : ''}${acts}</div>
  </div>`;
}
// 批量删除模式：勾掉旧数据，不用一条一条点
let _holdPickMode = false, _holdPicked = new Set();
function holdPickOne(code, on) { if (on) _holdPicked.add(code); else _holdPicked.delete(code); holdSyncPickBar(); }
function holdPickAll(on) {
  const items = (_holdData && _holdData.items) || [];
  if (on) items.forEach(x => _holdPicked.add(x.code)); else _holdPicked.clear();
  if (_holdData) holdRender(_holdData);
}
function holdTogglePickMode() {
  _holdPickMode = !_holdPickMode;
  if (!_holdPickMode) _holdPicked.clear();
  if (_holdData) holdRender(_holdData);
}
// 只更新计数与按钮文案，避免全量重绘导致勾选框失焦
function holdSyncPickBar() {
  const el = document.getElementById('hPickCount'); if (el) el.textContent = _holdPicked.size;
  const b = document.getElementById('hPickDelBtn'); if (b) b.disabled = !_holdPicked.size;
}
async function holdDelSelected() {
  const n = _holdPicked.size;
  if (!n) return pageMsg('还没勾选任何持仓', 'warn');
  if (!(await uiConfirm(`确定删除选中的 ${n} 条持仓吗？删除后可在别处重新录入。`, '确定删除'))) return;
  const codes = [..._holdPicked];
  // 乐观清屏：先把这些卡片从画面移除，网络往返放后台，点下去就有反应
  _holdPicked.clear(); _holdPickMode = false;
  if (_holdData && _holdData.items) _holdData.items = _holdData.items.filter(x => !codes.includes(x.code));
  holdRender(_holdData || { items: [] });
  const r = await post('/api/holdings', { action: 'removeMany', codes });
  if (!r.ok) { pageMsg('❌ ' + (r.error || '删除失败'), 'err'); holdLoad(true); return; }
  pageMsg('🧹 ' + (r.msg || `已删除 ${n} 条`), 'ok');
  holdLoad(true);
}
async function holdClearAll() {
  const n = ((_holdData && _holdData.items) || []).length;
  if (!n) return pageMsg('当前没有持仓可清', 'warn');
  if (!(await uiConfirm(`确定清空全部 ${n} 条持仓？\n（总资金与止损/减仓/止盈参数会保留）\n建议先记一下成本价，清掉就找不回了。`, '确定清空'))) return;
  _holdPicked.clear(); _holdPickMode = false;
  if (_holdData) _holdData.items = [];
  holdRender(_holdData || { items: [] });
  const r = await post('/api/holdings', { action: 'clear' });
  if (!r.ok) { pageMsg('❌ ' + (r.error || '清空失败'), 'err'); holdLoad(true); return; }
  pageMsg('🗑 ' + (r.msg || '已清空'), 'ok');
  HOLD_FILTER = '';
  holdLoad(true);
}
// 折叠分组状态：记录哪些标签分组被收起（localStorage 持久化，刷新页面也记得）
let _grpList = [];
let _grpCollapsed = (() => { try { return new Set(JSON.parse(localStorage.getItem('qd_grp') || '[]')); } catch { return new Set(); } })();
function _saveGrp() { try { localStorage.setItem('qd_grp', JSON.stringify([..._grpCollapsed])); } catch {} }
function holdRender(r) {
  // 重绘会整块换 innerHTML，手机上正在看的位置会被弹回顶部 —— 先记住滚动位置再还原
  const _box = document.getElementById('holdList');
  const _scr = _box && _box.parentElement && _box.parentElement.classList.contains('scrolly')
    ? { el: _box.parentElement, top: _box.parentElement.scrollTop } : null;
  const items = r.items || [], sum = r.summary || {}, cfg = r.cfg || {};
  const info = document.getElementById('holdInfo');
  // 说明推送口径：止盈只在"回撤"时提醒，不再因为浮盈在线被反复催
  if (info) info.textContent = `更新于 ${r.time || ''} · 共 ${items.length} 只 · 每30秒盯盘；到止盈线提醒一次，回撤≥3% 提醒一次，回撤≥5% 每30分钟提醒，止损/减仓/清仓/风险 每30分钟推一次`;
  // 风控参数只在空框时回填，避免覆盖用户正在输入的值
  const fill = (id, v) => { const el = document.getElementById(id); if (el && el.value === '' && v != null && v !== '') el.value = v; };
  fill('hCapital', sum.capital || '');
  fill('hStop', Math.abs(cfg.stopPct));
  fill('hReduce', Math.abs(cfg.reducePct));
  fill('hTake', cfg.takePct);
  fill('hMax', cfg.maxPosPct);
  const se = document.getElementById('holdSummary');
  if (se) se.innerHTML =
    `<span class="tag">持仓市值 <b>${Math.round(sum.market || 0).toLocaleString()}</b></span>` +
    `<span class="tag">总成本 ${Math.round(sum.cost || 0).toLocaleString()}</span>` +
    `<span class="tag">浮动盈亏 <b class="${_pnlCls(sum.profit)}">${_sg(sum.profit || 0)}元（${_sg(sum.floatPct || 0)}%）</b></span>` +
    `<span class="tag">当日盈亏 <b class="${_pnlCls(sum.dayPnl)}">${_sg(sum.dayPnl || 0)}元</b></span>` +
    `<span class="tag">总资金 ${Math.round(sum.capital || 0).toLocaleString()}</span>` +
    `<span class="tag">仓位 <b>${sum.positionPct == null ? '未设总资金' : sum.positionPct + '%'}</b></span>` +
    `<span class="tag">状态 <b>${r.level === 'danger' ? '🚨 有持仓需处理' : r.level === 'warn' ? '⚠️ 有预警' : r.level === 'empty' ? '空仓' : '✅ 正常'}</b></span>`;
  const box = document.getElementById('holdList');
  if (!box) return;
  holdTagBar(r.allTags || [], r.items || []);
  // 常用标签快捷入口：点了就追加到标签输入框
  const ps = document.getElementById('hPreset');
  if (ps) ps.innerHTML = HOLD_PRESET.map(t => `<span class="tag" style="cursor:pointer" onclick="holdAddTag('${t}')">${t}</span>`).join(' ');
  // ── 按标签分组成「可折叠区块」：点分组标题即可展开/收起，方便逐类查看 ──
  const allTags = r.allTags || [];
  const locked = items.filter(x => x.locked);
  const untagged = items.filter(x => !(x.tags || []).length);
  const groups = [{ key: '', name: '📋 全部', items, def: true }];
  for (const t of allTags) groups.push({ key: t, name: '🏷 ' + t, items: items.filter(x => (x.tags || []).includes(t)) });
  // 没打标签的单独归一组：否则持仓看起来只会挤在「全部」里，看不到标签分组
  if (untagged.length) groups.push({ key: '📥未分组', name: '📥 未打标签', items: untagged });
  if (locked.length) groups.push({ key: '🔒锁仓', name: '🔒 锁仓', items: locked });
  const muted = items.filter(x => x.muted);
  if (muted.length) groups.push({ key: '🔇静音', name: '🔇 暂停推送', items: muted });
  _grpList = groups;
  // 筛选态：只显示被选中的那一分组（已展开，不参与折叠）
  const view = HOLD_FILTER ? groups.filter(g => g.key === HOLD_FILTER) : groups;
  const ctrl = `<div style="margin:2px 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn ghost" style="padding:2px 10px;font-size:12px" onclick="holdToggleAllGroups()">${_grpCollapsed.size ? '🔽 全部展开' : '🔼 全部收起'}</button>
      <span class="muted" style="font-size:12px">点分组标题（🏷标签/📥未打标签）可单独折叠，状态会被记住</span>
      <span style="flex:1"></span>
      <button class="btn ghost" style="padding:2px 10px;font-size:12px" onclick="holdTogglePickMode()">${_holdPickMode ? '✅ 退出勾选' : '🧹 清理旧数据'}</button>
      ${_holdPickMode ? `<button class="btn ghost" style="padding:2px 10px;font-size:12px" onclick="holdPickAll(true)">全选</button>
        <button class="btn ghost" style="padding:2px 10px;font-size:12px" onclick="holdPickAll(false)">全不选</button>
        <button class="btn" id="hPickDelBtn" style="padding:2px 12px;font-size:12px" ${_holdPicked.size ? '' : 'disabled'} onclick="holdDelSelected()">🗑 删除选中(<span id="hPickCount">${_holdPicked.size}</span>)</button>` : ''}
      <button class="btn ghost" style="padding:2px 10px;font-size:12px;color:#c92a2a" onclick="holdClearAll()" title="一键清空全部持仓（保留总资金与风控参数）">🗑 清空全部</button>
    </div>`;
  const html = view.map((g, i) => {
    const collapsed = !HOLD_FILTER && _grpCollapsed.has(g.key);
    const chev = collapsed ? '▸' : '▾';
    return `<div class="hgrp">
      <div class="hgrp-h" onclick="holdToggleGrp(${i})">
        <span class="chev">${chev}</span><b>${g.name}</b><span class="cnt">${g.items.length}</span>
        <span class="muted" style="font-size:12px;margin-left:4px">点此折叠/展开</span>
      </div>
      <div class="hgrp-b" id="hgrp-${i}" style="display:${collapsed ? 'none' : ''}">
        ${g.items.length ? g.items.map(holdCard).join('') : '<div class="muted" style="padding:8px">该分组暂无持仓</div>'}
      </div>
    </div>`;
  }).join('');
  box.innerHTML = ctrl + (html || '<div class="muted">还没有持仓，用上方表单加入第一只吧</div>');
  if (_scr) { try { _scr.el.scrollTop = _scr.top; } catch {} }
}
// 标签筛选条：一张票可以挂好几个标签，这里按标签快速归类查看
function holdTagBar(allTags, items) {
  const bar = document.getElementById('holdTagBar');
  if (!bar) return;
  const lockedN = items.filter(x => x.locked).length;
  const mutedN = items.filter(x => x.muted).length;
  const chips = [];
  chips.push(`<span class="tag ${HOLD_FILTER ? '' : 'on'}" style="cursor:pointer;${HOLD_FILTER ? '' : 'background:#4263eb;color:#fff'}" onclick="holdPickTag('')">全部 ${items.length}</span>`);
  for (const t of allTags) {
    const n = items.filter(x => (x.tags || []).includes(t)).length;
    chips.push(`<span class="tag" style="cursor:pointer;${HOLD_FILTER === t ? 'background:#4263eb;color:#fff' : ''}" onclick="holdPickTag('${t}')">🏷${t} ${n}</span>`);
  }
  if (lockedN) chips.push(`<span class="tag" style="cursor:pointer;${HOLD_FILTER === '🔒锁仓' ? 'background:#7048e8;color:#fff' : 'background:#f3f0ff;color:#7048e8'}" onclick="holdPickTag('🔒锁仓')">🔒 锁仓 ${lockedN}</span>`);
  if (mutedN) chips.push(`<span class="tag" style="cursor:pointer;${HOLD_FILTER === '🔇静音' ? 'background:#495057;color:#fff' : 'background:#e9ecef;color:#495057'}" onclick="holdPickTag('🔇静音')">🔇 暂停推送 ${mutedN}</span>`);
  bar.innerHTML = chips.join(' ');
}
function holdPickTag(t) {
  HOLD_FILTER = (HOLD_FILTER === t) ? '' : t;
  if (_holdData) holdRender(_holdData);
}
// 点分组标题：折叠/展开该分组（筛选态下点任意分组=退出筛选，回到全部分组视图）
function holdToggleGrp(i) {
  const g = _grpList[i]; if (!g) return;
  if (HOLD_FILTER) { HOLD_FILTER = ''; if (_holdData) holdRender(_holdData); return; }
  if (_grpCollapsed.has(g.key)) _grpCollapsed.delete(g.key); else _grpCollapsed.add(g.key);
  _saveGrp();
  if (_holdData) holdRender(_holdData);
}
// 一键全部展开/收起所有标签分组（「全部」与「🔒锁仓」始终展开作为总览）
function holdToggleAllGroups() {
  // 连同「📋 全部」一起收起：以前「全部」永远展开，一键收起看着像没生效
  const keys = (_grpList || []).map(g => g.key);
  if (_grpCollapsed.size) _grpCollapsed.clear(); else keys.forEach(k => _grpCollapsed.add(k));
  _saveGrp();
  if (_holdData) holdRender(_holdData);
}
function holdAddTag(t) {
  const el = document.getElementById('hTags');
  if (!el) return;
  const cur = (el.value || '').split(/[,，、\s]+/).filter(Boolean);
  if (!cur.includes(t)) cur.push(t);
  el.value = cur.join(',');
}
// 卡片上改标签：不用 prompt（手机端内置浏览器常拦截），改为把该票填进上方表单让你改完点「保存修改」
function holdEditTags(code) {
  holdEdit(code);
  const el = document.getElementById('hTags');
  if (el) { el.focus(); try { el.select(); } catch {} }
  const nm = ((_holdData && _holdData.items) || []).find(x => x.code === code);
  pageMsg(`已把 ${(nm && nm.name) || code} 填进上方表单：在「标签」里改（多个用逗号分隔），改完点「保存修改」`, 'warn');
}
// 🔇 暂停推送 / 🔔 恢复推送：只影响手机提醒，面板估值与建议照常
async function holdToggleMute(code, on) {
  const r = await post('/api/holdings', { action: 'mute', code, muted: on });
  pageMsg(r.ok ? r.msg : ('❌ ' + (r.error || '失败')), r.ok ? 'ok' : 'err');
  if (r.ok) holdLoad(true);
}
// 锁定/解锁：锁仓期间不再自动推卖出建议，但盈亏与风险照常跟踪
async function holdToggleLock(code, on) {
  const r = await post('/api/holdings', { action: 'setlocked', code, locked: on });
  pageMsg(r.ok ? ('🔒 ' + r.msg) : ('❌ ' + (r.error || '失败')), r.ok ? 'ok' : 'err');
  if (r.ok) holdLoad(true);
}
// 一键锁仓：只给「代码 + 仓位」就能锁定标签
async function holdQuickLock() {
  const code = (document.getElementById('hLockCode').value || '').trim();
  const shares = document.getElementById('hLockShares').value;
  if (!/^\d{6}$/.test(code)) return pageMsg('请输入6位股票代码', 'err');
  if (!(parseFloat(shares) > 0)) return pageMsg('请输入仓位（股数）', 'err');
  const tags = (document.getElementById('hTags').value || '').split(/[,，、\s]+/).filter(Boolean);
  pageMsg('正在锁定…');
  const r = await post('/api/holdings', { action: 'lock', item: { code, shares, tags } });
  if (!r.ok) return pageMsg('❌ ' + (r.error || '锁仓失败'), 'err');
  document.getElementById('hLockCode').value = ''; document.getElementById('hLockShares').value = '';
  pageMsg('✅ ' + r.msg, 'ok');
  HOLD_FILTER = '';            // 锁仓后清掉筛选，确保新锁的持仓立即可见
  holdLoad(true);
}
function holdEdit(code) {
  const it = ((_holdData && _holdData.items) || []).find(x => x.code === code);
  if (!it) return pageMsg('未找到该持仓', 'err');
  document.getElementById('hCode').value = it.code;
  document.getElementById('hName').value = it.name || '';
  document.getElementById('hCost').value = it.cost;
  document.getElementById('hShares').value = it.shares;
  document.getElementById('hNote').value = it.note || '';
  document.getElementById('hTags').value = (it.tags || []).join(',');
  const lk = document.getElementById('hLocked'); if (lk) lk.checked = !!it.locked;
  const mu = document.getElementById('hMuted'); if (mu) mu.checked = !!it.muted;
  _hEdit = code;
  const b = document.getElementById('hAddBtn'); if (b) { b.textContent = '💾 保存修改'; b.className = 'btn'; }
  const c = document.getElementById('hCancelBtn'); if (c) c.style.display = '';
  const i = document.getElementById('hCode'); if (i) i.focus();
  pageMsg(`正在修改 ${it.name || it.code}，改完点「保存修改」`, 'warn');
}
function holdCancelEdit() {
  _hEdit = null;
  ['hCode', 'hName', 'hCost', 'hShares', 'hNote', 'hTags'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  const lk = document.getElementById('hLocked'); if (lk) lk.checked = false;
  const mu = document.getElementById('hMuted'); if (mu) mu.checked = false;
  try { draftSnap(); } catch (e) { }   // 同上：取消编辑也算"不再需要"，同步清快照
  const b = document.getElementById('hAddBtn'); if (b) { b.textContent = '➕ 加入盯盘'; }
  const c = document.getElementById('hCancelBtn'); if (c) c.style.display = 'none';
  pageMsg('已取消修改', 'ok');
}
async function holdSubmit() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const item = { code: val('hCode').trim(), name: val('hName').trim(), cost: val('hCost'), shares: val('hShares'), note: val('hNote').trim() };
  if (!item.code) return pageMsg('请填写股票代码', 'err');
  item.tags = val('hTags').split(/[,，、\s]+/).filter(Boolean);
  item.locked = !!(document.getElementById('hLocked') || {}).checked;
  item.mute = !!(document.getElementById('hMuted') || {}).checked;
  const wasEdit = !!_hEdit;    // 先记下本次是「新增」还是「修改」（下面 holdCancelEdit 会把 _hEdit 清掉）
  let r;
  if (_hEdit) {
    r = await post('/api/holdings', { action: 'update', code: _hEdit, data: { name: item.name, cost: item.cost, shares: item.shares, note: item.note, tags: item.tags, locked: item.locked, mute: item.mute } });
    if (r.ok) holdCancelEdit();
  } else {
    r = await post('/api/holdings', { action: 'add', item });
  }
  if (!r.ok) return pageMsg('❌ ' + (r.error || '操作失败'), 'err');
  const cap = val('hCapital');
  if (cap) await post('/api/holdings', { action: 'capital', capital: cap });
  pageMsg('✅ ' + (r.msg || '已保存'), 'ok');
  HOLD_FILTER = '';            // 提交后清掉标签筛选，确保新加的持仓一定显示出来（之前因筛选未清导致"加了却看不见"）
  if (!wasEdit) {
    // 新增成功后清空录入框（标签保留，方便连续录同一类）。
    // 不清空的话很容易误触"再加一次"，同代码会被当成加仓：股数翻倍、成本被加权平均 → 浮动盈利看着就是错的
    ['hCode', 'hName', 'hCost', 'hShares', 'hNote'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    const lk = document.getElementById('hLocked'); if (lk) lk.checked = false;
    const mu = document.getElementById('hMuted'); if (mu) mu.checked = false;
    // ⚠️ 必须同步刷新草稿快照：这里是 JS 直接改 value，不会触发 input 事件，
    //    不清快照的话下次进页面会把【已经提交成功的内容】又填回框里，看着像没保存。
    try { draftSnap(); } catch (e) { }
  }
  holdLoad(true);
}
async function holdSaveCfg() {
  const gv = id => parseFloat((document.getElementById(id) || {}).value);
  const cap = gv('hCapital');
  if (isFinite(cap)) { const rc = await post('/api/holdings', { action: 'capital', capital: cap }); if (!rc.ok) return pageMsg('❌ ' + (rc.error || '总资金保存失败'), 'err'); }
  const cfg = { stopPct: gv('hStop'), reducePct: gv('hReduce'), takePct: gv('hTake'), maxPosPct: gv('hMax') };
  const r = await post('/api/holdings', { action: 'cfg', cfg });
  pageMsg(r.ok ? '✅ 风控参数已保存（止损/减仓预警/止盈/仓位上限）' : ('❌ ' + (r.error || '保存失败')), r.ok ? 'ok' : 'err');
  holdLoad(true);
}
async function holdDel(code, btn) {
  if (btn && btn.dataset.confirm !== '1') { // 二次点击确认，不用浏览器弹窗
    btn.dataset.confirm = '1'; btn.textContent = '再点确认';
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = '删'; }, 4000);
    pageMsg('再点一次确认删除该持仓', 'warn'); return;
  }
  // 乐观删除：先把卡片从画面移除并立刻刷新汇总，网络往返放到后台 —— 点下去就有反应，不等行情重算
  const card = document.getElementById('hc-' + code);
  if (card) card.remove();
  if (_holdData && Array.isArray(_holdData.items)) {
    const gone = _holdData.items.filter(x => x.code !== code);
    _holdData.items = gone;
    try { holdRender(_holdData); } catch {}
  }
  pageMsg('已移除，正在同步…', 'ok');
  const r = await post('/api/holdings', { action: 'remove', code });
  if (!r.ok) { pageMsg('❌ ' + (r.error || '删除失败'), 'err'); holdLoad(true); return; }
  setTimeout(() => holdLoad(true), 300);   // 后台重算完成后再对齐一次真实数据
}
async function holdCheck() {
  const r = await post('/api/holdings', { action: 'check' });
  pageMsg(r.ok ? `✅ 巡检完成：${r.fired} 项触发，已推送到手机` : ('❌ ' + (r.error || '巡检失败')), r.ok ? 'ok' : 'err');
  holdLoad(true);
}
// 持仓轮询同样避开后台空转；前台 20 秒一次，回到前台由 resumeNow() 立即补一次
setInterval(() => { if (!document.hidden) holdLoad(true); }, 20000);

async function saveCfg() {
  const body = {};
  // 2026-10-03：粘贴了新地址就要求服务端【先验通再换】——推不通的话原样保留旧通道，
  // 不会出现"保存成功但从此一条都推不出去"。留空则表示不动这一项。
  const wv = document.getElementById('webhook').value.trim().replace(/^\(已保存\)\s*/, '');
  if (wv && !wv.includes('(已保存)')) { body.feishuWebhook = wv; body.verify = true; }
  const fs = document.getElementById('feishuSecret') ? document.getElementById('feishuSecret').value.trim() : '';
  if (typeof body.feishuWebhook === 'string' || fs) body.feishuSecret = fs === '(已保存)' ? '' : fs;
  const mu = document.getElementById('mailUser').value.trim();
  const ma = document.getElementById('mailAuth').value.trim();
  const mt = document.getElementById('mailTo').value.trim();
  if (mu && mu !== '(已保存)') {
    body.qqMail = { user: mu, authCode: ma && ma !== '(已保存)' ? ma : undefined, to: mt || mu };
  }
  if (!Object.keys(body).length) return pageMsg('请先填写配置', 'err');
  if (!await requireUnlock('修改推送配置需要验证密码')) return pageMsg('已取消：未通过密码验证', 'err');
  body.token = LOCK.token;
  const r = await (await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  // 2026-10-03：保存失败必须把服务端原因完整念出来（含"当前仍是哪一个机器人在服役"），
  // 否则就像以前那样：地址填错→服务端静默不生效→这里却提示"已保存"，用户被蒙在鼓里。
  if (!r.ok) return pageMsg('保存失败：' + (r.error || '服务端未说明原因'), 'err');
  const part = (r.config && r.config.feishuMask) ? ('，当前机器人 ' + r.config.feishuMask) : '';
  pageMsg((r.fsNote ? r.fsNote : '已保存，信号将推送到飞书/QQ邮箱') + part, 'ok');
  try { const wh = document.getElementById('webhook'); if (wh && !/^\(已保存\)/.test(wh.value)) wh.value = ''; } catch (e) {}
  refresh();
}
// ── 私密通道（2026-10-05）：验证码 + 持仓改发只有本人的机器人 ──
// 群里人一多，验证码等于被公开（谁都能拿去改密码），持仓也只能把金额全抹掉。
// 这里单独配一个机器人，两类消息只发它；没配就原样走主通道（持仓继续不显示金额）。
async function saveSecCfg() {
  const el = document.getElementById('secWebhook');
  const sv = el ? el.value.trim().replace(/^\(已保存\)\s*/, '') : '';
  const ss = document.getElementById('feishuSecSecret') ? document.getElementById('feishuSecSecret').value.trim() : '';
  if (!sv) return pageMsg('请先粘贴私密机器人地址（只想改密钥就填地址+新密钥一起保存）', 'err');
  if (!await requireUnlock('修改私密通道需要验证密码')) return pageMsg('已取消：未通过密码验证', 'err');
  const r = await (await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: LOCK.token, feishuSecWebhook: sv, feishuSecSecret: ss && ss !== '(已保存)' ? ss : '', secVerify: true }) })).json();
  if (!r.ok) return pageMsg('保存失败：' + (r.error || '服务端未说明原因') + '（现有配置未被改动）', 'err');
  pageMsg((r.fsNote || '私密通道已保存') + ' · 当前 ' + ((r.config && r.config.feishuSecMask) || '?') +
    '：今后找回密码验证码、持仓风控只发这里，持仓会带上成本/金额/股数', 'ok');
  try { if (el) el.value = ''; } catch (e) {}
  refresh();
}
async function secOff() {
  if (!await requireUnlock('停用私密通道需要验证密码')) return pageMsg('已取消：未通过密码验证', 'err');
  const r = await (await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: LOCK.token, feishuSecWebhook: '', feishuSecSecret: '' }) })).json();
  pageMsg(r.ok ? '已停用私密通道：验证码与持仓退回主通道（持仓恢复为不显示金额）' : ('停用失败：' + (r.error || '')), r.ok ? 'ok' : 'err');
  refresh();
}
// 停用并清空飞书机器人地址（2026-10-03：换通道时总得有个"先关掉"的出口）
async function fsOff() {
  if (!await requireUnlock('停用飞书通道需要验证密码')) return pageMsg('已取消：未通过密码验证', 'err');
  const r = await (await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: LOCK.token, feishuWebhook: '', feishuSecret: '' }) })).json();
  pageMsg(r.ok ? '已停用飞书通道（信号不再推送；想恢复就粘贴一个新机器人地址保存）' : ('停用失败：' + (r.error || '')), r.ok ? 'ok' : 'err');
  refresh();
}
// ── ⏱ 推送时段 / 开关（2026-10-07 df）────────────────────────────────────
// 这一栏是「系统承诺过、但以前没有任何路径能兑现」的那批设置的落地处：
//   · 9:20 竞价预览，代码注释写着「嫌吵可在面板关掉」，面板却从来没有这个开关；
//   · 推送自检诊断会说「请检查面板的静默时段设置」，面板上也没有这项设置。
// 现在由服务端 /api/state 的 cfgSet 驱动：名称、说明、当前值全部由兑现方给出，
// 面板只读不写 —— 改哪个键、改成什么，都由 CFG_SET 那张表说了算（de 轮「契约由兑现方产出」）。
function renderCfgSet(s) {
  const box = document.getElementById('cfgSetBox');
  if (!box) return;
  // ⛔ 正在输入时不要重绘：refresh 每 5 秒一次，会把用户敲了一半的内容冲掉
  if (box.contains(document.activeElement)) return;
  const cs = (s && s.cfgSet) || {};
  const keys = Object.keys(cs);
  if (!keys.length) { box.textContent = '（服务端未下发可改项）'; return; }
  box.innerHTML = keys.map(k => {
    const it = cs[k] || {};
    const note = String(it.note || '').replace(/"/g, '&quot;');
    const inp = it.kind === 'bool'
      ? `<input type="checkbox" ${it.value ? 'checked' : ''} onchange="saveCfgSetOne('${k}', this.checked)" style="width:16px;height:16px;cursor:pointer">`
      : `<input type="text" value="${String(it.value)}" style="width:${it.kind === 'hhmm' ? 62 : 70}px;text-align:center" onchange="saveCfgSetOne('${k}', this.value)" onkeydown="if(event.key==='Enter')this.blur()">`;
    return `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer" title="${note}">${inp}${String(it.label || k)}</label>`;
  }).join('');
}
// 🎚 门槛 / 额度：只读展示「文件里是什么 / 实际按什么生效 / 默认是多少」。
//   名称、量纲、范围、默认值全部由服务端的 CFG_RANGE 产出（de 轮：契约由兑现方产出），
//   面板不另抄一份 —— 否则又是「同一条规则两处各写一遍」的老毛病。
// ⛔ dm 轮：面板侧的「这份数据新不新鲜」必须与日志、接口、推送同一句话。
//   数据源没回来时后端【保留上一次结果】，界面却照写「更新于 10:23:11」—— 那个时间是上一次的，
//   用户看到的就是"刚刚更新过"。以前这件事只在日志里说（12 处 marketReady 判据、14 处「行情源」），
//   面板侧 0 处提及。现在时间与新鲜度一起由后端 staleState 下发，这里只负责把它说出来。
// ⛔ dn 轮：同一个池的「产出几条」不许两处各数一遍。
//   以前面板读 `items.length` / `count` / `cand` / `zpg.total`，而「🩺 各模块本轮状态」读
//   taskState.n —— 同一个数两个名字、两条代码路径，一旦分叉，同一个模块会显示两个条数，
//   而且两边都是"自己那一瞬间的真实值"，谁也不会报错。现在后端 outNState() 是唯一出口，
//   这里只负责读；后端没下发（旧版本 / 还没算）时才退回本地值。
function poolN(s, pool, fallback) {
  const v = (s && s.outN && s.outN[pool]);
  if (v && typeof v.n === 'number') return v.n;
  return fallback == null ? 0 : fallback;
}
function poolShown(s, pool, fallback) {
  const v = (s && s.outN && s.outN[pool]);
  if (v && typeof v.shown === 'number') return v.shown;
  return fallback == null ? null : fallback;
}
// ⛔ 「扫出 N 只」与「列出 M 只」是两个数 —— N > M 时必须明说，否则用户以为是没刷新
function poolCut(n, shown) {
  return (typeof shown === 'number' && shown > 0 && shown < n) ? ` · 列出前 ${shown} 只` : '';
}
function cutN(s, key, fallback) {
  const v = (s && s.stateCut && s.stateCut[key]);
  if (v && typeof v.total === 'number') return v.total;
  return fallback == null ? 0 : fallback;
}
// 面板实际列出的条数（被截断时 = cap，没截断时 = total）
function cutShown(s, key, fallback) {
  const v = (s && s.stateCut && s.stateCut[key]);
  if (v && typeof v.shown === 'number') return v.shown;
  return fallback == null ? null : fallback;
}
function staleTime(s, pool, time) {
  const v = ((s && s.staleState) || {})[pool];
  const t = time || '-';
  // ⛔ 整句由后端 staleLine 产出（同一条规则不在前后端各写一遍）；本地这段只是没下发时的兜底
  if (v && v.line) return v.line;
  if (v && v.kind === 'held')  return `${v.mark} 行情源未就绪 · ${v.word} ${t}`;
  if (v && v.kind === 'empty') return `${v.mark} 本轮无符合条件的结果（${t}）`;
  if (v && v.kind === 'none')  return `未产出`;
  return `更新于 ${t}`;
}
function renderTaskState(s) {
  const box = document.getElementById('taskBox');
  if (!box) return;
  const ts = s.taskState || {};
  const ks = Object.keys(ts);
  if (!ks.length) { box.textContent = '（服务端未下发）'; return; }
  const DR = s.doneRule || {};
  // ⛔ dl 轮：跑出 0 条不许再打 ✅ —— 用户看到满屏 ✅ 却什么都没有，
  //    分不清「今天真没符合条件的票」和「数据源挂了所以 0 只」。
  //    排序：有产出 → 失败 → 跑通但 0 条 → 没跑，最该看的最靠前。
  const ORDER = { yield: 0, fail: 1, empty: 2, ok: 3, skip: 4 };
  const rk = k => (ORDER[ts[k].done] == null ? 9 : ORDER[ts[k].done]);
  const one = k => {
    const v = ts[k] || {}, d = v.done || '';
    const why = esc(v.empty || v.error || '');
    const t = 'title="' + esc(((DR[d] && DR[d].label) || '') + (why ? '：' + why : '')) + '"';
    if (d === 'fail')  return '<span class="tag" style="background:#ffe3e3;color:#c92a2a;cursor:help" ' + t + '>' + esc(v.name) + ' ❌ 本轮未跑成</span>';
    if (d === 'empty') return '<span class="tag" style="background:#f1f3f5;color:#495057;cursor:help" ' + t + '>' + esc(v.name) + ' ⚪ 0 条 · ' + esc(String(v.empty || '').slice(0, 10)) + '</span>';
    if (d === 'yield')return '<span class="tag" ' + t + '>' + esc(v.name) + ' ✅ ' + v.n + '</span>';
    return '<span class="muted" style="cursor:help" ' + t + '>' + esc(v.name) + ' ' + ((DR[d] && DR[d].mark) || '—') + '</span>';
  };
  let html = ks.slice().sort((a, b) => rk(a) - rk(b)).map(one).join(' ');
  // ⛔ 推送返回 true ≠ 送达：副本拦截 / 条数闸门都返回 true，手机一条收不到
  const pl = s.pushLast || {};
  if (pl.ret !== null && pl.ret !== undefined) {
    const sentTxt = pl.sent === true ? '已送达' : (pl.sent === false ? '未送达' : '发送中');
    html += ' <span class="muted" style="cursor:help" title="⛔ 推送返回 true 不等于送达：副本拦截 / 条数闸门都返回 true，手机一条收不到（dl 轮）">末次推送：' + sentTxt + (pl.why ? '（' + esc(pl.why) + '）' : '') + '</span>';
  }
  // ⛔ dw 轮：补救动作没补上必须看得见 —— 启动首扫/启动补样本/复盘重启补发都只有有限次机会，
  //    「跑过」不等于「补好了」。以前这些补救悄悄失败，用户看到的只是「今天没有复盘 / 没有趋势票」。
  const rm = s.remedy || {};
  // ⛔ dw：补救失败的服务端判据统一由 remedyBadOf 产出（bad 字段）—— 前端别自己再拼 ok/why 过滤，
  //    否则「数据缺口跳过卡到机会用尽」这类（ok=null 但确实没补上）会被漏掉。
  const bad = Object.keys(rm).filter(k => rm[k] && rm[k].bad);
  if (bad.length) {
    const txt = bad.map(k => esc((rm[k].label || k)) + '：' + esc(String(rm[k].whyLabel || ''))).join('；');
    html += ' <span class="tag" style="background:#fff3bf;color:#8a5a00;cursor:help" title="' + esc(bad.map(k => String(rm[k].note || '')).join('；')) + '">⚠️ 补救未成：' + txt + '</span>';
  }
  box.innerHTML = html;
}
// 🌡 数据新鲜度：把「这份结果是这一轮的，还是沿用上一次的」摆到面上。
// ⛔ 沿用上一次时必须显式标注 —— 只显示一个时间戳，用户会当成"刚刚更新过"。
function renderStaleState(s) {
  const box = document.getElementById('staleBox');
  if (!box) return;
  const rule = s.staleRule || {};                       // 后端下发的四种新鲜度定义（面板不另抄一份）
  const ruleTip = Object.keys(rule).map(k => rule[k].word + '：' + rule[k].note).join('\n');
  if (ruleTip) box.title = ruleTip;
  const st = s.staleState || {};
  const ks = Object.keys(st);
  if (!ks.length) { box.textContent = '（服务端未下发）'; return; }
  const held = ks.filter(k => st[k].kind === 'held');
  if (!held.length) {
    box.textContent = ks.map(k => st[k].name + (st[k].kind === 'fresh' ? '✅' : st[k].mark)).join(' · ');
    return;
  }
  box.innerHTML = held.map(k =>
    `<span class="tag" style="background:#fff3bf;color:#8a5a00;cursor:help" title="行情源未就绪，这份结果是上一次的（dm 轮）">${esc(st[k].name)} ${st[k].mark} ${st[k].word}</span>`
  ).join(' ') + ' <span class="muted">' + ks.filter(k => st[k].kind !== 'held').map(k => st[k].name + (st[k].kind === 'fresh' ? '✅' : st[k].mark)).join(' · ') + '</span>';
}
function renderCfgRange(s) {
  const box = document.getElementById('cfgRangeBox');
  if (!box) return;
  const cr = (s && s.cfgRange) || {};
  const keys = Object.keys(cr);
  if (!keys.length) { box.textContent = '（服务端未下发）'; return; }
  box.innerHTML = keys.map(k => {
    const it = cr[k] || {};
    // 越界的旧值要**原样报出来**：只说"不合法"用户还是不知道文件里到底写了什么
    const cur = it.cur == null ? (it.bad === 'bad' ? '「' + String(it.raw) + '」' : '未设置') : String(it.cur);
    const def = String(it.def);
    const tip = `${String(it.hint || '')}｜允许 ${it.min}~${it.max}｜默认 ${def}｜实际生效 ${String(it.using)}`;
    if (it.bad === 'bad') {
      return `<span style="color:#c0392b;font-weight:600" title="${tip}">⚠️ ${k}：文件里是 ${cur}，越界，实际按 ${String(it.using)} 生效</span>`;
    }
    return `<span title="${tip}">${k} ${cur}${it.bad === 'unset' ? '（默认 ' + def + '）' : ''}</span>`;
  }).join('<span class="muted"> · </span>');
}
async function saveCfgSetOne(k, v) {
  if (!await requireUnlock('修改推送时段 / 开关')) { refresh(); return; }
  const body = { token: LOCK.token };
  body[k] = v;
  const r = await post('/api/config', body);
  // ⛔ 保存失败必须把服务端原因念出来，并重绘回服务端的真实值 ——
  //    否则框里显示着改后的值、服务端还是旧的，正是「设置静默失效」的老毛病。
  pageMsg(r.ok ? ('✅ 已保存：' + k + ' = ' + v) : ('❌ 保存失败：' + (r.error || '服务端未说明原因') + '（现有设置未被改动）'), r.ok ? 'ok' : 'err');
  refresh();
}
async function testPush() {
  const r = await post('/api/test-push', {});
  // 2026-10-03：现在服务端会等飞书真实回包再答话，成功/失败都有据可查；
  // 失败时把飞书原话 + 该怎么办（Tip）一起显示，不再用一句"发送失败"打发人。
  if (r.ok) pageMsg('✅ 已送达飞书（' + (r.time || '') + '）· 机器人 ' + (r.mask || '') + '：手机应收到一条「推送通道自检」', 'ok');
  else pageMsg('❌ 没推通：' + (r.error || r.detail || '未知原因') + (r.tip ? ('\n👉 ' + r.tip) : ''), 'err');
  setTimeout(refresh, 1200);
}
async function runBacktest() {
  const el = document.getElementById('btState');
  el.textContent = '回测运行中（逐股回放40个交易日，请稍候）...';
  await fetch('/api/backtest', { method: 'POST' });
  // ⛔ 2026-10-06 补：超时与失败收尾（本轮角度：pending 承诺必须有收尾）。
  //    原来只判"结果为空就继续等"，之后再没有别的出口 —— 一旦回测失败，
  //    或进程在跑的过程中重启（那个 pending 请求随进程一起消失），
  //    /api/backtest/result 会永远回 empty:true，这个 setInterval 就**每 3 秒打一次、打到关页面为止**，
  //    而按钮旁边一直停在"回测运行中"，没有任何一句话告诉用户这次没成。
  //    现在两条路都堵上：服务端失败会带 error 回来；这里再加 30 次（约 90 秒）上限，
  //    两种情况都把话说清楚并停表。
  let tries = 0;
  const poll = setInterval(async () => {
    tries++;
    let r = null;
    try { r = await (await fetch('/api/backtest/result')).json(); } catch (e) { r = null; }
    if (r && r.error) { clearInterval(poll); el.textContent = '❌ 回测失败：' + r.error; return; }
    if (r && !r.empty) {
      clearInterval(poll);
      el.textContent = `完成：${r.股票数} 只 × ${r.交易日数} 日 = ${r.总样本} 样本`;
      const b = r.分数段命中率;
    document.getElementById('btResult').innerHTML =
      `<table><tr><th>评分段</th><th>样本数</th><th>次日涨停或涨5%概率</th></tr>` +
      Object.entries(b).map(([k, v]) => `<tr><td><b>${k}分</b></td><td>${v.样本数}</td><td class="${v.次日涨停或涨5pct概率 >= 30 ? 'up' : ''}"><b>${v.次日涨停或涨5pct概率}</b></td></tr>`).join('') +
      `</table><p class="muted" style="margin-top:8px">高分段(≥70分)样本 ${r.高分样本数} 个，胜率 ${r.高分胜率}。概率模型以该命中率校准，>80%推送线表示模型综合评分下历史上多数能封板/大涨的强势组合。回测为统计参考，不构成投资建议。</p>`;
      return;
    }
    if (tries >= 30) {
      clearInterval(poll);
      el.textContent = '⚠️ 回测超时（约 90 秒没出结果）：可能样本过大，或服务正在跑的过程中被重启了。请稍后重试一次。';
    }
  }, 3000);
}


// ── 多策略可视化中心 ─────────────────────────────────────────────
let _strategyItems=[];
function regimeLabel(v){ return ({risk_on:'进攻',risk_off:'防守',trend:'趋势',mean_reversion:'反转',neutral:'中性'})[v]||v||'中性'; }
function scoreBar(v){ const n=Math.max(0,Math.min(100,Number(v)||0)); return '<div class="scorebar"><i style="width:'+n+'%"></i></div>'; }
function esc2(v){ return esc(v); }
function renderStrategyDashboard(data){
  const sum=document.getElementById('strategySummary'), top=document.getElementById('strategyTop');
  if(!sum||!top) return;
  const items=Array.isArray(data.items)?data.items:[]; _strategyItems=items;
  sum.innerHTML='<div class="strategy-metric"><b>'+esc2(regimeLabel(data.regime))+'</b><span>当前市场状态</span></div>'+
    '<div class="strategy-metric"><b>'+items.length+'</b><span>已评分候选</span></div>'+
    '<div class="strategy-metric"><b>'+Math.round((data.market&&data.market.sentimentScore)||0)+'</b><span>情绪强度</span></div>'+
    '<div class="strategy-metric"><b>'+Math.round((data.market&&data.market.indexTrendScore)||0)+'</b><span>指数趋势</span></div>';
  if(!items.length){ top.innerHTML='<div class="muted">当前没有可供策略评分的候选股</div>'; return; }
  top.innerHTML=items.map((x,i)=>'<button type="button" class="strategy-row" onclick="showStrategyDetail('+i+')"><span class="srank">#'+x.rank+'</span><span class="sname">'+esc2(x.name)+'<small>'+esc2(x.code)+'</small></span><span class="sscore">'+Number(x.finalScore||0).toFixed(1)+scoreBar(x.finalScore)+'</span><span class="spass '+(x.pass?'ok':'no')+'">'+(x.pass?'通过':'观察')+'</span></button>').join('');
}
function showStrategyDetail(i){
  const x=_strategyItems[i], box=document.getElementById('strategyDetail'); if(!x||!box)return;
  const c=x.contributions||{}; const keys=['trend','momentum','breakout','quality','reversal'];
  const labels={trend:'趋势',momentum:'动量',breakout:'突破',quality:'资金质量',reversal:'反转'};
  box.innerHTML='<b>'+esc2(x.name)+' · '+Number(x.finalScore).toFixed(1)+' 分</b><div class="contrib-grid">'+keys.map(k=>'<div><span>'+labels[k]+'</span><b>'+Number(c[k]||0).toFixed(1)+'</b>'+scoreBar(c[k])+'</div>').join('')+'</div>'+
    '<div class="strategy-reasons"><b>命中原因：</b>'+((x.reasons||[]).length?x.reasons.map(esc2).join(' · '):'暂无')+'</div>'+
    '<div class="strategy-reasons"><b>风险：</b>'+(x.blocked?'已触发硬过滤':'未触发硬过滤')+'</div>';
}
async function loadStrategyDashboard(){
  try{ const r=await fetch('/api/strategy/dashboard',{cache:'no-store'}); const d=await r.json(); if(!d.ok) throw new Error(d.error||'读取失败'); renderStrategyDashboard(d); }
  catch(e){ const box=document.getElementById('strategySummary'); if(box) box.innerHTML='<span class="muted">策略中心读取失败：'+esc2(e.message)+'</span>'; }
}
setTimeout(loadStrategyDashboard,600);
setInterval(loadStrategyDashboard,30000);
