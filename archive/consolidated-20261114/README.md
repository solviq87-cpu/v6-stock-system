# 仓库压缩包解压与整合汇总 · 2026-11-14

本次按用户要求检查仓库内全部现存压缩包，并将可恢复内容、旧版差异、加密分卷和完整索引统一放在本目录。基线为 `dev@c6a0b93f624c307199cee98ecd98d8d2a07de2d1`。当前运行工程继续使用根目录下的 `V6_BO/` 和 `V6_WEB/`。

## 检查范围与结果

实际扫描远端 **236 个分支头、0 个标签**的完整 Git tree，按常见压缩格式与分卷后缀查找并按 Git 对象去重，共找到 **1 个完整 ZIP、21 个加密分卷**。`dev` 本身无压缩包。扫描快照及每个文件的分支、提交、路径、Git 对象见 [repository-scan.json](repository-scan.json)。交付新分支不在本轮扫描快照内。

| 来源 | 处理结果 | 仓库内位置 |
| --- | --- | --- |
| `archive/v6-full-35f9b716459e` 的 `V6_FULL_35f9b716459e.zip` | 完整展开并逐文件校验；相同内容复用，旧版差异独立保留 | [工程完整映射](engineering-35f9b716459e/manifest.json)、[差异文件](engineering-35f9b716459e/payload/)、[原包内清单](engineering-35f9b716459e/metadata/ENGINEERING_MANIFEST.json) |
| `archive/v6-1090-encrypted-20261112` 的 AES-256-GCM 备份 | 前21卷逐卷校验并原样归集；缺47卷、无密钥，未解密 | [现有密文与原清单](encrypted-bo/)、[缺失及校验状态](encrypted-bo/STATUS.json) |
| `archive/v6-1090-bo-parts-20261112`、`archive/v6-1090-bo-small-parts-20261112` | 当前分支仅有说明/清单，无可解压分卷 | 原分支保留，扫描清单可核对 |

范围是现存分支/标签的当前快照，未遍历每个历史提交、已删除引用、Actions 临时产物或仓库外私有备份。历史 BI/BN/BO/BS 包曾出现在审计文档中，不等于这些原始 ZIP 现已在仓库中；此前接收结果见 [BI](../../docs/archive-intake/BI_1060_RECONCILIATION_20261112.md)、[BN](../../docs/archive-intake/BN_1083_SAFE_INTAKE_20261112.md) 及 [IMPORT_STATUS](../../IMPORT_STATUS.md)。

## 完整工程 ZIP：全部 2,517 项均有落点

- 原 ZIP：15,579,349 字节；SHA-256 `3c9a21e9e344ff203268071c3a9a3c79d0e07a2bf8c11e7601677a0b425cd8e0`。
- 源提交：`35f9b716459eb29c39adc4d992bc0156e2432673`；源归档分支提交：`e58bdd9921a8569b6600d98ef89ec53bcb618b24`。
- 2,515 个源文件中 **2,510 个与当前基线内容及执行权限相同**，映射直接指向仓库原文件，避免复制一整套相同工程。
- **5 个不同版本**均放在 `engineering-35f9b716459e/payload/` 下保留原相对路径：`HANDOFF.md`、`WORK_LOG.md`、`V6_BO/docs/OPEN_MODEL_DESIGN_ADOPTION_20261114.md`、`V6_BO/tests/workbuddy-live-rate-budget.test.js`、`V6_WEB/workbuddy/index.html`。这些是历史证据，不作为运行入口。
- 另外 **2 个包内元数据文件**放在 `metadata/`；全部 **38,100,228 字节**均可通过映射在仓库找到原字节内容。没有独有业务源码需要补回运行目录。

`manifest.json` 为每个 ZIP 条目记录 `member`、`repositoryPath`、SHA-256、大小、权限和处置方式。原 ZIP 仍保留在原归档分支。以后主线文件继续更新时，复用映射会检测到差异；核验本次快照应检出本次整理提交，不应因此把旧代码覆盖回新主线。需要完全独立的历史工程，可从原归档分支下载原 ZIP。

## 加密 BO：明确未完成的恢复条件

现有 `part001` 至 `part021` 共 **22,020,096 字节**，全部同时符合原清单的大小、SHA-256 与 Git blob SHA-1。预期共68卷、70,795,284字节，缺 `part022` 至 `part068` 共47卷；完整缺失列表在 `encrypted-bo/STATUS.json`。仓库未提供私有解密密钥，不能拼出完整密文或解密成历史 ZIP。

这里只归集已有密文和公开校验元数据，未引入密钥或历史账户/日志明文。原 `encrypted-bo/README.md` 原样保留其历史说明；当前状态以 `STATUS.json` 为准。后续恢复需在私有环境补齐分卷并校验完整密文、解密认证，再审查内容。

## 复核与恢复

新增工具 [consolidate-engineering-archive.py](../../scripts/consolidate-engineering-archive.py) 在写入前验证 ZIP 指纹、逐条 CRC、路径、特殊文件、重复/大小写冲突、展开上限、内嵌清单和全部内容指纹。它只允许在归档目录新建目标，拒绝覆盖和符号链接，不执行包内代码。专项测试由现有 CI 的 `test_audit_*_archive.py` 自动发现。

在本次整理提交的工作树中运行：

```bash
# 浅克隆可能需要先取得用于比对的基线提交对象。
git fetch --depth 1 origin c6a0b93f624c307199cee98ecd98d8d2a07de2d1
python3 scripts/consolidate-engineering-archive.py --repo . \
  --output archive/consolidated-20261114/engineering-35f9b716459e --verify
python3 -m unittest discover -s tests -p 'test_audit_*_archive.py' -v
```

重新解压核对时，从原归档分支获取 ZIP，使用一个尚不存在的输出目录：

```bash
python3 scripts/consolidate-engineering-archive.py --repo . \
  --archive /path/to/V6_FULL_35f9b716459e.zip \
  --expected-sha256 3c9a21e9e344ff203268071c3a9a3c79d0e07a2bf8c11e7601677a0b425cd8e0 \
  --baseline c6a0b93f624c307199cee98ecd98d8d2a07de2d1 \
  --output archive/recheck-35f9b716459e
```

实际验证命令与结果记录在 [validation.json](validation.json)。本次只整理归档和增加可复核工具，运行代码及两张锁定主页没有修改。恢复原目录结构可 `git revert` 本批提交；原归档分支及已有运行数据不受影响。
