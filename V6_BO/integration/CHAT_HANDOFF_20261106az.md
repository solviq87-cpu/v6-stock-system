# az 接手入口
基于ay980，新增四家外部行情网页入口，非授权数据流。先读AGENTS.md、PROVIDER_LINKS_OPERATIONS_20261106az.md、RISK_UI_REQUIREMENTS_20261106.md。主工程983测试通过；干净副本结果见provider-links-clean-tests.tap。旧功能与未完成项保留。下一步需要用户提供已授权接口账号能力说明，密钥只能在服务端配置；不能因网页可访问声称实时接口接通。不要使用附带旧av包覆盖本基线。

主工程与干净ZIP副本均983通过，0失败/跳过/取消。
