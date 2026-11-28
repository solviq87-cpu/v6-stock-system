#!/usr/bin/env python3
"""Read-only FAYO task-ledger checks. Structure is never business acceptance.

Reuses the existing stock-workbook XML guards and resource limits. No Excel,
openpyxl, network, formula execution, workbook edits, or production permissions.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import stat
import subprocess
import sys
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[2]
RELATIVE = 'docs/fayo-professional/deliverables/checklist.xlsx'
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('fayo_existing_workbook', Path(__file__).with_name('stock-workbook.py'))
READER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(READER)
S, RID = READER.S, READER.RID
EXPECTED = {f'F{m:02d}.{i}' for m in range(1, 51) for i in range(1, 7 if m <= 14 else 5)}
MODULES = {f'F{m:02d}' for m in range(1, 51)}
BATCHES = {1: '第一批：市场与选股主链', 2: '第二批：收益研究与组合风控', 3: '第三批：全功能联动与产品验收'}
STATUSES = {'局部证据': 'partial', '待逐项验收': 'awaiting', '完整验收': 'declaredComplete', '完整签收': 'declaredComplete'}
TASK_HEADERS = ['原ID', '模块', '任务', '设计决定', '本模块复用核对起点', '目标触发与消费者', '理由、验收重点及继续条件',
                '本轮状态', '已取得的本轮证据', '实际价值', '用途授权', '现场状态', '主交付批次']
CATALOGS = {'6份合同': {f'G{i:02d}' for i in range(1, 7)}, '36场景': {f'S{i:02d}' for i in range(1, 37)},
            '20条大陆自主运行': {f'CN{i:02d}' for i in range(1, 21)}, '24章最终UI专项': {f'UX{i:02d}' for i in range(1, 25)},
            '原60项来源': {f'{m:02d}.{i}' for m in range(1, 11) for i in range(1, 7)},
            '历史66与78项目录': {f'{i:02d}' for i in range(1, 79)}}
CATALOG_HEADERS = {
    '6份合同': ['ID', '共享架构', '关联范围', '状态'],
    '36场景': ['ID', '情景', '关联模块', '专项复现入口', '场景状态', '关键验收及缺口'],
    '20条大陆自主运行': ['ID', '任务', '当前状态', '验收及限制'],
    '24章最终UI专项': ['ID', '章节', '实施状态', '明确交付及验收'],
    '原60项来源': ['原编号', '原工作方向', '原任务名称或历史改动摘要', '历史验收边界'],
    '历史66与78项目录': ['原78编号', '原后台的任务名称', '双端实际消费', '仍待核对']}
REQUIRED = {'总览', '50模块', '228项专业能力', '最终集成功能映射', '跨专项执行约束', *CATALOGS}


def batch_of(ident):
    number = int(ident[1:3])
    return 1 if number <= 18 else 2 if number <= 37 else 3


def column_name(number):
    text = ''
    while number:
        number, digit = divmod(number - 1, 26)
        text = chr(65 + digit) + text
    return text


def read_sheets(data):
    # Evidence documents contain ordinary hyperlink citations, unlike a stock
    # import. Inspect those locally, never follow them. External data/workbook
    # links remain forbidden; the original stock importer is not changed.
    class Archive:
        def __init__(self):
            self.parts = {}

        def read(self, name):
            return self.parts[name]

        def namelist(self):
            return self.parts.keys()

    archive, document_links = Archive(), 0
    with zipfile.ZipFile(io.BytesIO(data)) as zipped:
        infos = zipped.infolist()
        if len(infos) > 256:
            raise ValueError('ledger-archive-entry-limit')
        total, seen = 0, set()
        for entry in infos:
            name = entry.filename
            if not name or name.startswith('/') or '\\' in name or ':' in name or '\x00' in name or any(p in ('.', '..') for p in name.split('/')) or name.lower() in seen:
                raise ValueError('ledger-archive-path')
            seen.add(name.lower())
            if entry.flag_bits & 1 or stat.S_ISLNK(entry.external_attr >> 16) or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError('ledger-archive-format')
            if any(x in name.lower() for x in ('vbaproject', 'externallinks/', 'embeddings/', 'activex/', 'connections.xml', 'querytables/')):
                raise ValueError('ledger-external-data-or-macro')
            total += entry.file_size
            if entry.file_size > 1024 * 1024 or total > READER.MAX_EXPANDED:
                raise ValueError('ledger-expanded-size-limit')
            if not entry.is_dir():
                archive.parts[name] = zipped.read(entry)  # Verifies raw ZIP CRC.
                if len(archive.parts[name]) != entry.file_size:
                    raise ValueError('ledger-archive-size-mismatch')
        for name, content in archive.parts.items():
            if not name.endswith('.rels'):
                continue
            relations = READER.xml(content)
            if relations.tag != READER.R + 'Relationships':
                raise ValueError('ledger-relationship-format')
            for relation in relations:
                if relation.get('TargetMode', '').lower() != 'external':
                    continue
                if relation.get('Type') != 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink':
                    raise ValueError('ledger-external-data-relationship')
                target = relation.get('Target', '')
                url = urlsplit(target)
                if re.search(r'[\x00-\x20\x7f]', target) or url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
                    raise ValueError('ledger-document-hyperlink-format')
                document_links += 1
    types = READER.xml(archive.read('[Content_Types].xml'))
    main_types = [n.get('ContentType') for n in types if n.get('PartName') == '/xl/workbook.xml']
    if main_types != ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml']:
        raise ValueError('ledger-workbook-content-type')
    workbook = READER.xml(archive.read('xl/workbook.xml'))
    if workbook.tag != S + 'workbook':
        raise ValueError('ledger-workbook-schema')
    relations = READER.xml(archive.read('xl/_rels/workbook.xml.rels'))
    targets = {}
    for relation in relations:
        ident = relation.get('Id')
        if not ident or ident in targets:
            raise ValueError('ledger-duplicate-relationship')
        target = relation.get('Target', '').removeprefix('/xl/').removeprefix('./')
        if relation.get('Type', '').endswith('/worksheet') and (not re.fullmatch(r'worksheets/[A-Za-z0-9_.-]+\.xml', target) or 'xl/' + target not in archive.parts):
            raise ValueError('ledger-worksheet-reference')
        targets[ident] = 'xl/' + target
    shared = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        shared = [READER.rich_text(n) for n in READER.xml(archive.read('xl/sharedStrings.xml')).findall(S + 'si')]
    if len(shared) > 10000:
        raise ValueError('ledger-shared-strings-limit')
    sheets = {}
    nodes = workbook.findall(S + 'sheets/' + S + 'sheet')
    if not 1 <= len(nodes) <= 32 or len({n.get('name') for n in nodes}) != len(nodes):
        raise ValueError('ledger-workbook-sheets')
    for node in nodes:
        name = node.get('name')
        if name not in REQUIRED:
            continue
        if node.get('state', 'visible') != 'visible':
            raise ValueError('required-ledger-sheet-hidden')
        tree = READER.xml(archive.read(targets[node.get(RID)]))
        if tree.tag != S + 'worksheet' or tree.find(S + 'mergeCells') is not None:
            raise ValueError('ledger-sheet-layout')
        rows, refs, last_row, max_column = {}, set(), 0, 0
        for row in tree.findall(S + 'sheetData/' + S + 'row'):
            line = int(row.get('r', '0'))
            if line <= last_row or line > 1000:
                raise ValueError('ledger-row-coordinates')
            last_row = line
            values = {}
            for cell in row.findall(S + 'c'):
                ref = cell.get('r', '')
                match = re.fullmatch(r'([A-Z]{1,2})([1-9][0-9]*)', ref)
                if not match or int(match[2]) != line or ref in refs:
                    raise ValueError('ledger-cell-coordinates')
                refs.add(ref)
                col = 0
                for char in match[1]:
                    col = col * 26 + ord(char) - 64
                if col > 64:
                    raise ValueError('ledger-column-limit')
                if cell.find(S + 'f') is not None:
                    raise ValueError('ledger-formula-not-evaluated')
                kind, value = cell.get('t', 'n'), cell.findtext(S + 'v', '')
                if kind == 's':
                    if not re.fullmatch(r'[0-9]+', value) or int(value) >= len(shared):
                        raise ValueError('ledger-shared-string-reference')
                    value = shared[int(value)]
                elif kind == 'inlineStr':
                    value = READER.rich_text(cell.find(S + 'is'))
                elif kind == 'n':
                    if value and not re.fullmatch(r'-?(0|[1-9][0-9]*)', value):
                        raise ValueError('ledger-integer-cell-required')
                    value = int(value) if value else ''
                else:
                    raise ValueError('ledger-cell-type')
                if isinstance(value, str) and len(value) > 4096:
                    raise ValueError('ledger-cell-text-limit')
                if value != '':
                    values[col] = value
                    max_column = max(max_column, col)
            if values:
                rows[line] = values
        if not rows or min(rows) != 1:
            raise ValueError('ledger-header-missing')
        actual = f'A1:{column_name(max_column)}{max(rows)}'
        declared = tree.find(S + 'dimension')
        auto_filter = tree.find(S + 'autoFilter')
        sheets[name] = {'rows': rows, 'actualRange': actual,
                        'declaredRange': declared.get('ref') if declared is not None else None,
                        'filterRange': auto_filter.get('ref') if auto_filter is not None else None}
    return sheets, document_links


def validate(data):
    errors = []

    def issue(code, sheet=None, row=None):
        # No raw cell text or parser exception payloads in diagnostics.
        errors.append({k: v for k, v in {'code': code, 'sheet': sheet, 'row': row}.items() if v is not None})

    sheets, document_links = read_sheets(data)
    for missing in sorted(REQUIRED - sheets.keys()):
        issue('required-sheet-missing', missing)
    if errors:
        return {'errors': errors, 'counts': None}
    for name, sheet in sheets.items():
        if sheet['filterRange'] != sheet['actualRange']:
            issue('filter-does-not-cover-populated-cells', name)
        if sheet['declaredRange'] != sheet['actualRange']:
            issue('dimension-does-not-match-populated-cells', name)

    def records(name, headers=None):
        sheet = sheets[name]
        first = sheet['rows'][1]
        titles = list(first.values())
        if len(titles) != len(set(titles)):
            issue('duplicate-column-header', name)
        if headers and (set(headers) - set(titles)):
            issue('required-column-missing', name)
            return []
        if any(col not in first for line, cells in sheet['rows'].items() if line > 1 for col in cells):
            issue('data-without-column-header', name)
        return [(line, {first.get(col): value for col, value in cells.items() if col in first}) for line, cells in sheet['rows'].items() if line > 1]

    task_rows = records('228项专业能力', TASK_HEADERS)
    ids = [r.get('原ID') for _, r in task_rows]
    if len(ids) != 228 or set(ids) != EXPECTED or len(set(ids)) != len(ids):
        issue('task-ids-missing-duplicate-or-unknown', '228项专业能力')
    totals, module_counts, phase_counts, task_statuses = Counter(), {}, {n: Counter() for n in BATCHES}, {}
    for line, row in task_rows:
        ident, status = row.get('原ID'), row.get('本轮状态')
        if ident not in EXPECTED:
            continue
        if status not in STATUSES:
            issue('task-status-unknown', '228项专业能力', line)
            continue
        for field in TASK_HEADERS:
            if row.get(field) is None or row.get(field) == '':
                issue('required-task-field-empty', '228项专业能力', line)
                break
        category, module, phase = STATUSES[status], ident.split('.')[0], batch_of(ident)
        task_statuses[ident] = category
        totals[category] += 1
        module_counts.setdefault(module, Counter())[category] += 1
        phase_counts[phase][category] += 1
        if row.get('主交付批次') != BATCHES[phase]:
            issue('task-delivery-batch-mismatch', '228项专业能力', line)
    module_rows = records('50模块', ['模块', '名称', '任务数', '完整验收', '局部证据', '待逐项验收', '主交付批次'])
    mids = [r.get('模块') for _, r in module_rows]
    if len(mids) != 50 or set(mids) != MODULES or len(set(mids)) != len(mids):
        issue('module-ids-missing-duplicate-or-unknown', '50模块')
    module_names = {r.get('模块'): r.get('名称') for _, r in module_rows}
    for line, row in module_rows:
        ident = row.get('模块')
        if ident not in MODULES:
            continue
        number = int(ident[1:]);counts = module_counts.get(ident, Counter())
        expected = {'任务数': 6 if number <= 14 else 4, '完整验收': counts['declaredComplete'], '局部证据': counts['partial'], '待逐项验收': counts['awaiting']}
        if any(type(row.get(k)) is not int or row[k] != v for k, v in expected.items()):
            issue('module-counts-do-not-match-task-rows', '50模块', line)
        if row.get('主交付批次') != BATCHES[batch_of(ident + '.1')]:
            issue('module-delivery-batch-mismatch', '50模块', line)
    for line, row in task_rows:
        ident = row.get('原ID')
        if ident in EXPECTED and row.get('模块') != module_names.get(ident.split('.')[0]):
            issue('task-module-name-mismatch', '228项专业能力', line)
    overview = records('总览', ['范围', '规模', '核查状态', '使用说明'])

    def check_summary(label, expected, total=None):
        matches = [(line, r) for line, r in overview if r.get('范围') == label]
        if len(matches) != 1:
            issue('summary-row-missing-or-duplicate', '总览')
            return
        line, row = matches[0]
        text = row.get('核查状态', '')
        for word, key in [('完整签收', 'declaredComplete'), ('局部证据', 'partial'), ('待逐项验收', 'awaiting')]:
            found = re.findall(re.escape(word) + r'\s*([0-9]+)', text) if isinstance(text, str) else []
            if len(found) != 1 or int(found[0]) != expected[key]:
                issue('summary-counts-do-not-match-task-rows', '总览', line)
                break
        if total is not None:
            found = re.findall(r'([0-9]+)项', str(row.get('规模', '')))
            if found != [str(total)]:
                issue('summary-batch-size-mismatch', '总览', line)

    check_summary('专业能力', totals)
    professional = [r for _, r in overview if r.get('范围') == '专业能力']
    if len(professional) == 1 and not re.fullmatch(r'\s*50\s*模块\s*/\s*228\s*项\s*', str(professional[0].get('规模', ''))):
        issue('professional-scope-size-mismatch', '总览')
    for number, title in BATCHES.items():
        check_summary(title, phase_counts[number], [100, 76, 52][number - 1])
    catalogs = {}
    for name, wanted in CATALOGS.items():
        records(name, CATALOG_HEADERS[name])
        values = [cells.get(1) for line, cells in sheets[name]['rows'].items() if line > 1]
        if len(values) != len(wanted) or set(values) != wanted or len(set(values)) != len(values):
            issue('catalog-ids-missing-duplicate-or-unknown', name)
        catalogs[name] = len(values)
    discipline = records('跨专项执行约束', ['原指令章节', '实施约定', '验收证据'])
    chapters = {int(value) for _, row in discipline for value in re.findall(r'[0-9]+', str(row.get('原指令章节', '')))}
    if chapters != set(range(1, 25)):
        issue('efficiency-chapters-missing-or-unknown', '跨专项执行约束')
    records('最终集成功能映射', ['原任务来源 / ID', '功能与证券范围', '主代码与版本', '后台数据来源及原时点', 'PC入口', '手机入口',
                               '操作权限', '实际业务消费者', '运行与消费回执', '验证层级与结论', '责任 / 阻塞 / 回退'])
    for line, cells in sheets['最终集成功能映射']['rows'].items():
        if line == 1:
            continue
        for ident in re.findall(r'(?<![A-Za-z0-9])F[0-9]{2}(?:\.[0-9]+)*', str(cells.get(1, ''))):
            if ident not in EXPECTED and ident not in MODULES:
                issue('consumer-task-reference-unknown', '最终集成功能映射', line)
    return {'errors': errors, 'counts': {'tasks': len(ids), 'modules': len(mids), 'statuses': dict(totals),
            'byModule': {ident: dict(counts) for ident, counts in module_counts.items()},
            'batches': [{'batch': n, 'taskCount': sum(phase_counts[n].values()), 'statuses': dict(phase_counts[n])} for n in BATCHES],
            'catalogRecords': catalogs, 'efficiencyChapters': len(chapters)}, 'taskStatuses': task_statuses,
            'documentHyperlinksIgnored': document_links,
            'worksheetRanges': {n: s['actualRange'] for n, s in sheets.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook', type=Path, default=ROOT / RELATIVE)
    parser.add_argument('--repo', type=Path, default=ROOT)
    parser.add_argument('--expect-sha')
    parser.add_argument('--strict', action='store_true', help='fail closed: business acceptance is not verified by this structural tool')
    args = parser.parse_args()
    report = {'schemaVersion': 1, 'mode': 'fayo-ledger-structure-check', 'structurePassed': False,
              'releaseReady': False, 'businessAcceptanceVerified': False, 'managerSignoffVerified': False,
              'historicalOriginalTextsVerified': False, 'readOnly': True}
    try:
        with args.workbook.open('rb') as file:
            data = file.read(READER.MAX_FILE + 1)
        if len(data) > READER.MAX_FILE:
            raise ValueError('ledger-file-size-limit')
        report['workbookSha256'] = hashlib.sha256(data).hexdigest()
        validator = Path(__file__).resolve()
        xml_guard = validator.with_name('stock-workbook.py')
        report['validatorSha256'] = hashlib.sha256(validator.read_bytes()).hexdigest()
        report['existingXmlGuardSha256'] = hashlib.sha256(xml_guard.read_bytes()).hexdigest()
        report.update(validate(data))
        def git(*command):
            try:
                return subprocess.run(['git', '-c', 'core.quotepath=false', '-C', str(args.repo), *command], capture_output=True, timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                return None
        head = git('rev-parse', 'HEAD')
        report['repositoryHead'] = head.stdout.decode('ascii').strip() if head is not None and head.returncode == 0 else None
        top = git('rev-parse', '--show-toplevel') if report['repositoryHead'] else None
        repository_root = Path(top.stdout.decode('utf-8').rstrip('\r\n')).resolve() if top is not None and top.returncode == 0 else None
        report['repositoryIdentityResolved'] = repository_root is not None

        def matches_commit(path, content):
            if not report['repositoryHead'] or repository_root is None:
                return False
            try:
                relative = path.resolve().relative_to(repository_root).as_posix()
            except ValueError:
                return False
            blob = git('show', report['repositoryHead'] + ':' + relative)
            return blob is not None and blob.returncode == 0 and blob.stdout == content

        report['workbookMatchesRepositoryCommit'] = matches_commit(args.workbook, data)
        report['validatorMatchesRepositoryCommit'] = matches_commit(validator, validator.read_bytes())
        report['xmlGuardMatchesRepositoryCommit'] = matches_commit(xml_guard, xml_guard.read_bytes())
        report['versionBound'] = all(report[k] for k in ['workbookMatchesRepositoryCommit', 'validatorMatchesRepositoryCommit', 'xmlGuardMatchesRepositoryCommit'])
        if args.expect_sha is not None and (not re.fullmatch(r'[a-f0-9]{40}', args.expect_sha) or args.expect_sha != report['repositoryHead'] or not report['versionBound']):
            report['errors'].append({'code': 'expected-commit-or-workbook-mismatch'})
        report['structurePassed'] = not report['errors']
    except Exception as error:
        known = str(error) if isinstance(error, ValueError) and re.fullmatch(r'ledger-[a-z-]+|required-ledger-sheet-hidden', str(error)) else 'invalid-or-unavailable-workbook'
        report['errors'] = [{'code': known}]
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 1 if not report['structurePassed'] else 2 if args.strict else 0


if __name__ == '__main__':
    sys.exit(main())
