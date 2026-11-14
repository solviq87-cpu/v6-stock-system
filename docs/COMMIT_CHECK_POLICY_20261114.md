# 天枢智策 V6 · 每次代码提交触发 GitHub 检查

2026-11-14，用户要求不再出现“代码已经提交，但没有绿色对勾/红色叉号”的开发分支记录。本文件规定此后新提交的检查触发规则；不回填旧提交，也不代表已部署生产环境。

## 对应规则

- 非归档代码分支的每次 push（含 feat/fix/chore/research/audit/main/dev 等任意分支名），都运行 V6 CI / verify 与 verify-web。不设置 paths 过滤，因此仅修改文档、工具、测试或工作流的提交也有对应检查。两个作业的失败/成功会关联本次推送的头 SHA。
- 推送涉及 V6_BO/public、指定的浏览器测试脚本、V6_WEB/workbuddy 或 UI 工作流时，额外运行 V6 UI Browser Geometry / visual-geometry；其他变更不白跑 Chromium。
- PR 验收保留原 pull_request 的完整 CI 和 UI 条件；合并到 dev/main 后仍执行原完整推送 CI。旧行情/模拟盘/隐私/风控门禁及后端、网页完整回归不删减。
- archive/** 是归档 ZIP 或加密历史分卷专用分支，不包含可运行的 V6 工程，不触发源码工作流；已审核的独立打包工作流仍在归档前校验 ZIP 和源 SHA。
- 完整 CI 的绿色状态仅说明该 SHA 的离线/隔离测试通过，**不是**线上 WorkBuddy、真实数据或交易已部署/认证。

## 为什么旧提交不会自动出现对勾

GitHub Actions 只对触发运行关联的 SHA 给出检查。历史提交本来没有运行记录，增加新的事件监听不会补造旧版本的检查。**如果一个 git push 一口气包含多条新提交，GitHub 的普通 push 工作流通常只把结果挂在该次 push 的头 SHA**，因此协作中应“一条待验提交一推送”，不要一次上传多条需要分别显示对勾的历史提交。必须人工追溯旧 SHA 时，重新在隔离环境检出该精确 SHA 测试并保存真实结果；不能根据最后一次 CI 反向补写成功。

已有、未同步新 workflow 的旧开发分支要先从最新 dev 纳入该工作流；之后的新 push 才能得到新检查。GitHub Actions 停用、额度、权限、事件投递问题也可能导致无检查，应查 Actions 日志并阻止宣称通过，不能把无图标误写成绿色。

## 审核与安全

- 源码执行只在 GitHub Actions 的 contents: read 下发生，不读取发布密钥、不迁移账户、不自动上线或新增发布者。
- CI 失败不得标记为交付成功；PR 与 dev 必须有精确 head SHA 的 verify 和 verify-web 成功记录，UI 改动另查浏览器结果。
- 仓库分支保护/必需检查需拥有 GitHub 管理权限的维护者在 Settings → Rules → Rulesets 设置；单靠 YAML 不能强制 GitHub 拒绝绕过检查的合并。要求至少 verify、verify-web，UI 结果在 UI PR 中应一并审核；不要把因路径过滤导致的未触发状态误设成全仓永久必需检查。
- 代码提交的相关测试结果、SHA、未测范围要随 PR 和交接记录留存；不要为了绿色结果删断言、改成功定义或跳过测试。


## 补充：批量推送也按每个 SHA 检查（2026-11-15）

- 新增 .github/workflows/v6-per-commit-smoke.yml。普通非归档 push 用 GitHub Compare API 枚举 before 到 after 的完整新增提交，不依赖可能截断的 webhook commits 列表。
- 每个新增 SHA 分别检出并执行语法、行情质量和订单状态的轻量测试，获得 GitHub commit status v6/per-commit-smoke。绿色表示该次快速测试通过，不能替代完整 V6 CI 的 verify / verify-web、受影响的 visual-geometry，也不能证明线上已发布。
- 执行测试的作业仅有只读权限，并禁止 checkout 保存令牌。唯一具有 statuses: write 权限的作业不检出、不执行分支代码，只读取 GitHub 官方作业结果，写回每个精确提交的成功/失败状态。
- 新建分支首次 push 仅验证其当前头 SHA，不为旧祖先补造结果。强制推送、非快进或超过 32 个新提交的单次推送必须停止并报告，需安全地拆分推送；不能把本次限制绕过当成通过。
- 该记录是 commit status，不是 GitHub Actions check run；提交列表可显示结果，PR Checks 面板仍须以原 Actions 检查为准。archive/** 保留归档校验流程。
- 要强制阻断无检查的合并，仍必须由有仓库规则管理权限的维护者建立 Ruleset，把 verify、verify-web 与适用的 v6/per-commit-smoke 设为必需并核对来源；仅有 YAML 不等于已开启仓库合并保护。
