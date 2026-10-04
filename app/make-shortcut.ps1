<#
.SYNOPSIS
    给 piggy-desktop 生成/刷新桌面快捷方式（图标是一只猪）。

.DESCRIPTION
    做三件事：
      1. 把 release 产物复制成一个**便携目录** `dist\`，这样桌面快捷方式不依赖
         `src-tauri\target\`（`cargo clean` 不会把它弄坏）。
      2. 把猪图标（`src-tauri\icons\icon.ico`，7 帧：16/24/32/48/64/128/256）复制进 `dist\piggy.ico`。
      3. 在桌面建 `谷歌猪.lnk`，`TargetPath` 指向 `dist\piggy-desktop.exe`，
         `IconLocation` 显式指向 `dist\piggy.ico`。

    ⚠️ 重新 `cargo build --release` 之后要**再跑一次本脚本**，`dist\` 才会同步到新版本。

.PARAMETER Name
    快捷方式显示名，默认「谷歌猪」。

.PARAMETER StartMenu
    额外在开始菜单建一个同名快捷方式。

.PARAMETER NoPortable
    不复制到 `dist\`，快捷方式直接指向 `target\release\piggy-desktop.exe`。

.EXAMPLE
    pwsh -NoProfile -File app\make-shortcut.ps1
    pwsh -NoProfile -File app\make-shortcut.ps1 -Name "小猪桌宠" -StartMenu
#>
[CmdletBinding()]
param(
    [string]$Name = '谷歌猪',
    [switch]$StartMenu,
    [switch]$NoPortable
)

$ErrorActionPreference = 'Stop'

# ---- 路径：脚本在 app\ 下，仓库根是它的上一级 ----
$AppDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $AppDir
$SrcExe   = Join-Path $AppDir 'src-tauri\target\release\piggy-desktop.exe'
$SrcIco   = Join-Path $AppDir 'src-tauri\icons\icon.ico'
$DistDir  = Join-Path $RepoRoot 'dist'
$DistExe  = Join-Path $DistDir 'piggy-desktop.exe'
$DistIco  = Join-Path $DistDir 'piggy.ico'

Write-Host '🐖 piggy-desktop 桌面快捷方式' -ForegroundColor Magenta
Write-Host ''

# ---- 1. 找 exe ----
if (-not (Test-Path -LiteralPath $SrcExe)) {
    Write-Error "找不到 $SrcExe`n请先构建：  cd app\src-tauri; cargo build --release"
    exit 1
}
if (-not (Test-Path -LiteralPath $SrcIco)) {
    Write-Error "找不到猪图标 $SrcIco"
    exit 1
}

$srcInfo = Get-Item -LiteralPath $SrcExe
Write-Host ("  产物   : {0}  ({1:N2} MB, {2})" -f $SrcExe, ($srcInfo.Length / 1MB), $srcInfo.LastWriteTime)

# ---- 2. 便携目录 ----
$TargetExe = $SrcExe
$IconPath  = $SrcIco
if (-not $NoPortable) {
    if (-not (Test-Path -LiteralPath $DistDir)) {
        New-Item -ItemType Directory -Path $DistDir | Out-Null
    }
    Copy-Item -LiteralPath $SrcExe -Destination $DistExe -Force
    Copy-Item -LiteralPath $SrcIco -Destination $DistIco -Force
    $TargetExe = $DistExe
    $IconPath  = $DistIco
    Write-Host ("  便携   : {0}" -f $DistDir)
}

# ---- 3. 建快捷方式 ----
function New-PigShortcut {
    param([string]$LinkPath, [string]$Target, [string]$Icon, [string]$WorkDir)

    $shell = New-Object -ComObject WScript.Shell
    try {
        $lnk = $shell.CreateShortcut($LinkPath)
        $lnk.TargetPath       = $Target
        $lnk.WorkingDirectory = $WorkDir
        $lnk.IconLocation     = "$Icon,0"
        $lnk.Description      = '谷歌猪桌宠 — 轻量、不抢焦点、不和全屏游戏打架'
        $lnk.WindowStyle      = 1
        $lnk.Save()
    } finally {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
    }
}

$Desktop  = [Environment]::GetFolderPath('Desktop')
$DeskLnk  = Join-Path $Desktop "$Name.lnk"
New-PigShortcut -LinkPath $DeskLnk -Target $TargetExe -Icon $IconPath -WorkDir (Split-Path -Parent $TargetExe)
Write-Host ("  桌面   : {0}" -f $DeskLnk)

if ($StartMenu) {
    $SmDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'piggy-desktop'
    if (-not (Test-Path -LiteralPath $SmDir)) { New-Item -ItemType Directory -Path $SmDir | Out-Null }
    $SmLnk = Join-Path $SmDir "$Name.lnk"
    New-PigShortcut -LinkPath $SmLnk -Target $TargetExe -Icon $IconPath -WorkDir (Split-Path -Parent $TargetExe)
    Write-Host ("  开始菜单: {0}" -f $SmLnk)
}

# ---- 4. 回读校验（不信自己刚写的，读回来验一遍）----
Write-Host ''
Write-Host '  —— 回读校验 ——' -ForegroundColor Cyan
$shell2 = New-Object -ComObject WScript.Shell
try {
    $chk = $shell2.CreateShortcut($DeskLnk)
    $okTarget = ($chk.TargetPath -eq $TargetExe)
    $okIcon   = ($chk.IconLocation -like "$IconPath*")
    $okExist  = (Test-Path -LiteralPath $chk.TargetPath)
    Write-Host ("    TargetPath   : {0}  [{1}]" -f $chk.TargetPath, $(if ($okTarget) { 'OK' } else { '不一致' }))
    Write-Host ("    IconLocation : {0}  [{1}]" -f $chk.IconLocation, $(if ($okIcon) { 'OK' } else { '不一致' }))
    Write-Host ("    目标存在     : {0}  [{1}]" -f $okExist, $(if ($okExist) { 'OK' } else { '缺失' }))
    Write-Host ("    Description  : {0}" -f $chk.Description)
} finally {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell2)
}

if ($okTarget -and $okIcon -and $okExist) {
    Write-Host ''
    Write-Host '✅ 桌面快捷方式就绪（图标 = 猪）。双击即可召唤小猪。' -ForegroundColor Green
    exit 0
} else {
    Write-Host ''
    Write-Host '❌ 校验未通过。' -ForegroundColor Red
    exit 1
}
