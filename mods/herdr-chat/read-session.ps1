param(
  [Parameter(Mandatory=$true)][string]$App,
  [long]$TermPid = 0,
  [long]$CreatedMs = 0,
  [string]$Cwd = '',
  [string]$KnownPath = '',
  [string]$Hint = '',
  [long]$Offset = 0,
  [string]$Leaf = ''
)
$ErrorActionPreference = 'Stop'
$UserHome = $env:USERPROFILE
$Ellipsis = [string][char]0x2026
$MaxEntries = 400

function Esc([string]$s) { return [uri]::EscapeDataString($s) }
function Leaf([string]$p) {
  $p = ([string]$p).Trim().TrimEnd('\', '/')
  $i = [Math]::Max($p.LastIndexOf('\'), $p.LastIndexOf('/'))
  if ($i -ge 0) { return $p.Substring($i + 1) } else { return $p }
}
function Short([string]$s, [int]$max) {
  $s = ([string]$s -replace '\s+', ' ').Trim()
  if ($s.Length -gt $max) { return $s.Substring(0, $max) + $Ellipsis } else { return $s }
}
function Clip([string]$s) {
  $s = ([string]$s -replace "`r", '').TrimEnd()
  if ($s.Length -gt 12000) { return $s.Substring(0, 12000) + "`n" + $Ellipsis } else { return $s }
}
function Done([string]$note) { Write-Output 'PATH|'; Write-Output ('NOTE|' + (Esc $note)); exit 0 }

$entries = [System.Collections.Generic.List[object]]::new()
function Add-Message([string]$role, [string]$phase, [string]$text) {
  $text = ([string]$text).Trim()
  if (-not $text) { return }
  if ($text.Length -gt 12000) { $text = $text.Substring(0, 12000) + "`n" + $Ellipsis }
  $entries.Add(@{ kind='message'; role=$role; phase=$phase; text=$text })
}
function Add-Reasoning([string]$text) {
  $text = ([string]$text).Trim()
  if (-not $text) { return }
  if ($text.Length -gt 12000) { $text = $text.Substring(0, 12000) + "`n" + $Ellipsis }
  $entries.Add(@{ kind='reasoning'; text=$text })
}

function Add-Call($call, [string]$id) { $entries.Add(@{ kind='call'; id=$id; call=$call }) }
function Set-Output([string]$id, [string]$text) {
  if ($id) { $entries.Add(@{ kind='out'; id=$id; text=(Clip $text) }) }
}
function Content-Text($content) {
  if ($content -is [string]) { return $content }
  return (@($content) | ForEach-Object {
    if ($_.type -eq 'text' -or $_.type -eq 'input_text' -or $_.type -eq 'output_text') { [string]$_.text }
    elseif ($_.type -eq 'image') { '[Image]' }
  }) -join "`n"
}

function Read-Tail([string]$path) {
  $file = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
  try {
    $length = $file.Length
    $script:Fresh = $Offset -le 0 -or $Offset -gt $length -or -not [string]::Equals($path, $KnownPath, [StringComparison]::OrdinalIgnoreCase)
    $start = if ($script:Fresh) { [Math]::Max(0, $length - 24MB) } else { $Offset }
    $script:Clipped = $script:Fresh -and $start -gt 0
    $count = [int]($length - $start)
    $bytes = New-Object byte[] $count
    [void]$file.Seek($start, [System.IO.SeekOrigin]::Begin)
    $read = 0
    while ($read -lt $count) { $n = $file.Read($bytes, $read, $count - $read); if ($n -le 0) { break }; $read += $n }
    $end = if ($read -gt 0) { [Array]::LastIndexOf($bytes, [byte]10, $read - 1) } else { -1 }
    if ($end -lt 0) { $script:NextOffset = $start; return @() }
    $script:NextOffset = $start + $end + 1
    $text = [System.Text.Encoding]::UTF8.GetString($bytes, 0, $end + 1)
    $lines = $text -split "`n"
    if ($script:Clipped) { $lines = $lines | Select-Object -Skip 1 }
    return $lines
  } finally { $file.Dispose() }
}

function Claude-Call([string]$name, $in) {
  switch -Regex ($name) {
    '^(Bash|PowerShell)$' { return @{ k='shell'; d=(Short $in.command 400) } }
    '^Read$' { return @{ k=$(if ($in.file_path -match '\.(png|jpe?g|gif|webp)$') { 'image' } else { 'read' }); d=(Leaf $in.file_path) } }
    '^(Edit|MultiEdit|Write)$' { return @{ k='edit'; d=(Leaf $in.file_path); n=1 } }
    '^NotebookEdit$' { return @{ k='edit'; d=(Leaf $in.notebook_path); n=1 } }
    '^(Grep|Glob)$' { return @{ k='search'; d=(Short $in.pattern 200) } }
    '^WebFetch$' { return @{ k='web'; d=(Short $in.url 200) } }
    '^WebSearch$' { return @{ k='web'; d=(Short $in.query 200) } }
    '^(Agent|Task)$' { return @{ k='agent'; d=(Short $in.description 200) } }
    '^(TodoWrite|TaskCreate|TaskUpdate)$' { return @{ k='todo'; d='' } }
    '^Skill$' { return @{ k='other'; d=('Skill · ' + $in.skill) } }
    '^mcp__' { return @{ k='other'; d=(($name -replace '^mcp__', '') -replace '__', ' · ') } }
    default { return @{ k='other'; d=$name } }
  }
}
function Claude-UserText([string]$t) {
  $t = [regex]::Replace($t, '(?s)<system-reminder>.*?</system-reminder>', '')
  if ($t -match '(?s)The user sent a new message while you were working:\s*\r?\n(.*?)(\r?\n\s*\r?\nThis is how Claude Code surfaces|$)') { return $Matches[1] }
  if ($t -match '<command-name>([^<]*)</command-name>') {
    $cmd = $Matches[1].Trim()
    $cmdArgs = if ($t -match '(?s)<command-args>(.*?)</command-args>') { $Matches[1].Trim() } else { '' }
    return ($cmd + ' ' + $cmdArgs).Trim()
  }
  if ($t -match '(?s)<bash-input>(.*?)</bash-input>') { return '! ' + $Matches[1].Trim() }
  if ($t -match '^\s*<(local-command-stdout|local-command-caveat|bash-stdout|bash-stderr|task-notification)') { return '' }
  if ($t -match '^\s*\[Image: original') { return '' }
  return $t
}
function Find-Claude {
  $dir = Join-Path $UserHome '.claude\sessions'
  if (-not (Test-Path -LiteralPath $dir)) { return $null }
  $info = $null
  if ($Hint) {
    $f = Join-Path $dir ($Hint + '.json')
    if (Test-Path -LiteralPath $f) { try { $info = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json } catch { } }
  }
  if (-not $info -and $TermPid) {
    $parent = @{}
    Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId | ForEach-Object { $parent[[long]$_.ProcessId] = [long]$_.ParentProcessId }
    foreach ($f in Get-ChildItem -LiteralPath $dir -Filter '*.json' -File) {
      try { $s = Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json } catch { continue }
      $p = [long]$s.pid
      for ($i = 0; $i -lt 8 -and $p; $i++) {
        $p = $parent[$p]
        if ($p -eq $TermPid) { $info = $s; break }
      }
      if ($info) { break }
    }
  }
  if (-not $info) { return $null }
  $script:NewHint = [string]$info.pid
  $projects = Join-Path $UserHome '.claude\projects'
  $guess = Join-Path $projects ((([string]$info.cwd) -replace '[^A-Za-z0-9]', '-') + '\' + $info.sessionId + '.jsonl')
  if (Test-Path -LiteralPath $guess) { return $guess }
  foreach ($d in Get-ChildItem -LiteralPath $projects -Directory) {
    $p = Join-Path $d.FullName ($info.sessionId + '.jsonl')
    if (Test-Path -LiteralPath $p) { return $p }
  }
  $script:WaitingNote = 'Claude Code hasn''t written this conversation yet. Send a message to start it.'
  return $null
}
$ClaudeKept = 50

function Claude-Records($lines) {
  # The log's tree nodes in file order: u (uuid), p (parent), o (the entry, if user/assistant), v (shows text).
  $recs = [System.Collections.Generic.List[object]]::new()
  foreach ($line in $lines) {
    if ($line.Length -lt 20 -or -not $line.StartsWith('{"parentUuid":')) { continue }
    if ($line.Substring(0, [Math]::Min(300, $line.Length)).Contains('"isSidechain":true')) { continue }
    if ($line -match '"type":"(user|assistant)"') {
      $o = $null
      try { $o = $line | ConvertFrom-Json } catch { }
      if ($o -and ($o.type -eq 'user' -or $o.type -eq 'assistant') -and $o.uuid) {
        $content = $o.message.content
        $shows = ($content -is [string]) -or (@(@($content) | Where-Object { $_.type -eq 'text' }).Count -gt 0)
        $p = if ($o.parentUuid) { [string]$o.parentUuid } else { [string]$o.logicalParentUuid }
        $recs.Add([pscustomobject]@{ u = [string]$o.uuid; p = $p; o = $o; v = ($shows -and -not $o.isMeta) })
        continue
      }
    }
    $ids = [regex]::Matches($line, '"uuid":"([0-9a-f-]{36})"')
    if ($ids.Count -eq 0) { continue }
    $m = [regex]::Match($line, '^\{"parentUuid":(?:null|"([^"]+)")')
    $p = if ($m.Groups[1].Success) { $m.Groups[1].Value } else {
      $l = [regex]::Match($line, '"logicalParentUuid":"([^"]+)"'); if ($l.Success) { $l.Groups[1].Value } else { '' } }
    $recs.Add([pscustomobject]@{ u = $ids[$ids.Count - 1].Groups[1].Value; p = $p; o = $null; v = $false })
  }
  return ,$recs
}

function Claude-Branch($recs, $known) {
  # The live branch through these nodes to the newest one, and the known tail it continues (base $null when none).
  $any = $false
  foreach ($r in $recs) { if ($r.o) { $any = $true; break } }
  if (-not $any) { return @{ path = @(); base = $known } }
  $by = @{}
  foreach ($r in $recs) { $by[$r.u] = $r }
  $path = [System.Collections.Generic.List[object]]::new()
  $seen = @{}
  $x = $recs[$recs.Count - 1]
  while ($x -and -not $seen.ContainsKey($x.u)) {
    $seen[$x.u] = $true; $path.Add($x)
    $x = if ($x.p) { $by[$x.p] } else { $null }
  }
  $path.Reverse()
  if ($script:Fresh) { return @{ path = $path; base = [System.Collections.Generic.List[string]]::new() } }
  $joint = [string]$path[0].p
  $at = -1
  for ($i = 0; $i -lt $known.Count; $i++) { if ($known[$i].StartsWith($joint + '.')) { $at = $i; break } }
  if (-not $joint -or $at -lt 0) { return @{ path = $path; base = $null } }
  for ($i = $at + 1; $i -lt $known.Count; $i++) { if ($known[$i].EndsWith('.v')) { return @{ path = $path; base = $null } } }
  return @{ path = $path; base = $known.GetRange(0, $at + 1) }
}

function Parse-Claude([string]$path) {
  $lines = Read-Tail $path
  $known = [System.Collections.Generic.List[string]]::new()
  foreach ($k in $Leaf.Split(',')) { if ($k.Contains('.')) { $known.Add($k) } }
  $recs = Claude-Records $lines
  $b = Claude-Branch $recs $known
  if ($null -eq $b.base) { $script:Offset = 0; Parse-Claude $path; return }
  if ($b.path.Count -eq 0) { $script:Chain = $Leaf; return }
  $on = @{}
  $mids = @{}
  foreach ($r in $b.path) {
    $on[$r.u] = $true
    if ($r.o -and $r.o.type -eq 'assistant' -and $r.o.message.id) { $mids[[string]$r.o.message.id] = $true }
  }
  foreach ($r in $recs) {
    if (-not $r.o) { continue }
    if ($on.ContainsKey($r.u) -or ($r.o.type -eq 'assistant' -and $r.o.message.id -and $mids.ContainsKey([string]$r.o.message.id))) { Claude-Entry $r.o }
    elseif ($r.o.type -eq 'user') {
      foreach ($c in @($r.o.message.content)) { if ($c.type -eq 'tool_result') { Set-Output ([string]$c.tool_use_id) (Content-Text $c.content) } }
    }
  }
  $all = [System.Collections.Generic.List[string]]::new($b.base)
  foreach ($r in $b.path) { $all.Add($r.u + '.' + $(if ($r.v) { 'v' } else { 't' })) }
  $from = [Math]::Max(0, $all.Count - $ClaudeKept)
  $script:Chain = $all.GetRange($from, $all.Count - $from) -join ','
}

function Claude-Entry($o) {
  if ($o.isSidechain -or $o.isMeta -or $o.isCompactSummary) { return }
  $content = $o.message.content
  if ($o.type -eq 'user') {
    if ($content -is [string]) { Add-Message 'user' '' (Claude-UserText $content); return }
    $texts = [System.Collections.Generic.List[string]]::new()
    foreach ($c in @($content)) {
      if ($c.type -eq 'tool_result') { Set-Output ([string]$c.tool_use_id) (Content-Text $c.content) }
      elseif ($c.type -eq 'text') { $t = Claude-UserText ([string]$c.text); if ($t.Trim()) { $texts.Add($t) } }
      elseif ($c.type -eq 'image') { $texts.Add('[Image attached]') }
    }
    if ($texts.Count) { Add-Message 'user' '' ($texts -join "`n") }
    return
  }
  foreach ($c in @($content)) {
    if ($c.type -eq 'text') { Add-Message 'assistant' 'final' ([string]$c.text) }
    elseif ($c.type -eq 'thinking') { Add-Reasoning ([string]$c.thinking) }
    elseif ($c.type -eq 'tool_use') { Add-Call (Claude-Call ([string]$c.name) $c.input) ([string]$c.id) }
  }
}

function Unquote([string]$s) { try { return [string](ConvertFrom-Json ('"' + $s + '"')) } catch { return $s } }
function Codex-Call([string]$tool, [string]$src, [string]$whole) {
  $q = '"((?:[^"\\]|\\.)*)"'
  switch ($tool) {
    'exec_command' {
      $m = [regex]::Match($src, '"?cmd"?\s*:\s*' + $q)
      return @{ k='shell'; d=$(if ($m.Success) { Short (Unquote $m.Groups[1].Value) 400 } else { '' }) }
    }
    'apply_patch' {
      $pattern = '\*\*\* (?:Add|Update|Delete) File: (.+?)(?=\\n|\r?\n|"|`|$)'
      $found = [regex]::Matches($src, $pattern)
      if (-not $found.Count) { $found = [regex]::Matches($whole, $pattern) }
      $files = @($found | ForEach-Object { Leaf ($_.Groups[1].Value -replace '\\\\', '\') } | Select-Object -Unique)
      return @{ k='edit'; d=($files -join ', '); n=[Math]::Max(1, $files.Count) }
    }
    'view_image' {
      $m = [regex]::Match($src, '"?path"?\s*:\s*' + $q)
      return @{ k='image'; d=$(if ($m.Success) { Leaf (Unquote $m.Groups[1].Value) } else { '' }) }
    }
    'web__run' {
      $m = [regex]::Match($src, '"?q(?:uery)?"?\s*:\s*' + $q)
      return @{ k='web'; d=$(if ($m.Success) { Short (Unquote $m.Groups[1].Value) 160 } else { '' }) }
    }
    default { return @{ k='other'; d=$tool } }
  }
}
function Codex-Output($payload) {
  $text = Content-Text $payload.output
  $text = $text -replace '^Script completed\s*\r?\nWall time[^\n]*\n(Output:\s*\n)?', ''
  $text = $text -replace '^Wall time:[^\n]*\n', ''

  if ($text.TrimStart().StartsWith('{') -and $text -match '"(chunk_id|output)":') {
    $outs = [regex]::Matches($text, '"output":"((?:[^"\\]|\\.)*)"') | ForEach-Object { Unquote $_.Groups[1].Value }
    if (@($outs).Count) { $text = (@($outs) | Where-Object { $_.Trim() }) -join "`n" } else { $text = '' }
  }
  if ($text.Trim() -eq '{}') { $text = '' }
  return $text
}
function Find-Codex {
  if ($KnownPath -and (Test-Path -LiteralPath $KnownPath -PathType Leaf)) { return $KnownPath }
  $root = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $UserHome '.codex' }
  $sessions = Join-Path $root 'sessions'
  if (-not (Test-Path -LiteralPath $sessions)) { return $null }
  $created = [DateTimeOffset]::FromUnixTimeMilliseconds($CreatedMs)
  $since = $created.LocalDateTime.AddSeconds(-10)
  $later = $null
  $candidates = Get-ChildItem -LiteralPath $sessions -Filter 'rollout-*.jsonl' -File -Recurse |
    Where-Object { $_.LastWriteTime -ge $since } | Sort-Object LastWriteTime -Descending
  foreach ($file in $candidates) {
    try {
      $first = Get-Content -LiteralPath $file.FullName -TotalCount 1 | ConvertFrom-Json
      if ($first.type -ne 'session_meta') { continue }
      if (-not [string]::Equals([string]$first.payload.cwd, $Cwd, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $delta = ([DateTimeOffset]::Parse($first.payload.timestamp) - $created).TotalSeconds
      if ([Math]::Abs($delta) -le 8) { return $file.FullName }
      if ($delta -gt 0 -and -not $later) { $later = $file.FullName }
    } catch { continue }
  }
  return $later
}
function Parse-Codex([string]$path) {
  foreach ($line in (Read-Tail $path)) {
    if ($line -notmatch '"type":"response_item"') { continue }
    try { $item = $line | ConvertFrom-Json } catch { continue }
    $p = $item.payload; $ptype = [string]$p.type
    if ($ptype -in @('custom_tool_call','function_call')) {
      $tool = [string]$p.name
      $src = if ($ptype -eq 'custom_tool_call') { [string]$p.input } else { [string]$p.arguments }
      $calls = @()
      if ($tool -eq 'exec') {
        $found = [regex]::Matches($src, '(?<![\w.])tools\.(exec_command|apply_patch|view_image|write_stdin|web__run|\w+__\w+)\s*\(')
        for ($i = 0; $i -lt $found.Count; $i++) {
          $start = $found[$i].Index
          $end = if ($i + 1 -lt $found.Count) { $found[$i + 1].Index } else { $src.Length }
          $calls += ,(Codex-Call $found[$i].Groups[1].Value $src.Substring($start, $end - $start) $src)
        }
        if (-not $calls.Count) { $calls += ,@{ k='other'; d='script' } }
      } elseif ($tool) { $calls += ,(Codex-Call $tool $src $src) }
      for ($i = 0; $i -lt $calls.Count; $i++) {
        Add-Call $calls[$i] $(if ($i -eq $calls.Count - 1) { [string]$p.call_id } else { '' })
      }
      continue
    }
    if ($ptype -in @('custom_tool_call_output','function_call_output')) { Set-Output ([string]$p.call_id) (Codex-Output $p); continue }
    if ($ptype -eq 'reasoning') { Add-Reasoning ((@($p.summary) | ForEach-Object { [string]$_.text }) -join "`n`n"); continue }
    if ($ptype -ne 'message') { continue }
    $role = [string]$p.role
    if ($role -ne 'user' -and $role -ne 'assistant') { continue }
    $phase = [string]$p.phase
    if ($role -eq 'assistant' -and $phase -notin @('final','final_answer','commentary')) { continue }
    $body = (Content-Text $p.content).Trim()
    if ($role -eq 'user') {
      if ($body -match '^<(environment_context|user_instructions|permissions)' -or $body.StartsWith('# AGENTS.md')) { continue }
      $body = $body -replace '<image\s+name=\[Image #\d+\]\s+path="[^"]+">', '[Image attached]'
      $body = $body -replace '</image>', '' -replace '\s*\[Image #\d+\]', ''
    }
    Add-Message $role $phase $body
  }
}

function Pi-Call([string]$name, $in) {
  switch ($name) {
    'bash' { return @{ k='shell'; d=(Short $in.command 400) } }
    'read' { return @{ k=$(if ($in.path -match '\.(png|jpe?g|gif|webp)$') { 'image' } else { 'read' }); d=(Leaf $in.path) } }
    { $_ -in @('edit','write') } { return @{ k='edit'; d=(Leaf $in.path); n=1 } }
    { $_ -in @('grep','find','ls') } { return @{ k='search'; d=(Short ($in.pattern, $in.path | Where-Object { $_ } | Select-Object -First 1) 200) } }
    default { return @{ k='other'; d=$name } }
  }
}
function Find-Pi {
  $dir = Join-Path $UserHome ('.pi\agent\sessions\--' + ($Cwd -replace '[\\/:]', '-') + '--')
  if (-not (Test-Path -LiteralPath $dir)) { return $null }

  $since = [DateTimeOffset]::FromUnixTimeMilliseconds($CreatedMs).UtcDateTime.AddSeconds(-10)
  $newest = Get-ChildItem -LiteralPath $dir -Filter '*.jsonl' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if ($newest -and $newest.LastWriteTimeUtc -ge $since) { return $newest.FullName }
  return $null
}
function Parse-Pi([string]$path) {
  $since = if ($CreatedMs) { [DateTimeOffset]::FromUnixTimeMilliseconds($CreatedMs - 10000) } else { $null }
  foreach ($line in (Read-Tail $path)) {
    if ($line -notmatch '"type":"message"') { continue }
    try { $o = $line | ConvertFrom-Json } catch { continue }
    if ($since -and $o.timestamp) {
      try { if ([DateTimeOffset]::Parse([string]$o.timestamp) -lt $since) { continue } } catch { }
    }
    $m = $o.message
    switch ([string]$m.role) {
      'user' {
        Add-Message 'user' '' ((@($m.content) | ForEach-Object { if ($_.type -eq 'text') { [string]$_.text } elseif ($_.type -eq 'image') { '[Image attached]' } }) -join "`n")
      }
      'assistant' {
        foreach ($c in @($m.content)) {
          if ($c.type -eq 'text') { Add-Message 'assistant' 'final' ([string]$c.text) }
          elseif ($c.type -eq 'thinking') { Add-Reasoning ([string]$c.thinking) }
          elseif ($c.type -eq 'toolCall') { Add-Call (Pi-Call ([string]$c.name) $c.arguments) ([string]$c.id) }
        }
      }
      'toolResult' { Set-Output ([string]$m.toolCallId) ((@($m.content) | Where-Object { $_.type -eq 'text' } | ForEach-Object { [string]$_.text }) -join "`n") }
    }
  }
}

$script:NewHint = ''; $script:Clipped = $false; $script:WaitingNote = ''; $script:Fresh = $true; $script:NextOffset = 0; $script:Chain = $null
$label = @{ 'claude-code'='Claude Code'; 'codex'='Codex'; 'pi'='Pi' }[$App]
if (-not $label) { Done "Chat view doesn't read $App sessions yet." }
$path = switch ($App) { 'claude-code' { Find-Claude } 'codex' { Find-Codex } 'pi' { Find-Pi } }
if (-not $path) {
  Write-Output ('HINT|' + (Esc $script:NewHint))
  Done $(if ($script:WaitingNote) { $script:WaitingNote } else { "Waiting for this $label conversation to start." })
}
switch ($App) { 'claude-code' { Parse-Claude $path } 'codex' { Parse-Codex $path } 'pi' { Parse-Pi $path } }
Write-Output ('PATH|' + (Esc $path))
Write-Output ('HINT|' + (Esc $script:NewHint))
Write-Output ('OFFSET|' + $script:NextOffset)
if ($null -ne $script:Chain) { Write-Output ('LEAF|' + (Esc $script:Chain)) }
if ($script:Fresh) { Write-Output 'RESET' }
if ($script:Clipped) { Write-Output 'NOTE|Showing the recent part of this session.' }
if ($script:Fresh -and -not $entries.Count) { Write-Output ('NOTE|' + (Esc 'No messages in this session yet.')) }
$out = if ($script:Fresh) { @($entries | Select-Object -Last $MaxEntries) } else { @($entries) }
foreach ($entry in $out) {
  switch ($entry.kind) {
    'call' { Write-Output ('C|' + (Esc $entry.id) + '|' + (Esc (ConvertTo-Json -InputObject $entry.call -Compress -Depth 3))) }
    'out' { Write-Output ('O|' + (Esc $entry.id) + '|' + (Esc $entry.text)) }
    'reasoning' { Write-Output ('R|' + (Esc $entry.text)) }
    default { Write-Output ('M|' + $entry.role + '|' + $entry.phase + '|' + (Esc $entry.text)) }
  }
}
