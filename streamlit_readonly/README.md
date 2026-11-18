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
    .streamlit/config.toml    # 7860 端口，私有访问必须设置密码
    zbpack.json               # Zeabur 候选部署配置
    tests/test_core.py
    README.md
  .github/workflows/streamlit-readonly-ci.yml
```

## 本地测试

运行时工作目录应是 `streamlit_readonly/`，不可从仓库根目录将所有 Python 依赖装到正式 V6 Node 工程：

```bash
cd streamlit_readonly
python -m pip install -r requirements.txt
DASHBOARD_PASSWORD="在本机临时设置的独立强密码" python -m streamlit run app.py --server.address 127.0.0.1 --server.port 7860 --server.headless true
```

在仓库根目录执行纯逻辑测试：

```bash
python -m pip install pytest pandas numpy
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

## OpenXLab / 浦源（优先上海但不保证该地域可选）

OpenXLab 某些应用创建流程要求 `app.py` 位于部署仓库根目录，因此**不能不经验证就将 V6 仓库根目录当成 Streamlit 工程来部署**。

推荐保持 V6 仓库原样，仅在发布阶段**从本目录导出**到单独的部署分支（其中 `app.py`、`requirements.txt` 在分支根目录）。例如从本地完整仓库、位于已验证的提交上手动执行：

```bash
git subtree split --prefix=streamlit_readonly -b streamlit-release
git push origin streamlit-release
```

在 OpenXLab 中关联**同一个 GitHub 仓库**，选择 `streamlit-release` 分支、`app.py` 入口和 `7860` 端口；若确有「上海」可用则优先上海，否则选择免费 CPU 资源。配置私有 `DASHBOARD_PASSWORD`，不要把它写入 GitHub。

**当前并未创建或自动推送 streamlit-release 分支**。未来需要在全量 CI 和安全发布门禁通过后，才允许自动化生成该分支。OpenXLab 官方资料中的「同步代码」不是已证实的 GitHub push 立即自动部署能力，不得宣称已开启。

## 隔离边界

- 当前不会连接 Node 后端、V6 账户、订单、风控、券商 API 或实盘交易。
- 不使用 OpenAI 及其他云模型 API。
- 抓取的时间不等于交易所原始行情时间，不可宣称具备可交易实时价。
- 回测仅用于教学，未模拟停牌、涨跌停不可成交、复权/分红等，非专业回测。
- 未部署到公网，手机/电脑连通性未测，亦未验证 OpenXLab/Zeabur 真实行情。
- 下阶段若要复用 V6 核心数据，只能由原 V6 授权接口提供**脱敏、只读、带原始时间和来源的展示数据**，不复制策略代码或开启任何交易 API。详见同目录 `INTEGRATION_CONTRACT.md`。
