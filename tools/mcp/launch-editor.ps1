$ErrorActionPreference = 'Stop'
$forgeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$forgeExe = Join-Path $forgeRoot 'dist/desktop/mcp-v0.1.0/WulframForge.exe'
if (-not (Test-Path -LiteralPath $forgeExe)) { throw "MCP editor build is missing: $forgeExe" }
$forgeStart = [Diagnostics.ProcessStartInfo]::new()
$forgeStart.FileName = $forgeExe
$forgeStart.WorkingDirectory = $forgeRoot
$forgeStart.UseShellExecute = $false
$forgeStart.EnvironmentVariables['WULFRAM_FORGE_MCP'] = '1'
# Keep the user's regular editor autosave/profile separate from the MCP candidate.
$forgeStart.EnvironmentVariables['WULFRAM_FORGE_USER_DATA_DIR'] = Join-Path $env:LOCALAPPDATA 'BlackwaterGaming/WulframForge/McpWebView2'
$forgeStart.EnvironmentVariables.Remove('WULFRAM_FORGE_REMOTE_DEBUGGING_PORT')
$forgeStart.EnvironmentVariables.Remove('WULFRAM_MCP_SESSION_DIR')
[Diagnostics.Process]::Start($forgeStart) | Out-Null
