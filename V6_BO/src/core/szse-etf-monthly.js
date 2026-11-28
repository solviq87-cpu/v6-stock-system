'use strict';

const { FLAGS } = require('./research-workspace-store');
const PROVIDER = 'szse-fund';
const MAX_BYTES = 2 * 1024 * 1024;
const BASE = 'https://docs.static.szse.cn/www/market/periodical/month/';
const MONTH = /^20\d{2}-(?:0[1-9]|1[0-2])$/;
const DOCUMENT = /^W\d{21}\.html$/;

function validateScope({month, documentId}) {
  if (typeof month !== 'string' || !MONTH.test(month) || typeof documentId !== 'string' || !DOCUMENT.test(documentId)) {
    throw Error('需要报告月份和深交所月报原文件名');
  }
}

// The exchange uses a self-closing spacer cell between year-to-date and month.
// Consume every cell in order. A changed table layout must not silently reassign a value.
function cells(row, tag) {
  const pattern = tag === 'th' ? /\s*<th\b([^<>]*?)(?:\/>|>([^]*?)<\/th>)/iy : /\s*<td\b([^<>]*?)(?:\/>|>([^<>]*)<\/td>)/iy;
  const result = [];
  row = row.trimEnd();
  while (pattern.lastIndex < row.length) {
    const match = pattern.exec(row);
    if (!match || result.length >= 18) throw Error('ETF月报列结构不完整');
    const [, attrs, body] = match;
    const text = (body ?? '').replace(/<\/?br\s*\/?>|&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (/[<>]/.test(text)) throw Error('ETF月报包含未识别单元格');
    result.push({text, attrs, spacer: body === undefined});
  }
  return result;
}

function amount(value) {
  if (value === '' || value === '--' || value === '-') return null;
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(value)) throw Error('ETF成交金额单位或数值无效');
  return Number(value);
}

function projectEtfMonthly(raw, scope, observedAt) {
  validateScope(scope);
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > MAX_BYTES ||
      !Number.isSafeInteger(observedAt) || observedAt <= 0 || observedAt > Date.now()) throw Error('ETF原回执或时点无效');
  if (scope.month >= new Date(observedAt + 8 * 3600000).toISOString().slice(0, 7)) throw Error('ETF月报统计月尚未结束');
  // The supported official tables are GB18030 documents. Do not parse an HTML
  // error page or fall back to a different unit, date range or field by position.
  let html;
  try { html = new TextDecoder('utf-8',{fatal:true}).decode(raw); }
  catch { html = new TextDecoder('gb18030',{fatal:true}).decode(raw); }
  const table = html.match(/^\s*(?:<style\b[^>]*>[^]*?<\/style>\s*)?<table>\s*<caption>([^]*?)<\/caption>([^]*?)<\/table>\s*$/i);
  if (!table) throw Error('ETF月报表格不完整');
  const caption = table[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const [year, month] = scope.month.split('-');
  if (caption !== 'ETF证券成交统计 TRADING SUMMARY OF EXCHANGE TRADED FUNDS - （' + year + '.' + month + '） 成交金额单位：万元 10,000') {
    throw Error('ETF月报名称、报告月份或单位不一致');
  }
  const body = table[2].trimEnd(), rowPattern = /\s*<tr(?:\s+class="[^"<>]*")?>([^]*?)<\/tr>/iy;
  function next() {
    const m = rowPattern.exec(body);
    if (!m) throw Error('ETF月报表行缺失');
    return m[1];
  }
  const top = cells(next(), 'th'), sub = cells(next(), 'th');
  const headers = ['最高价 High','最低价 Low','成交量 Volume','成交金额 Turnover','拟合误差 Error%','',
    '最高价 High','最低价 Low','收市价 Close','升跌幅 ±%','成交量 Volume','成交金额 Turnover','拟合误差 Error%'];
  if (top.length !== 8 || !['代码 Code','基金名称 ETFs','当前规模 Fund Size','单位净值 NAV','目标指数 Underlying Index'].every((s,i) => top[i].text === s) ||
      !top[5].text.startsWith(year+'年1月- '+Number(month)+'月 ') || !top[7].text.startsWith(year+'年'+Number(month)+'月 ') ||
      !/\bcolspan="5"/i.test(top[5].attrs) || !/\bcolspan="7"/i.test(top[7].attrs) || !top[6].spacer ||
      sub.length !== headers.length || !sub[5].spacer || !sub.every((c,i) => c.text === headers[i])) throw Error('ETF月报累计与当月列无法核对');
  const rows = [], symbols = new Set();
  while (rowPattern.lastIndex < body.length) {
    const fields = cells(next(), 'td');
    if (rows.length >= 5000 || fields.length !== 18 || !fields[10].spacer || fields.some((c,i) => i === 10 ? !/\bclass="separator"/.test(c.attrs) :
        c.spacer || !c.attrs.split(/\s+/).includes('class="c'+(i<10?i+1:i-1)+'"'))) throw Error('ETF月报数据列错位');
    const symbol = fields[0].text, name = fields[1].text, trackingIndex = fields[4].text;
    if (!/^\d{6}$/.test(symbol) || symbols.has(symbol) || !name || name.length > 64 ||
        !/^[A-Za-z0-9_.-]{0,40}$/.test(trackingIndex)) throw Error('ETF基金或目标指数身份无效或重复');
    symbols.add(symbol);
    rows.push({symbol, name, trackingIndex: trackingIndex || null, monthlyTurnoverWanCny: amount(fields[16].text)});
  }
  if (!rows.length) throw Error('ETF月报无基金记录');
  return {provider:PROVIDER, exchange:'SZSE', month:scope.month, sourceUrl:BASE + scope.documentId, rows,
    measure:'secondary-market-monthly-turnover', unit:'万元人民币', netSubscriptions:null, buyerIdentity:null,
    quoteAt:null, sourcePublishedAt:null, verifiedLive:false, ...FLAGS};
}

async function collectEtfMonthly({month, documentId, archiveRoot, fetchImpl=globalThis.fetch}) {
  const scope = {month, documentId};
  validateScope(scope);
  const requestStartedAt = Date.now();
  const response = await fetchImpl(BASE + documentId, {redirect:'error', signal:AbortSignal.timeout(15000)});
  if (response.status !== 200 || response.redirected || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '') || !response.body) {
    await response.body?.cancel?.();
    throw Error('深交所月报未返回完整HTML原文');
  }
  const chunks = [];
  let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length;
    if (size > MAX_BYTES || !(bytes instanceof Uint8Array)) throw Error('ETF月报原文流无效或超过2MiB');
    chunks.push(bytes);
  }
  const observedAt = Date.now(), raw = Buffer.concat(chunks);
  return require('./market-data-evidence').archiveBackgroundResult({...projectEtfMonthly(raw,scope,observedAt),requestStartedAt,observedAt},
    {root:archiveRoot,raw,byteBasis:'response-body',scope});
}

function compareArchivedMonths({root, symbol, earlier, later, decisionAt}) {
  if (typeof symbol !== 'string' || !/^\d{6}$/.test(symbol)) throw Error('需要六位深市基金代码');
  const {readBackgroundAsOf} = require('./market-data-evidence');
  const months = [earlier,later].map(scope => {
    const entry = readBackgroundAsOf({root,provider:PROVIDER,scope,decisionAt});
    return {month:scope.month, receipt:entry.receipt?.hash ?? null, availableAt:entry.receipt?.availableAt ?? null,
      row:entry.data?.rows.find(r => r.symbol === symbol) ?? null};
  });
  const [previous,current] = months;
  const monthNo = s => Number(s.slice(0,4))*12 + Number(s.slice(5));
  let reason = null;
  if (monthNo(current.month) !== monthNo(previous.month)+1) reason = '需要相邻月份';
  else if (!previous.row || !current.row) reason = '截点时缺少月报或该基金记录';
  else if (!previous.row.trackingIndex || previous.row.trackingIndex !== current.row.trackingIndex) reason = '跟踪指数未知或已变更';
  else if (!(previous.row.monthlyTurnoverWanCny > 0) || current.row.monthlyTurnoverWanCny === null) reason = '分母为零或缺少成交金额';
  return {symbol, exchange:'SZSE', decisionAt, months, status:reason?'unknown':'observed',reason,
    turnoverRatio:reason?null:current.row.monthlyTurnoverWanCny/previous.row.monthlyTurnoverWanCny,
    unit:'万元人民币', frequency:'calendar-month', intradayAnomaly:null, netSubscriptions:null, buyerIdentity:null, ...FLAGS};
}

module.exports = {validateScope, projectEtfMonthly, collectEtfMonthly, compareArchivedMonths};
