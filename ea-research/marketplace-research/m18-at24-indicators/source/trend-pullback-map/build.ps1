$W='E:\algotraders24-ai-platform\ea-research\lab\FreeIndicators\AT24_TrendPullback_Wrap_v1'
$T='C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5\Indicators\AT24Lab\TrendPullback'
$ed='C:\Program Files\MetaTrader 5\metaeditor64.exe'
& $ed "/compile:$T\AT24_Trend_Pullback_Map.mq5" "/log:$W\ind.log" | Out-Null; Start-Sleep 5
"indicator: " + ((Get-Content "$W\ind.log" -Encoding Unicode | Select-String 'error|warning|Result') -join ' | ')
& $ed "/compile:$W\AT24_TrendPullback_Licensed.mq5" "/log:$W\ea.log" | Out-Null; Start-Sleep 5
"wrapper: " + ((Get-Content "$W\ea.log" -Encoding Unicode | Select-String 'error|warning|Result') -join ' | ')
