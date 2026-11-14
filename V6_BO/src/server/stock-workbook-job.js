'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const { parseStockRows } = require('../../public/assets/stock-list-parser');
const MAX_FILE = 512 * 1024, MAX_REQUEST = 710000;
let active = false;
function runStockWorkbookJob(payload) {
  if (!payload || typeof payload.base64 !== 'string' || payload.base64.length > Math.ceil(MAX_FILE / 3) * 4
    || !payload.base64.length || payload.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64)
    || (payload.sheet != null && (typeof payload.sheet !== 'string' || payload.sheet.length > 80))) {
    return Promise.resolve({ ok: false, error: 'XLSX 输入无效或超过 512 KB' });
  }
  if (active) return Promise.resolve({ ok: false, error: '正在解析其他工作簿，请稍后重试' });
  active = true;
  return new Promise(resolve => {
    let child, timer, output = '', bytes = 0, failure = null, done = false;
    const finish = result => { if (done) return; done = true; clearTimeout(timer); active = false; resolve(result); };
    const stop = error => { failure = error; child?.kill('SIGKILL'); };
    try {
      child = spawn(process.env.V6_MODEL_PYTHON || 'python3', ['-I', '-B', path.resolve(__dirname, '../../scripts/stock-workbook.py')], {
        stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
        env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }
      });
      timer = setTimeout(() => stop('解析超过 5 秒，请缩小工作簿'), 5000);
      child.stdin.on('error', () => {});
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 2 * 1024 * 1024) return stop('工作簿内容超过限制');
        output += chunk;
      });
      child.once('error', () => { failure = '无法启动 Excel 解析；请确认服务已安装 Python 3.9 以上版本'; });
      child.once('close', code => {
        if (failure || code !== 0) return finish({ ok: false, error: failure || '工作簿解析失败' });
        try {
          const parsed = JSON.parse(output);
          if (!parsed.ok) return finish({ ok: false, error: parsed.error });
          const { sheets, selected, rows } = parsed.result;
          // Never expose other portfolio columns or the original workbook.
          const preview = selected === null ? null : parseStockRows(rows, { requireHeader: true, sparse: true });
          finish({ ok: true, result: { sheets, selected, preview, canTrade: false, persisted: false } });
        } catch (error) { finish({ ok: false, error: error instanceof SyntaxError ? '工作簿解析失败' : error.message }); }
      });
      child.stdin.end(JSON.stringify({ base64: payload.base64, sheet: payload.sheet }));
    } catch { finish({ ok: false, error: '无法启动 Excel 解析' }); }
  });
}
module.exports = { runStockWorkbookJob, MAX_FILE, MAX_REQUEST };
