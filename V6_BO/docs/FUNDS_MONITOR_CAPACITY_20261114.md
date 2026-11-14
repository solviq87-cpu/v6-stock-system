# 资金未知值与超容量持仓监控

基线 `dev@9d15c034177445c071b32cb2a5b2226f656b46eb`，分支 `fix/funds-monitor-capacity-20261114`。
已先核对两级AGENTS、当前远端、活动PR、较新A1/A2成果。#221的Excel导入是独立候选，本批不覆盖。

## 实际缺陷与增量

- `intradayStrongScan`仍把未知/异常资金转成0。复用`fundsNumber`/`fundsRounded`，两个字段独立校验；API和缓存未知输出null，不增加资金分。真实零、正负资金、原评分阈值/权重和既有模型中性值不改。
- tick固定截取前220只，超出的持仓可能永不请求。新`src/core/monitor-capacity.js`保持每轮最多220个唯一代码：正常容量保留原顺序，超容量持仓按代码稳定排序轮询，持仓始终先于原候选前100/板块前20领涨代码。稳定集合在`ceil(N/220)`轮可轮到全部代码；不保证请求成功或有效行情。
- `S.loop.monitor`随原loop接口输出聚合快照：持仓、请求/延后/通过原报价门禁数、覆盖率、最大有效报价年龄、检查时刻、集合变化与采集失败。无新增股票代码/成本/账户明细。`checkedAt`只是该轮返回时快照，不能当作以后读取时仍有效的实时覆盖认证。await期间持仓变化按当前集合计数并标`heldChanged=true`，不得标完整。
- 未请求股票清除旧资金窗口，不把轮空接成伪连续。原15秒/同日/来源/未来时间/只读源门禁不变，缺失行不补覆盖。
- 全账户去重持仓达到220时，`paperBuy`暂停自动增加买入并登记`buyMonitorCapacity`；同次多候选逐笔重验，允许已通过的第一笔正常提交。这是保守总容量门禁，即使另一账户已持有同代码也暂停新增买入。原卖出巡检、T+1和逐票报价门禁继续工作。

## 范围与退化

超容量轮询不增加供应商预算。轮空会中断12点连续资金窗口，相关信号可能无法形成，不能用旧点/填零/刷新接收时间维持信号。本批只修一个旧资金消费者；`themeStrengthOf`及一进二/连板扫描其他填零仍待逐路反例，M09/Q09未全部关闭。

未改锁定主页、正式四体系、权威账本协议、历史记录、生产配置或唯一发布者，无数据迁移，未连接券商或发送真实通知。供应商许可、盘中长时/限频、Windows/真机及24项现场验收仍待；静态单HTML主机不能运行完整后端。

## 实际验证

- 新资金专项：精确基线1通过/3失败，修复后4/4；覆盖真实0、null、缺失、异常、正负值、独立字段、缓存及原有效评分。
- 首批容量9项：基线2通过/7失败，修复后9/9；再加661只多轮、采集中持仓变化、同批219→220，共12项通过。
- 最终关联8文件66/66。中间旧VM缺require的1项失败已修加载环境，原成交价断言保留；旧源码标记用例改随新planner加载，原池外持仓首位/101只断言保留。
- 语法检查、完整服务隔离HTTP启动、网页构建/测试与dist一致性通过。
- 首次全量3441项：3424通过/14失败/3可选ML跳过。14失败均为默认轻量Python缺模型依赖，使用环境现有、符合仓库固定scikit-learn版本的模型Python重跑，未改模型测试/门禁。最终全量3444项：3441通过/0失败/3可选ML跳过；TAP完整性校验通过。远端CI以对应PR精确head为准。

```sh
cd V6_BO
node --test tests/monitor-capacity.test.js tests/intraday-strong-funds-integrity.test.js tests/paper-original-quote-time.test.js tests/paper-execution-observed-price.test.js tests/paper-coherent-row.test.js tests/funds-monitor-continuity.test.js tests/production-signal-evidence.test.js tests/governance-signal-evidence.test.js
V6_MODEL_PYTHON=/path/to/python-with-pinned-model-dependencies V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node tests/full-server-isolated-smoke.js
```

日志及独立源码备份：`/workspace/artifacts/v6-20261114/`。备份SHA256：`40138cf26ef1bac1c918f8a46c645d6c0b18a12a7f44007bc8d58ac168a4a513`。资金精确基线另存`/workspace/scratch/intraday-funds-evidence/`。工作区留存不等于跨环境备份/远端CI。

## 回滚与发布

单独revert本批提交即可；不回填旧行情、不迁移账户、不用旧包覆盖dev。生产未部署；后续须遵守原唯一发布器、精确SHA/CI和完整读回门禁。
