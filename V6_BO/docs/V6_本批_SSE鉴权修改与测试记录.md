# 本批真实开发与测试记录
基线：V6_统一主线_第续批_HTTP请求体边界与恢复检查点_完整工程_20261104.zip
## 修改
- server.js：云端 SSE 令牌必须有效；无凭证不再降级为 view 订阅。保持本机免密模式原有行为。
- tests/research-live-http-isolated.test.js：增加 5 个 SSE 实际 HTTP 验证点。
- 更新恢复检查点及开发大纲。
## 已执行
- `node tests/research-live-http-isolated.test.js`：通过，控制台输出 `PASS 37 real HTTP checks in isolated QD_CLOUD mode`，另增加 5 个 SSE 断言。
- `node --test tests/http-timeouts.test.js tests/http-preflight-regression.test.js`：20/20 通过。
- `node --check server.js`：通过。
## 未执行/风险
- 未全量运行所有历史脚本。
- 只验证撤权后新建 SSE 被拒绝；尚未测试已连接流的实时断开。
- 无真实公网 HTTPS、真实短信/行情生产环境验收。
