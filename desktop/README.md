# Deep Mine — macOS desktop app

This folder wraps the `artifacts/tunnel-shooter` web game in an Electron shell
so it can be packaged as a native **Deep Mine.app** / **.dmg** for macOS.

It is intentionally **not** part of the pnpm workspace — Electron and
electron-builder are heavy and would bloat the Replit dev container. You
install and build this folder separately on your Mac.

## Prerequisites (on your Mac)

- macOS 12+ (Apple Silicon or Intel)
- Node.js 20 or 22
- pnpm (`npm install -g pnpm`) — used to build the web app via the workspace
- Xcode Command Line Tools (`xcode-select --install`) — required by
  electron-builder for `.dmg` creation

## One-time setup

From the **repo root**, install the web workspace deps:

```bash
pnpm install
```

Then from this `desktop/` folder, install Electron + builder:

```bash
cd desktop
npm install
```

## Run it locally (no packaging)

```bash
npm start
```

This builds the web bundle, copies it into `dist-web/`, and launches Electron
pointed at the local `file://` build. Use this to iterate quickly.

## Build the macOS app

```bash
npm run dist
```

Produces:

- `release/Deep Mine-<version>-arm64.dmg` (Apple Silicon)
- `release/Deep Mine-<version>.dmg`        (Intel)
- matching `.zip` archives

The output is **unsigned** by default (`identity: null` in `package.json`),
so the first time you open the app macOS Gatekeeper will warn. You can
either:

1. Right-click the app → **Open** → confirm, or
2. Set `CSC_IDENTITY_AUTO_DISCOVERY=true` plus a Developer ID in your
   keychain to sign automatically, then run `npm run dist` again.

For an unpacked test build (no `.dmg`, fastest):

```bash
npm run pack
open release/mac-arm64/Deep\ Mine.app
```

## Custom icon (optional)

Drop a 1024×1024 PNG at `build/icon.png` before running `npm run dist`.
Without one, electron-builder will warn and use the default Electron icon.

## How it works

- `scripts/build-web.mjs` shells out to `pnpm --filter @workspace/tunnel-shooter run build`
  with `BASE_PATH=./` so the emitted `index.html` uses relative asset paths
  (required for `file://` loading inside Electron). Output is copied into
  `dist-web/`.
- `main.cjs` opens a `BrowserWindow` with secure defaults (`contextIsolation`,
  `sandbox`, no Node integration) and loads `dist-web/index.html`.
- Pointer-lock, WebGL, WebAudio, and `localStorage` all work normally under
  `file://` in Electron, so the game's mouse-aim, settings persistence, and
  touch controls all behave as in the browser build.
- The Slack-faces feature fetches `/api/slack/faces` from the dev API server
  in the browser build. Inside the packaged app that request fails silently
  and the enemies fall back to plain robot faces — no crash, no errors.

## Notes for cross-platform users

This config only targets macOS today. To add Windows or Linux:

```jsonc
"win": { "target": ["nsis"] },
"linux": { "target": ["AppImage"] }
```

and run `npm run dist -- --win --linux` from the matching host OS.
