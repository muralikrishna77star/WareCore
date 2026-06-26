# Building the WareCore standalone desktop build (Windows)

One-time setup on the build machine (not part of this repo — external binary,
not downloaded automatically to avoid fetching binaries as part of a build
script):

1. **Portable Node.js runtime** — download the Windows x64 zip build from
   https://nodejs.org/en/download (matching the Node version this repo is
   developed against), extract it, and place its contents at
   `WC-Installer/node-runtime/` so that `WC-Installer/node-runtime/node.exe`
   exists.

## Build steps

```sh
npm run build              # produces .next/standalone + .next/static
node WC-Installer/stage.mjs # assembles WC-Installer/dist/
```

`stage.mjs` copies the standalone server build, `supabase/migrations/`,
`scripts/desktop/` (the launcher), and the runtime-only `node_modules`
subset the launcher needs (`embedded-postgres`, `pg`, and their
dependencies) into `WC-Installer/dist/` — that folder *is* the distributable
standalone app. Zip it, hand it to anyone, they extract it anywhere and
double-click `Start WareCore.bat`.

## Why there's no installer

An earlier version of this used Inno Setup to build a `WareCore-Setup.exe`.
Dropped it: an unsigned, freshly-built installer `.exe` gets blocked by
Windows Defender / endpoint security with "Access is denied" on managed
machines, while the portable Node.js runtime (`node.exe`, signed by the
Node.js Foundation) runs without issue. `Start WareCore.bat` just calls that
signed `node.exe` directly — no new executable is ever created or run, so
there's nothing for endpoint security to flag.

## What `Start WareCore.bat` does

Running it (from wherever `dist/` was extracted) runs:

```
node-runtime\node.exe scripts\desktop\start.mjs
```

which starts an embedded Postgres, applies all `supabase/migrations/*.sql`,
starts the bundled Next.js standalone server, and opens it full-screen via
Chromium `--kiosk --app` (Edge or Chrome, whichever is installed) — or the
setup page on first run (create an admin, or restore from a backup JSON
exported from the online app's Backup Manager — see
`src/app/setup/page.tsx`).

The embedded Postgres data directory (`warecore-data/`, containing the
user's actual data) is created next to wherever `Start WareCore.bat` lives.
Moving/deleting the extracted folder takes the data with it, so keep the
`dist/` extraction location wherever you intend to leave it long-term.
