# 跨模块整合审查修复

审查基线 `e49acde9946b7a4f7fe2a223f4317fa527fdd20e`。单独工作树验证A1资金连续性、A2批量最终发布、行情用途、B2成交证据、不可变信号、新dev PR #181观察队列及新闻撤稿之间的实际消费；不修改账户、原档案、锁定主页或正式策略参数。

## 本批修复

- **信号与采集队列身份串联**：`queuePushedStockObservations`保留push refs实际传入的合法`signalId`，映射为既有队列协议的`id`；没有ID的历史ref不补造，队列仍是未认证push-attempt，不冒充送达或首样本替换。真实队列落盘测试验证hash存在，legacy身份仍缺失。
- **新闻所有当前展示统一撤稿门禁**：新增`newsEvidenceVisibleState()`只读副本，将三类新闻数组及派生代码/板块集合按既有门禁过滤。两个dashboard入口及`/api/state`的列表、热点、消息板块、代码均消费当前视图；`dashboard.riskEvidence.news`不再通过原始goodAll重新引入撤稿。原始持久化历史保持完整。
- **未知新闻统计保持未知**：相关股票pct/mainInflow不完整时，平均涨幅、汇总资金和依赖完整涨幅的计数为null，并返回`availability`有效行数和完整性；真实0仍为0。直接/间接关联涨幅同样保留null，实际前端使用类型检查显示“未知”，不会通过Math.abs/null或数值转换变成0。此次修改的新闻标题/原因也经过现有esc转义。
- **隔离测试补全真实依赖**：funds tick及signal tick VM载入真实新闻门禁，使用空的私有fixture根；没有用恒true替身来掩盖条件。HTTP fixture只补两个版本化公开来源目录配置，以便真正调用完整`/api/state`，不复制用户配置/账户。

## 验证

修复前三个实际函数反例加真实HTTP撤稿用例共4项全部失败：queue丢ID、统计/关联行null变0、撤稿仍出现在state。新增基线157项中152通过/5失败，5项均为上述VM新依赖漏注入；修复后同一整合范围加反例共161项通过/0失败/0跳过。随后增加共享副本的代码/板块集合断言，最终受影响功能43项通过/0失败/0跳过。完整全量由主集成执行，不将此定向计数称为全量。

真实隔离HTTP依次执行CLI原文→修订→撤稿、读取state与dashboard风险证据、停止/重启后重读、观看权限拒绝和篡改unknown；只用临时文件/口令，没有真实供应商或消息外发。语法、diff检查及两张主页Git Blob锁定通过。旧root脚本与内层pending脚本无删除；#181的`research:stock`及`research:sector:relations`只在V6_BO新增，root原本无转发，属于原dev入口差异而非本批误删。

## 独立保留的证据局限

`paperAuthorityQuotes`可用新lastPx价格配合较早S.stocks的volume、preClose推导限价及状态。自动账本确实使用量参与率/状态/限价；当前fillEvidence只单列价格quoteAt，未逐字段证明同刻性。#181观察任务写独立研究目录，没有发现回填S.stocks/lastPx的自动研究导入路径。本批不通过添加全系统必需字段改变既有执行门槛；后续最小补强可附加独立量/状态/推导限价来源与nullable时点，不能把新价格时刻借给旧字段，也不能把所有字段称为已认证。

本地hash、公开源时点、fixture和测试均不证明现场行情许可、持续可用或收益。回滚revert本批提交，保留原始信号、队列、新闻、成交与研究档案。
