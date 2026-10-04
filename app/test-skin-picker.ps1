# P2-1 皮肤选择器端到端探针。
#
# 验的是**整条链路**，而且每一步都必须真的发生：
#   设置窗口里点一下皮肤卡片
#     → `emit("piggy://select-skin")`
#     → 桌宠窗口 `setSkin()` 改内存存档
#     → `applySkin()` 重着色 SVG 并换 `img.src`
#     → `broadcastSkin()` 回播，设置窗口高亮跟着变
#     → 防抖落盘，`pet.json` 里 skin 变了
#
# 为什么按**色块颜色**定位卡片，而不是写死坐标：
# 布局随字体和 DPI 变，而且卡片在折叠区域下方、需要滚动才能看到。
# 卡片上的色块用的就是调色板里真的会画上去的那几个色（`#C9F0DC` = 薄荷猪身体），
# 这几个色在设置窗口里是唯一的，按颜色找既稳又能顺便证明「预览色是真的」。
#
# 用法：  pwsh -NoProfile -File app\test-skin-picker.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SkProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static IntPtr BiggestTauri(uint pid) {
    IntPtr best = IntPtr.Zero; long bestArea = 0;
    EnumWindows((h,l)=>{
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid) {
        var c = new StringBuilder(128); GetClassNameW(h, c, 128);
        if (c.ToString() == "Tauri Window") {
          RECT r; GetWindowRect(h, out r);
          long a = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
          if (a > bestArea) { bestArea = a; best = h; }
        }
      }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  public static int[] Rect(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
  }

  public static bool Click(int x, int y) {
    if (!SetCursorPos(x, y)) return false;
    System.Threading.Thread.Sleep(80);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(50);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    return true;
  }

  public static void Wheel(int notches) {
    mouse_event(0x0800, 0, 0, (uint)(notches * 120), IntPtr.Zero);
  }

  public static void BringToFront(IntPtr h) {
    ShowWindow(h, 9);
    SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040 | 0x0010);
    SetForegroundWindow(h);
  }
  public static void DropTopmost(IntPtr h) {
    SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040 | 0x0010);
  }
}
'@
[void][SkProbe]::SetProcessDPIAware()

$AppDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Exe     = Join-Path $AppDir 'src-tauri\target\release\piggy-desktop.exe'
$DataDir = Join-Path $env:APPDATA 'com.piggy.desktop'
$PetJson = Join-Path $DataDir 'pet.json'
$LogPath = Join-Path $DataDir 'piggy.log'

$fail = @()

function Get-Skin {
    if (-not (Test-Path -LiteralPath $PetJson)) { return '<无存档>' }
    return (Get-Content -LiteralPath $PetJson -Raw | ConvertFrom-Json).skin
}

function Find-Color($bmp, $w, $h, $rgb, $tol = 1) {
    # 按 y 聚类，取**像素最多的那一簇**，返回它的包围盒中心。
    #
    # 为什么不能直接对所有匹配像素求包围盒：
    # 设置窗口的**标题栏图标就是这只猪**，它也带 `#FFD1AF`。
    # 把标题栏那 43 px 和下面真正的色块 693 px 混在一个包围盒里，
    # 中心会落到两者中间的空地上 —— 点下去什么都没发生，看起来像功能坏了。
    # 实测就是这么翻车的：报出来的「默认色块」在 (56,390)，那是一片空白。
    $rows = @{}
    for ($y = 0; $y -lt $h; $y++) {
        $xs = @()
        for ($x = 0; $x -lt $w; $x++) {
            $p = $bmp.GetPixel($x, $y)
            if ([Math]::Abs($p.R - $rgb[0]) -le $tol -and
                [Math]::Abs($p.G - $rgb[1]) -le $tol -and
                [Math]::Abs($p.B - $rgb[2]) -le $tol) { $xs += $x }
        }
        if ($xs.Count -gt 0) { $rows[$y] = $xs }
    }
    if ($rows.Count -eq 0) { return $null }

    $ys = $rows.Keys | Sort-Object
    $clusters = @(); $cur = $null
    foreach ($y in $ys) {
        if ($cur -eq $null -or ($y - $cur.maxY) -gt 5) {
            if ($cur -ne $null) { $clusters += $cur }
            $cur = [pscustomobject]@{ minY = $y; maxY = $y; n = 0; minX = $w; maxX = -1 }
        }
        $cur.maxY = $y
        foreach ($x in $rows[$y]) {
            $cur.n++
            if ($x -lt $cur.minX) { $cur.minX = $x }
            if ($x -gt $cur.maxX) { $cur.maxX = $x }
        }
    }
    if ($cur -ne $null) { $clusters += $cur }

    $best = $clusters | Sort-Object n -Descending | Select-Object -First 1
    if ($best.n -lt 20) { return $null }
    return [pscustomobject]@{
        x = [int](($best.minX + $best.maxX) / 2)
        y = [int](($best.minY + $best.maxY) / 2)
        count = $best.n
        box = "$($best.minX),$($best.minY)-$($best.maxX),$($best.maxY)"
    }
}

# ---- 1. 确保桌宠在跑，并且设置窗口开着 ----
$proc = Get-Process piggy-desktop -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    Write-Output '启动桌宠（--settings）…'
    Start-Process $Exe -ArgumentList '--settings'
    Start-Sleep -Seconds 7
} else {
    # 单实例：再启动一次带 --settings 会转发给已有实例去开设置窗口
    Start-Process $Exe -ArgumentList '--settings'
    Start-Sleep -Seconds 4
}
$proc = Get-Process piggy-desktop -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output 'RESULT: FAIL 桌宠没起来'; exit 1 }

$h = [SkProbe]::BiggestTauri([uint32]$proc.Id)
if ($h -eq [IntPtr]::Zero) { Write-Output 'RESULT: FAIL 没找到设置窗口'; exit 1 }
[void][SkProbe]::BringToFront($h)
Start-Sleep -Milliseconds 1500

$r = [SkProbe]::Rect($h)
Write-Output "设置窗口      : $($r[2])x$($r[3]) at $($r[0]),$($r[1])"

# 光标挪到设置窗口里，滚轮才有作用
[void][SkProbe]::SetCursorPos($r[0] + [int]($r[2] / 2), $r[1] + [int]($r[3] / 2))
Start-Sleep -Milliseconds 300

# ---- 2. 滚到「皮肤」区，按色块定位薄荷猪卡片 ----
$MINT  = @(0xC9, 0xF0, 0xDC)   # 薄荷猪 body
$BASE  = @(0xFF, 0xD1, 0xAF)   # 默认猪 body
$mintHit = $null; $baseHit = $null

for ($step = 0; $step -lt 14; $step++) {
    $bmp = New-Object System.Drawing.Bitmap $r[2], $r[3]
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r[0], $r[1], 0, 0, (New-Object System.Drawing.Size $r[2], $r[3]))
    $g.Dispose()
    $mintHit = Find-Color $bmp $r[2] $r[3] $MINT
    $baseHit = Find-Color $bmp $r[2] $r[3] $BASE
    if ($step -eq 0) {
        $shot0 = Join-Path $env:TEMP 'piggy-skin-picker-0.png'
        $bmp.Save($shot0, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $bmp.Dispose()
    if ($mintHit -ne $null -and $baseHit -ne $null) { break }
    [SkProbe]::Wheel(-3)
    Start-Sleep -Milliseconds 350
}

if ($mintHit -eq $null) {
    Write-Output 'RESULT: FAIL 设置窗口里找不到薄荷猪的色块（皮肤选择器没渲染出来？）'
    [void][SkProbe]::DropTopmost($h)
    exit 1
}
Write-Output "薄荷色块      : 窗口内 ($($mintHit.x),$($mintHit.y))  $($mintHit.count) px  →  说明预览用的是真调色板"
if ($baseHit -ne $null) {
    Write-Output "默认色块      : 窗口内 ($($baseHit.x),$($baseHit.y))  $($baseHit.count) px"
} else {
    Write-Output '默认色块      : 不在当前视野里（后面不点它，改用写回存档还原）'
}

# ---- 3. 点薄荷猪 ----
$before = Get-Skin
Write-Output "点击前 skin   : $before"

$clickX = $r[0] + $mintHit.x
$clickY = $r[1] + $mintHit.y

function Get-LogTail {
    if (Test-Path $LogPath) { return (Get-Content $LogPath -Raw) } else { return '' }
}

# 点一下不一定成：别的置顶窗口（桌宠自己就是置顶的）可能刚好压在目标点上，
# 或者 WebView2 还没准备好接收输入。所以「点 → 看日志有没有落地 → 再点」，
# 而不是点一次就断言。
$clicked = $false
for ($try = 1; $try -le 3; $try++) {
    [void][SkProbe]::BringToFront($h)
    Start-Sleep -Milliseconds 400
    if (-not [SkProbe]::Click($clickX, $clickY)) {
        Write-Output 'RESULT: FAIL SetCursorPos 失败'
        [void][SkProbe]::DropTopmost($h)
        exit 1
    }
    Start-Sleep -Milliseconds 1500
    if ((Get-LogTail) -match '点击皮肤卡片 key=mint') { $clicked = $true; break }
    Write-Output "  （第 $try 次点击没落地，重试）"
}
Write-Output "点击落地      : $(if ($clicked) { '✓ 设置窗口收到了点击' } else { '✗ 点了 3 次都没落地' })"

Start-Sleep -Milliseconds 2500
$after = Get-Skin
Write-Output "点击后 skin   : $after"

$log = Get-LogTail
$applied = $log -match '皮肤 -> #C9F0DC'
Write-Output "桌宠重着色    : $(if ($applied) { '✓ 日志里有「皮肤 -> #C9F0DC,…」' } else { '✗ 日志里没有重着色记录' })"

if (-not $clicked) { $fail += '设置窗口的皮肤卡片点不动（点击没落到卡片上）' }
if ($after -ne 'mint') { $fail += "点了薄荷猪但存档里 skin 是 $after" }
if (-not $applied) { $fail += '桌宠窗口没有真的重着色（applySkin 没跑）' }

# ---- 4. 点回默认猪 ----
if ($baseHit -ne $null) {
    $backClicked = $false
    for ($try = 1; $try -le 3; $try++) {
        [void][SkProbe]::BringToFront($h)
        Start-Sleep -Milliseconds 400
        if (-not [SkProbe]::Click($r[0] + $baseHit.x, $r[1] + $baseHit.y)) { break }
        Start-Sleep -Milliseconds 1500
        if ((Get-LogTail) -match '点击皮肤卡片 key=default') { $backClicked = $true; break }
    }
    Start-Sleep -Milliseconds 2500
    $back = Get-Skin
    Write-Output "点回默认 skin : $back"
    if ($backClicked -and $back -ne 'default') { $fail += "点默认猪没回到 default（实际 $back）" }
    if (-not $backClicked) { $fail += '默认猪卡片点不动' }
} else {
    Write-Output '点回默认      : 跳过（默认卡片不在视野里）'
}

# 收尾：去置顶；皮肤没还原就用**改存档 + 重启**的方式还原
# （不能只改文件 —— 存档在运行中的桌宠内存里，下一次防抖存盘会把文件覆盖回去）
[void][SkProbe]::DropTopmost($h)
if ((Get-Skin) -ne 'default') {
    Write-Output '（收尾：关掉桌宠、把 skin 写回 default、再启动）'
    Get-Process piggy-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 800
    $s = Get-Content -LiteralPath $PetJson -Raw | ConvertFrom-Json
    $s.skin = 'default'
    $s | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $PetJson -Encoding UTF8
    Start-Sleep -Milliseconds 300
}

Write-Output ''
if ($fail.Count -eq 0) {
    Write-Output 'RESULT: PASS  (设置窗口点皮肤 -> 桌宠重着色 -> 回播 -> 落盘，全链路通)'
    exit 0
} else {
    Write-Output 'RESULT: FAIL'
    foreach ($f in $fail) { Write-Output "  - $f" }
    exit 1
}
