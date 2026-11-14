'use strict';
// Explicit, bounded, account-free diagnostic. Never starts a poller or activates a production feed.
const fs = require('node:fs');
const { createPublicMarket } = require('./public-market');
const { validateSnapshot } = require('./parallel-market');
const links = require('../../public/assets/stock-provider-links');
const IDS = ['tencent', 'eastmoney', 'sina'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
function options(code, providers) {
  if (typeof code !== 'string' || !/^(?:60|68|00|30)\d{4}$/.test(code) ||
      !Array.isArray(providers) || !providers.length || providers.length > 3 ||
      new Set(providers).size !== providers.length || providers.some(id => !IDS.includes(id))) throw Error('需要沪深A股及唯一公开来源列表');
}
function quote(q, code, now) {
  if (!q || q.code !== code || q.exchange !== (code.startsWith('6') ? 'SH' : 'SZ') ||
      !Number.isSafeInteger(q.timestamp) || q.timestamp <= 0 || q.timestamp > now) throw Error('报价证券或原始时间无效');
  // Structural validation at the quote's own time preserves dated snapshots without calling them live.
  return validateSnapshot({ schemaVersion: 1, provider: 'probe', observedAt: q.timestamp, quotes: [q] }, 'probe', q.timestamp).quotes[0];
}
function projectProbe(input, now = Date.now()) {
  if (!finite(now) || now <= 0 || !input || input.schemaVersion !== 1 || input.mode !== 'public-quote-probe' ||
      input.probeOnly !== true || input.canTrade !== false || input.verifiedLive !== false || input.paidServicesUsed !== false ||
      !finite(input.generatedAt) || input.generatedAt > now || input.generatedAt <= 0 ||
      !Array.isArray(input.sources)) throw Error('公开报价检查协议无效');
  options(input.code, input.sources.map(s => s?.id));
  const sources = input.sources.map(s => {
    if (!['ok', 'stale-or-invalid', 'unavailable'].includes(s.status)) throw Error('来源状态无效');
    let q = null;
    if (s.status === 'ok') {
      const snap = s.snapshot;
      if (!snap || snap.provider !== s.id || snap.schemaVersion !== 1 || !finite(snap.observedAt) ||
          snap.observedAt > input.generatedAt || snap.observedAt <= 0 || !Array.isArray(snap.quotes) || snap.quotes.length !== 1) throw Error('快照来源或数量无效');
      q = quote(snap.quotes[0], input.code, now);
      if (q.timestamp > snap.observedAt) throw Error('报价时间晚于采集');
    } else if (s.status === 'stale-or-invalid') {
      q = quote(s.lastQuote, input.code, now);
      if (q.timestamp > input.generatedAt) throw Error('报价时间晚于检查');
    } else if (s.snapshot || s.lastQuote) throw Error('失败来源不能携带有效报价');
    const fresh = q && now - q.timestamp <= 15000;
    const status = !q ? 'unavailable' : fresh ? 'fresh-unverified' : 'dated-snapshot';
    return { id: s.id, status, quote: q ? { ...q, status: 'market-state-unverified', quoteAt: q.timestamp,
      quoteTime: new Date(q.timestamp).toISOString(), freshness: fresh ? 'within-15-seconds-unverified' : 'not-realtime' } : null };
  });
  return { schemaVersion: 1, status: now - input.generatedAt > 15000 ? 'check-expired' : sources.some(s => s.status === 'fresh-unverified') ? 'observed-unverified' : sources.some(s => s.quote) ? 'snapshot-only' : 'unavailable',
    code: input.code, checkedAt: input.generatedAt, canTrade: false, verifiedLive: false,
    paidServicesUsed: false, sources, pageLinks: links.links(input.code) };
}
async function probePublicQuotes({ code, providers = ['tencent', 'eastmoney'], timeoutMs = 8000, clock = Date.now, fetchImpl = globalThis.fetch } = {}) {
  options(code, providers);
  if (typeof clock !== 'function' || !finite(clock()) || clock() <= 0) throw Error('检查时钟无效');
  const first = await createPublicMarket({ code, providers, timeoutMs, clock, fetchImpl }).sync();
  const missing = first.sources.filter(s => s.status === 'unavailable').map(s => s.id);
  let retry = null;
  // Only a transport/format failure is retried once; stale close snapshots and denials are not retried.
  const retryIds = missing.filter(id => !first.sources.find(s => s.id === id).error?.startsWith('HTTP '));
  if (retryIds.length) retry = await createPublicMarket({ code, providers: retryIds, timeoutMs, clock, fetchImpl }).sync();
  const generatedAt = clock();
  const sources = first.sources.map(initial => {
    const s = retry?.sources.find(x => x.id === initial.id) || initial;
    if (s.status === 'unavailable') return s;
    try {
      const q = quote(s.snapshot?.quotes?.[0] || s.lastQuote, code, generatedAt);
      const observedAt = s.snapshot?.observedAt ?? generatedAt;
      if (q.timestamp > observedAt || observedAt > generatedAt) throw Error('time');
      return s;
    } catch { return { id: s.id, status: 'unavailable', error: '证券、原始时点或报价结构无效' }; }
  });
  const result = { schemaVersion: 1, mode: 'public-quote-probe', code, generatedAt,
    probeOnly: true, canTrade: false, verifiedLive: false, paidServicesUsed: false,
    sources, attempts: first.sources.map(s => ({ id: s.id, firstStatus: s.status, retried: retryIds.includes(s.id) })),
    warning: '一次性公开地址连通检查；非付费API、持续采集、交易所认证或商业转发许可。旧价格只作带日期快照。' };
  // Reproject after all sources finish, so a slow peer cannot keep earlier quotes falsely fresh.
  projectProbe(result, generatedAt);
  return result;
}
function readPublicQuoteProbe(file, now = Date.now()) {
  const empty = { status: 'unconfigured', canTrade: false, verifiedLive: false, sources: [], pageLinks: [] };
  if (!file) return empty;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw Error('file');
    return projectProbe(JSON.parse(fs.readFileSync(file, 'utf8')), now);
  } catch { return { ...empty, status: 'invalid' }; }
}
module.exports = { probePublicQuotes, projectProbe, readPublicQuoteProbe };
