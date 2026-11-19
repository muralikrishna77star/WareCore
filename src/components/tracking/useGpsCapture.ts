'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ScanPosition } from '@/lib/tracking/constants'
import { trackingApi } from './api'

/** Never rejects: no permission, no signal or a slow fix all mean the scan goes ahead without a position. */
function readPosition(): Promise<ScanPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (fix) => resolve({ latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy_m: fix.coords.accuracy ?? null }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30_000 },
    )
  })
}

/** Asks for a position only during a scan, and only for a company that has switched GPS on. */
export function useGpsCapture() {
  const [companies, setCompanies] = useState<string[]>([])

  useEffect(() => {
    let current = true
    trackingApi<{ gpsCompanies: string[] }>('context')
      .then((data) => { if (current) setCompanies(data.gpsCompanies) })
      .catch(() => { /* GPS is optional, so scanning carries on without it. */ })
    return () => { current = false }
  }, [])

  return useCallback(
    (companyId: string) => (companies.includes(companyId) ? readPosition() : Promise.resolve(null)),
    [companies],
  )
}
