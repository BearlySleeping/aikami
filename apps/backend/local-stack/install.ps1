# apps/backend/local-stack/install.ps1
#
# Aikami Local Stack — one-command installer for Windows (C-418 Feature F).
#
# Usage (recommended):
#   powershell -c "irm https://aikami.sh/install.ps1 | iex"
#
# With options (the pipe form cannot take parameters — use env vars, or
# download the file and run it):
#   $env:AIKAMI_START=1; irm https://aikami.sh/install.ps1 | iex
#   irm https://aikami.sh/install.ps1 -OutFile install.ps1; ./install.ps1 -Start -Client
#
# What it does, step by step (each step is logged so a failure is
# diagnosable from output alone):
#   1. Checks the platform (Windows x64) and PowerShell version.
#   2. Checks Docker: installed, engine reachable. Offers to install Docker
#      Desktop via winget, or to start it when it is installed but stopped.
#   3. Resolves the release version (default: newest `local-stack-*` release)
#      and downloads the per-platform bundle + SHA256SUMS.
#   4. Verifies the archive's SHA-256 against SHA256SUMS BEFORE extraction —
#      nothing is ever executed from an unverified download.
#   5. Extracts into <InstallDir>\current and runs the hardware wizard on the
#      HOST (never inside a container — GPU detection without the host driver
#      is unreliable).
#   6. Installs the `aikami` control command and (optionally) starts the
#      stack and the desktop client.
#
# Guarantees (identical to install.sh):
#   - An existing `.env` is NEVER overwritten (no silent clobber).
#   - The download is checksum-verified before extraction.
#   - No `git clone` is required — this is the primary path.
#   - Windows PowerShell 5.1 compatible (no PowerShell 7-only syntax).
#
# Overrides (env vars, so they work through `irm | iex`):
#   AIKAMI_STACK_DIR        install directory (default: %LOCALAPPDATA%\Aikami\stack)
#   AIKAMI_STACK_VERSION    release version, e.g. 0.1.0 (default: latest)
#   AIKAMI_INSTALL_BASE_URL bundle base URL (default: GitHub releases)
#   AIKAMI_SKIP_WIZARD      1 = skip the hardware wizard (fetch only)
#   AIKAMI_START            1 = start the stack when the install finishes
#   AIKAMI_CLIENT           1 = install + launch the desktop client
#   AIKAMI_NO_PATH          1 = do not add the install dir to the user PATH
#   AIKAMI_YES              1 = never prompt (assume the default answer)
#
# Release naming (single source of truth — see publish-local-stack.yml):
#   GitHub release tag:  local-stack-<version>
#   asset (Windows):     local-stack-<version>-windows-x64.zip
#   checksums:           SHA256SUMS

param(
  [string] $Version,
  [string] $Dir,
  [switch] $SkipWizard,
  [switch] $Start,
  [switch] $Client,
  [switch] $NoPath,
  [switch] $Yes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Invoke-WebRequest's progress bar costs more time than the download itself
# on Windows PowerShell 5.1 for multi-MB files.
$ProgressPreference = 'SilentlyContinue'

# ── Output helpers ────────────────────────────────────────────────────────
function Write-Step([string] $Message) { Write-Host "[aikami] $Message" -ForegroundColor Blue }
function Write-Info([string] $Message) { Write-Host "         $Message" -ForegroundColor Gray }
function Write-Ok([string]   $Message) { Write-Host "[aikami] $Message" -ForegroundColor Green }
function Write-Warn([string] $Message) { Write-Host "[aikami] warning: $Message" -ForegroundColor Yellow }
function Write-Err([string]  $Message) { Write-Host "[aikami] error: $Message" -ForegroundColor Red }

# ── Configuration (parameters win; env vars are the `irm | iex` path) ─────
function Get-Setting([string] $Value, [string] $EnvName, [string] $Default) {
  if ($Value) { return $Value }
  $fromEnv = [Environment]::GetEnvironmentVariable($EnvName)
  if ($fromEnv) { return $fromEnv }
  return $Default
}
function Get-Flag([bool] $Value, [string] $EnvName) {
  if ($Value) { return $true }
  $fromEnv = [Environment]::GetEnvironmentVariable($EnvName)
  return ($fromEnv -eq '1' -or $fromEnv -eq 'true')
}

function Install-AikamiStack {
  $stackVersion = Get-Setting $Version 'AIKAMI_STACK_VERSION' 'latest'
  $installDir   = Get-Setting $Dir     'AIKAMI_STACK_DIR'     (Join-Path $env:LOCALAPPDATA 'Aikami\stack')
  $baseUrl      = Get-Setting ''       'AIKAMI_INSTALL_BASE_URL' 'https://github.com/BearlySleeping/aikami/releases/download'
  $apiBaseUrl   = Get-Setting ''       'AIKAMI_INSTALL_API_URL'  'https://api.github.com/repos/BearlySleeping/aikami'
  $skipWizard   = Get-Flag $SkipWizard.IsPresent 'AIKAMI_SKIP_WIZARD'
  $wantStart    = Get-Flag $Start.IsPresent      'AIKAMI_START'
  $wantClient   = Get-Flag $Client.IsPresent     'AIKAMI_CLIENT'
  $noPath       = Get-Flag $NoPath.IsPresent     'AIKAMI_NO_PATH'
  $assumeYes    = Get-Flag $Yes.IsPresent        'AIKAMI_YES'
  $script:Interactive = ([Environment]::UserInteractive -and -not $assumeYes)

  # ── Step 1/6: platform ──────────────────────────────────────────────────
  Write-Step 'step 1/6 - checking the platform'
  if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Err "PowerShell 5.1 or newer is required (found $($PSVersionTable.PSVersion)). Windows 10 and 11 ship 5.1."
    return 1
  }
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
  switch ($arch) {
    'AMD64' { $platform = 'windows-x64' }
    'ARM64' {
      # Bun has no windows-arm64 compile target yet, so no stack-init binary
      # is published for it. Windows on ARM runs x64 binaries under emulation,
      # which is fine for a one-shot wizard.
      $platform = 'windows-x64'
      Write-Warn 'Windows on ARM detected - using the x64 wizard binary under emulation.'
    }
    default {
      Write-Err "unsupported architecture '$arch' - the one-command installer supports Windows x64. Run 'bun run stack init' from a repo clone instead."
      return 1
    }
  }
  Write-Info "platform: Windows/$arch ($platform)"
  # TLS 1.2 is not enabled by default in every Windows PowerShell 5.1 config;
  # api.github.com refuses anything older.
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch { }

  # ── Step 2/6: Docker ────────────────────────────────────────────────────
  # A missing Docker is NOT fatal: the bundle, the wizard, and the `aikami`
  # command are all still worth installing (people do provision a machine
  # before installing Docker). It only means we never offer to start the
  # stack, and `aikami doctor` repeats the diagnosis later.
  Write-Step 'step 2/6 - checking Docker'
  $dockerReady = $true
  if (Get-Flag $false 'AIKAMI_SKIP_DOCKER_CHECK') {
    Write-Info 'skipped (AIKAMI_SKIP_DOCKER_CHECK=1)'
    $dockerReady = $false
  } else {
    $dockerReady = Test-DockerReady -Interactive $script:Interactive
  }

  # ── Step 3/6: resolve + download ────────────────────────────────────────
  Write-Step 'step 3/6 - resolving the release'
  if ($stackVersion -eq 'latest') {
    $stackVersion = Resolve-LatestVersion -ApiBaseUrl $apiBaseUrl
    if (-not $stackVersion) { return 1 }
    Write-Info "resolved version $stackVersion"
  }
  if ($stackVersion.StartsWith('local-stack-')) {
    $stackVersion = $stackVersion.Substring('local-stack-'.Length)   # tolerate full-tag form
  }
  $releaseTag  = "local-stack-$stackVersion"
  $bundleFile  = "local-stack-$stackVersion-$platform.zip"
  $bundleUrl   = "$baseUrl/$releaseTag/$bundleFile"
  $sumsUrl     = "$baseUrl/$releaseTag/SHA256SUMS"

  Write-Info "version: $stackVersion (tag $releaseTag)"
  Write-Info "source:  $bundleUrl"
  Write-Info "target:  $installDir"
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  # Keep the .zip suffix on the partial download: Expand-Archive refuses any
  # other extension, so a `.part` name fails at step 5 even after the checksum
  # passes. The leading dot marks it as in-progress instead.
  $tmpBundle = Join-Path $installDir ".download-$bundleFile"
  $tmpSums   = Join-Path $installDir '.SHA256SUMS.part'
  if (-not (Get-RemoteFile -Url $bundleUrl -Destination $tmpBundle)) {
    Write-Err "download failed ($bundleUrl). Check AIKAMI_STACK_VERSION / network."
    return 1
  }
  if (-not (Get-RemoteFile -Url $sumsUrl -Destination $tmpSums)) {
    Write-Err "checksums download failed ($sumsUrl). Refusing to install an unverified bundle."
    return 1
  }
  Write-Info "downloaded $bundleFile"

  # ── Step 4/6: verify BEFORE extraction ──────────────────────────────────
  Write-Step 'step 4/6 - verifying SHA-256 checksum'
  $expected = $null
  foreach ($line in (Get-Content -LiteralPath $tmpSums)) {
    $parts = $line -split '\s+' | Where-Object { $_ }
    if ($parts.Count -ge 2 -and ($parts[1].TrimStart('*')) -eq $bundleFile) { $expected = $parts[0].ToLower(); break }
  }
  if (-not $expected) {
    Remove-Item -LiteralPath $tmpBundle, $tmpSums -Force -ErrorAction SilentlyContinue
    Write-Err "SHA256SUMS has no entry for $bundleFile - refusing to install."
    return 1
  }
  $actual = (Get-FileHash -LiteralPath $tmpBundle -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) {
    Remove-Item -LiteralPath $tmpBundle, $tmpSums -Force -ErrorAction SilentlyContinue
    Write-Err "checksum mismatch for $bundleFile (expected $expected, got $actual). The download is corrupt or tampered with - re-run to retry."
    return 1
  }
  Write-Info "checksum OK ($expected)"

  # ── Step 5/6: extract into a STABLE path ────────────────────────────────
  # <InstallDir>\current always holds the installed stack, so the handoff is
  # `cd <dir>\current` and never a version glob. An existing .env is carried
  # across the replacement.
  Write-Step 'step 5/6 - extracting the bundle'
  $projectDir = Join-Path $installDir 'current'
  $envFile    = Join-Path $projectDir '.env'
  $preserved  = $null
  if (Test-Path -LiteralPath $envFile) {
    $preserved = Join-Path $installDir '.env.preserved'
    Copy-Item -LiteralPath $envFile -Destination $preserved -Force
  }
  $staging = Join-Path $installDir '.staging'
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  try {
    Expand-Archive -LiteralPath $tmpBundle -DestinationPath $staging -Force
  } catch {
    Write-Err "bundle extraction failed - the archive may be corrupt. ($($_.Exception.Message))"
    return 1
  }
  # The archive carries one versioned top-level directory.
  $extracted = Get-ChildItem -LiteralPath $staging -Directory | Select-Object -First 1
  if (-not $extracted) {
    Write-Err 'bundle archive is empty or malformed.'
    return 1
  }
  if (Test-Path -LiteralPath $projectDir) { Remove-Item -LiteralPath $projectDir -Recurse -Force }
  Move-Item -LiteralPath $extracted.FullName -Destination $projectDir
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tmpBundle, $tmpSums -Force -ErrorAction SilentlyContinue
  Set-Content -LiteralPath (Join-Path $projectDir 'VERSION') -Value $stackVersion -NoNewline
  if ($preserved) {
    Copy-Item -LiteralPath $preserved -Destination $envFile -Force
    Remove-Item -LiteralPath $preserved -Force
    Write-Info 'preserved existing .env from the previous install'
  }

  # `aikami` control command: lives in the install dir (not the replaceable
  # project dir) so upgrades keep the same command on PATH.
  foreach ($name in @('aikami.ps1', 'aikami.cmd')) {
    $shipped = Join-Path $projectDir $name
    if (Test-Path -LiteralPath $shipped) { Copy-Item -LiteralPath $shipped -Destination (Join-Path $installDir $name) -Force }
  }
  if (-not $noPath) { Add-UserPath -Directory $installDir }

  $stackInit = Join-Path $projectDir 'bin\stack-init.exe'
  if (-not $skipWizard -and -not (Test-Path -LiteralPath $stackInit)) {
    Write-Err "compiled stack-init binary missing in the bundle ($stackInit)."
    return 1
  }

  # ── Step 6/6: hardware wizard ───────────────────────────────────────────
  Write-Step 'step 6/6 - running the hardware wizard'
  if ($skipWizard) {
    Write-Info 'skipped (AIKAMI_SKIP_WIZARD=1)'
  } elseif (Test-Path -LiteralPath $envFile) {
    Write-Info ".env already exists at $envFile - leaving it untouched."
    Write-Info 'Re-run the wizard to change hardware:  aikami wizard'
  } else {
    $wizardArgs = @('--env-path', $envFile)
    if (-not $script:Interactive) {
      Write-Info 'non-interactive install - auto-detecting hardware (--yes)'
      $wizardArgs = @('--yes') + $wizardArgs
    }
    # Out-Host, not bare invocation: this whole installer runs inside a
    # function whose return value is the exit code, so anything a native
    # command writes to stdout would be captured into that value instead of
    # reaching the user — and the wizard's download plan is the one thing they
    # must actually read before it writes .env.
    & $stackInit @wizardArgs | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Err "the hardware wizard exited with code $LASTEXITCODE - nothing was started."
      return $LASTEXITCODE
    }
    Write-Info ".env written to $envFile"
  }

  # ── Optional: start the stack ───────────────────────────────────────────
  # Only ever offered interactively, and only with a working engine: a scripted
  # install must not start pulling multi-GB images and model weights that
  # nobody asked for. Scripts opt in with AIKAMI_START=1 / AIKAMI_CLIENT=1.
  if (-not $wantStart -and $script:Interactive -and $dockerReady) {
    $wantStart = Confirm-Prompt -Question 'Start the stack now? (pulls images and downloads models)' -Default $true
  }
  if ($wantStart -and -not $dockerReady) {
    Write-Warn 'skipping start - the Docker engine is not available. Run `aikami up` once Docker is running.'
    $wantStart = $false
  }
  if ($wantStart) {
    Write-Step 'starting the stack (docker compose up -d)'
    Push-Location $projectDir
    try { & docker compose up -d | Out-Host } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "docker compose exited with code $LASTEXITCODE - check the output above, then retry with 'aikami up'."
    } else {
      Write-Ok 'stack started. Follow the first-run model download with:  aikami logs'
    }
  }

  # ── Optional: desktop client ────────────────────────────────────────────
  if (-not $wantClient -and $script:Interactive) {
    $wantClient = Confirm-Prompt -Question 'Install the Aikami desktop app (latest GitHub release)?' -Default $true
  }
  if ($wantClient) {
    Install-AikamiClient -ProjectDir $projectDir -Launch $true | Out-Null
  }

  # ── Handoff ─────────────────────────────────────────────────────────────
  Write-Host ''
  Write-Ok 'done'
  Write-Host ''
  Write-Host '  aikami up        ' -NoNewline -ForegroundColor Cyan; Write-Host 'start the stack'
  Write-Host '  aikami status    ' -NoNewline -ForegroundColor Cyan; Write-Host 'per-service health'
  Write-Host '  aikami logs      ' -NoNewline -ForegroundColor Cyan; Write-Host 'follow the logs (first run downloads models)'
  Write-Host '  aikami client    ' -NoNewline -ForegroundColor Cyan; Write-Host 'install / launch the desktop app'
  Write-Host '  aikami doctor    ' -NoNewline -ForegroundColor Cyan; Write-Host 'diagnose Docker, ports, and engine health'
  Write-Host '  aikami down      ' -NoNewline -ForegroundColor Cyan; Write-Host 'stop the stack'
  Write-Host ''
  Write-Info "installed at $projectDir"
  if (-not $noPath) { Write-Info 'Open a NEW terminal for the `aikami` command to be on PATH.' }
  Write-Info "Change modalities or hardware by editing $envFile (or: aikami wizard)."
  return 0
}

# ── Docker ─────────────────────────────────────────────────────────────────
# Windows PowerShell turns a native command's stderr into error records as soon
# as the stream is redirected, and $ErrorActionPreference = 'Stop' then aborts
# the script. `docker info` against a stopped engine writes to stderr — which
# is precisely the case this installer exists to diagnose — so probes run with
# the preference relaxed.
function Invoke-Quiet([scriptblock] $Block) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Block } finally { $ErrorActionPreference = $previous }
}

# Returns $true when the engine answered `docker info`.
function Test-DockerEngine {
  try {
    Invoke-Quiet { & docker info --format '{{.ServerVersion}}' 2>&1 | Out-Null }
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

function Test-DockerReady([bool] $Interactive) {
  $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCmd) {
    Write-Warn 'Docker was not found on PATH.'
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget -and $Interactive -and (Confirm-Prompt -Question 'Install Docker Desktop now with winget?' -Default $true)) {
      Write-Info 'running: winget install --exact --id Docker.DockerDesktop'
      & winget install --exact --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
      Write-Host ''
      Write-Warn 'Docker Desktop was installed. Windows must finish setting up WSL2 before the engine runs.'
      Write-Info 'Sign out (or reboot), start Docker Desktop once, then run:  aikami up'
      return $false
    }
    Write-Host ''
    Write-Info 'Install Docker Desktop, then run `aikami up`:'
    Write-Info '  winget install --exact --id Docker.DockerDesktop'
    Write-Info '  (or download it from https://docs.docker.com/desktop/setup/install/windows-install/)'
    return $false
  }

  if (Test-DockerEngine) {
    Write-Info 'Docker engine is running'
    return $true
  }

  Write-Warn 'Docker is installed but the engine is not responding (Docker Desktop is probably not running).'
  $desktopExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path -LiteralPath $desktopExe) {
    if (-not $Interactive -or (Confirm-Prompt -Question 'Start Docker Desktop and wait for the engine?' -Default $true)) {
      Write-Info 'starting Docker Desktop...'
      Start-Process -FilePath $desktopExe | Out-Null
      # Cold start on Windows is genuinely slow (WSL2 VM boot).
      for ($i = 1; $i -le 90; $i++) {
        Start-Sleep -Seconds 2
        if (Test-DockerEngine) {
          Write-Info "Docker engine is running (after $($i * 2)s)"
          return $true
        }
        if ($i % 15 -eq 0) { Write-Info "still waiting for the Docker engine ($($i * 2)s)..." }
      }
      Write-Warn 'the Docker engine did not come up within 3 minutes. Start Docker Desktop manually, then run:  aikami up'
      return $false
    }
  }
  Write-Info 'Start Docker Desktop, then run:  aikami up'
  return $false
}

# ── GitHub release resolution ─────────────────────────────────────────────
# The repo publishes BOTH desktop-app releases (`v*`) and local-stack
# releases (`local-stack-*`), so /releases/latest is the wrong endpoint - it
# returns whichever release is newest overall. List releases and take the
# newest tag with the local-stack prefix.
function Resolve-LatestVersion([string] $ApiBaseUrl) {
  try {
    $releases = Invoke-RestMethod -Uri "$ApiBaseUrl/releases?per_page=100" -Headers @{ 'User-Agent' = 'aikami-installer' } -UseBasicParsing
  } catch {
    Write-Err "could not reach the GitHub API ($($_.Exception.Message)). Set AIKAMI_STACK_VERSION=<version> explicitly."
    return $null
  }
  foreach ($release in @($releases)) {
    $tag = Get-ManifestProperty -Object $release -Name 'tag_name'
    $draft = Get-ManifestProperty -Object $release -Name 'draft'
    if ($tag -like 'local-stack-*' -and -not $draft) {
      return $tag.Substring('local-stack-'.Length)
    }
  }
  Write-Err 'no `local-stack-*` release found. Set AIKAMI_STACK_VERSION=<version> explicitly.'
  return $null
}

function Get-RemoteFile([string] $Url, [string] $Destination) {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -Headers @{ 'User-Agent' = 'aikami-installer' }
      return $true
    } catch {
      if ($attempt -eq 3) {
        Write-Info "  $($_.Exception.Message)"
        return $false
      }
      Start-Sleep -Seconds ($attempt * 2)
    }
  }
  return $false
}

# ── Desktop client (Tauri, from the latest GitHub release) ────────────────
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

function Install-AikamiClient([string] $ProjectDir, [bool] $Launch) {
  Write-Step 'installing the Aikami desktop app'
  $manifestUrl = [Environment]::GetEnvironmentVariable('AIKAMI_CLIENT_MANIFEST_URL')
  if (-not $manifestUrl) { $manifestUrl = 'https://github.com/BearlySleeping/aikami/releases/latest/download/latest.json' }
  try {
    $manifest = Invoke-RestMethod -Uri $manifestUrl -Headers @{ 'User-Agent' = 'aikami-installer' } -UseBasicParsing
  } catch {
    Write-Warn "could not read the desktop release manifest ($manifestUrl). Skipping - download it manually from https://github.com/BearlySleeping/aikami/releases/latest"
    return $false
  }
  # Set-StrictMode turns a missing property into a terminating error, and this
  # manifest is a document we do not control — read it defensively so a release
  # without a Windows entry is a "skip this step", not a crashed install.
  $downloadUrl = Get-ManifestUrl -Manifest $manifest -Key 'windows-x86_64'
  if (-not $downloadUrl) {
    Write-Warn 'the latest desktop release has no Windows build. Skipping.'
    return $false
  }
  $clientVersion = Get-ManifestProperty -Object $manifest -Name 'version'
  Write-Info "version $clientVersion"

  # The engine URLs the app should talk to. The desktop app reads this file
  # (Tauri app-data dir) before falling back to ./config.json, so writing it
  # here is what points a fresh install at THIS machine's stack.
  Write-ClientConfig -ProjectDir $ProjectDir

  $setup = Join-Path $env:TEMP "aikami-setup-$clientVersion.exe"
  Write-Info "downloading $downloadUrl"
  if (-not (Get-RemoteFile -Url $downloadUrl -Destination $setup)) {
    Write-Warn 'desktop app download failed. Skipping.'
    return $false
  }
  Write-Info 'running the installer (accept the prompt if Windows asks)'
  $proc = Start-Process -FilePath $setup -Wait -PassThru
  Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
  if ($proc.ExitCode -ne 0) {
    Write-Warn "the desktop installer exited with code $($proc.ExitCode)."
    return $false
  }
  $exe = Find-AikamiClientExe
  if (-not $exe) {
    Write-Info 'installed - launch "Aikami" from the Start menu.'
    return $true
  }
  Write-Ok "desktop app installed: $exe"
  if ($Launch) { Start-Process -FilePath $exe | Out-Null }
  return $true
}

function Find-AikamiClientExe {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Aikami\Aikami.exe'),
    (Join-Path $env:ProgramFiles 'Aikami\Aikami.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Aikami\Aikami.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

# Writes the desktop app's runtime engine config
# (%APPDATA%\com.aikami.app\aikami-assets\config.json), matching the ports the
# stack actually publishes. Never overwrites a hand-edited file.
function Write-ClientConfig([string] $ProjectDir) {
  $configDir  = Join-Path $env:APPDATA 'com.aikami.app\aikami-assets'
  $configPath = Join-Path $configDir 'config.json'
  if (Test-Path -LiteralPath $configPath) {
    Write-Info "desktop config already exists at $configPath - leaving it untouched."
    return
  }
  $ports = @{ TEXT_PORT = '11434'; IMAGE_PORT = '8188'; TTS_PORT = '8089'; STT_PORT = '8087' }
  $envPath = Join-Path $ProjectDir '.env'
  if (Test-Path -LiteralPath $envPath) {
    foreach ($line in (Get-Content -LiteralPath $envPath)) {
      if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$' -and $ports.ContainsKey($Matches[1])) {
        $ports[$Matches[1]] = $Matches[2]
      }
    }
  }
  $config = [ordered]@{
    text   = [ordered]@{ url = "http://localhost:$($ports.TEXT_PORT)/v1" }
    image  = [ordered]@{ url = "http://localhost:$($ports.IMAGE_PORT)"; engine = 'auto' }
    voice  = [ordered]@{
      tts = [ordered]@{ mode = 'server'; url = "http://localhost:$($ports.TTS_PORT)" }
      stt = [ordered]@{ url = "http://localhost:$($ports.STT_PORT)" }
    }
    models = [ordered]@{ originUrl = 'https://huggingface.co' }
  }
  New-Item -ItemType Directory -Path $configDir -Force | Out-Null
  ($config | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $configPath -Encoding UTF8
  Write-Info "desktop config written to $configPath"
}

# ── PATH ───────────────────────────────────────────────────────────────────
function Add-UserPath([string] $Directory) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $current) { $current = '' }
  $entries = @($current -split ';' | Where-Object { $_ })
  if ($entries -contains $Directory) { return }
  [Environment]::SetEnvironmentVariable('Path', (($entries + $Directory) -join ';'), 'User')
  $env:Path = "$env:Path;$Directory"
  Write-Info "added $Directory to your user PATH"
}

# ── Prompt ─────────────────────────────────────────────────────────────────
function Confirm-Prompt([string] $Question, [bool] $Default) {
  if (-not $script:Interactive) { return $Default }
  $suffix = '[Y/n]'
  if (-not $Default) { $suffix = '[y/N]' }
  while ($true) {
    $answer = (Read-Host "[aikami] $Question $suffix").Trim().ToLower()
    if (-not $answer) { return $Default }
    if ($answer -eq 'y' -or $answer -eq 'yes') { return $true }
    if ($answer -eq 'n' -or $answer -eq 'no')  { return $false }
  }
}

# `exit` inside `irm | iex` would terminate the caller's PowerShell session,
# so the whole installer runs as a function and only sets the exit code.
try {
  # @(...)[-1]: the function's return value is the last thing it emits, so a
  # stray pipeline write from a helper cannot turn the exit code into an array.
  $code = @(Install-AikamiStack)[-1]
} catch {
  Write-Err $_.Exception.Message
  Write-Info $_.ScriptStackTrace
  $code = 1
}
$global:LASTEXITCODE = $code
if ($code -ne 0 -and -not [Environment]::UserInteractive) { exit $code }
