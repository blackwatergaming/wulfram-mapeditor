# Windows desktop release

Wulfram Forge ships as a self-contained Windows x64 application hosted by
Microsoft Edge WebView2. The release executable embeds the entire production web
build and the .NET runtime; Node.js, npm, and a web server are not needed on the
target machine.

Build locally with a .NET 9 SDK:

```bash
npm ci
npm run build:desktop -- --version 0.5.0
```

The resulting artifact is
`dist/desktop/WulframForge-0.5.0-win-x64-self-contained.zip`. The executable
extracts its hashed web payload into the current user's local application-data
folder, maps it to `https://wulfram-forge.local`, and loads that origin in
WebView2. This preserves `localStorage`, downloads, WebGL, and keyboard controls
without listening on a network port.

The native shell opts into per-monitor-v2 DPI awareness, resets WebView content
zoom to 100%, and disables browser zoom so Windows display scaling is applied
exactly once. Responsive controls compact at small logical viewports while the
3D renderer caps its backing pixel ratio for predictable GPU cost.

The desktop bridge discovers `wulfram-maps` from `--maps-repo`, the
`WULFRAM_MAPS_REPO` environment variable, the last folder selected in the app,
or common sibling/Desktop locations. Repository source stays line-oriented and
is validated in JavaScript before it crosses the native bridge. Native code only
performs scoped file operations and invokes argument-safe local `git` commands
after the user chooses **Publish**.

## WebView2 runtime

The standard artifact uses the installed Evergreen WebView2 Runtime. To produce
a fully offline bundle with Microsoft's Fixed Version Runtime, first extract an
official x64 Fixed Version package, then set:

```powershell
$env:WEBVIEW2_FIXED_RUNTIME_DIR = 'C:\path\to\fixed-runtime'
npm run build:desktop -- --version 0.5.0
```

The build places it at `WulframForge/WebView2Runtime/` and labels the artifact
`offline-fixed-webview2`. At startup, the shell prefers that runtime and falls
back to Evergreen when it is absent. Microsoft notes that a Fixed Version runtime
adds more than 250 MB and must be serviced with application updates.

Pushing a `v*` tag runs [the release workflow](../.github/workflows/release.yml),
tests the portable fixture, builds the self-contained Windows artifact, records
its SHA-256 digest, and attaches both files to a GitHub Release.

## Headed performance and DPI check

For a local headed Edge measurement, launch the built executable with a
loopback debugging port and run the checked-in probe:

```powershell
Start-Process .\dist\desktop\win-x64\WulframForge.exe -Environment @{ WULFRAM_FORGE_REMOTE_DEBUGGING_PORT = '9223' }
npm run measure:desktop
```

On the 2560×1600, 200%-scaled verification display, WebView2 reported a
1280×730 CSS viewport at device-pixel-ratio 2, no document overflow, and about
60 frames per second both idle and during keyboard camera motion. The probe also
decodes a shipped texture inside the live origin and records a screenshot plus
console/network failures.
