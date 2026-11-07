// Zip, search, safe saving and secret requests for the Files panel.
// A place is { machine, path }: machine null = this computer, else a name from `hc machine ls`.
import { exec, home, readTextFile, writeTextFile, window as appWindow } from "herdr";
import { copy, inboxOf, baseName } from "./transfer.js";

const windows = () => appWindow()?.platform === "windows";
const isLocal = (machine) => !machine;
const psQuote = (s) => "'" + String(s).replace(/['‘’‚‛]/g, "$&$&") + "'";

// --- Zip ------------------------------------------------------------------------------------

// Zips a file or folder into Downloads on this computer. Remote ones are zipped there (python3),
// copied over and the temporary zip removed.
export async function zipToDownloads(place) {
  const name = `${baseName(place.path)}.zip`, downloads = inboxOf(null);
  if (isLocal(place.machine)) {
    const out = windows() ? `${downloads}\\${name}` : `${downloads}/${name}`;
    const r = windows()
      ? await exec("powershell", ["-NoProfile", "-Command", `& { param($s, $d) New-Item -ItemType Directory -Force -Path (Split-Path $d) | Out-Null; Compress-Archive -LiteralPath $s -DestinationPath $d -Force -ErrorAction Stop }`, place.path, out])
      : await exec("sh", ["-c", 'cd "$(dirname "$1")" && mkdir -p "$(dirname "$2")" && zip -qr "$2" "$(basename "$1")"', "zip", place.path, out]);
    if (r.code !== 0) throw new Error(String(r.stderr).trim() || "zip failed");
    return out;
  }
  const py = "import os,sys,zipfile\nsrc,out=sys.argv[1].rstrip('/'),sys.argv[2]\nbase=os.path.dirname(src)\nwith zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:\n  if os.path.isdir(src):\n    for d,_,fs in os.walk(src):\n      for f in fs:\n        p=os.path.join(d,f); z.write(p,os.path.relpath(p,base))\n  else:\n    z.write(src,os.path.basename(src))\n";
  const tmp = `/tmp/herdr-zip-${Date.now().toString(36)}`;
  const made = await exec("sh", ["-c", 'mkdir -p "$1" && python3 -c "$3" "$2" "$1/$4"', "zip", tmp, place.path, py, name], { on: place.machine });
  if (made.code !== 0) throw new Error(String(made.stderr).trim().split("\n").pop() || "zip failed there (python3 needed)");
  try { await copy({ machine: place.machine, path: `${tmp}/${name}` }, { machine: null, path: downloads }); }
  finally { await exec("rm", ["-rf", tmp], { on: place.machine }).catch(() => {}); }
  return windows() ? `${downloads}\\${name}` : `${downloads}/${name}`;
}

// --- Search ---------------------------------------------------------------------------------

const LIMIT = 200;
const SKIP = ["node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target"];

// Files under root whose name contains `query` (mode "name") or whose text does ("text").
// Resolves with paths relative to root, at most 200.
export async function search(root, machine, query, mode) {
  const q = String(query).trim();
  if (!q) return [];
  const rel = (p) => { const s = String(p).replace(/\\/g, "/"), r = String(root).replace(/\\/g, "/").replace(/\/$/, ""); return s.startsWith(r + "/") ? s.slice(r.length + 1) : s; };
  const lines = (r) => String(r.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, LIMIT).map(rel);
  if (isLocal(machine) && windows()) {
    // ripgrep when it's installed: fast and skips ignored folders. Otherwise PowerShell, 6 levels deep.
    const rgArgs = mode === "text"
      ? ["-l", "-i", "-F", "--max-count", "1", "--max-filesize", "2M", ...SKIP.flatMap((d) => ["-g", `!${d}`]), q, root]
      : ["--files", "--hidden", ...SKIP.flatMap((d) => ["-g", `!${d}`]), "--iglob", `*${q}*`, root];
    const rg = await exec("rg", rgArgs).catch(() => null);
    if (rg && (rg.code === 0 || rg.code === 1)) return lines(rg);
    const skip = SKIP.map((d) => `'${d}'`).join(",");
    const script = mode === "text"
      ? `& { param($r, $q) Get-ChildItem -LiteralPath $r -Recurse -File -Depth 6 -ErrorAction SilentlyContinue | Where-Object { $_.Length -lt 2MB -and -not ($_.FullName -split '[\\\\/]' | Where-Object { @(${skip}) -contains $_ }) } | Select-String -Pattern $q -SimpleMatch -List -ErrorAction SilentlyContinue | Select-Object -First ${LIMIT} | ForEach-Object { $_.Path } }`
      : `& { param($r, $q) Get-ChildItem -LiteralPath $r -Recurse -Depth 6 -Filter ('*' + $q + '*') -ErrorAction SilentlyContinue | Where-Object { -not ($_.FullName -split '[\\\\/]' | Where-Object { @(${skip}) -contains $_ }) } | Select-Object -First ${LIMIT} | ForEach-Object { $_.FullName } }`;
    const r = await exec("powershell", ["-NoProfile", "-Command", `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${script}`, root, q]);
    return lines(r);
  }
  const prune = SKIP.map((d) => `-name '${d}'`).join(" -o ");
  const cmd = mode === "text"
    ? `grep -rIl -i -F ${SKIP.map((d) => `--exclude-dir='${d}'`).join(" ")} -- "$2" "$1" 2>/dev/null | head -${LIMIT}`
    : `find "$1" -maxdepth 8 \\( ${prune} \\) -prune -o -iname "*$2*" -print 2>/dev/null | head -${LIMIT}`;
  const r = await exec("sh", ["-c", cmd, "search", root, q], { on: machine ?? undefined });
  return lines(r).filter((p) => p && p !== "." && p !== String(root));
}

// --- Saving ---------------------------------------------------------------------------------

export const EDIT_LIMIT = 200_000; // characters: configs, envs and other small text files

// Writes text only if the file still holds `original` (refuses to overwrite someone else's change).
export async function saveText(place, text, original) {
  if (text.length > EDIT_LIMIT) throw new Error("too large to edit here");
  if (isLocal(place.machine)) {
    try { await writeTextFile(place.path, text, original); return; }
    catch (e) {
      if (/stale|changed|expected/i.test(String(e?.message ?? e))) throw new Error("the file changed on disk since you opened it: reopen it first");
      // writeTextFile may be limited to some folders: fall back to python, with the same check.
    }
    const now = await readTextFile(place.path);
    if (now !== original) throw new Error("the file changed on disk since you opened it: reopen it first");
    const parts = chunks(b64(text));
    for (let i = 0; i < parts.length; i++) {
      const w = await exec("python", ["-c", "import sys; open(sys.argv[1]+'.herdr-save.b64', 'w' if sys.argv[3]=='0' else 'a').write(sys.argv[2])", place.path, parts[i], String(i)]);
      if (w.code !== 0) throw new Error(String(w.stderr).trim().split("\n").pop() || "save failed");
    }
    const r = await exec("python", ["-c", "import base64,os,sys; t=sys.argv[1]+'.herdr-save.b64'; open(sys.argv[1],'w',encoding='utf-8',newline='').write(base64.b64decode(open(t).read()).decode('utf-8')); os.remove(t)", place.path]);
    if (r.code !== 0) throw new Error(String(r.stderr).trim().split("\n").pop() || "save failed");
    return;
  }
  const now = await readTextFile(place.path, { on: place.machine });
  if (now !== original) throw new Error("the file changed on disk since you opened it: reopen it first");
  // In pieces (every exec starts a process here, and Windows caps command lines at ~32k
  // characters), then written in place (cat >) so the file keeps its owner and mode.
  const parts = chunks(b64(text));
  for (let i = 0; i < parts.length; i++) {
    const w = await exec("sh", ["-c", 'if [ "$3" = 0 ]; then printf %s "$2" > "$1.herdr-save.b64"; else printf %s "$2" >> "$1.herdr-save.b64"; fi', "save", place.path, parts[i], String(i)], { on: place.machine });
    if (w.code !== 0) throw new Error(String(w.stderr).trim() || "save failed");
  }
  const r = await exec("sh", ["-c", 'set -e; base64 -d "$1.herdr-save.b64" > "$1.herdr-save"; cat "$1.herdr-save" > "$1"; rm -f "$1.herdr-save" "$1.herdr-save.b64"', "save", place.path], { on: place.machine });
  if (r.code !== 0) throw new Error(String(r.stderr).trim() || "save failed");
}

const chunks = (text, size = 8000) => { const out = []; for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size)); return out.length ? out : [""]; };

// --- Secret requests (herdr-pr secret) -------------------------------------------------------

function herdrPr(args, machine) {
  if (isLocal(machine) && windows()) return exec("python", [`${home().replace(/\\/g, "/")}/.local/bin/herdr-pr`, ...args]);
  return exec("sh", ["-c", 'exec "$HOME/.local/bin/herdr-pr" "$@"', "herdr-pr", ...args], { on: machine ?? undefined });
}

export async function secretRequests(machine) {
  const r = await herdrPr(["secrets", "--json"], machine).catch(() => null);
  if (!r || r.code !== 0) return [];
  try { return JSON.parse(r.stdout).filter((a) => a && a.id && a.key).map((a) => ({ ...a, machine: machine ?? null })); } catch { return []; }
}

export async function fillSecret(request, value) {
  const r = await herdrPr(["secret-fill", request.id, b64(value)], request.machine);
  if (r.code !== 0) throw new Error(String(r.stderr).trim().replace(/^herdr-pr: /, "") || "couldn't write the secret");
}

export async function declineSecret(request) {
  await herdrPr(["secret-decline", request.id], request.machine).catch(() => {});
}

// UTF-8 safe base64 (mods have no btoa).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function b64(text) {
  const bytes = [];
  for (const ch of String(text)) {
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
