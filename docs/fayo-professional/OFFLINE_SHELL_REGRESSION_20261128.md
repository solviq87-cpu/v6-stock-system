# 任务5｜离线应用壳回归修复 2026-11-28

固定父提交 `de099bd9d8f03c06ba641edd048cb948992ab426`，PR #562。GitHub V6 CI run 46041178498 / verify job 140649001690 实际全量结果 6693 tests / 6692 pass / 1 fail / 0 skip / 0 cancel。唯一失败：fayo-product-contract.test.js:50，offline startup dependency must be in the installed shell: /nova/index-continuity-view.mjs。后续完整服务等步骤被跳过。保留原断言，不修改公共CI工作流。

修复：原 sw.js（blob 0ea87dc3737125f8465b13d4a756e1680e5aeacd）补充 index-continuity-view.mjs、market-expansion-view.mjs、turnover-crowding-view.mjs 三个已存在的公开静态模块。前者属于启动静态依赖，后两者用于原研究入口；三个模块无进一步静态导入。缓存代次追加 task5-offline-1，保留原 APP_VER、入口URL、历史主页、原网络优先、旧缓存清理及私有接口禁缓存逻辑。不是断网时仍能读取实时行情或账户。

Node v22.16.0，逐字还原原sw并核对Git blob。新增3项真实Node VM执行原worker install/activate/fetch回调，受控CacheStorage与网络拒绝适配：原版1/3通过，缺模块与旧缓存代次2项失败；修后3/3，0失败0跳过，语法通过。测试涵盖新增模块安装与离线读取、旧代次移除与非本应用缓存保留、私有API/源码归档及凭据请求503 no-store。原完整HTTP及真实浏览器并未在本地重跑；新SHA的正式全量CI待回执。

实测 Git blob：
- public/sw.js e82e4dfc8cc4adf6c884dc31cea4c935fde44d61
- tests/task5-offline-shell.test.js a1a6f9164813d8ed5053e462520ae3be78786cc8

复验：node --test V6_BO/tests/task5-offline-shell.test.js；正式CI保留并执行原 fayo-product-contract.test.js 的真实入口和完整启动依赖图检查。

本次属于任务5既有功能回归修复，不新增任务分母，不改策略、风控、账户或外部接口，不合并、不部署。总管 #563 需合并时保留双方SW资源，统一最终缓存代次后重新验收。
