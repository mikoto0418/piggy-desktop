# 验证桌面快捷方式：**真的从 .lnk 里取出 Windows 会显示的那个图标**，再按像素判断它是不是猪。
#
# 为什么不用「看 IconLocation 字符串」了事：
# 那只证明了「我们写进去的是什么」，没证明「资源管理器真的解析得到它」。
# 这里走 `SHGetFileInfo(SHGFI_ICON | SHGFI_LARGEICON)` —— 和资源管理器同一套代码路径，
# 拿到 HICON 再转 Bitmap 数像素。图标解析不出来时，shell 会回落到通用的 .lnk 图标
# （一张白纸 + 箭头），颜色完全对不上，一测就露馅。
#
# 用法：  pwsh -NoProfile -File app\verify-shortcut.ps1 [-Name 谷歌猪]

param([string]$Name = '谷歌猪')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ShellIcon {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct SHFILEINFO {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]  public string szTypeName;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SHGetFileInfoW(string pszPath, uint dwFileAttributes,
        ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);

    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);

    public const uint SHGFI_ICON = 0x000000100;
    public const uint SHGFI_LARGEICON = 0x000000000;

    public static IntPtr IconFor(string path, out int index) {
        var info = new SHFILEINFO();
        IntPtr r = SHGetFileInfoW(path, 0, ref info,
            (uint)Marshal.SizeOf(typeof(SHFILEINFO)), SHGFI_ICON | SHGFI_LARGEICON);
        index = info.iIcon;
        return r == IntPtr.Zero ? IntPtr.Zero : info.hIcon;
    }
}
'@

$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk"
Write-Output "快捷方式 : $lnk"

if (-not (Test-Path -LiteralPath $lnk)) {
    Write-Output 'RESULT: FAIL  (快捷方式不存在)'
    exit 1
}

# ---- 1. 回读 .lnk 属性 ----
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$target = $s.TargetPath
$icon   = $s.IconLocation
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
Write-Output "  Target       : $target"
Write-Output "  IconLocation : $icon"
Write-Output "  Description  : $($s.Description)"

# ---- 2. 走 shell 的路径取图标 ----
$idx = 0
$hicon = [ShellIcon]::IconFor($lnk, [ref]$idx)
if ($hicon -eq [IntPtr]::Zero) {
    Write-Output 'RESULT: FAIL  (SHGetFileInfo 没给出图标)'
    exit 1
}
$bmp = [System.Drawing.Icon]::FromHandle($hicon).ToBitmap()
$shot = Join-Path $env:TEMP 'piggy-shortcut-icon.png'
$bmp.Save($shot, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "  图标尺寸     : $($bmp.Width)x$($bmp.Height)  →  $shot"
$bmp.Dispose()
[void][ShellIcon]::DestroyIcon($hicon)

# ---- 3. 数像素：猪的调色板 ----
$py = 'C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$out = & $py (Join-Path $PSScriptRoot 'check-skin-colors.py') $shot '#FFD1AF' '#E95892' '#FF8195' '#FFAFAC' 2>$null
$out | ForEach-Object { Write-Output "  $_" }

# ---- 4. 判据 ----
$body = 0
foreach ($line in $out) {
    if ($line -match '#FFD1AF:\s+(\d+) px') { $body = [int]$Matches[1] }
}

Write-Output ''
if ($body -ge 20 -and $target -like '*piggy-desktop.exe') {
    Write-Output "RESULT: PASS  (shell 解析出的图标就是猪：身体色 #FFD1AF 出现 $body px；快捷方式指向 piggy-desktop.exe)"
    exit 0
} else {
    Write-Output "RESULT: FAIL  (身体色 #FFD1AF 只有 $body px —— 图标多半回落成了通用 .lnk 图标)"
    exit 1
}
