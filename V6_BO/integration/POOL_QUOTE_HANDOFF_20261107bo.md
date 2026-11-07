# V6 20261107bo 续编交接

唯一基线：V6_1083_full_20261106bn.zip，SHA-256 f5fa0209f6b2045933cd3662600ab08b880c35ac3f3da8fae88619bc72ac8e78，已实际校验SHA与ZIP CRC。完整保留基线文件。

本批完成：精选池、趋势池、连阳池在复制价格时同步保留同一行的供应商来源与原始报价时间；防止源行有证据、入池却丢失证据。新增quoteSnapshotFields只复制白名单标量，不从股票代码对应的其他快照借时间，不以接收时间代替原时间，不授予canTrade=true。缺时点仍未知，旧/未来时点照原值投影为stale/future。原打分、筛选、排序、交易门槛与账户历史保留。应用与双端缓存五处、共用仪表盘侧栏统一20261107bo。

新增7项回归，定向22项全通过；npm run check及变更模块/共用仪表盘语法检查通过。主工程全量1090通过、0失败/跳过/取消、退出0，93719.716018ms；完整暂存ZIP独立解压副本全量同为1090通过、0失败/跳过/取消、退出0，130617.278527ms。两份TAP完整性核验通过。1093个JS/HTML/CSS/Python源码逐字节一致；独立复测后仅补报告、日志和完整性清单，不改产品源码。

正式日志：integration/pool-quote-full-20261107bo.tap/.exit、pool-quote-clean-20261107bo.tap/.exit；正式定向pool-quote-targeted-final-20261107bo.tap。首次准备脚本碰到另一个同名scored.push后主动停止；当时的定向失败日志保留，不作为正式结果。详见POOL_QUOTE_OPERATIONS_20261107bo.md及POOL_QUOTE_DIFF_20261107bo.json。

仍待：源头本来没有逐票原始时间的全A列表，三类池仍显示未知；其他旧页、研究/信号、指数/板块/跨市场价格消费者未全部审核。盘中连续行情、许可/账号/限频、220只监控容量、真实新闻、独立样本外概率、持仓闭环及短信/真机/长期云端/跨机灾备/真实策略效果继续待验收。测试数量不是项目完成率。本批完整代码没有自动替换先前只读历史样本网页预览，不把它称作完整后台上线。未购买付费接口或服务，未接券商。

运行：先读AGENTS.md与integration/CHAT_HANDOFF.md。Node22.6+、Python3、Linux util-linux flock；ML解释器按目标机指定并有sklearn/numpy：

```sh
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node scripts/verify-tap-completeness.js integration/pool-quote-clean-20261107bo.tap
npm run check
npm start
```

不要把本地副本角色配置带到线上。跨账号请下载完整ZIP与本报告重新上传，私有链接不自动授权另一账号。
