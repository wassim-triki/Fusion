#requires -Version 7.0
<#
 Runs a Fusion backend test project with the right environment and prints one summary line.
   pwsh -File <skill>/scripts/test-backend.ps1 Performance [-Filter "FullyQualifiedName~Review"]
 - Sets FUSION_<SERVICE>_RELATIONAL_TEST_CONNECTION when the service has relational tests,
   so they run instead of skipping silently.
 - Builds into a separate artifacts folder, so a running service's locked bin/ doesn't block the
   build. If the lock still bites, stops that service, tests, and restarts it if it was up.
 - Refuses to start when RAM is short (memory-check.ps1), and shuts the compiler servers down after,
   so they don't stay resident (~0.3 GB).
#>
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('Performance', 'CoreHR', 'Identity', 'Interview', 'Training')]
    [string]$Service,
    [string]$Filter
)

$ErrorActionPreference = 'Stop'
& pwsh -NoProfile -File (Join-Path $PSScriptRoot 'memory-check.ps1') -NeedGB 2 -Job "the $Service tests"
if ($LASTEXITCODE -ne 0) { exit 1 }
$Repo = $PSScriptRoot
while ($Repo -and -not (Test-Path (Join-Path $Repo 'AGENTS.md'))) { $Repo = Split-Path -Parent $Repo }
$Project = Join-Path $Repo "Backend/EY.HRPlatform.$Service.Tests"
if (-not (Test-Path $Project)) { throw "No test project at $Project" }

$var = if ($Service -eq 'Identity') { 'FUSION_TEST_PG' } else { "FUSION_$($Service.ToUpper())_RELATIONAL_TEST_CONNECTION" }
$usesVar = Select-String -Path (Join-Path $Project '*.cs') -Pattern $var -SimpleMatch -Quiet -ErrorAction SilentlyContinue
if (-not $usesVar) { $usesVar = (Get-ChildItem $Project -Recurse -Filter *.cs | Select-String -Pattern $var -SimpleMatch -List | Select-Object -First 1) -ne $null }
if ($usesVar) {
    if (-not $env:FUSION_PG_PASSWORD) { throw 'Set FUSION_PG_PASSWORD to the local postgres password.' }
    Set-Item "env:$var" "Host=localhost;Port=5432;Username=postgres;Password=$env:FUSION_PG_PASSWORD"
}

$artifacts = Join-Path ([IO.Path]::GetTempPath()) "fusion-test-$Service"
$testArgs = @('test', $Project, '--artifacts-path', $artifacts, '--nologo')
if ($Filter) { $testArgs += @('--filter', $Filter) }

function Invoke-Tests {
    $out = & dotnet @testArgs 2>&1 | ForEach-Object { "$_" }
    return @{ Code = $LASTEXITCODE; Out = $out }
}

$r = Invoke-Tests
$locked = $r.Out -match 'MSB3026|MSB3027|being used by another process'
$restart = $false
if ($r.Code -ne 0 -and $locked) {
    Write-Host "Build output locked by the running $Service service; stopping it for the test run." -ForegroundColor Yellow
    $stack = Join-Path $PSScriptRoot 'stack.ps1'
    & pwsh -File $stack -Down -Only $Service | Out-Null
    $restart = $true
    $r = Invoke-Tests
}

$summary = $r.Out | Where-Object { $_ -match '(Passed|Failed)!\s+-' } | Select-Object -Last 1
if ($summary) {
    $p = [regex]::Match($summary, 'Passed:\s+(\d+)').Groups[1].Value
    $f = [regex]::Match($summary, 'Failed:\s+(\d+)').Groups[1].Value
    $s = [regex]::Match($summary, 'Skipped:\s+(\d+)').Groups[1].Value
    Write-Host "$Service tests | Passed $p | Failed $f | Skipped $s$(if ($usesVar) { ' (relational on)' })"
} else {
    $r.Out | Select-Object -Last 30 | ForEach-Object { Write-Host $_ }
}
$r.Out | Where-Object { $_ -match '^\s+Skipped ' } | Select-Object -First 20 | ForEach-Object { Write-Host $_ }
# Each failure with its message, standard output and stack trace (up to 40 lines each, first 10 failures).
$shown = 0; $lines = 0; $inFailure = $false
foreach ($line in $r.Out) {
    if ($line -match '^\s+Failed ') { $shown++; $lines = 0; $inFailure = $shown -le 10 }
    elseif ($line -match '^\s+(Passed|Skipped) ' -or $line -match '(Passed|Failed)!\s+-') { $inFailure = $false }
    if ($inFailure -and $lines -lt 40) { Write-Host $line; $lines++ }
}

& dotnet build-server shutdown 2>&1 | Out-Null
if ($restart) { & pwsh -File (Join-Path $PSScriptRoot 'stack.ps1') -Only $Service | Out-Null; Write-Host "$Service restarted." }
exit $r.Code
