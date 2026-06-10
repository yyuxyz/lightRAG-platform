$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LightRAGRoot = Split-Path -Parent $Root
$PlatformBackend = Join-Path $Root 'backend'
$Logs = Join-Path $Root 'logs'
$Data = Join-Path $Root 'data'
$PidDir = Join-Path $Root 'run'
$Python = Join-Path $LightRAGRoot 'app\.venv\Scripts\python.exe'

New-Item -ItemType Directory -Force -Path $Logs, $Data, $PidDir | Out-Null

function Test-Http($Url) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 4
    return $resp.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (Test-Http 'http://127.0.0.1:9621/api/platform/health') {
  Write-Host 'LightRAG Platform is already running: http://127.0.0.1:9621'
  exit 0
}

$env:LIGHTRAG_PLATFORM_HOME = $Root
$env:LIGHTRAG_ROOT = $LightRAGRoot
$env:PLATFORM_DATA_DIR = $Data
$env:PLATFORM_STATIC_DIR = Join-Path $Root 'frontend\dist'
$env:PLATFORM_LOG_DIR = $Logs
$env:PLATFORM_RUN_DIR = $PidDir
$env:LIGHTRAG_RUNTIME_PORT_BASE = '9700'
$env:PYTHONPATH = $PlatformBackend
$pfOut = Join-Path $Logs 'platform.out.log'
$pfErr = Join-Path $Logs 'platform.err.log'
$pfProc = Start-Process -FilePath $Python -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','9621') -WorkingDirectory $PlatformBackend -RedirectStandardOutput $pfOut -RedirectStandardError $pfErr -WindowStyle Hidden -PassThru
Set-Content -Path (Join-Path $PidDir 'platform.pid') -Value $pfProc.Id -Encoding ASCII
Start-Sleep -Seconds 6

if (-not (Test-Http 'http://127.0.0.1:9621/api/platform/health')) {
  throw 'Platform did not become healthy on http://127.0.0.1:9621/api/platform/health'
}

Write-Host 'LightRAG Platform started: http://127.0.0.1:9621'
Write-Host 'LightRAG runtimes start on demand at 127.0.0.1:9700 + user_id.'
Write-Host 'Default admin: admin / ChangeMe123!  Please change it after first login.'
