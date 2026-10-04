# P0 验收探针：客观检验「不抢焦点」与「整窗穿透」是否真的生效。
#
# 用法：  pwsh -NoProfile -File verify-p0.ps1 [-ProcessName piggy-desktop]
#
# 判据：
#   1) NOACTIVATE 必须为 True        —— 不抢焦点（硬约束 ② 的关键）
#   2) TOOLWINDOW 为 True 且 APPWINDOW 为 False —— 不进任务栏
#   3) TRANSPARENT 与 LAYERED 必须**同时**为 True —— 穿透成对设置
#   4) 穿透开启时 WindowFromPoint(猪中心) 必须**不是**猪的 HWND —— 点击真的落到下层

param([string]$ProcessName = "piggy-desktop")

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class PigProbe {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtrW(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);

    /// 判断 h 是不是 ancestor 本身或其子孙窗口。
    ///
    /// 必须这样判：`WindowFromPoint` 返回的是该点最深的**子窗口**
    /// （Tauri 窗口里是 WebView2 的 `Chrome_RenderWidgetHostHWND`），
    /// 所以不能拿它跟顶层 HWND 直接比相等。
    public static bool IsSelfOrDescendant(IntPtr h, IntPtr ancestor) {
        IntPtr cur = h;
        int guard = 0;
        while (cur != IntPtr.Zero && guard++ < 64) {
            if (cur == ancestor) return true;
            cur = GetAncestor(cur, 1); // GA_PARENT
        }
        return false;
    }

    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public static string TitleOf(IntPtr h) {
        var sb = new StringBuilder(512); GetWindowTextW(h, sb, 512); return sb.ToString();
    }
    public static string ClassOf(IntPtr h) {
        var sb = new StringBuilder(256); GetClassNameW(h, sb, 256); return sb.ToString();
    }

    /// 找该进程里 class == 'Tauri Window' 的可见顶层窗口（用 PID 定位，比中文标题稳）。
    public static IntPtr FindPetWindow(uint targetPid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid == targetPid && ClassOf(h) == "Tauri Window") { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@

$WS_EX_TRANSPARENT = 0x00000020
$WS_EX_TOOLWINDOW  = 0x00000080
$WS_EX_APPWINDOW   = 0x00040000
$WS_EX_LAYERED     = 0x00080000
$WS_EX_NOACTIVATE  = 0x08000000

$proc = Get-Process $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output "RESULT: NO_PROCESS  ($ProcessName 未运行)"; exit 2 }

$hwnd = [PigProbe]::FindPetWindow([uint32]$proc.Id)
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "RESULT: NO_WINDOW  (pid=$($proc.Id) 没有 'Tauri Window')"; exit 2 }

$ex = [long][PigProbe]::GetWindowLongPtrW($hwnd, -20)   # GWL_EXSTYLE
$has = { param($m) (($ex -band $m) -ne 0) }

$rect = New-Object PigProbe+RECT
[void][PigProbe]::GetWindowRect($hwnd, [ref]$rect)
$cx = [int](($rect.Left + $rect.Right) / 2)
$cy = [int](($rect.Top + $rect.Bottom) / 2)

$pt = New-Object PigProbe+POINT
$pt.X = $cx; $pt.Y = $cy
$under = [PigProbe]::WindowFromPoint($pt)

$transparent = & $has $WS_EX_TRANSPARENT
$layered     = & $has $WS_EX_LAYERED
$noActivate  = & $has $WS_EX_NOACTIVATE
$toolWindow  = & $has $WS_EX_TOOLWINDOW
$appWindow   = & $has $WS_EX_APPWINDOW
# 真正判据：命中的窗口是否**不属于猪的窗口树**
$hitIsOurs   = [PigProbe]::IsSelfOrDescendant($under, $hwnd)
$passThrough = -not $hitIsOurs

Write-Output "pid           : $($proc.Id)"
Write-Output "hwnd          : 0x$($hwnd.ToInt64().ToString('X'))  title='$([PigProbe]::TitleOf($hwnd))'"
Write-Output "ex_style      : 0x$($ex.ToString('X'))"
Write-Output "  TRANSPARENT : $transparent"
Write-Output "  LAYERED     : $layered"
Write-Output "  NOACTIVATE  : $noActivate"
Write-Output "  TOOLWINDOW  : $toolWindow"
Write-Output "  APPWINDOW   : $appWindow"
Write-Output "rect          : ($($rect.Left),$($rect.Top))-($($rect.Right),$($rect.Bottom))  size=$($rect.Right-$rect.Left)x$($rect.Bottom-$rect.Top)"
Write-Output "center        : ($cx,$cy)"
Write-Output "WindowFromPt  : 0x$($under.ToInt64().ToString('X'))  class='$([PigProbe]::ClassOf($under))'"
Write-Output "hitIsOurs     : $hitIsOurs   (True = 点击会被猪接住)"
Write-Output "passThrough   : $passThrough   (True = 点击落到猪以外)"

$issues = @()
if (-not $noActivate) { $issues += "缺 WS_EX_NOACTIVATE（会抢焦点）" }
if (-not $toolWindow) { $issues += "缺 WS_EX_TOOLWINDOW（可能进任务栏）" }
if ($appWindow)       { $issues += "残留 WS_EX_APPWINDOW（会进任务栏）" }
if ($transparent -and -not $layered) { $issues += "只设 TRANSPARENT 未设 LAYERED（穿透不生效）" }
if ($transparent -and -not $passThrough) { $issues += "已设穿透位但点击仍被猪接住" }
if ((-not $transparent) -and $passThrough) { $issues += "未开穿透却已穿透（互动模式失效）" }

$mode = if ($transparent) { "穿透" } else { "互动" }
if ($issues.Count -eq 0) {
    Write-Output "RESULT: PASS  (模式=$mode，样式与命中行为都正确)"
    exit 0
} else {
    Write-Output "RESULT: FAIL  (模式=$mode)"
    $issues | ForEach-Object { Write-Output "  - $_" }
    exit 1
}
