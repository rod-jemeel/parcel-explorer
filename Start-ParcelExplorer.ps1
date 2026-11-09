$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
if (-not (Test-Path -LiteralPath 'apps/web/out/index.html')) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
}
Write-Host 'Open http://127.0.0.1:3100 . Press Ctrl+C to stop.'
& python scripts/serve_local.py
