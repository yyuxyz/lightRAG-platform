$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LightRAGRoot = Split-Path -Parent $Root
$Bun = Join-Path $LightRAGRoot 'tools\bun\bin\bun.exe'
$Frontend = Join-Path $Root 'frontend'

Set-Location $Frontend
& $Bun install --cache-dir (Join-Path $LightRAGRoot '.bun-cache')
if ($LASTEXITCODE -ne 0) { throw "bun install failed with exit code $LASTEXITCODE" }
& $Bun .\node_modules\vite\bin\vite.js build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed with exit code $LASTEXITCODE" }
