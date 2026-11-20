// WareCore Service Worker
// Handles offline caching and "Add to Home Screen" PWA behavior

const CACHE_NAME = 'warecore-v1'
// The Offline Scan screen and the files it needs, kept so it opens with no signal.
// Cleared at sign-out (src/lib/tracking/offlineStore.ts uses the same name).
const OFFLINE_SCAN_CACHE = 'warecore-offline-scan'
const OFFLINE_SCAN_PATH = '/offline-scan'
const OFFLINE_SCAN_MAX_FILES = 300

// Assets to cache on install (app shell)
const STATIC_ASSETS = [
  '/offline',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
]

// Install — cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== OFFLINE_SCAN_CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Keeps the newest files only. Old build files are never needed again.
async function trimOfflineScanCache(cache) {
  const keys = await cache.keys()
  const extra = keys.length - OFFLINE_SCAN_MAX_FILES
  for (let i = 0; i < extra; i += 1) await cache.delete(keys[i])
}

// Only a full, normal page from our own site is kept, never a redirect to sign-in or an error.
function keepable(response) {
  return response && response.ok && response.type === 'basic' && !response.redirected
}

async function offlineScanPage(request) {
  const cache = await caches.open(OFFLINE_SCAN_CACHE)
  try {
    const response = await fetch(request)
    if (keepable(response)) {
      await cache.put(OFFLINE_SCAN_PATH, response.clone())
      await trimOfflineScanCache(cache)
    }
    return response
  } catch {
    return (await cache.match(OFFLINE_SCAN_PATH)) || (await caches.match('/offline'))
  }
}

// Build files for any page always come from the network as before. Only the
// files the Offline Scan screen loads are also kept, and they are served from
// the phone only when the network fails.
async function buildFile(event) {
  const { request } = event
  try {
    const response = await fetch(request)
    if (keepable(response) && event.clientId) {
      const client = await self.clients.get(event.clientId)
      if (client && new URL(client.url).pathname === OFFLINE_SCAN_PATH) {
        const cache = await caches.open(OFFLINE_SCAN_CACHE)
        await cache.put(request, response.clone())
      }
    }
    return response
  } catch (err) {
    const cached = await caches.match(request, { cacheName: OFFLINE_SCAN_CACHE })
    if (cached) return cached
    throw err
  }
}

// Fetch strategy:
// - Navigation requests: network-first, fallback to /offline
// - The Offline Scan screen: network-first, fallback to the copy kept on the phone
// - Static assets (icons, manifest): cache-first
// - API/GraphQL requests: network-only (never cache live data)
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Never intercept non-GET or cross-origin API calls
  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) return

  if (request.mode === 'navigate' && url.pathname === OFFLINE_SCAN_PATH) {
    event.respondWith(offlineScanPage(request))
    return
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(buildFile(event))
    return
  }

  // Cache-first for static icons and manifest
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    )
    return
  }

  // Network-first for all navigation/page requests
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline'))
    )
    return
  }
})
