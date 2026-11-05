#requires -Version 7.0
<#
=====================================================================
 Fusion dev stack launcher  —  fusion-dev skill: scripts/stack.ps1
=====================================================================
 One command to get the WHOLE local stack up and ready, every time,
 no matter what state the machine is in. Idempotent and self-healing:
 anything already healthy is left alone; anything down — or wedged on
 a clogged port — is freed and (re)started.

 Brings up:
   Mailpit        SMTP 1025 / UI http://localhost:8025
   Gateway        http://localhost:5000
   Identity       http://localhost:5101
   CoreHR         http://localhost:5301   (gateway-only)
   Performance    http://localhost:5401   (gateway-only)
   Frontend       shell http://localhost:3000 + our MFEs core 3002 / performance 3004 / platform 3007
                  (-Apps core[,performance,platform] starts the shell with only those;
                  -AllApps also starts Interview, Learning, Recruitment, Onboarding)

 Memory (13.9 GB dev machine): backends run their built app directly (no `dotnet run` host left
 resident), only our four Next apps start by default, compiler servers are shut down once the
 backends are up, and a restart closes the service's old window with everything under it.

 USAGE (from anywhere):
   pwsh -File <repo>\.agents\skillsusion-dev\scripts\stack.ps1          # ensure everything is up
   pwsh -File <repo>\.agents\skillsusion-dev\scripts\stack.ps1 -Force   # hard restart everything (use when ports are clogged/wedged)
   pwsh -File <repo>\.agents\skillsusion-dev\scripts\stack.ps1 -Down    # stop the whole managed stack
   pwsh -File <repo>\.agents\skillsusion-dev\scripts\stack.ps1 -NoFrontend   # backend + mailpit only
   pwsh -File <repo>\.agents\skillsusion-dev\scripts\stack.ps1 -Status   # read-only status; exit 1 if anything is down

   # Restart ONE service after a code change WITHOUT touching the (warm) frontend:
   pwsh -File <repo>\.agents\skillsusion-dev\scripts\stack.ps1 -Force -Only Identity
   pwsh -File <repo>\.agents\skillsusion-dev\scripts\stack.ps1 -Force -Only Gateway,CoreHR
   # Names: Gateway, Identity, CoreHR, Performance, Frontend, Mailpit. -Only limits
   # start / readiness / final-status to just those, so nothing else is disturbed.

 Each service runs in its OWN persistent window, so it survives after
 this launcher exits (and is not tied to any Claude/Codex session).

 App login: admin@ey-hr.com   |   Mail: http://localhost:8025 (local password is in .local-docs/agents/data/README.md)
=====================================================================
#>
param(
    [switch]$Force,        # kill + restart every managed service, even healthy ones
    [switch]$Down,         # stop the whole managed stack and exit
    [switch]$NoFrontend,   # skip the pnpm dev frontend
    [switch]$AllApps,      # also start the MFEs we don't own (Interview, Learning, Recruitment, Onboarding)
    [ValidateSet('core','performance','platform')]
    [string[]]$Apps,       # start the shell with only these of our MFEs (default: all three); saves memory
    [switch]$NoMailpit,    # skip mailpit
    [switch]$Status,       # read-only: report what is up (incl. the shell->gateway->Performance chain) and exit
    [ValidateSet('Gateway','Identity','CoreHR','Performance','Frontend','Mailpit')]
    [string[]]$Only        # act on ONLY these services (names below); everything else untouched
)

$ErrorActionPreference = 'Stop'
# Repo root = nearest ancestor of this script that holds AGENTS.md (the script lives in .agents/skills/fusion-dev/scripts).
$Repo = $PSScriptRoot
while ($Repo -and -not (Test-Path (Join-Path $Repo 'AGENTS.md'))) { $Repo = Split-Path -Parent $Repo }
if (-not $Repo) { throw 'Could not locate the Fusion repo root (no AGENTS.md above this script).' }

# -Only <names> scopes every phase (start, readiness, status, down) to just the
# named services, leaving anything not listed completely alone — the fast path for
# restarting one backend service after a code change without cold-booting the
# frontend. Empty = act on everything (original behaviour).
$OnlySet = @($Only | Where-Object { $_ } | ForEach-Object { $_.Trim() })
function Want([string]$Name) {
    if ($OnlySet.Count -eq 0) { return $true }
    return $OnlySet -contains $Name
}

# ---- service definitions -------------------------------------------------
$Backend = @(
    @{ Name = 'Gateway';     Project = 'Backend/EY.HRPlatform.Gateway';     Port = 5000; Url = 'http://localhost:5000';        Health = 'http://localhost:5000/' }
    @{ Name = 'Identity';    Project = 'Backend/EY.HRPlatform.Identity';    Port = 5101; Url = 'http://localhost:5101';        Health = 'http://localhost:5101/health' }
    @{ Name = 'CoreHR';      Project = 'Backend/EY.HRPlatform.CoreHR';      Port = 5301; Url = 'http://localhost:5301';        Health = 'http://localhost:5301/health' }
    @{ Name = 'Performance'; Project = 'Backend/EY.HRPlatform.Performance'; Port = 5401; Url = 'http://localhost:5401';        Health = 'http://localhost:5401/health' }
)
$FrontendPorts = 3000..3007        # shell 3000 + every MFE port (stopping clears all of them)
$OurApps       = @('shell', 'core', 'performance', 'platform')   # the shell waits on the MFEs started (scripts/wait-mfes.cjs)
$OtherAppPorts = @(3001, 3003, 3005, 3006)                       # Interview, Learning, Recruitment, Onboarding
$MfePorts      = [ordered]@{ core = 3002; performance = 3004; platform = 3007 }
$WantedMfes    = if ($Apps) { @($Apps) } else { @($MfePorts.Keys) }
$MailpitPorts  = @(1025, 8025)

# ---- helpers -------------------------------------------------------------
function Write-Step($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  $msg" -ForegroundColor Yellow }

# "up" = an HTTP server answers on the port with ANYTHING (200/401/404/... all count).
# Connection-refused / timeout => not up. This treats a wedged port (dead process
# still holding the socket, or a non-HTTP squatter) as NOT up, so it gets freed.
function Test-Up([string]$Url, [int]$TimeoutSec = 2) {
    try {
        Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop | Out-Null
        return $true
    } catch {
        if ($_.Exception.Response) { return $true }   # HTTP error status = server answered = up
        return $false
    }
}

function Test-Listening([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# Our MFEs with a dev server listening, by name.
function Get-RunningMfes { return @($MfePorts.Keys | Where-Object { Test-Listening $MfePorts[$_] }) }

# Free a TCP port by killing whatever process is LISTENING on it.
function Stop-Port([int[]]$Ports) {
    foreach ($p in $Ports) {
        $procIds = @()
        try {
            $procIds = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop |
                       Select-Object -ExpandProperty OwningProcess -Unique
        } catch {
            # fallback: parse netstat
            $procIds = netstat -ano | Select-String ":$p\s+.*LISTENING" |
                       ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
        }
        foreach ($procId in $procIds) {
            if ($procId -and "$procId" -ne '0') {
                try {
                    Stop-Process -Id ([int]$procId) -Force -ErrorAction Stop
                    Write-Warn2 "freed :$p (pid $procId)"
                } catch { }
            }
        }
    }
}

function Resolve-Mailpit {
    $c = Get-Command mailpit -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    $winget = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\axllent.mailpit_Microsoft.Winget.Source_8wekyb3d8bbwe\mailpit.exe'
    if (Test-Path $winget) { return $winget }
    return $null
}

# Close a service's earlier window and everything it started (turbo, pnpm, next, the service),
# so restarts don't leave orphaned shells and processes holding memory.
function Stop-Window([string]$Title) {
    Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" |
        Where-Object { $_.CommandLine -like "*WindowTitle='$Title'*" } |
        ForEach-Object { & taskkill /T /F /PID $_.ProcessId 2>&1 | Out-Null }
}

function Get-WindowTitle([string]$Name) {
    if ($Name -eq 'Frontend') { return 'Fusion Frontend' }
    $s = $Backend | Where-Object { $_.Name -eq $Name }
    return "Fusion $($s.Name) :$($s.Port)"
}

# Launch a command in its own persistent pwsh window (survives this launcher).
function Start-Window([string]$Title, [string]$WorkDir, [string]$Command, [hashtable]$EnvVars) {
    $prefix = '$Host.UI.RawUI.WindowTitle=''' + $Title + ''';'
    if ($EnvVars) {
        foreach ($k in $EnvVars.Keys) {
            $prefix += ' $env:' + $k + '=''' + $EnvVars[$k] + ''';'
        }
    }
    $inner = $prefix + ' Set-Location ''' + $WorkDir + '''; ' + $Command
    Start-Process pwsh -ArgumentList '-NoExit', '-Command', $inner | Out-Null
}

# ---- DOWN ----------------------------------------------------------------
function Get-Code([string]$Url) {
    try { return [int](Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing -MaximumRedirection 0 -SkipHttpErrorCheck).StatusCode }
    catch { return 0 }
}

if ($Status) {
    $rows = @()
    $rows += $Backend | ForEach-Object { @{ Name = $_.Name; Up = (Test-Up $_.Health 2); Note = $_.Url } }
    $rows += @{ Name = 'Mailpit';  Up = (Test-Up 'http://localhost:8025/' 2); Note = 'http://localhost:8025' }
    # The shell's first page compile can outlast an HTTP probe, so "up" is its listener; the note names the MFEs running.
    $mfes = Get-RunningMfes
    $rows += @{ Name = 'Frontend'; Up = (Test-Listening 3000); Note = "http://localhost:3000  MFEs: $(if ($mfes.Count) { $mfes -join ', ' } else { 'none' })" }
    # Unauthenticated call through the shell: 401 = shell, gateway and Performance all answer; 502/504 = backend down.
    $code = Get-Code 'http://localhost:3000/api/performance/context'
    $rows += @{ Name = 'Chain'; Up = ($code -eq 401); Note = "shell /api/performance -> $code (401 expected)" }
    $downCount = 0
    foreach ($r in $rows) {
        $state = if ($r.Up) { 'UP  ' } else { $downCount++; 'DOWN' }
        Write-Host ("  {0,-12} {1}  {2}" -f $r.Name, $state, $r.Note) -ForegroundColor ($(if ($r.Up) { 'Green' } else { 'Red' }))
    }
    # Drift that costs memory: the MFEs we don't own, or `dotnet run` hosts from a hand-started service.
    $extra = @($OtherAppPorts | Where-Object { Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue })
    if ($extra.Count) { Write-Host "  Note: MFEs we don't own are running (ports $($extra -join ', ')); fine with -AllApps, otherwise ~250 MB each." -ForegroundColor Yellow }
    $hosts = @(Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" | Where-Object { $_.CommandLine -match '\srun\s' })
    if ($hosts.Count) { Write-Host "  Note: $($hosts.Count) 'dotnet run' host(s) running (~160 MB each); restart those services with stack.ps1 -Force -Only <Name>." -ForegroundColor Yellow }
    $availableGB = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory).AvailableMBytes / 1024
    Write-Host ("  RAM available: {0:N1} GB" -f $availableGB) -ForegroundColor $(if ($availableGB -lt 2.5) { 'Yellow' } else { 'Green' })
    if ($downCount -gt 0) { Write-Host "Restart only what is down: stack.ps1 -Force -Only <Name>" -ForegroundColor Yellow; exit 1 }
    exit 0
}

if ($Down) {
    Write-Step "Stopping the Fusion dev stack..."
    foreach ($s in $Backend) { if (Want $s.Name) { Stop-Window (Get-WindowTitle $s.Name); Stop-Port $s.Port } }
    if (Want 'Frontend') { Stop-Window (Get-WindowTitle 'Frontend'); Stop-Port $FrontendPorts }
    if ((Want 'Mailpit') -and -not $NoMailpit) { Stop-Port $MailpitPorts }
    Write-Ok "stack stopped."
    return
}

# ---- LOCAL DOCS ----------------------------------------------------------
# Screens of items past review, closed plans and old demo outputs (quiet when there is nothing to do).
& pwsh -NoProfile -File (Join-Path $PSScriptRoot 'prune-local-docs.ps1')

# ---- MAILPIT -------------------------------------------------------------
if ((Want 'Mailpit') -and -not $NoMailpit) {
    Write-Step "Mailpit (SMTP 1025 / UI 8025)"
    if (-not $Force -and (Test-Up 'http://localhost:8025/')) {
        Write-Ok "already up."
    } else {
        Stop-Port $MailpitPorts
        $mp = Resolve-Mailpit
        if ($mp) {
            Start-Process -FilePath $mp -WindowStyle Minimized | Out-Null
            Write-Ok "started ($mp)."
        } else {
            Write-Warn2 "mailpit.exe not found — install with: winget install axllent.mailpit"
        }
    }
}

# ---- BACKEND -------------------------------------------------------------
$builtBackend = $false
foreach ($s in $Backend) {
    if (-not (Want $s.Name)) { continue }
    Write-Step "$($s.Name)  ->  $($s.Url)"
    if (-not $Force -and (Test-Up $s.Health)) {
        Write-Ok "already up."
        continue
    }
    Stop-Window (Get-WindowTitle $s.Name)
    Stop-Port $s.Port    # clear a clogged/wedged listener if any
    # Build here, one service at a time (parallel builds collide on the shared projects), then run the
    # built app from its project folder (same content root as `dotnet run`), so no `dotnet run` host
    # stays resident beside it.
    $projectDir = Join-Path $Repo $s.Project
    $build = & dotnet build $projectDir --nologo -v q 2>&1
    $builtBackend = $true
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  build failed:" -ForegroundColor Red
        $build | Where-Object { $_ -match 'error' } | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        continue
    }
    $exe = Join-Path $projectDir "bin/Debug/net10.0/$(Split-Path $s.Project -Leaf).exe"
    Start-Window -Title (Get-WindowTitle $s.Name) -WorkDir $projectDir -Command "& '$exe'" `
        -EnvVars @{ ASPNETCORE_ENVIRONMENT = 'Development'; ASPNETCORE_URLS = $s.Url }
    Write-Ok "starting in its own window..."
}

# ---- FRONTEND ------------------------------------------------------------
if ((Want 'Frontend') -and -not $NoFrontend) {
    Write-Step "Frontend (pnpm dev)  ->  http://localhost:3000"
    # Up only when the shell answers AND every requested MFE listens; a shell left with another set restarts with this one.
    $missing = @($WantedMfes | Where-Object { -not (Test-Listening $MfePorts[$_]) })
    $shellUp = Test-Up 'http://localhost:3000/'
    if (-not $Force -and $missing.Count -eq 0 -and $shellUp) {
        Write-Ok "already up."
    } else {
        if (-not $Force -and $shellUp) { Write-Warn2 "not running: $($missing -join ', '); restarting the frontend with them." }
        Stop-Window (Get-WindowTitle 'Frontend')
        Stop-Port $FrontendPorts   # clear any partial MFE set
        $started = if ($Apps) { @('shell') + $Apps } else { $OurApps }
        $devCommand = if ($AllApps) { 'pnpm dev' } else { 'pnpm exec turbo dev ' + (($started | ForEach-Object { "--filter=$_" }) -join ' ') }
        $devEnv = if ($Apps -and -not $AllApps) { @{ FUSION_DEV_APPS = ($Apps -join ',') } } else { $null }
        Start-Window -Title (Get-WindowTitle 'Frontend') -WorkDir (Join-Path $Repo 'Frontend') -Command $devCommand -EnvVars $devEnv
        Write-Ok "starting in its own window (first boot takes ~30-60s)..."
    }
}

# ---- READINESS -----------------------------------------------------------
Write-Step "Waiting for services to become ready (up to ~150s)..."
$targets = @()
$targets += $Backend | Where-Object { Want $_.Name } | ForEach-Object { @{ Name = $_.Name; Url = $_.Health } }
if ((Want 'Mailpit')  -and -not $NoMailpit)  { $targets += @{ Name = 'Mailpit';  Url = 'http://localhost:8025/' } }
if ((Want 'Frontend') -and -not $NoFrontend) { $targets += @{ Name = 'Frontend'; Url = 'http://localhost:3000/' } }

$deadline = (Get-Date).AddSeconds(150)
$pending  = [System.Collections.ArrayList]@($targets)
while ($pending.Count -gt 0 -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    foreach ($t in @($pending)) {
        if (Test-Up $t.Url 2) {
            Write-Ok "$($t.Name) ready."
            $pending.Remove($t)
        }
    }
}

# The backend builds are done once their services answer; drop the compiler servers they left (~0.3 GB).
if ($builtBackend) { & dotnet build-server shutdown 2>&1 | Out-Null }

Write-Host ""
Write-Step "Final status"
$allUp = $true
foreach ($t in $targets) {
    if (Test-Up $t.Url 2) {
        Write-Host ("  {0,-12} UP" -f $t.Name) -ForegroundColor Green
    } else {
        Write-Host ("  {0,-12} DOWN (check its window)" -f $t.Name) -ForegroundColor Red
        $allUp = $false
    }
}
if ((Want 'Frontend') -and -not $NoFrontend) {
    $missing = @($WantedMfes | Where-Object { -not (Test-Listening $MfePorts[$_]) })
    if ($missing.Count) {
        Write-Host ("  {0,-12} DOWN: {1} (check the Frontend window)" -f 'MFEs', ($missing -join ', ')) -ForegroundColor Red
        $allUp = $false
    }
}
Write-Host ""
if ($allUp) {
    Write-Host "Stack is ready:  http://localhost:3000   (mail: http://localhost:8025)" -ForegroundColor Green
    Write-Host "Login: admin@ey-hr.com (local password is in .local-docs/agents/data/README.md)" -ForegroundColor Green
} else {
    Write-Host "Some services are not up yet — open their window to see logs, or re-run with -Force." -ForegroundColor Yellow
}
