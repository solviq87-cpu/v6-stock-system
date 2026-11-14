# -*- coding: utf-8 -*-
# 只补发一份源码包（不发卡片、不发说明），用于源码包内容有更新时刷新手机上的附件
import sys
sys.path.insert(0, r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard")
import _push_phone as P

key = P.wecom_key()
path = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\量化看盘平台_源码_20260927o.zip"
media_id, fname = P.upload_media(key, path)
print("素材:", fname)
print("源码:", P.send(key, {"msgtype": "file", "file": {"media_id": media_id}}))
print("tip: 已补发最新源码包（覆盖上一条同名附件）")
