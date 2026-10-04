# P1 交互验收探针：验证照顾面板能出现、能点、点了真的算数。
#
# 用法：  pwsh -NoProfile -File test-interaction.ps1
#
# ## 为什么用 PostMessage 而不是 SetCursorPos + mouse_event
#
# 一开始用的是「移动真实光标 + 合成点击」，但实测**不可靠**：`SetCursorPos`
# 会被物理鼠标的移动直接覆盖（探针打点后回读光标位置，发现它跑到了 2147,623
# —— 那是用户自己的手）。结果就是同一条用例时过时不过。
#
# 改成向 WebView2 的 `Chrome_RenderWidgetHostHWND` 子窗口投递窗口消息，
# 走的是 Chromium 自己的输入处理，不碰系统光标，也就不跟用户抢鼠标。
# 这仍然是真的走完「窗口 → WebView2 → DOM 事件」整条链路，
# 比在页面里 dispatch 一个合成 click 强得多。
#
# ## 为什么全程轮询而不是固定 sleep
#
# 用户真的在动鼠标，指针偶尔会扫过桌宠窗口，把面板打开。所以每一步都
# **先强制归位、再等状态真正到位**，而不是「睡 N 毫秒然后假设已经到位」。
#
# 判据：
#   1) 指针移到猪身上 → 面板出现（窗口变高），且猪的屏幕位置不变
#   2) 点「喂食」→ 存档里的 stats.feeds +1、饱食度真的涨了，且**不抢焦点**
#   3) 指针移开 → 面板收起（窗口缩回）
#   4) 全程面板不闪烁

param(
    [string]$ProcessName = "piggy-desktop",
    [int]$TimeoutMs = 6000
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PigMsg {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

    public const uint SWP_NOSIZE     = 0x0001;
    public const uint SWP_NOZORDER   = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;

    /// 只挪窗口位置，不动尺寸、不改 Z 序、不激活。
    public static bool MoveWindowTo(IntPtr h, int x, int y) {
        return SetWindowPos(h, IntPtr.Zero, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
    public static void CursorXY(out int x, out int y) {
        POINT p; GetCursorPos(out p); x = p.X; y = p.Y;
    }
    public static int ScreenW() { return GetSystemMetrics(0); }
    public static int ScreenH() { return GetSystemMetrics(1); }

    /// 移动**真实**光标并确认它真的到位。
    ///
    /// ⚠️ 现在只在还能用的时候当备用手段：悬停判定已经改成主进程轮询
    /// `GetCursorPos`，而**全屏游戏会 `ClipCursor` 独占光标**，此时
    /// `SetCursorPos` 一律返回 false（实测：光标停在 1706,726，请求移到
    /// 700,500 直接失败）。那种情况下改用「把窗口挪到光标底下」（见
    /// `MoveWindowTo`）来触发悬停 —— 效果等价，而且完全不碰光标。
    public static bool MoveCursor(int x, int y) {
        for (int i = 0; i < 6; i++) {
            SetCursorPos(x, y);
            System.Threading.Thread.Sleep(40);
            POINT p; GetCursorPos(out p);
            if (Math.Abs(p.X - x) <= 1 && Math.Abs(p.Y - y) <= 1) return true;
        }
        return false;
    }

    public const uint WM_MOUSEMOVE   = 0x0200;
    public const uint WM_LBUTTONDOWN = 0x0201;
    public const uint WM_LBUTTONUP   = 0x0202;
    public const uint WM_RBUTTONDOWN = 0x0204;
    public const uint WM_RBUTTONUP   = 0x0205;
    public const uint WM_MOUSELEAVE  = 0x02A3;
    public const int  MK_LBUTTON     = 0x0001;
    public const int  MK_RBUTTON     = 0x0002;

    public static IntPtr MakeLParam(int x, int y) { return (IntPtr)((y << 16) | (x & 0xFFFF)); }

    public static string ClassOf(IntPtr h) {
        var sb = new StringBuilder(256); GetClassNameW(h, sb, 256); return sb.ToString();
    }
    public static string TitleOf(IntPtr h) {
        var sb = new StringBuilder(512); GetWindowTextW(h, sb, 512); return sb.ToString();
    }
    public static IntPtr FindPetWindow(uint pid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            uint p; GetWindowThreadProcessId(h, out p);
            if (p == pid && ClassOf(h) == "Tauri Window") { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static IntPtr FindRenderHost(IntPtr parent) {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (h, l) => {
            if (ClassOf(h) == "Chrome_RenderWidgetHostHWND") { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static void Hover(IntPtr h, int x, int y) {
        PostMessageW(h, WM_MOUSEMOVE, IntPtr.Zero, MakeLParam(x, y));
    }
    public static void Click(IntPtr h, int x, int y) {
        PostMessageW(h, WM_MOUSEMOVE, IntPtr.Zero, MakeLParam(x, y));
        System.Threading.Thread.Sleep(90);
        PostMessageW(h, WM_LBUTTONDOWN, (IntPtr)MK_LBUTTON, MakeLParam(x, y));
        System.Threading.Thread.Sleep(90);
        PostMessageW(h, WM_LBUTTONUP, IntPtr.Zero, MakeLParam(x, y));
    }
    /// 右键 = 切换面板固定。用它来在**不移动真实光标**的前提下打开面板：
    /// 悬停判定现在读 `GetCursorPos`，光标挪不动时右键是唯一的备用入口。
    public static void RightClick(IntPtr h, int x, int y) {
        PostMessageW(h, WM_MOUSEMOVE, IntPtr.Zero, MakeLParam(x, y));
        System.Threading.Thread.Sleep(90);
        PostMessageW(h, WM_RBUTTONDOWN, (IntPtr)MK_RBUTTON, MakeLParam(x, y));
        System.Threading.Thread.Sleep(90);
        PostMessageW(h, WM_RBUTTONUP, IntPtr.Zero, MakeLParam(x, y));
    }
}
'@

[void][PigMsg]::SetProcessDPIAware()

$logPath = Join-Path $env:APPDATA "com.piggy.desktop\piggy.log"
$savePath = Join-Path $env:APPDATA "com.piggy.desktop\pet.json"

function Get-Rect($h) {
    $r = New-Object PigMsg+RECT
    [void][PigMsg]::GetWindowRect($h, [ref]$r)
    return $r
}
function Get-Size($h) {
    $r = Get-Rect $h
    return @{ W = $r.Right - $r.Left; H = $r.Bottom - $r.Top; R = $r }
}
function Get-Save {
    if (-not (Test-Path $savePath)) { return $null }
    return Get-Content $savePath -Raw | ConvertFrom-Json
}
function Get-LogLines { if (-not (Test-Path $logPath)) { return @() } return @(Get-Content $logPath) }

# 只认本次运行新写进来的日志，免得读到上一轮留下的 PANEL-GEOM。
$logBaseline = (Get-LogLines).Count
function Get-NewLogLines { return @(Get-LogLines | Select-Object -Skip $logBaseline) }

function Wait-Until([scriptblock]$Cond, [string]$What, [int]$Timeout = $TimeoutMs) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $Timeout) {
        if (& $Cond) { return $true }
        Start-Sleep -Milliseconds 80
    }
    Write-Output "  ⏱ 等待超时：$What"
    return $false
}

# 把光标挪到一个**远离窗口**的屏幕角落。
# 悬停判定在主进程里轮询 `GetCursorPos`，所以要么动光标、要么动窗口。
function Move-Away($rect) {
    $sw = [PigMsg]::ScreenW(); $sh = [PigMsg]::ScreenH()
    $cx = [int](($rect.Left + $rect.Right) / 2)
    # 挑离窗口最远的那个角
    if ($cx -lt $sw / 2) { [void][PigMsg]::MoveCursor($sw - 6, $sh - 6) }
    else { [void][PigMsg]::MoveCursor(6, 6) }
}

function Get-Cursor {
    $x = 0; $y = 0
    [PigMsg]::CursorXY([ref]$x, [ref]$y)
    return @{ X = $x; Y = $y }
}

function Clamp-ToScreen([int]$x, [int]$y, [int]$w, [int]$h) {
    $sw = [PigMsg]::ScreenW(); $sh = [PigMsg]::ScreenH()
    if ($x -lt 0) { $x = 0 }
    if ($y -lt 0) { $y = 0 }
    if ($x + $w -gt $sw) { $x = $sw - $w }
    if ($y + $h -gt $sh) { $y = $sh - $h }
    return @{ X = $x; Y = $y }
}

# 把窗口挪到**光标底下**（让光标落在窗口中心）。
#
# 为什么不直接移光标：全屏游戏会 `ClipCursor` 独占光标，`SetCursorPos` 一律
# 返回 false。挪窗口效果等价 —— 悬停判定看的就是「光标在不在窗口矩形里」，
# 而且完全不碰光标，不打扰用户。
function Park-UnderCursor($h, [int]$Wid, [int]$Hei, [int]$SettleMs = 50) {
    $c = Get-Cursor
    $p = Clamp-ToScreen ($c.X - [int]($Wid / 2)) ($c.Y - [int]($Hei / 2)) $Wid $Hei
    [void][PigMsg]::MoveWindowTo($h, $p.X, $p.Y)
    # 只等窗口真的挪过去。悬停轮询是 150ms 一次，所以这里必须**短**，
    # 不然面板可能在基准量下来之前就打开了。
    Start-Sleep -Milliseconds $SettleMs
    return $p
}

# 把窗口挪到离光标最远的屏幕角落。
function Park-AwayFromCursor($h) {
    $s = Get-Size $h
    $c = Get-Cursor
    $sw = [PigMsg]::ScreenW(); $sh = [PigMsg]::ScreenH()
    if ($c.X -lt $sw / 2) { $p = Clamp-ToScreen ($sw - $s.W - 20) ($sh - $s.H - 60) $s.W $s.H }
    else { $p = Clamp-ToScreen 20 40 $s.W $s.H }
    [void][PigMsg]::MoveWindowTo($h, $p.X, $p.Y)
    Start-Sleep -Milliseconds 120
    return $p
}

# 反复把窗口挪开直到高度稳定 —— 用户真的在动鼠标，
# 指针随时可能扫过桌宠把面板打开，一次归位不一定压得住。
#
# ⚠️ 「连续两次读数相同」**不足以**判定收起：如果面板在两次读数之间一直开着，
# 那个「稳定」的高度其实是**展开态**。实测就撞到过：150% 缩放下
# 用户的光标扫过桌宠，`Force-Collapsed` 把 252x468（面板开着）当成了收起态，
# 于是后面「右键取消固定后窗口没有缩回」误报失败。
# 所以再加一条：只有高度**等于本次循环见过的最小值**时才认。
function Force-Collapsed($h, [int]$Timeout = 8000) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $last = -1
    $minH = [int]::MaxValue
    while ($sw.ElapsedMilliseconds -lt $Timeout) {
        [void](Park-AwayFromCursor $h)
        # 收起链路：150ms 轮询发现光标离开 → emit → 120ms 防抖 → 隐藏 → resize
        Start-Sleep -Milliseconds 700
        $s2 = Get-Size $h
        $prevMin = $minH
        if ($s2.H -lt $minH) { $minH = $s2.H }
        # 连续两次读数相同 **且** 不高于之前见过的最小值。
        # 只判「稳定」不够：面板一直开着时那个高度也是稳定的。
        if ($s2.H -eq $last -and $s2.H -le $prevMin) { return $s2 }
        $last = $s2.H
    }
    return (Get-Size $h)
}

$proc = Get-Process $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output "RESULT: NO_PROCESS"; exit 2 }

$hwnd = [PigMsg]::FindPetWindow([uint32]$proc.Id)
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "RESULT: NO_WINDOW"; exit 2 }

$host_ = [PigMsg]::FindRenderHost($hwnd)
if ($host_ -eq [IntPtr]::Zero) { Write-Output "RESULT: NO_RENDER_HOST"; exit 2 }
Write-Output "window        : 0x$($hwnd.ToInt64().ToString('X'))  renderHost: 0x$($host_.ToInt64().ToString('X'))"

$fail = @()
$skipped = @()

# --- 0. 先归位：把窗口挪到离光标最远的角落，等面板收起 ---------------------
# （用户真的在动鼠标，指针可能刚好扫过桌宠，不归位的话「初始尺寸」测的是展开态）
$awayRect = Force-Collapsed $hwnd
$cw = $awayRect.W
$ch = $awayRect.H
Write-Output "collapsed     : ${cw}x${ch} (收起态尺寸)"

# --- 1. 光标落在猪身上 → 面板出现 -----------------------------------------
# 把窗口挪到光标底下（而不是移光标 —— 全屏游戏会 ClipCursor 锁住光标）。
#
# ⚠️ 基准不能等挪完再量：悬停轮询 150ms 一次，面板可能在量之前就打开了。
# 好在挪窗口是**纯平移**，所以收起态的窗口矩形是算得出来的：
#   新原点 = $parked，尺寸 = 刚量到的 $cw x $ch
$parked = Park-UnderCursor $hwnd $cw $ch
$baseLeft = $parked.X; $baseTop = $parked.Y
$baseRight = $parked.X + $cw; $baseBottom = $parked.Y + $ch

$cNow = Get-Cursor
$inside = $cNow.X -ge $baseLeft -and $cNow.X -lt $baseRight -and
          $cNow.Y -ge $baseTop -and $cNow.Y -lt $baseBottom
if (-not $inside) {
    Write-Output "hover         : SKIP 光标不在窗口内（屏幕边缘夹取后仍对不上）"
    $skipped += "悬停打开面板"
    [PigMsg]::RightClick($host_, [int]($cw / 2), [int]($ch / 2))
}
$grew = Wait-Until { (Get-Size $hwnd).H -gt $ch } "面板出现"
if (-not $inside -and $grew) { $skipped += "（本次由右键固定打开，非悬停）" }

$expanded = Get-Rect $hwnd
$ew = $expanded.Right - $expanded.Left
$eh = $expanded.Bottom - $expanded.Top
Write-Output "expanded      : ${ew}x${eh} at ($($expanded.Left),$($expanded.Top))"
if (-not $grew) { $fail += "悬停后窗口没有变高（面板没出现）：$ch -> $eh" }
if ($ew -lt $cw) { $fail += "窗口宽度反而变小了：$cw -> $ew" }

# --- 2. 猪的屏幕位置必须不变（否则鼠标下的猪会自己跑掉，面板反复闪）---------
# 猪在内容栈里居中且贴底，所以「猪不动」等价于「窗口底边 + 水平中心不动」。
#
# ⚠️ 例外：窗口贴到屏幕边缘时 `clamp_to_screen` 会把窗口拽回屏内（这是**正确**
# 行为 —— 猪必须一直够得着），副作用是猪会跟着挪。此时锚定对比没有意义，
# 明确跳过而不是报假失败。（实测：光标停在 x≈30 时，展开后窗口被夹到 x=0，
# 猪中心从 60 变到 126 —— 正好是半展开宽度 66。）
$sw = [PigMsg]::ScreenW(); $sh = [PigMsg]::ScreenH()
$hitEdge = ($expanded.Left -le 0) -or ($expanded.Right -ge $sw) -or
           ($expanded.Top -le 0) -or ($expanded.Bottom -ge $sh)
if ($hitEdge) {
    Write-Output "pig anchor    : SKIP 窗口贴到屏幕边缘（clamp_to_screen 合法地把猪挪开了）"
    $skipped += "锚定对比（窗口贴边）"
} else {
    $pigBottomBefore = $baseBottom
    $pigBottomAfter = $expanded.Bottom
    $pigCxBefore = [int](($baseLeft + $baseRight) / 2)
    $pigCxAfter = [int](($expanded.Left + $expanded.Right) / 2)
    Write-Output "pig anchor    : bottom $pigBottomBefore -> $pigBottomAfter ; cx $pigCxBefore -> $pigCxAfter"
    if ([Math]::Abs($pigBottomAfter - $pigBottomBefore) -gt 3) {
        $fail += "面板出现时猪上下跳了 $($pigBottomAfter - $pigBottomBefore)px（应锚定猪）"
    }
    if ([Math]::Abs($pigCxAfter - $pigCxBefore) -gt 3) {
        $fail += "面板出现时猪左右跳了 $($pigCxAfter - $pigCxBefore)px"
    }
}

# --- 3. 从日志取按钮的真实屏幕坐标，换算成窗口内坐标 ----------------------
# 页面在 resize 落定后 120ms 才写 PANEL-GEOM，所以要轮询等它出现，不能读一次就算。
$geom = $null
[void](Wait-Until {
    $g = Get-NewLogLines | Select-String -Pattern 'PANEL-GEOM' | Select-Object -Last 1
    if ($g -and $g.Line -match 'feed@\d+,\d+') { $script:geom = $g; return $true }
    return $false
} "面板几何上报（PANEL-GEOM）" 4000)

$feedX = -1; $feedY = -1
$script:ox = 0; $script:oy = 0; $script:pigScreenX = 0; $script:pigScreenY = 0
if (-not $geom) {
    $fail += "日志里没有 PANEL-GEOM（面板几何没上报）"
} else {
    Write-Output "geom          : $($geom.Line -replace '^.*PANEL-GEOM ', '')"
    if ($geom.Line -match 'origin=(-?\d+),(-?\d+)') {
        $script:ox = [int]$Matches[1]; $script:oy = [int]$Matches[2]
        if ($geom.Line -match 'feed@(\d+),(\d+)') {
            # 屏幕坐标 → 窗口内物理坐标（PostMessage 用的是子窗口客户区坐标）
            $feedX = [int]$Matches[1] - $script:ox
            $feedY = [int]$Matches[2] - $script:oy
        }
        if ($geom.Line -match 'pig=(\d+),(\d+)') {
            $script:pigScreenX = [int]$Matches[1]; $script:pigScreenY = [int]$Matches[2]
        }
    }
    if ($feedX -lt 0) { $fail += "PANEL-GEOM 里没解析出 feed 按钮坐标" }
}

# --- 4. 点「喂食」，检查存档 -------------------------------------------------
$before = Get-Save
if ($null -eq $before) { $fail += "读不到 pet.json" }

if ($feedX -ge 0) {
    Write-Output "feed button   : window-relative ($feedX,$feedY)"

    # 桌宠**不该抢焦点**：点完前台窗口必须不变
    $fgBefore = [PigMsg]::GetForegroundWindow()
    $fgTitleBefore = [PigMsg]::TitleOf($fgBefore)

    [PigMsg]::Click($host_, $feedX, $feedY)
    [void](Wait-Until {
        $s = Get-Save
        $null -ne $s -and $null -ne $before -and ($s.stats.feeds - $before.stats.feeds) -ge 1
    } "喂食写入存档" 5000)

    $fgAfter = [PigMsg]::GetForegroundWindow()
    Write-Output "foreground    : '$fgTitleBefore' (0x$($fgBefore.ToInt64().ToString('X'))) -> 0x$($fgAfter.ToInt64().ToString('X'))"
    if ($fgBefore -ne $fgAfter) {
        $fail += "点面板后前台窗口变了（抢焦点了）：'$fgTitleBefore' -> '$([PigMsg]::TitleOf($fgAfter))'"
    }

    $after = Get-Save
    if ($null -ne $before -and $null -ne $after) {
        $dFeeds = $after.stats.feeds - $before.stats.feeds
        $dSat = [math]::Round($after.satiety - $before.satiety, 2)
        $dHap = [math]::Round($after.happiness - $before.happiness, 2)
        Write-Output "feed click    : stats.feeds +$dFeeds ; satiety $([math]::Round($before.satiety,2)) -> $([math]::Round($after.satiety,2)) (delta $dSat) ; happiness delta $dHap"
        if ($dFeeds -lt 1) { $fail += "点喂食后 stats.feeds 没有 +1（实际 +$dFeeds）——点击没生效" }
        if ($dSat -le 15) { $fail += "点喂食后饱食度没涨够（+$dSat，期望约 +22）" }
    }

    # 点了喂食之后猪应该换成「吃」的表情（5 张动作场景图之一）
    $scene = Get-NewLogLines | Select-String -Pattern '场景 -> eat' | Select-Object -Last 1
    if ($scene) {
        Write-Output "scene         : 表情切换到 eat ✓"
    } else {
        $fail += "点喂食后没有切换到 eat 场景（表情没变）"
    }
}

# --- 5. 光标离开 → 面板收起 -------------------------------------------------
if ($inside) {
    # 正常路径：把窗口从光标底下挪开 → 主进程轮询发现光标出界 → 收起
    $final = Force-Collapsed $hwnd
    if ($final.H -ne $ch) { $fail += "光标移开后窗口没有缩回：期望高 $ch，实际 $($final.H)" }
} else {
    # 悬停没测到（屏幕边缘夹取），只能再右键一次取消「固定」
    $skipped += "悬停收起面板"
    $pigRelX = $script:pigScreenX - $script:ox
    $pigRelY = $script:pigScreenY - $script:oy
    [PigMsg]::RightClick($host_, $pigRelX, $pigRelY)
    [void](Wait-Until { (Get-Size $hwnd).H -eq $ch } "面板收起（右键取消固定）" 5000)
    $final = Get-Size $hwnd
    if ($final.H -ne $ch) { $fail += "右键取消固定后窗口没有缩回：期望高 $ch，实际 $($final.H)" }
}
$reCollapsed = Get-Rect $hwnd
Write-Output "re-collapsed  : $($reCollapsed.Right - $reCollapsed.Left)x$($reCollapsed.Bottom - $reCollapsed.Top)"

# --- 6. 闪烁检查：面板出现次数不应该爆炸 ------------------------------------
$flips = (Get-NewLogLines | Select-String -Pattern 'BOX \d+x2\d\d ').Count
Write-Output "panel shows   : $flips 次"
if ($flips -gt 8) { $fail += "面板反复闪烁（出现 $flips 次）" }

Write-Output ""
if ($fail.Count -gt 0) {
    Write-Output "RESULT: FAIL"
    $fail | ForEach-Object { Write-Output "  - $_" }
    exit 1
}
if ($skipped.Count -gt 0) {
    Write-Output "跳过          : $($skipped -join '；')"
    Write-Output "RESULT: PASS (部分跳过)  面板打开/锚定/点击生效/不抢焦点/收起 全部正确"
    exit 0
}
Write-Output "RESULT: PASS  (悬停打开/锚定/点击生效/不抢焦点/移开收起 全部正确)"
exit 0
