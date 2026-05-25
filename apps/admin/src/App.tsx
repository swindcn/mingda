import { Navigate, Route, Routes } from 'react-router'
import { AppLayout } from './layouts/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { CustomerManagementPage } from './pages/basic/CustomerManagementPage'
import { DepartmentConfigHelpPage } from './pages/basic/DepartmentConfigHelpPage'
import { DepartmentManagementPage } from './pages/basic/DepartmentManagementPage'
import { DictionarySettingsPage } from './pages/basic/DictionarySettingsPage'
import { ProductManagementPage } from './pages/basic/ProductManagementPage'
import { RolePermissionPage } from './pages/basic/RolePermissionPage'
import { SupplierManagementPage } from './pages/basic/SupplierManagementPage'
import { UserManagementPage } from './pages/basic/UserManagementPage'
import { MoldDevelopmentDetailPage } from './pages/mold/MoldDevelopmentDetailPage'
import { MoldDevelopmentPage } from './pages/mold/MoldDevelopmentPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/dashboard" element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard/mold/development" replace />} />
        <Route path="departments" element={<DepartmentManagementPage />} />
        <Route path="departments/help" element={<DepartmentConfigHelpPage />} />
        <Route path="roles" element={<RolePermissionPage />} />
        <Route path="users" element={<UserManagementPage />} />
        <Route path="products" element={<ProductManagementPage />} />
        <Route path="dictionaries" element={<DictionarySettingsPage />} />
        <Route path="suppliers" element={<SupplierManagementPage />} />
        <Route path="customers" element={<CustomerManagementPage />} />
        <Route path="mold/development" element={<MoldDevelopmentPage />} />
        <Route path="mold/development/:id" element={<MoldDevelopmentDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
