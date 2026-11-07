# dl 轮收尾：清掉我自己造的设备台账记录，再重签同步身份
# ⛔ 顺序：先删与当前令牌无关的，自己那条最后删（同一 fp 每次登录 id 都变，删之前先查再删）
# ⛔ revoke 会 bump 世代号 → 同世代其它令牌跟着作废 → 删完必须重签写回 config.json 并重启本地服务
import json, io, urllib.parse, time
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

# 当前令牌（用它做身份，删完它就作废了）
cfg = json.loads(io.open("config.json", encoding="utf-8").read())
tok = ((cfg.get("syncUpstream") or {}).get("token")) or ""
print("当前令牌 %d 位" % len(tok))

# 先查一遍，只删 fp 明确是我造的那些；用户真机（随机 fp）与「已授权设备（自动恢复）」一律避开
items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
MINE_PREFIX = ("FPUBLISH", "FPUB_SYNC", "PUBNOTE", "FPCHECK")
KEEP = ("FPUB_SYNC02",)          # 本机同步身份，删了就没法把改动同步到手机
targets = [x for x in items
           if str(x.get("fp", "")).startswith(MINE_PREFIX)
           and str(x.get("fp", "")) not in KEEP]
print("台账 %d 条，待清理 %d 条" % (len(items), len(targets)))
for x in targets:
    r = post("/api/lock/revoke", {"token": tok, "id": x.get("id", "")})
    print("  已撤销 fp=%-14s name=%-20s → %s" % (x.get("fp"), x.get("name"), r.get("revoked") if r.get("ok") else r.get("error")))

# 重签（revoke bump 了世代号，旧令牌已废）
tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "开发者登录·本机副本同步",
                              "role": "edit", "fp": "FPUB_SYNC02"})
if not tr.get("ok"):
    raise SystemExit("重签失败: %s" % tr.get("error"))
ntok = tr.get("deviceToken") or ""
print("重签 OK，令牌 %d 位" % len(ntok))

cfg.setdefault("syncUpstream", {})["token"] = ntok
io.open("config.json", "w", encoding="utf-8", newline="").write(
    json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
print("已写回 config.json 的 syncUpstream.token")

items = (get("/api/lock/devices?token=" + urllib.parse.quote(ntok)) or {}).get("items", [])
print("台账复查 %d 条：" % len(items))
for x in items:
    print("   fp=%-16s name=%-24s role=%s" % (x.get("fp", "(无)"), x.get("name", ""), x.get("role", "")))
