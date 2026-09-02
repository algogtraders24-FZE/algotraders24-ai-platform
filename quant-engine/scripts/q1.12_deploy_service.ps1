# Q1.12 Phase 2/3 - deploy the Q1.11 execution service to the real VPS as a
# persistent, self-restarting process (not dependent on an open PowerShell
# window), using the SAME Task Scheduler pattern mt5-bridge/README.md
# already documents and this VPS already runs successfully for the MT5
# bridge - not a new mechanism.
#
# PREREQUISITE (do this first, manually, same RDP-drive-redirection method
# as Q1.10): copy the new service files onto the VPS:
#   quant-engine/service/quant_lite_execution_service.py
#   quant-engine/service/requirements.txt
# to:
#   C:\AT24\quant-lite\quant-engine\service\
# (quant-engine/scripts/ and quant-engine/spec_engine/ should already be
# there from Q1.10 - this script checks and tells you if they're missing.)

$ErrorActionPreference = "Continue"
$root = "C:\AT24\quant-lite"
$serviceDir = "$root\quant-engine\service"

Write-Host "`n########## PHASE 2 - VPS SERVICE DEPLOYMENT ##########`n"

Write-Host "--- Prerequisite check ---"
$checks = @(
    @{ path = "$root\quant_engine\market.db"; label = "market.db" },
    @{ path = "$root\quant-engine\scripts\run_backtest_job.py"; label = "run_backtest_job.py" },
    @{ path = "$root\quant-engine\spec_engine\execution_mtf.py"; label = "execution_mtf.py (canonical engine)" },
    @{ path = "$root\quant-engine\spec_engine\schema.py"; label = "schema.py" },
    @{ path = "$serviceDir\quant_lite_execution_service.py"; label = "the new Q1.11 service file" },
    @{ path = "$serviceDir\requirements.txt"; label = "service requirements.txt" }
)
$allPresent = $true
foreach ($c in $checks) {
    $exists = Test-Path $c.path
    Write-Host "$(if ($exists) {'[OK]'} else {'[MISSING]'}) $($c.label): $($c.path)"
    if (-not $exists) { $allPresent = $false }
}
if (-not $allPresent) {
    Write-Host "`n>>> STOP - copy the missing file(s) above before continuing (same RDP drive-redirection method as Q1.10). <<<`n"
    exit 1
}

Write-Host "`n--- No duplicate engine implementation check (read-only) ---"
Write-Host "Confirming the service imports execution_mtf.py's own chain, not a second copy:"
Select-String -Path "$serviceDir\quant_lite_execution_service.py" -Pattern "run_backtest_job|JOB_RUNNER_SCRIPT" | Select-Object -First 3

Write-Host "`n--- Python / dependencies ---"
& "$root\runtime\Scripts\Activate.ps1"
python --version
pip install --quiet -r "$serviceDir\requirements.txt"
python -c "import fastapi, uvicorn, numpy, pandas; print('fastapi', fastapi.__version__, '| uvicorn', uvicorn.__version__, '| numpy', numpy.__version__, '| pandas', pandas.__version__)"

Write-Host "`n--- market.db re-checksum before starting the service (defense in depth) ---"
$hash = (Get-FileHash "$root\quant_engine\market.db" -Algorithm SHA256).Hash.ToLower()
$expected = "609cdc21f88629569bbd947b2f7fd7ed8cf5e9799800957c15a2435b35df4aae"
Write-Host "Got:      $hash"
Write-Host "Expected: $expected"
Write-Host "Match: $($hash -eq $expected)"

# ============================================================
Write-Host "`n########## PHASE 3 - PERSISTENT PROCESS (Task Scheduler, same pattern as AT24-MT5-Bridge) ##########`n"
# ============================================================
Write-Host "Generate a real secret now if you haven't already (DO NOT paste the output anywhere back to me - keep it only in this PowerShell session / the env var below):"
Write-Host '  python -c "import secrets; print(secrets.token_urlsafe(32))"'
Write-Host "`nSet it as a persistent machine-level environment variable (survives reboot, available to the scheduled task):"
Write-Host '  [System.Environment]::SetEnvironmentVariable("QUANT_LITE_EXEC_SECRET", "<paste generated value here>", "Machine")'
Write-Host "`nThen create the scheduled task (run this once, as Administrator):"

$taskScript = @'
$action = New-ScheduledTaskAction -Execute "C:\AT24\quant-lite\runtime\Scripts\uvicorn.exe" -Argument "quant_lite_execution_service:app --host 127.0.0.1 --port 8788" -WorkingDirectory "C:\AT24\quant-lite\quant-engine\service"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -Restart -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName "AT24-QuantLite-ExecService" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
Start-ScheduledTask -TaskName "AT24-QuantLite-ExecService"
'@
Write-Host $taskScript
Write-Host "`n>>> Copy the block above into an elevated (Administrator) PowerShell window and run it. <<<"
Write-Host ">>> Note: a scheduled task launched this way does not inherit a user-session env var set via SetEnvironmentVariable('...','Machine') until the machine (or at least the Task Scheduler service) picks up the new machine-level variable - a reboot or 'schtasks /end' + restart of the task after setting it is the safest way to guarantee this. <<<"
Write-Host "`nVerify it's running and bound correctly (not open to anything but localhost):"
Write-Host '  Get-NetTCPConnection -LocalPort 8788 | Select-Object LocalAddress,State'
Write-Host "  (LocalAddress must show 127.0.0.1, never 0.0.0.0)"

Write-Host "`n--- Once running, confirm health ---"
Write-Host '  Invoke-RestMethod -Uri "http://127.0.0.1:8788/health"'
Write-Host "  Expect: secretConfigured=True, enginePresent=True, marketDbPresent=True"

Write-Host "`n--- Real MACD/RSI/EMA test against the now-persistent service (same requests already proven in Q1.10/Q1.11) ---"
Write-Host "Re-use the exact request bodies from Q1.10's own transcript (MACD: 2024-01-01/2024-12-31, symbol field 'XAUUSD' not 'XAUUSD_EXNESS' inside strategy, dbSymbol via top-level 'symbol' field) - do not reconstruct them from memory, copy them verbatim from Q1.10_VPS_BACKTEST_POC.md or this session's own transcript to avoid re-introducing a transcription error."

# ============================================================
Write-Host "`n########## PHASE 4 - CLOUDFLARE TUNNEL AUDIT (read-only - run this, share output, then I give the exact edit) ##########`n"
# ============================================================
Write-Host "--- cloudflared process ---"
Get-Process cloudflared -ErrorAction SilentlyContinue | Select-Object Id, CPU, @{N='RAM_MB';E={[math]::Round($_.WorkingSet/1MB,1)}}

Write-Host "`n--- Scheduled tasks for the tunnel ---"
Get-ScheduledTask | Where-Object { $_.TaskName -match "Tunnel|Cloudflare|AT24" } | Select-Object TaskName, State

Write-Host "`n--- Config file location (default) ---"
$cfConfigPaths = @(
    "$env:USERPROFILE\.cloudflared\config.yml",
    "C:\ProgramData\cloudflared\config.yml"
)
foreach ($p in $cfConfigPaths) {
    if (Test-Path $p) {
        Write-Host "`nFound: $p"
        Write-Host "--- contents (share this back - it's routing config, not a secret; the tunnel's own credentials file, a separate .json, should NOT be shared) ---"
        Get-Content $p
    }
}

Write-Host "`n--- Tunnel list (if cloudflared CLI is on PATH) ---"
cloudflared tunnel list 2>&1
