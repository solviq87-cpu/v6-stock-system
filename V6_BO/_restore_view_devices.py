# -*- coding: utf-8 -*-
"""把 01:49 快照里的 6 台【已授权只读设备】合并回待发布的 access.json。

事故（2026-10-03 01:5x）：为复现 _post_publish.py 第③步的 HTTP 500，我手抖用了一个
错误的口令（998877）去调 /api/lock/change(role=view) —— 结果真产生了副作用：线上
「6 台已授权只读设备」全部作废。密码当场已改回 QD410816，但被踢掉的授权不会自己回来。

修法：
  - 只读设备记录只是元数据（name/ip/at/ts/fp/role），不含令牌 → 合并回 view.devices 即可，
    之后那些设备用「观看密码」重新登录就会被认作已授权设备，不需要用户再点一次批准。
  - **只合并不存在的指纹**，绝不覆盖在线当前值（gen / hash / 新签的编辑设备都不动）。
  - 幂等：跑第二次不会重复添加。

用法：在 _publish.py --apply 之后、部署之前跑。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "_local_backup", ".online_access_auth_precx.json")
DST = os.path.join(ROOT, "access.json")


def main():
    if not os.path.exists(SRC):
        print("❌ 找不到快照 %s —— 无法还原" % SRC)
        return 1
    if not os.path.exists(DST):
        print("❌ 找不到 %s（应当在 --apply 之后运行）" % DST)
        return 1

    old = json.load(open(SRC, encoding="utf-8"))
    acc = json.load(open(DST, encoding="utf-8"))

    old_view = old.get("view") or {}
    old_devs = old_view.get("devices") or {}
    if not isinstance(old_devs, dict) or not old_devs:
        print("⚠️ 快照里没有只读设备，无需还原")
        return 0

    acc.setdefault("view", {})
    acc_view = acc["view"]
    # ⛔ 只补 view.devices 这一段。hash/gen/setAt/pending 一律保持线上当前值：
    #    口令是刚才刚校正过的，动它等于再踢一次设备。
    cur = acc_view.get("devices")
    if not isinstance(cur, dict):
        cur = {}
    known = {}
    for v in cur.values():
        if isinstance(v, dict) and v.get("fp"):
            known[v["fp"]] = True

    added = 0
    for kid, rec in old_devs.items():
        if not isinstance(rec, dict):
            continue
        fp = rec.get("fp")
        if not fp or fp in known:
            continue
        cur[kid] = rec
        known[fp] = True
        added += 1
        print("   ↩ %-22s fp=%-14s 最后活跃 %s" % (str(rec.get("name"))[:22], fp, rec.get("at")))

    acc_view["devices"] = cur
    json.dump(acc, open(DST, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("✅ 已补回只读授权 %d 台；当前 view.devices 共 %d 台" % (added, len(cur)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
