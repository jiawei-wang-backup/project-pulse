#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP;
use Digest::SHA qw(sha256_hex);
use Getopt::Long;
use POSIX qw(strftime);
use Time::HiRes qw(time);
use Encode qw(encode_utf8);

my ($action,$work,$server,$label,$exclude,$include,$tool) =
  ('Prepare',undef,'http://192.168.16.70:4185',undef,undef,0,'codex');
GetOptions('action=s'=>\$action,'work-dir=s'=>\$work,'server=s'=>\$server,'label=s'=>\$label,
    'exclude-session-id=s'=>\$exclude,'include-evidence'=>\$include,'summarizer-tool=s'=>\$tool) or die "Invalid options\n";
die "Expected Prepare or Submit and --work-dir\n" unless $work && $action =~ /\A(?:Prepare|Submit)\z/;
die "Invalid tool ID\n" unless $tool =~ /\A[a-z][a-z0-9_]{0,63}\z/;
$server =~ s{/$}{};
die "Expected private IPv4 HTTP origin\n" unless $server =~ m{\Ahttp://((?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)[0-9.]+)(?::[1-9][0-9]{0,4})?\z}
    && (split /\./,$1)==4 && !grep { !/\A(?:0|[1-9][0-9]{0,2})\z/ || $_>255 } split /\./,$1;
umask 0077;
my $json = JSON::PP->new->utf8->canonical;
my $uuid = qr/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/i;
my ($machine) = qx{/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice} =~ /"IOPlatformUUID"\s*=\s*"([^"]+)"/;
die "Missing IOPlatformUUID\n" unless $machine;
my $device = sha256_hex("$machine\n$<");
my $plan_file = "$work/plan.json";
my @counts = qw(input_tokens cached_input_tokens output_tokens);

sub now { strftime('%Y-%m-%dT%H:%M:%SZ',gmtime($_[0] // time())) }
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
        if (defined $label && length $label) {
            my $encoded = $label;
            $encoded =~ s/([^A-Za-z0-9_.~-])/sprintf("%%%02X",ord($1))/ge;
            push @args,'-H',"X-Pulse-LAN-Label: $encoded";
        }
        push @args,'-H','Content-Type: application/json','--data-binary',"\@$body";
    }
    open my $pipe,'-|','/usr/bin/curl',@args,"$server$route" or die "Cannot run curl\n";
    my $output = do { local $/; <$pipe> };
    close $pipe or die "Request failed: $route\n";
    return $json->decode($output);
}
sub cursor { request("/api/v1/report-cursor?source_id=$_[0]") }
sub narrative {
    my $text = $_[0] // '';
    $text =~ s{\x60\x60\x60.*?(?:\x60\x60\x60|\z)|https?://\S+|\S+\@\S+|(?:^|\s)[~/]\S+|\b\S*(?:token|secret|password|api[_-]?key)\S*\s*[:=]\s*\S+}{ [redacted] }gis;
    $text =~ s/\s+/ /g;
    return substr($text,0,240);
}

if ($action eq 'Submit') {
    my $plan = read_json($plan_file);
    my %edits;
    if (-f "$work/summaries.json") {
        for my $edit (@{read_json("$work/summaries.json")}) {
            die "Duplicate summary\n" if exists $edits{$edit->{source_id}};
            $edits{$edit->{source_id}} = $edit;
        }
    }
    my ($sent,$advanced) = (0,0);
    for my $batch (@{$plan->{batches}}) {
        my ($source,$end) = @{$batch->{cursor}}{qw(source_id to_offset)};
        my $edit = $edits{$source} // {};
        my $session = $batch->{sessions}[0];
        my $project = $session ? ($session->{repository} // $session->{workspace_name}) : undef;
        if ($session && $edit->{summary}) {
            $batch->{summaries} = [{summary_id=>id("codex:summary:$source:$end"),session_id=>$source,
                observed_at=>$session->{last_activity_at},summary=>$edit->{summary},summarizer_tool=>$tool,prompt_version=>'2.1.0'}];
        }
        if ($project && $edit->{goal} && $edit->{milestones}) {
            $batch->{projects} = [{report_id=>id("codex:project:$source:$end:$project"),source_session_id=>$source,
                project_key=>$project,goal=>$edit->{goal},milestones=>$edit->{milestones},
                observed_at=>$session->{last_activity_at},summarizer_tool=>$tool,prompt_version=>'2.1.0'}];
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
        $sent++;
    }
    print $json->encode({submitted_batches=>$sent,server_cursor_already_advanced=>$advanced,
        bytes_read=>$plan->{bytes_read},backlog=>$plan->{backlog}}),"\n";
    exit;
}

mkdir $work or die "Prepare requires a new working directory\n";
my $root = ($ENV{CODEX_HOME} // "$ENV{HOME}/.codex") . '/sessions';
my $cutoff = now(time()-7*86400);
my @files;
for my $year (entries($root,qr/\A[0-9]{4}\z/)) {
    next if -l $year;
    for my $month (entries($year,qr/\A[0-9]{2}\z/)) {
        next if -l $month;
        for my $day (entries($month,qr/\A[0-9]{2}\z/)) {
            next if -l $day;
            for my $file (entries($day,qr/\.jsonl\z/)) {
                next unless -f $file && !-l $file;
                my $mtime = (stat($file))[9];
                push @files,[$file,$mtime] if defined $mtime && now($mtime) ge $cutoff;
            }
        }
    }
}
@files = sort { $a->[0] cmp $b->[0] } @files;
if (@files > 8) {
    my $start = int(time()/1800) % @files;
    push @files,splice @files,0,$start;
}
my (@batches,@evidence,%skips,%seen);
my ($bytes,$checked,$backlog) = (0,0,JSON::PP::false);
my $deadline = time()+12;
for my $entry (@files) {
    if ($checked>=8 || $bytes>=1048576 || time()>=$deadline) { $backlog=JSON::PP::true; last }
    $checked++;
    open my $fh,'<:raw',$entry->[0] or do { $skips{$checked}='cannot_open'; next };
    my $size = -s $fh;
    my $head = '';
    $bytes += read($fh,$head,min(16384,1048576-$bytes)) // 0;
    my ($first) = $head =~ /\A([^\n]+)\n/;
    my $meta = eval { $json->decode($first // '') };
    if (!$meta || $meta->{type} ne 'session_meta') { $skips{$checked}='no_session_metadata'; next }
    my $p = $meta->{payload};
    my $source = lc($p->{id} // '');
    next unless $source =~ $uuid;
    next if $head =~ /PROJECT_PULSE_AUTOMATION/ || ($exclude // '') eq $source ||
        $p->{parent_thread_id} || (ref($p->{source}) eq 'HASH' && $p->{source}{subagent});
    if ($seen{$source}++) { $skips{$checked}='duplicate_source'; next }
    my $cursor = cursor($source);
    my $from = $cursor->{offset};
    next if $size == $from;
    if ($size < $from) { $skips{$checked}='file_truncated'; next }
    seek($fh,$from,0) or die "Cannot seek log\n";
    my $buffer = '';
    $bytes += read($fh,$buffer,min($size-$from,1048576-$bytes)) // 0;
    my $end = $from;
    my $context = $cursor->{context} // {};
    my ($model,$activity,$state) = ($context->{model},undef,undef);
    my $agent = id("codex:agent:$source");
    my (@usage,@notes);
    while ($buffer =~ /([^\n]*)\n/g) {
        last if time()>=$deadline || @usage>=90;
        my $row = eval { $json->decode($1) };
        if (!$row) { $skips{$checked}='invalid_log_line'; last }
        my $position = $end;
        $end = $from+pos($buffer);
        my $data = $row->{payload} // {};
        if ($row->{type} eq 'turn_context' && ($data->{model}//'') =~ /\A[\w.\/:\-]{1,100}\z/) {
            $model = $data->{model};
        }
        next unless $row->{type} eq 'event_msg';
        my $at = $row->{timestamp} // '';
        next unless $at =~ /\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z\z/;
        my $recent = substr($at,0,19) ge substr($cutoff,0,19);
        my $type = $data->{type} // '';
        if ($type eq 'token_count' && ref($data->{info}{total_token_usage}) eq 'HASH') {
            my $total = $data->{info}{total_token_usage};
            my %delta;
            for my $key (@counts) {
                my ($old,$new) = ($context->{$key},$total->{$key});
                $new = undef unless defined $new && $new =~ /\A\d+\z/ && $new<=9007199254740991;
                $delta{$key} = defined $old && defined $new && $new >= $old ? $new-$old : undef;
                $context->{$key} = $new;
            }
            if ($recent && (($delta{input_tokens}//0)>0 || ($delta{output_tokens}//0)>0)) {
                $delta{cached_input_tokens}=undef if defined $delta{input_tokens}
                    && ($delta{cached_input_tokens}//0)>$delta{input_tokens};
                push @usage,{%delta,event_id=>id("codex:usage:$source:$position"),session_id=>$source,agent_id=>$agent,
                    occurred_at=>$at,provider=>undef,model=>$model,accounting=>'billable'};
                $activity=$at;
            }
        } elsif ($recent && $type =~ /\A(?:task_started|task_complete|turn_aborted)\z/) {
            $activity=$at;
            $state={task_started=>'running',task_complete=>'completed',turn_aborted=>'idle'}->{$type};
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
        my ($remote) = ($p->{git}{repository_url}//'') =~ m{\A(?:https://github\.com/|git\@github\.com:|ssh://git\@github\.com/)([\w.-]+/[\w.-]+?)(?:\.git)?/?\z}i;
        my ($repo) = grep { defined $remote && lc($_) eq lc($remote) } @{$cursor->{repositories}};
        my ($folder) = ($p->{cwd}//'') =~ m{([^/\\:]+)[/\\]*\z};
        $folder=undef if defined $folder && ($folder =~ /[\x00-\x1f]/ || length($folder)>120 || $folder =~ /\A\.{1,2}\z/);
        push @sessions,{session_id=>$source,tool=>'codex',revision=>$end,repository=>$repo,started_at=>undef,
            last_activity_at=>$activity,project_observation=>undef,defined($folder)?(workspace_name=>$folder):()};
        push @agents,{agent_id=>$agent,session_id=>$source,parent_agent_id=>undef,kind=>'main',role=>undef,
            state=>$state // $cursor->{agent_state} // 'unknown',last_activity_at=>$activity,revision=>$end};
        if (@notes || (($repo || $folder) && !$cursor->{project_report})) {
            push @evidence,{source_id=>$source,repository=>$repo,workspace_name=>$folder,outcomes=>\@notes,
                previous_summary=>$cursor->{latest_summary},previous_project_report=>$cursor->{project_report}};
        }
    }
    my $batch_id = lc qx{/usr/bin/uuidgen};
    chomp $batch_id;
    push @batches,{schema_version=>1,batch_id=>$batch_id,sent_at=>now(),collector_version=>'2.1.0',
        sessions=>\@sessions,agents=>\@agents,summaries=>[],projects=>[],usage=>\@usage,
        cursor=>{source_id=>$source,from_offset=>$from,to_offset=>$end,
            context=>{model=>$model,map { $_=>$context->{$_} } @counts}}};
}
write_json($plan_file,{batches=>\@batches,bytes_read=>$bytes,backlog=>$backlog});
print $json->encode({prepared_batches=>scalar @batches,bytes_read=>$bytes,backlog=>$backlog,skipped=>\%skips,evidence=>\@evidence}),"\n";
sub min { $_[0]<$_[1] ? $_[0] : $_[1] }

sub entries {
    my ($dir,$pattern) = @_;
    opendir my $handle,$dir or return;
    return map { "$dir/$_" } grep { /$pattern/ } readdir $handle;
}
