#!/usr/bin/env python3
"""Verify and combine V6 1090 BO ZIP parts; never overwrite an existing original."""
from pathlib import Path
import json, hashlib, os, sys, zipfile

root=Path(__file__).resolve().parent
manifest=json.loads((root/"V6_1090_parts_manifest.json").read_text(encoding="utf-8"))
target=root/manifest["original_filename"]
if target.exists():
    sys.exit("原文件已存在，拒绝覆盖："+str(target))
tmp=root/(manifest["original_filename"]+".assembling")
full=hashlib.sha256()
try:
    with tmp.open("wb") as dst:
        for part in manifest["parts"]:
            f=root/part["name"]
            if not f.is_file() or f.stat().st_size != part["bytes"]:
                raise ValueError("分卷不存在或大小不正确: "+part["name"])
            digest=hashlib.sha256()
            with f.open("rb") as src:
                while chunk:=src.read(1024*1024):
                    digest.update(chunk)
                    full.update(chunk)
                    dst.write(chunk)
            if digest.hexdigest()!=part["sha256"]:
                raise ValueError("分卷SHA256错误: "+part["name"])
    if tmp.stat().st_size!=manifest["original_bytes"] or full.hexdigest()!=manifest["original_sha256"]:
        raise ValueError("重组后原包字节数或SHA256错误")
    with zipfile.ZipFile(tmp) as z:
        if z.testzip() is not None: raise ValueError("ZIP CRC校验失败")
    os.replace(tmp,target)
    print("验证并重组成功",target)
    print("SHA256",full.hexdigest())
except Exception:
    tmp.unlink(missing_ok=True)
    raise
