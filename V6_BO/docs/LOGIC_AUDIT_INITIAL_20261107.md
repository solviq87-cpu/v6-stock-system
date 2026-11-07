# V6 逻辑审计首批发现（2026-11-07）

状态：**静态代码审查已开始；未运行全量测试；尚未修改核心策略。**

## 审计基线
- 分支：dev
- 已读：`V6_BO/src/core/strategy-engine.js`、`V6_BO/src/core/market-regime.js`、`V6_BO/scripts/run-full-regression.sh`、两层AGENTS.md与package.json。
- 本报告仅列出代码可直接推导的边界行为，不将其等同于线上故障。

## 发现 A：缺失行情字段可能错误通过比较规则（待确认调用场景）
`strategy-engine.js` 中 `toNumber(v, fallback=0)` 对 `undefined`、不可解析字符串使用0；`Number(null)` 也是0。
例如 `evaluateRule({}, {field:'price',op:'<',value:10})` 返回true。
**风险**：缺失价格或指标可能被当作低值而通过筛选。需先定位实际调用方、确认业务允许值与历史策略期望，再决定采用缺失即失败还是显式缺失策略。

## 发现 B：空规则且零门槛策略可通过（待确认调用场景）
`evaluateStrategy({}, {rules:[],minScore:0})` 返回 `pass:true`、`hitRate:0`。
**风险**：错误配置或规则丢失时仍放行。需确认是否存在有意的空规则策略，避免误改。

## 发现 C：规则参数缺失也可能被当成0（待确认）
例如 `evaluateRule({price:1},{field:'price',op:'>',value:undefined})` 返回true；缺失门槛会被默认成0。
**风险**：配置缺失不一定报错，可能悄悄改变筛选结果。

## 后续验证
1. 搜索 `evaluateRule`/`evaluateStrategy` 的调用点及配置生成路径。
2. 编写能复现以上行为的边界测试，并明确期望；优先最小修复。
3. 运行 `npm test` 与关键策略/行情/模拟盘专项检查，保存实际结果。
4. 对比修改前后正常策略输出和异常输入行为，确认没有负优化。
5. 最后才启用自动守门；当前不得宣称已完成全量审计或已通过测试。
