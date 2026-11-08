"""Install the Claude status-line usage feed without replacing other settings."""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import sys


def install(home, app_home, interpreter):
    script = app_home / 'mods/neon-usage/usage-monitor.py'
    if not script.is_file():
        raise RuntimeError('Deploy neon-usage before installing its status line.')
    spec = importlib.util.spec_from_file_location('usage_monitor', script)
    monitor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(monitor)
    settings = home / '.claude/settings.json'
    data = json.loads(settings.read_text(encoding='utf-8-sig')) if settings.exists() else {}
    previous = data.get('statusLine')
    # Claude executes status commands in Bash. shlex quoting also protects apostrophes.
    command = shlex.quote(str(interpreter).replace('\\', '/')) + ' ' + shlex.quote(str(script).replace('\\', '/')) + ' capture-claude'
    session_command = command.removesuffix('capture-claude') + 'start-claude-session'
    session_entries = data.get('hooks', {}).get('SessionStart', [])
    has_session_hook = any(h.get('command') == session_command for group in session_entries for h in group.get('hooks', []))
    same_command = isinstance(previous, dict) and previous.get('command') == command
    if same_command and has_session_hook:
        return {'installed': True, 'changed': False}
    if previous and (not isinstance(previous, dict) or previous.get('type') != 'command'):
        raise RuntimeError('Existing status line is not a command; it has been preserved.')
    if previous and not monitor.find_bash():
        raise RuntimeError('Bash is required to preserve the existing status line; settings unchanged.')
    backup = settings.with_name('settings.json.before-herdr-usage-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    if settings.exists():
        shutil.copy2(settings, backup)
    if not same_command:
        monitor.atomic_json(app_home / 'data/usage/claude-statusline-previous.json', previous)
    data['statusLine'] = {**(previous or {}), 'type': 'command', 'command': command}
    if not has_session_hook:
        data.setdefault('hooks', {}).setdefault('SessionStart', []).append({'hooks': [{'type': 'command', 'command': session_command, 'timeout': 3}]})
    monitor.atomic_json(settings, data)
    return {'installed': True, 'changed': True, 'backup': str(backup)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', type=Path, default=Path.home())
    parser.add_argument('--app-home', type=Path, default=Path(os.environ.get('HERDR_APP_HOME', str(Path.home() / '.config/herdr-app'))))
    args = parser.parse_args()
    print(json.dumps(install(args.home, args.app_home, sys.executable)))
