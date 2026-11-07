# -*- coding: utf-8 -*-
"""
一次性数据修复：把 2026-09-28 那次「优化错了」留下的污染清掉。

三件事：
 1) 去重：1973 条里 1007 条是「同类型+同代码+同日期」重复登记（占 51%）
 2) 回填 beta：把 9/28 实测指数涨跌写进 marketBeta.json，让历史这一天有客观基准
 3) 回滚：把当天被错杀的参数退回合理起点（由 server.js 按新口径重算，这里只负责把值放回去）
"""
import json, io, os, sys, shutil, datetime

sys.stdout.reconfigure(encoding='utf-8')
BASE = os.path.dirname(os.path.abspath(__file__))
STATS = os.path.join(BASE, 'stats.json')
MB = os.path.join(BASE, 'marketBeta.json')
BACKUP = STATS + '.bak_fix0928'

# 2026-09-28 实测（用户提醒时取的腾讯实时行情）
BETA_20260928 = round((-1.67 + -3.44 + -4.53) / 3, 2)

def norm(d):
    s = ''.join(ch for ch in str(d or '') if ch.isdigit())
    return f'{s[:4]}-{s[4:6]}-{s[6:8]}' if len(s) == 8 else str(d or '')

# ---------- 备份 ----------
if not os.path.exists(BACKUP):
    shutil.copy2(STATS, BACKUP)
    print('已备份 stats.json →', os.path.basename(BACKUP))

d = json.load(io.open(STATS, encoding='utf-8'))
sig = d.get('signals', [])
before = len(sig)

# ---------- 1) 去重：同类+同码+同日 只留一条 ----------
# 保留策略：已回验(resolved)的优先于未回验的；同类中保留信息最全（prob/score 有值、paths 最多）的那条
groups = {}
order = []
for i, s in enumerate(sig):
    k = (s.get('type'), s.get('code'), norm(s.get('date')))
    if k not in groups:
        groups[k] = []
        order.append(k)
    groups[k].append(s)

def score(s):
    return (
        1 if s.get('resolved') else 0,
        1 if s.get('prob') is not None else 0,
        1 if s.get('score') is not None else 0,
        len(s.get('paths') or []),
        s.get('ts') or 0,
    )

kept = []
merged_paths = 0
for k in order:
    lst = sorted(groups[k], key=score, reverse=True)
    win = lst[0]
    if len(lst) > 1:
        ps = set(win.get('paths') or [])
        for o in lst[1:]:
            ps |= set(o.get('paths') or [])
            # 若赢家未回验而某条重复的已回验 —— 把回验结果继承过来（宝贵的证据）
            if not win.get('resolved') and o.get('resolved'):
                win['resolved'] = o['resolved']
            if win.get('prob') is None and o.get('prob') is not None:
                win['prob'] = o['prob']
        if len(ps) > len(win.get('paths') or []):
            merged_paths += 1
        win['paths'] = sorted(ps)
    kept.append(win)

kept.sort(key=lambda s: s.get('ts') or 0)
d['signals'] = kept
print(f'去重：{before} → {len(kept)} 条（去掉 {before - len(kept)} 条重复，合并因子 {merged_paths} 条）')

def rate(items):
    r = [x for x in items if x.get('resolved')]
    if not r:
        return 0, 0, 0
    return len(r), sum(1 for x in r if x['resolved'].get('hit')), round(sum(1 for x in r if x['resolved'].get('hit')) / len(r) * 100)

print('整体命中率：去重大前 %s → 去重后 %s' % (rate(sig), rate(kept)))

# ---------- 2) 回填 beta ----------
mb = {}
if os.path.exists(MB):
    try:
        mb = json.load(io.open(MB, encoding='utf-8'))
    except Exception:
        mb = {}
mb['2026-09-28'] = BETA_20260928
json.dump(mb, io.open(MB, 'w', encoding='utf-8'), ensure_ascii=False)
print(f"回填 beta：2026-09-28 = {BETA_20260928}%（上证-1.67 / 深证-3.44 / 创业板-4.53 的均值）")

# ---------- 3) 回滚被错杀的参数 ----------
# 这些值是 9/28 一天 n=1 样本推出来的，证据不成立 → 退回起点，交给新口径重新攒证据
ROLLBACK = [
    ('scoreThreshold', 85, 75, '推送评分线：由单日样本顶到 85，退回默认 75'),
]
for key, cur, back, why in ROLLBACK:
    old = d.get(key)
    d[key] = back
    print(f'  回滚 {key}: {old} → {back}   ({why})')

# paths / buckets 里的负 adj 与 corr<1：清空，由 server.js 按「≥5交易日」新口径重算
npath = 0
for p, v in (d.get('paths') or {}).items():
    if v.get('adj') not in (0, None):
        print(f'  清除条件 {p}: adj {v.get("adj")} → 0（原依据仅 {len(set(norm(s.get("date")) for s in sig if p in (s.get("paths") or [])))} 个交易日）')
        v['adj'] = 0
        v['verdict'] = '重算中·等待多交易日证据'
        npath += 1
nbk = 0
for b, v in (d.get('buckets') or {}).items():
    if v.get('corr') is not None and v['corr'] != 1:
        print(f'  清除分桶 {b}: corr {v.get("corr")} → 1（原依据样本集中在单一交易日）')
        v['corr'] = 1
        v['locked'] = '等待多交易日证据·暂不校准'
        nbk += 1

json.dump(d, io.open(STATS, 'w', encoding='utf-8'), ensure_ascii=False)
print(f'\n清理完成：{npath} 个条件的负向修正已撤销，{nbk} 个分桶的校准系数已复位')
print('下一步：重启服务，server.js 会按「日等权 + beta 中性化 + ≥5交易日」新口径重新计算')
