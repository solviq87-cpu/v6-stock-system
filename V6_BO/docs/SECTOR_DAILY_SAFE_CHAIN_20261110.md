# V6 板块研究安全串联：预检 → 冻结 → 当日排名 → 3/5日轮动

> 2026-11-10。仅对用户/操作者**已合法取得**的私有行情及行业数据运行；默认 preview 零写入；apply 才允许私有研究存档，不连接外网，不接真实券商、飞书推送或修改模拟盘。

## 为什么增加串联入口
此前已经分别实现 BaoStock 行业归属冻结（`normalize-baostock-industry.js`）、现有东财全市场快照转同日板块研究（`sector-strength-research.js`）和显式交易日历的3/5日轮动（`sector-rotation-history.js`）。独立调用可能遗漏行业版本门禁、重复写入路径或把旧报价当新快照。本批在不修改原脚本、交易逻辑、共享 `package.json` 或锁定两张主页的前提下增加一个编排层。

## 新入口
在 `V6_BO` 目录：
```sh
node scripts/sector-daily-chain.js preview /private/industry-raw.json /private/market-snapshot.json /private/trading-days.json /private/industry-members.json /private/sector-archive /private/rotation-archive
node scripts/sector-daily-chain.js apply /private/industry-raw.json /private/market-snapshot.json /private/trading-days.json /private/industry-members.json /private/sector-archive /private/rotation-archive
node --test tests/sector-daily-chain.test.js tests/sector-rotation-history.test.js
npm run check
npm test
```
`preview` 进行只读验证：完整行业分类、交易日历、同日原始报价、全部输出归档与重复归档冲突；不创建任何文件或目录。`apply` **须显式调用**，再次预检后才执行原有三个模块，写入私有归档，支持同内容幂等、停止后重跑而不修改历史。新建的全部归档由原模块以0600权限创建，旧数据冲突则停止，错误会标出失败阶段与已完成阶段。

## 必需输入与时点
- `industry-raw.json` 由现有 BaoStock 可选采集脚本导出；来源标签和分类版本在行情批次开始前冻结，首次运行仍需验证接口许可。无该文件不自动请求网络。
- `market-snapshot.json` 是现有批量全市场快照，保留每只股票供应商原始报价时间 `vendorQuoteAt`；观察完成时点距当前北京时间最多10分钟，当前快照须为当前上海市场日期。周末/节假日不会把上一交易日行情冒充今天。没有独立交易所交易日历认证，不称实时行情验证完成。
- `trading-days.json` 包含 `source:'imported'` 和至少3个严格递增且不超过30个的真实交易日标签，最后一天必须与行情快照一致。交易日清单由操作者从许可来源明确取得，不用自然日生成。
- 输出成员文件及两个档案目录必须使用互异的非公开、无符号链接的绝对路径，不得嵌套。只在有效行业和市场报价合格、同日可比行业至少3组时才准许 apply。

## 三段执行与失败恢复
1. `membership`：原行业适配器冻结 `classificationVersion`，拒绝同一路径不同版本写入。
2. `sector`：原模块读取本地快照和冻结成员，按交易日与原时点归档，输出仍为**有效成分股等权涨幅代理**，不等于正式板块指数涨幅。
3. `rotation`：原模块读取已有日期归档和明确交易日历，缺前两天/前四天时3日/5日强度结论为 `unknown`，绝不补0或猜测。
如后一阶段报错，前一阶段的不可变档案保留。先核查异常原因和历史文件，修复冲突后重试同一输入可复用旧档；严禁随意删除实际历史归档。单写入锁避免同实例重复写，残留锁需人工核查。

## 当前完成边界
这是**本地已取得数据的可重复编排入口**，没有自动配置中国大陆云主机、定时运行进程、实时采集授权、真实盘中连续稳定性或手机终端送达。研究字段 `canTrade=false`、`verifiedLive=false`、`weightsChanged=false`，不改变原四套选股策略、原有排序、账户/模拟盘或生产学习权重。之后须追加允许的自动采集、交易日历可靠来源、来源异常监测以及冻结因子的1/5/20日样本外验证，才能讨论智能化调整。

## 回归用例
专项测试覆盖预检零写入、全流程一次完成、同日重复幂等、历史窗口不足、报价过期/未来、分类时间和来源非法、重复/错序日历、已经存在的内容冲突、分阶段崩溃后重新恢复、符号链接/公开目录与并发锁。CI需全绿后才允许合并；测试样本都是合成的协议数据，不代表2026-11-10真实行业排行榜。
