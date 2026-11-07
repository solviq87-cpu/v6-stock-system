# V6 UI专项修改与测试报告
基线：SSE广播前撤权复验与HTTP回归版（不覆盖原包）。
修改：public/assets/app.css、public/index.html；新增 tests/mobile-card-layout.test.js；更新大纲和检查点。
目标：解决用户截图中手机卡片标题被挤成竖排、页面横向溢出问题；不改业务接口。
测试结果：node --test tests/mobile-card-layout.test.js：3/3 通过；ZIP CRC 完整性另行校验。
限制：未进行真机浏览器像素级截图对照；未完成全站 UI 重设计。
