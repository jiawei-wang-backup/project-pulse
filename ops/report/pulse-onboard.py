"""Run the bundled collector with the project's confirmed scope and service addresses."""
import argparse
import json
import hashlib
import importlib.util
import re
from pathlib import Path
import subprocess
import sys
import uuid

PULSE = "http://192.168.20.47:4185"
EMBER = "http://192.168.20.47:5174"
PACKAGE = Path(__file__).resolve().parent
PENDING = PACKAGE / ".pulse-pending"


def approved_sources():
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    if selection.get("schema_version") != 1 or not selection.get("confirmed_at"):
        raise ValueError("需要先确认项目范围")
    sources = sorted({str(uuid.UUID(source)) for project in selection["projects"] for source in project["source_ids"]})
    if not sources:
        raise ValueError("没有获准上报的会话")
    return sources


def collector(action, work, sources, excluded, label, github_login):
    if sys.platform == "win32":
        def quote(text):
            return "'" + str(text).replace("'", "''") + "'"

        parameters = [f"-Action {action}", f"-WorkDir {quote(work)}", f"-Server {quote(PULSE)}",
                      "-OnlySource @(" + ",".join(quote(source) for source in sources) + ")"]
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
        command = interpreter + ["--action", action, "--work-dir", str(work), "--server", PULSE]
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


def bind_project_channels():
    approved_sources()
    path = PACKAGE / ".pulse-project-selection.json"
    selection = json.loads(path.read_text(encoding="utf-8-sig"))
    connector = load_connector()
    results = []
    projects = [project for project in selection["projects"] if project.get("ember_publish") is not False]
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
                room = connector.call_tool("create_project_channel", {"repository": repository})["room"]
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


def publish_progress(work, report):
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    targets = [project for project in selection["projects"] if project.get("ember_room_id") and project.get("ember_publish") is not False]
    if not targets or not report["submitted_batches"]:
        return []

    connector = load_connector()
    rooms = {row["id"]: row for row in connector.call_tool("list_rooms", {})["rooms"] if row["kind"] != "direct"}
    batches = [json.loads((work / (str(uuid.UUID(row["batch_id"])) + ".json")).read_text(encoding="utf-8-sig"))
               for row in report["receipts"]]

    def plain(text):
        return re.sub(r"[<>\[\]@#*_~`]", "", " ".join(str(text or "").split()))[:200]

    results = []
    for project in targets:
        room_id = project["ember_room_id"]
        label = plain(project.get("repository") or project.get("workspace_name"))
        if room_id not in rooms:
            results.append({"project": label, "status": "频道不可访问"})
            continue
        allowed = {source.lower() for source in project["source_ids"]}
        project_keys = {key.lower() for key in [project.get("repository"), project.get("workspace_name"),
                                                 *project.get("repositories", [])] if key}
        published = [batch for batch in batches if batch["cursor"]["source_id"].lower() in allowed
                     and any((session.get("repository") or session.get("workspace_name") or "").lower() in project_keys
                             for session in batch["sessions"])]
        progress = sorted({plain(row["summary"]) for batch in published for row in batch["summaries"]} - {""})
        milestones = sorted({("已完成" if item["state"] == "completed" else "待完成") + " · " + plain(item["title"])
                             for batch in published for row in batch["projects"] for item in row["milestones"]})
        if not progress and not milestones:
            continue
        lines = [f"项目进展 · {label}", *progress[:3], *milestones[:8]]
        body = "\n\n".join(lines)
        digest = hashlib.sha256(body.encode()).hexdigest()
        update_id = digest[:12]
        receipt_key = hashlib.sha256(f"{label}/{room_id}".encode()).hexdigest()[:20]
        receipt = PENDING / ("ember-" + receipt_key + ".json")
        if receipt.exists() and json.loads(receipt.read_text()).get("digest") == digest:
            continue
        # Check before posting so a lost response does not cause an immediate duplicate.
        previous = connector.call_tool("read_room", {"room_id": room_id})
        if not any(update_id in message["text"] for message in previous["messages"]):
            connector.call_tool("send_message", {"room_id": room_id, "text": body + "\n\n同步编号 " + update_id})
        saved = receipt.with_suffix(".tmp")
        saved.write_text(json.dumps({"digest": digest}), encoding="utf-8")
        saved.replace(receipt)
        results.append({"project": label, "status": "已同步", "channel": f"{EMBER}/rooms/{room_id}"})
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["links", "bind-channels", "prepare", "submit"])
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--exclude-session-id", type=lambda value: str(uuid.UUID(value)))
    parser.add_argument("--label")
    parser.add_argument("--github-login")
    args = parser.parse_args()
    result = {"ember": EMBER, "project_pulse": PULSE}
    try:
        if args.action == "bind-channels":
            result["channels"] = bind_project_channels()
        elif args.action != "links":
            sources = approved_sources()
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
                try:
                    result["ember_posts"] = publish_progress(work, result["report"])
                except (ValueError, OSError, KeyError, RuntimeError, StopIteration) as exc:
                    result["ember_error"] = str(exc)
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as exc:
        result["error"] = str(exc)
    print(json.dumps(result, ensure_ascii=True))
    return 1 if "error" in result else 0


if __name__ == "__main__":
    sys.exit(main())
