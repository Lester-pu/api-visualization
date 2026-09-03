$ErrorActionPreference = 'Stop'

$rootDir = $PSScriptRoot
$runtimeDir = Join-Path $rootDir '.runtime'
$backendDir = Join-Path $rootDir 'backend'
$frontendDir = Join-Path $rootDir 'frontend'
$backendHealthUrl = 'http://127.0.0.1:8000/api/health'
$frontendUrl = 'http://127.0.0.1:3000'
$backendPidFile = Join-Path $runtimeDir 'backend.pid'
$frontendPidFile = Join-Path $runtimeDir 'frontend.pid'
$backendOutLogFile = Join-Path $runtimeDir 'backend.out.log'
$backendErrLogFile = Join-Path $runtimeDir 'backend.err.log'
$frontendOutLogFile = Join-Path $runtimeDir 'frontend.out.log'
$frontendErrLogFile = Join-Path $runtimeDir 'frontend.err.log'

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Show-LauncherMessage {
  param(
    [string]$Message,
    [string]$Title = 'API Visualization Launcher'
  )

  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($Message, $Title, 'OK', 'Error') | Out-Null
}

function Test-HttpReady {
  param([string]$Url)

  try {
    Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Wait-ForHttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 25
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpReady -Url $Url) {
      return $true
    }
    Start-Sleep -Milliseconds 750
  }

  return $false
}

function Remove-PidFile {
  param([string]$PidFile)

  if (Test-Path -LiteralPath $PidFile) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  }
}

function Stop-ManagedProcess {
  param(
    [string]$PidFile,
    [int]$Port
  )

  if (Test-Path -LiteralPath $PidFile) {
    $pidValue = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pidValue -match '^\d+$') {
      Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
    }
    Remove-PidFile -PidFile $PidFile
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

function Get-NodeExecutable {
  $candidate = 'C:\Users\pule\tools\node-v24.15.0-win-x64\node.exe'
  if (-not (Test-Path -LiteralPath $candidate)) {
    throw 'Required Node runtime not found: C:\Users\pule\tools\node-v24.15.0-win-x64\node.exe'
  }

  $version = & $candidate -e "process.stdout.write(process.versions.node)"
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to execute the pinned Node 24 runtime.'
  }

  $major = [int]($version.Split('.')[0])
  if ($major -lt 20) {
    throw "Pinned Node runtime is too old: $version"
  }

  return $candidate
}

try {
  $pythonExe = Join-Path $backendDir '.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "Backend virtual environment not found: $pythonExe"
  }

  $viteCli = Join-Path $frontendDir 'node_modules\vite\bin\vite.js'
  if (-not (Test-Path -LiteralPath $viteCli)) {
    throw "Frontend Vite CLI not found: $viteCli`nPlease run npm install in the frontend folder first."
  }

  $nodeExe = Get-NodeExecutable

  Stop-ManagedProcess -PidFile $backendPidFile -Port 8000
  Stop-ManagedProcess -PidFile $frontendPidFile -Port 3000

  Remove-Item -LiteralPath $backendOutLogFile,$backendErrLogFile,$frontendOutLogFile,$frontendErrLogFile -Force -ErrorAction SilentlyContinue

  $backendProcess = Start-Process -FilePath $pythonExe -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $backendDir -WindowStyle Hidden -RedirectStandardOutput $backendOutLogFile -RedirectStandardError $backendErrLogFile -PassThru
  Set-Content -LiteralPath $backendPidFile -Value $backendProcess.Id

  $frontendProcess = Start-Process -FilePath $nodeExe -ArgumentList @($viteCli, '--host', '127.0.0.1', '--port', '3000', '--strictPort') -WorkingDirectory $frontendDir -WindowStyle Hidden -RedirectStandardOutput $frontendOutLogFile -RedirectStandardError $frontendErrLogFile -PassThru
  Set-Content -LiteralPath $frontendPidFile -Value $frontendProcess.Id

  if (-not (Wait-ForHttpReady -Url $backendHealthUrl -TimeoutSeconds 25)) {
    throw "Backend failed to start.`nLogs:`n$backendOutLogFile`n$backendErrLogFile"
  }

  if (-not (Wait-ForHttpReady -Url $frontendUrl -TimeoutSeconds 25)) {
    throw "Frontend failed to start.`nLogs:`n$frontendOutLogFile`n$frontendErrLogFile`nNode: $nodeExe"
  }

  Start-Process $frontendUrl | Out-Null
} catch {
  Stop-ManagedProcess -PidFile $backendPidFile -Port 8000
  Stop-ManagedProcess -PidFile $frontendPidFile -Port 3000
  $details = @(
    $_.Exception.Message,
    "",
    "Backend logs: $backendOutLogFile , $backendErrLogFile",
    "Frontend logs: $frontendOutLogFile , $frontendErrLogFile"
  ) -join [Environment]::NewLine
  Show-LauncherMessage -Message $details
  exit 1
}
