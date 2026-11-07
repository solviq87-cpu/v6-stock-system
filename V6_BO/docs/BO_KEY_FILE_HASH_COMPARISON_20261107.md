# BO 与 dev：12 个关键文件内容校验（2026-11-07）

方法：从 `V6_1090_full_20261107bo.zip` 中读取 `v6/<path>` 原始字节，计算 Git blob SHA-1（`sha1("blob <length>\\0" + bytes)`），与 GitHub dev 的 Git tree blob SHA 比对。此法可验证字节完全相同，不只是路径相同。

## 完全相同（9）
- package.json
- src/core/market-data-center.js
- src/core/paper-order-store.js
- src/core/strategy-engine.js
- src/strategy/strategy-service.js
- scripts/market-data-sync.js
- config/data-source-catalog.json
- integration/PACKAGE_SHA256_20261107bo.json
- docs/V6_全量待办24项清单.md

## 内容不同（3）
- server.js：BO `0836a8de18ff216e9b9e0862d6c634b41ed51a13`；dev `23112619e1d011d4522e76fab9ba017f02c11570`
- public/index.html：BO `348a369ac2e73ec304e5afa2dcc0b32dbb24965f`；dev `62c50c300ac8166be91a8066bca9b1099ea4a47b`
- public/assets/app.js：BO `4ea5a27c21f19d39704e9095f629b6b2f72b6c42`；dev `7b70bc35604e8a3ff1141b7aed604c70e0d7c005`

**不同不代表缺失或损坏**：dev 有 BO 之后的新提交。未审查差异之前禁止覆盖。

已增加只读工具 `V6_BO/scripts/audit-full-zip.py`，可在完整 Git checkout 中执行：
```sh
python3 V6_BO/scripts/audit-full-zip.py /path/to/V6_1090_full_20261107bo.zip
```
工具输出 `bo-audit-result.json`，含每个文件的路径、类别、BO blob SHA、相同/不同/缺失状态；不会解压、覆盖或运行压缩包中的代码。运行结果可能包含敏感路径，报告应先检查再公开。

本报告只证明上述 12 项；不声称全量 SHA 已校验或缺失文件已全部恢复。
