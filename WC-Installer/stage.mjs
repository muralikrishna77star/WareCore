#!/usr/bin/env node
// Assembles WC-Installer/dist/ — the standalone, portable WareCore build.
// Zip this folder, extract it anywhere, and double-click "Start WareCore.bat"
// inside it. No installer, no admin rights, no separate toolchain. Run after
// `npm run build`.
//
// Requires a portable Windows Node.js build already extracted at
// WC-Installer/node-runtime/ (see WC-Installer/README.md) — this script does
// not download it, to avoid fetching binaries as part of a build script.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appDir = join(__dirname, '..')
const distDir = join(__dirname, 'dist')

function copy(src, destRelative, required = true) {
  if (!existsSync(src)) {
    if (required) {
      console.error(`Missing required path: ${src}`)
      process.exit(1)
    }
    return
  }
  cpSync(src, join(distDir, destRelative), { recursive: true })
}

mkdirSync(distDir, { recursive: true })

// Clear out only the specific build-artifact paths this script itself
// manages — NEVER the whole distDir wholesale. dist/warecore-data/ is the
// desktop app's live embedded-Postgres data directory (created by
// scripts/desktop/start.mjs on first run, not by this script) and sits
// right next to these artifacts; a blanket rmSync(distDir) here deleted a
// real running install's entire database with no warning, mid-session,
// the first time this script was re-run to pick up a code change while
// the app had actual data in it. Every path below is one this script is
// about to recreate anyway, so removing just these first is equivalent
// for staging purposes and leaves everything else in dist/ (warecore-data,
// any user-added files) alone.
const managedPaths = [
  'node-runtime',
  '.next',
  'supabase',
  'scripts',
  'package.json',
  'node_modules',
  '.env.desktop',
  'Start WareCore.bat',
]
for (const p of managedPaths) {
  rmSync(join(distDir, p), { recursive: true, force: true })
}

copy(join(__dirname, 'node-runtime'), 'node-runtime')
copy(join(appDir, '.next', 'standalone'), '.next/standalone')
copy(join(appDir, '.next', 'static'), '.next/standalone/.next/static')
copy(join(appDir, 'supabase', 'migrations'), 'supabase/migrations')
copy(join(appDir, 'scripts', 'desktop'), 'scripts/desktop')
copy(join(appDir, 'package.json'), 'package.json')

// embedded-postgres downloads its native Postgres binaries into
// node_modules/@embedded-postgres/<platform> on `npm install` — ship them so
// the standalone build works fully offline (no download on first run).
copy(join(appDir, 'node_modules', 'embedded-postgres'), 'node_modules/embedded-postgres')
copy(join(appDir, 'node_modules', '@embedded-postgres'), 'node_modules/@embedded-postgres')
copy(join(appDir, 'node_modules', 'pg'), 'node_modules/pg')
copy(join(appDir, 'node_modules', 'pg-cloudflare'), 'node_modules/pg-cloudflare', false)
copy(join(appDir, 'node_modules', 'pg-connection-string'), 'node_modules/pg-connection-string')
copy(join(appDir, 'node_modules', 'pg-int8'), 'node_modules/pg-int8')
copy(join(appDir, 'node_modules', 'pg-pool'), 'node_modules/pg-pool')
copy(join(appDir, 'node_modules', 'pg-protocol'), 'node_modules/pg-protocol')
copy(join(appDir, 'node_modules', 'pg-types'), 'node_modules/pg-types')
copy(join(appDir, 'node_modules', 'pgpass'), 'node_modules/pgpass')
copy(join(appDir, 'node_modules', 'bcryptjs'), 'node_modules/bcryptjs')

// Google Sign-In in the desktop build needs its own OAuth client secret
// (never the web app's — see GOOGLE_DESKTOP_CLIENT_ID's comment in
// src/lib/env.ts for why), shipped as a plain file inside the distributable
// since there's no .env.local on an end user's machine. Read from the
// staging shell's own env first (e.g. a CI secret), falling back to this
// repo's .env.local for a local `node WC-Installer/stage.mjs` run. Omitted
// entirely — not written as an empty file — when neither has it, so
// start.mjs's "file present" check is the single source of truth for
// whether this particular build carries the desktop OAuth client.
function readEnvLocalValue(key) {
  const envLocalPath = join(appDir, '.env.local')
  if (!existsSync(envLocalPath)) return ''
  const line = readFileSync(envLocalPath, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`))
  return line ? line.slice(key.length + 1).trim() : ''
}

const googleDesktopClientId = process.env.GOOGLE_DESKTOP_CLIENT_ID || readEnvLocalValue('GOOGLE_DESKTOP_CLIENT_ID')
const googleDesktopClientSecret = process.env.GOOGLE_DESKTOP_CLIENT_SECRET || readEnvLocalValue('GOOGLE_DESKTOP_CLIENT_SECRET')
if (googleDesktopClientId && googleDesktopClientSecret) {
  writeFileSync(
    join(distDir, '.env.desktop'),
    `GOOGLE_DESKTOP_CLIENT_ID=${googleDesktopClientId}\nGOOGLE_DESKTOP_CLIENT_SECRET=${googleDesktopClientSecret}\n`
  )
  console.log('Included desktop Google Sign-In credentials.')
} else {
  console.log('No GOOGLE_DESKTOP_CLIENT_ID/SECRET found — this build will not offer Google Sign-In (password login still works).')
}

// Launches via the signed node-runtime\node.exe directly — no new unsigned
// executable is ever created or run, so this isn't blocked by endpoint
// security/Defender the way an unsigned installer .exe would be.
writeFileSync(
  join(distDir, 'Start WareCore.bat'),
  '@echo off\r\ncd /d "%~dp0"\r\nnode-runtime\\node.exe scripts\\desktop\\start.mjs\r\npause\r\n'
)

console.log(`Staged standalone build at ${distDir}`)
console.log('Zip this dist/ folder, extract it anywhere, and double-click "Start WareCore.bat" inside it.')
