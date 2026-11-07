# -*- coding: utf-8 -*-
# 定位线上 /api/state 里 9 处 "+-" 的上下文
import json, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"

def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

def get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "发版核验2", "role": "edit", "fp": "FCHK_DR2"})
tok = tr.get("deviceToken") or tr.get("token") or ""
s = get("/api/state?token=" + urllib.parse.quote(tok))
raw = json.dumps(s, ensure_ascii=False)

i = 0
n = 0
while True:
    i = raw.find("+-", i)
    if i < 0:
        break
    n += 1
    print("--- #%d ---" % n)
    print(raw[max(0, i - 90): i + 40].replace("\\n", " "))
    i += 2
print("共 %d 处" % n)

items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
for x in items:
    if str(x.get("fp") or "") == "FCHK_DR2":
        post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
        print("已撤回核验身份 FCHK_DR2")
