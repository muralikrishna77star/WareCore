export type ScreenDef = {
  code: string
  label: string
  path: string
}

export type ScreenGroup = {
  group: string
  icon: string
  screens: ScreenDef[]
}

export const SCREEN_GROUPS: ScreenGroup[] = [
  {
    group: 'Main',
    icon: '📱',
    screens: [
      { code: 'dashboard',  label: 'Dashboard',       path: '/dashboard' },
      { code: 'bills',      label: 'Purchase Entry',   path: '/bills' },
      { code: 'dispatch',   label: 'Sale Entry',       path: '/dispatch' },
      { code: 'inventory',  label: 'Inventory',        path: '/inventory' },
      { code: 'movements',  label: 'Movements',        path: '/movements' },
      { code: 'transfers',  label: 'Transfers',        path: '/transfers' },
      { code: 'jobwork',    label: 'Job Work',         path: '/jobwork' },
      { code: 'accounts',   label: 'Accounts',         path: '/accounts' },
    ],
  },
  {
    group: 'Reports',
    icon: '📈',
    screens: [
      { code: 'reports_billing',   label: 'Billing Report',     path: '/reports/billing' },
      { code: 'reports_dispatch',  label: 'Dispatch Report',    path: '/reports/dispatch' },
      { code: 'reports_stock',     label: 'Stock Statement',    path: '/reports/stock-statement' },
      { code: 'reports_movements', label: 'Movements Report',   path: '/reports/movements' },
      { code: 'reports_jobwork',   label: 'Job Work Report',    path: '/reports/jobwork' },
      { code: 'reports_transfers', label: 'Transfers Report',   path: '/reports/transfers' },
    ],
  },
  {
    group: 'Administration',
    icon: '⚙️',
    screens: [
      { code: 'admin_companies',  label: 'Companies',            path: '/admin/companies' },
      { code: 'admin_warehouses', label: 'Warehouses',           path: '/admin/warehouses' },
      { code: 'admin_suppliers',  label: 'Suppliers',            path: '/admin/suppliers' },
      { code: 'admin_customers',  label: 'Customers',            path: '/admin/customers' },
      { code: 'admin_materials',  label: 'Materials & Sizes',    path: '/admin/materials' },
      { code: 'admin_items',      label: 'Items & Groups',       path: '/admin/items' },
      { code: 'admin_users',      label: 'Users',                path: '/admin/users' },
      { code: 'admin_roles',      label: 'Roles & Permissions',  path: '/admin/roles' },
      { code: 'admin_tax_rates',  label: 'Tax Rates',            path: '/admin/tax-rates' },
      { code: 'admin_backup',     label: 'Backup & Restore',     path: '/admin/backups' },
    ],
  },
]

// Flat list for easy lookup
export const ALL_SCREENS: ScreenDef[] = SCREEN_GROUPS.flatMap(g => g.screens)

export const initialPermissions = (): Record<string, { can_read: boolean; can_write: boolean }> => {
  const state: Record<string, { can_read: boolean; can_write: boolean }> = {}
  for (const s of ALL_SCREENS) {
    state[s.code] = { can_read: false, can_write: false }
  }
  return state
}
