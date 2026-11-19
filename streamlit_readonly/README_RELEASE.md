# 天枢智策 V6 | A股只读网页预览（非完整 V6）

**这是从同一 GitHub 仓库 `solviq87-cpu/v6-stock-system` 的 `streamlit_readonly/` 导出的纯网页启动分支。**
它不包含、也不连接 FAYO 正式后台、交易、券商、账户、订单或 V6 主策略，不代表完整 V6 已上线。

- 本分支：`streamlit-release`，根目录 `app.py` + `requirements.txt`，端口 7860
- 网页：AKShare 公开行情、条件筛选、个股日线和教学型均线回测
- 安全：必须在部署平台的**私有环境变量**设置 `DASHBOARD_PASSWORD` 才会允许查看面板；不要把密码提交到 Git
- 限制：数据可能延迟或暂不可用；不伪造旧价、未知报价或上涨概率；没有交易能力
- 资源：OpenXLab 文档的预装 Python 3.9 可使用本分支按环境选择的旧版依赖；如平台提供新的 Python，可选择新版
- OpenXLab 建议：组件 Streamlit、仓库 `solviq87-cpu/v6-stock-system`、分支 `streamlit-release`、入口 `app.py`、7860；上海节点仅在平台实际提供时选择
- Zeabur 备用：可直接绑定 `streamlit-release` 分支；自动 GitHub push 部署以平台账户资源和当前状态为准
- **OpenXLab GitHub push 后自动重建尚未获得官方保证**。若平台要求「同步代码」，需要使用该操作，不得当作已开启自动更新
- 这不是个人账户安全数据库，不能放入私有持仓、密钥和令牌；仅公开行情预览
- 免费资源的可用性、实际公网连通和 AKShare 现场返回，均需部署后核实

原始源码唯一维护位置：`dev` 上的 `streamlit_readonly/`（目前对应 PR #303 草稿，待门禁合并）。切换托管平台只需改部署设置，无需重新开发看盘界面。

## 可复现的本地启动

```bash
python -m pip install -r requirements.txt
export DASHBOARD_PASSWORD='请在本机设置你自己的长随机密码'
python -m streamlit run app.py --server.address 127.0.0.1 --server.port 7860 --server.headless true
```
