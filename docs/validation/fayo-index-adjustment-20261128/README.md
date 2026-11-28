# F27.1 指数调样日期及名单节选｜2026-11-28

本批接续原 #578，基线 `a3c189692f932915b13f29bf60fadf09a63fd27c`；总管 dev 实读 `b936ebdddb8c11948dd0e63f95332898dd5c1cf5`。保留 F42 已有资格及停用原因。增量仅为原新闻证据室的只读调样计划投影；不是新增指数主数据、账户、采集服务、资金流或交易资格系统。

## 处置、数据与实际消费

- **F27.1 分层/合并，局部证据**：复用 `src/core/news-evidence-journal.js`、原操作员 `scripts/news-evidence.js`、鉴权 `/api/research/news-evidence`、`public/nova/event-research.mjs` 与 `research.js` 的原文证据室。材料中明确的公告日、计划日期、收市后阶段及调出/调入名单在电脑和手机同源展示。没有权重和跟踪规模，不估算配置压力或实际买卖金额。
- **F27.4、F07.3 保持待验**：本批没有将再平衡时段接入异动阈值，也没有完成其他催化剂或全指数日历，不因同一日期展示重复认领完成。
- 两份实际上交所公开 HTML（2026、2025）及当前公告链接的 PDF 经原 `research-curl-bytes` 有界运输实际取得。最新 PDF 仅核对首个“上证50”表：调出5、调入5。与原页面同一上游，不作两源确认。源 URL、实际发起/接收、字节、SHA256 见 [source-receipts.json](source-receipts.json)。完整 HTML/PDF 留在开发私有目录，不分发全文。
- [news-input.json](news-input.json) 是明确标注 `provider-summary` 的少量日期引文和名单事实节选。当前记录的接收时间取 HTML 与所需 PDF 实际接收的较晚者；原始发布时刻未知。网页生成时间、PDF创建时间不充当发布时间。2025公告是本次才取得，不倒填为去年已知。
- 深交所指定页面实际返回503，未重试绕过、未导入、未计成功源。实时指数行情、成员与权重、被动基金规模及实际配置、持续采集授权/频率均待验。公开取得一次文件不是持续许可或生产接通认证。

## 输出合同

只识别指数成分/样本调整上下文。单一合法的“于/自…日收市后生效”或日期型实施声明可形成计划；冲突日期、冲突阶段及非法日期保持未知。不补午夜、15:00或原始发布时刻。状态按服务器查询截点（北京时间）区分未到、到日和过日；到日、过日均不认定实际实施。

名单只接受明确指数标题、调出在左/调入在右的列头、四列完整行和已登记的证券关联。反列头、重复/跨列代码、未登记关联、缺行或重复指数表保持未知。名单按各表绑定，首表不传播给其他指数；即使成功解析节选也不宣称全名单已核。仅展示材料中的计划，不改变当前指数成员。

原事件修订链决定该截点是否可使用：撤稿、被替代、关联移除和缺链停用；澄清、取消、延期等要求复核。历史版本与原始查询截点保留。`sourceVerified/canQualify/canTrade/canTrain/canNotify` 一律 false，资金、权重、跟踪规模为空。原账户、权益计算、审批与15秒执行报价门禁没有改动。

## 真实验证与范围

|层级|本批实际回执|限制|
|---|---|---|
|语法/差异|两份生产模块及两个验证脚本语法检查、`git diff --check`通过|不是全量验收|
|修前反例|新增12项在旧投影均失败，见 before.tap|不删除原测试|
|修后/相关|新增12 + 原事件19共31；含原日志/HTTP/隐私共49通过|0失败、跳过、取消|
|内核断网|原 deny-network-connect.py 阻断进程树所有新连接，非HTTP组48通过|本次未阻断服务外侧浏览器客户端|
|原生实际消费|原CLI导入两份实际节选，重复导入幂等；原鉴权HTTP、单股筛选、归档前为空、查看者拒绝均通过|不是生产数据目录|
|双端|原软件1366/390/320 CSS视口共12次流程，6次实际材料、6次单列合成撤稿/历史控制；浏览器外部请求全部阻断|不是实体设备或大陆线路|
|源工程完整回归|8071/8071，0失败/跳过/取消；原运行器完整性检查成功|父版与被测文件哈希详见回执|
|最终组合与远端门禁|待本次精确提交另验|未合dev、未部署|

[native.json](native.json) 绑定当时 Git 父版及被测生产文件SHA256，最终提交须逐文件核对；[browser.json](browser.json) 标注实际与合成输入。[手机实拍](actual-current-390.png)、[电脑实拍](actual-current-1366.png) 均来自原服务实际页面。合成撤稿单独标记。初次验证脚本未给单股读取传显式 asOf，原兼容查询不返回该字段，脚本断言失败；改为与原UI相同的显式截点后重跑，保留 native-initial-failure.log。不把该失败解释成生产接口损坏。

[performance.json](performance.json) 是同一实际节选重复为200个独立合成事件的配对投影成本；40次测量/版本，无额外请求。新增解析有额外CPU成本，没有声称提速或投资增益。首次探针与完整回归共享主机负载，记录不能外推为生产时限。GPU、数据库、供应商、队列及真实设备尚未测量。

## 复现、授权与回退

从 `V6_BO` 运行（输出使用新的隔离目录）：

```sh
node --test tests/fayo-index-adjustment.test.mjs tests/fayo-event-research.test.mjs tests/news-evidence-journal.test.js tests/news-evidence-http.test.js tests/news-evidence-ui-privacy.test.js
FAYO_STUDY_RECEIPTS=/tmp/fayo-index-replay FAYO_INDEX_BROWSER=../docs/validation/fayo-index-adjustment-20261128/browser.py node ../docs/validation/fayo-index-adjustment-20261128/native.cjs
FAYO_STUDY_RECEIPTS=/tmp/fayo-index-replay node ../docs/validation/fayo-index-adjustment-20261128/performance.cjs
npm test
```

沿原环境使用已有 PowerShell/本地模型解释器；不安装依赖，不添加外部API或模型。复验节选属于离线回放，本次实际取得来源的原回执另存；重新联网资料若变化须重新核对，不能覆盖旧回执。全量需原轻量/模型Python隔离及必要运行时。

现阶段授权仅研究读取。总管按源精确SHA及组合回执核对后再决定集成；正式用途、持续采集、真机、大陆网络、前向研究与配置压力价值独立签收。代码回退至原 `a3c1896` 仅撤销本批前端投影及测试；原新闻日志和新增研究历史保留，不用旧数据卷覆盖。F42先前回执及原风险机制继续保留。
