"""Herdr usage: provider APIs and Claude's status-line feed; never read credentials."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time

APP_HOME = Path(os.environ.get('HERDR_APP_HOME', str(Path.home() / '.config/herdr-app')))
DATA = APP_HOME / 'data/usage'
NO_WINDOW = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def text(value, limit=180):
    return ''.join(c for c in str(value or '') if c.isprintable())[:limit]


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=True)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return None


def execute(argv, timeout=6):
    return subprocess.run(argv, capture_output=True, text=True, encoding='utf-8', timeout=timeout, creationflags=NO_WINDOW)


def find_bash():
    candidates = [os.environ.get('CLAUDE_CODE_GIT_BASH_PATH'), shutil.which('bash')]
    if os.name == 'nt':
        candidates.extend(str(Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Git' / part / 'bash.exe') for part in ('bin', 'usr/bin'))
    return next((path for path in candidates if path and Path(path).is_file()), None)


class CodexRPC:
    """A short-lived, read-only stdio client. No threads or model turns are started."""
    def __init__(self, executable):
        self.process = subprocess.Popen([executable, 'app-server', '--stdio'], stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                       encoding='utf-8', creationflags=NO_WINDOW)
        self.incoming = queue.Queue()
        self.next_id = 0
        self.deadline = time.monotonic() + 18
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.process.stdout:
            try:
                self.incoming.put(json.loads(line))
            except ValueError:
                pass
        self.incoming.put(None)

    def send(self, value):
        self.process.stdin.write(json.dumps(value) + '\n')
        self.process.stdin.flush()

    def request(self, method, params=None):
        self.next_id += 1
        request_id = self.next_id
        self.send({'id': request_id, 'method': method, 'params': params})
        while True:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Codex did not respond in time.')
            message = self.incoming.get(timeout=remaining)
            if message is None:
                raise RuntimeError('Codex app-server disconnected.')
            if message.get('id') != request_id:
                continue
            if 'error' in message:
                raise RuntimeError('Codex could not provide ' + method + '.')
            return message.get('result') or {}

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
        try:
            self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2)
        self.process.stdin.close()
        self.process.stdout.close()


def window_label(minutes):
    if minutes == 10080:
        return 'Weekly limit'
    if minutes == 300:
        return '5-hour limit'
    if not number(minutes):
        return 'Usage limit'
    if minutes % 1440 == 0:
        return f'{minutes // 1440:g}-day limit'
    if minutes % 60 == 0:
        return f'{minutes // 60:g}-hour limit'
    return f'{minutes:g}-minute limit'


def codex_windows(result):
    buckets = result.get('rateLimitsByLimitId') or {}
    if not buckets and isinstance(result.get('rateLimits'), dict):
        buckets = {'codex': result['rateLimits']}
    windows = []
    for bucket_id, bucket in buckets.items():
        for key in ('primary', 'secondary'):
            value = bucket.get(key)
            if not isinstance(value, dict) or number(value.get('usedPercent')) is None:
                continue
            name = text(bucket.get('limitName')) or (text(bucket_id) if bucket_id != 'codex' else '')
            label = window_label(value.get('windowDurationMins'))
            windows.append({'label': (name + ' · ' if name else '') + label,
                            'used_percent': min(100, value['usedPercent']), 'resets_at': number(value.get('resetsAt'))})
    return windows


def provider_base(provider, name):
    available = bool(shutil.which(provider))
    return {'id': provider, 'name': name, 'available': available, 'account': {'label': 'Not signed in', 'plan': '', 'authenticated': False},
            'windows': [], 'usage': {}, 'can_switch': available, 'can_native_usage': False, 'note': '', 'error': None}


def codex_snapshot():
    result = provider_base('codex', 'Codex')
    if not result['available']:
        result['note'] = 'Install Codex to connect this account.'
        return result
    rpc = None
    try:
        rpc = CodexRPC(shutil.which('codex'))
        rpc.request('initialize', {'clientInfo': {'name': 'herdr_usage', 'title': 'Herdr Usage', 'version': '0.1.0'},
                                   'capabilities': {'experimentalApi': True}})
        rpc.send({'method': 'initialized'})
        account = rpc.request('account/read', {'refreshToken': False}).get('account')
        if not account:
            result['note'] = 'Sign in to see your subscription limits.'
            return result
        result['account'] = {'label': text(account.get('email') or account.get('type')), 'plan': text(account.get('planType')),
                             'authenticated': True}
        if account.get('type') != 'chatgpt':
            result['note'] = 'Subscription quotas are unavailable for this authentication method.'
            return result
        try:
            limits = rpc.request('account/rateLimits/read')
            result['windows'] = codex_windows(limits)
            if not result['windows']:
                result['note'] = 'Codex did not report a quota window.'
        except (RuntimeError, queue.Empty, TimeoutError):
            result['error'] = 'Codex quota could not be refreshed. Try again shortly.'
        try:
            usage = rpc.request('account/usage/read')
            buckets = usage.get('dailyUsageBuckets')
            today = next((v for v in buckets or [] if v.get('startDate') == date.today().isoformat()), None)
            result['usage'] = {'today_tokens': number(today.get('tokens')) if today else None}
        except (RuntimeError, queue.Empty, TimeoutError):
            pass  # Limits remain useful if optional token-activity data isn't available.
        result['updated_ms'] = int(time.time() * 1000)
    except Exception:
        result['error'] = 'Unable to connect to Codex. Check that its CLI opens, then refresh.'
    finally:
        if rpc:
            rpc.close()
    return result


def capture_claude(payload):
    """Allowlist telemetry: never retain prompts, transcript paths, or provider credentials."""
    sid = payload.get('session_id')
    if not isinstance(sid, str) or not sid:
        return
    filename = hashlib.sha256(sid.encode()).hexdigest()[:24] + '.json'
    previous = read_json(DATA / 'claude' / filename) or {}
    identity = previous.get('account_key')
    if not identity:
        try:
            identity = account_key(json.loads(execute([shutil.which('claude'), 'auth', 'status', '--json']).stdout))
        except Exception:
            identity = None
    windows = []
    limits = payload.get('rate_limits') or {}
    for key, label in [('five_hour', '5-hour limit'), ('seven_day', 'Weekly limit'), ('spend_limit', 'Spend limit')]:
        item = limits.get(key) or {}
        used = number(item.get('used_percentage'))
        if used is not None:
            windows.append({'label': label, 'used_percent': min(100, used), 'resets_at': number(item.get('resets_at'))})
    context = payload.get('context_window') or {}
    input_tokens = number(context.get('total_input_tokens'))
    output_tokens = number(context.get('total_output_tokens'))
    record = {'updated_ms': int(time.time() * 1000), 'windows': windows, 'account_key': identity,
              'context_tokens': input_tokens + output_tokens if input_tokens is not None and output_tokens is not None else None}
    atomic_json(DATA / 'claude' / filename, record)


def account_key(data):
    if not data.get('loggedIn'):
        return None
    identity = [data.get(key) for key in ('email', 'orgId', 'authMethod', 'configDirectory')]
    return hashlib.sha256(json.dumps(identity).encode()).hexdigest()


def start_claude_session():
    """A resumed process may have switched accounts; discard that session's old identity."""
    try:
        event = json.loads(sys.stdin.read(2 * 1024 * 1024))
        sid = event.get('session_id')
        if isinstance(sid, str) and sid:
            path = DATA / 'claude' / (hashlib.sha256(sid.encode()).hexdigest()[:24] + '.json')
            atomic_json(path, {'updated_ms': 0, 'windows': []})
    except (OSError, ValueError, TypeError):
        pass


def claude_snapshot():
    result = provider_base('claude', 'Claude Code')
    if not result['available']:
        result['note'] = 'Install Claude Code to connect this account.'
        return result
    try:
        auth = execute([shutil.which('claude'), 'auth', 'status', '--json'])
        data = json.loads(auth.stdout)
        result['account'] = {'label': text(data.get('email') or data.get('authMethod') or 'Not signed in'),
                             'plan': text(data.get('planTier') or data.get('subscriptionType')), 'authenticated': data.get('loggedIn') is True}
        if not result['account']['authenticated']:
            result['note'] = 'Sign in to see your subscription limits.'
            return result
        records = []
        cutoff = read_json(DATA / 'claude-switch.json') or {}
        for path in (DATA / 'claude').glob('*.json'):
            record = read_json(path)
            if isinstance(record, dict) and number(record.get('updated_ms')) is not None and record['updated_ms'] >= cutoff.get('after_ms', 0) and record.get('account_key') == account_key(data):
                records.append(record)
        latest = max(records, key=lambda r: r['updated_ms'], default=None)
        if latest:
            result['windows'] = [w for w in latest.get('windows') or [] if not w.get('resets_at') or w['resets_at'] > time.time()]
            result['usage'] = {'context_tokens': number(latest.get('context_tokens'))}
            result['updated_ms'] = latest['updated_ms']
            result['stale'] = time.time() * 1000 - latest['updated_ms'] > 300000
            result['note'] = ('Last reported usage; run Claude to refresh.' if result['stale'] else 'From the latest Claude Code status update.') if result['windows'] else 'Waiting for Claude to report the current quota window.'
        else:
            result['note'] = 'Waiting for a Claude Code response to refresh usage.'
    except Exception:
        result['error'] = 'Unable to read Claude Code account status. Check its CLI, then refresh.'
    return result


def snapshot():
    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(codex_snapshot), pool.submit(claude_snapshot)
        providers = [a.result(), b.result()]
        return {'updated_ms': int(time.time() * 1000), 'providers': providers}


def switch_account(provider):
    executable = shutil.which(provider)
    if not executable:
        print('Install ' + provider + ' first.')
        return 1
    print('Choose your account in the provider sign-in page. Herdr does not store your credentials.')
    print('Existing sessions may need to be resumed after switching accounts.\n')
    # Never pre-logout: cancelling the browser flow must not discard the existing login.
    args = [executable, 'login'] if provider == 'codex' else [executable, 'auth', 'login']
    result = subprocess.run(args)
    if provider == 'claude' and result.returncode == 0:
        atomic_json(DATA / 'claude-switch.json', {'after_ms': int(time.time() * 1000)})
    print('\nSign-in finished. Reopen Usage & accounts in Herdr to refresh.' if result.returncode == 0 else '\nSign-in was not completed. Your provider may show more detail above.')
    try:
        input('Press Enter to close this tab. ')
    except EOFError:
        pass
    return result.returncode


def statusline():
    raw = sys.stdin.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        return
    try:
        payload = json.loads(raw)
        capture_claude(payload)
    except (ValueError, TypeError, OSError):
        payload = {}
    previous = read_json(DATA / 'claude-statusline-previous.json')
    command = previous.get('command') if isinstance(previous, dict) else None
    if command:
        # Claude command status lines run in Bash, including on Windows.
        bash = find_bash()
        if bash:
            try:
                result = subprocess.run([bash, '-c', command], input=raw, text=True, encoding='utf-8', capture_output=True, timeout=4, creationflags=NO_WINDOW)
                print(result.stdout, end='')
                return
            except (OSError, subprocess.TimeoutExpired):
                pass
    model = text((payload.get('model') or {}).get('display_name'), 40) or 'Claude Code'
    limits = payload.get('rate_limits') or {}
    parts = [model]
    for key, label in [('five_hour', '5h'), ('seven_day', 'week')]:
        used = number((limits.get(key) or {}).get('used_percentage'))
        if used is not None:
            parts.append(f'{label} {used:g}% used')
    print(' | '.join(parts))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['snapshot', 'capture-claude', 'start-claude-session', 'switch'])
    parser.add_argument('provider', nargs='?', choices=['codex', 'claude'])
    args = parser.parse_args()
    if args.action == 'snapshot':
        print(json.dumps(snapshot(), ensure_ascii=True))
    elif args.action == 'capture-claude':
        statusline()
    elif args.action == 'start-claude-session':
        start_claude_session()
    elif args.provider:
        return switch_account(args.provider)
    else:
        parser.error('switch requires a provider')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
