# 绯曜 FAYO D组｜全市场分页采集时钟完整性补丁 · 2026-11-27

## 任务与去重
精确开发基线 dev@0c45291d7156be8a1206f0bb272f3c719d5d2336。D08/D10/D27/D37/D74/D78 局部修复，非整项完成；原编号映射由总管确认，不修改 TASK_MASTER/HANDOFF。首批 #431（7a426665fd1e0331de4205c5deea4a1448ece92b）已存在且远端 CI 排队。本批选取独立文件，保留 #431 的精确验收头。已核查 #427（两页）、#430/#431/#410/#411/#419/#423 变更文件清单，没有本采集器路径冲突；完整所有开放PR扫描因连接工具调用数限制未完成，合并前总管仍须逐一核对。

## 复现与最小修复
现有 eastmoney-market-snapshot.js 的 verifyClock 只将当前读数同请求起始时钟比较。第一页后/第二页排队中/最后收据前回拨但仍晚于开始时点，原逻辑会继续请求并生成貌似一致的快照。new Date(clock()) 还会把日期对象、字符串和小数强制转换为时间。改为验证起始时钟与每次读取均为合法整数毫秒，并记录本次采集已观察的最高时点；发现回拨立即拒绝整批。旧跨日、采样跨度、分页、队列、403/429、原始 f124 和研究用途限制均保留，不更改15秒交易报价门禁。
该高水位仅本次采集作用域，不能探测采样间未观察到的时钟跳变，不是跨进程单调时钟或真实交易所时间认证。

## 本地精确源码专项验证
Node v22.16.0。完整仓库直接 clone 因运行环境 DNS 无法解析 github.com 失败，公共 raw 获取亦不可用；通过 GitHub connector 取回源码并以 Git blob 验证：
- 原 eastmoney-market-snapshot.js: ead86eb15c59c2d3b11ecd2763689ceca6f6a8d2
- a-share-calendar.js: de3cf5148e6694ba72770800a779f6099052acb9
- market-snapshot-quote-time.js: 3cd7f7e1f223413199087c860d39f512f06d5610
- 本地修后采集器 blob: 6be61f7fd0c55aca6a189c2fdc40108c657ada22
- 本地新增测试 blob: 8c10a1f4e879a0c55519a128d721283a2314f590

命令：node --test V6_BO/tests/eastmoney-snapshot-clock-integrity.test.js。隔离测试树中的未调用 market-breadth 和默认 governor 导入以抛错桩代替，实际测试显式注入 governor 和响应；没有把桩提交仓库，不宣称真实限流器/市场广度联动测试。原文件与新增测试均 node --check 通过。修前 7 项 2过5失败；修后 7/7、零失败零跳过。失败反例：第一页时钟回拨、第二页排队回拨、最终收据回拨、非法采集时钟、非法起始时钟。原正常/冻结时钟、跨日和跨度测试继续通过。实际 TAP 本地哈希：
- before e964d5942a5ae551bb4e5f1970cddcaaa806d3f7b6b034004a44c4e94128096f
- after 453589653bdbab45caf8adf7e56cfe5429ffbcd9804ad0accad4d97024b3669c

## 边界及交接
本批不新增/启用数据源、不接触账户账本、不改生产发布、不购买服务、不消耗供应商额度。仍须精确远端头CI、既有 eastmoney-market-snapshot / market-temporal-integrity / research-client-request-budget / market-snapshot-quote-time / sector-market-capture / B组联动及全量回归；真实授权、联网、双端和5/20/60交易日观察均未验。另登记：后续须协调总管与B组复核快照审查/候选桥是否允许晚于原始接收时间的复核钟把原未来报价重分类；本批不编辑 #427 已修改的 live-candidate-bridge.js。若需要回退，只撤销本独立补丁，不覆盖历史数据、账本或原权限配置。总管负责最终合并与唯一生产发布。
