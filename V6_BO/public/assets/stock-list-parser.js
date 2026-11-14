(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V6StockListParser = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 100 * 1024, MAX_ROWS = 1000, MAX_SYMBOLS = 100;
  const codeHeaders = new Set(['代码', '股票代码', '证券代码', 'code', 'symbol', 'stock_code']);
  const nameHeaders = new Set(['名称', '股票名称', '证券名称', 'name', 'stock_name']);
  function normalizeCode(value) {
    const raw = value.trim().toUpperCase();
    const match = /^(?:(SH|SZ|BJ))?(\d{6})(?:\.(SH|SZ|BJ))?$/.exec(raw);
    if (!match) return { error: '需要完整六位股票代码；不补零、不按名称猜代码' };
    const [, prefix, code, suffix] = match;
    if (prefix && suffix && prefix !== suffix) return { error: '交易所前后缀冲突' };
    // The existing capture endpoint accepts bare mainland codes. Only erase an
    // exchange when its stock namespace is unambiguous; sh000001 is an index.
    const exchange = /^(60|68)\d{4}$/.test(code) ? 'SH' : /^(00|30)\d{4}$/.test(code) ? 'SZ' : null;
    if (prefix === 'BJ' || suffix === 'BJ' || /^(4|8|92)/.test(code)) return { error: '本入口暂不支持北交所代码' };
    if (!exchange) return { error: '本入口仅支持沪深股票代码，指数、ETF及其他市场暂不支持' };
    if ((prefix || suffix) && (prefix || suffix) !== exchange) return { error: '交易所与股票代码不匹配，可能是指数' };
    return { code, exchange };
  }
  function readRows(text) {
    const rows = []; let cells = [], cell = '', quoted = false, closed = false, line = 1, start = 1;
    const pushCell = () => { cells.push(cell.trim()); cell = ''; closed = false; };
    const pushRow = () => { pushCell(); if (cells.some(Boolean)) rows.push({ line: start, cells }); cells = []; start = line + 1; };
    // Tab is preferred for copied spreadsheets, so commas in a TSV name stay
    // in that cell. Otherwise parse CSV quoting before interpreting list separators.
    const separator = text.includes('\t') ? '\t' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') { quoted = false; closed = true; }
        else { cell += c; if (c === '\n') line++; }
      } else if (c === '"') {
        if (cell.trim() || closed) throw Error('第 ' + line + ' 行引号位置无效');
        cell = ''; quoted = true;
      } else if (c === separator) pushCell();
      else if (c === '\n') { pushRow(); line++; }
      else if (closed && !/\s/.test(c)) throw Error('第 ' + line + ' 行引号后有多余字符');
      else if (!closed) cell += c;
      if (rows.length > MAX_ROWS) throw Error('最多解析 ' + MAX_ROWS + ' 行');
    }
    if (quoted) throw Error('CSV 引号未闭合，请修正后重新预览');
    pushRow(); if (rows.length > MAX_ROWS) throw Error('最多解析 ' + MAX_ROWS + ' 行');
    return rows;
  }
  function parseStockList(input) {
    if (typeof input !== 'string') throw Error('请输入文本');
    if (new TextEncoder().encode(input).length > MAX_BYTES) throw Error('文件或文本不能超过 100 KB');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(input)) throw Error('文本包含无效字符，请使用 UTF-8 CSV/TSV/TXT');
    const rows = readRows(input.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n'));
    return parseStockRows(rows);
  }
  function parseStockRows(rows, options = {}) {
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw Error('最多解析 ' + MAX_ROWS + ' 行');
    if (rows.some(row => !row || !Number.isSafeInteger(row.line) || row.line < 1 || !Array.isArray(row.cells) || row.cells.some(value => typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(value)))) throw Error('表格含无效单元格或字符');
    const items = [], rejected = [], duplicates = [], seen = new Map(); let entries = 0;
    const headers = rows[0]?.cells.map(x => x.trim().toLowerCase()) || [];
    const codes = headers.flatMap((x, i) => codeHeaders.has(x) ? [i] : []);
    const names = headers.flatMap((x, i) => nameHeaders.has(x) ? [i] : []);
    const table = codes.length > 0 || names.length > 0;
    if (options.requireHeader && !table) throw Error('Excel 需要代码表头；请使用代码、股票代码或 symbol');
    if (table && (codes.length !== 1 || names.length > 1)) throw Error('表格需要唯一的代码列，名称列最多一列');
    function add(value, name, line) {
      if (++entries > MAX_ROWS) throw Error('最多解析 ' + MAX_ROWS + ' 个条目');
      const result = normalizeCode(value);
      if (result.error) { rejected.push({ line, value: value.slice(0, 80), reason: result.error }); return; }
      if (name.length > 80) { rejected.push({ line, value, reason: '名称超过 80 字符' }); return; }
      if (seen.has(result.code)) {
        const prior = seen.get(result.code);
        duplicates.push({ line, code: result.code, firstLine: prior.line, nameConflict: !!name && !!prior.name && name !== prior.name });
        return;
      }
      if (items.length >= MAX_SYMBOLS) throw Error('最多预览 ' + MAX_SYMBOLS + ' 只不同股票，请拆分清单');
      const item = { ...result, name, line, identityVerified: false }; seen.set(result.code, item); items.push(item);
    }
    for (const row of rows.slice(table ? 1 : 0)) {
      if (table) {
        const invalid = [codes[0], ...(names.length ? [names[0]] : [])].map(i => row.invalidCells?.[i]).find(Boolean);
        if (invalid) { rejected.push({ line: row.line, value: '', reason: invalid }); continue; }
        if (!options.sparse && row.cells.length !== headers.length) { rejected.push({ line: row.line, value: '', reason: '列数与表头不一致' }); continue; }
        add(row.cells[codes[0]] || '', names.length ? (row.cells[names[0]] || '').trim() : '', row.line);
      } else {
        // Without headers this is a code list, never a portfolio table: a
        // balance, quantity or name must not silently become a security.
        for (const value of row.cells.flatMap(x => x.split(/[\s，、;；]+/)).filter(Boolean)) add(value, '', row.line);
      }
    }
    return { items, rejected, duplicates, format: table ? 'table' : 'list', identityVerified: false };
  }
  return { parseStockList, parseStockRows, normalizeCode, MAX_BYTES, MAX_ROWS, MAX_SYMBOLS };
});
