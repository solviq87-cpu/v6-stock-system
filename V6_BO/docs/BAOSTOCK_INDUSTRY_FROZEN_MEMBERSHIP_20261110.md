# V6 BaoStock行业分类 → 冻结板块成员（2026-11-10）

## 既有主线
已合并的PR #76有同日板块强弱纯研究；已合并的PR #80复用现有V6全市场行情快照、逐票f124原始时间及冻结板块成员，输出明确标记equal-weight-constituents-proxy的研究评分。本批只提供一条有文档来源的行业成员输入：BaoStock官方 query_stock_industry。

官方字段：updateDate、code、code_name、industry、industryClassification；官方标注每周一更新。https://www.baostock.com/mainContent?file=stockIndustry.md

这不是概念板块数据，也不是正式板块指数的当日涨跌幅。BaoStock分类与V6公开行情上游必须分开溯源；公开接口不等于已经取得线上商用行情许可。

## 使用顺序：先分类，后报价
1. 操作者核实BaoStock和报价供应商的使用许可及访问规则。默认所有新采集都关闭，BaoStock SDK是可选Python依赖。
2. 北京时间当日、**现有股票行情批次开始前**，显式执行一次行业分类采集：

    python3 scripts/collect-baostock-industry.py --output /srv/v6-private/industry-20261110-raw.json --standard 证监会行业分类 --allow-research-fetch

   也支持申万一级行业（仅按供应商实际数据）。无 --allow-research-fetch 则不导入SDK、不登录、不发请求。输出是新建私有JSON，不能覆盖；观测完成时点不是原始成交时间。
3. 现有已获授权的V6市场管道取得同日全市场快照，内含 date、startedAt、retrievedAt、universeSize、stocks每票code、pctChange、vendorQuoteAt。将其保存为私有 /srv/v6-private/stock-snapshot.json；本批不添加网页抓取。
4. 冻结成员关系：

    node scripts/normalize-baostock-industry.js /srv/v6-private/industry-20261110-raw.json /srv/v6-private/stock-snapshot.json /srv/v6-private/industry-20261110-members.json

   仅处理已取得的数据：同一标准无重复、来源版本≤28自然日、采集时间先于行情开始、行情股票和映射覆盖率均≥80%、每行业≥5成员、至少3行业。分类身份SHA-256写入classificationVersion。成员文件私有权限0600且同内容幂等，不覆盖不同版本。生成的BS_哈希代码不是官方板块指数代码。
5. 复用PR #80已有的只读命令：

    node scripts/sector-strength-research.js once /srv/v6-private/stock-snapshot.json /srv/v6-private/industry-20261110-members.json /srv/v6-private/industry-20261110-study.json

   结果只能用于研究板块参与度与个股所属行业上下文，不能作为正式实时行情、交易、收益或已认证板块指数价格。

## 不可简化的限制
- BaoStock每周更新分类，不等于可以把上周导出的文件补上今日时间当成今日已知成分。必须保存真实来源日期和采集时间，禁止未来成分回填。
- 行业/概念要分别排名；本批只提供行业成分，概念关系另需合法来源。
- PR #80算法的板块变化是成员个股等权涨幅代理，不是供应商正式行业指数涨跌幅或真实资金流；逐票时点、休市和涨停证据仍需独立检查。
- 本批不碰public/index.html、public/mobile.html两张锁定主页、四套正式策略、模拟账户、资金风控与正式学习参数。没有云端部署、自动定时抓取或许可证认证。

## 回归
    node --test tests/baostock-industry-membership-adapter.test.js tests/sector-breadth-market-bridge.test.js
    npm run check
    npm test

只有真实有效的会员映射与可用数据且上述门禁通过，才有可比的同日研究结果。不声称已生成2026-11-10真实A股行业榜。
