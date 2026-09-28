# quant-engine/service/setup-watchdog.ps1
#
# ONE-TIME setup: registers watchdog.ps1 to run automatically every 5
# minutes, forever - including right after a VPS reboot, even if nobody
# ever logs in. Same self-healing pattern as
# mt5-bridge/setup-watchdog.ps1, applied to the Quant Lite remote
# execution service.
#
# Run this ONCE from an elevated (Administrator) PowerShell window, on
# the VPS, from inside this quant-engine/service folder:
#
#   .\setup-watchdog.ps1 -PublicHealthUrl "https://quant-lite-exec.algotraders24.ai/health"
#
# Pass your real public exec-service URL (the same one Vercel's
# QUANT_LITE_EXEC_SERVICE_URL points at, plus /health) so the watchdog
# can tell a dead TUNNEL apart from a dead EXEC SERVICE and restart only
# the one that's actually broken. If omitted, the watchdog only checks
# the local service, not the tunnel.
#
# Safe to re-run - unregisters and re-registers cleanly each time, never
# duplicates the task.

param(
    [string]$PublicHealthUrl = ""
)

$taskName = "AT24-QuantLite-Watchdog"
$scriptPath = Join-Path $PSScriptRoot "watchdog.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Error "watchdog.ps1 not found next to this script at $scriptPath - copy both files together."
    exit 1
}

$argumentList = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
if ($PublicHealthUrl -ne "") {
    $argumentList += " -PublicHealthUrl `"$PublicHealthUrl`""
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentList

# Two triggers: fire once immediately on every boot (so a rebooted VPS
# self-heals within the first cycle, not after waiting up to 5 minutes),
# AND repeat every 5 minutes indefinitely from then on.
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
# Task Scheduler's XML schema cannot represent [TimeSpan]::MaxValue (it
# overflows the duration field). 10 years is not literally infinite, but
# it is effectively forever for this purpose, and it's a value the
# schema can serialize - same value mt5-bridge's own setup script uses.
$repeatingTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# SYSTEM account, not a user account: runs with no login required and
# never expires/locks out the way a saved user password can. Also the
# same account the exec-service task itself runs as, so this watchdog
# can stop/start it without a separate permission grant.
try {
    Register-ScheduledTask -TaskName $taskName `
        -Action $action `
        -Trigger @($startupTrigger, $repeatingTrigger) `
        -Settings $settings `
        -User "SYSTEM" `
        -RunLevel Highest `
        -Force `
        -ErrorAction Stop | Out-Null
} catch {
    Write-Error "Failed to register '$taskName': $($_.Exception.Message)"
    exit 1
}

Write-Host "Registered '$taskName': runs at every VPS startup and every 5 minutes after, as SYSTEM."
Write-Host "Log file: $PSScriptRoot\watchdog.log"
Write-Host ""
Write-Host "Test it right now with:"
Write-Host "  schtasks /run /tn `"$taskName`""
Write-Host "  Get-Content `"$PSScriptRoot\watchdog.log`" -Tail 10"
