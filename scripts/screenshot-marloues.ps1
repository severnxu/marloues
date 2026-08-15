# Capture the Marloues app window to a PNG.
# Usage: .\screenshot-marloues.ps1 [-Out <path>] [-Title <title>]
param(
  [string]$Out = "C:\workspace\marloues-ui-r2\marloues-shot.png",
  [string]$Title = "Marloues"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class MW {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@

$script:target = $null
$cb = [MW+EnumWindowsProc]{
    param($h, $l)
    if (-not [MW]::IsWindowVisible($h)) { return $true }
    $sb = New-Object System.Text.StringBuilder 256
    $len = [MW]::GetWindowText($h, $sb, 256)
    if ($len -le 0) { return $true }
    $title = $sb.ToString()
    if ($title -like "*$Title*" -and $title -notlike "*Node*" -and $title -notlike "*Electron*") {
        $rect = New-Object MW+RECT
        [MW]::GetWindowRect($h, [ref]$rect) | Out-Null
        if ($rect.Right -gt $rect.Left -and $rect.Bottom -gt $rect.Top) {
            $script:target = [PSCustomObject]@{
                hWnd = $h; title = $title
                x = $rect.Left; y = $rect.Top
                w = $rect.Right - $rect.Left; h = $rect.Bottom - $rect.Top
            }
            return $false
        }
    }
    return $true
}
[MW]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

if (-not $script:target) { Write-Host "NO_MARLOUES_WINDOW"; exit 1 }
Write-Host "Target: $($script:target.title) hWnd=$($script:target.hWnd) at ($($script:target.x),$($script:target.y)) size $($script:target.w)x$($script:target.h)"

[MW]::ShowWindow($script:target.hWnd, 9) | Out-Null
[MW]::SetForegroundWindow($script:target.hWnd) | Out-Null
Start-Sleep -Milliseconds 800

$bmp = New-Object System.Drawing.Bitmap $script:target.w, $script:target.h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($script:target.x, $script:target.y, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "Saved $Out"
