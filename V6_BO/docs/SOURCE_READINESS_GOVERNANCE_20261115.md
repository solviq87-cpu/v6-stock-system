# V6 120路来源登记与单次健康证据对账（2026-11-15）

## 本轮实际边界
基线 `dev@4f8099ab65d5cb6c34104dfe6150bbc8790cc359`。既有 `data-source-registry-2026.json` 登记 **120 条**候选/已存在路线：受控研究 2、需审核 41、仅登记 48、需凭据 27、需专用客户端 2。注册不等于已接通、独立行情供应商、法律授权或可用于实盘。原三家东财/腾讯/新浪的 `public-quote-endpoint-health` 已能做**一次性、低频**健康诊断，但它不覆盖其他登记路线，也不能说明某个 SDK 与其共享的原始上游同步可用。

## 本轮新增的只读审计
`src/core/data-source-readiness-audit.js`：
- 不发网络请求；只使用受版本约束的120路仓库登记和**操作者预先保存的** `one-shot-public-quote-endpoint-health` 报告。无报告时全部为 `not-probed`，受控研究权限也不冒充在线。
- **按确切来源ID**关联最多三家诊断结果。即使 eastmoney 获得某次诊断成功，efinance、AKShare 等同上游接口仍标 `not-probed`；SDK 也不得算作独立投票。
- 审查供应商原报价 `quoteAt`、报告 `finishedAt`、实际审核 `asOf`，15秒后把 `fresh-source-unverified` 降为 `historical-probe-only`；403、429、302、超时分别保留 `lastProbeStatus`，仅用过去状态作历史诊断，绝不推断当下有权限。
- 校验响应标记、状态、重复ID、原时点与年龄、时钟回退、休市时未请求，拒绝不一致的快照。不复制原价、前收、请求链接、任意输入附加字段、凭据或响应原文；输出只有注册元数据与有界状态证据。
- `summary` 同时统计120条路线的准入分类、实际被观测的**确切路线**、剩余未观测数量与上游标签数量；`licensedLiveSources=0`、`productionActiveSourcesVerified=0`、`canTrade=false`、`canTrain=false`、`canNotify=false`。

`scripts/audit-data-source-readiness.js`：离线CLI，不要求账号，默认仅审核仓库登记。可选传本地私有普通文件，限制128KiB、拒绝符号链接及 `public` 路径、读取过程中文件变动时拒绝；输出只写stdout，不覆盖任何持久化行情。

```bash
cd V6_BO
# 完全离线，只对120路目录分级；不进行任何真实探测
node scripts/audit-data-source-readiness.js

# 另在合规授权的环境中，按原说明单次获取快照并存到私有目录：
# node scripts/public-quote-endpoint-health.js 600519 > /private/one-shot.json
# 仅在此前已生成快照时，离线分析其证据；本命令本身绝不联网
node scripts/audit-data-source-readiness.js /private/one-shot.json

node --test tests/data-source-readiness-audit.test.js
```

## 自动测试、限制与下一步
- 新增显式 `data-source-readiness-audit.test.js`，挂入既有 `multi-source-data-lineage` CI Job；仓库原完整 `npm test` 保留。覆盖未探测、同上游SDK不继承状态、快照到期、302/403/429/时钟错误与虚假授权、私有路径及CLI只读边界。
- 本工具只做**来源健康证据分类**，不是持续实时网络监控，也不能证明供应商长期稳定性、来源独立性、官方商用授权、哪家股价正确、真实节假日或持续更新。要实现生产级健康监控，仍需在合法的实际部署实例中做受限、可审计的定时采样及交易日验证，避免高频请求。
- 两张锁定 PC/手机主页、四体系策略、真实账户、资金与授权、15秒执行报价门禁、唯一WorkBuddy静态发布者均不更改。
- `dev` 目前尚未启用 GitHub 分支保护（`protected=false`）；仓库 CI 能运行不等于能强制禁止未测试直接提交。须由仓库管理设置 GitHub ruleset / required checks；本轮没有权限通过GitHub connector修改该仓库设置，绝不伪称已开通。
- 有任何专项/全量 CI 失败不得合并。回滚用 PR 关闭或 Git revert，禁止旧 ZIP 覆盖已有工程。
