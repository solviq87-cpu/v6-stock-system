# 绯曜 FAYO D组第五批｜统一来源目录快照与上游关系审计 · 2026-11-27

## 基线、任务和边界
精确基线 dev@0c45291d7156be8a1206f0bb272f3c719d5d2336。D01/D04/D48/D53/D54/D78 局部整改：全122路线目录静态分组、报告一致性、管理审计输出及共同依赖基础；D54尚未测量共同故障或共同错误，D48尚未完成双端管理页面验收。保留原122路线、原任务编号、原数据中心与唯一生产发布机制；#431/#433/#436/#439 原精确头不变。本轮检查 #427 两页、#430/#438/#436/#439/#410/#405/#407 文件清单，未发现这两个核心模块路径重叠；其余开放分支及所有历史PR完整冲突扫描仍待总管协调。未改共享任务总表或正式生产状态。

## 发现与修改
原 data-source-lineage.js 在初始化时验证目录并保留不可变路线快照，而 data-source-readiness-audit.js 直接遍历 require 缓存中的可变 JSON；其 routeById 又保存原对象引用。运行中意外修改目录对象即可造成计数、上游、访问分类、探测身份与已验证血缘不一致。离线复现删除原 baostock、追加未经登记路线以及篡改 Tencent 上游，发现旧审计接受错误目录或拒绝原正确身份。
修复为既有血缘模块导出经验证、分离的六个原始字段投影 registeredSourceRows；就绪度审计、探测身份匹配及分组都使用同一快照，原始 require 对象后续变化不污染审计。输出增加 lineage、5个 summary 统计和逐路线 upstreamResolved/upstreamGroupRouteCount/sharesCataloguedUpstream；保留原 schemaVersion、历史字段和上游判定兼容性。旧 upstreamUnique 实际代表上游已解析，而非独占；明确文案，不删除旧字段。multi: 仅为未解析声明，不计入明确发布者分组，不自动赋予独立性。保留原权限、审计去标识、探测状态、交易/通知禁止及所有已有数据。
注意：此修复不是对磁盘目录的签名认证或恶意进程防护；目录若在初始化前遭合法格式篡改，仍需部署完整性和独立来源认证。目录声明不是已验证原始发布者；共同故障风险仅获得静态关系基础，未测量相关性或真实故障。

## 精确目录静态复核
目录122条，114条属于73个明确声明分组，8条 multi 未解析；18个共享分组覆盖59条路线，55个单路线分组。东财9，腾讯4，新浪4，TDX4，Yahoo Finance4，FRED4，世界银行3，ECB3。未解析：ashare、cnequity-official、finance-datareader、openbb、qlib、vnpy、tickflow、ashareapi。新增机器可读关系图可通过现有 audit-data-source-readiness.js CLI 输出，无新服务或发布入口；73不是独立认证源数、可用源数或授权数。

## 真实隔离专项验证
在 V8 JavaScript 隔离执行器加载精确原生产文件和完整122条配置、原14条目录及真实 session 实现。使用最小同步 test/assert 替代执行器；未调用的网络模块为抛错桩。不称 Node 原生运行或完整回归。
原文件 blob：data-source-lineage.js 817048838ad9ba6abe02a1e308ac11a8bd695a98；data-source-readiness-audit.js 775739ff1dce167dd2aecc72104a5b855b176128。
新增7项专项：修前1通过6失败（含新增功能断言；2项直接复现原可变配置问题），修后7/7通过。覆盖分组守恒、同源及未解析、运行配置突变、探测身份匹配、投影分离、返回图修改不影响后续、原证据层级保持。正式测试使用 node:test/node:assert/strict。未实际联网、购买、启用服务、消耗供应商额度或扩大授权；原 Node 专项、异步运行日志读取、全量及双端测试、真实上游认证、5/20/60交易日观察仍待验。

## 后续及总管协调
复核原 data-source-lineage、data-source-readiness-audit、data-source-runtime-usage、fayo-source-review 以及 CLI / HTTP / 双端消费，避免历史报告误将 upstreamUnique 显示为独立。D01后续逐条实装/授权证据、D02真实权限及成本、D54实测共同故障、D48双端展示不能以本次静态分组代替。新报告字段为原接口增量，未创建重复数据中心。回退仅撤销本独立补丁，保全原目录、证据、账户与账本。最终合并及唯一生产发布由总管负责。
