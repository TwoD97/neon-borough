#!/usr/bin/env python3
"""Set up herdr's agent tools on this machine; the crew mod runs it on every machine herdr reaches.

  python3 install-agent-tools.py [--version V]

From the folder this script is in, it installs:
  herdr-crew      to ~/.local/bin (personas, roster, `herdr-crew wait`), plus Claude Code's
                  SessionStart hook that runs it;
  the activity hook into Claude Code (~/.claude) and Codex (~/.codex), only where they exist.
It writes ~/.herdr/agent-tools.json ({"version": V, ...}) so it runs again only when the tools
change. Settings get a backup before they change. `touch ~/.herdr/agent-tools-off` opts a
machine out. Prints a JSON summary.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shlex
import stat
import sys
import time

HERE = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(path, text, executable=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".new")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text.replace("\r\n", "\n"))
    if executable:
        os.chmod(tmp, os.stat(tmp).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    os.replace(tmp, path)


def session_start_hook(home, crew_path):
    """Adds Claude Code's SessionStart hook for herdr-crew, unless one is there already."""
    settings_path = home / ".claude/settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8-sig")) if settings_path.exists() else {}
    entries = settings.setdefault("hooks", {}).setdefault("SessionStart", [])
    if any("herdr-crew" in h.get("command", "") for e in entries for h in e.get("hooks", [])):
        return "already there"
    python = "python" if os.name == "nt" else "python3"
    path = str(crew_path).replace("\\", "/")
    command = f'{python} "{path}" session-start' if os.name == "nt" else f"{python} {shlex.quote(path)} session-start"
    entries.append({"hooks": [{"type": "command", "command": command, "timeout": 15}]})
    stamp = time.strftime("%Y%m%dT%H%M%S")
    if settings_path.exists():
        settings_path.with_name(f"settings.json.before-herdr-crew-{stamp}").write_text(settings_path.read_text(encoding="utf-8-sig"), encoding="utf-8")
    write(settings_path, json.dumps(settings, indent=2, ensure_ascii=False) + "\n")
    return "added"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="")
    parser.add_argument("--home", type=Path, default=Path.home())
    args = parser.parse_args()
    home = args.home
    if (home / ".herdr/agent-tools-off").exists():
        print(json.dumps({"skipped": "~/.herdr/agent-tools-off"}))
        return
    result = {"version": args.version, "at": int(time.time()), "claude": None, "codex": None, "crew": None, "errors": []}
    crew_path = home / ".local/bin/herdr-crew"
    try:
        write(crew_path, (HERE / "herdr-crew").read_text(encoding="utf-8"), executable=True)
        result["crew"] = str(crew_path)
    except Exception as e:
        result["errors"].append(f"herdr-crew: {e}")
    installer = load("install_activity_hook", "install-activity-hook.py")
    source = (HERE / "activity-hook.py").read_text(encoding="utf-8").replace("\r\n", "\n")
    for provider, folder in (("claude", ".claude"), ("codex", ".codex")):
        if not (home / folder).is_dir():
            continue
        try:
            done = installer.install(home, source, sys.executable, provider)
            result[provider] = {"hook": done["hook"], "review": done.get("review")}
            if provider == "claude":
                result[provider]["session_start"] = session_start_hook(home, crew_path)
        except Exception as e:
            result["errors"].append(f"{provider}: {e}")
    state = home / ".herdr/agent-tools.json"
    if not result["errors"]:
        write(state, json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
