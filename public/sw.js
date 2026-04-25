// WareCore Service Worker
// Handles offline caching and "Add to Home Screen" PWA behavior

const CACHE_NAME = 'warecore-v1'

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
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch strategy:
// - Navigation requests: network-first, fallback to /offline
// - Static assets (icons, manifest): cache-first
// - API/GraphQL requests: network-only (never cache live data)
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Never intercept non-GET or cross-origin API calls
  if (request.method !== 'GET') return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) return

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
