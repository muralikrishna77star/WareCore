#!/usr/bin/env node
// Assembles WC-Installer/dist/ — the standalone, portable WareCore build.
// Zip this folder, extract it anywhere, and double-click "Start WareCore.bat"
// inside it. No installer, no admin rights, no separate toolchain. Run after
// `npm run build`.
//
// Requires a portable Windows Node.js build already extracted at
// WC-Installer/node-runtime/ (see WC-Installer/README.md) — this script does
// not download it, to avoid fetching binaries as part of a build script.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

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

// Launches via the signed node-runtime\node.exe directly — no new unsigned
// executable is ever created or run, so this isn't blocked by endpoint
// security/Defender the way an unsigned installer .exe would be.
writeFileSync(
  join(distDir, 'Start WareCore.bat'),
  '@echo off\r\ncd /d "%~dp0"\r\nnode-runtime\\node.exe scripts\\desktop\\start.mjs\r\npause\r\n'
)

console.log(`Staged standalone build at ${distDir}`)
console.log('Zip this dist/ folder, extract it anywhere, and double-click "Start WareCore.bat" inside it.')
