# Copies an SVG to the clipboard as a picture (diagram-copy.js): drawn by headless Edge (it comes with Windows) at twice its
# size, then put on the clipboard as both a bitmap and PNG data, so desktop apps and browsers can paste it.
# Arguments: the SVG, where to write the PNG, its width and height in px. Exit 3: no Edge (or Chrome); 4: nothing drawn.
param([string]$Svg, [string]$Png, [int]$Width, [int]$Height)
$ErrorActionPreference = 'Stop'
$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $browser) { exit 3 }
if (Test-Path -LiteralPath $Png) { Remove-Item -LiteralPath $Png -Force }
$url = 'file:///' + ($Svg -replace '\\', '/')
# The browser reports on stderr, which PowerShell 5.1 turns into an error under 'Stop'.
$ErrorActionPreference = 'Continue'
& $browser --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 "--window-size=$Width,$Height" "--screenshot=$Png" $url 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
for ($i = 0; $i -lt 40 -and -not (Test-Path -LiteralPath $Png); $i++) { Start-Sleep -Milliseconds 100 }
if (-not (Test-Path -LiteralPath $Png)) { exit 4 }
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bytes = [IO.File]::ReadAllBytes($Png)
$image = [Drawing.Image]::FromStream((New-Object IO.MemoryStream(, $bytes)))
$data = New-Object Windows.Forms.DataObject
$data.SetImage($image)
$data.SetData('PNG', (New-Object IO.MemoryStream(, $bytes)))
[Windows.Forms.Clipboard]::SetDataObject($data, $true)
