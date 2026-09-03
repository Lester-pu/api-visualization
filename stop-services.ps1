$ErrorActionPreference = 'SilentlyContinue'

$rootDir = $PSScriptRoot
$runtimeDir = Join-Path $rootDir '.runtime'
$backendPidFile = Join-Path $runtimeDir 'backend.pid'
$frontendPidFile = Join-Path $runtimeDir 'frontend.pid'

function Stop-ManagedProcess {
  param(
    [string]$PidFile,
    [int]$Port
  )

  if (Test-Path -LiteralPath $PidFile) {
    $pidValue = Get-Content -LiteralPath $PidFile | Select-Object -First 1
    if ($pidValue -match '^\d+$') {
      Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  }

  $netstatLines = netstat -ano | Select-String -Pattern ":$Port\s+.*LISTENING"
  foreach ($line in $netstatLines) {
    $parts = ($line -split '\s+') | Where-Object { $_ }
    $owningPid = $parts[-1]
    if ($owningPid -match '^\d+$') {
      Stop-Process -Id ([int]$owningPid) -Force -ErrorAction SilentlyContinue
    }
  }
}

Stop-ManagedProcess -PidFile $backendPidFile -Port 8000
Stop-ManagedProcess -PidFile $frontendPidFile -Port 3000
