import { Navigate, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
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
import { RecipeManagementPage } from './pages/modeling/RecipeManagementPage'
import { CastingBomManagementPage } from './pages/modeling/CastingBomManagementPage'
import { MoldArchivePage } from './pages/modeling/MoldArchivePage'
import { WorkshopLinePage } from './pages/modeling/WorkshopLinePage'
import { OperationManagementPage } from './pages/modeling/OperationManagementPage'
import { ProcessRoutingListPage } from './pages/modeling/ProcessRoutingListPage'
import { ProcessRoutingWorkbenchPage } from './pages/modeling/ProcessRoutingWorkbenchPage'
import { createModelingPage, modelingPages } from './pages/modeling/modelingConfigs'
import { ResourceParserPage } from './pages/resource/ResourceParserPage'
import { HeatOrderDetailPage } from './pages/production/HeatOrderDetailPage'
import { HeatOrderListPage } from './pages/production/HeatOrderListPage'
import { MeltSchedulingPage } from './pages/production/MeltSchedulingPage'
import { WorkOrderListPage } from './pages/production/WorkOrderListPage'
import { WorkOrderWorkbenchPage } from './pages/production/WorkOrderWorkbenchPage'
import {
  CoreInventoryPlaceholderPage,
  CoreTaskDetailPlaceholderPage,
  CoreTaskListPlaceholderPage,
} from './pages/production/CoremakingPlaceholderPages'
import { apiRequest } from './services/api'
import { hasPermission } from './utils/roles'

function clearLogin() {
  window.localStorage.removeItem('mingda-admin-token')
  window.localStorage.removeItem('mingda-admin-user')
}

function hasLocalLogin() {
  const token = window.localStorage.getItem('mingda-admin-token')
  const rawUser = window.localStorage.getItem('mingda-admin-user')
  if (!token || !rawUser) return false

  try {
    const user = JSON.parse(rawUser) as { id?: string; name?: string; username?: string }
    return Boolean(user.id && (user.name || user.username))
  } catch {
    clearLogin()
    return false
  }
}

function RequireAuth({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(() => hasLocalLogin())
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    if (!hasLocalLogin()) {
      setChecking(false)
      setAuthenticated(false)
      return
    }
    let cancelled = false
    apiRequest<{ id: string }>('/auth/me')
      .then((user) => {
        if (!cancelled) {
          window.localStorage.setItem('mingda-admin-user', JSON.stringify(user))
          setAuthenticated(true)
          setChecking(false)
        }
      })
      .catch(() => {
        clearLogin()
        if (!cancelled) {
          setAuthenticated(false)
          setChecking(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (checking) return null

  if (!authenticated) {
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
        <Route path="departments" element={protectedPage('basic.department', <DepartmentManagementPage />)} />
        <Route path="departments/help" element={<DepartmentConfigHelpPage />} />
        <Route path="roles" element={protectedPage('basic.role', <RolePermissionPage />)} />
        <Route path="users" element={protectedPage('basic.user', <UserManagementPage />)} />
        <Route path="products" element={protectedPage('basic.product', <ProductManagementPage />)} />
        <Route path="dictionaries" element={protectedPage('basic.dictionary', <DictionarySettingsPage />)} />
        <Route path="suppliers" element={protectedPage('basic.supplier', <SupplierManagementPage />)} />
        <Route path="customers" element={protectedPage('basic.customer', <CustomerManagementPage />)} />
        <Route path="mold/development" element={protectedPage('mold.development.view', <MoldDevelopmentPage />)} />
        <Route path="mold/development/:id" element={protectedPage('mold.development.view', <MoldDevelopmentDetailPage />)} />
        <Route path="model/workshop-line" element={protectedPage('model.workshop-line.view', <WorkshopLinePage />)} />
        <Route path="model/team" element={protectedPage('model.team.view', createModelingPage(modelingPages[2]))} />
        <Route path="model/equipment" element={protectedPage('model.equipment.view', createModelingPage(modelingPages[3]))} />
        <Route path="model/material" element={protectedPage('model.material.view', createModelingPage(modelingPages[5]))} />
        <Route path="model/recipe" element={protectedPage('model.recipe.view', <RecipeManagementPage />)} />
        <Route path="model/bom" element={protectedPage('model.bom.view', <CastingBomManagementPage />)} />
        <Route path="mold/model" element={protectedPage('mold.model.view', <MoldArchivePage />)} />
        <Route path="mold/corebox" element={protectedPage('mold.corebox.view', createModelingPage(modelingPages[8]))} />
        <Route path="model/shift" element={protectedPage('model.calendar.view', createModelingPage(modelingPages[9]))} />
        <Route path="model/calendar" element={protectedPage('model.calendar.view', createModelingPage(modelingPages[10]))} />
        <Route path="model/operation" element={protectedPage('model.operation.view', <OperationManagementPage />)} />
        <Route path="model/routing" element={protectedPage('model.routing.view', <ProcessRoutingListPage />)} />
        <Route path="model/routing/new" element={protectedPage('model.routing.create', <ProcessRoutingWorkbenchPage />)} />
        <Route path="model/routing/:id" element={protectedPage('model.routing.view', <ProcessRoutingWorkbenchPage />)} />
        <Route path="model/routing/:id/edit" element={protectedPage('model.routing.edit', <ProcessRoutingWorkbenchPage />)} />
        <Route path="model/defect" element={protectedPage('model.defect.view', createModelingPage(modelingPages.find((page) => page.resource === 'defects')!))} />
        <Route path="model/schedule" element={protectedPage('model.schedule.view', <ShiftSchedulePage />)} />
        <Route path="production/work-orders" element={protectedPage('production.work_order.view', <WorkOrderListPage />)} />
        <Route path="production/work-orders/new" element={protectedPage('production.work_order.create', <WorkOrderWorkbenchPage />)} />
        <Route path="production/work-orders/:id" element={protectedPage('production.work_order.view', <WorkOrderWorkbenchPage />)} />
        <Route path="production/work-orders/:id/edit" element={protectedPage('production.work_order.edit', <WorkOrderWorkbenchPage />)} />
        <Route path="production/core-tasks" element={protectedPage('production.core_task.view', <CoreTaskListPlaceholderPage />)} />
        <Route path="production/core-tasks/:id" element={protectedPage('production.core_task.view', <CoreTaskDetailPlaceholderPage />)} />
        <Route path="production/core-inventory" element={protectedPage('production.core_inventory.view', <CoreInventoryPlaceholderPage />)} />
        <Route path="production/melt-scheduling" element={protectedPage('production.schedule.view', <MeltSchedulingPage />)} />
        <Route path="production/heat-orders" element={protectedPage('production.heat.view', <HeatOrderListPage />)} />
        <Route path="production/heat-orders/:id" element={protectedPage('production.heat.view', <HeatOrderDetailPage />)} />
        <Route path="resources/parser" element={<ResourceParserPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
