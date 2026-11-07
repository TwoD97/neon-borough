// Scheduled merges on one or more machines. Which machines run herdr-pr is a setting
// (Settings > Scheduled merges), stored in shared state:
//   pr-hub.schedulers: { machines: ["<key>", ...], default: "<key>" }
// A key is a machine's name from `hc machine ls`, or "" for this computer.
// herdr-pr (in this folder) is copied to ~/.local/bin/herdr-pr on a machine when it is set up.
import { exec, machines, shared, setShared, home, appHome, readTextFile, window as appWindow } from "herdr";

export const SCHED_KEY = "pr-hub.schedulers";
export const LOCAL = "";
const LEGACY = null; // no machine is assumed: pick schedulers in Settings
const VERSION = 6; // herdr-pr's VERSION; older copies are offered an update

export const keyName = (key) => (key === LOCAL ? "This computer" : key);
const onOpt = (key) => (key === LOCAL ? undefined : key);
const localWindows = () => appWindow()?.platform === "windows";
const localScript = () => `${home().replace(/\\/g, "/")}/.local/bin/herdr-pr`;

// Machines that could run a scheduler: this computer, then every connected one.
export function candidates() {
  return [LOCAL, ...machines().map((m) => m.name).filter(Boolean)];
}

export function schedConfig() {
  const c = shared(SCHED_KEY);
  if (c && Array.isArray(c.machines)) {
    const list = c.machines.filter((k) => typeof k === "string");
    return { machines: list, default: list.includes(c.default) ? c.default : list[0] ?? null };
  }
  const legacy = machines().some((m) => m.name === LEGACY) ? LEGACY : null;
  return { machines: legacy ? [legacy] : [], default: legacy };
}

export function useScheduler(key, on) {
  const c = schedConfig();
  const list = on ? [...new Set([...c.machines, key])] : c.machines.filter((k) => k !== key);
  const def = list.includes(c.default) ? c.default : list[0] ?? null;
  setShared(SCHED_KEY, { machines: list, default: def });
}

export function setDefaultScheduler(key) {
  const c = schedConfig();
  if (c.machines.includes(key)) setShared(SCHED_KEY, { machines: c.machines, default: key });
}

// Runs herdr-pr on a machine. On this computer under Windows it goes through python.
export function sched(args, key) {
  if (key === LOCAL && localWindows()) return exec("python", [localScript(), ...args]);
  return exec("sh", ["-c", 'exec "$HOME/.local/bin/herdr-pr" "$@"', "herdr-pr", ...args], { on: onOpt(key) });
}

// What herdr-pr says about a machine: { state: "ok" | "old" | "missing" | "offline", server, timer, os, gh, pending }.
export async function schedStatus(key) {
  const m = machines().find((x) => x.name === key);
  if (key !== LOCAL && (!m || m.layout === "unavailable")) return { state: "offline" };
  const r = await sched(["status", "--json"], key).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
  if (r.code === 0) {
    try {
      const info = JSON.parse(r.stdout);
      return { ...info, state: (info.version ?? 0) < VERSION ? "old" : "ok" };
    } catch { /* not JSON: an old copy printing help */ }
  }
  if (/unknown command status/.test(String(r.stderr))) return { state: "old", server: true };
  return { state: "missing" };
}

// Copies this folder's herdr-pr to the machine and makes it a scheduler. Resolves with herdr-pr's message.
export async function installScheduler(key) {
  const text = await readTextFile(`${appHome()}/mods/pr-hub/herdr-pr`);
  if (!text) throw new Error("herdr-pr is missing from the pr-hub mod folder");
  // Sent in pieces: Windows caps a command line at ~32k characters, and every exec (also to
  // another machine) starts a process here.
  const b64 = base64(text), CHUNK = 8000, parts = [];
  for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
  const fail = (r) => { if (r.code !== 0) throw new Error(String(r.stderr).trim() || "couldn't copy herdr-pr there"); };
  if (key === LOCAL && localWindows()) {
    const append = "import os,sys; p=sys.argv[1]; os.makedirs(os.path.dirname(p), exist_ok=True); open(p+'.b64', 'w' if sys.argv[3]=='0' else 'a').write(sys.argv[2])";
    for (let i = 0; i < parts.length; i++) fail(await exec("python", ["-c", append, localScript(), parts[i], String(i)]));
    fail(await exec("python", ["-c", "import base64,os,sys; p=sys.argv[1]; open(p+'.new','wb').write(base64.b64decode(open(p+'.b64').read())); os.replace(p+'.new', p); os.remove(p+'.b64')", localScript()]));
  } else {
    const on = { on: onOpt(key) };
    for (let i = 0; i < parts.length; i++) {
      fail(await exec("sh", ["-c", 'set -e; d="$HOME/.local/bin"; mkdir -p "$d"; if [ "$2" = 0 ]; then printf %s "$1" > "$d/herdr-pr.b64"; else printf %s "$1" >> "$d/herdr-pr.b64"; fi', "install", parts[i], String(i)], on));
    }
    fail(await exec("sh", ["-c", 'set -e; d="$HOME/.local/bin"; base64 -d "$d/herdr-pr.b64" > "$d/herdr-pr.new"; rm -f "$d/herdr-pr.b64"; chmod +x "$d/herdr-pr.new"; mv "$d/herdr-pr.new" "$d/herdr-pr"', "install"], on));
  }
  const s = await sched(["setup"], key);
  if (s.code !== 0) throw new Error(String(s.stderr).trim().replace(/^herdr-pr: /, "") || "herdr-pr setup failed");
  return String(s.stdout).trim();
}

export async function removeScheduler(key) {
  const r = await sched(["remove"], key);
  if (r.code !== 0) throw new Error(String(r.stderr).trim().replace(/^herdr-pr: /, "") || "herdr-pr remove failed");
}

// Requests agents queued on a machine that isn't a scheduler.
const OUTBOX_READ = 'for f in "$HOME"/.herdr/pr-outbox/*.json; do [ -f "$f" ] && cat "$f" && echo; done; true';
export async function readOutbox(key) {
  const r = await sched(["outbox", "--json"], key).catch(() => null);
  if (r?.code === 0) {
    try { return JSON.parse(r.stdout); } catch { return []; }
  }
  if (key === LOCAL && localWindows()) return [];
  // An older herdr-pr has no `outbox`: read the files directly.
  const old = await exec("sh", ["-c", OUTBOX_READ], { on: onOpt(key) }).catch(() => null);
  if (!old || old.code !== 0) return [];
  return String(old.stdout).split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export async function dropOutbox(key, id) {
  const clean = String(id).replace(/[^\w-]/g, "");
  const r = await sched(["outbox-done", clean], key).catch(() => null);
  if (r?.code === 0 || (key === LOCAL && localWindows())) return;
  await exec("sh", ["-c", 'rm -f "$HOME/.herdr/pr-outbox/$1.json"', "rm", clean], { on: onOpt(key) }).catch(() => {});
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(text) {
  const bytes = [];
  for (const ch of text) {
    let c = ch.codePointAt(0);
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

// Merge asks: agents run `herdr-pr ask <pr>` on any machine; the panel shows Merge / Decline.
export async function readAsks(key) {
  const r = await sched(["asks", "--json"], key).catch(() => null);
  if (!r || r.code !== 0) return [];
  try { return JSON.parse(r.stdout).filter((a) => a && a.id && a.url).map((a) => ({ ...a, machine: key })); } catch { return []; }
}

export async function answerAsk(key, id, state, message = "") {
  const r = await sched(["answer", String(id), state, "--message", String(message).slice(0, 300)], key);
  if (r.code !== 0) throw new Error(String(r.stderr).trim().replace(/^herdr-pr: /, "") || "couldn't record the answer");
}
