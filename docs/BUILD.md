# Build and package

## Prerequisites

- Node.js 24 or later and npm.
- Windows x64 or macOS for the corresponding native packages.
- Network access to download the locked dependencies and Electron runtime.

Maya, Blender, and FFmpeg are external tools. They are not bundled in the application package.

## Source setup

```sh
git clone https://github.com/ryonghwon/render-farm.git
cd render-farm
npm ci
npm run dev
```

If package lifecycle scripts are disabled by local npm policy, approve Electron's installation script before launching the app. The renderer uses React; the desktop shell and render engine use Electron and TypeScript.

## Validation

```sh
npm run typecheck
npm run format:check
npm test
npm run build
```

The engine suite uses temporary projects and mock renderers. It isolates application discovery from the host's real Maya and Blender installations. Its executable mock fixtures require a POSIX host. The process and platform unit tests also run independently on Windows:

```sh
node --import tsx --test test/platform.test.ts test/runner.test.ts
```

Power-action tests inspect commands or use dry-run mode. They do not shut down the test machine. To inspect the UI with separate settings, launch with `RENDERFARM_DATA_DIR` pointing to a temporary directory and `RENDERFARM_DRY_POWER=1`.

## Windows packages

Run on Windows for native packaging:

```sh
npm ci
npm run dist:win
```

Outputs in `dist/`:

- `Render-Farm-<version>-Windows-x64-Setup.exe`
- `Render-Farm-<version>-Windows-x64-Portable.exe`

## Mac packages

Run on macOS:

```sh
npm ci
npm run dist:mac
```

The build produces separate Apple Silicon and Intel archives in `dist/`:

- `Render-Farm-<version>-macOS-arm64.zip`
- `Render-Farm-<version>-macOS-x64.zip`

`npm run dist:dir` creates an unpacked app for inspection. Builds use the same source tree; application discovery, process termination, and completion actions select behavior at runtime.

## Signing and distribution

The checked-in configuration ad-hoc signs Mac bundles and leaves Windows packages unsigned. Mac builds are not notarized. For signed Mac distribution, set a Developer ID identity, enable hardened runtime, configure required entitlements, and provide notarization credentials to electron-builder. Configure a Windows signing certificate or supported signing service for Windows releases. Keep credentials outside the repository.

Retain the application identifier and data-directory selection when changing display names. Before publishing, verify startup, renderer discovery, a real render, output-folder access, cancellation, and queue recovery on each target operating system. Generate checksums for the final downloadable artifacts.

Verify each final Mac archive after packaging:

```sh
node scripts/verify-mac.cjs dist/Render-Farm-0.1.0-macOS-arm64.zip dist/Render-Farm-0.1.0-macOS-x64.zip
```

This extracts a temporary copy, checks archive integrity, validates the complete code signature, and checks executable permissions. It does not certify notarization or replace an actual launch test. CI validates source on Linux and builds packages on Windows and macOS; it never overwrites published release assets.
