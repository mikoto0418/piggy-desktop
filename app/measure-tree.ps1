# 测量 piggy-desktop 及其全部 WebView2 子进程的内存/CPU 占用。
# 用法： pwsh -NoProfile -File measure-tree.ps1 [-SampleSeconds 15]
param([int]$SampleSeconds = 0)

$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize
$pig = $all | Where-Object { $_.Name -eq 'piggy-desktop.exe' } | Select-Object -First 1
if (-not $pig) { Write-Output "piggy-desktop 未运行"; exit 1 }

# 构建子孙集合
$mine = @($pig.ProcessId)
$changed = $true
while ($changed) {
    $changed = $false
    foreach ($p in $all) {
        if (($mine -contains $p.ParentProcessId) -and ($mine -notcontains $p.ProcessId)) {
            $mine += $p.ProcessId; $changed = $true
        }
    }
}

$tree = $all | Where-Object { $mine -contains $_.ProcessId }
$wsSum = ($tree | Measure-Object WorkingSetSize -Sum).Sum
$privSum = 0
foreach ($t in $tree) {
    $pr = Get-Process -Id $t.ProcessId -ErrorAction SilentlyContinue
    if ($pr) { $privSum += $pr.PrivateMemorySize64 }
}

Write-Output ("进程数           : {0}" -f $tree.Count)
$tree | Sort-Object Name | ForEach-Object {
    Write-Output ("  {0,-22} pid={1,-7} ws={2,7:N1} MB" -f $_.Name, $_.ProcessId, ($_.WorkingSetSize/1MB))
}
Write-Output ("WorkingSet 合计  : {0:N1} MB   (含跨进程共享页，会高估)" -f ($wsSum/1MB))
Write-Output ("Private 合计     : {0:N1} MB   (真实独占，这才是要看的数)" -f ($privSum/1MB))

if ($SampleSeconds -gt 0) {
    $p = Get-Process -Id $pig.ProcessId
    $c0 = 0.0; foreach ($id in $mine) { $q = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($q) { $c0 += $q.TotalProcessorTime.TotalSeconds } }
    $t0 = Get-Date
    Start-Sleep -Seconds $SampleSeconds
    $c1 = 0.0; foreach ($id in $mine) { $q = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($q) { $c1 += $q.TotalProcessorTime.TotalSeconds } }
    $el = ((Get-Date) - $t0).TotalSeconds
    Write-Output ("空闲 CPU 单核占比: {0:N3} %   (采样 {1}s，全树合计)" -f ((($c1-$c0)/$el)*100), $el)
}
