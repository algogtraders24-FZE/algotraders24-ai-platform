$W='E:\algotraders24-ai-platform\ea-research\lab\FreeIndicators\AT24_PropGuardian_Wrap_v1'
$ed='C:\Program Files\MetaTrader 5\metaeditor64.exe'
& $ed "/compile:$W\AT24_PropGuardian_Licensed.mq5" "/log:$W\ea.log" | Out-Null; Start-Sleep 5
"EA: " + ((Get-Content "$W\ea.log" -Encoding Unicode | Select-String 'error|warning|Result') -join ' | ')
