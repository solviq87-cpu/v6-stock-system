# V6 ZIP → GitHub 安全合并核对记录（2026-11-12）

## 范围与基线

- 输入 ZIP：`V6_1083_full_20261106bn(3).zip`，根目录 `v6/`，4,343 个归档条目。
- 目标仓库：`solviq87-cpu/v6-stock-system`，工程目录 `V6_BO/`。
- 本记录位于独立审查分支，不代表已将 ZIP 全量合并到 `dev`。
- 对比采用 Git blob SHA-1（包含 `blob <length>\0` 前缀），并非仅按文件名推断一致。

## 已核验的关键文件

| ZIP 相对路径 | ZIP Git blob SHA-1 | 仓库已读取 blob SHA-1 | 结论 |
| --- | --- | --- | --- |
| `src/core/paper-durable-order-service.js` | `52d8cdb3ff1a8e5b6d34ff1074a9ad4ffe679f0d` | 相同 | 无需覆盖 |
| `src/core/six-photo-backups.js` | `58933b2aabb3ace98806f731401e725c73e636dc` | 相同 | 无需覆盖 |
| `docs/V6_唯一统一总任务大纲.md` | `07f1d5b05477365e51fe0af087d841a1cc3912f9` | 相同 | 无需覆盖 |
| `AGENTS.md` | `5804645c33e1bec0d1446c22710a0fb8b1fab492` | `0b8412c0b3b8018aed60390c39a966cd331cae22` | 不同，保留仓库新记录 |
| `package.json` | `ca26785483a7792c8acd4d0ab80181ae005779ce` | `c43878399c727dd8d9de5d5475627cbeeeb763b6`（早期读取） | 不同，需进一步检查当前分支版本 |

## 已知风险与后续门禁

1. 仓库 `AGENTS.md` 比 ZIP 多 `bo`、`bp` 交接记录，不能以 ZIP 旧版覆盖。
2. ZIP 的 `package.json` 含 `paper:account-ledger:test`、`paper:order-store:test` 等脚本；仓库当前脚本存在调整。需逐项验证命令及目标文件，不能整文件替换。
3. GitHub 上还有 2026-11-07 的研究模型与 CI 改动；不得用 2026-11-06 的归档回退。
4. 先完成完整文件清单与内容哈希差异，再分类：相同、仅 ZIP、新增于仓库、双方改动、私有/运行时数据。
5. 账户凭据、配置、持仓和历史账本禁止随意提交；合并前后均需实际执行语法与全量回归。
6. 本记录是审计进度，不宣称 4,343 个条目已逐一与仓库核对，也不宣称 CI 通过。
