# bc修改及Bug记录

新增optional-research-sources.py、optional-research-view.js、optional-research-sources.test.js与可选依赖。共享风险投影/双端卡片读取固定服务端路径，禁止原始SDK全部字段或凭据进入页面；原策略/账户未改。

保护：SDK子进程超时终止；efinance失败不影响巨潮；公告ID/代码/时间/URL校验，不执行HTML，公告默认中性；不可覆盖历史观察；不把SDK名当新独立上游；不把历史或当日未完成K线标成实时，不将未核验单位写账本。

修复过程：把公告首次观察时间从请求前改到响应后时，一次文本替换误改了函数定义，首次干净复测有2项失败。语法检查和复测发现后已修复；旧失败TAP保留optional-first-clean-failure.tap，最终主工程/重新ZIP解压复测日志为准。最终源码再次真实采集成功，efinance/巨潮成功，mootdx失败。无已知最终测试失败，不保证无潜在Bug。

本环境SDK警告包括efinance pandas弃用警告，未静默当成错误通过；mootdx网络失败明确记录。单次公开端点探测不代表连续运行/交易许可。
