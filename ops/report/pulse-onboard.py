"""Run the bundled collector with the project's confirmed scope and service addresses."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import os
import json
import hashlib
import importlib.util
import re
from pathlib import Path
import shutil
import subprocess
import time
import sys
import uuid

PULSE = "http://192.168.20.58:4185"
EMBER = "http://192.168.20.58:5174"
PACKAGE = Path(__file__).resolve().parent
PENDING = PACKAGE / ".pulse-pending"
PAIRED_SCOPE = "uploaded-sessions"


def approved_sources(*, require_channels=False):
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    if selection.get("schema_version") != 1 or not selection.get("confirmed_at"):
        raise ValueError("需要先确认项目范围")
    if require_channels and selection.get("ember_paired") == PAIRED_SCOPE:
        missing = [project.get("repository") or project["workspace_name"] for project in selection["projects"]
                   if not project.get("ember_room_id")]
        if missing:
            raise ValueError("请先绑定这些项目的 Ember 频道：" + "、".join(missing))
    sources = sorted({str(uuid.UUID(source)) for project in selection["projects"] for source in project["source_ids"]})
    if not sources:
        raise ValueError("没有获准上报的会话")
    return sources


def collector(action, work, sources, excluded=None, label=None, github_login=None, project_key=None):
    if sys.platform == "win32":
        def quote(text):
            return "'" + str(text).replace("'", "''") + "'"

        parameters = [f"-Action {action}", f"-Server {quote(PULSE)}",
                      "-OnlySource @(" + ",".join(quote(source) for source in sources) + ")"]
        if work is not None:
            parameters.append(f"-WorkDir {quote(work)}")
        if project_key is not None:
            parameters.append(f"-ProjectKey {quote(project_key)}")
        if action == "Prepare":
            parameters += ["-IncludeEvidence", "-ResolveGit"]
            for flag, value in (("ExcludeSessionId", excluded), ("Label", label), ("GitHubLogin", github_login)):
                if value:
                    parameters.append(f"-{flag} {quote(value)}")
        command = ["powershell.exe", "-NoProfile", "-Command",
                   "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; & "
                   + quote(PACKAGE / "pulse-report.ps1") + " " + " ".join(parameters)]
    else:
        interpreter = ["/usr/bin/perl", str(PACKAGE / "pulse-report.pl")] if sys.platform == "darwin" else [
            "sh", str(PACKAGE / "pulse-report-linux.sh")]
        command = interpreter + ["--action", action, "--server", PULSE]
        if work is not None:
            command += ["--work-dir", str(work)]
        if project_key is not None:
            command += ["--project-key", project_key]
        for source in sources:
            command += ["--only-source", source]
        if action == "Prepare":
            command += ["--include-evidence", "--resolve-git"]
            for flag, value in (("--exclude-session-id", excluded), ("--label", label), ("--github-login", github_login)):
                if value:
                    command += [flag, value]
    raw = subprocess.check_output(command, cwd=PACKAGE, encoding="utf-8-sig")
    return json.loads(raw)


def load_connector():
    spec = importlib.util.spec_from_file_location("ember_connect", PACKAGE / "ember-connect.py")
    connector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(connector)
    return connector


def bind_reporting_member(result):
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    if selection.get("ember_paired") != PAIRED_SCOPE:
        return
    try:
        proof = collector("DeviceProof", None, [])
        result["ember_reporting_member"] = load_connector().call_tool("bind_pulse_device", proof)
    except (ValueError, OSError, KeyError, StopIteration, subprocess.SubprocessError) as exc:
        result["ember_reporting_member"] = {"status": "pending", "error": str(exc)}


def bind_project_channels():
    approved_sources()
    path = PACKAGE / ".pulse-project-selection.json"
    selection = json.loads(path.read_text(encoding="utf-8-sig"))
    connector = load_connector()
    results = []
    paired = selection.get("ember_paired") == PAIRED_SCOPE
    projects = [project for project in selection["projects"] if paired or project.get("ember_publish") is not False]
    if not projects:
        return results
    rooms = {row["id"]: row for row in connector.call_tool("list_rooms", {})["rooms"] if row["kind"] != "direct"}
    for project in projects:
        repository = project.get("repository")
        try:
            room_id = project.get("ember_room_id")
            if room_id:
                if room_id not in rooms:
                    raise ValueError("已绑定频道不可访问，请核对授权或频道成员")
            elif repository and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
                arguments = {"repository": repository}
                if project.get("project_name"):
                    arguments["project_name"] = project["project_name"]
                room = connector.call_tool("create_project_channel", arguments)["room"]
                room_id = room["id"]
                project["ember_room_id"] = room_id
                save = path.with_suffix(".tmp")
                save.write_text(json.dumps(selection, ensure_ascii=True), encoding="utf-8")
                save.chmod(0o600)
                save.replace(path)
            else:
                raise ValueError("缺少已核实的 GitHub 仓库")
            results.append({"project": repository, "channel": f"{EMBER}/rooms/{room_id}"})
        except (ValueError, OSError, KeyError, StopIteration) as exc:
            results.append({"project": repository, "error": str(exc)})
    return results


def plain(text):
    cleaned = re.sub(r"(?:https?://|(?:^|\s)[~/]|\b[A-Za-z]:[\\/])\S+", " ", str(text or ""))
    cleaned = re.sub(r"[<>\[\]@#*_~`]", "", cleaned)
    return " ".join(cleaned.split())[:200]


def reported_project_sessions(project_key, sources):
    sessions = []
    project = None
    for start in range(0, len(sources), 50):
        batch = sources[start:start + 50]
        inventory = collector("Inventory", None, batch, project_key=project_key)
        if not inventory.get("project"):
            continue
        if inventory["project"]["project_key"].lower() != project_key.lower():
            raise ValueError("Project Pulse 返回的项目归属不匹配")
        project = inventory["project"]
        allowed = set(batch)
        sessions.extend(row for row in inventory["sessions"]
                        if row["source_id"].lower() in allowed and row["project_key"].lower() == project_key.lower())
    return project, sessions


def project_snapshot(project_key, sources):
    project, sessions = reported_project_sessions(project_key, sources)
    if not project:
        return None
    status_labels = {"on_track": "在研", "blocked": "受阻", "completed": "已完成", "paused": "已暂停"}
    status = status_labels.get((project.get("status") or {}).get("state"))
    goal = plain(project.get("goal"))
    milestones = [("已完成" if item["state"] == "completed" else "待完成") + " · " + plain(item["title"])
                  for item in project.get("milestones") or []]
    # Use one stable, bounded snapshot of the approved device's reported summaries.
    ordered = sorted(sessions, key=lambda row: (str(row.get("observed_at") or ""), row["source_id"]), reverse=True)
    progress = list(dict.fromkeys(plain(row["summary"]) for row in ordered if row.get("summary")))[:3]
    if not status and not goal and not milestones and not progress:
        return None
    lines = [f"项目进展 · {plain(project_key)}"]
    if status:
        lines.append("状态 · " + status)
    if goal:
        lines.append("目标 · " + goal)
    lines.extend(progress + milestones[:8])
    return "\n\n".join(lines)


def write_state(path, record):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(record, stream, ensure_ascii=True)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


@contextmanager
def publication_lock():
    PENDING.mkdir(mode=0o700, exist_ok=True)
    with (PENDING / "ember-publication.lock").open("a+b") as lock:
        if sys.platform == "win32":
            import msvcrt
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def publish_progress():
    approved_sources()
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    paired = selection.get("ember_paired") == PAIRED_SCOPE
    targets = [p for p in selection["projects"] if p.get("ember_room_id") and (paired or p.get("ember_publish") is not False)]
    if not targets:
        return []
    results = []
    with publication_lock():
        connector = load_connector()
        for project in targets:
            room_id = project["ember_room_id"]
            label = project.get("repository") or project["workspace_name"]
            result = {"project": label, "channel": f"{EMBER}/rooms/{room_id}"}
            results.append(result)
            try:
                sources = sorted({str(uuid.UUID(source)) for source in project["source_ids"]})
                sync_project(connector, result, label, room_id, sources)
            except (ValueError, OSError, KeyError, RuntimeError, StopIteration, subprocess.SubprocessError) as exc:
                result.update(status="待补发", error=str(exc))
    return results


def sync_project(connector, result, label, room_id, sources):
    # A changed project selection must never publish an older, differently scoped snapshot.
    scope = hashlib.sha256(json.dumps([label.lower(), room_id, sources]).encode()).hexdigest()
    key = hashlib.sha256(json.dumps([label.lower(), room_id]).encode()).hexdigest()[:20]
    path = PENDING / ("ember-" + key + ".json")
    state = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    pending = state.get("pending")
    if pending and pending["scope"] != scope:
        pending = None
    try:
        body = project_snapshot(label, sources)
    except (ValueError, OSError, KeyError, subprocess.SubprocessError):
        if not pending:
            raise
        body = None
    if body:
        digest = hashlib.sha256(body.encode()).hexdigest()
        if state.get("digest") == digest:
            pending = None
        elif not pending or pending["digest"] != digest:
            pending = {"scope": scope, "digest": digest, "body": body}
        # Persist the verified snapshot before attempting the network operation.
        if pending != state.get("pending"):
            write_state(path, {**state, "pending": pending})
    if not pending:
        result["status"] = "无新进展" if body else "暂无已核实进展"
        return
    update_id = "pulse" + pending["digest"][:16]
    previous = connector.call_tool("read_room", {"room_id": room_id})
    seen = any("同步编号 " + update_id in message["text"] for message in previous["messages"])
    if not seen and pending.get("attempted_at"):
        matches = connector.call_tool("search_messages", {"room_id": room_id, "words": update_id})
        seen = bool(matches["matches"])
    if not seen:
        pending["attempted_at"] = datetime.now(timezone.utc).isoformat()
        write_state(path, {**state, "pending": pending})
        connector.call_tool("send_message", {"room_id": room_id, "text": pending["body"] + "\n\n同步编号 " + update_id})
    write_state(path, {"digest": pending["digest"], "pending": None})
    result["status"] = "已同步"


def start_listener():
    approved_sources()
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    if selection.get("ember_paired") != PAIRED_SCOPE:
        return "请用新版接入提示词确认项目"
    projects = selection["projects"]
    rooms = {p.get("ember_room_id") for p in projects}
    if not all(isinstance(room, str) and room for room in rooms):
        raise ValueError("启用本机代答的项目仍有频道未绑定")
    codex = shutil.which("codex")
    if not codex:
        raise OSError("找不到本机 Codex CLI")
    status = subprocess.run([codex, "login", "status"], cwd=PACKAGE, timeout=15,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if status.returncode:
        raise ValueError("本机 Codex CLI 尚未登录，请登录后重试")
    connector = load_connector()
    response = connector.mcp({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, "2025-06-18")
    tools = {tool["name"] for tool in (response or {}).get("result", {}).get("tools", [])}
    if not {"read_room", "send_message"} <= tools:
        raise ValueError("Ember 网页授权缺少读取频道或发送消息权限")
    for room in sorted(rooms):
        connector.call_tool("read_room", {"room_id": room})
    PENDING.mkdir(mode=0o700, exist_ok=True)
    options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS} if sys.platform == "win32" else {"start_new_session": True}
    with (PENDING / "ember-member-listener.log").open("ab") as log:
        process = subprocess.Popen([sys.executable, str(PACKAGE / "ember-member-listener.py")], stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=log, cwd=PACKAGE, **options)
    time.sleep(1)
    exit_code = process.poll()
    if exit_code not in (None, 3):
        raise OSError("本机 Codex 监听启动失败，请查看 .pulse-pending/ember-member-listener.log")
    return "已运行"


def check_listener(result):
    try:
        result["ember_member_listener"] = start_listener()
    except (ValueError, OSError, KeyError, StopIteration, subprocess.SubprocessError) as exc:
        result["ember_member_listener"] = "未就绪"
        result["ember_member_listener_error"] = str(exc)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["links", "bind-channels", "sync-ember", "start-listener", "prepare", "submit"])
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--exclude-session-id", type=lambda value: str(uuid.UUID(value)))
    parser.add_argument("--label")
    parser.add_argument("--github-login")
    args = parser.parse_args()
    result = {"ember": EMBER, "project_pulse": PULSE}
    try:
        if args.action == "bind-channels":
            result["channels"] = bind_project_channels()
            if any("error" in channel for channel in result["channels"]):
                raise ValueError("部分项目频道未绑定，请核对频道权限和仓库归属后重试")
            bind_reporting_member(result)
            check_listener(result)
            result["ember_posts"] = publish_progress()
        elif args.action == "sync-ember":
            bind_reporting_member(result)
            check_listener(result)
            result["ember_posts"] = publish_progress()
        elif args.action == "start-listener":
            check_listener(result)
        elif args.action != "links":
            sources = approved_sources(require_channels=True)
            if args.action == "prepare":
                PENDING.mkdir(mode=0o700, exist_ok=True)
                work = PENDING / uuid.uuid4().hex
            else:
                work = args.work_dir.resolve() if args.work_dir else None
                if not work or work.parent != PENDING.resolve() or not (work / "plan.json").is_file():
                    raise ValueError("请使用本轮准备上报返回的工作目录")
            result["work_dir"] = str(work)
            result["report"] = collector(args.action.capitalize(), work, sources, args.exclude_session_id,
                                         args.label, args.github_login)
            if args.action == "submit":
                bind_reporting_member(result)
                try:
                    result["ember_posts"] = publish_progress()
                except (ValueError, OSError, KeyError, RuntimeError, StopIteration) as exc:
                    result["ember_error"] = str(exc)
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as exc:
        result["error"] = str(exc)
    print(json.dumps(result, ensure_ascii=True))
    return 1 if "error" in result or (args.action == "start-listener" and "ember_member_listener_error" in result) else 0


if __name__ == "__main__":
    sys.exit(main())
