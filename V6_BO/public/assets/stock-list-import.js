(function () {
  'use strict';
  const el = id => document.getElementById(id), parser = globalThis.V6StockListParser;
  if (!el('stockListImport') || !parser) return;
  let revision = 0;
  function node(tag, text) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
  function clear(message = '清单已更改，请重新预览。') {
    revision++; el('stockListPreview').replaceChildren(); el('stockListStatus').textContent = message;
  }
  function render(text) {
    const result = parser.parseStockList(text), host = el('stockListPreview'); host.replaceChildren();
    el('stockListStatus').textContent = result.items.length + ' 只待核验 · ' + result.duplicates.length + ' 条重复 · ' + result.rejected.length + ' 条未识别';
    for (const item of result.items) {
      const row = node('div'); row.className = 'stock-import-row';
      row.append(node('span', item.code + ' · ' + item.exchange + (item.name ? ' · ' + item.name + '（导入名称）' : '')));
      const choose = node('button', '选择研究'); choose.type = 'button';
      choose.setAttribute('aria-label', '选择研究 ' + item.code);
      const current = revision;
      choose.addEventListener('click', () => {
        if (current !== revision) return;
        const input = el('captureSymbol'); input.value = item.code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        el('captureStatus').textContent = '已选择 ' + item.code + '；请点击采集并研究或读取已存历史。';
        input.focus();
      });
      row.append(choose); host.append(row);
    }
    if (result.rejected.length || result.duplicates.length) {
      const details = node('details'); details.append(node('summary', '查看未识别与重复项'));
      for (const r of result.rejected) details.append(node('p', '第 ' + r.line + ' 行 · ' + r.value + '：' + r.reason));
      for (const r of result.duplicates) details.append(node('p', '第 ' + r.line + ' 行 · ' + r.code + ' 与第 ' + r.firstLine + ' 行重复' + (r.nameConflict ? '；导入名称冲突，请核验' : '')));
      host.append(details);
    }
  }
  el('stockListText').addEventListener('input', () => { el('stockListFile').value = ''; clear(); });
  el('stockListParse').addEventListener('click', () => {
    clear(); try { render(el('stockListText').value); } catch (e) { clear(e.message); }
  });
  el('stockListFile').addEventListener('change', async () => {
    clear(); el('stockListText').value = '';
    const file = el('stockListFile').files[0], current = revision;
    if (!file) return;
    try {
      if (!/\.(csv|tsv|txt)$/i.test(file.name)) throw Error('请选择 UTF-8 CSV/TSV/TXT；Excel 请复制表格或另存为 CSV UTF-8');
      if (file.size > parser.MAX_BYTES) throw Error('文件不能超过 100 KB');
      const text = await file.text();
      if (revision !== current) return;
      el('stockListText').value = text; render(text);
    } catch (e) { if (revision === current) clear(e.message); }
  });
  function reset() { el('stockListText').value = ''; el('stockListFile').value = ''; clear('清单已清空。'); }
  el('stockListClear').addEventListener('click', reset);
  for (const event of ['input', 'change']) el('token')?.addEventListener(event, reset);
  window.addEventListener('pagehide', reset);
  window.addEventListener('offline', reset);
})();
