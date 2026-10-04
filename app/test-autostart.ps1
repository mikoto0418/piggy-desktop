# 开机自启探针（P2-5 / #73）。
#
# 验证的是：在设置界面点「开机自启」→ 插件真的写了
# `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` → 再点一次真的删掉。
#
# 为什么不直接读配置：配置里写 `launchAtLogin: true` 只说明**我们以为**设上了。
# 用户可能在「任务管理器 → 启动」里自己关掉，那时配置还是 true。
# 所以这里查的是**注册表**，也就是系统的真实状态。
#
# 用法：pwsh -NoProfile -File test-autostart.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
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

  public static void Resize(IntPtr h, int x, int y, int w, int hh) {
    ShowWindow(h, 9);
    SetWindowPos(h, new IntPtr(-1), x, y, w, hh, 0x0040 | 0x0010);  // TOPMOST|SHOWWINDOW|NOACTIVATE
    SetForegroundWindow(h);
  }

  public static void DropTopmost(IntPtr h) {
    SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040 | 0x0010);
  }

  public static bool Click(int x, int y) {
    if (!SetCursorPos(x, y)) return false;
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    return true;
  }

  /// 滚轮。delta 为负 = 向下滚。
  public static void Wheel(int delta) {
    mouse_event(0x0800, 0, 0, unchecked((uint)delta), IntPtr.Zero);
  }
}
'@
[void][AProbe]::SetProcessDPIAware()

# ---------------------------------------------------------------- 截图分析

$HEADING = @(0xFF, 0x9F, 0xA5)   # section h2 的颜色
$SWITCH  = @(0x3A, 0x3A, 0x43)   # 未选中开关的底色

function Test-Near($p, $t, $tol) {
    return ([Math]::Abs($p.R - $t[0]) -le $tol -and
            [Math]::Abs($p.G - $t[1]) -le $tol -and
            [Math]::Abs($p.B - $t[2]) -le $tol)
}

# 把「每行匹配数 >= 门槛」的 y 按间隔聚成段，返回 @{top;bottom;xs}
function Group-Rows($bmp, $target, $tol, $minPerRow, $gap) {
    $w = $bmp.Width; $h = $bmp.Height
    $rows = @{}
    for ($y = 0; $y -lt $h; $y++) {
        $xs = New-Object System.Collections.ArrayList
        for ($x = 0; $x -lt $w; $x++) {
            if (Test-Near $bmp.GetPixel($x, $y) $target $tol) { [void]$xs.Add($x) }
        }
        if ($xs.Count -ge $minPerRow) { $rows[$y] = $xs }
    }
    $out = @()
    $cur = $null
    foreach ($y in ($rows.Keys | Sort-Object)) {
        if ($cur -eq $null -or ($y - $cur.bottom) -gt $gap) {
            if ($cur -ne $null) { $out += $cur }
            $cur = [pscustomobject]@{ top = $y; bottom = $y; xs = New-Object System.Collections.ArrayList }
        }
        $cur.bottom = $y
        foreach ($x in $rows[$y]) { [void]$cur.xs.Add($x) }
    }
    if ($cur -ne $null) { $out += $cur }
    return $out
}

function Get-Switches($bmp) {
    $res = @()
    # 容差必须小：行边框 #35353d 与开关底色只差 (5,5,6)，容差大了会把边框也当成开关
    foreach ($c in (Group-Rows $bmp $SWITCH 2 15 15)) {
        $xs = $c.xs | Sort-Object
        $w = $xs[-1] - $xs[0]
        $hgt = $c.bottom - $c.top
        if ($w -ge 40 -and $w -le 140 -and $hgt -ge 15 -and $hgt -le 60) {
            $res += [pscustomobject]@{
                cx = [int](($xs[0] + $xs[-1]) / 2)
                cy = [int](($c.top + $c.bottom) / 2)
            }
        }
    }
    return ($res | Sort-Object cy)
}

function Get-Headings($bmp) {
    $res = @()
    foreach ($c in (Group-Rows $bmp $HEADING 14 3 15)) {
        $res += [pscustomobject]@{ top = $c.top; bottom = $c.bottom }
    }
    return ($res | Sort-Object top)
}

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

function Get-PiggyRun {
    $p = Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue
    if (-not $p) { return $null }
    $hit = $p.PSObject.Properties | Where-Object { $_.Value -like '*piggy*' } | Select-Object -First 1
    if ($hit) { return "$($hit.Name) = $($hit.Value)" }
    return $null
}

$proc = Get-Process piggy-desktop -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output "RESULT: NO_PROCESS"; exit 2 }

$h = [AProbe]::BiggestTauri([uint32]$proc.Id)
if ($h -eq [IntPtr]::Zero) { Write-Output "RESULT: NO_SETTINGS_WINDOW"; exit 2 }

# 拉高到能放下更多内容，然后滚到「系统」分组。
# 全部内容约 1200 逻辑像素高，屏幕放不下，只能滚。
[AProbe]::Resize($h, 40, 20, 900, 1500)
Start-Sleep -Milliseconds 1400

# 光标挪到内容区中间再滚轮（滚轮事件发给光标下的窗口）
$r0 = [AProbe]::Rect($h)
[void][AProbe]::SetCursorPos(($r0[0] + [int]($r0[2] / 2)), ($r0[1] + [int]($r0[3] / 2)))
Start-Sleep -Milliseconds 300
[AProbe]::Wheel(-1200)
Start-Sleep -Milliseconds 1200

$r = [AProbe]::Rect($h)
Write-Output "settings win  : $($r[2])x$($r[3]) at $($r[0]),$($r[1])"

$shot = "$env:TEMP\piggy-autostart-probe.png"
$bmp = New-Object System.Drawing.Bitmap $r[2], $r[3]
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r[0], $r[1], 0, 0, (New-Object System.Drawing.Size $r[2], $r[3]))
$bmp.Save($shot, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()

$headings = Get-Headings $bmp
$switches = Get-Switches $bmp
Write-Output "分组标题      : $($headings.Count) 个  ->  y = $(($headings | ForEach-Object { $_.top }) -join ', ')"
Write-Output "识别到开关    : $($switches.Count) 个  ->  y = $(($switches | ForEach-Object { $_.cy }) -join ', ')"

if ($headings.Count -lt 2) {
    Write-Output "RESULT: FAIL 只看到 $($headings.Count) 个分组标题，无法定位「系统」分组"
    $bmp.Dispose(); [void][AProbe]::DropTopmost($h); exit 1
}

# 「开机自启」= 位于**最后一个分组标题之上、倒数第二个标题之下**的那个开关。
# 按标题定位而不是按序号，这样不管滚到哪里都对。
$hLast = $headings[-1]      # 「诊断」
$hPrev = $headings[-2]      # 「系统」
$cand = $switches | Where-Object { $_.cy -gt $hPrev.bottom -and $_.cy -lt $hLast.top }
if ($cand.Count -lt 1) {
    Write-Output "RESULT: FAIL 「$($hPrev.top)-$($hLast.top)」之间没找到开关"
    $bmp.Dispose(); [void][AProbe]::DropTopmost($h); exit 1
}
$bmp.Dispose()

$sw = $cand[0]
$cx = $r[0] + $sw.cx
$cy = $r[1] + $sw.cy
Write-Output "目标          : 「系统」分组第一个开关（开机自启）屏幕坐标 $cx,$cy"

$before = Get-PiggyRun
Write-Output "注册表(前)    : $(if ($before) { $before } else { '（无 piggy 项）' })"

$fail = @()
if (-not [AProbe]::Click($cx, $cy)) {
    Write-Output "RESULT: FAIL SetCursorPos 失败"
    [void][AProbe]::DropTopmost($h)
    exit 1
}
Start-Sleep -Milliseconds 1800

$after = Get-PiggyRun
Write-Output "注册表(后)    : $(if ($after) { $after } else { '（无 piggy 项）' })"
if (-not $after) { $fail += "点了开机自启，但注册表里没出现 piggy 项" }
if ($after -eq $before) { $fail += "注册表没有变化" }

# 再点一次，确认能关掉
[void][AProbe]::Click($cx, $cy)
Start-Sleep -Milliseconds 1800
$back = Get-PiggyRun
Write-Output "再点一次      : $(if ($back) { $back } else { '（无 piggy 项）' })"
if ($back -ne $before) { $fail += "再点一次没有恢复原状" }

[void][AProbe]::DropTopmost($h)

Write-Output ""
if ($fail.Count -eq 0) {
    Write-Output "RESULT: PASS  (开机自启写入/删除注册表成功，且与系统真实状态一致)"
    exit 0
} else {
    Write-Output "RESULT: FAIL"
    foreach ($f in $fail) { Write-Output "  - $f" }
    exit 1
}
