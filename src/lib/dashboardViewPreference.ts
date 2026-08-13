export type DashboardView = 'classic' | 'modern'

export const DASHBOARD_VIEW_KEY = 'warecore.dashboard.view.v1'

const VALID_VIEWS: DashboardView[] = ['classic', 'modern']

export function isDashboardView(value: unknown): value is DashboardView {
  return typeof value === 'string' && (VALID_VIEWS as string[]).includes(value)
}

export function readStoredDashboardView(): DashboardView {
  try {
    const stored = window.localStorage.getItem(DASHBOARD_VIEW_KEY)
    // A user with 'existing' stored from before the 3-way toggle was
    // retired lands on Modern, not Classic — closer to the old default look.
    return isDashboardView(stored) ? stored : 'modern'
  } catch {
    return 'modern'
  }
}

export function writeStoredDashboardView(view: DashboardView) {
  try {
    window.localStorage.setItem(DASHBOARD_VIEW_KEY, view)
  } catch {
    // localStorage unavailable (private browsing, etc.) — selection just won't persist
  }
}
