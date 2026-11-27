# D组第39批：10份现有候选验收清账（2026-11-27）

## 范围与结果
用户要求优先完成原任务，单轮10项。本轮重新核查10份已有候选的精确head、base、合并及CI状态；这10项是验收核查，不是10个新增原任务完成。原D组金融数据接口专项任务书正文尚未恢复，资料库与既往会话检索未取得原编号定义。原覆盖62/78，待核对16/78，完整正式验收确认0/78，不能重新命名或冒充完成。全部10份PR读取时open、未合并、mergeable=true，后者不等于通过保护分支。运行状态是查询时快照。未返回指按head查询未返回PR workflow run，不等于没有执行或失败。

| PR | 精确head | 内容 | V6 CI | UI | 提交覆盖 |
|---|---|---|---|---|---|
| [#555](https://github.com/solviq87-cpu/v6-stock-system/pull/555) | `bbaab4eb6318a4672d5551480c15dae2b603ecc7` | ECB传输 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45997113584) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45997113507) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45997113455) |
| [#553](https://github.com/solviq87-cpu/v6-stock-system/pull/553) | `d66715c75126dcf56a8bd53a8c14deb644ad7bcf` | EIA传输 | [运行中](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45994724951) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45994724918) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45994724968) |
| [#550](https://github.com/solviq87-cpu/v6-stock-system/pull/550) | `4ec47b6eaa226f0fd22c32c84761412630e56990` | 海外报价边界 | [成功](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45989141913) | [成功](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45989142128) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45989143555) |
| [#547](https://github.com/solviq87-cpu/v6-stock-system/pull/547) | `1c5e7c64df96a2d176711f3a1f73cf0ab3c92726` | 港美日股票参考 | [成功](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45988347142) | [成功](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45988347005) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45988346806) |
| [#543](https://github.com/solviq87-cpu/v6-stock-system/pull/543) | `a20b2180e1bc859c7034333bff10c4687c82d936` | 证券生命周期 | [成功](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45981273970) | [成功](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45981273821) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45981273803) |
| [#541](https://github.com/solviq87-cpu/v6-stock-system/pull/541) | `df224124d3c04d2ab95c770362c1bc3bd8b5339b` | 原生四套策略输入 | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45980101295) | [成功](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45980101286) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45980101261) |
| [#538](https://github.com/solviq87-cpu/v6-stock-system/pull/538) | `6376bcfa0f16b451df75f97e1bed2ae508135664` | 外汇商品 | 未返回 | 未返回 | 未返回 |
| [#518](https://github.com/solviq87-cpu/v6-stock-system/pull/518) | `1a8035142ba7420ce59447d188b0339f895ce78e` | 历史存证组合 | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45971906910) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45971906885) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45971906883) |
| [#517](https://github.com/solviq87-cpu/v6-stock-system/pull/517) | `758022ceab24ec5306f016393fe842c96ba4e8df` | 缓存回执绑定 | 未返回 | 未返回 | 未返回 |
| [#509](https://github.com/solviq87-cpu/v6-stock-system/pull/509) | `342fc8f3e508345faf1f3305817fd865b007c9b3` | 调度时钟验收 | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45963778265) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45963778251) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45963778329) |

## 实际故障及本次处理
- #541 verify job 140441528302：6628/6629通过，唯一失败是 phase4-native-daily-evidence.test.js 的 future dated fund history cannot change the native eight-word result。实际原日志显示原评分60.4、unknown结论、观察结论、资金流缺口等未变，差异为新增 rejectedDataInputs: ['fundDays'] 和 sourceEvidenceVerified:false。
- 本次测试补丁只修改原失败用例，比较除两个新增诊断字段以外的全部原字段与baseline深度相等，同时强制验证 future/late fundDays 拒绝原因及资金回执 fundReceipt 拒绝原因、sourceEvidenceVerified=false、baseline未带拒绝字段。保留真实评分、未知及证据完整性断言。未改生产代码。读取精确原测试blob 6e6edf56babcf2803cd0d2803e3f4d2adcccb230，新blob 14c53631bc4bed0cc40de76495f5ba531df93b65，提交99eadb0a0d5e9db7423db910e8c091b172405c9b。V8语法校验通过，尚未重新执行原生策略测试或全量CI，不声称转绿。
- #550 coverage job 140472246047：三次提交缺逐SHA smoke status，不能以全量CI成功伪造该状态。
- #518 verify job 140414111184：6608/6615，7失败；#509 verify job 140387495695：6565/6572，7失败。历史合并链上的故障需总管结合实际根因协调；未在本次宣称修复。
- #553 visual-geometry job 140491151485：候选追高后毛收益风险比低于1:2导致浏览器场景断言失败。需保留交易纪律，由总管复核场景证据与跨组合并，禁止为绿灯放宽门禁。
- #550/#547/#543 的CI及UI都成功但提交覆盖失败；无完整正式验收。

## 待处理
原未映射编号 D05/D06/D07/D11/D46/D47/D50/D51/D52/D65/D67/D68/D69/D71/D72/D75；需找回原任务书或由用户/总管重新确认原定义后逐项关闭。不得用本清账的10份候选冒充10项原任务完成。后续优先原任务缺口、真实CI和正式验收，不再单纯增加已有模块的边界补丁。此次仅提交#541后置增量与清账记录，不合并、不部署、不启用接口、不改变策略或权限，不动原60项。
