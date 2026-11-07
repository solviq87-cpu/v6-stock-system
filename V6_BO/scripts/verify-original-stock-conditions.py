#!/usr/bin/env python3
"""Check protected stock-selection files against recovered 43-version baseline."""
import hashlib,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[1]
m=json.loads((root/'docs/V6_原选股条件保护清单.json').read_text(encoding='utf-8'))
errors=[]
for name,expected in m['protected_files'].items():
    rel=name.removeprefix('v6_release/')
    p=root/rel
    if not p.is_file(): errors.append('MISSING '+rel)
    elif hashlib.sha256(p.read_bytes()).hexdigest()!=expected: errors.append('CHANGED '+rel)
print('Protected stock-selection files:',len(m['protected_files']))
if errors:
    print('\n'.join(errors));sys.exit(1)
print('PASS: all original protected files unchanged')
