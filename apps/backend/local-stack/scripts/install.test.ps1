# apps/backend/local-stack/scripts/install.test.ps1
#
# Self-test for the Windows one-command installer (C-418 Feature F). The twin
# of scripts/install.test.sh: exercises install.ps1 against a LOCAL bundle
# served over HTTP — no network, no Docker, no real hardware wizard (a fake
# stack-init.exe stand-in writes the .env).
# Run via:  bun moon run local-stack:test-install-windows
#
# Asserts:
#   1. install.ps1 and aikami.ps1 parse (PowerShell AST, no execution).
#   2. The installer downloads + checksum-verifies + extracts + runs the
#      wizard; the .env lands in the compose project dir (<dir>\current\.env).
#   3. The `aikami` control command is installed and resolves the project dir.
#   4. An existing .env is never overwritten.
#   5. AIKAMI_SKIP_WIZARD=1 skips the wizard (fetch-only).
#   6. A tampered archive (checksum mismatch) is rejected before extraction.
#
# Nothing here touches the tester's PATH, Docker, or %APPDATA% —
# AIKAMI_NO_PATH and AIKAMI_SKIP_DOCKER_CHECK are set for every run.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $PSScriptRoot
$script:Failures = 0

function Write-Case([string] $Message) { Write-Host "[install.test] $Message" -ForegroundColor Blue }
function Write-Pass([string] $Message) { Write-Host "  ok     $Message" -ForegroundColor Green }
function Write-Fail([string] $Message) {
  Write-Host "  FAIL   $Message" -ForegroundColor Red
  $script:Failures++
}
function Assert-True([bool] $Condition, [string] $Message) {
  if ($Condition) { Write-Pass $Message } else { Write-Fail $Message }
}

# ── 1. Both scripts parse ─────────────────────────────────────────────────
Write-Case 'syntax check (PowerShell parser)'
foreach ($name in @('install.ps1', 'aikami.ps1')) {
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $Root $name), [ref] $null, [ref] $errors)
  Assert-True ($errors.Count -eq 0) "$name parses ($($errors.Count) error(s))"
  foreach ($parseError in $errors) { Write-Host "         $parseError" -ForegroundColor Red }
}

# ── Fixture: a fake release bundle served over HTTP ───────────────────────
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("aikami-install-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$listener = $null
$job = $null
try {
  $bundleName = 'local-stack-test-windows-x64'
  $assetName  = "$bundleName.zip"
  $bundleDir  = Join-Path $Tmp "bundle\$bundleName"
  New-Item -ItemType Directory -Path (Join-Path $bundleDir 'bin') -Force | Out-Null

  # The REAL wizard, compiled the way the release bundle compiles it. A stub
  # would leave the most fragile link untested: whether a `bun build --compile`
  # binary actually runs when install.ps1 invokes it by path. It costs a few
  # seconds and makes this an end-to-end test rather than a mock.
  $wizardExe = Join-Path $bundleDir 'bin\stack-init.exe'
  Write-Case 'compiling the real stack-init wizard (bun build --compile)'
  Push-Location $Root
  try {
    & bun build --compile --target bun-windows-x64 stack/init.ts --outfile $wizardExe | Out-Host
  } finally { Pop-Location }
  if (-not (Test-Path -LiteralPath $wizardExe) -and (Test-Path -LiteralPath "$wizardExe.exe")) {
    Move-Item -LiteralPath "$wizardExe.exe" -Destination $wizardExe
  }
  Assert-True (Test-Path -LiteralPath $wizardExe) 'stack-init.exe compiled'

  Set-Content -LiteralPath (Join-Path $bundleDir '.env.example') -Value 'COMPOSE_PROFILES=text,image,voice'
  Set-Content -LiteralPath (Join-Path $bundleDir 'compose.yaml') -Value @'
services:
  text-engine:
    image: busybox
    profiles: ["text"]
'@
  Set-Content -LiteralPath (Join-Path $bundleDir 'compose.cpu.yaml') -Value ''
  Copy-Item -LiteralPath (Join-Path $Root 'aikami.ps1') -Destination $bundleDir
  Copy-Item -LiteralPath (Join-Path $Root 'aikami.cmd') -Destination $bundleDir

  $releaseDir = Join-Path $Tmp 'serve\local-stack-test'
  New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
  $assetPath = Join-Path $releaseDir $assetName
  Compress-Archive -Path $bundleDir -DestinationPath $assetPath -Force
  $hash = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLower()
  Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS') -Value "$hash  $assetName"

  # A HttpListener in a background job is enough of a release server: the
  # installer only ever GETs two files.
  $port = Get-Random -Minimum 20000 -Maximum 40000
  $serveRoot = Join-Path $Tmp 'serve'
  $job = Start-Job -ScriptBlock {
    param($ServeRoot, $Port)
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
    $listener.Start()
    while ($listener.IsListening) {
      $context = $listener.GetContext()
      $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/')) -replace '/', '\'
      $file = Join-Path $ServeRoot $relative
      if (Test-Path -LiteralPath $file -PathType Leaf) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $context.Response.StatusCode = 404
      }
      $context.Response.Close()
    }
  } -ArgumentList $serveRoot, $port

  $baseUrl = "http://127.0.0.1:$port"
  for ($i = 0; $i -lt 40; $i++) {
    try {
      Invoke-WebRequest -Uri "$baseUrl/local-stack-test/SHA256SUMS" -UseBasicParsing -TimeoutSec 2 | Out-Null
      break
    } catch { Start-Sleep -Milliseconds 250 }
  }

  $installer = Join-Path $Root 'install.ps1'
  $installDir = Join-Path $Tmp 'install-root'
  $projectDir = Join-Path $installDir 'current'

  function Invoke-Installer([hashtable] $ExtraEnv) {
    $envBlock = @{
      AIKAMI_INSTALL_BASE_URL = $baseUrl
      AIKAMI_STACK_VERSION    = 'test'
      AIKAMI_STACK_DIR        = $installDir
      AIKAMI_SKIP_DOCKER_CHECK = '1'
      AIKAMI_YES              = '1'
      AIKAMI_NO_PATH          = '1'
    }
    foreach ($key in $ExtraEnv.Keys) { $envBlock[$key] = $ExtraEnv[$key] }
    $assignments = ($envBlock.GetEnumerator() | ForEach-Object { "`$env:$($_.Key)='$($_.Value)'" }) -join '; '
    # A child process keeps the test's own environment clean and gives a real
    # exit code for the failure cases.
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -Command `
      "$assignments; & '$installer'; exit `$LASTEXITCODE" 2>&1 | Out-String
    return [pscustomobject]@{ Output = $output; ExitCode = $LASTEXITCODE }
  }

  # ── 2. First install ────────────────────────────────────────────────────
  Write-Case 'first install (wizard -> .env in the project dir)'
  $run = Invoke-Installer @{}
  Assert-True ($run.ExitCode -eq 0) "installer exited 0 (was $($run.ExitCode))"
  Assert-True ($run.Output -match 'checksum OK') 'installer verified the checksum'
  Assert-True ($run.Output -match 'step 6/6') 'installer completed all steps'
  Assert-True (Test-Path -LiteralPath (Join-Path $projectDir '.env')) '.env written into the compose project dir'
  if (Test-Path -LiteralPath (Join-Path $projectDir '.env')) {
    # The real wizard's picks depend on the host's hardware, so assert the
    # contract (the two variables compose actually reads), not a fixed value.
    $envText = Get-Content -LiteralPath (Join-Path $projectDir '.env') -Raw
    Assert-True ($envText -match 'COMPOSE_PROFILES=\S') '.env selects modalities'
    Assert-True ($envText -match 'COMPOSE_FILE=\S*compose\.yaml') '.env selects a compose topology'
  }
  # ASCII-only pattern on purpose: Windows PowerShell 5.1 reads a BOM-less
  # script as ANSI, so a literal em dash here would not match the UTF-8 one the
  # wizard prints.
  Assert-True ($run.Output -match 'Models to download') 'the wizard plan reached the user (not swallowed by the pipeline)'
  Assert-True (Test-Path -LiteralPath (Join-Path $projectDir 'VERSION')) 'VERSION marker written'
  Assert-True (-not (Get-ChildItem -LiteralPath $installDir -Filter '.download-*' -Force)) 'partial download cleaned up'

  # ── 3. Control command ──────────────────────────────────────────────────
  Write-Case 'aikami control command'
  Assert-True (Test-Path -LiteralPath (Join-Path $installDir 'aikami.cmd')) 'aikami.cmd installed at the install root'
  $resolved = (& (Join-Path $installDir 'aikami.cmd') dir | Out-String).Trim()
  Assert-True ($resolved -eq $projectDir) "aikami dir resolved '$resolved' (expected '$projectDir')"
  $reportedVersion = (& (Join-Path $installDir 'aikami.cmd') version | Out-String).Trim()
  Assert-True ($reportedVersion -eq 'test') "aikami version reported '$reportedVersion'"

  # ── 4. Existing .env is never clobbered ─────────────────────────────────
  Write-Case 'second install (.env protection)'
  Set-Content -LiteralPath (Join-Path $projectDir '.env') -Value 'COMPOSE_PROFILES=my-custom-value'
  $run = Invoke-Installer @{}
  Assert-True ($run.ExitCode -eq 0) 'second install exited 0'
  Assert-True ((Get-Content -LiteralPath (Join-Path $projectDir '.env') -Raw) -match 'my-custom-value') 'existing .env preserved across reinstall'

  # ── 5. Skip-wizard ──────────────────────────────────────────────────────
  Write-Case 'skip-wizard mode'
  $installDir = Join-Path $Tmp 'install-root2'
  $projectDir = Join-Path $installDir 'current'
  $run = Invoke-Installer @{ AIKAMI_SKIP_WIZARD = '1' }
  Assert-True ($run.ExitCode -eq 0) 'skip-wizard install exited 0'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectDir '.env'))) 'no .env written in skip-wizard mode'

  # ── 6. Tampered archive is rejected BEFORE extraction ───────────────────
  Write-Case 'checksum rejection (tampered archive)'
  $installDir = Join-Path $Tmp 'install-root3'
  $projectDir = Join-Path $installDir 'current'
  Set-Content -LiteralPath $assetPath -Value 'not a zip'
  $run = Invoke-Installer @{}
  Assert-True ($run.ExitCode -ne 0) 'installer refused the tampered archive'
  Assert-True ($run.Output -match 'checksum mismatch') 'failure names the checksum mismatch'
  Assert-True (-not (Test-Path -LiteralPath $projectDir)) 'nothing was extracted'
} finally {
  if ($job) { Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $Tmp) { Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
if ($script:Failures -gt 0) {
  Write-Host "[install.test] $($script:Failures) check(s) failed" -ForegroundColor Red
  exit 1
}
Write-Host '[install.test] all installer checks passed' -ForegroundColor Green
exit 0
