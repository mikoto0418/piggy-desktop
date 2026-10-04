# P2-6 悬停让位验收探针。
#
# 用法：  pwsh -NoProfile -File test-hover-through.ps1
#
# ## 验的是什么
#
# 「悬停」被两个功能共用，这是设计上的硬冲突：
#   ① 悬停 → 打开照顾面板（要能点）
#   ② 悬停 → 淡出 + 穿透，别挡住下层（要不能点）
# 两者都盯着「指针在猪身上」，不可能同时成立。实现用**停留时长**区分：
#
#   指针扫过来（< wake 延迟）→ 判定「路过」 → 淡出 + 穿透
#   指针停住  （≥ wake 延迟）→ 判定「想互动」→ 恢复 + 取消穿透 + 开面板
#   指针移开  （≥ restore）  → 回到「路过」态
#
# 本探针逐段验证这三段，并且**直接读 GWL_EXSTYLE** 确认穿透位真的跟着变，
# 而不是只看日志。
#
# ## 为什么「挪窗口到光标底下」而不是「移光标」
#
# 悬停判定读 `GetCursorPos`，而全屏游戏会 `ClipCursor` 独占光标，
# `SetCursorPos` 一律返回 false（实测：光标停在 1706,726，请求移到 700,500 失败）。
# 挪窗口是纯平移，等价于「光标进入窗口」，且不跟用户抢鼠标。

param(
    [string]$ProcessName = "piggy-desktop",
    [int]$TimeoutMs = 8000
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class GhostProbe {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtrW(IntPtr h, int index);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

    public const uint SWP_NOSIZE     = 0x0001;
    public const uint SWP_NOZORDER   = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const int  GWL_EXSTYLE    = -20;

    public static bool MoveWindowTo(IntPtr h, int x, int y) {
        return SetWindowPos(h, IntPtr.Zero, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
    public static void CursorXY(out int x, out int y) { POINT p; GetCursorPos(out p); x = p.X; y = p.Y; }
    public static int ScreenW() { return GetSystemMetrics(0); }
    public static int ScreenH() { return GetSystemMetrics(1); }

    public static IntPtr FindPet(uint pid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            uint p; GetWindowThreadProcessId(h, out p);
            if (p == pid) {
                var sb = new StringBuilder(128); GetClassNameW(h, sb, 128);
                if (sb.ToString() == "Tauri Window") { found = h; return false; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    /// 穿透位（WS_EX_TRANSPARENT = 0x20）。
    public static bool IsClickThrough(IntPtr h) {
        long ex = GetWindowLongPtrW(h, GWL_EXSTYLE).ToInt64();
        return (ex & 0x20L) != 0;
    }
    public static string ExStyleHex(IntPtr h) {
        long ex = GetWindowLongPtrW(h, GWL_EXSTYLE).ToInt64();
        return "0x" + ex.ToString("X");
    }
}
'@

[void][GhostProbe]::SetProcessDPIAware()

# ---------------------------------------------------------------- 工具

$LogPath = Join-Path $env:APPDATA "com.piggy.desktop\piggy.log"
$script:BaseLines = 0
$fail = @()

function Get-NewLogLines {
    if (-not (Test-Path $LogPath)) { return @() }
    $all = @(Get-Content $LogPath -ErrorAction SilentlyContinue)
    if ($all.Count -le $script:BaseLines) { return @() }
    return $all[$script:BaseLines..($all.Count - 1)]
}

function Reset-LogBaseline {
    $script:BaseLines = 0
    if (Test-Path $LogPath) { $script:BaseLines = @(Get-Content $LogPath).Count }
}

function Get-Rect($h) {
    $r = New-Object GhostProbe+RECT
    [void][GhostProbe]::GetWindowRect($h, [ref]$r)
    return @{ Left = $r.Left; Top = $r.Top; Right = $r.Right; Bottom = $r.Bottom
              W = $r.Right - $r.Left; H = $r.Bottom - $r.Top }
}

function Get-Cursor { $x = 0; $y = 0; [GhostProbe]::CursorXY([ref]$x, [ref]$y); return @{ X = $x; Y = $y } }

function Clamp-ToScreen($x, $y, $w, $h) {
    $sw = [GhostProbe]::ScreenW(); $sh = [GhostProbe]::ScreenH()
    if ($x -lt 0) { $x = 0 }
    if ($y -lt 0) { $y = 0 }
    if ($x + $w -gt $sw) { $x = $sw - $w }
    if ($y + $h -gt $sh) { $y = $sh - $h }
    return @{ X = [int]$x; Y = [int]$y }
}

function Wait-Until([scriptblock]$Cond, [int]$Ms, [string]$What) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $Ms) {
        if (& $Cond) { return $sw.ElapsedMilliseconds }
        Start-Sleep -Milliseconds 25
    }
    return -1
}

function Park-UnderCursor($h, $w, $hh) {
    $c = Get-Cursor
    $p = Clamp-ToScreen ($c.X - [int]($w / 2)) ($c.Y - [int]($hh / 2)) $w $hh
    [void][GhostProbe]::MoveWindowTo($h, $p.X, $p.Y)
    return $p
}

# 挑离光标**最远**的角 —— 用固定角落会在光标恰好停在那儿时失效。
function Park-AwayFromCursor($h, $w, $hh) {
    $c = Get-Cursor
    $sw = [GhostProbe]::ScreenW(); $sh = [GhostProbe]::ScreenH()
    $cands = @(
        (Clamp-ToScreen 20 20 $w $hh),
        (Clamp-ToScreen ($sw - $w - 20) 20 $w $hh),
        (Clamp-ToScreen 20 ($sh - $hh - 20) $w $hh),
        (Clamp-ToScreen ($sw - $w - 20) ($sh - $hh - 20) $w $hh)
    )
    $best = $null; $bestD = -1.0
    foreach ($p in $cands) {
        $d = [Math]::Pow($p.X + $w / 2 - $c.X, 2) + [Math]::Pow($p.Y + $hh / 2 - $c.Y, 2)
        if ($d -gt $bestD) { $bestD = $d; $best = $p }
    }
    [void][GhostProbe]::MoveWindowTo($h, $best.X, $best.Y)
    return $best
}

# ---------------------------------------------------------------- 前置：确保「悬停让位」是开着的

# 悬停让位由 config.json 的 `overlay.hoverThrough` 控制，**默认是关的**。
# 探针必须自己把它打开并重启应用，否则测的是一个没启用的功能 ——
# 表现是「GHOST 一直没翻转」，看起来像回归，实际只是前置条件不满足。
# （第一版就踩过：探针不设前置，跑出来的 FAIL 是假的。）
$CfgPath  = Join-Path $env:APPDATA 'com.piggy.desktop\config.json'
$ExePath  = Join-Path $PSScriptRoot 'src-tauri\target\release\piggy-desktop.exe'
$script:RestoreHoverThrough = $null

function Enable-HoverThrough {
    if (-not (Test-Path -LiteralPath $CfgPath)) {
        Write-Output "NO_CONFIG: 找不到 $CfgPath，先跑一次应用"
        exit 2
    }
    $cfg = Get-Content -LiteralPath $CfgPath -Raw | ConvertFrom-Json
    $script:RestoreHoverThrough = [bool]$cfg.overlay.hoverThrough
    if ($script:RestoreHoverThrough) {
        Write-Output '前置          : 悬停让位已开启'
        return
    }
    Write-Output '前置          : 悬停让位是关的 → 打开并重启应用'
    $cfg.overlay.hoverThrough = $true
    $cfg | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $CfgPath -Encoding UTF8
    Get-Process $ProcessName -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 600
    if (-not (Test-Path -LiteralPath $ExePath)) { Write-Output "NO_EXE: $ExePath"; exit 2 }
    Start-Process $ExePath
    Start-Sleep -Seconds 4
}

function Restore-HoverThrough {
    if ($null -eq $script:RestoreHoverThrough) { return }
    if (-not (Test-Path -LiteralPath $CfgPath)) { return }
    $cfg = Get-Content -LiteralPath $CfgPath -Raw | ConvertFrom-Json
    if ([bool]$cfg.overlay.hoverThrough -eq $script:RestoreHoverThrough) { return }
    $cfg.overlay.hoverThrough = $script:RestoreHoverThrough
    $cfg | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $CfgPath -Encoding UTF8
    Write-Output ''
    Write-Output "（已把 hoverThrough 还原成 $($script:RestoreHoverThrough)）"
}

Enable-HoverThrough

# ---------------------------------------------------------------- 启动

$proc = Get-Process $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    Write-Output "NO_PROCESS: $ProcessName 没在跑"
    exit 2
}
$hwnd = [GhostProbe]::FindPet([uint32]$proc.Id)
if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output "NO_WINDOW: 找不到 Tauri Window"
    exit 2
}

Write-Output "window        : $($hwnd)"

# 先归位到「远离光标」并等窗口收起，拿到收起态尺寸
[void](Park-AwayFromCursor $hwnd 200 200)
[void](Wait-Until { (Get-Rect $hwnd).W -le 130 } 6000 "收起")
$rect = Get-Rect $hwnd
$W = $rect.W; $H = $rect.H
Write-Output "collapsed     : ${W}x${H}"

# ⚠️ 相位顺序很关键。
# 应用启动时光标可能本来就压在窗口上，所以**不能假设**初始是「醒着」的。
# 必须先把状态推到确定的「唤醒」态，再测两个方向，否则会读到上一相位残留的
# 日志（第一版就是这么误判的：日志里没有 GHOST -> true 不是没发生，
# 而是启动时就已经是 true、之后压根没翻转）。
Write-Output ""
Write-Output "── 准备：先把状态推到确定的「唤醒」态 ──"
Reset-LogBaseline
[void](Park-UnderCursor $hwnd $W $H)
$t0 = Wait-Until { (Get-NewLogLines | Select-String -Pattern 'GHOST -> false' -Quiet) } $TimeoutMs "唤醒"
if ($t0 -lt 0) {
    Write-Output "RESULT: FAIL"
    Write-Output "  - 指针停在猪身上 ${TimeoutMs}ms 仍没唤醒（GHOST -> false 没出现）"
    Restore-HoverThrough
    exit 1
}
Write-Output "awake         : ✓ ${t0}ms  穿透=$([GhostProbe]::IsClickThrough($hwnd))"

# ---------------------------------------------------------------- ① 移开 → 让位（淡出 + 穿透）

Write-Output ""
Write-Output "── ① 指针移开 → 应让位（淡出 + 穿透）──"
Reset-LogBaseline
[void](Park-AwayFromCursor $hwnd $W $H)
$t1 = Wait-Until { (Get-NewLogLines | Select-String -Pattern 'GHOST -> true' -Quiet) } $TimeoutMs "让位"
if ($t1 -lt 0) {
    $fail += "指针移开后没有让位（日志里没有 GHOST -> true）"
    Write-Output "ghost on      : ✗ 超时"
} else {
    $ct = [GhostProbe]::IsClickThrough($hwnd)
    Write-Output "ghost on      : ✓ ${t1}ms  ex=$([GhostProbe]::ExStyleHex($hwnd)) 穿透=$ct"
    if (-not $ct) { $fail += "让位态下 WS_EX_TRANSPARENT 没设上（点击仍会被猪接住）" }
    # 移开后要等 restore 延迟（300ms）+ 一个轮询周期，落在 300–600ms
    if ($t1 -gt 700) { $fail += "让位来得太慢（${t1}ms，restore 延迟 300ms + 轮询 150ms）" }
}

# ---------------------------------------------------------------- ② 停住 → 唤醒（恢复 + 可点）

Write-Output ""
Write-Output "── ② 指针停住 → 应唤醒（恢复不透明 + 取消穿透）──"
Reset-LogBaseline
[void](Park-UnderCursor $hwnd $W $H)
$t2 = Wait-Until { (Get-NewLogLines | Select-String -Pattern 'GHOST -> false' -Quiet) } $TimeoutMs "唤醒"
if ($t2 -lt 0) {
    $fail += "指针停住后没有唤醒"
    Write-Output "ghost off     : ✗ 超时"
} else {
    $ct = [GhostProbe]::IsClickThrough($hwnd)
    Write-Output "ghost off     : ✓ ${t2}ms  ex=$([GhostProbe]::ExStyleHex($hwnd)) 穿透=$ct"
    if ($ct) { $fail += "唤醒后 WS_EX_TRANSPARENT 没清掉（面板点不了）" }
    # wake 延迟 600ms 是**下界**，否则「路过」也会被当成「想互动」
    if ($t2 -lt 550) { $fail += "唤醒太早（${t2}ms，必须 ≥ wake 延迟 600ms）" }
}
$ui = Get-NewLogLines | Select-String -Pattern 'GHOST 界面 -> 唤醒' -Quiet
if ($ui) { Write-Output "fade in       : ✓ 前端恢复不透明度" }
else { $fail += "前端没收到 piggy://ghost（淡入没跑）" }

# ---------------------------------------------------------------- ③ 只路过不逗留 → 绝不能唤醒

# 这是整个功能**最要紧**的一条：打游戏时鼠标扫过猪，绝不能吞掉那一下点击。
# 逗留 300ms（< wake 600ms）就走，猪必须全程待在让位态、一次都不唤醒。
Write-Output ""
Write-Output "── ③ 只路过 300ms 就走 → 绝不能唤醒（否则会吞掉一次点击）──"
Reset-LogBaseline
[void](Park-UnderCursor $hwnd $W $H)
Start-Sleep -Milliseconds 300
[void](Park-AwayFromCursor $hwnd $W $H)
Start-Sleep -Milliseconds 900
$woke = Get-NewLogLines | Select-String -Pattern 'GHOST -> false' -Quiet
$ct = [GhostProbe]::IsClickThrough($hwnd)
if ($woke) {
    $fail += "只逗留 300ms 就唤醒了 —— 鼠标扫过时会吞掉一次点击"
    Write-Output "pass-by       : ✗ 被唤醒了"
} else {
    Write-Output "pass-by       : ✓ 全程未唤醒  穿透=$ct"
    if (-not $ct) { $fail += "路过期间没有保持穿透" }
}

# ---------------------------------------------------------------- 结论

Write-Output ""
if ($fail.Count -gt 0) {
    Write-Output "RESULT: FAIL"
    foreach ($f in $fail) { Write-Output "  - $f" }
    Restore-HoverThrough
    exit 1
}
Write-Output "RESULT: PASS  (移开即让位 / 停住即唤醒 / 路过不打扰，三段都对)"
Restore-HoverThrough
exit 0
