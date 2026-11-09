// Keeps herdr's agent tools current on every machine herdr reaches: this computer and each
// connected machine get the activity hook (live activity and the waiting status), herdr-crew and
// their hooks for Claude Code and Codex. The files ship in agent-tools/; a machine is updated
// when the version it recorded (~/.herdr/agent-tools.json) differs from these files' hash.
// Results land in shared "crew.agentTools" ({ [machine]: { version, ok, error, codexReview } }).
// `touch ~/.herdr/agent-tools-off` on a machine leaves it alone.
import { exec, machines, home, appHome, readTextFile, shared, setShared, window as appWindow } from "herdr";

const FILES = ["activity-hook.py", "install-activity-hook.py", "install-agent-tools.py", "herdr-crew"];
const CHECK_MS = 5 * 60 * 1000;
const LOCAL = "";
const localWindows = () => appWindow()?.platform === "windows";
const onOpt = (key) => (key === LOCAL ? undefined : key);

// FNV-1a over the files: the version a machine must have.
function hashOf(texts) {
  let h = 0x811c9dc5;
  for (const text of texts) for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

// UTF-8 safe base64 (mods have no btoa or TextEncoder).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64(text) {
  const bytes = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return out;
}

// Runs a small Python program on a machine (python on Windows here, python3 elsewhere).
function py(key, code, args = []) {
  if (key === LOCAL && localWindows()) return exec("python", ["-c", code, ...args]);
  return exec("sh", ["-c", 'exec python3 -c "$0" "$@"', code, ...args], { on: onOpt(key) });
}

const READ_STATE = "import json,os; p=os.path.expanduser('~/.herdr/agent-tools.json'); off=os.path.exists(os.path.expanduser('~/.herdr/agent-tools-off')); print(json.dumps({'off':off,'state':json.load(open(p)) if os.path.exists(p) else None}))";
// Appends one base64 piece of the bundle; piece 0 starts it. Windows caps a command line near 32k.
const APPEND = "import os,sys; p=os.path.expanduser('~/.herdr/agent-tools/bundle.b64'); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'w' if sys.argv[2]=='0' else 'a').write(sys.argv[1])";
const UNPACK_AND_INSTALL = "import base64,json,os,subprocess,sys; d=os.path.expanduser('~/.herdr/agent-tools'); p=os.path.join(d,'bundle.b64'); files=json.loads(base64.b64decode(open(p).read()).decode('utf-8')); os.remove(p)\n"
  + "for name,text in files.items():\n  open(os.path.join(d,name),'w',encoding='utf-8',newline='\\n').write(text)\n"
  + "r=subprocess.run([sys.executable, os.path.join(d,'install-agent-tools.py'), '--version', sys.argv[1]], capture_output=True, text=True)\n"
  + "print(r.stdout.strip() or json.dumps({'errors':[r.stderr.strip()[-400:] or 'install failed']}))";

async function syncMachine(key, bundle, version) {
  const seen = await py(key, READ_STATE).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
  if (seen.code !== 0) return { ok: false, error: String(seen.stderr).trim().slice(-200) || "python3 not found" };
  const { off, state } = JSON.parse(seen.stdout || "{}");
  if (off) return { ok: true, off: true };
  if (state?.version === version) return { ok: true, version, codexReview: !!state?.codex?.review };
  const text = b64(bundle), CHUNK = 7000;
  for (let i = 0, n = 0; i < text.length; i += CHUNK, n++) {
    const r = await py(key, APPEND, [text.slice(i, i + CHUNK), String(n)]);
    if (r.code !== 0) return { ok: false, error: String(r.stderr).trim().slice(-200) };
  }
  const r = await py(key, UNPACK_AND_INSTALL, [version]);
  let out = null;
  try { out = JSON.parse(String(r.stdout).trim().split("\n").pop()); } catch { /* not JSON */ }
  if (r.code !== 0 || !out || out.errors?.length) return { ok: false, error: (out?.errors ?? [String(r.stderr).trim()]).join("; ").slice(-300) };
  return { ok: true, version, installed: Date.now(), codexReview: !!out.codex?.review };
}

let running = false;
async function syncAll() {
  if (running) return;
  running = true;
  try {
    const texts = [];
    for (const f of FILES) {
      const t = await readTextFile(`${appHome()}/mods/crew/agent-tools/${f}`);
      if (t == null) return;
      texts.push(t.replace(/\r\n/g, "\n"));
    }
    const version = hashOf(texts);
    const bundle = JSON.stringify(Object.fromEntries(FILES.map((f, i) => [f, texts[i]])));
    const keys = [LOCAL, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
    const results = { ...(shared("crew.agentTools") ?? {}) };
    for (const key of keys) {
      if (results[key]?.version === version && results[key]?.ok) continue;
      results[key] = { ...(await syncMachine(key, bundle, version).catch((e) => ({ ok: false, error: String(e?.message ?? e) }))), checked: Date.now() };
    }
    setShared("crew.agentTools", results);
  } finally {
    running = false;
  }
}

let started = false;
export function startAgentTools(cx) {
  if (started) return;
  started = true;
  cx.spawn(async () => { await syncAll(); });
  cx.timer.every(CHECK_MS, (cx) => cx.spawn(async () => { await syncAll(); }));
}
