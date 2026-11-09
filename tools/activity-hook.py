#!/usr/bin/env python3
"""Publish structured Claude/Codex activity as Herdr labels, never agent state.

Published: event, session/turn identifiers, tool names, and a waiting category
("ci", "tests", "pr", ...). Commands and the turn's final message are read locally
only to pick that category; arguments, outputs, prompts, model responses and
transcript text are never published.
"""
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import time

PREFIX = "herdr.activity."
WAIT = "herdr.wait"
MAX_INPUT = 2 * 1024 * 1024

# Waiting, as a category only. Commands and messages are read here, on this machine, and
# never published: the label says "ci" or "tests", not what was run or said.
WAIT_COMMANDS = (
    (re.compile(r"\bherdr-pr\b.*\b(ask|secret)\b.*--wait", re.S), "you"),
    (re.compile(r"\bgh\s+pr\s+checks\b.*--watch|\bgh\s+run\s+watch\b|\bgh\s+pr\s+merge\b.*--auto", re.S), "ci"),
    (re.compile(r"\b(until|while)\b.*\bgh\s+(pr|run)\b", re.S), "ci"),
    (re.compile(r"\bkubectl\s+rollout\s+status\b|\b(deploy|release)\b.*--wait", re.S), "deploy"),
    (re.compile(r"\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|vitest|jest|playwright\s+test|phpunit|rspec)\b"
                r"|\b(cargo|go|dotnet|mix|swift)\s+test\b|\bgradlew?\b.*\btest\b|\bmvn\b.*\b(test|verify)\b"), "tests"),
    # Only a long pause counts (30 s or more); scripts sleep a second or two all the time.
    (re.compile(r"(^|[;&|]\s*)(sleep\s+(\d{3,}|[3-9]\d|\d+(\.\d+)?[mh])\b|Start-Sleep\s+(-Seconds\s+)?([3-9]\d|\d{3,})\b"
                r"|Start-Sleep\s+-Minutes\b|timeout\s+/t\s+([3-9]\d|\d{3,}))", re.M), "timer"),
)
WAIT_TOOLS = {"Monitor": "watch", "wait_agent": "agent", "TaskOutput": "agent"}
# The end of a turn that says it waits: "waiting for CI", "I'll check back once the PR is merged".
WAITS = re.compile(r"\b(wait(?:ing)?\s+(?:for|on|until)|check\s+back|poll(?:ing)?|monitor(?:ing)?|watch(?:ing)?\s+(?:the|for)"
                   r"|once\s+.{0,60}\b(?:pass(?:es)?|finish(?:es)?|complete[sd]?|merged|green|done|lands?)"
                   r"|until\s+.{0,60}\b(?:pass(?:es)?|finish(?:es)?|complete[sd]?|merged|green|done)"
                   r"|(?:will|i'll|i'?m going to)\s+(?:wait|report back|resume|continue)\s+(?:when|once|after))", re.I)
WAIT_TOPICS = (
    (re.compile(r"\byour\s+(approval|answer|decision|review|input|go-ahead|reply|click)\b|\byou\s+to\b", re.I), "you"),
    (re.compile(r"\b(ci|checks?|pipeline|workflow|actions|build)\b", re.I), "ci"),
    (re.compile(r"\b(tests?|test\s+run|suite)\b", re.I), "tests"),
    (re.compile(r"\b(deploy(ment)?|rollout|release)\b", re.I), "deploy"),
    (re.compile(r"\b(review(er)?s?|approval|merge[ds]?|pr|pull\s+request)\b", re.I), "pr"),
    (re.compile(r"\b(agent|codex|claude|subagent)\b", re.I), "agent"),
)


def command_text(tool_input):
    if not isinstance(tool_input, dict):
        return ""
    cmd = tool_input.get("command", tool_input.get("cmd", ""))
    if isinstance(cmd, list):
        cmd = " ".join(str(part) for part in cmd)
    return cmd if isinstance(cmd, str) else ""


def wait_for_tool(tool, tool_input):
    """The waiting category of a tool call, or None."""
    if tool in WAIT_TOOLS:
        return WAIT_TOOLS[tool]
    cmd = command_text(tool_input)[:20000]
    for pattern, category in WAIT_COMMANDS:
        if pattern.search(cmd):
            return category
    return None


def wait_for_message(text):
    """The waiting category a final message announces, or None. Only its last lines count."""
    if not isinstance(text, str) or not text:
        return None
    tail = text[-700:]
    found = WAITS.search(tail)
    if not found:
        return None
    around = tail[max(0, found.start() - 120):found.end() + 160]
    return next((category for pattern, category in WAIT_TOPICS if pattern.search(around)), "other")


def last_message(event):
    """The turn's final assistant text: from the event when it carries it, else the transcript's tail."""
    for key in ("last_assistant_message", "last-assistant-message", "last_agent_message"):
        if isinstance(event.get(key), str):
            return event[key]
    path = event.get("transcript_path")
    if not isinstance(path, str) or not path:
        return None
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 262144))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return None
    for line in reversed(lines):
        try:
            item = json.loads(line)
        except ValueError:
            continue
        message = item.get("message") if isinstance(item, dict) else None
        if item.get("type") != "assistant" or not isinstance(message, dict):
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        texts = [part.get("text", "") for part in content or [] if isinstance(part, dict) and part.get("type") == "text"]
        if texts:
            return "\n".join(texts)
    return None


def read_wait(call, executable, address):
    raw = call(executable, ["get", address, "--json"])
    try:
        value = json.loads(raw).get("labels", {}).get(WAIT) if raw else None
        return json.loads(value) if value else None
    except (TypeError, ValueError, AttributeError):
        return None


def set_wait(call, executable, address, record):
    call(executable, ["label", address, WAIT + "=" + (json.dumps(record, separators=(",", ":")) if record else "")])


def find_hc():
    candidates = [shutil.which("hc"), str(Path.home() / ".local/bin/hc")]
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidates.append(str(Path(local) / "Programs/herdr-core/hc.exe"))
    return next((path for path in candidates if path and Path(path).is_file()), None)


def invoke(executable, args):
    options = {"capture_output": True, "text": True, "encoding": "utf-8", "errors": "replace", "timeout": 1}
    if os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NO_WINDOW
    result = subprocess.run([executable, *args], **options)
    return result.stdout if result.returncode == 0 else None


def activity_key(session, tool_id):
    digest = hashlib.sha256((session + ":" + tool_id).encode("utf-8")).hexdigest()[:24]
    return PREFIX + digest


def handle(event, address, executable, call=invoke, now=time.time):
    if not isinstance(event, dict) or not address or not executable:
        return
    name = event.get("hook_event_name")
    session = event.get("session_id")
    if not isinstance(session, str) or not session or len(session) > 256:
        return
    turn = event.get("turn_id")
    turn = turn if isinstance(turn, str) and 0 < len(turn) <= 256 else None
    if name == "UserPromptSubmit":
        # A new turn: whatever it waited for has arrived (or the user moved on).
        if read_wait(call, executable, address):
            set_wait(call, executable, address, None)
        return
    if name in ("Stop", "SessionEnd", "Interrupt"):
        raw = call(executable, ["get", address, "--json"])
        if not raw:
            return
        labels = json.loads(raw).get("labels", {})
        if not isinstance(labels, dict):
            return
        try:
            current = json.loads(labels.get(WAIT) or "null")
        except ValueError:
            current = None
        if name == "SessionEnd":
            wait = None
        elif name == "Stop" and not (isinstance(current, dict) and current.get("source") in ("cli", "timer")):
            # Idle after a message that says it waits: waiting until it works again.
            category = wait_for_message(last_message(event))
            wait = {"for": category, "source": "message", "since_ms": int(now() * 1000), "session": session} if category else None
        else:
            wait = current
        if wait != current:
            set_wait(call, executable, address, wait)
        remove = []
        for key, value in labels.items():
            if not key.startswith(PREFIX):
                continue
            try:
                record = json.loads(value)
            except (TypeError, ValueError):
                continue
            # Codex subagents share the root session id. A turn ending must
            # not remove another concurrently running turn's tool labels.
            if not isinstance(record, dict):
                continue
            same_turn = name == "SessionEnd" or not turn or record.get("turn") == turn
            if record.get("session") == session and same_turn:
                remove.append(key + "=")
        if remove:
            call(executable, ["label", address, *remove])
        return
    if name in ("PreModelRequest", "PostModelRequest"):
        if not turn:
            return
        agent = event.get("agent_id")
        agent = agent if isinstance(agent, str) and len(agent) <= 256 else "root"
        key = activity_key(session, "model:" + agent + ":" + turn)
        value = json.dumps({"tool": "ModelRequest", "started_ms": int(now() * 1000), "session": session, "turn": turn}, separators=(",", ":")) if name == "PreModelRequest" else ""
        call(executable, ["label", address, key + "=" + value])
        return
    if name not in ("PreToolUse", "PostToolUse", "PostToolUseFailure"):
        return
    tool_id = event.get("tool_use_id")
    if not isinstance(tool_id, str) or not tool_id or len(tool_id) > 512:
        return
    key = activity_key(session, tool_id)
    if name == "PreToolUse":
        tool = event.get("tool_name")
        if not isinstance(tool, str) or not tool:
            return
        tool = "".join(c for c in tool if c.isprintable())[:96]
        if not tool:
            return
        record = {"tool": tool, "started_ms": int(now() * 1000), "session": session}
        if turn:
            record["turn"] = turn
        tool_input = event.get("tool_input")
        waiting = wait_for_tool(tool, tool_input)
        if waiting:
            record["wait"] = waiting
        if tool == "ScheduleWakeup" and isinstance(tool_input, dict):
            # The turn ends right after; the agent is waiting for its own timer.
            try:
                delay = max(60, min(3600, float(tool_input.get("delaySeconds", 0))))
                set_wait(call, executable, address, {"for": "timer", "source": "timer", "since_ms": int(now() * 1000),
                                                      "until_ms": int((now() + delay) * 1000), "session": session})
            except (TypeError, ValueError):
                pass
        value = json.dumps(record, separators=(",", ":"))
    else:
        value = ""
    call(executable, ["label", address, key + "=" + value])


def main():
    # Never return permission decisions or model-visible context. Codex Stop
    # expects a JSON object; its neutral object changes no execution behavior.
    event = None
    try:
        address = os.environ.get("HC_TERMINAL_ID")
        if not address:
            return
        raw = sys.stdin.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            return
        event = json.loads(raw)
        handle(event, address, find_hc())
    except Exception:
        pass
    finally:
        if "--codex" in sys.argv:
            print("{}")


if __name__ == "__main__":
    main()
