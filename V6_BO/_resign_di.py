# di 轮收尾：revoke 后重签同步身份并写回 config.json（revoke 会 bump 世代号 → 同世代令牌作废）
import json, io
import urllib.request

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"

def post(path, obj):
    req = urllib.request.Request(ONLINE + path,
                                data=json.dumps(obj).encode("utf-8"),
                                headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))

def get(path):
    return json.loads(urllib.request.urlopen(ONLINE + path, timeout=30).read().decode("utf-8"))

tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "开发者登录·本机副本同步",
                              "role": "edit", "fp": "FPUB_SYNC02"})
if not tr.get("ok"):
    raise SystemExit("重签失败: %s" % tr.get("error"))
tok = tr.get("deviceToken") or ""
print("重签 OK，令牌 %d 位" % len(tok))

# 写回 config.json（保持 LF，不引入 BOM）
p = "config.json"
cfg = json.loads(io.open(p, encoding="utf-8").read())
cfg.setdefault("syncUpstream", {})["token"] = tok
io.open(p, "w", encoding="utf-8", newline="").write(
    json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
print("已写回 %s 的 syncUpstream.token" % p)

# 复查台账
items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
print("台账复查 %d 条：" % len(items))
for x in items:
    print("   fp=%-16s name=%-22s role=%s" % (x.get("fp", "(无)"), x.get("name", ""), x.get("role", "")))
