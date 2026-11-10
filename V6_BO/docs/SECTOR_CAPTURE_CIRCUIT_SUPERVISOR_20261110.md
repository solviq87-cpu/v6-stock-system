# V6 板块研究采集监督器：限频、熔断与持久化恢复

**2026-11-10。仅提供可选择开启的本地进程入口，没有在任何中国大陆云端主机上部署、启动或授权新的持续外部行情流。** 上游免费公开行情仍未完成商用许可、实时性、交易所时点认证与中国大陆长期可达性验收。

## 使用边界

前序模块 `scripts/sector-market-capture.js` 已有单次 `preview|collect` 模式。本轮 `scripts/sector-capture-supervisor.js` 只围绕该入口增加定时检查、持久化限频、并发锁、失败熔断和异常停机恢复；不另造行情解析器、不重复获取第二份板块报价。一次完整快照可能由东财分页请求构成，监督器记录的是**采集批次**，不是底层 HTTP 请求数。

默认 `status` 为只读且**不联网、不创建目录**；`once` 与 `watch` 都必须明确带上 `--allow-research-fetch`，否则拒绝。watch 仅在操作者明确启动该进程期间运行，不安装系统服务或远程定时器，不保存 API 密钥，不改变原四套策略、模拟盘、账户、原有双端 UI 和学习权重。

## 私有配置（研究操作者先核对源许可）

准备位于静态公开目录以外的 JSON 文件：

```json
{
  "schemaVersion": 1,
  "mode": "sector-capture-supervisor",
  "classificationFile": "/srv/v6-private/industry-raw.json",
  "calendarFile": "/srv/v6-private/trading-calendar.json",
  "outputRoot": "/srv/v6-private/sector-research",
  "intervalMs": 300000,
  "maxDailyAttempts": 12,
  "tripFailures": 3
}
```

这些路径必须是绝对路径且不得指向公开目录或符号链接。中国市场当天有效的行业分类要在当日行情采集**之前**冻结；`trading-calendar.json` 必须为明确获取的真实交易日列表。监督器复用下游盘中时段（北京时间09:35–11:30，13:05–15:00）、供应商逐票 f124 原时点、供应商和分类版本以及覆盖率门禁；周末、午间休市、未知交易日只返回暂停。尚未接入经过核验的假期日历；操作者必须确保导入交易日历正确。

```sh
cd V6_BO
node scripts/sector-capture-supervisor.js status /srv/v6-private/supervisor.json
node scripts/sector-capture-supervisor.js once /srv/v6-private/supervisor.json --allow-research-fetch
node scripts/sector-capture-supervisor.js watch /srv/v6-private/supervisor.json --allow-research-fetch
```

`intervalMs` 最少5分钟、最多1小时；`maxDailyAttempts` 可设置1–30，`tripFailures` 可设置1–5。以上均是**保守默认限制和允许范围**，不代表上游供应商已经批准这个请求频率。正式定时运行仍应遵守合同、公告和上游限频；不是越频繁越好。

## 熔断逻辑

- 采集批次开始前，先对当天交易时段、行业分类、日历和私有目录做一次只读预检；只有全部通过、每日预算和间隔尚有额度且单实例锁成功，才进入真实单次采集。
- 每次联网之前必须把 `inFlight=true`、尝试次数、最后尝试时点写到 `outputRoot/.sector-capture-supervisor-state.json` 并 fsync。正常返回后再写结束结果；记录带 SHA-256 内容一致性校验与私有文件权限0600（**不是第三方签名**）。
- 达到连续失败阈值、遇到 HTTP 403/429 或后续私有研究归档冲突，**本交易日停止采集**，不自动更换域名、绕过限流或重试收费接口。手动改写配置、损坏状态、遗留的 `inFlight` 或残留锁均须人工核对，不能默默清除。
- 新的中国市场日历日期通常会重置每日额度，但**只对上一交易日已正常结束的批次生效**。如果前一天的私有状态仍标记 `inFlight=true`，跨日读取将直接拒绝，不能清空未完成批次、补造已完成结果或在新一天再次请求供应商；需人工核对原始采集、不可变归档与供应商限额，完成审计处置后才允许恢复。当天仍必须有明确导入的交易日及新鲜行业分类；跨过午夜绝不使旧行情成为实时。
- 持久化的是**节流和健康状态，不是股票价格本身**。采集成功时，原有 `sector-market-capture` 链继续管理不可覆盖快照、行业成员、当日板块强弱、3/5日轮动四类独立归档。
- 若一个批次已保存快照，但随后研究链出错，优先使用原有 `sector-daily-chain.js preview|apply` 读取已冻结文件修复，而不是再次请求上游。报告仅返回结果类型和阶段，不输出私有文件内容、凭据或供应商错误体。

## 验证

```sh
node --test tests/sector-capture-supervisor.test.js tests/sector-market-capture.test.js tests/sector-daily-chain.test.js
npm run check
npm test
```

离线测试使用注入的行情快照，不会请求真实供应商。覆盖无授权禁止网络、预检零写入、单批采集、五分钟最小间隔、每日预算、3次失败熔断、403/429立即熔断、跨进程恢复、崩溃未完成请求、配置/状态指纹篡改、休市、并发锁和符号链接。不通过CI不合并。

**尚缺的运营工作**：数据使用授权核验；真实交易日/休市日历供应商；中国大陆节点网络可靠性；真实市场的 f124 有效覆盖率与连续失败样本；安全运行实例及私人监控告警。任何CI成功都不能替代这些验证。此模块不是实时行情认证，也不是自动下单程序。
