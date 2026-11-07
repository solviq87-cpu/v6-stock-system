# 本批修改与真实测试报告

- SSE 已连接只读设备被撤权后，在25秒心跳周期内重新验证身份并结束流。
- 测试使用真实 HTTP 长连接，不是仅靠字符串断言。
- 完整服务隔离 HTTP 测试：PASS 38 real HTTP checks in isolated QD_CLOUD mode
- `node --check server.js`：通过
- 未跑全部历史回归；未进行生产公网或行情验收。
