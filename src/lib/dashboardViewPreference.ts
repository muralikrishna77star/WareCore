export type DashboardView = 'existing' | 'classic' | 'modern'

export const DASHBOARD_VIEW_KEY = 'warecore.dashboard.view.v1'

const VALID_VIEWS: DashboardView[] = ['existing', 'classic', 'modern']

export function isDashboardView(value: unknown): value is DashboardView {
  return typeof value === 'string' && (VALID_VIEWS as string[]).includes(value)
}

export function readStoredDashboardView(): DashboardView {
  try {
    const stored = window.localStorage.getItem(DASHBOARD_VIEW_KEY)
    return isDashboardView(stored) ? stored : 'existing'
  } catch {
    return 'existing'
  }
}

export function writeStoredDashboardView(view: DashboardView) {
  try {
    window.localStorage.setItem(DASHBOARD_VIEW_KEY, view)
  } catch {
    // localStorage unavailable (private browsing, etc.) — selection just won't persist
  }
}
