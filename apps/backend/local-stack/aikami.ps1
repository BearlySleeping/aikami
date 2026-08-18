# apps/backend/local-stack/aikami.ps1
#
# `aikami` — the control command for an installed Aikami Local Stack
# (C-418 Feature F). Shipped inside the release bundle; install.ps1 copies it
# (with aikami.cmd) next to the install dir and puts that dir on PATH, so an
# installed user types `aikami up` instead of remembering a compose incantation
# and a directory to cd into.
#
#   aikami up | down | restart | logs | status | doctor | wizard | client |
#          update | env | dir | version | help
#
# Everything is a thin, transparent wrapper: each command prints the docker
# compose invocation it runs, so nothing here is a black box, and dropping to
# raw `docker compose` in `aikami dir` always works.

param(
  [Parameter(Position = 0)] [string] $Command = 'help',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)] [string[]] $Rest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ValueFromRemainingArguments binds $null (not an empty array) when nothing
# follows the command, and `@('ps') + $null` would splat an empty argument into
# docker compose. Normalise once.
if (-not $Rest) { $Rest = @() }

function Write-Head([string] $Message) { Write-Host "[aikami] $Message" -ForegroundColor Blue }
function Write-Info([string] $Message) { Write-Host "         $Message" -ForegroundColor Gray }
function Write-Ok([string]   $Message) { Write-Host "  ok     $Message" -ForegroundColor Green }
function Write-Bad([string]  $Message) { Write-Host "  FAIL   $Message" -ForegroundColor Red }
function Write-Meh([string]  $Message) { Write-Host "  --     $Message" -ForegroundColor Yellow }

# ── Where the stack lives ─────────────────────────────────────────────────
# This script runs from two places: inside the project dir (as shipped in the
# bundle) and from the install root (the copy install.ps1 puts on PATH), where
# the project dir is `current`.
function Resolve-ProjectDir {
  $here = $PSScriptRoot
  if (-not $here) { $here = (Get-Location).Path }
  foreach ($candidate in @($here, (Join-Path $here 'current'))) {
    if (Test-Path -LiteralPath (Join-Path $candidate 'compose.yaml')) { return $candidate }
  }
  throw "cannot find compose.yaml near $here - reinstall with: powershell -c `"irm https://aikami.sh/install.ps1 | iex`""
}

$script:ProjectDir = Resolve-ProjectDir

# Windows PowerShell turns a native command's stderr into error records as soon
# as the stream is redirected, and $ErrorActionPreference = 'Stop' then aborts
# the script. `docker info` against a stopped engine writes to stderr — which is
# exactly what `aikami doctor` exists to report — so probes relax the preference.
function Invoke-Quiet([scriptblock] $Block) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Block } finally { $ErrorActionPreference = $previous }
}

# Server version string when the engine answers, otherwise $null.
function Get-DockerServerVersion {
  try {
    $output = Invoke-Quiet { & docker info --format '{{.ServerVersion}}' 2>&1 }
    if ($LASTEXITCODE -ne 0 -or -not $output) { return $null }
    return ([string](@($output)[-1])).Trim()
  } catch { return $null }
}

function Invoke-Compose([string[]] $ComposeArgs) {
  Write-Info "docker compose $($ComposeArgs -join ' ')"
  Push-Location $script:ProjectDir
  # Out-Host: this function returns the exit code, so compose's own output has
  # to leave through the host rather than the pipeline or it would be captured
  # into that value instead of being shown.
  try { & docker compose @ComposeArgs | Out-Host } finally { Pop-Location }
  return $LASTEXITCODE
}

function Get-EnvValue([string] $Name, [string] $Default) {
  $envPath = Join-Path $script:ProjectDir '.env'
  if (Test-Path -LiteralPath $envPath) {
    foreach ($line in (Get-Content -LiteralPath $envPath)) {
      if ($line -match "^\s*$Name\s*=\s*(.+?)\s*$") { return $Matches[1] }
    }
  }
  return $Default
}

# ── Health probing ────────────────────────────────────────────────────────
function Test-Endpoint([string] $Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Show-Doctor {
  Write-Head 'diagnosing the local stack'
  Write-Info "project dir: $($script:ProjectDir)"

  # Docker
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Bad 'docker is not on PATH - install Docker Desktop: winget install --exact --id Docker.DockerDesktop'
    return 1
  }
  $serverVersion = Get-DockerServerVersion
  if (-not $serverVersion) {
    Write-Bad 'the Docker engine is not responding - start Docker Desktop and retry'
    return 1
  }
  Write-Ok "docker engine $serverVersion"

  # .env / topology
  $envPath = Join-Path $script:ProjectDir '.env'
  if (Test-Path -LiteralPath $envPath) {
    Write-Ok ".env present ($(Get-EnvValue 'COMPOSE_PROFILES' '?') on $(Get-EnvValue 'COMPOSE_FILE' 'compose.yaml'))"
  } else {
    Write-Bad ".env missing - run: aikami wizard"
  }
  Push-Location $script:ProjectDir
  try { Invoke-Quiet { & docker compose config --quiet 2>&1 | Out-Null } } finally { Pop-Location }
  if ($LASTEXITCODE -eq 0) { Write-Ok 'compose topology renders' } else { Write-Bad 'docker compose config failed - see: aikami dir' }

  # GPU passthrough (the single most common Windows surprise)
  $backend = Get-EnvValue 'COMPOSE_FILE' 'compose.yaml'
  if ($backend -like '*cuda*') {
    $dockerInfo = Invoke-Quiet { & docker info 2>&1 | Out-String }
    if ($dockerInfo -match 'nvidia') {
      Write-Ok 'docker reports an nvidia runtime (CUDA backend can reach the GPU)'
    } else {
      Write-Meh 'CUDA backend selected but docker does not report an nvidia runtime - update your NVIDIA driver and Docker Desktop, or re-run: aikami wizard'
    }
  }

  # Running services
  Write-Info ''
  Write-Info 'services:'
  Invoke-Compose @('ps') | Out-Null
  Push-Location $script:ProjectDir
  try { $running = @(Invoke-Quiet { & docker compose ps -q 2>&1 } | Where-Object { $_ }) } finally { Pop-Location }
  $stackIsUp = ($running.Count -gt 0)

  # Host-side endpoint probes: the ports are published to 127.0.0.1, so this
  # is exactly what the desktop app sees.
  Write-Info ''
  Write-Info 'endpoints (as the app sees them):'
  $profiles = Get-EnvValue 'COMPOSE_PROFILES' 'text,image,voice'
  $checks = @(
    @{ Profile = 'text';   Name = 'text  '; Url = "http://localhost:$(Get-EnvValue 'TEXT_PORT'  '11434')/health" },
    @{ Profile = 'image';  Name = 'image '; Url = "http://localhost:$(Get-EnvValue 'IMAGE_PORT' '8188')/" },
    @{ Profile = 'voice';  Name = 'voice '; Url = "http://localhost:$(Get-EnvValue 'TTS_PORT'   '8089')/health" },
    @{ Profile = 'stt';    Name = 'stt   '; Url = "http://localhost:$(Get-EnvValue 'STT_PORT'   '8087')/health" },
    @{ Profile = 'client'; Name = 'client'; Url = "http://localhost:$(Get-EnvValue 'CLIENT_PORT' '5274')/" }
  )
  foreach ($check in $checks) {
    if (($profiles -split ',') -notcontains $check.Profile) { continue }
    if (Test-Endpoint $check.Url) {
      Write-Ok "$($check.Name) $($check.Url)"
    } elseif ($stackIsUp) {
      Write-Bad "$($check.Name) $($check.Url) - not answering (first run downloads models; try: aikami logs)"
    } else {
      # A wall of red right after install would be misleading — nothing is
      # supposed to answer before `aikami up`.
      Write-Meh "$($check.Name) $($check.Url) - stack is not running (aikami up)"
    }
  }
  return 0
}

# ── Desktop client ────────────────────────────────────────────────────────
# Set-StrictMode makes a missing property a terminating error, so every read of
# the release manifest (a document this code does not control) goes through
# these two.
function Get-ManifestProperty($Object, [string] $Name) {
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if (-not $property) { return $null }
  return $property.Value
}

function Get-ManifestUrl($Manifest, [string] $Key) {
  $platforms = Get-ManifestProperty -Object $Manifest -Name 'platforms'
  $entry = Get-ManifestProperty -Object $platforms -Name $Key
  return (Get-ManifestProperty -Object $entry -Name 'url')
}

function Find-ClientExe {
  foreach ($candidate in @(
      (Join-Path $env:LOCALAPPDATA 'Aikami\Aikami.exe'),
      (Join-Path $env:ProgramFiles 'Aikami\Aikami.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'Aikami\Aikami.exe'))) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

function Invoke-Client([bool] $ForceReinstall) {
  $exe = Find-ClientExe
  if ($exe -and -not $ForceReinstall) {
    Write-Head "launching $exe"
    Start-Process -FilePath $exe | Out-Null
    return 0
  }
  # Not installed (or `aikami client --reinstall`): pull the newest desktop
  # build straight from the GitHub release manifest the in-app updater uses.
  $manifestUrl = [Environment]::GetEnvironmentVariable('AIKAMI_CLIENT_MANIFEST_URL')
  if (-not $manifestUrl) { $manifestUrl = 'https://github.com/BearlySleeping/aikami/releases/latest/download/latest.json' }
  Write-Head 'fetching the latest desktop release'
  try {
    $manifest = Invoke-RestMethod -Uri $manifestUrl -Headers @{ 'User-Agent' = 'aikami-cli' } -UseBasicParsing
  } catch {
    Write-Bad "could not read $manifestUrl - download the app from https://github.com/BearlySleeping/aikami/releases/latest"
    return 1
  }
  # Set-StrictMode turns a missing property into a terminating error, so the
  # manifest is read defensively — a release without a Windows entry is a
  # "skip this", not a crash.
  $url = Get-ManifestUrl -Manifest $manifest -Key 'windows-x86_64'
  if (-not $url) {
    Write-Bad 'the latest desktop release has no Windows build'
    return 1
  }
  Write-Info "version $(Get-ManifestProperty -Object $manifest -Name 'version')  ->  $url"
  $setup = Join-Path $env:TEMP "aikami-setup-$(Get-ManifestProperty -Object $manifest -Name 'version').exe"
  Invoke-WebRequest -Uri $url -OutFile $setup -UseBasicParsing -Headers @{ 'User-Agent' = 'aikami-cli' }
  $proc = Start-Process -FilePath $setup -Wait -PassThru
  Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
  if ($proc.ExitCode -ne 0) {
    Write-Bad "the desktop installer exited with code $($proc.ExitCode)"
    return $proc.ExitCode
  }
  $exe = Find-ClientExe
  if ($exe) {
    Write-Ok "installed $exe"
    Start-Process -FilePath $exe | Out-Null
  } else {
    Write-Info 'installed - launch "Aikami" from the Start menu.'
  }
  return 0
}

function Show-Help {
  Write-Host ''
  Write-Host 'aikami - control the local Aikami AI stack' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '  aikami up            ' -NoNewline -ForegroundColor Cyan; Write-Host 'start the stack (docker compose up -d)'
  Write-Host '  aikami down          ' -NoNewline -ForegroundColor Cyan; Write-Host 'stop the stack (models are kept)'
  Write-Host '  aikami restart       ' -NoNewline -ForegroundColor Cyan; Write-Host 'restart every service'
  Write-Host '  aikami status        ' -NoNewline -ForegroundColor Cyan; Write-Host 'per-service state and health'
  Write-Host '  aikami logs [svc]    ' -NoNewline -ForegroundColor Cyan; Write-Host 'follow logs (first run = model download)'
  Write-Host '  aikami doctor        ' -NoNewline -ForegroundColor Cyan; Write-Host 'diagnose docker, topology, GPU, endpoints'
  Write-Host '  aikami wizard        ' -NoNewline -ForegroundColor Cyan; Write-Host 're-run hardware detection and rewrite .env'
  Write-Host '  aikami client        ' -NoNewline -ForegroundColor Cyan; Write-Host 'launch the desktop app (installs it if absent)'
  Write-Host '  aikami update        ' -NoNewline -ForegroundColor Cyan; Write-Host 'reinstall the newest stack release (.env kept)'
  Write-Host '  aikami env           ' -NoNewline -ForegroundColor Cyan; Write-Host 'open .env in your editor'
  Write-Host '  aikami dir           ' -NoNewline -ForegroundColor Cyan; Write-Host 'print the project dir (for raw docker compose)'
  Write-Host '  aikami version       ' -NoNewline -ForegroundColor Cyan; Write-Host 'installed stack version'
  Write-Host ''
  Write-Host "  project dir: $($script:ProjectDir)" -ForegroundColor Gray
  Write-Host ''
}

# ── Dispatch ──────────────────────────────────────────────────────────────
$code = 0
switch ($Command.ToLower()) {
  'up'      { $code = Invoke-Compose (@('up', '-d') + $Rest) }
  'down'    { $code = Invoke-Compose (@('down') + $Rest) }
  'restart' { $code = Invoke-Compose (@('restart') + $Rest) }
  'status'  { $code = Invoke-Compose (@('ps') + $Rest) }
  'ps'      { $code = Invoke-Compose (@('ps') + $Rest) }
  'logs'    { $code = Invoke-Compose (@('logs', '-f', '--tail', '100') + $Rest) }
  'doctor'  { $code = Show-Doctor }
  'client'  { $code = Invoke-Client ($Rest -contains '--reinstall') }
  'wizard'  {
    $wizard = Join-Path $script:ProjectDir 'bin\stack-init.exe'
    if (-not (Test-Path -LiteralPath $wizard)) { Write-Bad "wizard binary missing ($wizard)"; $code = 1 }
    else { & $wizard @(@('--env-path', (Join-Path $script:ProjectDir '.env')) + $Rest); $code = $LASTEXITCODE }
  }
  'update'  {
    Write-Head 'reinstalling the newest local-stack release (.env is preserved)'
    $installer = Join-Path $script:ProjectDir 'install.ps1'
    if (Test-Path -LiteralPath $installer) { & $installer @Rest }
    else { & ([scriptblock]::Create((Invoke-WebRequest -Uri 'https://aikami.sh/install.ps1' -UseBasicParsing).Content)) }
    $code = $LASTEXITCODE
  }
  'env'     {
    $envPath = Join-Path $script:ProjectDir '.env'
    if (-not (Test-Path -LiteralPath $envPath)) { Write-Bad ".env missing - run: aikami wizard"; $code = 1 }
    else { Write-Info $envPath; Start-Process -FilePath $envPath }
  }
  'dir'     { Write-Host $script:ProjectDir }
  'version' {
    $versionFile = Join-Path $script:ProjectDir 'VERSION'
    if (Test-Path -LiteralPath $versionFile) { Write-Host (Get-Content -LiteralPath $versionFile -Raw).Trim() }
    else { Write-Host 'unknown (installed from a repo checkout?)' }
  }
  'help'    { Show-Help }
  default   { Write-Bad "unknown command '$Command'"; Show-Help; $code = 1 }
}
exit $code
