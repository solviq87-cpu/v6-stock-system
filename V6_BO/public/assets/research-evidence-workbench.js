(function () {
'use strict';
const el = id => document.getElementById(id);
if (!el('researchEvidence')) return;
const arr = x => Array.isArray(x) ? x : [];
const val = x => x === undefined || x === null || x === '' ? '未知' : typeof x === 'object' ? JSON.stringify(x) : String(x);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const time = x => finite(x) && Number.isFinite(new Date(x).getTime()) ? new Date(x).toISOString() : val(x);
const pct = x => finite(x) ? (100 * x).toFixed(1) + '%' : '等待独立目标日证据';
function node(tag, text) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
function line(p, label, value) { p.append(node('p', label + '：' + val(value))); }
let catalogue = [], chosen = [], sectorRevision = 0;
const active = new Map();
function cancel(key) { const old = active.get(key); old?.controller.abort(); active.delete(key); }
for (const name of ['input', 'change']) el('token')?.addEventListener(name, () => {
  cancel('status'); cancel('sectors'); sectorRevision++; catalogue = []; chosen = []; renderSelection(); renderOptions();
  for (const id of ['researchStatusSummary', 'sectorEvidenceSummary', 'sectorEvidenceOutput']) el(id).replaceChildren();
  el('researchStatusMessage').textContent = el('sectorEvidenceStatus').textContent = '令牌已更改，请重新读取。';
});
async function request(key, url, options, statusId, run, selectionRevision) {
  cancel(key); const controller = new AbortController(), token = el('token')?.value || '', entry = { controller, token };
  active.set(key, entry); const timer = setTimeout(() => controller.abort(), 60000);
  const fresh = () => active.get(key) === entry && token === (el('token')?.value || '') && (selectionRevision === undefined || selectionRevision === sectorRevision);
  el(statusId).textContent = '正在读取证据…';
  try {
    const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
    const body = await response.json(); if (!fresh()) return;
    if (!response.ok || !body.ok || !body.result || typeof body.result !== 'object') throw Error(body.error || '证据请求未完成');
    run(body.result); el(statusId).textContent = '已读取 · ' + val(body.result.status) + '；缺失事实保留未知。';
  } catch (e) { if (fresh()) el(statusId).textContent = e.name === 'AbortError' ? '请求超时，请重试' : e.message || '读取失败'; }
  finally { clearTimeout(timer); if (active.get(key) === entry) active.delete(key); }
}
function renderStatus(r) {
  const p = el('researchStatusSummary'); p.replaceChildren();
  const f = r.researchFollowups || {}, c = f.counts || {};
  line(p, '复访待处理 / 已完成 / 未知', val(c.pending ?? (Array.isArray(f.pending) ? f.pending.length : null)) + ' / ' + val(c.completed ?? (Array.isArray(f.completed) ? f.completed.length : null)) + ' / ' + val(c.unknown ?? (Array.isArray(f.unknown) ? f.unknown.length : null)));
  line(p, '已到期复访', c.due);
  line(p, '最近成功', f.lastSuccess ? [f.lastSuccess.symbol, f.lastSuccess.targetDate, time(f.lastSuccess.completedAt)].map(val).join(' · ') : '尚无已知成功记录');
  line(p, '最近失败', f.lastFailure ? [f.lastFailure.symbol, f.lastFailure.reason, time(f.lastFailure.completedAt)].map(val).join(' · ') : '尚无已知失败记录');
  for (const item of arr(f.pending).slice(0, 6)) line(p, '待复访', [item.symbol, item.provider, item.targetDate, '到期 ' + time(item.dueAt), '下次尝试 ' + time(item.nextAttemptAt)].map(val).join(' · '));
  const research = r.priceEventResearch || {}, streams = Array.isArray(research.streams) ? research.streams : research.forwardValidation ? [research] : [];
  line(p, '研究目标', research.objective);
  line(p, '独立目标日（汇总）', research.independentTargetDays ?? research.forwardValidation?.independentTargetDays);
  for (const stream of streams.slice(0, 12)) {
    const v = stream.forwardValidation || {};
    line(p, [stream.symbol, stream.provider].filter(Boolean).join(' ') + ' · 原始日K方向事件', '已评价 ' + val(v.evaluated) + ' / 独立目标日 ' + val(v.independentTargetDays) + ' · 匹配频率 ' + pct(v.rawCandleMatchFrequency) + ' · Brier ' + val(v.brier) + ' / 可评分 ' + val(v.brierEvaluated));
  }
  p.append(node('p', '复访完成表示已取得目标日证据；原始日K C>O研究匹配频率不等于收益或涨停概率。'));
}
const boardKey = b => b.category + ':' + b.code;
function renderSelection() {
  const p = el('sectorSelection'); p.replaceChildren(node('p', '已选 ' + chosen.length + ' / 6'));
  for (const b of chosen) {
    const button = node('button', '移除 ' + val(b.name || b.code) + ' · ' + (b.category === 'concept' ? '概念' : '行业'));
    button.type = 'button'; button.addEventListener('click', () => { chosen = chosen.filter(x => boardKey(x) !== boardKey(b)); sectorRevision++; cancel('sectors'); renderSelection(); }); p.append(button);
  }
}
function renderOptions() {
  const select = el('sectorBoardChoice'), category = el('sectorCategory').value || 'industry', search = el('sectorSearch').value.trim().toLowerCase();
  select.replaceChildren(); const blank = node('option', '选择目录中的板块'); blank.value = ''; select.append(blank);
  for (const b of catalogue.filter(b => b.category === category && (!search || (val(b.name) + b.code).toLowerCase().includes(search))).slice(0, 500)) {
    const option = node('option', val(b.name) + ' · ' + b.code); option.value = boardKey(b); select.append(option);
  }
}
function collectCatalogue(data) {
  const rows = Array.isArray(data) ? data : arr(data?.records);
  return rows.filter(b => ['industry', 'concept'].includes(b?.category) && /^BK\d{4}$/.test(b.code));
}
function renderSectors(r) {
  const p = el('sectorEvidenceSummary'); p.replaceChildren();
  catalogue = collectCatalogue(r.catalogue);
  const stored = Array.isArray(r.selection) ? r.selection : arr(r.selection?.boards);
  chosen = stored.filter(b => ['industry', 'concept'].includes(b?.category) && /^BK\d{4}$/.test(b.code)).slice(0, 6).map(b => ({ ...catalogue.find(x => boardKey(x) === boardKey(b)), ...b }));
  renderSelection(); renderOptions();
  line(p, '已存目录数 / 选择数', catalogue.length + ' / ' + chosen.length);
  line(p, '采集状态', r.status);
  const current = r.current || r.sectorCurrent || {};
  line(p, '当前证据日期 / 获取时间', val(current.tradeDate ?? r.tradeDate) + ' / ' + time(current.retrievedAt ?? r.retrievedAt));
  for (const b of arr(current.sectors || current.boards || r.boards).slice(0, 6)) line(p, val(b.name || b.code), '成员 ' + (Array.isArray(b.members) ? b.members.length : '未知') + ' · 当前涨跌幅 ' + val(b.changePct) + ' · 来源 ' + val(b.source ?? current.source) + ' · 成员观测时间 ' + time(b.membersObservedAt));
  const relations = r.relations || {}, edges = arr(relations.edges);
  for (const edge of arr(r.overlap).slice(0, 15)) line(p, val(edge.from) + ' ↔ ' + val(edge.to) + ' · 当前成员交集', (Array.isArray(edge.sharedMembers) ? edge.sharedMembers.length : '未知') + ' · Jaccard ' + pct(edge.jaccard) + ' · 成员观测时间 ' + val(edge.membersObservedAt));
  if (!edges.length) line(p, '历史关系', '等待完整成员及对齐历史证据');
  for (const edge of edges.slice(0, 15)) {
    line(p, val(edge.from) + ' ↔ ' + val(edge.to), '当前成员交集 ' + val(edge.membershipOverlap?.intersection ?? edge.membershipOverlap?.intersectionCount ?? edge.intersectionCount) + ' · Jaccard ' + pct(edge.membershipOverlap?.jaccard) + ' · 同日相关 ' + val(edge.sameDayCorrelation?.coefficient) + ' / 匹配日 ' + val(edge.sameDayCorrelation?.knownMatchedCount));
  }
  const coverage = r.historyCoverage || relations.coverage || {};
  line(p, '历史覆盖 · 已冻结日 / 匹配日 / 应有日', val(coverage.frozenDailyCount) + ' / ' + val(coverage.acceptedSessions ?? coverage.acceptedDays) + ' / ' + val(coverage.expectedSessions ?? coverage.expectedDays));
  line(p, '缺失交易日', Array.isArray(coverage.missingTradeDates) ? coverage.missingTradeDates.length ? coverage.missingTradeDates.join('、') : '窗口内无缺失；不代表足够验证' : '未知');
  line(p, '历史覆盖', coverage);
  line(p, '来源引用数', Array.isArray(r.rawRefs) ? r.rawRefs.length : '未知');
  const errors = arr(r.errors).concat(arr(current.errors));
  line(p, '来源异常', errors.length ? errors : '未提供异常；不代表事实完整');
  p.append(node('p', '当前成员交集与历史相关分开；当前成员不会回填过去。概念资金不可相加为全市场资金。'));
  el('sectorEvidenceOutput').textContent = JSON.stringify(r, null, 2);
}
el('researchStatusRead').addEventListener('click', () => { el('researchStatusSummary').replaceChildren(); return request('status', '/api/research/stock-observation-status', { method: 'GET' }, 'researchStatusMessage', renderStatus); });
el('sectorSavedRead').addEventListener('click', () => { el('sectorEvidenceSummary').replaceChildren(); el('sectorEvidenceOutput').replaceChildren(); return request('sectors', '/api/research/public-sectors', { method: 'GET' }, 'sectorEvidenceStatus', renderSectors, sectorRevision); });
el('sectorCatalogueRun').addEventListener('click', () => { el('sectorEvidenceSummary').replaceChildren(); el('sectorEvidenceOutput').replaceChildren(); return request('sectors', '/api/research/public-sectors', { method: 'POST', body: '{}' }, 'sectorEvidenceStatus', renderSectors, sectorRevision); });
el('sectorCaptureRun').addEventListener('click', () => {
  if (chosen.length < 1 || chosen.length > 6) { el('sectorEvidenceStatus').textContent = '请明确选择1至6个行业或概念板块'; return; }
  el('sectorEvidenceSummary').replaceChildren(); el('sectorEvidenceOutput').replaceChildren();
  return request('sectors', '/api/research/public-sectors', { method: 'POST', body: JSON.stringify({ boards: chosen.map(({ category, code }) => ({ category, code })) }) }, 'sectorEvidenceStatus', renderSectors, sectorRevision);
});
el('sectorBoardAdd').addEventListener('click', () => {
  const found = catalogue.find(b => boardKey(b) === el('sectorBoardChoice').value);
  if (!found) { el('sectorEvidenceStatus').textContent = '请从目录明确选择板块'; return; }
  if (chosen.some(b => boardKey(b) === boardKey(found))) return;
  if (chosen.length >= 6) { el('sectorEvidenceStatus').textContent = '最多选择6个板块'; return; }
  chosen.push(found); sectorRevision++; cancel('sectors'); renderSelection();
});
el('sectorCategory').addEventListener('change', renderOptions); el('sectorSearch').addEventListener('input', renderOptions);
})();
