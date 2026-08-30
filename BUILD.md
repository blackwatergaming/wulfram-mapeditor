# Building Wulfram Forge

## Requirements

- Windows 10/11 x64
- Node.js 22.13 or newer
- npm
- .NET 9 SDK (the local `.dotnet-sdk` checkout is used automatically when present)
- Edge WebView2 Evergreen Runtime for the normal desktop package
- Git and GitHub CLI for map publishing; authenticate once with `gh auth login`

Install dependencies and run the complete verification gate:

```powershell
npm ci
npm run lint
npx tsc --noEmit
npm test
npm run verify:formats
npm run build
```

## Browser development build

```powershell
npm run dev
```

Open `http://localhost:3000`. This command also starts the loopback-only maps service at `http://127.0.0.1:4319`. To run only the service, use `npm run maps:serve`. Diagnose Git, GitHub CLI, checkout, remote, authentication, and branch setup with:

```powershell
npm run maps:doctor
```

Override checkout discovery when needed:

```powershell
$env:WULFRAM_MAPS_REPO = 'C:\path\to\wulfram-maps'
npm run dev
```

## Self-contained Windows release build

```powershell
npm run build:desktop -- --version 0.4.0
```

The archive is written to `dist/desktop/WulframForge-0.4.0-win-x64-self-contained.zip`. It contains the editor, original converted assets, and the .NET runtime. The installed Edge WebView2 Evergreen Runtime is the only external runtime dependency.

To include an official fixed WebView2 runtime for an offline package:

```powershell
$env:WEBVIEW2_FIXED_RUNTIME_DIR = 'C:\path\to\fixed-webview2-runtime'
npm run build:desktop -- --version 0.4.0
```

## Research/debug desktop build

Build the embedded web payload, start the desktop shell with a headed WebView2 debugging port, then run the measurement probe:

```powershell
npm run build:desktop-web
npm run desktop:assets
$env:WULFRAM_FORGE_REMOTE_DEBUGGING_PORT = '9223'
$env:WULFRAM_FORGE_USER_DATA_DIR = Join-Path $env:TEMP ('WulframForge-research-' + [Guid]::NewGuid().ToString('N'))
.\.dotnet-sdk\dotnet.exe run --project .\desktop\WulframForge\WulframForge.csproj -- --maps-repo ..\wulfram-maps
```

The isolated user-data directory lets a research build run alongside an installed Wulfram Forge instance without sharing or locking its WebView2 profile.

In another terminal:

```powershell
$env:WULFRAM_FORGE_CAMERA_TEST = '1'
$env:WULFRAM_FORGE_PREVIEW_TEST = '1'
$env:WULFRAM_FORGE_REPOSITORY_TEST = '1'
$env:WULFRAM_FORGE_WIZARD_TEST = '1'
$env:WULFRAM_FORGE_DRAG_TEST = '1'
$env:WULFRAM_FORGE_ESCAPE_TEST = '1'
$env:WULFRAM_FORGE_HEIGHTMAP_TEST = '1'
$env:WULFRAM_FORGE_BRUSH_TEST = '1'
npm run measure:desktop
```

The probe records layout, DPI, textures, frame timing, repository UI, placement previews, Shift-drag behavior, exact square height stamping, console failures, network failures, and `outputs/webview-measurement.png`.

## Map branches, pull requests, and releases

Create or switch a map-source branch manually when desired:

```powershell
npm run maps:branch -- maps/my-map --create
npm run maps:branch -- main
```

`npm run maps:publish -- my-map` never commits directly to `main`. From `main`, it creates a timestamped feature branch; from a feature branch, it uses that branch. It commits only the selected `maps/<slug>` source, pushes it, and opens or updates a pull request into `main`.

After reviewed map PRs are merged and the checkout is clean, compile packages or create a GitHub Release:

```powershell
npm run maps:compile -- --all
npm run maps:release -- v1.0.0
```

Editor releases are created by pushing a reviewed `v*` tag on `main`; `.github/workflows/release.yml` reruns tests, builds the Windows archive, writes SHA-256 checksums, and attaches both to the GitHub Release.
