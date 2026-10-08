# quant-engine/service/setup-report-check-worker.ps1
#
# ONE-TIME setup on the VPS: registers the seller report-check worker (report_check_worker.py) as a Windows scheduled
# task that starts at boot, runs forever, and restarts itself if it ever exits. The worker only makes OUTBOUND HTTPS calls
# to the AT24 site - no port is opened and no tunnel is needed.
#
# Run ONCE from an elevated (Administrator) PowerShell, from inside this quant-engine\service folder:
#
#   .\setup-report-check-worker.ps1 -Secret "<the same value as REPORT_CHECK_WORKER_SECRET on Vercel>"
#
# Optional: -PythonExe "C:\AT24\quant-lite\venv\Scripts\python.exe" (default: python on PATH), -M2Dir "<folder with evidence_engine.py>"
# (default: ..\..\ea-research\marketplace-research\m2-evidence-engine relative to this folder).
# Safe to re-run: it replaces the task and the machine-level secret.

param(
    [Parameter(Mandatory = $true)][string]$Secret,
    [string]$PythonExe = "python",
    [string]$M2Dir = ""
)

if ($Secret.Length -lt 16) { Write-Error "The secret must be at least 16 characters."; exit 1 }
$worker = Join-Path $PSScriptRoot "report_check_worker.py"
if (-not (Test-Path $worker)) { Write-Error "report_check_worker.py not found next to this script."; exit 1 }

if ($M2Dir -eq "") { $M2Dir = (Join-Path $PSScriptRoot "..\..\ea-research\marketplace-research\m2-evidence-engine") }
$M2Dir = [System.IO.Path]::GetFullPath($M2Dir)
if (-not (Test-Path (Join-Path $M2Dir "evidence_engine.py"))) {
    Write-Error "evidence_engine.py not found in $M2Dir - pass -M2Dir with the folder that contains it."
    exit 1
}

# Machine-level environment (the SYSTEM account reads these). The secret never goes into the task definition itself.
[Environment]::SetEnvironmentVariable("REPORT_CHECK_WORKER_SECRET", $Secret, "Machine")
[Environment]::SetEnvironmentVariable("REPORT_CHECK_M2_DIR", $M2Dir, "Machine")

$taskName = "AT24-ReportCheck-Worker"
$action = New-ScheduledTaskAction -Execute $PythonExe -Argument "-I `"$worker`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -User "SYSTEM" -RunLevel Highest -Description "AT24 seller report check worker (outbound polling)" | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host "Registered and started '$taskName'. It polls the AT24 site every 20 seconds."
Write-Host "Check: Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo"
