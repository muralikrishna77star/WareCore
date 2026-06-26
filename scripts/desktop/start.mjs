#!/usr/bin/env node
// Desktop launcher: starts an embedded Postgres, applies pending migrations,
// spawns the standalone Next.js server (built via `npm run build`) against
// it, and opens it full-screen, chromeless (Chromium --kiosk --app) once
// ready — falls back to the system default browser if no Chromium-based
// browser is found.
//
// Usage: node scripts/desktop/start.mjs   (after `npm run build`)
//
// Env overrides: WARECORE_DATA_DIR, WARECORE_PG_PORT, PORT

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn, execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import EmbeddedPostgres from 'embedded-postgres'
import { runPendingMigrations } from './migrate.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appDir = join(__dirname, '..', '..')

const dataDir = process.env.WARECORE_DATA_DIR || join(appDir, 'warecore-data')
const pgDataDir = join(dataDir, 'pgdata')
const pgPort = Number(process.env.WARECORE_PG_PORT || 55432)
const appPort = Number(process.env.PORT || 3210)
const pgUser = 'warecore'
const pgPassword = 'warecore_local'
const pgDatabase = 'warecore'

const standaloneServer = join(appDir, '.next', 'standalone', 'server.js')
const migrationsDir = join(appDir, 'supabase', 'migrations')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Sessions are signed with a JWT — generate a random secret once per install
// and persist it next to the Postgres data dir so restarts don't invalidate
// existing logins, and a fresh install doesn't reuse the same secret.
function getOrCreateJwtSecret() {
  const secretFile = join(dataDir, 'jwt-secret')
  if (existsSync(secretFile)) {
    return readFileSync(secretFile, 'utf-8').trim()
  }
  mkdirSync(dataDir, { recursive: true })
  const secret = randomBytes(32).toString('hex')
  writeFileSync(secretFile, secret)
  return secret
}

const KIOSK_BROWSER_PATHS = [
  // Edge ships with Windows by default, so it's checked first.
  join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
]

function findKioskBrowser() {
  return KIOSK_BROWSER_PATHS.find((p) => existsSync(p))
}

function openBrowser(url, browserProfileDir) {
  const browser = findKioskBrowser()

  if (browser) {
    // --kiosk --app=<url>: full-screen, no address bar/tabs/title bar — looks
    // like a standalone app rather than a browser window. A dedicated
    // --user-data-dir avoids touching the user's normal browser profile and
    // skips first-run prompts. Closing it requires Alt+F4 (no visible close
    // button in kiosk mode) — that only closes the window, the launcher
    // (and its embedded Postgres) keeps running until Ctrl+C in its console.
    spawn(browser, [
      `--app=${url}`,
      '--kiosk',
      `--user-data-dir=${browserProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ], { detached: true, stdio: 'ignore' }).unref()
    return
  }

  console.warn('No Chromium-based browser found for kiosk mode — opening in the default browser instead.')
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref()
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) return true
    } catch {
      // not up yet
    }
    await sleep(300)
  }
  return false
}

// embedded-postgres's stop() uses `taskkill /pid <pid> /f /t` on Windows,
// which has been observed to occasionally miss a postgres.exe worker process
// (e.g. after the desktop title bar's Close button forcefully kills the
// server) — the orphan keeps the data dir's shared-memory segment open, so
// a later launch fails with "pre-existing shared memory block is still in
// use". Windows postgres workers (--forkchild=...) don't repeat the data
// dir in their own command line, so matching on that misses them — instead
// match on the embedded binary's path itself (always present, since every
// one of our processes, main or worker, re-execs that same binary). That
// path lives under node_modules/@embedded-postgres/, which a separately
// installed system Postgres (e.g. a Program Files service) never matches,
// so this can't touch an unrelated Postgres on the same machine.
function reapOrphanedPostgres() {
  if (process.platform !== 'win32') return
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='postgres.exe'\\" | Where-Object { $_.CommandLine -like '*@embedded-postgres*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    )
  } catch {
    // best-effort cleanup — nothing to reap, or powershell unavailable
  }
}

async function isAlreadyRunning(url) {
  try {
    const res = await fetch(url)
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

async function main() {
  if (!existsSync(standaloneServer)) {
    console.error(`Standalone server not found at ${standaloneServer}. Run "npm run build" first.`)
    process.exit(1)
  }

  const appUrlEarly = `http://127.0.0.1:${appPort}/`
  if (await isAlreadyRunning(appUrlEarly)) {
    console.log(`WareCore is already running at ${appUrlEarly} — opening it instead of starting a second copy.`)
    openBrowser(appUrlEarly, join(dataDir, 'browser-profile'))
    return
  }

  const isFirstInit = !existsSync(join(pgDataDir, 'PG_VERSION'))

  const pg = new EmbeddedPostgres({
    databaseDir: pgDataDir,
    port: pgPort,
    user: pgUser,
    password: pgPassword,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  })

  let nextProcess

  const shutdown = async () => {
    if (nextProcess) nextProcess.kill()
    try {
      await pg.stop()
    } catch {
      // already stopped
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  reapOrphanedPostgres()

  console.log(`Starting embedded Postgres on port ${pgPort} (data dir: ${pgDataDir})...`)
  if (isFirstInit) {
    await pg.initialise()
  }
  await pg.start()
  if (isFirstInit) {
    await pg.createDatabase(pgDatabase)
  }

  const connectionString = `postgres://${pgUser}:${pgPassword}@127.0.0.1:${pgPort}/${pgDatabase}`

  try {
    console.log('Applying database migrations...')
    const { appliedCount, alreadyAppliedCount, totalFiles } = await runPendingMigrations({
      connectionString,
      migrationsDir,
    })
    console.log(`Migrations: ${appliedCount} applied, ${alreadyAppliedCount} already up to date (${totalFiles} total).`)
  } catch (err) {
    await pg.stop().catch(() => {})
    throw err
  }

  // `next build`'s standalone output doesn't include the static asset
  // folder (.next/static) — it expects the deployer to copy it in. Do that
  // here on every launch so a fresh `npm run build` never leaves the app
  // serving 404s for its own JS/CSS (which silently breaks client-rendered
  // pages like /login — no visible error, just missing inputs/content).
  const builtStatic = join(appDir, '.next', 'static')
  const standaloneStatic = join(dirname(standaloneServer), '.next', 'static')
  if (existsSync(builtStatic)) {
    cpSync(builtStatic, standaloneStatic, { recursive: true })
  }

  console.log(`Starting app server on port ${appPort}...`)
  nextProcess = spawn(process.execPath, [standaloneServer], {
    cwd: dirname(standaloneServer),
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      LOCAL_MODE: 'true',
      JWT_SECRET: getOrCreateJwtSecret(),
      PORT: String(appPort),
      HOSTNAME: '127.0.0.1',
    },
    stdio: 'inherit',
  })

  nextProcess.on('exit', (code) => {
    pg.stop().finally(() => process.exit(code ?? 0))
  })

  const appUrl = `http://127.0.0.1:${appPort}/`
  const ready = await waitForServer(appUrl, 30000)
  if (!ready) {
    console.error('App server did not become ready in time.')
    return
  }
  console.log(`WareCore is ready at ${appUrl}`)
  openBrowser(appUrl, join(dataDir, 'browser-profile'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
