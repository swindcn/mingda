# 工艺路线回收站设计

## 目标

将已停用工艺路线版本从日常列表归档到回收站，保持列表清晰，同时保留生产工单和历史追溯关系。

## 业务规则

- 回收站作用于 `ProcessRoutingVersion`，不物理删除路线主档、节点、设备、产品和历史工单关系。
- 只有 `DISABLED` 版本可以移入回收站；草稿和已生效版本禁止回收。
- 普通列表默认只返回未回收版本；回收站只返回 `recycledAt` 非空的已停用版本。
- 回收站支持查看和恢复。恢复后仍是已停用状态，重新出现在普通列表的“已停用”筛选中。
- 已回收版本不可创建新版本、克隆或执行其他业务动作，必须先恢复。
- 回收和恢复使用独立权限 `model.routing.recycle`；查看继续使用 `model.routing.view`。
- 回收不参与产品归属判定。已停用路线本身已经释放产品，回收仅影响列表展示。

## 交互

- 工艺路线页面右上角增加“回收站”按钮。
- 已停用记录的操作列增加“回收”操作。
- 回收站以弹窗展示路线编号、名称、版本、创建人、回收时间及操作。
- 回收站操作为“查看”和“恢复”，不提供永久删除。

## 数据与接口

- `ProcessRoutingVersion.recycledAt DateTime?` 保存回收时间。
- `GET /admin/modeling/routings?recycled=true` 查询回收站；普通请求默认 `recycled=false`。
- `POST /admin/modeling/routings/:id/recycle` 移入回收站。
- `POST /admin/modeling/routings/:id/restore` 恢复。

## 验证

- 已停用版本回收后从普通列表消失、在回收站出现，详情及历史关系仍可读取。
- 草稿和已生效版本不能回收。
- 恢复后回到普通列表，状态保持已停用。
- 无 `model.routing.recycle` 权限时不显示回收/恢复操作，接口返回无权执行。
