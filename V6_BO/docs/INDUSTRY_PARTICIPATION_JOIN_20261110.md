# V6 当日行业成分股参与度：BaoStock分类 × 已有逐票报价（2026-11-10）

## 背景和口径
现有 PR #76（已合并）已经有同日板块强度纯函数、个股研究解释和研究工作台。那套算法需要同一供应商导入的 **板块指数涨跌幅 + 成分股涨跌**。真实接口未认证时，不得把成分股涨幅的均值冒充板块指数价格涨幅。

这一批新增独立的、可选的「行业成分股参与度」研究，把两种数据源保持**分别溯源**：
1. BaoStock官方 query_stock_industry 返回行业分类（每周更新，历史时点可查询）；当前只接受已明确标注日期、版本和完整结果的「证监会行业分类」或「申万一级行业」。来源文档：https://www.baostock.com/mainContent?file=stockIndustry.md
2. V6现有 fetchEastmoneySnapshot 可返回逐股股票代码、当日涨跌幅、提供方f124原始时间以及整批拉取时间。其商业使用权和供应商实时性**仍待独立验收**，不能把公开网页响应等同许可。
3. 纯函数 src/core/observed-industry-participation.js 和可选 researchLiveMarket({...industryClassification}) 在**同一已取得的股票快照**中按行业分组。**不发起第二次行情请求，不混合上游不同供应商股票报价，也不让BaoStock行业分类覆盖报价来源字段**。

## 研究指标
行业每组：有效成分股上涨、下跌、平盘数；上涨比例；个股涨幅中位数及相对本批有效全市场股票中位数的差；涨幅>=2%家数；正涨幅前两名占总正涨幅的比例；最多3只领涨股；试验评分、标签和同类行业排序。评分为40%上涨比例+25%（中位超额转换）+20%强涨家数比例+15%中位涨幅转换，领涨集中度>=70%扣12分。系数完全是研究假设，未做样本外校准。

**officialBoardChangePct 始终 null**，不假装这是申万/东方财富/证监会「行业指数当日涨跌幅」。默认全局实时原始报价覆盖及行业映射覆盖均>=80%；单行业至少5只、有效覆盖>=80%，至少3个有效行业才给出序号。每只股票供应商原始报价时间离本批接收时刻<=120秒，快照离分析时点<=180秒；停牌、缺价、日期错乱、未来时间或报价过时都不填0。分类更新日不得晚于报价日，默认不得早于报价日28自然日（仅是保守时效门槛，不代表分类在所有历史日期正确）。

## 如何使用
外部数据采集**默认关闭**；只在操作员确认使用场景符合BaoStock提供方条款时，可单次运行（同一目标文件只能创建一次）：

    cd V6_BO
    python3 scripts/collect-baostock-industry.py --output /srv/v6-private/industry-20261110.json --standard 证监会行业分类 --allow-research-fetch

不需要安装付费服务；BaoStock Python SDK是可选依赖，未安装时安全退出。该入口不会调用股票报价或模拟交易程序。查询时点、分类标准、版本与每条股票归属都写到0600权限私有JSON；采集时间 **不是** 交易所原始行情时间。注意官方API可能返回多个分类体系，采集器只保存选定的一种，同股票重复或分类版本不一致时拒绝发布。

使用现有行情研究/授权数据源提供的**已取得且包含f124逐股原始时间**的股票快照JSON（没有快照就不生成结果），运行：

    node scripts/observed-industry-participation.js /srv/v6-private/stock-snapshot.json /srv/v6-private/industry-20261110.json

也可调用：
    const {researchLiveMarket}=require('./src/core/live-market-research');
    await researchLiveMarket({fetchSnapshot,industryClassification:importedIndustry});

输出 industryParticipationStudy、sectors 和 bySymbol；可用于以后单独的行业研究页/个股原因说明。不带industryClassification时原研究API形状不变。CLI只读JSON并打印研究报告，不自动采集股票、不发布到客户端、不开消息推送、不写正式选股权重/模拟盘。

## 已知边界与未来
- **当前不是实时自动板块排行榜，也没有生产服务器/手机部署确认**。已连接的是研究用算法输入和来源适配，真实数据源权限、实时性、两源覆盖以及真实每日稳定性都没有独立确认。
- BaoStock行业分类不等于概念股；概念成分不能由行业分类推断。今后概念板块必须使用另一个合法授权、冻结当日成员的来源。
- 行业只是按个股涨幅等权观察；不代表市值加权、股票涨停、真实大单、净流入、板块指数量价或上涨因果。盘后/午休供应商时间更新不代表交易所成交；缺失真实交易日历时只做时点研究，不认证开市。
- 真实部署前需增加公开行情使用权核验、合法可用的板块指数价、跨源时点一致性和双端私有服务只读展示，再做历史滚动样本外验证。未经独立许可不启用周期抓取。

## 验收
    node --test tests/observed-industry-participation.test.js tests/live-market-research.test.js
    npm run check
    npm test

不可破坏约束：本批不改 public/index.html、public/mobile.html，四套策略及现有模拟盘、权威账本、风控和旧历史备份全部不动。以PR基线和CI回归为准，回滚可直接关闭PR或撤销提交。
