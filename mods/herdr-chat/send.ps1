param(
  [Parameter(Mandatory=$true)][string]$Address,
  [Parameter(Mandatory=$true)][string]$Text64,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Text64))

function Quote([string]$s) {
  $s = [regex]::Replace($s, '(\\*)"', { param($m) ($m.Groups[1].Value * 2) + '\"' })
  $s = [regex]::Replace($s, '(\\+)$', { param($m) $m.Groups[1].Value * 2 })
  return '"' + $s + '"'
}
$hcArgs = @('send')
if ($Force) { $hcArgs += '--force' }
$hcArgs += @($Address, $text)

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = (Get-Command hc -CommandType Application | Select-Object -First 1).Source
$psi.Arguments = ($hcArgs | ForEach-Object { Quote $_ }) -join ' '
$psi.UseShellExecute = $false
$psi.RedirectStandardError = $true
$psi.EnvironmentVariables.Remove('HC_TERMINAL_ID')
$psi.EnvironmentVariables.Remove('HC_SCOPE')
$p = [System.Diagnostics.Process]::Start($psi)
$err = $p.StandardError.ReadToEnd()
$p.WaitForExit()
if ($p.ExitCode -ne 0) { [Console]::Error.WriteLine($err) }
exit $p.ExitCode
