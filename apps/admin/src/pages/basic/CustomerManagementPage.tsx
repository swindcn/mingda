import { UserCircle } from 'lucide-react'
import { PartnerDirectoryPage } from './components/PartnerDirectoryPage'
import {
  createCustomerOnApi,
  deleteCustomerOnApi,
  fetchCustomersFromApi,
  loadCustomers,
  saveCustomers,
  updateCustomerOnApi,
} from '../../utils/masterData'

export function CustomerManagementPage() {
  return (
    <PartnerDirectoryPage
      title="客户管理"
      description="管理客户档案、联系人、地址和联系电话。"
      entityName="客户"
      idPrefix="CUS"
      searchPlaceholder="搜索客户名称、客户ID、联系人、电话或地址"
      autoIdNotice="系统将自动为新客户分配唯一的客户ID编号。"
      icon={<UserCircle size={24} />}
      iconBackground="#f3e8ff"
      iconColor="#7c3aed"
      loadRecords={loadCustomers}
      saveRecords={saveCustomers}
      fetchRecords={fetchCustomersFromApi}
      createRecord={createCustomerOnApi}
      updateRecord={updateCustomerOnApi}
      deleteRecord={deleteCustomerOnApi}
    />
  )
}
