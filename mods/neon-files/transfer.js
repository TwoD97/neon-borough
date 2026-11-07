// Copies files and folders between this computer and connected machines with scp (your ssh keys,
// no prompts). A place is { machine, path }: machine null = this computer, else a name from
// `hc machine ls`. Remote to remote goes through this computer (scp -3).
import { exec, hc, home, window as appWindow } from "herdr";

const windows = () => appWindow()?.platform === "windows";
const SCP = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-r", "-p"];

export const machineName = (machine) => machine ?? "This computer";
export const baseName = (path) => String(path).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(path);

// Where things land by default: Downloads here, ~/inbox on another machine (like tools/up.ps1).
export function inboxOf(machine) {
  if (machine) return "inbox";
  return windows() ? `${home()}\\Downloads` : `${home()}/Downloads`;
}

let cached = null, cachedAt = 0;
async function targets() {
  if (cached && Date.now() - cachedAt < 60_000) return cached;
  const r = await hc(["machine", "ls", "--json"]);
  if (r.code !== 0) throw new Error(String(r.stderr).trim() || "hc machine ls failed");
  cached = Object.fromEntries((JSON.parse(r.stdout).machines ?? []).map((m) => [m.name, m]));
  cachedAt = Date.now();
  return cached;
}

async function sshSpec(place) {
  if (!place.machine) return place.path;
  const m = (await targets())[place.machine];
  if (!m) throw new Error(`${place.machine} isn't a connected machine`);
  if (m.via) throw new Error(`${place.machine} isn't reached over ssh, so files can't be copied there`);
  return `${m.target}:${place.path}`;
}

async function makeDir(place) {
  if (!place.machine) {
    if (windows()) await exec("powershell", ["-NoProfile", "-Command", "& { param($p) New-Item -ItemType Directory -Force -Path $p | Out-Null }", place.path]);
    else await exec("mkdir", ["-p", place.path]);
    return;
  }
  const r = await exec("sh", ["-c", 'mkdir -p "$1"', "mkdir", place.path], { on: place.machine });
  if (r.code !== 0) throw new Error(String(r.stderr).trim() || `can't create ${place.path} on ${place.machine}`);
}

// Copies `from` (a file or folder) into the folder `into`.
export async function copy(from, into) {
  await makeDir(into);
  if (!from.machine && !into.machine) {
    const r = windows()
      ? await exec("powershell", ["-NoProfile", "-Command", "& { param($s, $d) Copy-Item -LiteralPath $s -Destination $d -Recurse -Force -ErrorAction Stop }", from.path, into.path])
      : await exec("cp", ["-R", "-p", from.path, into.path]);
    if (r.code !== 0) throw new Error(String(r.stderr).trim() || "copy failed");
    return;
  }
  if (from.machine && into.machine && from.machine === into.machine) {
    const r = await exec("cp", ["-R", "-p", from.path, into.path], { on: from.machine });
    if (r.code !== 0) throw new Error(String(r.stderr).trim() || "copy failed");
    return;
  }
  const args = [...SCP, ...(from.machine && into.machine ? ["-3"] : []), await sshSpec(from), (await sshSpec(into)) + (into.machine ? "/" : "")];
  const r = await exec("scp", args);
  if (r.code !== 0) throw new Error(String(r.stderr).trim().split("\n").pop() || "scp failed");
}

// Opens a folder on this computer in the system file manager.
export function reveal(path) {
  const platform = appWindow()?.platform;
  const [cmd, args] = platform === "windows" ? ["explorer.exe", [path]] : platform === "macos" ? ["open", [path]] : ["xdg-open", [path]];
  exec(cmd, args).catch(() => {});
}
