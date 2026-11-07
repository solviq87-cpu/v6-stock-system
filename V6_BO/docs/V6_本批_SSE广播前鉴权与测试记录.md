# SSE 广播前权限复验｜本批修改与真实测试

基线：V6_统一主线_SSE撤权实时断流与24项任务盘点_完整工程_20261104.zip

## 文件差异
- 修改 server.js：SSE 广播前逐连接验证设备令牌和角色；无效则结束连接。
- 新增 tests/sse-broadcast-revocation.test.js：两项单元测试。
- 修改 docs/V6_恢复检查点.json 与 docs/V6_后续开发任务大纲.md。

## 实际执行
- node --check server.js：通过。
- node --test tests/sse-broadcast-revocation.test.js：2/2。
- node --test tests/http-timeouts.test.js tests/http-preflight-regression.test.js：20/20。
- node tests/research-live-http-isolated.test.js：PASS 38 real HTTP checks。

## 尚未完成
- 无广播时撤权仍靠25秒心跳断流，非绝对瞬间断流。
- 未执行全部历史套件、未做真实公网部署、短信和行情验收。
