# 绯曜 FAYO D组第六批 · 五个小任务联合整改 · 2026-11-27

精确基线 dev@0c45291d7156be8a1206f0bb272f3c719d5d2336，不替换前五批 #431/#433/#436/#439/#441 的分支及验收头。五项为局部小任务，不代表五个D大项完全验收。全量开发、授权、现场观察、总管最终集成及唯一发布机制不变。

## 一、任务1：免费接口权限、额度与成本复核（D02/D03/D73/D76 部分）

2026-11-27 官方页面资料复核；未发起任何供应商业务数据请求、未注册账户、未使用用户凭证、未购买或启用服务。条款、费用、额度均为文档声明，不是本系统实际取得的权限或可用率。

| 现有候选 | 官方文档声明 | 当前建议及证据边界 |
|---|---|---|
| TickFlow | 匿名历史日K无需注册；不提供盘中实时更新。注册免费档10次/分钟、单次最多5个标的；Starter 49元/月、Pro 99元/月、Expert 199元/月（页面A股套餐展示）。 | 历史研究优先；免费档容量不适合作为全市场15秒主源。交易时点、真实独立上游、复权、许可仍待验。 |
| AShareAPI | 免费报价5分钟刷新；自动化匿名请求2次/分钟（浏览器5次/分钟），报价单次最多5个标的。价格对照页展示9.9/29.9/99元买断档、199元/月机构档；29.9元标准档标注10万次、120次/分钟。 | 延时展示或低频研究候选，5分钟不是15秒报价。文档声明 volume 为手、amount 为元，quote 时点主要为交易日期；须实测字段与证券身份。不同页面总体端点数不一致，不写成已确认覆盖。 |
| Tushare Pro | 120积分非复权日线免费试用；50次/分钟，频次表列8000次/日；stock_basic、daily_basic等需更高积分；实时日线 rt_k 和分钟等需独立权限。 | 可评估盘后日线与回测；没有账号授权证据，不假设已达到积分，不等同盘中报价。分钟文档说明研究学习用途限制。 |
| iTick | 官方股票 quote 文档明确 s 为字符串、t 为最新成交毫秒时间示例、ts为交易状态；未经许可不得二次分发。 | 本批仅收紧现有适配器；套餐价格、用户实际授权、A股覆盖和来源独立性未核实，不启用服务。 |

官方文档：
- https://tickflow.org/pricing/
- https://tickflow.org/
- https://ashareapi.com/docs/endpoints/quote/
- https://ashareapi.com/docs/endpoints/usage/
- https://ashareapi.com/pricing/compare-tiers/
- https://ashareapi.com/pricing/standard/
- https://ashareapi.com/changelog/
- https://tushare.pro/document/2?doc_id=290
- https://tushare.pro/document/1?doc_id=27
- https://tushare.pro/document/1?doc_id=25
- https://tushare.pro/document/1?doc_id=372
- https://tushare.pro/document/1?doc_id=234
- https://docs.itick.org/zh-cn/rest-api/stocks/stock-quote

现有目录不新增重复候选，不改授权或采集频率。优先历史研究复用、真实权限确认和受控低频验收；不通过伪装浏览器、代理、重复账户或其他方式提高额度。具体购买与生产启用必须另获明确批准。

## 二、任务2至5：实际代码

2. iTick HTTP完成性和来源直连门禁（D08/D40）：只接受 HTTP 200 和 ok===true；复用原 hasQuoteRedirect，拒绝显式或隐藏重定向及不一致状态，读取正文前拦截，不追随、不重试。
3. iTick 证券与凭据合同（D39/D40/D41）：依据官方 s 字符串合同，拒绝数值/数组强制转换；拒绝首尾空白和控制字符凭据，传输前拦截，原未配置、停牌、旧行情、报价时间及未授权限制保持。原测试成功响应夹具补真实 HTTP 200，七项原测试逻辑保留。
4. 授权网关快照与历史报告因果（D27/D28/D35/D41/D78）：严格要求合法整数毫秒时钟、六位字符串证券代码；保留15秒边界；报告读取同时按原 generatedAt 和本次审计时刻校验，不允许事后收到的报价回填旧报告。
5. 授权网关响应、采集及发布安全降级（D08/D27/D40/D49）：拒绝非200/隐藏跳转，坏来源不影响正常同伴，缺证据保持 insufficient；非法初始时钟阻止网络，非法或倒退的最终时钟拒绝生成报告。该检查不宣称完整逐采样/跨进程时钟保护。

实际改动仅 iTick、parallel-market、原测试夹具、新增9项测试、本文档；复用原重定向辅助模块，未新建数据中心、自动采集入口、付费服务、交易权限、生产发布。B组 #407 同时修改 public-quote-probe.js，本批没有覆盖该文件；核查 #427 两页和 #430/#440/#438/#436/#439/#441/#410/#405/#407 文件清单，未发现本批目标生产模块重叠。其余开放及历史分支仍需总管最终冲突检查。

## 三、原生 Node.js 专项证据

原文件精确 blob：itick-stock-quote.js 51b66c561f7597e1850f369129ace61b869139c0；parallel-market.js a43da3446e2518dee9559fbea1de2a7ce47518ca；public-quote-redirect-policy.js 2c0f3656e26d22f49026dc1027f681230e0e2cef；itick-stock-quote.test.js 08fff72344ebc0ca3546e2c120d9fa9eaca527bf。

本地原生 Node v22.16.0：对9个新增反例运行 node --test，修前0/9、9失败，修后9/9。组合原iTick七项测试，16/16通过、0失败0取消0跳过。三个新增/修改核心与新增测试 node --check 通过（两核心加新增测试共三文件）。全部采用离线注入 Response，不真实联网、不消耗供应商额度。
完整仓库 clone 受 DNS 无法解析 github.com 阻塞，隔离恢复上述精确原文件；parallel-market 唯一未恢复的业务依赖 market-data-center 用从精确原源码摘取的原 validateSourceUrl 函数作为本地夹具（不提交），不宣称完整应用、原全量及真实接口已验证。
修后精确预期 blob：iTick 8f80e5aa25123a8e4b33bc080e48c9b6ea9b4f59；parallel d01a8b7bb6ce78f6592ccbb6fdae6ef371b7f769；新增测试 c00be74b74e98ad174bf857ad18bdd9085948b3a；原测试夹具更新 3e38660ef4db3d7f2cd57c56ac82d7898102afd3。
TAP SHA256：修前 35ae93189fd6a477c1698bf0b87778e5031e800bde6a63599acd7a1b1439417f；修后 b4995d2f525f03075c4411f1d55abf8a834f87e8ef53aece829671428e6dea6c；组合 957eb161699ad7e45e5f96fd7d451475ed51008ab794de2bb5b380abf080ffa6。

## 四、验收与总管交接

此前 #431 的 V6 PR Commit Coverage 失败日志实际显示精确提交 7a426665fd1e missing-smoke-status；不是已确认业务断言失败。详见 https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45930807136/job/140282730094 。总管须保留并补齐每个精确提交的合法冒烟证据，不绕过检查。本批待精确远端 CI、原 parallel-market / public-quote-probe / multi-source-price-consensus 及全量、双端、真实授权与联网、5/20/60交易日观察。未合并、未部署、未发布；回退只撤销本独立补丁，不覆盖历史证据和账户账本。
