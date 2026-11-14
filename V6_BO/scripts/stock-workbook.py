#!/usr/bin/env python3
"""Bounded, memory-only XLSX projection. No formula evaluation or external I/O.

Only ordinary transitional OOXML workbooks are supported. The JS list parser
remains the authority for security identities and de-duplication.
"""
import base64
import io
import json
import re
import stat
import sys
import zipfile
import xml.etree.ElementTree as ET

MAX_FILE = 512 * 1024
MAX_EXPANDED = 3 * 1024 * 1024
S = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/package/2006/relationships}'
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


class WorkbookError(ValueError):
    pass


def fail(message):
    raise WorkbookError(message)


def xml(data):
    text = data.decode('utf-8-sig')
    if '\x00' in text or re.search(r'<!\s*(DOCTYPE|ENTITY)', text, re.I):
        fail('不支持 DTD 或实体声明')
    if re.search(r'encoding\s*=\s*[\"\'](?!utf-8[\"\'])', text, re.I):
        fail('工作簿 XML 必须使用 UTF-8')
    root = ET.fromstring(text)
    stack, count = [(root, 1)], 0
    while stack:
        node, depth = stack.pop()
        count += 1
        if depth > 32 or count > 100000:
            fail('工作簿 XML 结构超过限制')
        stack.extend((child, depth + 1) for child in node)
    return root


def rich_text(element):
    if element is None:
        return ''
    # Phonetic annotations are not part of a stock name/code.
    value = ''.join(n.text or '' for n in element.findall(S + 't'))
    value += ''.join(n.text or '' for n in element.findall(S + 'r/' + S + 't'))
    if len(value) > 4096:
        fail('单元格文本超过限制')
    return value


def parse(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('base64'), str):
        fail('需要 XLSX 文件内容')
    encoded = payload['base64']
    if len(encoded) > ((MAX_FILE + 2) // 3) * 4:
        fail('XLSX 文件不能超过 512 KB')
    data = base64.b64decode(encoded, validate=True)
    if len(data) > MAX_FILE or not data.startswith(b'PK\x03\x04'):
        fail('文件不是受支持的 XLSX')
    selected = payload.get('sheet')
    if selected is not None and (not isinstance(selected, str) or len(selected) > 80):
        fail('工作表选择无效')
    archive = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        entries = z.infolist()
        if len(entries) > 256:
            fail('工作簿文件数量超过限制')
        total, names = 0, set()
        for entry in entries:
            name = entry.filename
            if (not name or name.startswith('/') or '\\' in name or ':' in name
                    or any(p in ('..', '.') for p in name.split('/'))
                    or name.lower() in names or '\x00' in name):
                fail('工作簿路径或重复文件无效')
            names.add(name.lower())
            if (entry.flag_bits & 1 or stat.S_ISLNK(entry.external_attr >> 16)
                    or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                fail('不支持加密或特殊压缩文件')
            if any(v in name.lower() for v in ('vbaproject', 'externallinks/', 'embeddings/', 'activex/')):
                fail('不支持宏、外部链接或嵌入对象')
            total += entry.file_size
            if entry.file_size > 1024 * 1024 or total > MAX_EXPANDED:
                fail('工作簿解压大小超过限制')
            if entry.is_dir():
                continue
            content = z.read(entry)  # zipfile also checks CRC and actual sizes.
            if len(content) != entry.file_size:
                fail('工作簿大小校验失败')
            archive[name] = content
    for name, content in archive.items():
        if name.endswith('.rels'):
            relations = xml(content)
            if relations.tag != R + 'Relationships':
                fail('工作簿关系格式无效')
            if any(n.get('TargetMode', '').lower() == 'external' for n in relations):
                fail('不支持外部链接')
    types = xml(archive.get('[Content_Types].xml', b''))
    workbook_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
    if not any(n.get('PartName') == '/xl/workbook.xml' and n.get('ContentType') == workbook_type for n in types):
        fail('仅支持普通 XLSX 工作簿，请移除宏或转换格式')
    workbook = xml(archive.get('xl/workbook.xml', b''))
    if workbook.tag != S + 'workbook':
        fail('不支持此工作簿版本')
    relations, targets = xml(archive.get('xl/_rels/workbook.xml.rels', b'')), {}
    for n in relations:
        ident, target = n.get('Id'), n.get('Target', '')
        if not ident or ident in targets:
            fail('工作簿关系标识重复或缺失')
        targets[ident] = (target, n.get('Type', ''))
    sheets, paths, sheet_names = [], {}, set()
    for sheet in workbook.findall(S + 'sheets/' + S + 'sheet'):
        name = sheet.get('name', '')
        if not name or len(name) > 80 or name in sheet_names:
            fail('工作表名称重复或无效')
        sheet_names.add(name)
        target, kind = targets.get(sheet.get(RID), ('', ''))
        target = target.removeprefix('/xl/').removeprefix('./')
        if (not re.fullmatch(r'worksheets/[A-Za-z0-9_.-]+\.xml', target)
                or not kind.endswith('/worksheet') or 'xl/' + target not in archive):
            fail('工作表引用无效')
        visible = sheet.get('state', 'visible') == 'visible'
        sheets.append({'name': name, 'available': visible})
        paths[name] = 'xl/' + target
    if not sheets or len(sheets) > 32:
        fail('工作表数量必须为 1 至 32')
    visible = [s['name'] for s in sheets if s['available']]
    if not visible:
        fail('没有可导入的可见工作表')
    if selected is None and len(visible) == 1:
        selected = visible[0]
    if selected is None:
        return {'sheets': sheets, 'selected': None, 'rows': []}
    if selected not in visible:
        fail('请选择可见工作表')
    shared = []
    if 'xl/sharedStrings.xml' in archive:
        shared = [rich_text(n) for n in xml(archive['xl/sharedStrings.xml']).findall(S + 'si')]
        if len(shared) > 10000:
            fail('共享文本数量超过限制')
    worksheet = xml(archive[paths[selected]])
    if worksheet.tag != S + 'worksheet' or worksheet.find(S + 'mergeCells') is not None:
        fail('不支持合并单元格，请转换成普通代码表格')
    rows, last_line = [], 0
    for row in worksheet.findall(S + 'sheetData/' + S + 'row'):
        line = int(row.get('r', '0'))
        if line <= last_line or line > 1000:
            fail('工作表行号无效或超过 1000 行')
        last_line = line
        cells, invalid, seen = {}, {}, set()
        for cell in row.findall(S + 'c'):
            ref = re.fullmatch(r'([A-Z]{1,2})([1-9][0-9]*)', cell.get('r', ''))
            if not ref or int(ref[2]) != line:
                fail('单元格坐标无效')
            col = 0
            for char in ref[1]:
                col = col * 26 + ord(char) - 64
            col -= 1
            if col >= 64 or col in seen:
                fail('最多支持 64 列且坐标不能重复')
            seen.add(col)
            value, kind = cell.findtext(S + 'v', ''), cell.get('t', 'n')
            reason = None
            if cell.find(S + 'f') is not None:
                reason = '公式及其缓存结果不作为代码或名称，请粘贴为文本值'
            elif kind == 's':
                if not re.fullmatch(r'[0-9]+', value) or int(value) >= len(shared):
                    fail('共享文本引用无效')
                value = shared[int(value)]
            elif kind == 'inlineStr':
                value = rich_text(cell.find(S + 'is'))
            elif kind == 'n':
                if value and (cell.get('s', '0') != '0' or not re.fullmatch(r'[0-9]{6}', value)):
                    reason = '带格式数字、日期或不足六位代码不自动转换，请将代码设为文本'
            else:
                reason = '不支持该单元格类型，请将代码和名称设为文本'
            if len(value) > 4096:
                fail('单元格文本超过限制')
            cells[col] = '' if reason else value
            if reason:
                invalid[str(col)] = reason
        if cells and (any(cells.values()) or invalid):
            rows.append({'line': line, 'cells': [cells.get(i, '') for i in range(max(cells) + 1)], 'invalidCells': invalid})
    return {'sheets': sheets, 'selected': selected, 'rows': rows}


def main():
    try:
        raw = sys.stdin.buffer.read(710000)
        if len(raw) >= 710000:
            fail('请求超过限制')
        result = parse(json.loads(raw))
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=False))
    except WorkbookError as error:
        # Only our explicit validation messages; parser exceptions can contain data.
        message = str(error)
        print(json.dumps({'ok': False, 'error': message}, ensure_ascii=False))
    except Exception:
        print(json.dumps({'ok': False, 'error': '工作簿格式无效或已损坏'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
