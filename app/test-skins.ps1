# P2-1 皮肤系统验收探针。
#
# 用法：  pwsh -NoProfile -File app\test-skins.ps1 [-Skin mint] [-LeaveOn]
#
# 它验的是**整条链路**，而不是某个函数：
#   1. 把 `pet.json` 的 skin 改成目标皮肤 → 启动 → 前端 `applySkin()` 必须真的跑
#      （日志里出现 `皮肤 -> ...`，且**没有** CSP 拦截报错）
#   2. 截图桌宠窗口，按像素判断猪**本体**的颜色确实换成了该皮肤的 body 色，
#      且基础色 `#FFD1AF` 已经**不再出现**
#   3. 道具色（蛋糕 / 水 / 泡泡）**不**跟着变 —— 皮肤只换猪，不换道具
#   4. 换回默认皮肤后，`#FFD1AF` 必须原样回来（默认走原图直出快路径）
#
# 判据用「平色像素计数」而不是「平均色」：SVG 是纯色填充，
# 换了色之后该色值应当是**精确**出现的，平均色反而会被抗锯齿边缘糊掉。

param(
    [string]$Skin = 'mint',
    [switch]$LeaveOn
)

$ErrorActionPreference = 'Stop'

$AppDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Exe     = Join-Path $AppDir 'src-tauri\target\release\piggy-desktop.exe'
$CfgDir  = Join-Path $env:APPDATA 'com.piggy.desktop'
$PetJson = Join-Path $CfgDir 'pet.json'
$LogPath = Join-Path $CfgDir 'piggy.log'
$Shot    = Join-Path $env:TEMP 'piggy-skin-shot.png'
$Py      = 'C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SkinProbe {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    public static string ClassOf(IntPtr h) {
        var sb = new StringBuilder(256); GetClassNameW(h, sb, 256); return sb.ToString();
    }
    public static IntPtr FindPet(uint targetPid) {
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

[void][SkinProbe]::SetProcessDPIAware()

$HWND_TOPMOST   = [IntPtr](-1)
$SWP_NOACTIVATE = 0x0010
$SWP_NOMOVE     = 0x0002
$SWP_NOSIZE     = 0x0001

function Stop-Pig {
    Get-Process piggy-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500
}

function Start-Pig {
    Start-Process $Exe
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        $p = Get-Process piggy-desktop -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($p) {
            $h = [SkinProbe]::FindPet([uint32]$p.Id)
            if ($h -ne [IntPtr]::Zero) { return $h }
        }
    }
    throw '桌宠窗口没起来'
}

function Set-Skin([string]$key) {
    if (-not (Test-Path -LiteralPath $PetJson)) { throw "找不到 $PetJson，请先跑一次应用生成存档" }
    $raw = Get-Content -LiteralPath $PetJson -Raw | ConvertFrom-Json
    $raw.skin = $key
    $raw | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $PetJson -Encoding UTF8
}

function Grab([IntPtr]$h, [string]$out) {
    $r = New-Object SkinProbe+RECT
    [void][SkinProbe]::GetWindowRect($h, [ref]$r)
    $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
    # 提到最前但不激活，避免被别的窗口盖住
    [void][SkinProbe]::SetWindowPos($h, $HWND_TOPMOST, 0, 0, 0, 0,
        $SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE)
    Start-Sleep -Milliseconds 700
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap($w, $hh)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
    $g.Dispose()
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return @{ W = $w; H = $hh; Left = $r.Left; Top = $r.Top }
}

# 把鼠标挪到角落，免得触发了悬停面板挡住猪
[void][SkinProbe]::SetCursorPos(20, 1000)

Write-Output '=== P2-1 皮肤系统验收 ==='
Write-Output "目标皮肤 : $Skin"
Write-Output ''

$results = @()

# ---------- 1. 默认皮肤 ----------
Stop-Pig
Set-Skin 'default'
Remove-Item $LogPath -Force -ErrorAction SilentlyContinue
$hwnd = Start-Pig
$geo = Grab $hwnd $Shot
Write-Output ("[默认] 窗口 {0}x{1} @ ({2},{3})" -f $geo.W, $geo.H, $geo.Left, $geo.Top)
$defaultOut = & $Py (Join-Path $AppDir 'check-skin-colors.py') $Shot '#FFD1AF' '#C9F0DC' 2>&1
$defaultOut | ForEach-Object { Write-Output "       $_" }

# ---------- 2. 目标皮肤 ----------
Stop-Pig
Set-Skin $Skin
Remove-Item $LogPath -Force -ErrorAction SilentlyContinue
$hwnd = Start-Pig
Start-Sleep -Seconds 2   # 等 applySkin 的预载 + 重画完成
$geo = Grab $hwnd $Shot
Write-Output ("[$Skin] 窗口 {0}x{1} @ ({2},{3})" -f $geo.W, $geo.H, $geo.Left, $geo.Top)
$skinOut = & $Py (Join-Path $AppDir 'check-skin-colors.py') $Shot '#C9F0DC' '#FFD1AF' 2>&1
$skinOut | ForEach-Object { Write-Output "       $_" }

Write-Output ''
Write-Output '--- 日志（皮肤相关 / CSP 报错）---'
$log = Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
if ($log) {
    ($log -split "`n") | Where-Object { $_ -match '皮肤|CSP|Content Security|Refused|blob' } | ForEach-Object { Write-Output "  $($_.Trim())" }
    if ($log -notmatch '皮肤 ->') { Write-Output '  ⚠️ 日志里没有「皮肤 ->」，说明 applySkin 没跑' }
} else {
    Write-Output '  ⚠️ 没有日志'
}

# ---------- 3. 换回默认 ----------
Stop-Pig
Set-Skin 'default'
$hwnd = Start-Pig
Start-Sleep -Seconds 2
$geo = Grab $hwnd $Shot
$backOut = & $Py (Join-Path $AppDir 'check-skin-colors.py') $Shot '#FFD1AF' '#C9F0DC' 2>&1
Write-Output ''
Write-Output '[换回默认]'
$backOut | ForEach-Object { Write-Output "       $_" }

if (-not $LeaveOn) { Stop-Pig }

Write-Output ''
Write-Output '=== 结论 ==='
Write-Output "默认皮肤  : $defaultOut"
Write-Output "目标皮肤  : $skinOut"
Write-Output "回到默认  : $backOut"
