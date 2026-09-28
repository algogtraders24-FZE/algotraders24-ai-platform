# quant-engine/service/watchdog.ps1
#
# Self-healing health check for the AT24 Quant Lite remote execution
# service + its Cloudflare tunnel. Run every few minutes via Task
# Scheduler (see setup-watchdog.ps1) - never run this manually in a loop
# yourself.
#
# Why this exists: on 2026-09-28/29, the "AT24-QuantLite-ExecService"
# scheduled task had never actually been registered (Q1.12's deployment
# runbook stopped short of Phase 3), so every production backtest failed
# with a 502/401 for an unknown length of time before anyone noticed.
# This watchdog is the same self-healing pattern mt5-bridge/watchdog.ps1
# already uses for the MT5 bridge, so this class of silent outage can't
# recur unnoticed for the quant-lite execution path either.
#
# What it does, every time it runs:
#   1. Hits the service's own /health endpoint (unauthenticated by
#      design - see quant_lite_execution_service.py) and checks
#      status=="ok" AND secretConfigured/enginePresent/marketDbPresent
#      are all genuinely true, not just that something is listening on
#      the port.
#   2. If that fails, restarts the AT24-QuantLite-ExecService scheduled
#      task. A fresh process also re-reads the machine QUANT_LITE_EXEC_
#      SECRET env var on start - the exact fix needed on 2026-09-29 when
#      the secret was rotated but the already-running process kept using
#      its old in-memory value.
#   3. Optionally (if -PublicHealthUrl is set) also checks the public
#      HTTPS URL Vercel actually calls. If the LOCAL check passed but the
#      PUBLIC one fails, the service itself is fine and the tunnel is the
#      problem - restarts the "Cloudflared" Windows Service instead,
#      never the exec-service task. This service is a SEPARATE, dedicated
#      Cloudflared instance from the MT5 bridge's own `tunnel run
#      mt5-bridge` process (confirmed 2026-09-29 via
#      Get-CimInstance Win32_Process - PID 4688 is `mt5-bridge`,
#      unrelated) - restarting it never touches the MT5 data feed.
#
# Deliberately does nothing beyond restarting these two EXISTING,
# already-configured targets by name - it never touches the quant engine
# itself, market.db, or any job/result data, and never needs to know
# their own internal launch commands. If a target doesn't exist, the
# relevant command reports that in the log below instead of silently
# failing.

param(
    [string]$LocalHealthUrl = "http://localhost:8788/health",
    [string]$PublicHealthUrl = "",
    [string]$ExecServiceTaskName = "AT24-QuantLite-ExecService",
    [string]$TunnelServiceName = "Cloudflared",
    [string]$LogPath = "$PSScriptRoot\watchdog.log"
)

function Write-Log([string]$message) {
    $line = "$(Get-Date -Format o)  $message"
    Add-Content -Path $LogPath -Value $line
}

function Test-ServiceHealth([string]$url) {
    try {
        $resp = Invoke-WebRequest -Uri $url -TimeoutSec 10 -UseBasicParsing
        if ($resp.StatusCode -ne 200) {
            Write-Log "  $url -> HTTP $($resp.StatusCode)"
            return $false
        }
        $json = $resp.Content | ConvertFrom-Json
        if ($json.status -ne "ok" -or -not $json.secretConfigured -or -not $json.enginePresent -or -not $json.marketDbPresent) {
            Write-Log "  $url -> HTTP 200 but unhealthy (status=$($json.status) secretConfigured=$($json.secretConfigured) enginePresent=$($json.enginePresent) marketDbPresent=$($json.marketDbPresent))"
            return $false
        }
        return $true
    } catch {
        Write-Log "  $url -> unreachable ($($_.Exception.Message))"
        return $false
    }
}

function Restart-ExecServiceTask([string]$name) {
    Write-Log "Restarting scheduled task: $name"
    & schtasks /end /tn $name 2>$null | Out-Null
    Start-Sleep -Seconds 2
    & schtasks /run /tn $name 2>$null | Out-Null
}

function Restart-TunnelService([string]$name) {
    Write-Log "Restarting Windows service: $name"
    try {
        Restart-Service -Name $name -Force -ErrorAction Stop
    } catch {
        Write-Log "  Restart-Service '$name' failed: $($_.Exception.Message)"
    }
}

Write-Log "--- watchdog check ---"

$localOk = Test-ServiceHealth $LocalHealthUrl
if ($localOk) {
    Write-Log "Local exec service health OK."
} else {
    Write-Log "Local exec service health FAILED - restarting '$ExecServiceTaskName'."
    Restart-ExecServiceTask $ExecServiceTaskName
}

if ($PublicHealthUrl -ne "") {
    $publicOk = Test-ServiceHealth $PublicHealthUrl
    if ($publicOk) {
        Write-Log "Public exec service health OK."
    } elseif ($localOk) {
        # Exec service itself is fine locally - the tunnel is what's broken.
        Write-Log "Public exec service health FAILED but local is OK - restarting '$TunnelServiceName'."
        Restart-TunnelService $TunnelServiceName
    } else {
        Write-Log "Public exec service health FAILED (local was also down - already restarted above)."
    }
}
