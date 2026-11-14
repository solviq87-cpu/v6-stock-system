(function () {
  'use strict';
  const el = id => document.getElementById(id), parser = globalThis.V6StockListParser;
  if (!el('stockListImport') || !parser) return;
  let revision = 0, workbook = null, active = null;
  function node(tag, text) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
  function clear(message = '清单已更改，请重新预览。') {
    revision++; active?.abort(); active = null; el('stockListPreview').replaceChildren(); el('stockListStatus').textContent = message;
  }
  function render(text, preview) {
    const result = preview || parser.parseStockList(text), host = el('stockListPreview'); host.replaceChildren();
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
  function clearWorkbook() {
    workbook = null; el('stockListSheet').replaceChildren(); el('stockListSheetLabel').hidden = true;
  }
  async function importWorkbook() {
    clear();
    const token = el('token')?.value.trim(), file = workbook, current = revision;
    if (!token) { clear('请先填写编辑令牌，再上传解析 Excel。'); return; }
    const controller = new AbortController(); active = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    el('stockListStatus').textContent = '正在上传至当前 V6 服务并解析…';
    const unchanged = () => current === revision && workbook === file && el('token').value.trim() === token;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!unchanged()) return;
      if (controller.signal.aborted) throw Error('解析超时');
      if (bytes.length > 512 * 1024) throw Error('XLSX 文件不能超过 512 KB');
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const response = await fetch('/api/research/import-workbook', { method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ base64: btoa(binary), sheet: el('stockListSheet').value || undefined }) });
      const data = await response.json();
      if (!unchanged()) return;
      if (controller.signal.aborted) throw Error('解析超时');
      if (!response.ok || !data.ok) throw Error(data.locked ? '请先登录并使用有效编辑令牌。' : data.error || 'Excel 解析失败');
      const result = data.result, select = el('stockListSheet'); select.replaceChildren();
      const placeholder = node('option', '请选择工作表'); placeholder.value = ''; select.append(placeholder);
      for (const sheet of result.sheets) {
        const option = node('option', sheet.name + (sheet.available ? '' : '（隐藏，不导入）'));
        option.value = sheet.name; option.disabled = !sheet.available; select.append(option);
      }
      el('stockListSheetLabel').hidden = false; select.value = result.selected || '';
      if (result.preview) render('', result.preview);
      else el('stockListStatus').textContent = '含多个工作表，请选择一个后再点击预览。';
    } catch (error) {
      if (unchanged()) clear(controller.signal.aborted ? 'Excel 解析超时，请重试或缩小文件。' : error instanceof SyntaxError ? 'Excel 服务不可用，请确认连接到 V6 后端。' : error.message);
    } finally { clearTimeout(timer); if (active === controller) active = null; }
  }
  el('stockListSheet').addEventListener('change', () => clear('工作表已更改，请点击预览。'));
  el('stockListText').addEventListener('input', () => { clearWorkbook(); el('stockListFile').value = ''; clear(); });
  el('stockListParse').addEventListener('click', () => {
    if (workbook) return importWorkbook();
    clear(); try { render(el('stockListText').value); } catch (e) { clear(e.message); }
  });
  el('stockListFile').addEventListener('change', async () => {
    clear(); clearWorkbook(); el('stockListText').value = '';
    const file = el('stockListFile').files[0], current = revision;
    if (!file) return;
    try {
      if (/\.xlsx$/i.test(file.name)) {
        if (file.size > 512 * 1024) throw Error('XLSX 文件不能超过 512 KB');
        workbook = file; el('stockListStatus').textContent = '已选择 Excel；点击预览后上传解析，不保存文件。'; return;
      }
      if (!/\.(csv|tsv|txt)$/i.test(file.name)) throw Error('请选择 XLSX 或 UTF-8 CSV/TSV/TXT；旧版 XLS 请另存为 XLSX');
      if (file.size > parser.MAX_BYTES) throw Error('文件不能超过 100 KB');
      const text = await file.text();
      if (revision !== current) return;
      el('stockListText').value = text; render(text);
    } catch (e) { if (revision === current) clear(e.message); }
  });
  function reset() { clearWorkbook(); el('stockListText').value = ''; el('stockListFile').value = ''; clear('清单已清空。'); }
  el('stockListClear').addEventListener('click', reset);
  for (const event of ['input', 'change']) el('token')?.addEventListener(event, reset);
  window.addEventListener('pagehide', reset);
  window.addEventListener('offline', reset);
})();
