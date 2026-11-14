# 新增界面与模块联动参考 · B组

本批核查日期为2026-11-14，V6基线为`040692bcea3039cd707e1b7f52b5ad08ee77ebd2`。与现有41来源逐仓库去重后，新增6个独立项目。完整提交、根许可、12份实际读取的关键源码及Git blob指纹见[证据清单](UI_RESEARCH_SOURCES_B_20261114.json)。没有安装上游、运行其程序或测试，也没有复制其组件、样式、品牌和源码。

## 六种值得采用的交互机制

| 来源 | 实际核查的机制 | 适合天枢智策的取舍 |
| --- | --- | --- |
| [B01 TanStack Table](https://github.com/TanStack/table/tree/c14e0221b1e656c7bb35e7b3d4cdf188719a3599) | 稳定行ID选择映射独立于核心/筛选后的行模型；显式重置选择 | 所选证券或研究版本与当前筛选、分页分开；列表暂时不含所选项时给出可定位/清除状态 |
| [B02 TanStack Router](https://github.com/TanStack/router/tree/0b6d4f3f6b42e704555d9ff0014ddbf8b44f8e09) | 查询参数解析/序列化集中；保留和剥离有显式删除记录 | 用窄白名单恢复公共选择；清除优先于保留，返回/重载不能恢复用户已经清除的条件 |
| [B03 Apache ECharts](https://github.com/apache/echarts/tree/34f4d927eafe251f26f63afd3aeefa30f2feba30) | 同组事件转成动作后派发；pending状态与escapeConnect抑制循环，disconnect解除同步 | 股票/筛选变化携带明确来源和范围，只更新有关面板；渲染不能反向重发同一选择或触发重复采集 |
| [B04 Metabase](https://github.com/metabase/metabase/tree/5430ed963ed36bb9c3ed7abc1d960d7e697a47f1) | 点击行为区分筛选、跳转和重置；缺目标信息拒绝钻取；目标参数显式映射 | 联动入口写明股票/证据/研究去向；目标不可用时说明原因，不能默默跳到其他最新记录 |
| [B05 Plotly Dash](https://github.com/plotly/dash/tree/5f771e11051c175ee2a581c8719b2f3143c3238c) | 触发组件/属性和完整输入值分开；输入/输出依赖显式记录并做循环检查 | 把选择、过滤、查看详情与执行分析分为不同事件，初次渲染不伪造用户操作 |
| [B06 Streamlit](https://github.com/streamlit/streamlit/tree/0c8cc186f0db90eda8836f231bd4c160e267d288) | 控件稳定key、保留范围及URL绑定明确；导航恢复状态有优先级；禁用控件不接受伪造回调 | 公开选择可保留，私有细节按身份/权限失效；跨页保持不能变成跨账户泄漏，浏览器状态不能替代云端档案 |

上述均为从已读取源码与官方说明推导的适配建议，具体采用状态必须指向本轮实际代码/测试；列入清单本身不代表已经实现。

## 可以连成的一条真实工作流

1. 用户选择证券或既有记录，统一上下文只保存稳定身份；详情、关联依据和筛选视图从同一已授权响应取数据。
2. 筛选/分页改变可见集合，所选身份独立保留；若所选项不在当前可见集，显示这个事实及恢复/清除操作。
3. 点击依据/模块入口携带明确字段映射和目标。目标没有资料就显示缺失，不从其他证券或更晚版本补数据。
4. 消费面板更新后不重新广播来源事件，防止表格→详情→表格的循环，也不自动发起采集、分析、交易或推送。
5. 清除上下文、改身份、撤权、离线和迟到响应有各自的清理边界。撤权后保留公共导航不等于可以继续展示私有研究。

这条流程适合沿用现有研究内页、资料库、筛选与K线模块；无需增加第二个首页、堆叠大量新卡片、把框架整套接入或改变原四套策略。

## 许可与验证边界

- TanStack两项目、Dash根许可为MIT；ECharts和Streamlit根许可为Apache-2.0。第三方依赖、数据、地图、外部服务和商业版本仍须各自核对。ECharts也有NOTICE及licenses目录。
- Metabase根声明区分AGPL源码与enterprise目录的商业许可，已读根声明及AGPL Version3文本。本批只取通用交互原则，不移植代码/外观或推定取得商业嵌入权。
- TanStack Table当前固定源码与旧v8文档存在API差别；核心选择与筛选选择模型的分离不能解释为服务器尚未加载的行已被加载。Dash的MultiGraph此处用于循环检查，不能称为已验证的生产执行调度器。
- Router允许通用JSON状态，不意味着V6应把私有研究ID、账户、持仓、令牌或证据原文放入URL。V6只应传必要的公共代码及受控目标字段；私有版本身份留在受权限保护的状态和原后台档案中。
- Streamlit的会话内保留不是云端持久化承诺；ECharts图表联动也不证明数据源时间戳已对齐。这些参考不改变V6的原始报价时点、15秒门禁、权限、账户或唯一发布者。
- 这里未做上游运行、性能、移动真机、A股授权或收益认证；V6最终行为需用本轮实际回归和浏览器结果验收。

官方说明：[Table选择](https://tanstack.com/table/latest/docs/guide/row-selection)、[Router参数](https://tanstack.com/router/latest/docs/guide/search-params)、[ECharts事件](https://echarts.apache.org/handbook/en/concepts/event/)、[Metabase交互](https://www.metabase.com/docs/latest/dashboards/interactive)、[Dash触发来源](https://dash.plotly.com/determining-which-callback-input-changed)、[Streamlit控件身份](https://docs.streamlit.io/develop/concepts/architecture/widget-behavior)。

本次仅增加两份研究资料文件，JSON解析、来源去重、固定SHA/许可/源码链接字段核查通过；没有把历史上游报告记作本轮测试，也未变更运行代码、锁定主页或部署状态。
