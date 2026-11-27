# 绯曜 FAYO V6｜A组专项开发结项核对与交接（2026-11-27）

## 1. 范围与状态

依据用户原2026-11-26《第四批深度优化》A组01—05共30个小项的分工记录，以及2026-11-27《FAYO_A_全系统优化整改任务书_全维深化版》20大模块、52项EX的复核/研究方向。本记录仅汇集A组独立证据，不另建总管任务表，不扩展任务范围。原78/66任务与第四批60项台账均保留。两套编号的含义不同，不混算。固定原dev基线 `0c45291d7156be8a1206f0bb272f3c719d5d2336`；#427为总管原组合查看点 `6b26837c41b7d62e69c6c89c3dc035bf9dbc5e4f`，不是A组独立通过版本。所有下列原A组候选仍按独立PR及实际父子关系保留。

**原30项：30/30存在专项开发映射；21个对应独立PR精确HEAD的后端CI、UI浏览器、逐提交覆盖均已取得成功回执。不是30/30最终验收。** 依据#426原交接，全部30项是局部修复覆盖；没有证据足以将其中任一整项标为最终生产验收通过。原21个PR与后续30批是51个交付候选（包含父子/重叠，非51个独立原任务），不是额外增加51项需求。后续A组PR已陆续完成独立专项，尚有全量、覆盖、组合、实际环境阻塞。

本轮仅复核原任务并补三个原PR的四份合成测试夹具；生产源码、原策略、权重、旧档案、账户、通知/交易权限、总管分支及公共工作流不动。旧提交和失败回执保留；不合并、不部署、不下单、不外发。本记录是A组交接附件，由总管纳入原统一台账。没有真实行情、生产运行或5/20/60交易日的新增证据。

## 2. 原第四批30项映射（11月26日编号）

| 原范围 | 已核实的专项映射（每个小项） | 独立回执 | 剩余 |
| --- | --- | --- | --- |
| 01 数据中心 | 01.1→#405；01.2→#405；01.3→#406/#408；01.4→#410/#411；01.5→#411；01.6→#423 | 对应原PR三类检查成功 | 同一批主备源真实时间/单位/周期、授权与账户读价联动 |
| 02 四套策略 | 02.1→#424；02.2→#413；02.3→#413；02.4→#413；02.5→#412；02.6→#406/#409/#408 | 同上；#424历史失败仍保留，读取最新head | 四套独立、同日同样本重放及最终原生组合 |
| 03 智能决策 | 03.1→#413；03.2→#409/#412；03.3→#414；03.4→#425；03.5→#413/#414；03.6→#426 | 同上 | 原决策/观察/推送全链及共享风险契约 |
| 04 自主学习 | 04.1→#415；04.2→#415；04.3→#416；04.4→#416；04.5→#417；04.6→#417 | 同上 | 真实成熟标签、完整影子运行、候选审批与独立保留集 |
| 05 个股/板块/市场 | 05.1→#418；05.2→#419；05.3→#419；05.4→#420；05.5→#421；05.6→#422 | 同上 | 真实资金、板块、公告、全球行情及概率验证 |

以上仅用原PR声明编号核对映射，不凭任务号推断每一条细则已经完整实现。真实源、最终同版本运行及现场条件不可由独立CI替代。

## 3. 原21个PR的精确检查回执

| PR | 本次核对精确HEAD | 范围（非整项验收） | V6 CI | UI浏览器 | 逐提交覆盖 |
| --- | --- | --- | --- | --- | --- |
| [#405](https://github.com/solviq87-cpu/v6-stock-system/pull/405) | `ecd200a516f96d616a42c2ce881029c4ea0afaf3` | 01.1/01.2 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45852092057) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45852086852) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45852086570) |
| [#406](https://github.com/solviq87-cpu/v6-stock-system/pull/406) | `7031a79a1bedc84252dfd8bda861dd304d1d2584` | 01.3/02.6 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45852369439) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45852369572) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45852369638) |
| [#408](https://github.com/solviq87-cpu/v6-stock-system/pull/408) | `6c6873cd40995e244edb6e2cabb1c22e301a5bc8` | 01.3/02.6 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45853567619) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45853567587) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45853567531) |
| [#409](https://github.com/solviq87-cpu/v6-stock-system/pull/409) | `2128802772d11dac34a711d24e75bcfcb1c459fc` | 02.6/03.2 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45854796999) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45854797119) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45854797003) |
| [#410](https://github.com/solviq87-cpu/v6-stock-system/pull/410) | `7ef88c090d9405a7980557b05d602e2d5e0282cf` | 01.4 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45857420323) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45857420319) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45857420313) |
| [#411](https://github.com/solviq87-cpu/v6-stock-system/pull/411) | `15e7cb05705ee8551f95e5b056f188e55d64991f` | 01.4/01.5 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45858123376) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45858123423) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45858123462) |
| [#412](https://github.com/solviq87-cpu/v6-stock-system/pull/412) | `2293232cf7043e7159b6e0e7045a38544de4e643` | 02.5/03.2 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45892917450) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45892917552) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45892917616) |
| [#413](https://github.com/solviq87-cpu/v6-stock-system/pull/413) | `aae8a254da699baae3f03c537a2f68cd40c78c73` | 02.2/02.3/02.4/03.1/03.5 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45859321849) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45859321880) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45859321862) |
| [#414](https://github.com/solviq87-cpu/v6-stock-system/pull/414) | `744ae6e5cf284a1aef0a3aef9f5a40c8ad9d7bae` | 03.3/03.5 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884072401) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884072326) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884072469) |
| [#415](https://github.com/solviq87-cpu/v6-stock-system/pull/415) | `c833c38cba716af13b2904d35d8224f08dce9056` | 04.1/04.2 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884367011) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884366981) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884367188) |
| [#416](https://github.com/solviq87-cpu/v6-stock-system/pull/416) | `ab3c31e0be70235ef4838be75d98e9c2c40f51eb` | 04.3/04.4 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884667097) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884666364) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884666438) |
| [#417](https://github.com/solviq87-cpu/v6-stock-system/pull/417) | `7e326f9240b93ae675a07987f48b107da09085d7` | 04.5/04.6 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884966352) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884966338) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45884966279) |
| [#418](https://github.com/solviq87-cpu/v6-stock-system/pull/418) | `2ce9d8df86308db87729991fe04e5292b8db46d4` | 05.1 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45885512647) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45885512580) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45885512591) |
| [#419](https://github.com/solviq87-cpu/v6-stock-system/pull/419) | `dba1b1300a9afcbbffaf8c28eb547dd1dcd96a55` | 05.2/05.3 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45885935501) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45885935499) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45885935576) |
| [#420](https://github.com/solviq87-cpu/v6-stock-system/pull/420) | `d964fad6f99903297cc172a08240c9d4faecab31` | 05.4 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45886359083) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45886359068) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45886359093) |
| [#421](https://github.com/solviq87-cpu/v6-stock-system/pull/421) | `adffd80eb0b9eaf91cadff245c31f10cc134112c` | 05.5 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45886689099) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45886688926) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45886688898) |
| [#422](https://github.com/solviq87-cpu/v6-stock-system/pull/422) | `e0e418cd1c2b4c781153d7a3f577305180f7289a` | 05.6 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45887542203) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45887542238) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45887542267) |
| [#423](https://github.com/solviq87-cpu/v6-stock-system/pull/423) | `9757fdb144c7a8957e39e77dfe362eea9c195a69` | 01.6 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45887972922) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45887972815) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45887972889) |
| [#424](https://github.com/solviq87-cpu/v6-stock-system/pull/424) | `0eeae0deb1dab9fb2648ad36dfddcb287c163d8c` | 02.1 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45892409243) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45892409224) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45892409179) |
| [#425](https://github.com/solviq87-cpu/v6-stock-system/pull/425) | `9aafc354e8207eb620d9da0c43414993d897f3d4` | 03.4 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45889359429) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45889359307) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45889359283) |
| [#426](https://github.com/solviq87-cpu/v6-stock-system/pull/426) | `eae9b37953211b7474837454334ecfff89bbee0d` | 03.6 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45891283854) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45891283723) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45891283647) |

## 4. 后续30批（精确提交与检查回执）

| PR | 本次核对精确HEAD | 范围（非整项验收） | V6 CI | UI浏览器 | 逐提交覆盖 |
| --- | --- | --- | --- | --- | --- |
| [#428](https://github.com/solviq87-cpu/v6-stock-system/pull/428) | `2d58c30056dbdb26464b84641afcdabdfafebde9` | 离线订单完整性 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45930260650) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45930260597) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45930260582) |
| [#437](https://github.com/solviq87-cpu/v6-stock-system/pull/437) | `27d49c2feca608f3b5fd34856ea4369199015688` | 持锁与恢复 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45931664274) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45931664155) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45931664227) |
| [#440](https://github.com/solviq87-cpu/v6-stock-system/pull/440) | `0aed4fe1998e3742135d8e7f4071c2c7b12b73b2` | 累计费用 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45932161214) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45932161289) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45932161152) |
| [#444](https://github.com/solviq87-cpu/v6-stock-system/pull/444) | `7edaa8aff143240be741e24c5687ca0728e69d90` | 回测及对账 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45933021351) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45933021219) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45933021101) |
| [#448](https://github.com/solviq87-cpu/v6-stock-system/pull/448) | `6a7111d5225dd6224f7f3c471afcde02300af828` | 因子训练 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45938524063) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45938524060) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45938524010) |
| [#450](https://github.com/solviq87-cpu/v6-stock-system/pull/450) | `32bc523082d2de4944aa94a0bf556ec3cff8f2df` | 候选证据 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45939285202) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45939285103) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45939285050) |
| [#454](https://github.com/solviq87-cpu/v6-stock-system/pull/454) | `93e3d4b600d5c3b3f349fbb6299fb8887d58731d` | 新闻证据 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45940160670) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45940160667) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45940160716) |
| [#456](https://github.com/solviq87-cpu/v6-stock-system/pull/456) | `fbff563f413c28960eefd6428927d5844c2dc821` | 通知回执 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45940684877) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45940684931) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45940684860) |
| [#458](https://github.com/solviq87-cpu/v6-stock-system/pull/458) | `86e7af607323a88a89a7621352a264f32ec27827` | 研究审计指纹 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45941146250) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45941146235) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45941146220) |
| [#459](https://github.com/solviq87-cpu/v6-stock-system/pull/459) | `7722e7658042625c7d76cb0994bc8c9a19bdaa13` | 分段审计 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45941391077) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45941391091) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45941391052) |
| [#461](https://github.com/solviq87-cpu/v6-stock-system/pull/461) | `7c70b81b31b7efac70ebcd6f7169b93041ada517` | 四策略健康 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45941869621) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45941869785) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45941869603) |
| [#463](https://github.com/solviq87-cpu/v6-stock-system/pull/463) | `d5af4c3c0cb8370e5f429e0c99daeee8741675c0` | 自适应发布及本轮夹具修复 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964146634) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964146721) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964146629) |
| [#465](https://github.com/solviq87-cpu/v6-stock-system/pull/465) | `62d56bdb90bb1424e04c22a51c35de5c5a2d902d` | 指数预测 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45943560856) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45943560805) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45943560761) |
| [#467](https://github.com/solviq87-cpu/v6-stock-system/pull/467) | `f05170dd62cd30c9665c514b503e0160405f732e` | 因子边际归因 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45944770980) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45944770985) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45944770986) |
| [#468](https://github.com/solviq87-cpu/v6-stock-system/pull/468) | `3f1b6baa602ca6c6cc0b04397ff354d5d5c4690f` | 推送复盘；依赖#456 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45945795596) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45945795604) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45945795605) |
| [#469](https://github.com/solviq87-cpu/v6-stock-system/pull/469) | `5bda9044fa95018346ee934fc702fd90220a55a5` | 自动反馈调度 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45946578972) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45946579034) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45946578974) |
| [#470](https://github.com/solviq87-cpu/v6-stock-system/pull/470) | `c36f48afe636c9fcb73aea3ba8fd5e44fc64e023` | 反馈HTTP | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45947841277) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45947841308) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45947841286) |
| [#471](https://github.com/solviq87-cpu/v6-stock-system/pull/471) | `b0839da39e417f872f9d430ee27d5dbe05fb5430` | 三版本模型对照 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45948383876) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45948383924) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45948383861) |
| [#474](https://github.com/solviq87-cpu/v6-stock-system/pull/474) | `4708cc2e3399b27bd61c268f7bad81ab6f04903d` | 全局预算及本轮夹具修复 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964204519) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964204642) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964204574) |
| [#478](https://github.com/solviq87-cpu/v6-stock-system/pull/478) | `be9268e41d4ee2590ac35d3564abbc2261ac3004` | 自动候选 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45949649480) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45949649389) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45949649522) |
| [#480](https://github.com/solviq87-cpu/v6-stock-system/pull/480) | `3f734c0b5f2a7116dd656d57e9e06852e74516ae` | 预注册及本轮两处夹具修复；父#427 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964273900) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964273812) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964273802) |
| [#486](https://github.com/solviq87-cpu/v6-stock-system/pull/486) | `e44beb0cc9237367baa044818753a3128b776678` | 代理完整性；已由#501接续 | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45951865006) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45951865024) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45951865023) |
| [#488](https://github.com/solviq87-cpu/v6-stock-system/pull/488) | `eaada9b0d53fd088d186d08e7f5c7cfe24c40cc0` | 代理恢复；父#486；已由#501接续 | 未取得 | 未取得 | 未取得 |
| [#491](https://github.com/solviq87-cpu/v6-stock-system/pull/491) | `063817acc071e20c864075778a5b8ea90dbcaba5` | 学习可靠性；父#427 | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45953103311) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45953103259) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45953103286) |
| [#494](https://github.com/solviq87-cpu/v6-stock-system/pull/494) | `95012c4a34287a48c7f4f3e966e6a081b9e61ab3` | 市场学习门禁 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45953880897) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45953880899) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45953880906) |
| [#498](https://github.com/solviq87-cpu/v6-stock-system/pull/498) | `f1593f1e3fbd75d53cffec74ff9cebbd2df357e7` | 冻结样本外 | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957139768) | [通过](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957139771) | [失败](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957139733) |
| [#501](https://github.com/solviq87-cpu/v6-stock-system/pull/501) | `d9c483c142c238893cb94e916e1e6c314620fbd8` | 代理兼容修复；含#486/#488 | [运行中](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957789087) | [运行中](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957789073) | [运行中](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957789075) |
| [#504](https://github.com/solviq87-cpu/v6-stock-system/pull/504) | `f41611be042aca1f40e481e044023386d3c09822` | 概率校准；父#427 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45958509667) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45958509776) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45958509681) |
| [#505](https://github.com/solviq87-cpu/v6-stock-system/pull/505) | `07fb00fe0c47f93dd9751fad94f43ca731334fb5` | 规则经验 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45960022427) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45960022408) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45960022495) |
| [#510](https://github.com/solviq87-cpu/v6-stock-system/pull/510) | `d971fdf45270663b6c14bee26f6c39f10998afa6` | 预测反馈分母 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45962914694) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45962914869) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45962914704) |

逐个查询的快照（非原子读取时刻）：51个候选的V6 CI成功41、失败2、排队/运行7、未取得1；UI成功42、失败1、排队/运行7、未取得1；逐提交覆盖成功22、失败20、排队/运行8、未取得1。这些按PR回执计，不累加为唯一测试数量、任务完成率或全系统绿色。历史不同SHA结果不移用于新头。各原PR的实际差异、测试及回滚说明仍在其正文及原验证文件。

## 5. 本轮实际修复：已发现的6项A组CI失败（旧记录不改）

| 原PR和CI | 实际失败 | 处理和新提交 |
| --- | --- | --- |
| #463，旧HEAD `3f631c4943c83d968569b60fca0cf2625c1afe6d`，[run45942361387](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45942361387)，6110过/3失败/0跳过 | adaptive-monitor-archive.test.js:37/39/40，原1000条/128MiB/超容量合成存储夹具缺来源、schema、decisionAt，先被新身份门禁拒绝 | 仅补合成输入与结果schema、明确simulated来源、北京时间决策时点及下一容量边界输入/结果。保留原数量、字节、恢复及拒绝断言；`d5af4c3c0cb8370e5f429e0c99daeee8741675c0`，测试blob `17a957d741747339785f877c5b929f0e5c930514`。生产blob `e24993908b37e4fdaa874e4f3ba3f08f520316dc` 不改。 |
| #474，旧HEAD `4c387a13cf0fa0ad3c8aa9f1a61e0446086322c8`，[run45949011985](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45949011985)，6113过/1失败/0跳过 | evolution-statistics.test.js:408，已消耗试验夹具缺初始父/前驱/试验编号，原生封存合同拒绝，usedTrials缺失 | 补明确首次试验编号1和三个null父/前驱标识；原1次消费、字节篡改及缺档案断言不改。提交 `4708cc2e3399b27bd61c268f7bad81ab6f04903d`，测试blob `a9c6c434c56277ab2c3a511040a0ec284c53fc98`；生产blob `589182257db7f0c10daec39a39aee3e920274939` 不改。 |
| #480，旧HEAD `3c1a37d42e713bba2b4f27bf3888c51da8ede119`，[run45951207277](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45951207277)，6559过/9失败/0跳过 | 其中2项A组新增失败：factor-prereg-window-integrity.test.js:65 种子冻结时间以16:00Z写入，跨北京自然日；factor-research-agent.test.js:51 合成36日冻结样本沿用同一capturedAt及无关哈希 | 前者按北京日期16:00+08:00产生夹具，提交 `35750499b778a5f2fc85aa59938e4dcb91c024de`、blob `0a84dc05a8a28d9bed58195e4159b1f1bd9884cf`；后者逐日构造明确capturedAt并对完整payload重算原哈希，提交 `3f734c0b5f2a7116dd656d57e9e06852e74516ae`、blob `a6180c463bc1792f646858608dd110cc4e3b533d`。原断言与生产blob `23c8302ac37b391bd63adf7ac4b79820a3883160` 不改。 |

### 本次实际隔离验证

- 读取原精确生产源码，V8执行#463真实validIdentity/validResult/matchesInput，使用明确固定摘要夹具构造原与新存储记录的0、7、8、999四个索引；修前四项拒绝、修后四项通过。仅身份合同，不是原3项真实磁盘、1000条/128MiB归档恢复运行。
- V8执行#474完整实际预算模块，注入确定性摘要夹具，原旧封存缺血缘拒绝，修正后usedTrials=1、remainingTrials=5，篡改状态但保留摘要仍拒绝；非真实SHA256或原文件/worker集成。
- V8执行#480完整实际预注册模块、原factor pack（blob `993e5ca19c015fb7ab4ec5e06f7a6bca51db3ff3`），策略文件读入/摘要为确定性隔离夹具；旧跨日种子、旧合成前缀各拒绝；新种子校验通过，变更保留日时点仍拒绝，新前缀36日封存通过。不是原真实代理日常运行。三处测试通过JS语法解析（#463本次仅执行提取的身份代码，未运行全原测试）。真实6项CI反例在新精确提交上已提交待复测，不能声称6/6全量回归已经通过。

#486旧CI的1项失败已在#501修复原夹具并验证失败锁存（原专项43/43）；#501含#486→#488完整父链，新精确CI运行中。不要重复合并父提交。#491的7项失败与#427原组合7项条件单及计划HTTP用例同名；#480旧9项亦含这些7项。需在总管组合复核原候选现价毛赔率边界与夹具，不在本A组交接修改其他组或公共硬风控。#427真实全量6546/6553，#491真实6564/6571，原失败证据保留。UI与逐提交覆盖失败不假称通过；其中#486已查实逐提交缺smoke状态，其他失败需读取对应精确run，不一概推定原因。不手工设置成功、不降门槛。

## 6. 11月27日全维深化任务书：候选证据交叉映射

以下是局部候选映射，不把旧第四批编号含义移植到新任务书，不另计完成百分比。没有整项精确组合证据的仍待核，不代表原实现不存在。外部授权、合同及总管负责事项单列。

| 新任务书模块 | 本组已有可审查局部候选 | 待核重点 |
| --- | --- | --- |
| 01 行情数据 | #405/#408/#410/#411/#423 | 原15秒、真实源、完整口径与共同门禁 |
| 02 四套原生策略 | #406/#409/#412/#413/#424/#461 | 全量原生同样本对照、同版本逐日 |
| 03 AI综合决策 | #414/#425/#426/#450 | B/C合同及原推送链共同验收 |
| 04 自主学习 | #415/#416/#417/#448/#461/#463/#465/#467/#469/#470/#471/#474/#478/#480/#486/#488/#491/#494/#498/#501/#504/#505/#510 | 冻结成熟样本、真实独立保留、算法指纹更新与归档兼容 |
| 05 主力资金 | #418 | 字段授权、上下游一致、日累计 |
| 06 板块与情绪 | #419 | 成员点时/跨题材；B环境、C风险由负责组 |
| 07 涨停与龙头 | #420/#504 | 触板/封板/成交目标、真实校准 |
| 08 新闻与政策 | #421/#454 | 授权原文、澄清/撤回及正式联动 |
| 09 全球联动 | #422/#465 | 真实时区和原始报价、非因果 |
| 10 买卖辅助 | #425/#450 | 共同计划及原执行资格，不替代C否决 |
| 11 回测 | #440/#444/#458/#461/#498 | 真实历史/成本/原组合 |
| 12 模拟及券商 | #428/#437/#440/#444 | 离线账本非正式账户；权威账户联动、现场回执 |
| 13 全局风控 | #408/#425/#450 | 原权威门禁、C负责专项，组合不得放宽 |
| 14 持仓与资产 | #440/#444 | 真实权益与原账本、组合归因 |
| 15 复盘经验 | #426/#456/#468/#505/#510 | 首次证据与真实反馈 |
| 16 个人AI助手 | #454/#470/#501局部只读与权限证据 | 原助手完整用户路径、偏好与授权尚未逐项认证 |
| 17 双端体验 | 本记录原PR浏览器回执 | 最终统一版本、所有用户路径及实际设备；不擅改其他组UI |
| 18 性能效率 | #437/#459/#469/#470局部容量/调度 | 同负载P50/P95、CPU/RSS、完整资源画像 |
| 19 安全恢复 | #428/#437/#459/#463/#486/#488/#501 | 实际私有卷冷备、现场、长时及跨重启 |
| 20 全量验收 | 本附件及原各PR回执 | 最终组合、全量及实际环境，未认证 |

EX增强方向交叉证据（局部；其余细则/运行证据仍需原台账或总管已有成果逐项核查）：

| 原EX编号 | 关联局部证据或明确待核 |
| --- | --- |
| 01 | #414/#426/#458/#468 冻结及回放身份；共同追踪链待核 |
| 02 | #408/#425/#450 候选分档、数据与风险阻断 |
| 03 | #440/#444 费用、金额及账本证据；容量和排队待核 |
| 04 | #425/#468/#510 目标/期限/反馈局部；完整信号生命周期待核 |
| 05 | #415/#444/#467 局部收益及因子归因；组合机会成本待核 |
| 06 | #448/#471/#474/#480/#498 预登记及独立样本 |
| 07 | #461/#486/#488/#491/#494/#501/#504 模型健康、失败锁存及评价 |
| 08 | #421/#454 公告新闻；完整基本面风险日历待核 |
| 09 | #425/#456/#468 局部风险提示/通知存证；双端最终路径待核 |
| 10 | #437/#459/#463/#488/#501 隔离恢复；完整故障演练待核 |
| 11 | #444 公司行为、历史价格；历史主数据覆盖待核 |
| 12 | #421 公告证据相关；财务质量因子及同样本效果未逐项核定 |
| 13 | #410/#411/#418 来源与口径；授权独立性仍需真实证据 |
| 14 | #405/#409/#410/#411/#414/#418/#454/#510 异常或修订隔离 |
| 15 | #409/#413/#448/#498 点时与冻结；实时/训练/回测三链逐字段比对待核 |
| 16 | #425/#450/#467 排名与因子身份；实际扰动稳定性待核 |
| 17 | #444 局部收益与对账；完整现金流及组合基准待核 |
| 18 | #420/#465/#504/#510 不同预测目标及误差分母 |
| 19 | #454/#470/#501 局部证据和权限；LLM注入与全部工具边界待核 |
| 20 | #458/#463/#486 模型版本及运行身份；实际资源报告待核 |
| 21 | #469/#470/#501 调度与失败门禁 |
| 22 | 未取得本组第三方供应链全项验收证据；保留原锁文件和许可 |
| 23 | #437/#459/#463/#488 历史及恢复；实际迁移与旧新写者验收待核 |
| 24 | #425/#450 局部理由；原UI真实用户工作流待核 |
| 25 | 未取得本组全部偏好/通知纪律验收证据 |
| 26 | #470/#510 局部请求/导入；完整原导入导出权限与安全待核 |
| 27 | 原51个PR内的反例、差分和独立检查；组合属性验证待核 |
| 28 | 本附件原CI、现场与发布阻塞；总管最终发布 |
| 29 | #440/#444 费用、精度与未知对账 |
| 30 | #408/#411/#418/#510 缺值、零成交、到期分母；全消费者待核 |
| 31 | #448/#467 冗余、边际贡献；真实同费用消融待核 |
| 32 | #415/#504/#510 标签成熟、不可用及目标隔离 |
| 33 | #444/#498 局部历史/时点；真实历史退市股池偏差待核 |
| 34 | #468 推送复盘时点；真实延迟桶及可成交收益待核 |
| 35 | 原日内路径歧义完整组合验收未核定 |
| 36 | #428/#437 离线订单状态与恢复；权威订单联动待核 |
| 37 | #444 权益与差额；实际交收字段待核 |
| 38 | #440/#444 成本局部；完整执行损耗归因待核 |
| 39 | 未取得本组容量/盈亏平衡曲线全项实证 |
| 40 | #405/#411/#444/#494 时点与价格规则；真实规则生效区间待核 |
| 41 | #425/#450 候选分档；扣费优势、现金基准待核 |
| 42 | #414/#467 证据及边际归因；反事实解释稳定性待核 |
| 43 | #426 历史经验及点时案例；相似案例完整证据待核 |
| 44 | #461/#467 策略健康和边际贡献；完整长短板仪表待核 |
| 45 | #491/#504/#505 稳健性/信号日敏感性；独立统计验证待核 |
| 46 | #425/#456 观察池及通知状态局部；真实用户体验待核 |
| 47 | #463/#486/#501 研究失败和隔离；核心依赖逐个停用验收待核 |
| 48 | #469/#486/#494 时钟门禁；双端SSE顺序待核 |
| 49 | #458/#470/#501 版本、权限与配置局部；凭据生命周期现场待核 |
| 50 | #437/#459/#463 恢复局部及本轮容量夹具；真实私有卷RPO/RTO待核 |
| 51 | 开盘/收盘多端峰值等负载实测未取得 |
| 52 | 本附件固定版本、失败、依赖与范围；不是最终整合总表 |

## 7. 总管验收所需关系及边界

- 原#405—#426已出现在#427组合范围内，必须按实际树确认纳入，不能再整批重复应用。#480/#491/#504基于#427精确头的新增差异，分别只纳入相对该父版本的增量。#468依赖#456；#501包含#486及#488；#463/#474/#480采用本附件最新头，不拿旧头失败或通过回执替代新头。
- #465对adaptive-market-lab、#498对注册器、#463对监视/归档的改动需联合回归；#480预登记算法指纹涉及#448/#467/#471/#474/#478/#491等改动，不能旧档案重封或自动迁移。#504的概率新分档与#510的反馈分母均是研究诊断，保留原档案和权限；未认证实际收益或完整双端。原#424/#412/#413的同日十四条证据与未知边界须保持。
- 本组实际CI回归整改已追加原PR；新精确CI尚未返回通过证据。其余逐提交覆盖缺失、总管组合7项及UI、全部跨组原生服务、真实数据权限、真实训练/独立样本、现场实机、备份恢复和持续运行由各原负责人按原合同提供。不要降低标准或擅自接管别组，按总管最终组合结果结项。
- 回退仅针对相关独立提交，保留历史/失败和后续新增记录；不能以旧账本覆盖新数据或重写模型历史。真实授权、足够成熟样本及实际节点缺失均记录阻塞。

结论：原30项专项开发覆盖及对应21个独立CI已经核对齐全；本次关闭已定位的旧夹具源码修正工作，但新全量复测未认证。**未达到A组全部原任务最终验收完成的证据标准。** 无需继续按批次数量扩张功能；按原验收剩余、实际A组失败和交付证据推进。

## 8. 收尾复验及去重更新（2026-11-27，后续核对点）

本节优先于上文的历史快照，不改写历史结果。用户明确要求只完成A组原任务，不继续扩大需求。仍不修改生产代码、原策略、权重、权限、其他组、公共工作流或总管分支。

### 8.1 原六项回归修正的进一步实际复测与唯一纳入方案

中断后的原PR更新及独立复测分支针对相同六项缺口，**不是新增六项功能，不同时纳入两个修复版本**。已读取两侧四个测试文件的精确blob并比较内容；以下以有原生Node复测证据的独立候选为推荐交接输入。总管可按已应用版本做等价合并，但须保留原断言，不能重复cherry-pick。

| 原PR（旧失败版本） | 已更新原PR头（历史保留） | 推荐的独立复测候选（固定HEAD） | 实际差异和复测 |
| --- | --- | --- | --- |
| #463 / `3f631c4943c83d968569b60fca0cf2625c1afe6d` | `d5af4c3c0cb8370e5f429e0c99daeee8741675c0` | [#512](https://github.com/solviq87-cpu/v6-stock-system/pull/512) / `2db4639638525847dfbf2f1041e380108609a3f3` | 两侧均补合成输入和报告身份、时点，差异为字段排列。推荐测试blob `7066c02cedda2695c188b7962311a4b8f75ef956`。Node22.16真实原monitor/archive、磁盘、flock及renameat2，四个原容量用例修前1/4、修后4/4（原3失败修正）；完整原测试文件和新全量仍待CI。 |
| #474 / `4c387a13cf0fa0ad3c8aa9f1a61e0446086322c8` | `4708cc2e3399b27bd61c268f7bad81ab6f04903d` | [#515](https://github.com/solviq87-cpu/v6-stock-system/pull/515) / `574803177a85f5545e9f722bce72d3c423807a35` | 两侧原测试blob完全一致 `a9c6c434c56277ab2c3a511040a0ec284c53fc98`，只补首轮血缘；Node22.16真实预算与提取的原读取逻辑、临时文件，原失败0/1→1/1，篡改拒绝断言保留；完整worker、旧真实档案兼容待验。 |
| #480 / `3c1a37d42e713bba2b4f27bf3888c51da8ede119` | `3f734c0b5f2a7116dd656d57e9e06852e74516ae` | [#516](https://github.com/solviq87-cpu/v6-stock-system/pull/516) / `2900158b2c72cd2a067670a0dc8153eab148701c` | 种子时间均改北京时间；代理夹具优先采用仅含注册所需身份/因子/时点的显式合成数据，避免复制其他当日数据。推荐blob `e25b6cbd98e45da598cbe4016466abbc90c8978e`、`46f7aa74592cab8d2ceafbc05e4d2772b6e3284d`。Node22.16原13个预注册测试加1个代理注册子步骤修前12/14、修后14/14。代码指纹依赖有固定占位夹具；未运行完整代理端到端。 |

三组隔离复测19/19（4+1+14），0失败0跳过；这只证明本地原容量、预算与预注册反例/子步骤修正，不替代新精确head的原生全量CI。三个独立候选PR正文包含原失败run、真实测试范围和日志SHA256。保留原PR，不额外关闭或合并。按上述推荐输入，#512包含#463旧生产补丁、#515包含#474旧生产补丁、#516包含#480旧生产补丁且以#427为父；如果旧父补丁已组合，仅纳入其修正增量。

### 8.2 新取得的真实CI回执

- **#501 精确 `d9c483c142c238893cb94e916e1e6c314620fbd8`：** [V6 CI 45957789087](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957789087) 成功；verify job 140368193843 的全量Node回归 **6142/6142，0失败0跳过**，另三批20/20、40/40、24/24，不与全量重叠相加。12个CI job均成功。[浏览器 45957789073](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957789073) 成功。#501接续#486和#488，二者不重复应用。[逐提交覆盖 45957789075](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957789075) 失败；实读job 140368193336，十个SHA缺少smoke状态（c21ed4164d28、2dc6e3389d6f、e44beb0cc923、d7164968f69f、370d3a520630、eaada9b0d53f、e1cb11c83c27、9fda45f2b0a8、047c9c130697、d9c483c142c2）。未伪造状态、不绕过门槛。
- **#491** 真实6564/6571，7个失败的测试名称和文件行号逐个与#427的6546/6553核对一致：paper-conditional-http.test.js:86/116/133/146/160/177 和 paper-decision-plan-http.test.js:31。浏览器失败与#504一样触发候选现价毛赔率不足的原规则断言。属于共享组合验收缺口，不宣称#491全部通过，不改其他组及共同门禁。
- **#504 精确 `f41611be042aca1f40e481e044023386d3c09822`：** [CI 45958509667](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45958509667)运行中；[UI 45958509776](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45958509776)失败（实读job 140370507570，原现价赔率低于1:2）；[覆盖 45958509681](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45958509681)失败。最终CI未取得，不预判其失败内容。

| 候选 | V6 CI | UI | 逐提交覆盖 |
| --- | --- | --- | --- |
| #463更新头 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964146634) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964146721) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964146629) |
| #474更新头 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964204519) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964204642) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964204574) |
| #480更新头 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964273900) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964273812) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964273802) |
| #512 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964538222) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964538389) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964538271) |
| #515 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964802190) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964802275) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45964802207) |
| #516 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45965150510) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45965150569) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45965150529) |
| #505 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45960022427) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45960022408) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45960022495) |
| #510 | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45962914694) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45962914869) | [排队](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45962914704) |

#454覆盖仍排队，#488独立run未取得但其后继#501已通过后端及UI。以第3/4节原51个候选的逐个读取快照更新本节已变化状态，**非同时刻全量刷新**：后端成功42、失败2、待结果6、未取得1；UI成功43、失败2、待结果5、未取得1；覆盖成功22、失败22、待结果6、未取得1。三个替代复测PR不新增任务；若单列所有54个历史/活动业务候选，分别增加3个待结果。任何上述统计不得作完成百分比或代替最终组合验证。

### 8.3 结项交付及停止条件

- 第2节依据原PR编号声明及#426交接确认11月26日30项的专项映射，原21个精确头三类CI已查实成功。尚未取得11月26日全部30项逐字原文，不能把映射当完整细则认证。11月27日16页任务书原20大模块及52个EX方向已按第6节列出局部证据/待核；它不是追加52个已确认缺陷，也不把01—20整项标为完成。
- 本附件为本组结项输入，#514仅文档提交；总管负责合并、公共工作流、共享接口和最终上线。本组不建立新功能/第二总表，不重复已修事项。只在新精确CI或原验收出现明确归属本组的缺陷时再修。
- 当前待关闭：#512/#515/#516/#504/#505/#510的真实CI结论、#501等逐提交覆盖、原档案及算法指纹兼容、实际A组联合回归。总管原7项条件单/计划HTTP及UI共享阻塞只交接。真实行情授权、成熟样本、设备/私有卷、连续5/20/60交易日观测无新回执，保持阻塞或待验。无任何合并、部署、真实交易或通知操作。
- 原30项已有专项开发覆盖，不表示最终验收100%；本组真实环境及更广任务书剩余细则不可凭新增PR数量完成。该记录用于明确下一步验收，而非无限追加批次。

## 9. 最新验收回执补记（2026-11-27）

本节更新第8节状态，不改历史结果。仅查A组现有候选的实际CI，不新增功能或测试，不修改业务代码。

- **#505 / `07fb00fe0c47f93dd9751fad94f43ca731334fb5`**：V6 CI [45960022427](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45960022427) 成功。实读verify job 140375396481，原生Node主回归6118/6118，0失败0跳过；另批20/20、40/40、24/24，不与主回归相加。UI [45960022408](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45960022408) 成功。逐提交覆盖 [45960022495](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45960022495) 失败，未宣称全部门禁通过。
- **#504 / `f41611be042aca1f40e481e044023386d3c09822`**：V6 CI [45958509667](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45958509667) 已完成、失败。实读verify job 140370507596，6562通过/6569，7失败0跳过。逐条对照#427及#491失败测试名称/位置：paper-conditional-http.test.js:86/116/133/146/160/177及paper-decision-plan-http.test.js:31，完全一致；未观察到新增概率模块测试失败。其UI和覆盖仍失败，不能称完整CI通过，也不推断#504与其他候选无语义冲突。
- #501已确认6142/6142的全量和UI成功，覆盖失败。#510/#512/#515/#516以及#463/#474/#480的更新头精确检查仍排队。本附件前头`c799c5de040e18e72b51586aa8c122ad2b580cf1`的文档PR检查仍排队。以上均以本次逐次查询结果为准，并非同一时刻快照。
- 在第8节原51候选的快照中，仅按上述已证实变化更新：后端成功43、失败3、待结果4、未取得1；UI成功44、失败2、待结果4、未取得1；覆盖成功22、失败23、待结果5、未取得1。三个替代复测PR仍分别增加3个待结果，不计为新增任务或独立业务成果。非全体重新抓取，不能视为最新完整仓库统计。

本轮无新增已定位的A组业务回归缺口。原30项专项覆盖、21个独立PR三类检查及第8节推荐纳入方案不变。剩余待验为明确列出的CI结果、逐提交门禁、原生组合、历史兼容和原任务书要求的实际环境证据；不能以等待的工作流视为成功。保留全部历史与权限，不合并、不部署。只在后续取得新的本组失败证据时继续修正，不再为增加批次数而开发。
