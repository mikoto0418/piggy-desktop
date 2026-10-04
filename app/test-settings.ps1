# 设置界面端到端探针（P2-5）。
#
# 验证的是**写入路径**：在设置窗口里真的点一下开关 → Rust 的 `set_config`
# 合并/夹紧/落盘 → 桌宠行为跟着变。
#
# 为什么用「截图找色块」而不是硬编码坐标：
# 布局随字体和 DPI 变，写死坐标的测试过两天就会假失败。
# 开关的底色 `#3a3a43` 来自 settings.css，按颜色聚类定位是稳定的。
#
# 用法：pwsh -NoProfile -File test-settings.ps1 [-LeaveOn]
#   -LeaveOn  打开「悬停让位」后**不点回去**，方便接着跑 test-hover-through.ps1
#             验证「设置界面改的东西真的作用到桌宠行为上」。
param([switch]$LeaveOn)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public static class SProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  /// 进程里面积最大的 "Tauri Window" —— 桌宠窗口只有 120px，设置窗口一定更大。
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
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);   // LEFTDOWN
    System.Threading.Thread.Sleep(40);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);   // LEFTUP
    return true;
  }

  /// 把窗口顶到最前。
  ///
  /// ⚠️ 只靠 `SetForegroundWindow` **不够** —— 别的程序持有前台焦点时
  /// Windows 会直接拒绝，于是截图截到的是**压在设置窗口上的那个程序**，
  /// 按坐标点击也会打到别人身上。实测就撞到过：截图里全是游戏的深蓝色。
  /// 用 `HWND_TOPMOST` 强制置顶才可靠（`SWP_NOACTIVATE` 保证不抢焦点）。
  public static void BringToFront(IntPtr h) {
    ShowWindow(h, 9);                                   // SW_RESTORE
    SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0,          // HWND_TOPMOST
      0x0001 | 0x0002 | 0x0040 | 0x0010);                // NOSIZE|NOMOVE|SHOWWINDOW|NOACTIVATE
    SetForegroundWindow(h);
  }

  public static void DropTopmost(IntPtr h) {
    SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0,          // HWND_NOTOPMOST
      0x0001 | 0x0002 | 0x0040 | 0x0010);
  }
}
'@
[void][SProbe]::SetProcessDPIAware()

$dataDir = "$env:APPDATA\com.piggy.desktop"
$cfgPath = Join-Path $dataDir "config.json"

$proc = Get-Process piggy-desktop -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output "RESULT: NO_PROCESS"; exit 2 }

$h = [SProbe]::BiggestTauri([uint32]$proc.Id)
if ($h -eq [IntPtr]::Zero) { Write-Output "RESULT: NO_SETTINGS_WINDOW"; exit 2 }

[void][SProbe]::BringToFront($h)
Start-Sleep -Milliseconds 1200

$r = [SProbe]::Rect($h)
Write-Output "settings win  : $($r[2])x$($r[3]) at $($r[0]),$($r[1])"

# --- 截图 -------------------------------------------------------------------
$bmp = New-Object System.Drawing.Bitmap $r[2], $r[3]
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r[0], $r[1], 0, 0, (New-Object System.Drawing.Size $r[2], $r[3]))
$shot = "$env:TEMP\piggy-settings-probe.png"
$bmp.Save($shot, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()

# --- 按颜色找开关（#3a3a43 = 未选中的开关底色）------------------------------
#
# ⚠️ 容差必须**很小**（2）。行边框 `#35353d` 和开关底色 `#3a3a43` 只差 (5,5,6)，
# 容差开到 6 就会把每条 1px 的横边框也当成开关，聚类出一堆假候选。
$target = @(0x3a, 0x3a, 0x43)
$tol = 2
$rows = @{}
for ($y = 0; $y -lt $r[3]; $y++) {
    $xs = New-Object System.Collections.ArrayList
    for ($x = 0; $x -lt $r[2]; $x++) {
        $p = $bmp.GetPixel($x, $y)
        if ([Math]::Abs($p.R - $target[0]) -le $tol -and
            [Math]::Abs($p.G - $target[1]) -le $tol -and
            [Math]::Abs($p.B - $target[2]) -le $tol) {
            [void]$xs.Add($x)
        }
    }
    # 一行至少 15 个匹配像素才算（开关那 36 行每行约 40 个）
    if ($xs.Count -ge 15) { $rows[$y] = $xs }
}
$bmp.Dispose()

# 行聚类：y 方向间隔 > 20px 认为是不同的开关
$ys = $rows.Keys | Sort-Object
$clusters = @()
$cur = $null
foreach ($y in $ys) {
    if ($cur -eq $null -or ($y - $cur.maxY) -gt 20) {
        if ($cur -ne $null) { $clusters += $cur }
        $cur = [pscustomobject]@{ minY = $y; maxY = $y; xs = New-Object System.Collections.ArrayList }
    }
    $cur.maxY = $y
    foreach ($x in $rows[$y]) { [void]$cur.xs.Add($x) }
}
if ($cur -ne $null) { $clusters += $cur }

Write-Output "开关候选      : $($clusters.Count) 个（按 y 排序）"

# 只保留宽度在 40~120 物理像素之间的（真正的开关），排除细线
$boxes = @()
foreach ($c in $clusters) {
    $xs = $c.xs | Sort-Object
    $w = ($xs[-1] - $xs[0])
    $hgt = $c.maxY - $c.minY
    if ($w -ge 40 -and $w -le 140 -and $hgt -ge 15 -and $hgt -le 60) {
        $boxes += [pscustomobject]@{
            cx = [int](($xs[0] + $xs[-1]) / 2)
            cy = [int](($c.minY + $c.maxY) / 2)
            w  = $w
            h  = $hgt
        }
    }
}
$boxes = $boxes | Sort-Object cy
Write-Output "识别到开关    : $($boxes.Count) 个"
foreach ($b in $boxes) { Write-Output ("  中心 ({0},{1})  {2}x{3}" -f $b.cx, $b.cy, $b.w, $b.h) }

if ($boxes.Count -lt 2) { Write-Output "RESULT: FAIL 没能定位到 2 个开关"; exit 1 }

# 第 2 个开关 = 「悬停让位」（第 1 个是「默认穿透」）
$sw = $boxes[1]
$clickX = $r[0] + $sw.cx
$clickY = $r[1] + $sw.cy
Write-Output "目标          : 第 2 个开关（悬停让位）屏幕坐标 $clickX,$clickY"

$before = (Get-Content $cfgPath -Raw | ConvertFrom-Json).overlay.hoverThrough
Write-Output "点击前        : hoverThrough = $before"

if (-not [SProbe]::Click($clickX, $clickY)) {
    Write-Output "RESULT: FAIL SetCursorPos 失败（可能有全屏程序 ClipCursor 锁住光标）"
    exit 1
}
Start-Sleep -Milliseconds 1500

$after = (Get-Content $cfgPath -Raw | ConvertFrom-Json).overlay.hoverThrough
Write-Output "点击后        : hoverThrough = $after"

$fail = @()
if ($after -eq $before) { $fail += "点开关后配置没变（$before -> $after）" }

# 再点回去，确认是双向的
if (-not $LeaveOn) {
    if (-not [SProbe]::Click($clickX, $clickY)) { $fail += "第二次点击失败" }
    Start-Sleep -Milliseconds 1500
    $back = (Get-Content $cfgPath -Raw | ConvertFrom-Json).overlay.hoverThrough
    Write-Output "再点一次      : hoverThrough = $back"
    if ($back -ne $before) { $fail += "再点一次没回到原值（期望 $before，实际 $back）" }
} else {
    Write-Output "再点一次      : 跳过（-LeaveOn，保持 hoverThrough = $after）"
}

# 收尾：把窗口的置顶去掉，别一直压在用户其他窗口上面
[void][SProbe]::DropTopmost($h)

Write-Output ""
if ($fail.Count -eq 0) {
    Write-Output "RESULT: PASS  (设置界面写入路径通畅：点击 -> set_config -> 落盘 -> 双向可逆)"
    exit 0
} else {
    Write-Output "RESULT: FAIL"
    foreach ($f in $fail) { Write-Output "  - $f" }
    exit 1
}
