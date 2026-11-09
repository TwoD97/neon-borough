#!/usr/bin/env python3
"""Install companion activity hooks, preserving Claude/Codex configuration."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shlex
import shutil
import sys
import tempfile

EVENTS = ("UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SessionEnd")
CODEX_EVENTS = ("UserPromptSubmit", "PreToolUse", "PostToolUse", "PreModelRequest", "PostModelRequest", "Stop", "Interrupt", "SessionEnd")
CODEX_LABELS = {
    "UserPromptSubmit": "Herdr activity - new turn",
    "PreToolUse": "Herdr activity - before tool",
    "PostToolUse": "Herdr activity - after tool",
    "PreModelRequest": "Herdr activity - generating response",
    "PostModelRequest": "Herdr activity - response completed",
    "Stop": "Herdr activity - turn completed",
    "Interrupt": "Herdr activity - interrupted",
    "SessionEnd": "Herdr activity - session cleanup",
}


def merged_settings(settings, command, events=EVENTS, previous_command=None):
    result = json.loads(json.dumps(settings))
    hooks = result.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("hooks must be an object")
    for event in events:
        entries = hooks.setdefault(event, [])
        if not isinstance(entries, list):
            raise ValueError(event + " hooks must be an array")
        matching = [hook for entry in entries if isinstance(entry, dict)
                    for hook in entry.get("hooks", []) if isinstance(hook, dict)
                    and hook.get("command") in (command, previous_command)
                    and hook.get("command") is not None]
        if matching:
            for hook in matching:
                hook["command"] = command
            if events == CODEX_EVENTS:
                for hook in matching:
                    hook["statusMessage"] = CODEX_LABELS[event]
            continue
        entry = {"hooks": [{"type": "command", "command": command, "timeout": 3 if events == CODEX_EVENTS else 5}]}
        if events == CODEX_EVENTS:
            entry["hooks"][0]["statusMessage"] = CODEX_LABELS[event]
        if event in ("PreToolUse", "PostToolUse", "PostToolUseFailure"):
            entry["matcher"] = "*"
        entries.append(entry)
    return result


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
        if path.exists():
            shutil.copymode(path, temporary)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(home, source, interpreter, provider="claude"):
    codex = provider == "codex"
    events = CODEX_EVENTS if codex else EVENTS
    target = home / (".local/bin/neon-herdr-codex-activity.py" if codex else ".local/bin/neon-herdr-activity.py")
    settings_path = home / (".codex/hooks.json" if codex else ".claude/settings.json")
    original = settings_path.read_text(encoding="utf-8-sig") if settings_path.exists() else "{}"
    settings = json.loads(original)
    if not isinstance(settings, dict):
        raise ValueError("settings must be an object")
    compile(source, str(target), "exec")
    if os.name == "nt":
        command = '"' + interpreter.replace("\\", "/") + '" "' + str(target).replace("\\", "/") + '"'
    else:
        command = shlex.quote(interpreter) + " " + shlex.quote(str(target))
    if codex:
        command += " --codex"
    previous_command = None
    if codex and os.name == "nt":
        # Codex uses PowerShell on Windows: a quoted executable needs &.
        # Migrate our exact old command in place without touching other hooks.
        previous_command = command
        command = "& '" + interpreter.replace("\\", "/").replace("'", "''") + "' '" + str(target).replace("\\", "/").replace("'", "''") + "' --codex"
    merged = merged_settings(settings, command, events, previous_command)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = settings_path.with_name(settings_path.name + ".before-neon-activity-" + stamp)
    if settings_path.exists():
        shutil.copy2(settings_path, backup)
    if target.exists() and target.read_text(encoding="utf-8") != source:
        shutil.copy2(target, target.with_name(target.name + ".before-" + stamp))
    atomic_write(target, source)
    atomic_write(settings_path, json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
    return {"hook": str(target), "settings": str(settings_path), "backup": str(backup) if backup.exists() else None, "events": list(events), "command": command,
            "review": "Open /hooks in Codex and review/trust these activity hooks before they can run." if codex else None}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--source", type=Path)
    parser.add_argument("--from-stdin", action="store_true")
    parser.add_argument("--provider", choices=("claude", "codex"), default="claude")
    args = parser.parse_args()
    source = sys.stdin.read() if args.from_stdin else (args.source or Path(__file__).with_name("activity-hook.py")).read_text(encoding="utf-8")
    print(json.dumps(install(args.home, source, sys.executable, args.provider)))
