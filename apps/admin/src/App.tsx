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
import { ShiftSchedulePage } from './pages/modeling/ShiftSchedulePage'
import { WorkshopLinePage } from './pages/modeling/WorkshopLinePage'
import { createModelingPage, modelingPages } from './pages/modeling/modelingConfigs'
import { hasPermission } from './utils/roles'

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

function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  if (!hasPermission(permission)) {
    return <Navigate to="/dashboard/mold/development" replace />
  }

  return children
}

function protectedPage(permission: string, children: ReactNode) {
  return <RequirePermission permission={permission}>{children}</RequirePermission>
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
        <Route path="model/workshop-line" element={protectedPage('model.workshop-line.view', <WorkshopLinePage />)} />
        <Route path="model/team" element={protectedPage('model.team.view', createModelingPage(modelingPages[2]))} />
        <Route path="model/equipment" element={protectedPage('model.equipment.view', createModelingPage(modelingPages[3]))} />
        <Route path="model/material" element={protectedPage('model.material.view', createModelingPage(modelingPages[5]))} />
        <Route path="model/recipe" element={protectedPage('model.recipe.view', createModelingPage(modelingPages[6]))} />
        <Route path="mold/model" element={protectedPage('mold.model.view', createModelingPage(modelingPages[7]))} />
        <Route path="mold/corebox" element={protectedPage('mold.corebox.view', createModelingPage(modelingPages[8]))} />
        <Route path="model/shift" element={protectedPage('model.calendar.view', createModelingPage(modelingPages[9]))} />
        <Route path="model/calendar" element={protectedPage('model.calendar.view', createModelingPage(modelingPages[10]))} />
        <Route path="model/routing" element={protectedPage('model.routing.view', createModelingPage(modelingPages[11]))} />
        <Route path="model/defect" element={protectedPage('model.defect.view', createModelingPage(modelingPages[12]))} />
        <Route path="model/schedule" element={protectedPage('model.schedule.view', <ShiftSchedulePage />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
