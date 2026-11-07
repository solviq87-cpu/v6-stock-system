# mootdx / efinance / 巨潮研究输入 bc

以bb996完整工程为唯一新增基线，SHA-256 f88bac44a49fefeb392f06eeb7f6710115622165461762a6493a77f2ce4e6262。保留旧三路实时/公开适配、策略与账户规则。本轮新增可选隔离Python研究采集器，不默认安装到主服务环境。

```bash
python3 -m venv /safe/feed-env
/safe/feed-env/bin/python -m pip install -r requirements-research-sources.txt
/safe/feed-env/bin/python scripts/optional-research-sources.py --code 600519 --start 2026-11-01 --end 2026-11-06 --output /safe/new-observation.json
V6_OPTIONAL_RESEARCH_FILE=/safe/new-observation.json npm start
```

日期须换成实际范围，end不能超过上海当日，最大366天，仅60/68/00/30证券。默认一次采集，每源独立子进程、25秒超时终止，三源并行；不自动高频轮询。输出必须是新文件，暂存fsync后硬链接发布，不覆盖历史。失败/超时是结构化状态，不把空数据当0；同批允许部分来源成功。不要把pip虚拟环境或凭据打包。

mootdx请求近20根日K，SDK并未应用用户start/end，报告queryRangeApplied=false，不能冒充同区间回测。efinance以fqt=0请求未复权日K，资金流为供应商最近历史，不应用start/end，flowQueryRangeApplied=false。日K可能含尚未完成的当日K，intradayFinalityVerified=false；成交量仍provider-native，不能直接写权威回测/模拟盘。资金原始净额不直接当账户真实身份或买点，UI明确单位待核验。efinance上游仍东财，不能算独立新供应商。

巨潮只请求一页最多20条，代码精确过滤，保留公告ID、原标题（去HTML）、源发布时间、收到时间和固定static.cninfo.com.cn原文地址。原时间精度未认证，不冒充精确盘中首次公布时间；方向统一中性，未做情绪预测。不会自动全量翻页、补历史更正版本或下载PDF。每批独立新文件保留观察，不是跨批自动去重/更正数据库。

主服务仅从固定V6_OPTIONAL_RESEARCH_FILE读取，限制大小/来源/时效24小时/公告链接与未来时间，投影不含原SDK全部记录或账号。手机电脑共享riskEvidence，显示研究状态、K线条数、可用资金净额及公告；24小时是研究快照可读期，不代表实时有效。卡片仍观望，不生成个人加减仓/清仓或概率。

实测：隔离Python3.12安装mootdx0.11.7、efinance0.5.9成功；mootdx通达信TCP节点网络不可达并退出失败；efinance真实返回2026-11-02至11-06共5根日K及最近资金流；巨潮HTTP200返回1条公告。记录见optional-live-probe.log、optional-live-result.json、sdk-real-probes.json。仅一次真实采集，不是长期/高并发/目标云电脑验收。mootdx旧文档域名当前指向域名出售页面，以仓库/安装代码为准，不依赖旧域名。

未完成：mootdx目标云网络重试、行情单位/停牌/公司行为/日历/当日完成门禁后正式导入、资金流单位独立核验、公告跨批更正/原文解析/利好利空因子、公告授权与接口稳定性、全市场采集、真实概率与收益及六类现场验收。无购买/注册/部署/券商连接。Ashare/BaoStock本批未安装接入，iTick/JQData/Tushare待相应账户权限，OpenBB暂缓。
