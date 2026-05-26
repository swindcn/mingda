import { Building2 } from 'lucide-react'
import { PartnerDirectoryPage } from './components/PartnerDirectoryPage'
import {
  createSupplierOnApi,
  deleteSupplierOnApi,
  fetchSuppliersFromApi,
  loadSuppliers,
  saveSuppliers,
  updateSupplierOnApi,
} from '../../utils/masterData'

export function SupplierManagementPage() {
  return (
    <PartnerDirectoryPage
      title="供应商管理"
      description="管理供应商档案、联系人、地址和联系电话。"
      entityName="供应商"
      idPrefix="SUP"
      searchPlaceholder="搜索供应商名称、供应商ID、联系人、电话或地址"
      autoIdNotice="系统将自动为新供应商分配唯一的供应商ID编号。"
      icon={<Building2 size={24} />}
      iconBackground="#d1fae5"
      iconColor="#059669"
      loadRecords={loadSuppliers}
      saveRecords={saveSuppliers}
      fetchRecords={fetchSuppliersFromApi}
      createRecord={createSupplierOnApi}
      updateRecord={updateSupplierOnApi}
      deleteRecord={deleteSupplierOnApi}
    />
  )
}
