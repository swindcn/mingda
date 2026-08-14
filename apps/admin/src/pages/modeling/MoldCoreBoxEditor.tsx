import { DeleteOutlined, PictureOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography } from 'antd'
import type { FormInstance } from 'antd'
import { useState } from 'react'
import { ImageUploadField } from '../../components/ImageUploadField'
import type { MoldArchiveRecord } from '../../utils/modeling'

interface MoldCoreBoxEditorProps {
  form: FormInstance<MoldArchiveRecord>
  readOnly?: boolean
  canCreate?: boolean
  canEdit?: boolean
}

export function MoldCoreBoxEditor({ form, readOnly = false, canCreate = false, canEdit = false }: MoldCoreBoxEditorProps) {
  const [imageRow, setImageRow] = useState<number | null>(null)
  const coreBoxes = Form.useWatch('coreBoxes', form) || []
  const imageRecord = imageRow === null ? undefined : coreBoxes[imageRow]
  const imageValues = Array.isArray(imageRecord?.images) ? imageRecord.images : []
  const imageReadOnly = readOnly || Boolean(imageRecord?.id ? !canEdit : !canCreate)

  return (
    <section className="mold-corebox-section">
      <div className="mold-corebox-section-title">
        <Typography.Title level={5}>芯盒明细</Typography.Title>
        <Form.Item noStyle shouldUpdate={(previous, current) => previous.coreBoxes !== current.coreBoxes}>
          {({ getFieldValue }) => <Tag>{(getFieldValue('coreBoxes') || []).length} 套</Tag>}
        </Form.Item>
      </div>
      <div className="mold-corebox-table">
        <div className="mold-corebox-row mold-corebox-head">
          <span>芯盒编码</span><span>芯盒名称</span><span>穴数</span><span>使用寿命</span><span>已用次数</span><span>状态</span><span>图片</span><span>备注</span><span>操作</span>
        </div>
        <Form.List name="coreBoxes">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Form.Item key={field.key} noStyle shouldUpdate>
                  {({ getFieldValue }) => {
                    const row = getFieldValue(['coreBoxes', field.name]) || {}
                    const persisted = Boolean(row.id)
                    const rowReadOnly = readOnly || (persisted ? !canEdit : !canCreate)
                    const images = Array.isArray(row.images) ? row.images : []
                    return (
                      <div className="mold-corebox-row">
                        <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
                        <Form.Item name={[field.name, 'code']} rules={[{ required: true, message: '请输入编码' }, { pattern: /^[^\s\u4e00-\u9fff]+$/, message: '不能包含中文或空格' }]}><Input disabled={rowReadOnly || persisted} /></Form.Item>
                        <Form.Item name={[field.name, 'name']} rules={[{ required: true, message: '请输入名称' }]}><Input disabled={rowReadOnly} /></Form.Item>
                        <Form.Item name={[field.name, 'cavityCount']} rules={[{ required: true, message: '请输入穴数' }]}><InputNumber disabled={rowReadOnly} min={1} precision={0} style={{ width: '100%' }} /></Form.Item>
                        <Form.Item name={[field.name, 'maxLife']}><InputNumber disabled={rowReadOnly} min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
                        <Form.Item name={[field.name, 'usedLife']}><InputNumber disabled={rowReadOnly} min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
                        <Form.Item name={[field.name, 'status']}><Select disabled={rowReadOnly} options={[{ value: '启用' }, { value: '停用' }]} /></Form.Item>
                        <Button icon={<PictureOutlined />} onClick={() => setImageRow(field.name)}>{images.length ? `${images.length}张` : '图片'}</Button>
                        <Form.Item name={[field.name, 'remark']}><Input disabled={rowReadOnly} /></Form.Item>
                        {!rowReadOnly && (
                          <Button
                            type="text"
                            danger
                            title={persisted ? '停用芯盒' : '移除芯盒'}
                            icon={<DeleteOutlined />}
                            onClick={() => persisted ? form.setFieldValue(['coreBoxes', field.name, 'status'], '停用') : remove(field.name)}
                          />
                        )}
                      </div>
                    )
                  }}
                </Form.Item>
              ))}
              {!readOnly && canCreate && (
                <Button className="mold-corebox-add" type="dashed" icon={<PlusOutlined />} onClick={() => add({ images: [], cavityCount: 1, usedLife: 0, status: '启用' })}>
                  新增芯盒
                </Button>
              )}
            </>
          )}
        </Form.List>
      </div>
      <Modal
        title={readOnly ? '查看芯盒图片' : '维护芯盒图片'}
        open={imageRow !== null}
        footer={null}
        onCancel={() => setImageRow(null)}
        destroyOnHidden
      >
        <ImageUploadField
          readOnly={imageReadOnly}
          value={imageValues}
          onChange={(images) => imageRow !== null && form.setFieldValue(['coreBoxes', imageRow, 'images'], images)}
        />
        <Space style={{ marginTop: 16 }}><Button onClick={() => setImageRow(null)}>关闭</Button></Space>
      </Modal>
    </section>
  )
}
