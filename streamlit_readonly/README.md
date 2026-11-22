# V6 可选 Streamlit 只读展示适配器（实验性）

> **不是 V6 正式产品**。原有 FAYO / Node / 四套策略 / 风控 / 账户 / 历史和自动更新链路都以仓库原工程为基线；本目录不替换、不删除、不修改那些系统。

本目录用于免费托管环境的**独立只读预览**，目前 AKShare 条件筛选和教学型均线回测是预览示例，尚未与 V6 正式行情、选股策略或 FAYO 界面连接。不要把它当作完整 V6 的上线结果或与 V6 相同的选股建议。

## 为什么单独放一个目录

部署平台是可换的，不应把 OpenXLab/Zeabur 的部署文件、AKShare Python 依赖和端口设置放进 V6 Node 主目录。**用户的完整源码仍只有这个 GitHub 仓库**。平台更换时仅调整本目录的配置和外部平台设置；核心策略升级继续在 V6 原实现里进行，不在此复制一套生产策略。

```text
v6-stock-system/
  V6_BO/                      # 正式 V6/FAYO 工程，保持原样
  V6_WEB/                     # 历史/静态研究模块，保持原样
  streamlit_readonly/         # 本次新增的可选部署适配器
    app.py                    # Streamlit 独立演示入口
    analysis_core.py          # 独立教学筛选和回测，非 V6 正式策略
    market_data.py            # AKShare 独立数据适配器
    requirements.txt
    .streamlit/config.toml    # 默认端口；OpenXLab 启动命令另设 7860，访问需私有密码
    zbpack.json               # Zeabur 候选部署配置
    tests/test_core.py
    README.md
```

## 本地测试

运行时工作目录应是 `streamlit_readonly/`，不可从仓库根目录将所有 Python 依赖装到正式 V6 Node 工程：

```bash
cd streamlit_readonly
python -m pip install -r requirements.txt
DASHBOARD_PASSWORD="在本机临时设置的独立强密码" python -m streamlit run app.py --server.address 127.0.0.1 --server.port 7860 --server.headless true
```

在仓库根目录运行筛选、回测和登录隔离测试：

```bash
python -m pip install -r streamlit_readonly/requirements.txt pytest
python -m pytest -q streamlit_readonly/tests
```

## Zeabur（自动 GitHub 触发的备用托管）

- GitHub 仓库：`solviq87-cpu/v6-stock-system`
- 关联分支：合并审查通过后用 `dev`，**不要绑定草稿功能分支作为正式服务**
- **Root Directory / Service Directory**：`streamlit_readonly`（如果控制台支持）
- 使用此目录的 `zbpack.json`；启动命令也可明确填写：
  `python -m streamlit run app.py --server.address 0.0.0.0 --server.port 7860 --server.headless true`
- 在平台私有环境变量设置 `DASHBOARD_PASSWORD`（推荐 20 字符以上）和 `PORT=7860`
- 关联仓库分支的新提交可能触发构建；**是否部署成功须以实际构建记录为准**。创建计算资源前核对是否收费。

## OpenXLab / 浦源（优先验证免费 CPU，上海仅在可选时使用）

**部署时不需要复制仓库或在 V6 根目录添加 app.py。** 已在**同一个 GitHub 仓库**建立专用 `streamlit-release` 分支，分支根目录仅包含 `app.py`、`requirements.txt`、`.streamlit/config.toml` 等只读演示文件。你可以直接在 OpenXLab 绑定这个分支：

- 仓库：`https://github.com/solviq87-cpu/v6-stock-system`
- 分支：`streamlit-release`（不是 `dev`）
- 应用组件：`Streamlit`，启动入口：`app.py`，端口：`7860`（通过启动命令 `--server.port 7860` 指定）
- 地区：如果控制台提供上海且符合免费资源条件，优先选上海；否则选实际可用的免费 CPU
- 安全：在**平台环境变量**配置 `DASHBOARD_PASSWORD`，不可提交到 GitHub
- 仅提供 AKShare 公开行情、条件选股和教学回测；未连接完整 V6/FAYO

该发布分支已在 GitHub Actions 以 Python 3.9 和 3.12 完成真实依赖安装、模块导入、离线测试；这**不等于** OpenXLab 现场联网成功。

## 源码与独立部署

可选预览源码收录在 `dev` 的本目录。独立启动分支 `streamlit-release` 保留原有版本，其更新与实际托管运行状态由该分支和平台构建记录确认。本地默认监听 `127.0.0.1`，OpenXLab 或 Zeabur 启动配置可明确指定监听地址。

## 隔离边界

- 当前不会连接 Node 后端、V6 账户、订单、风控、券商 API 或实盘交易。
- 不使用 OpenAI 及其他云模型 API。
- 抓取的时间不等于交易所原始行情时间，不可宣称具备可交易实时价。
- 回测仅用于教学，未模拟停牌、涨跌停不可成交、复权/分红等，非专业回测。
- 未部署到公网，手机/电脑连通性未测，亦未验证 OpenXLab/Zeabur 真实行情。
- 下阶段若要复用 V6 核心数据，只能由原 V6 授权接口提供**脱敏、只读、带原始时间和来源的展示数据**，不复制策略代码或开启任何交易 API。详见同目录 `INTEGRATION_CONTRACT.md`。

## Streamlit Community Cloud 端口说明

Streamlit Community Cloud 默认监听 8501；为兼容平台健康检查，`.streamlit/config.toml` 不再锁定 7860。OpenXLab/Zeabur 如需 7860，使用上面注明的 `--server.port 7860` 启动命令。应用具体启动失败原因需查看平台日志，不可仅凭兼容改动判定已修复。
