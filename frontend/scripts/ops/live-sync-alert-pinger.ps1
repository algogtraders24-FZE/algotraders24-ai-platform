# AT24 Live Sync - alert timer (for the VPS).
# Calls the sweep endpoint so the "Live Sync stopped reporting" alert can fire even when no data arrives.
# The endpoint returns only two counters and needs the shared CRON_SECRET (the same value that is set in Vercel).
#
# One-time setup on the VPS (PowerShell as Administrator):
#   1) Store the secret on the machine (not in the task, so it is not visible in the task list):
#        [Environment]::SetEnvironmentVariable("AT24_CRON_SECRET", "<the CRON_SECRET value>", "Machine")
#   2) Register the task (runs every 5 minutes, even when nobody is logged in):
#        .\live-sync-alert-pinger.ps1 -Install
#   3) Test once:
#        .\live-sync-alert-pinger.ps1
#      Expected: {"ok":true,"checked":N,"fired":M}
#   Remove:  Unregister-ScheduledTask -TaskName "AT24 Live Sync Alert Timer" -Confirm:$false

param(
  [switch]$Install,
  [string]$Url = "https://www.algotraders24.ai/api/live-sync/v1/sweep"
)

if ($Install) {
  $script = $MyInvocation.MyCommand.Path
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Limited
  Register-ScheduledTask -TaskName "AT24 Live Sync Alert Timer" -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Write-Output "Registered 'AT24 Live Sync Alert Timer' (every 5 minutes)."
  return
}

$secret = [Environment]::GetEnvironmentVariable("AT24_CRON_SECRET", "Machine")
if (-not $secret) { $secret = $env:AT24_CRON_SECRET }
if (-not $secret) { Write-Error "AT24_CRON_SECRET is not set."; exit 1 }

try {
  $r = Invoke-RestMethod -Method Post -Uri $Url -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 25
  Write-Output ($r | ConvertTo-Json -Compress)
} catch {
  Write-Error ("Sweep call failed: " + $_.Exception.Message)
  exit 1
}
