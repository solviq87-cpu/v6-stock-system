V6 1083/BN 原包无损分片说明

原包：V6_1083_full_20261106bn.zip
原包大小：70,485,833 字节
原包 SHA-256：f5fa0209f6b2045933cd3662600ab08b880c35ac3f3da8fae88619bc72ac8e78

本套共 4 个普通 ZIP，四份都需要下载和上传。
这些是同一原 ZIP 的连续字节分片，不是四个独立项目，也不是传统 .z01 多卷 ZIP。
手机上不用解压或合并。每个 ZIP 都包含一个数据片段、同一份清单、本说明和还原脚本。
不得直接拼接四个外层 ZIP；应由脚本读取内部片段并按清单顺序恢复。

四个文件：
V6_1083_full_20261106bn_part01of04.zip
V6_1083_full_20261106bn_part02of04.zip
V6_1083_full_20261106bn_part03of04.zip
V6_1083_full_20261106bn_part04of04.zip

交给智能体或在电脑上的还原步骤（Python 3.8+，无需第三方依赖）：
1. 下载四个外层 ZIP 到同一个目录。每份只保留一份。
2. 从任意一包中取出 restore_v6_bn.py；不必解压整个包装包。
3. 在四包所在目录运行：
   python3 restore_v6_bn.py --parts-dir . --output-dir restored
4. 成功后原包位于：restored/V6_1083_full_20261106bn.zip

示例：只提取还原脚本（此命令中的第一包文件名按实际下载名填写）：
python3 -c "import pathlib,zipfile; z=zipfile.ZipFile('V6_1083_full_20261106bn_part01of04.zip'); pathlib.Path('restore_v6_bn.py').write_bytes(z.read('restore_v6_bn.py'))"

脚本按内部片段名称和清单识别各包，外层文件名添加下载后缀不影响还原。
脚本会拒绝缺包、重复包、版本不符、大小不符或校验失败；不会覆盖已有的不同内容同名文件。
还原成功必须满足原包大小和 SHA-256，并通过 ZIP CRC 检查。

恢复 ZIP 仅完成原文件还原。后续源码比对与整合应以最新 dev 为基准，
保留原包功能和仓库有效修复，在独立分支完成必要测试，再通过 PR 提交。
本包身份为 1083/BN，不得套用 1090/BO 的文件名或校验值。
