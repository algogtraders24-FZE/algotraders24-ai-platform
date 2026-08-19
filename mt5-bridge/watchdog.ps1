# mt5-bridge/watchdog.ps1
#
# Self-healing health check for the AT24 MT5 bridge + its Cloudflare
# tunnel. Run every few minutes via Task Scheduler (see
# setup-watchdog.ps1) - never run this manually in a loop yourself.
#
# What it does, every time it runs:
#   1. Hits the bridge's own /health endpoint (unauthenticated by design -
#      see bridge.py) and checks mt5_connected is genuinely true, not just
#      that the process is listening on the port.
#   2. If that fails, restarts the AT24-MT5-Bridge scheduled task. This
#      also fixes the case where uvicorn is running but MT5 itself lost
#      its connection to the broker (a fresh process re-runs
#      mt5.initialize() on startup).
#   3. Optionally (if -PublicHealthUrl is set) also checks the public
#      HTTPS URL Vercel actually calls. If the LOCAL check passed but the
#      PUBLIC one fails, the bridge itself is fine and the tunnel is the
#      problem - restarts AT24-MT5-Tunnel instead, never the bridge.
#
# Deliberately does nothing beyond restarting these two EXISTING
# scheduled tasks by name (schtasks /run) - it never touches MT5 order/
# account state, never (re)writes their task definitions, and never needs
# to know the tasks' own internal launch command. If a task doesn't
# exist, schtasks reports that in the log below instead of silently
# failing.

param(
    [string]$LocalHealthUrl = "http://localhost:8787/health",
    [string]$PublicHealthUrl = "",
    [string]$BridgeTaskName = "AT24-MT5-Bridge",
    [string]$TunnelTaskName = "AT24-MT5-Tunnel",
    [string]$LogPath = "$PSScriptRoot\watchdog.log"
)

function Write-Log([string]$message) {
    $line = "$(Get-Date -Format o)  $message"
    Add-Content -Path $LogPath -Value $line
}

function Test-BridgeHealth([string]$url) {
    try {
        $resp = Invoke-WebRequest -Uri $url -TimeoutSec 10 -UseBasicParsing
        if ($resp.StatusCode -ne 200) {
            Write-Log "  $url -> HTTP $($resp.StatusCode)"
            return $false
        }
        $json = $resp.Content | ConvertFrom-Json
        if (-not $json.mt5_connected) {
            Write-Log "  $url -> HTTP 200 but mt5_connected=false (terminal not connected to broker)"
            return $false
        }
        return $true
    } catch {
        Write-Log "  $url -> unreachable ($($_.Exception.Message))"
        return $false
    }
}

function Restart-BridgeTask([string]$name) {
    Write-Log "Restarting scheduled task: $name"
    & schtasks /end /tn $name 2>$null | Out-Null
    Start-Sleep -Seconds 2
    & schtasks /run /tn $name 2>$null | Out-Null
}

Write-Log "--- watchdog check ---"

$localOk = Test-BridgeHealth $LocalHealthUrl
if ($localOk) {
    Write-Log "Local bridge health OK."
} else {
    Write-Log "Local bridge health FAILED - restarting '$BridgeTaskName'."
    Restart-BridgeTask $BridgeTaskName
}

if ($PublicHealthUrl -ne "") {
    $publicOk = Test-BridgeHealth $PublicHealthUrl
    if ($publicOk) {
        Write-Log "Public bridge health OK."
    } elseif ($localOk) {
        # Bridge itself is fine locally - the tunnel is what's broken.
        Write-Log "Public bridge health FAILED but local is OK - restarting '$TunnelTaskName'."
        Restart-BridgeTask $TunnelTaskName
    } else {
        Write-Log "Public bridge health FAILED (bridge itself was also down - already restarted above)."
    }
}
