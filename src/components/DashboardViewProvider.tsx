'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  type DashboardView,
  readStoredDashboardView,
  writeStoredDashboardView,
} from '@/lib/dashboardViewPreference'

type Ctx = {
  view: DashboardView
  setView: (view: DashboardView) => void
}

const DashboardViewContext = createContext<Ctx | null>(null)

export function useDashboardView(): Ctx {
  const ctx = useContext(DashboardViewContext)
  if (!ctx) throw new Error('useDashboardView must be used within DashboardViewProvider')
  return ctx
}

export function DashboardViewProvider({ children }: { children: ReactNode }) {
  // First paint is always 'existing' (matches server render, avoids hydration
  // mismatch); any stored Classic/Modern preference is applied right after mount.
  const [view, setViewState] = useState<DashboardView>('existing')

  useEffect(() => {
    setViewState(readStoredDashboardView())
  }, [])

  const setView = (next: DashboardView) => {
    setViewState(next)
    writeStoredDashboardView(next)
  }

  return <DashboardViewContext.Provider value={{ view, setView }}>{children}</DashboardViewContext.Provider>
}
