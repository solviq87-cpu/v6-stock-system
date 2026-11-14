# 天枢智策 V6｜完整工程源码包（2026-11-14）

## 交付内容
本包从 **通过完整 CI 的 `dev` 精确提交 SHA** 打包，保留该 Git 提交追踪的**全部文件**（仓库根目录、`V6_BO/`、`V6_WEB/`、测试、策略、电脑/手机页面、文档、工具及配置模板），不从旧 ZIP 覆盖或删减任何现有源码。

本次重点保留并核验的四组功能：
- PR #221：Excel/XLSX 股票清单导入、解析、API 和测试；
- PR #222：资金未知值保留与超过 220 持仓的有界轮询；
- PR #224：八类研究功能、记录、归因、诊断、HTTP/浏览器测试；
- 已在 #224 主线整合的手机研究页与导出状态修复。

以上只是本次关注的四组，**ZIP 并非只包含四组文件**；该 SHA 中后来合并的源码和历史记录也一起保留。

## 实际打包与仓库位置
- 打包器：`V6_BO/scripts/build-complete-engineering-bundle.py`
- 测试：`V6_BO/tests/test_complete_engineering_bundle.py`
- 自动工作流：`.github/workflows/v6-complete-engineering-bundle.yml`
- 触发：`dev` 的 **push V6 CI** 完成后，严格校验精确 head SHA、`verify` 与 `verify-web` 全部通过；仅本次打包器/工作流相关提交触发归档，避免每次提交重复生成大包。
- 通过后创建 **独立归档分支**：`archive/v6-full-<精确 SHA 前12位>`。
- 归档分支包含：`V6_FULL_<SHA前12位>.zip`、`VERIFICATION.json` 和 `README.md`。ZIP 内含 `ENGINEERING_MANIFEST.json` 和 `ENGINEERING_README.txt`。
- 同时保留 30 天 GitHub Actions Artifact，便于检查构建和上传。
- 若门禁、构建、ZIP 文件比对或 GitHub 归档写入失败，**不得标记为“已入仓库的完整 ZIP”**；应查看工作流的实际结果和归档分支是否出现。

## 可复现验证（任意 Linux / macOS，Python3 + Git）
```bash
SHA="$(git rev-parse dev)"
python3 V6_BO/scripts/build-complete-engineering-bundle.py build --repo . --sha "$SHA" --output "/tmp/V6_FULL_${SHA:0:12}.zip"
python3 V6_BO/scripts/build-complete-engineering-bundle.py verify --repo . --sha "$SHA" --output "/tmp/V6_FULL_${SHA:0:12}.zip"
python3 -m unittest discover -s V6_BO/tests -p 'test_complete_engineering_bundle.py' -v
```
注意：`build` 拒绝覆盖已有输出；再次构建应更换输出路径或在确认备份后自行整理产物。

## 校验与保留边界
- ZIP 按原 Git tree 逐文件枚举，逐项核对 Git blob SHA-1、ZIP 文件 SHA-256、大小、权限、路径、数量；不允许漏文件、添文件或重复路径。
- 打包拒绝 tracked 的私人凭据/运行数据、危险符号链接、子模块及不支持的对象类型；没有把 `gitignore` 当作私密安全证明。
- 不包含 `.git` 提交对象历史：提交历史仍保存在 GitHub 原仓库；需要完整历史请另行 `git clone`，不可把源码 ZIP 当作历史镜像。
- 运行数据（持仓、订单、API 凭据、采集缓存、加密备份）不能从 GitHub 源码包恢复，必须使用现有私有灾备流程。
- 这是**源码工程交付**，不意味着 WorkBuddy 静态页面已加入后端研究入口，也不表示 Node/Python 后台、行情授权、真实券商/短信推送或生产上线完成。

相关原始合并记录：[PR #221](https://github.com/solviq87-cpu/v6-stock-system/pull/221)、[PR #222](https://github.com/solviq87-cpu/v6-stock-system/pull/222)、[PR #224](https://github.com/solviq87-cpu/v6-stock-system/pull/224)。
