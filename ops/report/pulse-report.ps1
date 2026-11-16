param(
    [ValidateSet('Prepare','Submit')][string]$Action = 'Prepare',
    [Parameter(Mandatory=$true)][string]$WorkDir,
    [string]$Server = 'http://192.168.16.70:4185',
    [string]$Label,
    [string]$ExcludeSessionId,
    [string]$SummarizerTool = 'codex',
    [switch]$IncludeEvidence,
    [string]$StateDir = $PSScriptRoot,
    [string]$GitHubLogin,
    [switch]$ResolveGit
)
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false, $true)
function Hash([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function StableId([string]$Value) {
    [guid]::ParseExact((Hash $Value).Substring(0,32), 'N').ToString()
}
function WriteJson($Path, $Value) {
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 20 -Compress), $utf8)
}
function UsageTotals($Rows) {
    $result=@{events=@($Rows).Count;input_tokens=0L;cached_input_tokens=0L;output_tokens=0L}
    foreach ($row in $Rows) { foreach ($key in @('input_tokens','cached_input_tokens','output_tokens')) { $result[$key]+=[long]$row.$key } }
    return $result
}
function Request($Route, $BodyPath) {
    $argsForCurl = @('-q','-fsS','--noproxy','*','--connect-timeout','2','--max-time','4',
        '-H',"X-Pulse-LAN-Device: $deviceKey")
    if ($BodyPath) {
        if ($GitHubLogin) { $argsForCurl+=@('-H',"X-Pulse-LAN-GitHub: $GitHubLogin") }
        if ($Label) { $argsForCurl += @('-H',('X-Pulse-LAN-Label: ' + [uri]::EscapeDataString($Label))) }
        $argsForCurl += @('-H','Content-Type: application/json','--data-binary',('@' + $BodyPath))
    }
    $response = & curl.exe @argsForCurl ($Server.TrimEnd('/') + $Route)
    if ($LASTEXITCODE -ne 0) { throw "Project Pulse request failed ($LASTEXITCODE): $Route" }
    ($response -join "`n") | ConvertFrom-Json
}
$uri = [uri]$Server
if ($uri.Scheme -ne 'http' -or $uri.Host -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' -or
    $uri.HostNameType -ne 'IPv4' -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) {
    throw 'Use the configured private IPv4 HTTP origin.'
}
$machine = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography').MachineGuid
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if (!$machine -or !$userSid) { throw 'Missing local device identity.' }
$deviceKey = Hash "$machine`n$userSid"
if ($SummarizerTool -notmatch '^[a-z][a-z0-9_]{0,63}$') { throw 'Invalid summarizer tool ID.' }
$WorkDir = [IO.Path]::GetFullPath($WorkDir)
$planPath = Join-Path $WorkDir 'plan.json'
$editsPath = Join-Path $WorkDir 'summaries.json'

if ($Action -eq 'Submit') {
    $plan = Get-Content -LiteralPath $planPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!$Label) { $Label=$plan.label }
    if (!$GitHubLogin) { $GitHubLogin=$plan.github_login }
    $edits = @()
    if ([IO.File]::Exists($editsPath)) { $edits = @(Get-Content -LiteralPath $editsPath -Raw -Encoding UTF8 | ConvertFrom-Json) }
    $sent = 0
    $alreadyCommitted = 0
    $receipts=@()
    foreach ($batch in $plan.batches) {
        $source = $batch.cursor.source_id
        $edit = @($edits | Where-Object { $_.source_id -eq $source })
        if ($edit.Count -gt 1) { throw "Duplicate summary for $source" }
        if ($edit.Count) {
            $session = @($batch.sessions | Select-Object -First 1)[0]
            $end = $batch.cursor.to_offset
            if ($edit[0].summary -and $session -and $batch.cursor.from_offset -ne $end) {
                $batch.summaries = @(@{summary_id=(StableId "codex:summary:${source}:$end"); session_id=$source;
                    observed_at=$session.last_activity_at; summary=$edit[0].summary; summarizer_tool=$SummarizerTool; prompt_version='2.1.0'})
            }
            if ($edit[0].goal -and $edit[0].milestones -and $session) {
                $project = if ($session.repository) { $session.repository } else { $session.workspace_name }
                if ($project) {
                    $batch.projects = @(@{report_id=(StableId "codex:project:${source}:${end}:$project"); source_session_id=$source;
                        project_key=$project; goal=$edit[0].goal; milestones=@($edit[0].milestones);
                        observed_at=$session.last_activity_at; summarizer_tool=$SummarizerTool; prompt_version='2.1.0'})
                }
            }
        }
        $bodyPath = Join-Path $WorkDir "$($batch.batch_id).json"
        if (![IO.File]::Exists($bodyPath)) { WriteJson $bodyPath $batch }
        try { $receipt = Request '/api/v1/reports' $bodyPath }
        catch {
            $previousError = $_
            $current = Request "/api/v1/report-cursor?source_id=$source"
            if ([long]$current.offset -ge [long]$batch.cursor.to_offset) {
                $alreadyCommitted++
                continue
            }
            throw $previousError
        }
        if ($receipt.status -ne 'committed' -or $receipt.batch_id -ne $batch.batch_id -or $receipt.to_offset -ne $batch.cursor.to_offset) {
            throw "Unexpected receipt for $($batch.batch_id)"
        }
        if (!$receipt.usage) { throw 'Missing server usage receipt; update the server.' }
        $expected=UsageTotals @($batch.usage)
        foreach ($key in @('events','input_tokens','cached_input_tokens','output_tokens')) {
            if ($null -eq $receipt.usage.$key -or [long]$receipt.usage.$key -ne $expected[$key]) { throw "Server usage mismatch: $key" }
        }
        $receipts+=@{batch_id=$batch.batch_id;usage=$receipt.usage}
        $sent++
    }
    @{submitted_batches=$sent; server_cursor_already_advanced=$alreadyCommitted;receipts=$receipts;usage_verified=($alreadyCommitted -eq 0); bytes_read=$plan.bytes_read; backlog=$plan.backlog} | ConvertTo-Json -Depth 10 -Compress
    return
}

if (Test-Path -LiteralPath $WorkDir) { throw 'Prepare requires a new working directory.' }
[void][IO.Directory]::CreateDirectory($WorkDir)
$directory=Request '/api/v1/report-directory'
if ($directory.protocol_version -lt 3) { throw 'Server upgrade required: protocol 3 usage receipts.' }
if ($GitHubLogin) {
    if ($GitHubLogin -notmatch '^[a-zA-Z0-9-]{1,39}$') { throw 'Invalid GitHub login.' }
    $matchesForLogin=@($directory.members | Where-Object { $_.github_login -eq $GitHubLogin })
    if (!$Label) { $Label=if ($matchesForLogin.Count -eq 1) {$matchesForLogin[0].display_name} else {$GitHubLogin} }
}
[void][IO.Directory]::CreateDirectory($StateDir)
$statePath=Join-Path $StateDir ('.pulse-state-'+(Hash $Server.TrimEnd('/')).Substring(0,12)+'.json')
$scanState=if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } else {
    [pscustomobject]@{report_from=[DateTime]::UtcNow.AddDays(-7).ToString('yyyy-MM-ddTHH:mm:ssZ');next_index=0;label=$null;github_login=$null;excluded=@();first_user_seen=@();pending_work=$null;recovery_unverified=$false}
}
if (!$Label) { $Label=$scanState.label }; $scanState.label=$Label
if (!$GitHubLogin) { $GitHubLogin=$scanState.github_login }; $scanState.github_login=$GitHubLogin
if ($scanState.pending_work -and (Test-Path -LiteralPath (Join-Path $scanState.pending_work 'plan.json'))) {
    $recovery=& $PSCommandPath -Action Submit -WorkDir $scanState.pending_work -Server $Server
    $recovered=($recovery -join "`n") | ConvertFrom-Json
    $scanState.recovery_unverified=(!$recovered.usage_verified)
    $scanState.pending_work=$null
}
$known=@{}; foreach ($s in $directory.sources) { $known[$s.source_id]=$true }
$root = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'sessions' } else { Join-Path $HOME '.codex/sessions' }
$cutoff = ([DateTimeOffset]$scanState.report_from).UtcDateTime
$files = @(Get-ChildItem -Path (Join-Path $root '*/*/*/*.jsonl') -File -ErrorAction SilentlyContinue |
    Where-Object { ($_.LastWriteTimeUtc -ge $cutoff -or ($_.Name -match '([a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})' -and $known[$Matches[1]])) -and !($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
    Sort-Object LastWriteTimeUtc,FullName)
# Rotate the bounded scan so unchanged files cannot permanently hide later files.
if ($files.Count) {
    $start = [int]($scanState.next_index % $files.Count)
    if ($start -gt 0) { $files = @($files[$start..($files.Count-1)] + $files[0..($start-1)]) }
}
$batches = @()
$evidence = @()
$bytesRead = 0
$backlog = $false
$skips = @{}
$checked = 0
$cursorQueries=0; $unchanged=0; $excluded=0; $initialSnapshots=0; $counterResets=0; $unmeasured=0
$scanClock = [Diagnostics.Stopwatch]::StartNew()
$seenSources = @{}
foreach ($file in $files) {
    if ($checked -ge 8 -or $bytesRead -ge 1048576 -or $scanClock.Elapsed.TotalSeconds -ge 12) { $backlog = $true; break }
    $checked++
    $stream = [IO.File]::Open($file.FullName,'Open','Read','ReadWrite')
    try {
        # Recent Codex builds can emit a session_meta line larger than 16 KiB
        # because it includes the resolved instruction set. Keep this bounded,
        # while allowing the first JSONL record to be decoded reliably.
        $headStream=[IO.MemoryStream]::new()
        try {
            $found=$false
            while (!$found -and $bytesRead -lt 1048576) {
                $chunk=New-Object byte[] ([Math]::Min(4096,1048576-$bytesRead))
                $read=$stream.Read($chunk,0,$chunk.Length)
                if (!$read) { break }
                $bytesRead+=$read; $headStream.Write($chunk,0,$read)
                $found=([Array]::IndexOf($chunk,[byte]10,0,$read) -ge 0)
            }
            $head=$headStream.ToArray(); $n=$head.Length
        } finally { $headStream.Dispose() }
        if ($n -eq 0) { continue }
        $lf = [Array]::IndexOf($head,[byte]10,0,$n)
        if ($lf -lt 0) { $skips[[string]$checked]='metadata_exceeds_budget_or_incomplete'; continue }
        $meta = $utf8.GetString($head,0,$lf) | ConvertFrom-Json
        $source = [string]$meta.payload.id
        if ($meta.type -ne 'session_meta' -or $source -notmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or
            $meta.payload.source.subagent -or $meta.payload.parent_thread_id -or $source -eq $ExcludeSessionId -or
            $source -in $scanState.excluded) { $excluded++; continue }
        if ($seenSources.ContainsKey($source)) { $skips[[string]$checked]='duplicate_source'; continue }
        $seenSources[$source] = $true
        $cursor = Request "/api/v1/report-cursor?source_id=$source"
        $cursorQueries++
        $from = [long]$cursor.offset
        if ($stream.Length -eq $from) { $unchanged++; continue }
        if ($stream.Length -lt $from) { $skips[[string]$checked]='file_truncated'; continue }
        $buffer = New-Object byte[] ([Math]::Min($stream.Length-$from,1048576-$bytesRead))
        [void]$stream.Seek($from,'Begin')
        $n = $stream.Read($buffer,0,$buffer.Length)
        $bytesRead += $n
        $end = $from
        $model = $cursor.context.model
        $counts = $cursor.context
        $sourceCutoff=if ($cursor.context.report_from) { ([DateTimeOffset]$cursor.context.report_from).UtcDateTime } elseif ($from -gt 0) { [DateTime]::MinValue } else {$cutoff}
        $reportFrom=if ($sourceCutoff -eq [DateTime]::MinValue) {'1970-01-01T00:00:00Z'} else {$sourceCutoff.ToString('yyyy-MM-ddTHH:mm:ssZ')}
        $usage = @()
        $activity = $null
        $state = if ($cursor.agent_state) { $cursor.agent_state } else { 'unknown' }
        $notes = @()
        $main = StableId "codex:agent:$source"
        $lineStart = 0
        for ($i=0; $i -lt $n; $i++) {
            if (($i % 4096) -eq 0 -and $scanClock.Elapsed.TotalSeconds -ge 12) { break }
            if ($buffer[$i] -ne 10) { continue }
            try { $row = $utf8.GetString($buffer,$lineStart,$i-$lineStart) | ConvertFrom-Json }
            catch { $skips[[string]$checked]='invalid_log_line'; break }
            $position = $from+$lineStart
            $lineStart = $i+1
            $end = $from+$lineStart
            $p = $row.payload
            if ($source -notin $scanState.first_user_seen -and $row.type -eq 'event_msg' -and $p.type -eq 'user_message') {
                $scanState.first_user_seen=@($scanState.first_user_seen)+@($source)
                if ([string]$p.message -match '^PROJECT_PULSE_AUTOMATION(?:\b|\u3002)') {
                    $scanState.excluded=@($scanState.excluded)+@($source)
                    $end=$from; $usage=@(); $skips[[string]$checked]='reporting_session'; break
                }
            }
            if ($row.type -eq 'turn_context' -and $p.model -match '^[\w./:-]{1,100}$') { $model = $p.model }
            if ($row.type -ne 'event_msg' -or !$row.timestamp) { continue }
            $recent = ([DateTimeOffset]$row.timestamp).UtcDateTime -ge $sourceCutoff
            switch ($p.type) {
                'task_started' { if ($recent) { $activity=$row.timestamp; $state='running' } }
                'turn_aborted' { if ($recent) { $activity=$row.timestamp; $state='idle' } }
                'task_complete' {
                    if ($recent) {
                        $activity=$row.timestamp; $state='completed'
                        $note = if ($IncludeEvidence) { ([string]$p.last_agent_message -replace '(?s)```.*?(```|$)|https?://\S+|\S+@\S+|[A-Za-z]:[\\/]\S+|(?:^|\s)/\S+|(?:\b\S*(?:token|secret|password|api[_-]?key)\S*|\S{0,8}(?:密码|口令|令牌))\s*[:=\uff1a]\s*\S+',' [redacted] ') -replace '\s+',' ' } else { '' }
                        if ($IncludeEvidence -and $note.Trim()) { $notes = @($notes + $note.Substring(0,[Math]::Min(240,$note.Length)) | Select-Object -Last 2) }
                    }
                }
                'token_count' {
                    $total = $p.info.total_token_usage
                    if (!$total) { break }
                    $keys = @('input_tokens','cached_input_tokens','output_tokens')
                    $delta = @{}
                    $initial=($null -eq $counts.input_tokens -and $null -eq $counts.output_tokens)
                    $reset=$false
                    foreach ($key in $keys) { if ($null -ne $counts.$key -and $null -ne $total.$key -and $total.$key -lt $counts.$key) { $reset=$true } }
                    if ($initial) { $initialSnapshots++ }; if ($reset) { $counterResets++ }
                    foreach ($key in $keys) {
                        $last=$p.info.last_token_usage.$key
                        $delta[$key] = if ($reset) {
                            if ($null -ne $last -and $last -ge 0 -and $null -ne $total.$key -and $last -le $total.$key) { [long]$last } else { $null }
                        } elseif ($initial -and $null -ne $total.$key) {
                            $started=if ($meta.payload.timestamp) {$meta.payload.timestamp} else {$meta.timestamp}
                            if ($started -and ([DateTimeOffset]$started).UtcDateTime -ge $sourceCutoff) { [long]$total.$key }
                            elseif ($null -ne $last -and $last -ge 0 -and $last -le $total.$key) { [long]$last } else {$null}
                        } elseif ($null -ne $total.$key -and $null -ne $counts.$key -and $total.$key -ge $counts.$key) {
                            [long]$total.$key - [long]$counts.$key
                        } else { $null }
                    }
                    $counts = $total
                    if ($recent -and @($keys | Where-Object {$null -eq $delta[$_]}).Count) { $unmeasured++ }
                    if ($recent -and ($delta.input_tokens -gt 0 -or $delta.output_tokens -gt 0)) {
                        if ($delta.cached_input_tokens -gt $delta.input_tokens -and $null -ne $delta.input_tokens) { $delta.cached_input_tokens=$null }
                        $activity=$row.timestamp
                        $usage += ($delta + @{event_id=(StableId "codex:usage:${source}:$position"); session_id=$source; agent_id=$main;
                            occurred_at=([DateTimeOffset]$row.timestamp).UtcDateTime.ToString('o'); provider=$null; model=$model; accounting='billable'})
                    }
                }
            }
            if ($usage.Count -ge 90) { break }
        }
        if ($end -lt $stream.Length) { $backlog = $true }
        if ($end -eq $from -and !$skips[[string]$checked]) { $skips[[string]$checked]='no_complete_line_within_budget' }
        if ($end -eq $from) { continue }
        $sessions = @()
        $agents = @()
        if ($activity) {
            $repo = $null
            if ($meta.payload.git.repository_url -match '^(?:https://github\.com/|git@github\.com:|ssh://git@(?:github\.com|ssh\.github\.com)(?::443)?/)([\w.-]+/[\w.-]+?)(?:\.git)?/?$') {
                $remoteName = $Matches[1]
                $repo = $remoteName.ToLowerInvariant()
            }
            if ($ResolveGit -and !$repo -and $meta.payload.cwd -and (Get-Command git -ErrorAction SilentlyContinue) -and
                (Test-Path -LiteralPath $meta.payload.cwd -PathType Container)) {
                $remote = & git -C $meta.payload.cwd config --local --get remote.origin.url 2>$null
                if ($remote -match '^(?:https://github\.com/|git@github\.com:|ssh://git@(?:github\.com|ssh\.github\.com)(?::443)?/)([\w.-]+/[\w.-]+?)(?:\.git)?/?$') {
                    $remoteName = $Matches[1]
                    $repo = $remoteName.ToLowerInvariant()
                }
            }
            $session = @{session_id=$source; tool='codex'; revision=$end; repository=$repo; started_at=$null;
                last_activity_at=([DateTimeOffset]$activity).UtcDateTime.ToString('o'); project_observation=$null}
            $folder = if ($meta.payload.cwd) { Split-Path -Leaf ([string]$meta.payload.cwd) } else { '' }
            if ($folder -match '^[^\\/:\x00-\x1f]{1,120}$' -and $folder -notin @('.','..')) { $session.workspace_name=$folder }
            $sessions += $session
            $agents += @{agent_id=$main; session_id=$source; parent_agent_id=$null; kind='main'; role=$null;
                state=$state; last_activity_at=$session.last_activity_at; revision=$end}
            if ($notes.Count -or (($session.repository -or $session.workspace_name) -and !$cursor.project_report)) {
                $evidence += @{source_id=$source; repository=$repo; workspace_name=$session.workspace_name;
                    outcomes=$notes; previous_summary=$cursor.latest_summary; previous_project_report=$cursor.project_report}
            }
        }
        $batches += @{schema_version=1; batch_id=[guid]::NewGuid().ToString(); sent_at=[DateTime]::UtcNow.ToString('o');
            collector_version='3.0.0'; sessions=$sessions; agents=$agents; summaries=@(); usage=$usage; projects=@();
            cursor=@{source_id=$source; from_offset=$from; to_offset=$end; context=@{model=$model;
                report_from=$reportFrom;input_tokens=$counts.input_tokens; cached_input_tokens=$counts.cached_input_tokens; output_tokens=$counts.output_tokens}}}
    } finally { $stream.Dispose() }
}
$scanState.next_index+=$checked
if ($batches.Count) { $scanState.pending_work=$WorkDir }
WriteJson $planPath @{batches=$batches; bytes_read=$bytesRead; backlog=$backlog;label=$Label;github_login=$GitHubLogin}
WriteJson ($statePath+'.tmp') $scanState
Move-Item -Force -LiteralPath ($statePath+'.tmp') -Destination $statePath
@{collector_version='3.0.0';server=$Server;prepared_batches=$batches.Count;usage=(UsageTotals @($batches | ForEach-Object {$_.usage})); bytes_read=$bytesRead; backlog=$backlog;
    diagnostics=@{checked_files=$checked;cursor_queries=$cursorQueries;unchanged_files=$unchanged;excluded_files=$excluded;recovery_unverified=$scanState.recovery_unverified;initial_snapshots=$initialSnapshots;counter_resets=$counterResets;unmeasured_snapshots=$unmeasured;skipped=$skips}; evidence=$evidence} | ConvertTo-Json -Depth 20 -Compress
