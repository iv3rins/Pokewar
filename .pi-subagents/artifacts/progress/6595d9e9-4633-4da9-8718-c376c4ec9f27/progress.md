# Progress

- 已读取规范、架构/ADR、room、matchmaking、rating、replay 与 domain elimination 模型。
- 已确认现有链路只保存 replay，不执行 ranked 结算；room 丢失 ranked/account 快照；rating repository 只有查询；replay 与 Redis room 写入存在跨存储失败窗口。
- 正在输出可实现的数据模型、多人 Glicko-2/并列名次、事务幂等与测试清单。
