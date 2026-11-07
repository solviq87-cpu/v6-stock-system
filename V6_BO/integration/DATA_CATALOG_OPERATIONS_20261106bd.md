# 全部来源登记与访问范围 bd

基于bc1002完整包，SHA-256 1be321381b8726ffbd150afae1331a076dcc393fd8be30416d03fac992819fe0。用户要求全部免费来源接入，同时原合法合规约束保留。登记14来源不是14来源全部接通。

config/data-source-catalog.json区分实现状态与访问状态。新增Ashare/BaoStock Python可选适配，原mootdx/efinance/巨潮保留。默认仅BaoStock按发布方“免费中国股票数据/面向量化研究”的说明启用私人研究调用，证据https://pypi.org/project/baostock/；这不是免费商用或零处罚法律意见，仍须遵守官方访问规则。其余许可未明的公开来源，Python supervisor及worker在请求前拒绝，公开报价CLI也在构造网络客户端前拒绝。核心纯解析/测试函数仍保留。此前原始研究证据继续可读，并非新请求授权。

mootdx/efinance/cninfo/Ashare均permission-pending；腾讯/东财/新浪公开报价同样待核实。官方原生账号ifind/choice为credentials-required，当前仍仅既有标准化网关；iTick/JQData/Tushare凭证及免费档范围缺失，原生适配not-implemented，不伪称已完成；OpenBB是框架，不当独立行情源。schema2采集输出包含五源结果+全清单；读端兼容原schema1，双端详情显示状态和上游。

使用沿用scripts/optional-research-sources.py，安装requirements-research-sources.txt到隔离Python环境。新增baostock0.9.4。Ashare不按未核实的同名PyPI包盲装、不复制未知许可源码；仅预留导入已审核原项目Ashare模块的适配。BaoStock请求d日线、不复权adjustflag3，严格检查登录与查询错误、最多1000行，并清除SDK登录打印对JSON协议的干扰；不会写权威行情/资金账户。Ashare保留provider-dependent复权和上游标签，不冒充独立来源或同区间历史。

真实实测：BaoStock安装成功，SDK登录失败，结果unavailable；其他4源因permission-pending未请求。不是源数据成功。此前bc的efinance/巨潮成功记录保留为历史，不视为本版许可通过。

本轮访问审核参考：东财https://about.eastmoney.com/home/legal、https://about.eastmoney.com/home/protocol 对行情复制展示等有授权限制；同花顺https://news.10jqka.com.cn/clientinfo/protocol.html 免费自用条款不明确授予网页API批量采集；SDK许可不自动授予上游数据权利。该JSON是当前工程控制清单，不是法律证明；以后只能在取得适用许可/明确发布规则并记录证据后由维护人员更新，不能因为HTTP200就改状态。代码中的enabled标识同样不证明使用者满足全部法律条件。

边界：这些门禁只覆盖新增公开报价CLI与可选研究采集器，不声称已逐行审计原server.js全部历史采集路径。主服务仍未部署，旧入口/采集需后续完整访问范围核验后再运行。已有授权网关需实际合同与账号，不以配置provider名冒充授权。

余项：iTick/JQData/Tushare原生适配、Ashare依赖审核与真实调用、BaoStock目标机网络复测、源许可/数据用途核实、全市场长期运行、资金/概率/新闻完整闭环和六类现场验收仍待。无购买、无云部署、无CMR/券商连接，原四策略/账户规则/双端布局保留。
