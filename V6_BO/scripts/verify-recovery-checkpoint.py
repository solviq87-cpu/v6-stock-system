#!/usr/bin/env python3
"""验证恢复检查点的核心文件完整性；在 v6_release 目录执行。"""
import json,hashlib,pathlib,sys
root=pathlib.Path(__file__).resolve().parent.parent
manifest=json.loads((root/'docs/V6_恢复检查点.json').read_text(encoding='utf-8'))
errors=[]
for name,expected in manifest['code_sha256'].items():
    rel=name.removeprefix('v6_release/')
    p=root/rel
    actual=hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else 'MISSING'
    if actual!=expected:errors.append(rel)
print('恢复检查点:',manifest['checkpoint'])
print('核心文件校验:', '通过' if not errors else '失败 '+','.join(errors))
print('下一步:',manifest['next_priority'][0])
sys.exit(bool(errors))
