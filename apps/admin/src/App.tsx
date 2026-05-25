import { Navigate, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
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

function hasValidLogin() {
  const token = window.localStorage.getItem('mingda-admin-token')
  const rawUser = window.localStorage.getItem('mingda-admin-user')
  if (!token || !rawUser) return false

  try {
    const user = JSON.parse(rawUser) as { id?: string; name?: string; username?: string }
    return Boolean(user.id && (user.name || user.username))
  } catch {
    window.localStorage.removeItem('mingda-admin-token')
    window.localStorage.removeItem('mingda-admin-user')
    return false
  }
}

function RequireAuth({ children }: { children: ReactNode }) {
  if (!hasValidLogin()) {
    return <Navigate to="/" replace />
  }

  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
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
