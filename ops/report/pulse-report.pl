#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP;
use Digest::SHA qw(sha256_hex);
use Getopt::Long;
use POSIX qw(strftime);
use Time::HiRes qw(time);
use Encode qw(encode_utf8);
use FindBin;
use File::Path qw(make_path);
use Cwd qw(abs_path);
use Fcntl qw(O_WRONLY O_CREAT O_EXCL);
use File::Spec;

my ($state_dir,$github_login,$resolve_git,$project_map) = ($FindBin::Bin,undef,0,undef);
my @session_roots;
my @only_sources;
my ($action,$work,$server,$label,$exclude,$include,$tool) =
  ('Prepare',undef,'http://192.168.16.70:4185',undef,undef,0,'codex');
GetOptions('action=s'=>\$action,'work-dir=s'=>\$work,'server=s'=>\$server,'label=s'=>\$label,
    'exclude-session-id=s'=>\$exclude,'include-evidence'=>\$include,'summarizer-tool=s'=>\$tool,
    'state-dir=s'=>\$state_dir,'github-login=s'=>\$github_login,'resolve-git'=>\$resolve_git,
    'session-root=s@'=>\@session_roots,'project-map=s'=>\$project_map,'only-source=s@'=>\@only_sources) or die "Invalid options\n";
die "Expected Prepare or Submit and --work-dir\n" unless $work && $action =~ /\A(?:Prepare|Submit)\z/;
$work=abs_path($work) // File::Spec->rel2abs($work);
$state_dir=File::Spec->rel2abs($state_dir);
die "Invalid tool ID\n" unless $tool =~ /\A[a-z][a-z0-9_]{0,63}\z/;
$server =~ s{/$}{};
die "Expected private IPv4 HTTP origin\n" unless $server =~ m{\Ahttp://((?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)[0-9.]+)(?::[1-9][0-9]{0,4})?\z}
    && (split /\./,$1)==4 && !grep { !/\A(?:0|[1-9][0-9]{0,2})\z/ || $_>255 } split /\./,$1;
umask 0077;
my $json = JSON::PP->new->utf8->canonical;
my $uuid = qr/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/i;
my $machine;
if ($^O eq 'darwin') {
    ($machine) = qx{/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice} =~ /"IOPlatformUUID"\s*=\s*"([^"]+)"/;
    die "Missing IOPlatformUUID\n" unless $machine;
} elsif ($^O eq 'linux') {
    for my $path ('/etc/machine-id','/var/lib/dbus/machine-id') {
        if (open my $fh,'<',$path) {
            my $value=<$fh> // ''; close $fh; $value =~ s/\s+//g;
            if ($value =~ /\A[0-9a-f]{32}\z/i && $value !~ /\A0+\z/) {$machine=lc $value;last}
        }
    }
    # Minimal distributions may lack machine-id. Persist a random installation
    # identity outside the distributable package, rather than using hostname/IP.
    unless ($machine) {
        my $base=($ENV{XDG_STATE_HOME} // "$ENV{HOME}/.local/state").'/project-pulse';
        make_path($base,{mode=>0700}) unless -d $base;
        my $path="$base/device-id";
        if (sysopen my $new,$path,O_WRONLY|O_CREAT|O_EXCL,0600) {print {$new} uuid4(),"\n";close $new or die "Cannot save Linux device identity\n"}
        open my $fh,'<',$path or die "Cannot read Linux device identity\n";
        chomp($machine=<$fh> // ''); close $fh;
        die "Invalid Linux device identity\n" unless $machine =~ $uuid;
    }
} else {die "Unsupported platform: $^O\n"}
my $device = sha256_hex("$machine\n$<");
my $plan_file = "$work/plan.json";
my @counts = qw(input_tokens cached_input_tokens output_tokens);

sub now { strftime('%Y-%m-%dT%H:%M:%SZ',gmtime($_[0] // time())) }
sub uuid4 {
    open my $fh,'<:raw','/dev/urandom' or die "Missing OS randomness\n";
    my $raw=''; read($fh,$raw,16)==16 or die "Cannot read OS randomness\n";close $fh;
    substr($raw,6,1)=chr((ord(substr($raw,6,1)) & 15) | 64);
    substr($raw,8,1)=chr((ord(substr($raw,8,1)) & 63) | 128);
    my $hex=unpack('H*',$raw);
    return join '-',map {substr($hex,$_->[0],$_->[1])} [0,8],[8,4],[12,4],[16,4],[20,12];
}
sub id {
    my $value = sha256_hex(encode_utf8($_[0]));
    return join '-', map { substr($value,$_->[0],$_->[1]) } [0,8],[8,4],[12,4],[16,4],[20,12];
}
sub read_json {
    open my $fh, '<:raw', $_[0] or die "Cannot read plan or edits\n";
    local $/;
    return $json->decode(<$fh>);
}
sub write_json {
    open my $fh, '>:raw', $_[0] or die "Cannot write plan or request\n";
    print {$fh} $json->encode($_[1]) or die "Cannot write JSON\n";
    close $fh or die "Cannot close JSON\n";
}
sub request {
    my ($route,$body) = @_;
    my @args = ('-q','-fsS','--noproxy','*','--connect-timeout',2,'--max-time',4,
        '-H',"X-Pulse-LAN-Device: $device");
    if ($body) {
        push @args,'-H',"X-Pulse-LAN-GitHub: $github_login" if defined $github_login;
        if (defined $label && length $label) {
            my $encoded = $label;
            $encoded =~ s/([^A-Za-z0-9_.~-])/sprintf("%%%02X",ord($1))/ge;
            push @args,'-H',"X-Pulse-LAN-Label: $encoded";
        }
        push @args,'-H','Content-Type: application/json','--data-binary',"\@$body";
    }
    my $curl=-x '/usr/bin/curl' ? '/usr/bin/curl' : 'curl';
    open my $pipe,'-|',$curl,@args,"$server$route" or die "Cannot run curl\n";
    my $output = do { local $/; <$pipe> };
    close $pipe or die "Request failed: $route\n";
    return $json->decode($output);
}
sub cursor { request("/api/v1/report-cursor?source_id=$_[0]") }
sub usage_totals {
    my ($rows)=@_;
    my %totals=(events=>scalar @$rows,map {$_=>0} @counts);
    for my $row (@$rows) { $totals{$_} += $row->{$_} // 0 for @counts }
    return \%totals;
}
sub repo_name {
    my ($value)=@_;
    my ($repo)=($value//'') =~ m{\A(?:https://github\.com/|git\@github\.com:|ssh://git\@(?:github\.com|ssh\.github\.com)(?::443)?/)([\w.-]+/[\w.-]+?)(?:\.git)?/?\z}i;
    return defined $repo ? lc($repo) : undef;
}
sub path_key { my $v=$_[0]//''; $v=~s{\\}{/}g; $v=~s{/+\z}{}; return $v =~ /\A[A-Za-z]:/ ? lc $v : $v }
sub git_repo {
    my ($path)=@_;return undef unless $path && -d $path;
    open my $git,'-|','git','-C',$path,'config','--local','--get','remote.origin.url' or return undef;
    my $value=<$git>;close $git;chomp($value //= '');return repo_name($value);
}
sub narrative {
    my $text = $_[0] // '';
    $text =~ s{\x60\x60\x60.*?(?:\x60\x60\x60|\z)|https?://\S+|\S+\@\S+|(?:^|\s)[~/]\S+|(?:\b\S*(?:token|secret|password|api[_-]?key)\S*|\S{0,8}(?:\x{5bc6}\x{7801}|\x{53e3}\x{4ee4}|\x{4ee4}\x{724c}))\s*[:=\x{ff1a}]\s*\S+}{ [redacted] }gis;
    $text =~ s/\s+/ /g;
    return substr($text,0,240);
}

sub check_scope {
    my ($path,$plan)=@_;
    die "Selected projects require explicit OnlySource scope\n" if -f "$state_dir/.pulse-project-selection.json" && !@only_sources && !@{$plan->{allowed_sources}//[]};
    my @sources=map {$_->{cursor}{source_id}} @{$plan->{batches}//[]};
    for my $entry (['pulls.json',undef],['statuses.json',undef],['pr-request.json','pulls'],['status-request.json','statuses']) {
        next unless -f "$path/$entry->[0]";
        my $data=read_json("$path/$entry->[0]");
        my $rows=$entry->[1] ? $data->{$entry->[1]} : $data;
        push @sources,map {$_->{source_session_id}} @$rows;
    }
    for my $allowed (\@only_sources,$plan->{allowed_sources}//[]) {
        next unless @$allowed;
        my %allowed=map {lc($_)=>1} @$allowed;
        die "Report outside selected project scope; retain pending files and confirm scope\n" if grep {!defined($_) || !$allowed{lc($_)}} @sources;
    }
}
if ($action eq 'Submit') {
    my $plan = read_json($plan_file);
    check_scope($work,$plan);
    $label //= $plan->{label};
    $github_login //= $plan->{github_login};
    my $pulls=-f "$work/pulls.json" ? read_json("$work/pulls.json") : [];
    my $statuses=-f "$work/statuses.json" ? read_json("$work/statuses.json") : [];
    die "statuses.json must be an array of at most 50 assessments\n" unless ref($statuses) eq 'ARRAY' && @$statuses<=50;
    die "pulls.json must be an array of at most 50 checked PR records\n" unless ref($pulls) eq 'ARRAY' && @$pulls<=50;
    if (@$pulls || -f "$work/pr-request.json" || @$statuses || -f "$work/status-request.json") {
        my $pending_file="$state_dir/.pulse-state-".substr(sha256_hex($server),0,12).'.json';
        my $state=-f $pending_file ? read_json($pending_file) : {report_from=>now(time()-7*86400),next_index=>0};
        $state->{pending_work}=abs_path($state->{pending_work}) // File::Spec->rel2abs($state->{pending_work}) if $state->{pending_work};
        die "Finish the previous pending report first\n" if $state->{pending_work} && $state->{pending_work} ne $work && -f "$state->{pending_work}/plan.json";
        $state->{pending_work}=$work;
        make_path($state_dir,{mode=>0700}) unless -d $state_dir;
        write_json("$pending_file.tmp",$state);rename "$pending_file.tmp",$pending_file or die "Cannot persist PR retry state\n";
    }
    my %edits;
    if (-f "$work/summaries.json") {
        for my $edit (@{read_json("$work/summaries.json")}) {
            die "Duplicate summary\n" if exists $edits{$edit->{source_id}};
            $edits{$edit->{source_id}} = $edit;
        }
    }
    my ($sent,$advanced) = (0,0);
    my @receipts;
    for my $batch (@{$plan->{batches}}) {
        my ($source,$end) = @{$batch->{cursor}}{qw(source_id to_offset)};
        my $edit = $edits{$source} // {};
        my $session = $batch->{sessions}[0];
        my $project = $session ? ($session->{repository} // $session->{workspace_name}) : undef;
        if ($session && $edit->{summary}) {
            $batch->{summaries} = [{summary_id=>id("codex:summary:$source:$end"),session_id=>$source,
                observed_at=>$session->{last_activity_at},summary=>$edit->{summary},summarizer_tool=>$tool,prompt_version=>'3.3.0'}];
        }
        if ($project && $edit->{goal} && $edit->{milestones}) {
            $batch->{projects} = [{report_id=>id("codex:project:$source:$end:$project"),source_session_id=>$source,
                project_key=>$project,goal=>$edit->{goal},milestones=>$edit->{milestones},
                observed_at=>$session->{last_activity_at},summarizer_tool=>$tool,prompt_version=>'3.3.0'}];
        }
        my $body = "$work/$batch->{batch_id}.json";
        write_json($body,$batch) unless -e $body;
        my $receipt = eval { request('/api/v1/reports',$body) };
        if (!$receipt) {
            my $error = $@;
            if (cursor($source)->{offset} >= $end) { $advanced++; next }
            die $error;
        }
        die "Unexpected receipt\n" unless $receipt->{status} eq 'committed'
            && $receipt->{batch_id} eq $batch->{batch_id} && $receipt->{to_offset} == $end;
        my $expected=usage_totals($batch->{usage});
        die "Missing server usage receipt; update the server\n" unless $receipt->{usage};
        for my $key ('events',@counts) {
            die "Server usage mismatch: $key\n" unless defined $receipt->{usage}{$key} && $receipt->{usage}{$key} == $expected->{$key};
        }
        push @receipts,{batch_id=>$batch->{batch_id},usage=>$receipt->{usage}};
        $sent++;
    }
    my $status_receipt;
    if (@$statuses || -f "$work/status-request.json") {
        my $directory=request('/api/v1/report-directory');
        die "Server upgrade required: client_project_status (migration 009)\n" unless grep {$_ eq 'client_project_status'} @{$directory->{capabilities}//[]};
        my $body="$work/status-request.json";
        write_json($body,{schema_version=>1,batch_id=>uuid4(),sent_at=>now(),statuses=>$statuses}) unless -f $body;
        my $expected=read_json($body);
        $status_receipt=request('/api/v1/report-statuses',$body);
        die "Unexpected status receipt\n" unless $status_receipt->{status} eq 'committed' &&
            $status_receipt->{batch_id} eq $expected->{batch_id} && $status_receipt->{statuses}==@{$expected->{statuses}};
    }
    my $pr_receipt;
    if (@$pulls || -f "$work/pr-request.json") {
        my $directory=request('/api/v1/report-directory');
        die "Server upgrade required: client_pr_ingest\n" unless grep {$_ eq 'client_pr_ingest'} @{$directory->{capabilities}//[]};
        my $body="$work/pr-request.json";
        write_json($body,{schema_version=>1,batch_id=>uuid4(),sent_at=>now(),pulls=>$pulls}) unless -f $body;
        my $expected=read_json($body);
        $pr_receipt=request('/api/v1/report-pulls',$body);
        die "Unexpected PR receipt\n" unless $pr_receipt->{status} eq 'committed' &&
            $pr_receipt->{batch_id} eq $expected->{batch_id} && $pr_receipt->{pulls}==@{$expected->{pulls}};
    }
    my $finished_state="$state_dir/.pulse-state-".substr(sha256_hex($server),0,12).'.json';
    if (!$advanced && -f $finished_state) {
        my $saved=read_json($finished_state);
        if ($saved->{pending_work} && (abs_path($saved->{pending_work}) // File::Spec->rel2abs($saved->{pending_work})) eq $work) {
            delete $saved->{pending_work};write_json("$finished_state.tmp",$saved);
            rename "$finished_state.tmp",$finished_state or die "Cannot clear completed pending report\n";
        }
    }
    print $json->encode({submitted_batches=>$sent,server_cursor_already_advanced=>$advanced,pr_receipt=>$pr_receipt,status_receipt=>$status_receipt,
        receipts=>\@receipts,usage_verified=>($advanced ? JSON::PP::false : JSON::PP::true),
        bytes_read=>$plan->{bytes_read},backlog=>$plan->{backlog}}),"\n";
    exit;
}

die "Selected projects require explicit OnlySource scope\n" if -f "$state_dir/.pulse-project-selection.json" && !@only_sources;
mkdir $work or die "Prepare requires a new working directory\n";
my $directory=request('/api/v1/report-directory');
die "Server upgrade required: protocol 3 usage receipts\n" unless ($directory->{protocol_version}//0)>=3;
if (defined $github_login) {
    die "Invalid GitHub login\n" unless $github_login =~ /\A[a-zA-Z0-9-]{1,39}\z/;
    my @matches=grep {lc($_->{github_login}//'') eq lc($github_login)} @{$directory->{members}};
    $label=@matches==1 ? $matches[0]{display_name} : $github_login unless defined $label;
}
make_path($state_dir,{mode=>0700}) unless -d $state_dir;
my $state_file="$state_dir/.pulse-state-".substr(sha256_hex($server),0,12).'.json';
my $scan_state=-f $state_file ? read_json($state_file) : {report_from=>now(time()-7*86400),next_index=>0};
$label //= $scan_state->{label};
$scan_state->{label}=$label if defined $label;
$github_login //= $scan_state->{github_login};
$scan_state->{github_login}=$github_login if defined $github_login;
$project_map //= "$state_dir/.pulse-project-paths.json";
my $mappings=-f $project_map ? read_json($project_map) : [];
die "Project map must be an array\n" unless ref($mappings) eq 'ARRAY';
my %path_mappings;
for my $mapping (@$mappings) {
    die "Invalid project mapping\n" unless ref($mapping) eq 'HASH' && $mapping->{old_path} && $mapping->{new_path};
    my $key=path_key($mapping->{old_path});
    die "Duplicate project mapping\n" if exists $path_mappings{$key};
    $path_mappings{$key}=$mapping->{new_path};
}
my @project_unresolved;
sub resolve_project {
    my ($payload,$source)=@_;
    my $key=path_key($payload->{cwd});
    my $original=repo_name($payload->{git}{repository_url});
    my $cached=$scan_state->{workspace_repositories}{$key};
    my $live=$resolve_git ? git_repo($path_mappings{$key}//$payload->{cwd}) : undef;
    my %choices=map {$_=>1} grep {defined && length} ($original,$live,$cached);
    if (keys(%choices)>1) {push @project_unresolved,{source_id=>$source,reason=>'conflicting_repository_evidence'};return $original}
    my ($repo)=keys %choices;
    if ($repo) {$scan_state->{workspace_repositories}{$key}=$repo if length $key;return $repo}
    push @project_unresolved,{source_id=>$source,reason=>exists $path_mappings{$key} ? 'mapped_directory_has_no_verified_remote' :
        $payload->{cwd} && -d $payload->{cwd} ? 'repository_not_identified' : 'workspace_moved_needs_mapping'};
    return undef;
}
if ($scan_state->{pending_work} && -f "$scan_state->{pending_work}/plan.json") {
    check_scope($scan_state->{pending_work},read_json("$scan_state->{pending_work}/plan.json"));
    open my $resume,'-|',$^X,$0,'--action','Submit','--work-dir',$scan_state->{pending_work},'--server',$server,'--state-dir',$state_dir,(map {('--only-source',$_)} @only_sources)
        or die "Cannot resume pending upload\n";
    my $recovery=do {local $/; <$resume>};
    close $resume or die "Pending upload failed; retained at $scan_state->{pending_work}\n";
    my $receipt=$json->decode($recovery);
    $scan_state->{recovery_unverified}=!$receipt->{usage_verified} ? JSON::PP::true : JSON::PP::false;
    delete $scan_state->{pending_work};
}
my %known=map {lc($_->{source_id})=>1} @{$directory->{sources}//[]};
my @containers=grep {defined && length} ($ENV{CODEX_HOME},
    "$ENV{HOME}/.codex","$ENV{HOME}/.config/codex", "$ENV{HOME}/Library/Application Support/Codex",
    ($ENV{XDG_DATA_HOME} // "$ENV{HOME}/.local/share").'/codex',
    ($ENV{XDG_CONFIG_HOME} // "$ENV{HOME}/.config").'/codex',
    entries($ENV{HOME},qr/\A\.codex[-_].+\z/));
my @discovered;
my @queue=map {[$_,0]} @containers;
my $discovery_checked=0;
while (@queue && $discovery_checked<64) {
    my ($path,$depth)=@{shift @queue};
    next unless -d $path && !-l $path;
    $discovery_checked++;
    if ($path =~ m{(?:^|/)sessions\z}) { push @discovered,$path; next }
    next if $depth>=4;
    push @queue,map {[$_,$depth+1]} grep {-d $_ && !-l $_} entries($path,qr/\A[^.]|\A\.codex/);
}
my %root_seen;
my @roots=grep {defined && -d $_ && !$root_seen{$_}++}
    map {abs_path($_)} (@session_roots,@{$scan_state->{session_roots}//[]},@discovered);
$scan_state->{session_roots}=\@roots;
my $cutoff = $scan_state->{report_from};
my @files;
for my $root (@roots) {
for my $year (entries($root,qr/\A[0-9]{4}\z/)) {
    next if -l $year;
    for my $month (entries($year,qr/\A[0-9]{2}\z/)) {
        next if -l $month;
        for my $day (entries($month,qr/\A[0-9]{2}\z/)) {
            next if -l $day;
            for my $file (entries($day,qr/\.jsonl\z/)) {
                next unless -f $file && !-l $file;
                my $mtime = (stat($file))[9];
                my ($file_id)= $file =~ /([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:[^\/]*)\.jsonl\z/i;
                push @files,[$file,$mtime] if defined $mtime && (now($mtime) ge $cutoff || ($file_id && $known{lc $file_id}));
            }
        }
    }
}
}
# Prefer the fullest copy after migration. Native source IDs and server cursors
# remain stable across root changes, so copied history isn't charged twice.
@files = sort { (-s $b->[0]) <=> (-s $a->[0]) || $a->[0] cmp $b->[0] } @files;
if (@files) {
    my $start = ($scan_state->{next_index}//0) % @files;
    push @files,splice @files,0,$start;
}
my (@batches,@evidence,%skips,%seen);
my ($bytes,$checked,$backlog) = (0,0,JSON::PP::false);
my ($cursor_queries,$unchanged,$excluded,$baseline_events,$reset_events,$unmeasured)=(0,0,0,0,0,0);
my $deadline = time()+12;
for my $entry (@files) {
    if ($checked>=8 || $bytes>=1048576 || time()>=$deadline) { $backlog=JSON::PP::true; last }
    $checked++;
    open my $fh,'<:raw',$entry->[0] or do { $skips{$checked}='cannot_open'; next };
    my $size = -s $fh;
    my $head = '';
    # Recent Codex builds can emit a session_meta line larger than 16 KiB
    # because it includes the resolved instruction set. Keep the read bounded,
    # but large enough to decode that first JSONL record in the fast path.
    while (index($head,"\n")<0 && $bytes<1048576) {
        my $chunk='';
        my $n=read($fh,$chunk,min(4096,1048576-$bytes)) // 0;
        last unless $n;
        $head.=$chunk; $bytes+=$n;
    }
    my ($first) = $head =~ /\A([^\n]+)\n/;
    my $meta = eval { $json->decode($first // '') };
    if (!$meta || $meta->{type} ne 'session_meta') { $skips{$checked}=index($head,"\n")<0 ? 'metadata_exceeds_budget_or_incomplete' : 'no_session_metadata'; next }
    my $p = $meta->{payload};
    my $source = lc($p->{id} // '');
    next unless $source =~ $uuid;
    next if @only_sources && !grep {lc($_) eq $source} @only_sources;
    my $head_hash=sha256_hex($first);
    if (defined $scan_state->{source_headers}{$source} && $scan_state->{source_headers}{$source} ne $head_hash) {
        $skips{$checked}='source_header_changed_requires_confirmation'; next;
    }
    $scan_state->{source_headers}{$source}=$head_hash;
    if ($scan_state->{excluded}{$source}) { $excluded++; next }
    if (($exclude // '') eq $source || $p->{parent_thread_id} || (ref($p->{source}) eq 'HASH' && $p->{source}{subagent})) { $excluded++; next }
    if ($seen{$source}++) { $skips{$checked}='duplicate_source'; next }
    my $cursor = cursor($source);
    $cursor_queries++;
    my $from = $cursor->{offset};
    my $resolved_repo=resolve_project($p,$source);
    if ($size == $from) {
        if ($include && $cursor->{session_exists} && !$cursor->{project_status}{state}) {
            my ($folder)=($p->{cwd}//'') =~ m{([^/\\:]+)[/\\]*\z};
            push @evidence,{source_id=>$source,repository=>$resolved_repo,workspace_name=>$folder,outcomes=>[],
                previous_summary=>$cursor->{latest_summary},previous_project_report=>$cursor->{project_report},previous_project_status=>$cursor->{project_status}};
        }
        if ($resolved_repo && $cursor->{session_exists} && ($cursor->{project_key}//'') ne $resolved_repo) {
            if (grep {$_ eq 'project_mapping_backfill'} @{$directory->{capabilities}//[]}) {
                push @batches,{schema_version=>1,batch_id=>uuid4(),sent_at=>now(),collector_version=>'3.3.0',
                    sessions=>[],agents=>[],summaries=>[],projects=>[],usage=>[],
                    mappings=>[{session_id=>$source,repository=>$resolved_repo}],
                    cursor=>{source_id=>$source,from_offset=>$from,to_offset=>$from,context=>$cursor->{context}}};
            } else {push @project_unresolved,{source_id=>$source,reason=>'server_project_mapping_upgrade_required'}}
        }
        $unchanged++; next;
    }
    if ($size < $from) { $skips{$checked}='file_truncated'; next }
    seek($fh,$from,0) or die "Cannot seek log\n";
    my $buffer = '';
    $bytes += read($fh,$buffer,min($size-$from,1048576-$bytes)) // 0;
    my $end = $from;
    my $context = $cursor->{context} // {};
    my $source_cutoff=$context->{report_from} // ($from>0 ? '1970-01-01T00:00:00Z' : $cutoff);
    my ($model,$activity,$state) = ($context->{model},undef,undef);
    my $terminal=0;
    my $agent = id("codex:agent:$source");
    my (@usage,@notes);
    while ($buffer =~ /([^\n]*)\n/g) {
        last if time()>=$deadline || @usage>=90;
        my $row = eval { $json->decode($1) };
        if (!$row) { $skips{$checked}='invalid_log_line'; last }
        my $position = $end;
        $end = $from+pos($buffer);
        my $data = $row->{payload} // {};
        # Inspect actual user records, never instructions embedded in session_meta.
        if (!$scan_state->{first_user_seen}{$source} && $row->{type} eq 'event_msg' && ($data->{type}//'') eq 'user_message') {
            $scan_state->{first_user_seen}{$source}=JSON::PP::true;
            if (($data->{message}//'') =~ /\APROJECT_PULSE_AUTOMATION(?:\b|\x{3002})/) {
                $scan_state->{excluded}{$source}=JSON::PP::true;
                @usage=(); @notes=(); $end=$from; $skips{$checked}='reporting_session'; last;
            }
        }
        if ($row->{type} eq 'turn_context' && ($data->{model}//'') =~ /\A[\w.\/:\-]{1,100}\z/) {
            $model = $data->{model};
        }
        my $at = $row->{timestamp} // '';
        next unless $at =~ /\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z\z/;
        my $recent = substr($at,0,19) ge substr($source_cutoff,0,19);
        my $type = $data->{type} // '';
        if ($recent && (($row->{type} eq 'event_msg' && $type =~ /\A(?:user_message|agent_message|agent_reasoning)\z/) ||
            ($row->{type} eq 'response_item' && $type =~ /\A(?:function_call|function_call_output|custom_tool_call|custom_tool_call_output)\z/))) {
            $activity=$at;$state='running';$terminal=0;
        }
        next unless $row->{type} eq 'event_msg';
        if ($type eq 'token_count' && ref($data->{info}{total_token_usage}) eq 'HASH') {
            my $total = $data->{info}{total_token_usage};
            my %delta;
            my $initial=!defined $context->{input_tokens} && !defined $context->{output_tokens};
            my $reset=grep {defined $context->{$_} && defined $total->{$_} && $total->{$_}<$context->{$_}} @counts;
            $baseline_events++ if $initial;
            $reset_events++ if $reset;
            for my $key (@counts) {
                my ($old,$new) = ($context->{$key},$total->{$key});
                $new = undef unless defined $new && $new =~ /\A\d+\z/ && $new<=9007199254740991;
                my $last=$data->{info}{last_token_usage}{$key};
                # First cumulative snapshot is attributable to this session. On
                # reset, only use the explicit last-turn value, never guess.
                $delta{$key} = $reset ? (defined $last && $last =~ /\A\d+\z/ && defined $new && $last<=$new ? 0+$last : undef)
                    : defined $new ? ($initial ?
                        ((($p->{timestamp}//$meta->{timestamp}//'') ge $source_cutoff) ? 0+$new :
                            defined $last && $last =~ /\A\d+\z/ && $last<=$new ? 0+$last : undef)
                        : defined $old && $new >= $old ? $new-$old : undef) : undef;
                $context->{$key} = $new;
            }
            $unmeasured++ if $recent && grep {!defined $delta{$_}} @counts;
            if ($recent && (($delta{input_tokens}//0)>0 || ($delta{output_tokens}//0)>0)) {
                $delta{cached_input_tokens}=undef if defined $delta{input_tokens}
                    && ($delta{cached_input_tokens}//0)>$delta{input_tokens};
                push @usage,{%delta,event_id=>id("codex:usage:$source:$position"),session_id=>$source,agent_id=>$agent,
                    occurred_at=>$at,provider=>undef,model=>$model,accounting=>'billable'};
                $activity=$at;
                my $effective=$state // $cursor->{agent_state} // 'unknown';
                $state='running' if !$terminal && $effective !~ /\A(?:completed|failed|idle)\z/;
            }
        } elsif ($recent && $type =~ /\A(?:task_started|task_complete|turn_aborted)\z/) {
            $activity=$at;
            $state={task_started=>'running',task_complete=>'completed',turn_aborted=>'idle'}->{$type};
            $terminal=$type eq 'task_started' ? 0 : 1;
            if ($type eq 'task_complete' && $include) {
                my $note = narrative($data->{last_agent_message});
                push @notes,$note if $note =~ /\S/;
                shift @notes if @notes>2;
            }
        }
    }
    $backlog=JSON::PP::true if $end<$size;
    if ($end == $from) { $skips{$checked} //= 'no_complete_line_within_budget'; next }
    my (@sessions,@agents);
    if ($activity) {
        my $repo=$resolved_repo;
        my ($folder) = ($p->{cwd}//'') =~ m{([^/\\:]+)[/\\]*\z};
        $folder=undef if defined $folder && ($folder =~ /[\x00-\x1f]/ || length($folder)>120 || $folder =~ /\A\.{1,2}\z/);
        push @sessions,{session_id=>$source,tool=>'codex',revision=>$end,repository=>$repo,started_at=>undef,
            last_activity_at=>$activity,project_observation=>undef,defined($folder)?(workspace_name=>$folder):()};
        push @agents,{agent_id=>$agent,session_id=>$source,parent_agent_id=>undef,kind=>'main',role=>undef,
            state=>$state // $cursor->{agent_state} // 'unknown',last_activity_at=>$activity,revision=>$end};
        if (@notes || (($repo || $folder) && !$cursor->{project_report})) {
            push @evidence,{source_id=>$source,repository=>$repo,workspace_name=>$folder,outcomes=>\@notes,
                previous_summary=>$cursor->{latest_summary},previous_project_report=>$cursor->{project_report},previous_project_status=>$cursor->{project_status}};
        }
    }
    my $batch_id = uuid4();
    push @batches,{schema_version=>1,batch_id=>$batch_id,sent_at=>now(),collector_version=>'3.3.0',
        sessions=>\@sessions,agents=>\@agents,summaries=>[],projects=>[],usage=>\@usage,
        cursor=>{source_id=>$source,from_offset=>$from,to_offset=>$end,
            context=>{model=>$model,report_from=>$source_cutoff,map { $_=>$context->{$_} } @counts}}};
}
my $diagnostics={checked_files=>$checked,cursor_queries=>$cursor_queries,unchanged_files=>$unchanged,excluded_files=>$excluded,
    project_unresolved=>\@project_unresolved,
    session_roots_found=>scalar @roots,discovery_checked=>$discovery_checked,discovery_incomplete=>(@queue ? JSON::PP::true : JSON::PP::false),
    recovery_unverified=>$scan_state->{recovery_unverified}//JSON::PP::false,
    initial_snapshots=>$baseline_events,counter_resets=>$reset_events,unmeasured_snapshots=>$unmeasured,skipped=>\%skips};
$scan_state->{next_index}=($scan_state->{next_index}//0)+$checked;
$scan_state->{pending_work}=$work if @batches;
write_json($plan_file,{batches=>\@batches,allowed_sources=>\@only_sources,bytes_read=>$bytes,backlog=>$backlog,label=>$label,github_login=>$github_login});
write_json("$state_file.tmp",$scan_state); rename "$state_file.tmp",$state_file or die "Cannot persist scan progress\n";
print $json->encode({collector_version=>'3.3.0',server=>$server,prepared_batches=>scalar @batches,usage=>usage_totals([map {@{$_->{usage}}} @batches]),
    bytes_read=>$bytes,backlog=>$backlog,diagnostics=>$diagnostics,evidence=>\@evidence}),"\n";
sub min { $_[0]<$_[1] ? $_[0] : $_[1] }

sub entries {
    my ($dir,$pattern) = @_;
    opendir my $handle,$dir or return;
    return map { "$dir/$_" } grep { /$pattern/ } readdir $handle;
}
