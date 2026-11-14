'use strict';
const { spawnSync } = require('node:child_process');
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function sheet(rows) {
  return `<worksheet xmlns="${ns}"><sheetData>` + rows.map((row, i) => `<row r="${i + 1}">` + row.map((value, j) => {
    const ref = String.fromCharCode(65 + j) + (i + 1);
    if (typeof value === 'object') return `<c r="${ref}" ${value.attrs || ''}>${value.xml || ''}</c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
  }).join('') + '</row>').join('') + '</sheetData></worksheet>';
}
function workbook({ sheets = [{ name: '股票', rows: [['代码', '名称'], ['000001', '测试甲']] }], entries = {}, extra = [], compress = false } = {}) {
  const parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` + sheets.map((s, i) => `<sheet name="${escape(s.name)}" sheetId="${i + 1}" r:id="r${i}"${s.hidden ? ' state="hidden"' : ''}/>`).join('') + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="r${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>',
    ...Object.fromEntries(sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.xml || sheet(s.rows)])), ...entries
  };
  const r = spawnSync(process.env.V6_MODEL_PYTHON || 'python3', ['-I', '-B', '-c',
    'import io,json,sys,zipfile\np=json.load(sys.stdin);b=io.BytesIO()\nwith zipfile.ZipFile(b,"w",compression=zipfile.ZIP_DEFLATED if p["compress"] else zipfile.ZIP_STORED) as z:\n for k,v in p["parts"]: z.writestr(k,v)\nsys.stdout.buffer.write(b.getvalue())'],
    { input: JSON.stringify({ parts: [...Object.entries(parts), ...extra], compress }), maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) throw Error('fixture generation failed');
  return r.stdout;
}
module.exports = { workbook, sheet, ns };
