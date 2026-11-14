# 研究版本、导出与权限清理改进

用户在八张概览卡后要求继续改善。本轮优先修复实际可复现的内容一致性和权限清理问题，初始基线`dev@5ce7795af5d6cc280ac579f216daedd933a0880f`，已纳入#231逐提交检查规则和#232源码归档，最终整合基线`dev@79eca81254eaf2384a9f03bc31cc2113bb8d0780`。旧UI草稿、原八项功能与已交付资料库不重复开发。

## 具体问题与修复后的行为

| 场景 | 旧行为 | 本轮行为 |
| --- | --- | --- |
| 选中旧研究，再翻页/重读/保存偏好/切换分页页签 | 只有首次选择携带runId，后续默认到最新研究 | 所有读取保持已选完整runId，页面显示短记录ID及选中边框 |
| 导出旧研究 | 请求没带runId/asOf，文件可能是最新记录，而页面仍显示旧版本 | 仅已成功读取且无请求在途时允许导出；固定可见runId、查看时点asOf和筛选批次screenId，沿用当前对照/筛选/分页 |
| 切到第二页，对照版本不在当页20条中 | 重建下拉菜单删除已选项，下一请求丢compareId | 保留实际选中的选项并标记；批次选项也不因目录截断静默丢失 |
| 想看新结果 | 重读默默切版本，用户无法分辨 | 新增“查看最新研究”，明确释放旧选择并读取最新，返回后固定新记录 |
| 服务端撤权而浏览器token文字未变 | 详情已清，但偏好、未完成事项、文件与旧选项仍可见 | 401/403/locked清空私有表单、文件预览、选项与概览，禁用旧导出/预测操作 |
| 迟到的旧成功/旧403 | 有清空新状态或恢复旧状态的可能 | 所有响应变更继续验证generation、token和页面可见性；旧成功不能复活，旧拒绝不能擦掉新结果 |

## 选择与数据口径

- 固定选择只在当前页面内存中，不写浏览器存储或账户档案。读取成功即固定实际返回记录；整页刷新/离开或身份失效后按原权限重新读取。
- 筛选状态/最低分、筛选批次或对照变化保留固定研究；股票、比较来源、历史时点或token变化释放研究和旧对照。历史时点变化另清除可能晚于该时点的旧screenId。
- “比较来源”仍是原比较/分析POST的来源选择，不冒充GET历史目录供应商过滤器；页面显示研究本身的实际来源。
- 请求失败不退回另一个版本；普通网络错误保留用户未提交的可编辑草稿，旧结果和导出不可用；权限失效时私有草稿也清除。
- 导出继续由原后端校验与生成，账户成本/持仓/token等仍按原scope遗漏；不在客户端拼造行情、评价或模型结果。导出只读asOf使预测写入标志不可用是预期，未替代正式账户收益。
- 正常读取期间旧详情/概览先清除，导出及预测控件等待响应，避免操作过期结果；同名同秒记录用短ID帮助辨识，实际查询始终用完整64位ID。

## 文件与验证

主要改动`public/assets/research-workspace.js`，研究内页增加一个明确操作按钮与原选中样式。后端API/策略/账本/存储格式无改动，锁定主页字节保持。

新`ui-research-selection-check.js`使用实际W/S/D与28条同股、另一股票/来源及43条筛选记录，验证旧版本、偏好写入后读取、对照跨页、未来新增记录不进入当前导出、精确导出screenId/ID/asOf、返回最新、上下文释放；四种视口320/390/430/1536。原工作区浏览器增加401/403/200locked、未提交偏好/两种文件、迟到成功与迟到拒绝两种竞态，同样四视口。无出站、生产账户或模型运行。

基线实际浏览器证据显示：导出ID由旧04-09记录变成新04-10记录而屏幕仍旧；compareId在第二页消失；403后私有输入残留。未把源码猜测当复现。

初期浏览器脚本问题已更正：夹具把decision当event.data导致播种失败；一次权限脚本在HTML/JS编辑未结束时启动而超时。最终在稳定源码上重跑；旧概览脚本依赖的“未完成”状态前缀保留，权限原因补在其后，没有减少原断言。

复现命令（V6_BO目录）：

```sh
NODE_PATH=/opt/codex/cua_node/lib/node_modules V6_UI_BROWSER=/usr/bin/chromium node scripts/ui-research-selection-check.js
NODE_PATH=/opt/codex/cua_node/lib/node_modules V6_UI_BROWSER=/usr/bin/chromium node scripts/ui-research-workspace-check.js
NODE_PATH=/opt/codex/cua_node/lib/node_modules V6_UI_BROWSER=/usr/bin/chromium node scripts/ui-research-summary-cards-check.js
NODE_PATH=/opt/codex/cua_node/lib/node_modules V6_UI_BROWSER=/usr/bin/chromium node scripts/ui-model-forecast-check.js
V6_MODEL_PYTHON=/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3 V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
```

本地实际结果：全量3540项，3537通过、0失败、3可选ML缺失跳过；研究专项8/8、交接与CI政策10/10、网页40/40及构建/dist、Windows打包12/12、完整工程打包5/5、隔离完整服务真实HTTP、运行依赖与工作流检查通过。新选择、扩充权限、原概览和原预测四组浏览器各320/390/430/1536全部通过；独立只读复核未发现阻断。完整全量在整合#231后运行；#232仅归档/工具/交接变动，最终组合由精确head CI再验。

最后精确head CI、合并状态见本分支PR机器回执。未做生产发布或Safari/Android真机1:1认证。延后的键盘页签ARIA问题只是候选，未在本轮宣称完成。

## 恢复

初始基线完整归档`base-5ce7795.tar` SHA256`b5e0ca33df4b74e6d6a358060c0fe0d09626156c572aa2d4dcdf680dae51f6f2`。最后回退revert本批提交即可，保留原研究/预测/账户和#230/#231归档/CI成果；不删除用户数据，不新增发布者或替换受信发布文件。
