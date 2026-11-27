# C组第三批：冻结计划价格防追高与离线可执行性（未发布）

## 责任及基线
- 原22.8独立防追高门禁、C-EX11/13 部分整改；关联22.7/22.14与C-EX17/25证据边界，不重复计为完成。原22.2及22.10/22.11的候选#429/#432独立保留。
- dev 固定基线 0c45291d7156be8a1206f0bb272f3c719d5d2336。分支 fix/fayo-c-frozen-intent-price-20261127。源码提交 f650608fcf6006299651b01a48a56d807de92380、3e1b4ea29296c62dfbbaa18facde124a5789ca74；测试提交 45b11baec3d08ee4ec5d3fb71a6a55f872c1c8b6；最终HEAD以PR回执为准。
- 开工及提交前复核dev、#427总管组合清单和#428—#433公开候选变更路径，未见本批业务及测试路径冲突。共享总表/发布文档由总管协调，不并行改写；不接管B组原06—10任务。

## 实际缺陷与修复
1. 原离线预检只比较snapshot.price和冻结referencePrice，模拟器另取开盘价并计算滑点，未重新检查实际模拟价，可能将已经走远的机会计为可成交。复用原3%对称范围于预检、开盘与滑点后模拟成交价，区间外直接拒绝，保留原阈值和费用、数量、现金等检查。直接比较上下界修正常见3%浮点边界误拒；不另定生产阈值。
2. 原模拟器使用系统、证券、执行日、数量等显示字段find原意图，同显示字段的不同参考价可能关联错意图。原预检按输入顺序逐条生成决定，模拟器按同一索引读取原对象；幂等ID仍基于原完整意图，不改已有哈希合同。
3. 原缺开盘价时以snapshot.price替代，布尔值可被Number转为数值。依原离线撮合有效开盘价及成交量合同，仅允许有限正数或合法非空数值字符串；不再拿当前参考价当开盘价。正常原数据仍兼容。离线模型不提供真实盘口成交保证。
4. 保留原只读预检和离线撮合标志，未改原权威账户、生产交易规则、报价15秒硬门槛、原四策略、历史或发布者。未删除旧测试。

## 原生Node隔离验证
Node v22.16.0。两份完整源模块仅依赖Node内置crypto与彼此，测试使用真实node:test及assert，无替身。由远端文件内容重建隔离目录，git hash-object验证原/改后源码、原两份测试及新增测试一致：
- paper-execution-preflight.js base f967b3bf45f56e4c4df65ab609f96224b41904ec -> b988a51dfbe2d62bb6375e557eb162eacaef3f06
- paper-intent-simulator.js base af7a1389a248b65adb3172efd83ad6f396cf0926 -> 803c5a66996542d094f45b1170b86689558e01d7
- 原测试 paper-execution-preflight.test.js f0132599bc06956c137995263f89632b02f295b5；paper-intent-simulator.test.js fbf86b7f64513c455b52e5fcb3b65c90dfe5d700
- 新测试 c-frozen-intent-price-integrity.test.js 0fb74e41c2007c51a31c8e539b3ab28f09c665ac
- 命令：node --check src/core/paper-execution-preflight.js；node --check src/core/paper-intent-simulator.js；node --test tests/c-frozen-intent-price-integrity.test.js；node --test tests/*.test.js（隔离目录仅三份测试）。
- 新专项修前3过8失败，修后11过0失败0跳过。修前TAP SHA256 6dcfee7df32d9b9d9c81feb271070869dad8d4e73b6522f82f03e7cbec18f8ab；修后TAP SHA256 86d63992f4561ecac784163d1192bf3266664c8dbdb886cfd8a6ab38476d6e95。
- 原12项测试与新增11项组合23过0失败0跳过。实际TAP [combined.tap](validation/fayo-c-frozen-intent-20261127/combined.tap)，SHA256 5076e07adffe385d17257380847a24a34a8a96324b58ac6da912d381bc5db399。两文件语法通过。合成样本不是实际行情或真实账户收益。
- 完整仓库Git网络克隆DNS失败；未执行完整npm check/test、实机、真实行情。待精确head CI与总管组合验收。仓库专项复现：cd V6_BO && node --test tests/c-frozen-intent-price-integrity.test.js tests/paper-execution-preflight.test.js tests/paper-intent-simulator.test.js。

## 进度与剩余边界
本组三批主验收编号部分整改4/18（22.2、22.8、22.10、22.11），其余14项仍需继续核查或验收，不代表原代码全无实现；完整验收0/18。EX52项仍需逐项证据去重和正式验收；本批明确涉及EX11、EX13部分子项，禁止把映射编号统计为关闭项。累计新增专项31项（第一批9项为隔离JS替身，第二批11项为Node隔离原辅助，第三批11项为Node原模块）；修前失败反例累计22项，非全量通过率。
- 本批仅修历史离线撮合，尚未覆盖正式推送点击后的重新研判、盘中实时涨跌停与队列深度、最新风险ID/市场政策和账户冻结委托的权威执行复核。A组负责统一风险中心、原账户及成交原子门禁；C组提供证据与专项否决，不能解除原风险。B组marketContext和D组数据质量须遵守共同契约。
- 下一批优先核对原风险动作与T+1、冻结买单/候选压力及风险解除条件；共享入口由总管协调。本批源码及两前置候选可独立审查，先复核最新组合HEAD与依赖，再按总管统一流程合并验收。未合并dev、未部署、未发送真实通知、未下单；无新增依赖和发布入口。回滚仅撤除独立增量或按原流程revert，不重写历史账户。
