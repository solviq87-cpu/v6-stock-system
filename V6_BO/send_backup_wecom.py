# -*- coding: utf-8 -*-
# 把源码备份包发送到企业微信群（webhook 文件消息），供手机端下载留存，预防丢失
# ⛔ 安全闸门（2026-10-02 用户要求：源码和密码不要推送）
# 源码已改由 Gitee 私有仓库托管（push remote: gitee），备份不必再经由企业微信群转发：
# 群文件永久留存、可被转发，还常被 _build_zip.py 的脱敏逻辑漏掉。
# 现在默认拒绝执行；确有离线备份需求时显式打开： set QD_ALLOW_SRC_PUSH=1
import os as _os
if _os.environ.get("QD_ALLOW_SRC_PUSH") != "1":
    raise SystemExit(
        "已阻止：源码包不再推送到企业微信群（2026-10-02 起改由 Gitee 私有仓库托管）。\n"
        "需要备份请执行： git push gitee master\n"
        "确需上传到群文件时再显式开： set QD_ALLOW_SRC_PUSH=1\n"
    )

# 用法: python send_backup_wecom.py <备份文件路径>
import json, sys, uuid, urllib.request

CFG = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\config.json"

def wecom_key():
    import re
    cfg = json.load(open(CFG, encoding="utf-8"))
    m = re.search(r"key=([\w-]+)", cfg.get("wecomWebhook", ""))
    if not m:
        raise SystemExit("config.json 中无有效 webhook")
    return m.group(1)

def upload_media(key, path):
    """webhook 临时素材上传（文件上限20MB），返回 media_id"""
    boundary = uuid.uuid4().hex
    fname = path.replace("\\", "/").split("/")[-1]
    with open(path, "rb") as f:
        data = f.read()
    body = (
        ("--%s\r\n" % boundary).encode()
        + ('Content-Disposition: form-data; name="media"; filename="%s"\r\n' % fname).encode("utf-8")
        + b"Content-Type: application/octet-stream\r\n\r\n"
        + data
        + ("\r\n--%s--\r\n" % boundary).encode()
    )
    req = urllib.request.Request(
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media?key=%s&type=file" % key,
        data=body, method="POST",
        headers={"Content-Type": "multipart/form-data; boundary=%s" % boundary},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.load(r)
    if res.get("errcode") != 0:
        raise SystemExit("素材上传失败: %s" % res)
    return res["media_id"], fname

def send(key, payload):
    req = urllib.request.Request(
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=%s" % key,
        data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

if __name__ == "__main__":
    path = sys.argv[1]
    key = wecom_key()
    media_id, fname = upload_media(key, path)
    print("素材上传成功:", fname)
    print("发送结果:", send(key, {"msgtype": "file", "file": {"media_id": media_id}}))
    note = ("【📁源码留存】量化看盘平台最新源码备份(%s)\n"
            "包含服务端/策略/面板/启动器/测试脚本，解压后 node server.js 即可恢复。\n"
            "此文件可长期保存在群相册，防止本地丢失。" % fname)
    print("说明消息:", send(key, {"msgtype": "text", "text": {"content": note}}))
    print("✅ 备份已发送到企业微信群")
