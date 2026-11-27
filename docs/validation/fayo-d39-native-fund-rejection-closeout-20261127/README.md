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

## 续接：第39批隔离实测与CI更新（覆盖上文早期状态）
- #553 V6 CI 45994724951 已失败，verify job 140491153132 实报6629项、6622通过、7失败、0取消0跳过。失败名称为 real HTTP queue is private, read-only until explicitly created, and the background adapter commits once through the original ledger；outside-range and stale prices keep a durable intent waiting; cancellation cannot later fill；revoking the device through the original HTTP API stops its queued intent before any original buy；a changed strategy batch or removed candidate cannot execute an older frozen plan through the HTTP background path；original full-position and minimum-lot budget gates reject queued execution without extra ledger events；original T+1 sale ends monitoring and a later same-stock round trip cannot inherit the earlier plan；HTTP preparation binds the current server decision, and confirmed retries reuse one original durable fill。未见新增EIA专项失败。其余9份核查状态不变。
- 已在V8隔离执行器实际复跑原8项测试体。相同生产源码、原测试blob 6e6edf56babcf2803cd0d2803e3f4d2adcccb230：7/8通过，同一资金历史反例失败，实际score 60.4；修正测试blob 14c53631bc4bed0cc40de76495f5ba531df93b65：8/8通过。验证原八字评分字段全部不变、fundDays和fundReceipt拒绝诊断正确。未改任何生产代码。实际加载的9个JS生产模块及策略JSON blob见下，非Node原生全量回归。
  - native-strategy-daily-runner.js a818c7f3c47b47f3c4400f89a119d86e34a69681
  - bazi.js ddbee35aa0b3992ef78a1c013f3556321a32c7a3
  - myrules.js 8957643b4d9cdce3084ecc2e41ebfe94b4432689
  - analysis.js a1f83ad1cf78059edf89dc9dc756f397796ccae1
  - native-fourteen-evidence.js 53a30849a05fef97dcc8e3d9cec71ec6eed9581b
  - python-three-round-evidence.js b9d4de2aecefb3b02e6263f47c0135c9026ad6ac
  - multi-strategy-engine.js a1f1095bf5965768475a5492bc399e1ccc904dd2
  - strategy-engine.js cae0fed9f5eaf174d5991ff23440df844d1f8dbe
  - market-regime.js fbc11156b4d5a3d1586ddc2fbfdd4897375fb7f4
  - a-share-strategy-pack.json aaab1d62217d8f37419fc9a205481e85c6619534
- 限制：真实评分模块与证据投影运行；数据集校验替为股数/行数，回放和crypto摘要为夹具，小型同步assert执行器；未验证完整历史校验、回测和加密。当前容器不能直接git拉取（DNS不可用）。不宣称旧全量CI已通过，不扩大原编号覆盖，不合并部署。#556旧head 590716d2f3043da8f551801612075707fc1571db 的CI/UI/coverage均处排队，后续应绑定新精确head。
