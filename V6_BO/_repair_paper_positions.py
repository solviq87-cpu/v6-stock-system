#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复 paper.json 账目对不上：以当前 positions 为权威，删除对应不上的/重复的买入流水。
只动 trades，不动 cash/realized/positions/initial；修完后 trades 与 positions 能互相重算。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent
PAPER_PATH = ROOT / 'paper.json'


def match_key(t):
    return (t.get('code'), str(t.get('side') or ''), t.get('shares'), t.get('amount'))


def repair_account(acc, name):
    trades = list(acc.get('trades') or [])
    positions = acc.get('positions') or {}
    kept = []
    removed = []

    # 对每个持仓，保留唯一一笔能匹配上的买入流水；匹配不上或多余的视为脏数据
    for code, pos in positions.items():
        pos_shares = int(pos.get('shares') or 0)
        candidates = [t for t in trades if t.get('code') == code and '买' in str(t.get('side') or '')]
        if not candidates:
            # 持仓无来源流水：这属于另一类错误，交给 audit 报出来，不在这里处理
            continue
        # 优先保留与持仓 shares 完全一致、且时间最近的一笔
        exact = [t for t in candidates if int(t.get('shares') or 0) == pos_shares]
        if exact:
            chosen = max(exact, key=lambda t: t.get('t') or 0)
        else:
            # 没有完全匹配的，保留最近一笔（通常是最后一次买入）
            chosen = max(candidates, key=lambda t: t.get('t') or 0)
        kept.append(chosen)

    # 卖出流水全部保留（它们有完整的 pnl/fee/basis，不参与持仓重建）
    sells = [t for t in trades if '卖' in str(t.get('side') or '')]
    kept.extend(sells)

    # 记录被删掉的买入
    kept_set = set(id(t) for t in kept)
    for t in trades:
        if id(t) not in kept_set:
            removed.append(t)

    # 去重并按时序倒序（与 paperBuy/paperSell 落盘格式一致：新的在前）
    seen = set()
    unique = []
    for t in sorted(kept, key=lambda x: x.get('t') or 0, reverse=True):
        k = match_key(t)
        if k in seen:
            removed.append(t)
            continue
        seen.add(k)
        unique.append(t)

    acc['trades'] = unique
    return len(removed), removed


def main():
    with open(PAPER_PATH, 'r', encoding='utf-8') as f:
        paper = json.load(f)

    total_removed = 0
    for key in ['pool', 'pre']:
        acc = paper.get(key)
        if not acc:
            continue
        n, removed = repair_account(acc, key)
        total_removed += n
        print(f'=== {key} ===')
        print(f'  删除 {n} 笔对不上的买入流水')
        for t in removed:
            print(f'    - {t.get("side")} {t.get("code")} {t.get("shares")}@{t.get("price")} amt={t.get("amount")}')

        # 验证
        cash = acc['initial']
        shares = {}
        for t in acc['trades']:
            side = str(t.get('side') or '')
            if '买' in side:
                cash -= (t['amount'] + t.get('fee', 0))
                shares[t['code']] = shares.get(t['code'], 0) + t['shares']
            elif '卖' in side:
                cash += (t['amount'] - t.get('fee', 0))
                shares[t['code']] = shares.get(t['code'], 0) - t['shares']
        pos_codes = set(acc.get('positions') or {})
        calc_codes = {c for c, q in shares.items() if q != 0}
        print(f'  验证: cash 账户={acc["cash"]} 重算={round(cash,2)} 差={round(acc["cash"]-cash,2)}')
        print(f'  验证: positions={sorted(pos_codes)} 重算={sorted(calc_codes)} 一致={pos_codes == calc_codes}')

    if total_removed > 0:
        with open(PAPER_PATH, 'w', encoding='utf-8') as f:
            json.dump(paper, f, ensure_ascii=False, indent=0)
        print(f'\n已写入 {PAPER_PATH}，共删除 {total_removed} 笔脏流水')
    else:
        print('\n无需写入')

    return 0


if __name__ == '__main__':
    sys.exit(main())
