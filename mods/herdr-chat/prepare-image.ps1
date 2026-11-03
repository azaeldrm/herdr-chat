<#
.SYNOPSIS
Copies an image into the chat's preview folder, ready to attach, and prints its path.
Claude Code attaches an @-mentioned image only up to about 256 KB, so a bigger one is
re-encoded as a JPEG under 250 KB with System.Drawing. -Clipboard saves the clipboard's
image instead of reading -Source (exit 3: the clipboard holds no image).
#>
param(
  [string]$Source,
  [Parameter(Mandatory=$true)][string]$Folder,
  [Parameter(Mandatory=$true)][string]$Name,
  [switch]$Clipboard
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$limit = 250000
New-Item -ItemType Directory -Force -Path $Folder | Out-Null

if ($Clipboard) {
  Add-Type -AssemblyName System.Windows.Forms
  $picture = [System.Windows.Forms.Clipboard]::GetImage()
  if (-not $picture) { exit 3 }
  $Source = Join-Path $Folder "$Name-clipboard.png"
  $picture.Save($Source, [System.Drawing.Imaging.ImageFormat]::Png)
  $picture.Dispose()
}

$ext = [System.IO.Path]::GetExtension($Source).ToLowerInvariant()
if (-not $ext) { $ext = '.png' }
if ((Get-Item -LiteralPath $Source).Length -le $limit) {
  $out = Join-Path $Folder "$Name$ext"
  Copy-Item -LiteralPath $Source -Destination $out -Force
} else {
  $out = Join-Path $Folder "$Name.jpg"
  $image = [System.Drawing.Image]::FromFile($Source)
  try {
    $scale = [Math]::Min(1.0, 2000.0 / [Math]::Max($image.Width, $image.Height))
    $w = [int][Math]::Max(1, $image.Width * $scale); $h = [int][Math]::Max(1, $image.Height * $scale)
    $bitmap = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.Clear([System.Drawing.Color]::White)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($image, 0, 0, $w, $h)
    $g.Dispose()
  } finally { $image.Dispose() }
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  foreach ($quality in 85, 70, 55, 40, 30) {
    $params = New-Object System.Drawing.Imaging.EncoderParameters 1
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$quality)
    $bitmap.Save($out, $codec, $params)
    if ((Get-Item -LiteralPath $out).Length -le $limit) { break }
  }
  $bitmap.Dispose()
}
if ($Clipboard) { Remove-Item -LiteralPath $Source -Force }
Write-Output $out
