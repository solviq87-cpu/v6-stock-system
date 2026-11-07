# 第二轮重构说明

本轮目标是先在**不改变现有业务接口和策略结果**的前提下，完成低风险的结构整理，为后续继续拆分 2 万行 `server.js` 打基础。

## 已完成

### 1. 前端 UI 资源拆分
- `public/index.html`：从 5,000+ 行缩减为页面结构层
- `public/assets/app.css`：统一承载页面样式
- `public/assets/app.js`：统一承载前端交互、数据刷新和业务逻辑

这样后续修改 UI 不需要在 HTML、CSS、JS 中来回定位。

### 2. HTTP 基础设施抽离
新增：`src/server/bootstrap.js`

统一处理：
- HTTP Server 创建
- 同源检查 / CORS
- POST 请求体大小限制
- 请求读取错误
- 手动操作上下文（AsyncLocalStorage）

业务路由仍保留在 `server.js`，避免一次性机械拆分造成接口丢失。

### 3. 策略条件引擎基础层
新增：
- `src/core/strategy-engine.js`
- `strategies/default-conditions.json`

支持：
- `> >= < <= === between`
- 条件权重
- 最低通过分
- 命中条件追踪

该层用于逐步替换散落在旧代码中的硬编码判断，后续可继续把趋势、量能、资金、位置、风险等条件迁入。

### 4. 静态资源访问修正
前端拆出 `.js` 后，静态资源白名单同步允许 JS 文件，避免远程访问被门禁误拦截。

### 5. 基础语法检查
新增 `npm run check`，用于检查：
- server.js
- HTTP bootstrap
- 策略引擎
- 前端 app.js

## 下一轮建议

`server.js` 仍然是核心债务，建议继续按以下顺序迁移：
1. API 路由分组（market / stock / auth / paper / push / system）
2. 数据服务层
3. 策略服务层
4. 定时任务层
5. 推送层

每次迁移一个可验证边界，避免“大爆炸式重写”导致已有量化功能丢失。


## 第三轮：策略体系继续整理

新增市场环境识别、多策略组合引擎、统一风险过滤、可解释策略报告，以及 `a-share-strategy-pack.json`。策略包覆盖趋势、动量、突破、质量、反转五类候选逻辑，并根据市场状态动态调整权重。新增内容默认保持为独立模块，避免未经完整回测直接改变原有线上选股结果。
