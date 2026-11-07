# -*- coding: utf-8 -*-
"""_publish.py 增加「线上凭据/设备台账不覆盖」保护。

事故：2026-09-30 03:0x，用户在手机上改了开发者口令，我随后发一版 —— access.json 随根目录
上传，本地那份旧凭据把线上的新密码直接打回，连 devices 台账一起替换，用户手机上刚签的令牌
当场失效。这不是第一次：用户早就说过「改一次版本我就要重新登录」。

修法：第①步把线上 accessAuth 留一份，--apply 时把它填回待发布的 access.json。
"""
import ast

F = '_publish.py'
t = open(F, encoding='utf-8').read()

# ① 第①步：记下线上凭据（紧跟 machineKey 那段之后）
anchor = '''    online_mk = exp.get("machineKey")
'''
assert anchor in t, '锚点 1 未命中'
ins = anchor + '''    # ★ 同理保住【线上登录凭据 + 已授权设备台账】：否则本地开发副本的旧 access.json
    #   会把用户刚改的密码打回旧值、把手机上的令牌作废（详见 _restore_access_auth 注释）。
    online_auth = exp.get("accessAuth")
    if online_auth:
        try:
            os.makedirs(BACKUP, exist_ok=True)
            with open(os.path.join(BACKUP, ".online_access_auth.json"), "w", encoding="utf-8") as _f:
                json.dump(online_auth, _f, ensure_ascii=False)
            print("   \\U0001f510 已取得线上登录凭据与设备台账（发布时不被本地副本覆盖）")
        except Exception as e:
            print("   ⚠️ 线上凭据保存失败: %s" % e)
    else:
        print("   ⚠️ 线上未返回 accessAuth（旧版本）—— 本次发布后可能需要重新登录")
'''
t = t.replace(anchor, ins, 1)

# ② 新增 _restore_access_auth 函数
anchor2 = '''def restore_local():'''
assert anchor2 in t
fn = '''def _restore_access_auth(target_access):
    """把第①步记下的【线上凭据 + 设备台账】写回待发布的 access.json。

    与 machineKey 同源同理：access.json 随根目录上传，本地那份是开发副本的旧状态，
    一旦覆盖用户就"改一次版本重新登录一次"，更糟的是他刚改的密码会被打回旧值。
    这里逐字段填回线上值；只有 machineKey 沿用已写好的那个（它与这份数据同源）。"""
    f = os.path.join(BACKUP, ".online_access_auth.json")
    if not (os.path.exists(f) and os.path.exists(target_access)):
        return False
    try:
        auth = json.load(open(f, encoding="utf-8"))
        if not auth or not auth.get("hash"):
            return False
        acc = json.load(open(target_access, encoding="utf-8"))
        keep_mk = acc.get("machineKey")
        for k in ("salt", "hash", "setAt", "gen", "devices", "view"):
            if auth.get(k) is not None:
                acc[k] = auth[k]
        if keep_mk:
            acc["machineKey"] = keep_mk
        json.dump(acc, open(target_access, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print("   ⚠️ 线上凭据回填失败: %s（本次发布后可能需要重新登录）" % e)
        return False


def restore_local():'''
t = t.replace(anchor2, fn, 1)

# ③ --apply 里调用
anchor3 = '''    _mk_restored = _restore_machinekey(os.path.join(ROOT, "access.json"))
    print("ⓐ 根目录已铺成发布包内容（config 无 pushRole / 数据为线上版本）")'''
assert anchor3 in t, '锚点 3 未命中'
new3 = '''    _mk_restored = _restore_machinekey(os.path.join(ROOT, "access.json"))
    _auth_restored = _restore_access_auth(os.path.join(ROOT, "access.json"))
    print("ⓐ 根目录已铺成发布包内容（config 无 pushRole / 数据为线上版本）")
    if _auth_restored:
        print("   \\U0001f510 已沿用线上登录凭据与设备台账 → 你改的密码不会被打回，令牌不必重签")'''
t = t.replace(anchor3, new3, 1)

ast.parse(t)
open(F, 'w', encoding='utf-8', newline='\n').write(t)
print('✅ _publish.py 补丁完成')
