param(
    [ValidateSet('Inventory','Prepare','Submit','查询记录','准备上报','提交上报')][string]$Action = 'Prepare',
    [string]$WorkDir,
    [string]$ProjectKey,
    [string]$Server = 'http://192.168.20.189:4185',
    [string]$Label,
    [string]$ExcludeSessionId,
    [string]$SummarizerTool = 'codex',
    [switch]$IncludeEvidence,
    [string]$StateDir = $PSScriptRoot,
    [string]$GitHubLogin,
    [switch]$ResolveGit,
    [string[]]$SessionRoot = @(),
    [string]$ProjectMap,
    [string[]]$OnlySource = @(),
    [ValidateRange(1048576,268435456)][int]$MaxLineBytes = 33554432
)
$ActionNames = @{ '查询记录' = 'Inventory'; '准备上报' = 'Prepare'; '提交上报' = 'Submit' }
if ($ActionNames.ContainsKey($Action)) { $Action = $ActionNames[$Action] }
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false, $true)
function Hash([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function ReadSegment($Stream,[int]$Initial,$Clock) {
    $memory=[IO.MemoryStream]::new()
    try {
        $chunk=New-Object byte[] ([Math]::Min($Initial,$MaxLineBytes))
        $read=$Stream.Read($chunk,0,$chunk.Length)
        if ($read) {$memory.Write($chunk,0,$read)}
        $found=($read -gt 0 -and [Array]::IndexOf($chunk,[byte]10,0,$read) -ge 0)
        while ($read -gt 0 -and !$found -and $memory.Length -lt $MaxLineBytes -and $Clock.Elapsed.TotalSeconds -lt 12) {
            $chunk=New-Object byte[] ([Math]::Min(65536,$MaxLineBytes-$memory.Length))
            $read=$Stream.Read($chunk,0,$chunk.Length)
            if ($read) {$memory.Write($chunk,0,$read);$found=([Array]::IndexOf($chunk,[byte]10,0,$read) -ge 0)}
        }
        return ,$memory.ToArray()
    } finally {$memory.Dispose()}
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
function RepoName($Value) {
    if ([string]$Value -match '^(?:https://github\.com/|git@github\.com:|ssh://git@(?:github\.com|ssh\.github\.com)(?::443)?/)([\w.-]+/[\w.-]+?)(?:\.git)?/?$') {return $Matches[1].ToLowerInvariant()}
    return $null
}
function PathKey($Value) { return ([string]$Value).Replace('\','/').TrimEnd('/').ToLowerInvariant() }
function BusinessRepo($Repo) {
    if (!$Repo) {return $null}
    $roots=@($projectLinks | Where-Object {$_.repository -eq $Repo} | ForEach-Object {$_.project_key.ToLowerInvariant()} | Select-Object -Unique)
    if ($roots.Count -eq 1) {return $roots[0]}
    return $Repo
}
function ResolveProject($Payload,$Source) {
    $key=PathKey $Payload.cwd
    $original=RepoName $Payload.git.repository_url
    $cached=$scanState.workspace_repositories.$key
    $live=$null
    $directory=if ($pathMappings.ContainsKey($key)) {$pathMappings[$key]} else {$Payload.cwd}
    if ($ResolveGit -and $directory -and (Test-Path -LiteralPath $directory -PathType Container) -and (Get-Command git -ErrorAction SilentlyContinue)) {
        $url=& git -C $directory config --local --get remote.origin.url 2>$null
        $live=RepoName $url
    }
    $choices=@(@($original,$cached,$live) | Where-Object {$_} | ForEach-Object {BusinessRepo $_} | Select-Object -Unique)
    if ($choices.Count -gt 1) {$projectUnresolved.Add(@{source_id=$Source;reason='conflicting_repository_evidence'});return $original}
    if ($choices.Count) {
        if ($key) {$scanState.workspace_repositories | Add-Member -NotePropertyName $key -NotePropertyValue $choices[0] -Force}
        return $choices[0]
    }
    $reason=if ($pathMappings.ContainsKey($key)) {'mapped_directory_has_no_verified_remote'} elseif ($Payload.cwd -and (Test-Path -LiteralPath $Payload.cwd -PathType Container)) {'repository_not_identified'} else {'workspace_moved_needs_mapping'}
    $projectUnresolved.Add(@{source_id=$Source;reason=$reason});return $null
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
if ($Action -eq 'Inventory') {
    if (!$ProjectKey -or !$OnlySource.Count -or $OnlySource.Count -gt 50 -or
        @($OnlySource | Where-Object {$_ -notmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'}).Count) {
        throw 'Inventory requires -ProjectKey and 1 to 50 valid -OnlySource IDs.'
    }
    $route='/api/v1/report-inventory?project_key='+[uri]::EscapeDataString($ProjectKey)+(($OnlySource | ForEach-Object {"&source_id=$_"}) -join '')
    Request $route | ConvertTo-Json -Depth 20 -Compress
    return
}
if (!$WorkDir) {throw 'Prepare and Submit require -WorkDir.'}
$WorkDir = [IO.Path]::GetFullPath($WorkDir)
$planPath = Join-Path $WorkDir 'plan.json'
$editsPath = Join-Path $WorkDir 'summaries.json'

function AssertScope($Path,$Plan) {
    if ((Test-Path -LiteralPath (Join-Path $StateDir '.pulse-project-selection.json')) -and !$OnlySource.Count -and !@($Plan.allowed_sources | Where-Object {$_}).Count) {
        throw 'Selected projects require explicit OnlySource scope.'
    }
    $sources=[Collections.Generic.List[string]]::new()
    foreach ($batch in $Plan.batches) {$sources.Add([string]$batch.cursor.source_id)}
    foreach ($name in @('pulls.json','repositories.json','statuses.json','pr-request.json','status-request.json')) {
        $file=Join-Path $Path $name
        if (!(Test-Path -LiteralPath $file)) {continue}
        $data=Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($name -eq 'pr-request.json') {$data=@($data.pulls)+@($data.repositories | Where-Object {$_})}
        if ($name -eq 'status-request.json') {$data=$data.statuses}
        foreach ($row in $data) {$sources.Add([string]$row.source_session_id)}
    }
    foreach ($kind in @('cli','plan')) {
        $allowed=if ($kind -eq 'cli') {@($OnlySource)} else {@($Plan.allowed_sources | Where-Object {$_})}
        if (!$allowed.Count) {continue}
        foreach ($source in $sources) {
            if ($source -notin $allowed) {throw 'Report outside selected project scope; retain pending files and confirm scope.'}
        }
    }
}
if ($Action -eq 'Submit') {
    $plan = Get-Content -LiteralPath $planPath -Raw -Encoding UTF8 | ConvertFrom-Json
    AssertScope $WorkDir $plan
    if (!$Label) { $Label=$plan.label }
    if (!$GitHubLogin) { $GitHubLogin=$plan.github_login }
    [object[]]$pulls=@()
    if (Test-Path -LiteralPath (Join-Path $WorkDir 'pulls.json')) {
        $rawPulls=Get-Content -LiteralPath (Join-Path $WorkDir 'pulls.json') -Raw -Encoding UTF8
        if (!$rawPulls.TrimStart().StartsWith('[')) {throw 'pulls.json must be an array.'}
        $pulls=ConvertFrom-Json -InputObject $rawPulls
        if ($pulls.Count -gt 50) {throw 'At most 50 checked PR records per request.'}
    }
    $prBodyPath=Join-Path $WorkDir 'pr-request.json'
    [object[]]$repositories=@()
    if (Test-Path -LiteralPath (Join-Path $WorkDir 'repositories.json')) {
        $raw=Get-Content -LiteralPath (Join-Path $WorkDir 'repositories.json') -Raw -Encoding UTF8
        if (!$raw.TrimStart().StartsWith('[')) {throw 'repositories.json must be an array.'}
        $repositories=ConvertFrom-Json -InputObject $raw
        if ($repositories.Count -gt 50) {throw 'At most 50 checked repository records per request.'}
    }
    [object[]]$statuses=@()
    $statusFile=Join-Path $WorkDir 'statuses.json'
    $statusBodyPath=Join-Path $WorkDir 'status-request.json'
    if (Test-Path -LiteralPath $statusFile) {
        $raw=Get-Content -LiteralPath $statusFile -Raw -Encoding UTF8
        if (!$raw.TrimStart().StartsWith('[')) {throw 'statuses.json must be an array.'}
        $statuses=ConvertFrom-Json -InputObject $raw
        if ($statuses.Count -gt 50) {throw 'At most 50 status assessments per request.'}
    }
    if ($pulls.Count -or $repositories.Count -or (Test-Path -LiteralPath $prBodyPath) -or $statuses.Count -or (Test-Path -LiteralPath $statusBodyPath)) {
        [void][IO.Directory]::CreateDirectory($StateDir)
        $pendingPath=Join-Path $StateDir ('.pulse-state-'+(Hash $Server.TrimEnd('/')).Substring(0,12)+'.json')
        $pending=if(Test-Path -LiteralPath $pendingPath){Get-Content -LiteralPath $pendingPath -Raw -Encoding UTF8 | ConvertFrom-Json}else{[pscustomobject]@{report_from=[DateTime]::UtcNow.AddDays(-7).ToString('yyyy-MM-ddTHH:mm:ssZ');next_index=0;pending_work=$null}}
        if ($pending.pending_work -and $pending.pending_work -ne $WorkDir -and (Test-Path -LiteralPath (Join-Path $pending.pending_work 'plan.json'))) {throw 'Finish the previous pending report first.'}
        $pending | Add-Member -NotePropertyName pending_work -NotePropertyValue $WorkDir -Force
        WriteJson ($pendingPath+'.tmp') $pending;Move-Item -Force -LiteralPath ($pendingPath+'.tmp') -Destination $pendingPath
    }
    [object[]]$edits = @()
    if ([IO.File]::Exists($editsPath)) { $edits = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $editsPath -Raw -Encoding UTF8) }
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
                    observed_at=$session.last_activity_at; summary=$edit[0].summary; summarizer_tool=$SummarizerTool; prompt_version='3.6.0'})
            }
            if ($edit[0].goal -and $edit[0].milestones -and $session) {
                $project = if ($session.repository) { $session.repository } else { $session.workspace_name }
                if ($project) {
                    $batch.projects = @(@{report_id=(StableId "codex:project:${source}:${end}:$project"); source_session_id=$source;
                        project_key=$project; goal=$edit[0].goal; milestones=@($edit[0].milestones);
                        observed_at=$session.last_activity_at; summarizer_tool=$SummarizerTool; prompt_version='3.6.0'})
                    if ($null -ne $edit[0].modules) { $batch.projects[0].modules=@($edit[0].modules) }
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
    $statusReceipt=$null
    if ($statuses.Count -or (Test-Path -LiteralPath $statusBodyPath)) {
        $directory=Request '/api/v1/report-directory'
        if ('client_project_status' -notin $directory.capabilities) {throw 'Server upgrade required: client_project_status (migration 009).'}
        if (!(Test-Path -LiteralPath $statusBodyPath)) {WriteJson $statusBodyPath @{schema_version=1;batch_id=[guid]::NewGuid().ToString();sent_at=[DateTime]::UtcNow.ToString('o');statuses=$statuses}}
        $expected=Get-Content -LiteralPath $statusBodyPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $statusReceipt=Request '/api/v1/report-statuses' $statusBodyPath
        if ($statusReceipt.status -ne 'committed' -or $statusReceipt.batch_id -ne $expected.batch_id -or $statusReceipt.statuses -ne @($expected.statuses).Count) {throw 'Unexpected status receipt.'}
    }
    $prReceipt=$null
    if ($pulls.Count -or $repositories.Count -or (Test-Path -LiteralPath $prBodyPath)) {
        $directory=Request '/api/v1/report-directory'
        if ('client_pr_ingest' -notin $directory.capabilities) {throw 'Server upgrade required: client_pr_ingest.'}
        if ($repositories.Count -and 'multi_repository_projects' -notin $directory.capabilities) {throw 'Server upgrade required: multi_repository_projects (migration 011).'}
        if (!(Test-Path -LiteralPath $prBodyPath)) {
            $request=@{schema_version=1;batch_id=[guid]::NewGuid().ToString();sent_at=[DateTime]::UtcNow.ToString('o');pulls=$pulls}
            if ($repositories.Count) {$request.repositories=$repositories}
            WriteJson $prBodyPath $request
        }
        $expected=Get-Content -LiteralPath $prBodyPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $prReceipt=Request '/api/v1/report-pulls' $prBodyPath
        if ($prReceipt.status -ne 'committed' -or $prReceipt.batch_id -ne $expected.batch_id -or $prReceipt.pulls -ne @($expected.pulls).Count) {throw 'Unexpected PR receipt.'}
        if ($null -ne $expected.repositories -and ($null -eq $prReceipt.repositories -or $prReceipt.repositories -ne @($expected.repositories).Count)) {throw 'Unexpected repository receipt.'}
    }
    $finishedPath=Join-Path $StateDir ('.pulse-state-'+(Hash $Server.TrimEnd('/')).Substring(0,12)+'.json')
    if ($alreadyCommitted -eq 0 -and (Test-Path -LiteralPath $finishedPath)) {
        $saved=Get-Content -LiteralPath $finishedPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($saved.pending_work -and [IO.Path]::GetFullPath($saved.pending_work) -eq $WorkDir) {
            $saved.pending_work=$null;WriteJson ($finishedPath+'.tmp') $saved
            Move-Item -Force -LiteralPath ($finishedPath+'.tmp') -Destination $finishedPath
        }
    }
    @{submitted_batches=$sent; server_cursor_already_advanced=$alreadyCommitted;receipts=$receipts;pr_receipt=$prReceipt;status_receipt=$statusReceipt;usage_verified=($alreadyCommitted -eq 0); bytes_read=$plan.bytes_read; backlog=$plan.backlog} | ConvertTo-Json -Depth 10 -Compress
    return
}

if ((Test-Path -LiteralPath (Join-Path $StateDir '.pulse-project-selection.json')) -and !$OnlySource.Count) {throw 'Selected projects require explicit OnlySource scope.'}
if (Test-Path -LiteralPath $WorkDir) { throw 'Prepare requires a new working directory.' }
[void][IO.Directory]::CreateDirectory($WorkDir)
$directory=Request '/api/v1/report-directory'
$projectLinks=$directory.project_repositories
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
if (!$ProjectMap) {$ProjectMap=Join-Path $StateDir '.pulse-project-paths.json'}
$pathMappings=@{}
if (Test-Path -LiteralPath $ProjectMap) {
    $raw=Get-Content -LiteralPath $ProjectMap -Raw -Encoding UTF8
    if (!$raw.TrimStart().StartsWith('[')) {throw 'Project map must be an array.'}
    foreach ($mapping in (ConvertFrom-Json -InputObject $raw)) {
        if (!$mapping.old_path -or !$mapping.new_path) {throw 'Invalid project mapping.'}
        $key=PathKey $mapping.old_path
        if ($pathMappings.ContainsKey($key)) {throw 'Duplicate project mapping.'}
        $pathMappings[$key]=$mapping.new_path
    }
}
if (!$scanState.workspace_repositories) {$scanState | Add-Member -NotePropertyName workspace_repositories -NotePropertyValue ([pscustomobject]@{}) -Force}
$projectUnresolved=[Collections.Generic.List[object]]::new()
if ($scanState.pending_work -and (Test-Path -LiteralPath (Join-Path $scanState.pending_work 'plan.json'))) {
    $pendingPlan=Get-Content -LiteralPath (Join-Path $scanState.pending_work 'plan.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    AssertScope $scanState.pending_work $pendingPlan
    $scopeArgs=@{};if ($OnlySource.Count) {$scopeArgs.OnlySource=$OnlySource}
    $recovery=& $PSCommandPath -Action Submit -WorkDir $scanState.pending_work -Server $Server -StateDir $StateDir @scopeArgs
    $recovered=($recovery -join "`n") | ConvertFrom-Json
    $scanState.recovery_unverified=(!$recovered.usage_verified)
    $scanState.pending_work=$null
}
$known=@{}; foreach ($s in $directory.sources) { $known[$s.source_id]=$true }
$containers=@((Join-Path $env:USERPROFILE '.codex'),(Join-Path $env:USERPROFILE '.config/codex'))
if ($env:CODEX_HOME) { $containers+= $env:CODEX_HOME }
if ($env:APPDATA) { $containers+= (Join-Path $env:APPDATA 'Codex') }
if ($env:LOCALAPPDATA) { $containers+= (Join-Path $env:LOCALAPPDATA 'Codex') }
$containers+=@(Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '^\.codex[-_]'} | ForEach-Object {$_.FullName})
$queue=[Collections.Queue]::new(); foreach ($container in $containers) {$queue.Enqueue(@{path=$container;depth=0})}
$discovered=@();$discoveryChecked=0
while ($queue.Count -and $discoveryChecked -lt 64) {
    $item=$queue.Dequeue()
    $folder=Get-Item -LiteralPath $item.path -ErrorAction SilentlyContinue
    if (!$folder -or !$folder.PSIsContainer -or ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint)) {continue}
    $discoveryChecked++
    if ($folder.Name -eq 'sessions') {$discovered+=$folder.FullName;continue}
    if ($item.depth -ge 4) {continue}
    foreach ($child in @(Get-ChildItem -LiteralPath $folder.FullName -Directory -ErrorAction SilentlyContinue)) {
        if (!($child.Attributes -band [IO.FileAttributes]::ReparsePoint)) {$queue.Enqueue(@{path=$child.FullName;depth=($item.depth+1)})}
    }
}
$roots=@(@($SessionRoot)+@($scanState.session_roots)+@($discovered) | Where-Object {$_ -and (Test-Path -LiteralPath $_ -PathType Container)} | ForEach-Object {[IO.Path]::GetFullPath($_)} | Select-Object -Unique)
$scanState | Add-Member -NotePropertyName session_roots -NotePropertyValue $roots -Force
if (!$scanState.source_headers) {$scanState | Add-Member -NotePropertyName source_headers -NotePropertyValue ([pscustomobject]@{}) -Force}
$cutoff = ([DateTimeOffset]$scanState.report_from).UtcDateTime
$files = @($roots | ForEach-Object {Get-ChildItem -Path (Join-Path $_ '*/*/*/*.jsonl') -File -ErrorAction SilentlyContinue} |
    Where-Object { ($_.LastWriteTimeUtc -ge $cutoff -or ($_.Name -match '([a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})' -and $known[$Matches[1]])) -and !($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
    Sort-Object @{Expression={$_.Length};Descending=$true},FullName)
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
        $head=ReadSegment $stream 4096 $scanClock
        $n=$head.Length;$bytesRead+=$n
        if ($n -eq 0) { continue }
        $lf = [Array]::IndexOf($head,[byte]10,0,$n)
        if ($lf -lt 0) { $skips[[string]$checked]=if($n -ge $MaxLineBytes){'line_exceeds_max_line_bytes'}else{'metadata_incomplete'}; continue }
        $meta = $utf8.GetString($head,0,$lf) | ConvertFrom-Json
        $source = ([string]$meta.payload.id).ToLowerInvariant()
        if ($OnlySource.Count -and $source -notin $OnlySource) {continue}
        if ($meta.type -ne 'session_meta' -or $source -notmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or
            $meta.payload.source.subagent -or $meta.payload.parent_thread_id -or $source -eq $ExcludeSessionId -or
            $source -in $scanState.excluded) { $excluded++; continue }
        $headHash=Hash ($utf8.GetString($head,0,$lf))
        if ($scanState.source_headers.$source -and $scanState.source_headers.$source -ne $headHash) {
            $skips[[string]$checked]='source_header_changed_requires_confirmation';continue
        }
        $scanState.source_headers | Add-Member -NotePropertyName $source -NotePropertyValue $headHash -Force
        if ($seenSources.ContainsKey($source)) { $skips[[string]$checked]='duplicate_source'; continue }
        $seenSources[$source] = $true
        $cursor = Request "/api/v1/report-cursor?source_id=$source"
        $cursorQueries++
        $from = [long]$cursor.offset
        $resolvedRepo=ResolveProject $meta.payload $source
        if ($stream.Length -eq $from) {
            if ($IncludeEvidence -and $cursor.session_exists -and !$cursor.project_status.state) {
                $folder=if($meta.payload.cwd){Split-Path -Leaf ([string]$meta.payload.cwd)}else{''}
                $evidence+=@{source_id=$source;repository=$resolvedRepo;workspace_name=$folder;outcomes=@();previous_summary=$cursor.latest_summary;previous_project_report=$cursor.project_report;previous_project_status=$cursor.project_status}
            }
            if ($resolvedRepo -and $cursor.session_exists -and $cursor.project_key -ne $resolvedRepo) {
                if ('project_mapping_backfill' -in $directory.capabilities) {
                    $batches+=@{schema_version=1;batch_id=[guid]::NewGuid().ToString();sent_at=[DateTime]::UtcNow.ToString('o');collector_version='3.6.0';
                        sessions=@();agents=@();summaries=@();projects=@();usage=@();mappings=@(@{session_id=$source;repository=$resolvedRepo});
                        cursor=@{source_id=$source;from_offset=$from;to_offset=$from;context=$cursor.context}}
                } else {$projectUnresolved.Add(@{source_id=$source;reason='server_project_mapping_upgrade_required'})}
            }
            $unchanged++; continue
        }
        if ($stream.Length -lt $from) { $skips[[string]$checked]='file_truncated'; continue }
        [void]$stream.Seek($from,'Begin')
        $initial=[Math]::Min($stream.Length-$from,[Math]::Max(4096,1048576-$bytesRead))
        $buffer=ReadSegment $stream $initial $scanClock
        $n=$buffer.Length;$bytesRead+=$n
        if ($n -ge $MaxLineBytes -and [Array]::IndexOf($buffer,[byte]10) -lt 0) {$skips[[string]$checked]='line_exceeds_max_line_bytes'}
        $end = $from
        $model = $cursor.context.model
        $counts = $cursor.context
        $sourceCutoff=if ($cursor.context.report_from) { ([DateTimeOffset]$cursor.context.report_from).UtcDateTime } elseif ($from -gt 0) { [DateTime]::MinValue } else {$cutoff}
        $reportFrom=if ($sourceCutoff -eq [DateTime]::MinValue) {'1970-01-01T00:00:00Z'} else {$sourceCutoff.ToString('yyyy-MM-ddTHH:mm:ssZ')}
        $usage = @()
        $activity = $null
        $state = if ($cursor.agent_state) { $cursor.agent_state } else { 'unknown' }
        $terminal=$false
        $notes = @()
        $main = StableId "codex:agent:$source"
        $lineStart = 0
        while ($lineStart -lt $n) {
            if ($scanClock.Elapsed.TotalSeconds -ge 12) { break }
            $i=[Array]::IndexOf($buffer,[byte]10,$lineStart)
            if ($i -lt 0) {break}
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
            if (!$row.timestamp) { continue }
            $recent = ([DateTimeOffset]$row.timestamp).UtcDateTime -ge $sourceCutoff
            if ($recent -and (($row.type -eq 'event_msg' -and $p.type -in @('user_message','agent_message','agent_reasoning')) -or
                ($row.type -eq 'response_item' -and $p.type -in @('function_call','function_call_output','custom_tool_call','custom_tool_call_output')))) {
                $activity=$row.timestamp;$state='running';$terminal=$false
            }
            if ($row.type -ne 'event_msg') {continue}
            switch ($p.type) {
                'task_started' { if ($recent) { $activity=$row.timestamp; $state='running';$terminal=$false } }
                'turn_aborted' { if ($recent) { $activity=$row.timestamp; $state='idle';$terminal=$true } }
                'task_complete' {
                    if ($recent) {
                        $activity=$row.timestamp; $state='completed';$terminal=$true
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
                        if (!$terminal -and $state -notin @('completed','failed','idle')) {$state='running'}
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
            $repo = $resolvedRepo
            $session = @{session_id=$source; tool='codex'; revision=$end; repository=$repo; started_at=$null;
                last_activity_at=([DateTimeOffset]$activity).UtcDateTime.ToString('o'); project_observation=$null}
            $folder = if ($meta.payload.cwd) { Split-Path -Leaf ([string]$meta.payload.cwd) } else { '' }
            if ($folder -match '^[^\\/:\x00-\x1f]{1,120}$' -and $folder -notin @('.','..')) { $session.workspace_name=$folder }
            $sessions += $session
            $agents += @{agent_id=$main; session_id=$source; parent_agent_id=$null; kind='main'; role=$null;
                state=$state; last_activity_at=$session.last_activity_at; revision=$end}
            if ($notes.Count -or (($session.repository -or $session.workspace_name) -and !$cursor.project_report)) {
                $evidence += @{source_id=$source; repository=$repo; workspace_name=$session.workspace_name;
                    outcomes=$notes; previous_summary=$cursor.latest_summary; previous_project_report=$cursor.project_report;previous_project_status=$cursor.project_status}
            }
        }
        $batches += @{schema_version=1; batch_id=[guid]::NewGuid().ToString(); sent_at=[DateTime]::UtcNow.ToString('o');
            collector_version='3.6.0'; sessions=$sessions; agents=$agents; summaries=@(); usage=$usage; projects=@();
            cursor=@{source_id=$source; from_offset=$from; to_offset=$end; context=@{model=$model;
                report_from=$reportFrom;input_tokens=$counts.input_tokens; cached_input_tokens=$counts.cached_input_tokens; output_tokens=$counts.output_tokens}}}
    } finally { $stream.Dispose() }
}
$scanState.next_index+=$checked
if ($batches.Count) { $scanState.pending_work=$WorkDir }
WriteJson $planPath @{batches=$batches; allowed_sources=@($OnlySource);bytes_read=$bytesRead; backlog=$backlog;label=$Label;github_login=$GitHubLogin}
WriteJson ($statePath+'.tmp') $scanState
Move-Item -Force -LiteralPath ($statePath+'.tmp') -Destination $statePath
@{collector_version='3.6.0';server=$Server;prepared_batches=$batches.Count;usage=(UsageTotals @($batches | ForEach-Object {$_.usage})); bytes_read=$bytesRead; backlog=$backlog;
    diagnostics=@{checked_files=$checked;cursor_queries=$cursorQueries;unchanged_files=$unchanged;excluded_files=$excluded;project_unresolved=@($projectUnresolved.ToArray());session_roots_found=$roots.Count;discovery_checked=$discoveryChecked;discovery_incomplete=($queue.Count -gt 0);recovery_unverified=$scanState.recovery_unverified;initial_snapshots=$initialSnapshots;counter_resets=$counterResets;unmeasured_snapshots=$unmeasured;skipped=$skips}; evidence=$evidence} | ConvertTo-Json -Depth 20 -Compress
