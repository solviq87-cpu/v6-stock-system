# V6 只读 Streamlit 网页部署

这是现有 V6 工程旁路的**只读研究工具**，不读取现有 V6 账户、订单或交易接口；目前也不与 V6 主系统共享策略结果。它仅使用 AKShare 公开数据，不能保证实时性。

## 入口

- 现有 GitHub 仓库：`solviq87-cpu/v6-stock-system`
- 默认分支：`dev`，不是 `main`
- 仓库根目录入口：`app.py`
- 依赖：`requirements.txt`
- 端口：`7860`（`.streamlit/config.toml`）
- Zeabur 启动配置：根目录 `zbpack.json`
- 独立模块与测试：`streamlit_readonly/`

## OpenXLab / 浦源

从 GitHub 关联 `https://github.com/solviq87-cpu/v6-stock-system`，**选择 dev 分支**，文件入口 `app.py`。若控制台有「上海 / Shanghai」则优先选上海；否则选择确实可用的免费 CPU 资源，不凭空填写节点。

在应用环境变量设置 `DASHBOARD_PASSWORD`，至少 20 位独立强密码；**不要**在仓库中提交密码。设置应用私有可见性（如果平台支持）。

启动命令（需要手动填时）：

```sh
python -m streamlit run app.py --server.address 0.0.0.0 --server.port 7860 --server.headless true
```

**平台自动更新限制**：已核实的 OpenXLab 官方文档仅说明设置页「同步代码」触发重新构建；不能保证 GitHub push 自动触发 OpenXLab 部署。本仓库的 GitHub Actions 只自动执行测试，不假称自动上线。

## Zeabur（自动部署备用）

从 GitHub 关联相同仓库的 `dev` 分支，根目录使用 `zbpack.json` 指定 Python 3.12 / Streamlit；环境变量配置 `DASHBOARD_PASSWORD`、`PORT=7860`，发布 HTTPS 域名。Zeabur GitHub 关联分支提交能触发新构建，但部署成功与否仍须检查日志；创建资源前先确认免费额度，不开通收费服务器。

## 自检

```sh
python -m pip install pytest pandas numpy
python -m pytest -q streamlit_readonly/tests
```

## 数据、回测与安全限制

- 不接券商、不包含实盘/模拟账户登录、交易接口和自动交易。
- 不使用 OpenAI 或其他云大模型 API。
- 抓取时间不是交易所原始报价时间；源端失败就报错，不能伪造行情。
- 回测仅供教学；未覆盖涨跌停不可成交、停牌、分红和公司行为。
- 原 V6 工程的 Node 服务、UI、原四套策略、风控和历史文件不修改。
