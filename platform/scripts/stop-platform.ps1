$ErrorActionPreference = 'Continue'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PidDir = Join-Path $Root 'run'

foreach ($name in @('platform', 'lightrag-runtime')) {
  $pidFile = Join-Path $PidDir "$name.pid"
  if (Test-Path $pidFile) {
    $savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($savedPid -match '^\d+$') {
      $p = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
      if ($p) {
        Stop-Process -Id ([int]$savedPid) -Force
        Write-Host "Stopped $name PID $savedPid"
      }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}

if (Test-Path $PidDir) {
  foreach ($pidFile in Get-ChildItem -Path $PidDir -Filter 'runtime-*.pid' -ErrorAction SilentlyContinue) {
    $savedPid = Get-Content $pidFile.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($savedPid -match '^\d+$') {
      $p = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
      if ($p) {
        Stop-Process -Id ([int]$savedPid) -Force
        Write-Host "Stopped runtime PID $savedPid"
      }
    }
    Remove-Item $pidFile.FullName -Force -ErrorAction SilentlyContinue
  }
}

foreach ($port in (@(9621, 9622) + (9701..9799))) {
  $lines = netstat -ano | Select-String -Pattern ":$port\s+"
  foreach ($line in $lines) {
    if ($line.Line -match 'LISTENING\s+(\d+)\s*$') {
      $listenPid = [int]$Matches[1]
      $p = Get-Process -Id $listenPid -ErrorAction SilentlyContinue
      if ($p -and ($p.Path -like 'D:\LightRAG\*')) {
        Stop-Process -Id $listenPid -Force
        Write-Host "Stopped listener on $port PID $listenPid"
      }
    }
  }
}
