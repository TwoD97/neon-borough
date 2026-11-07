import { skin } from "./theme-tokens.js";
// The crew: six robots (Cyberpunk Crew asset pack, chars/), each agent played by one.
// Who plays whom is shared ("crew.cast": { "<agent address>": "<character id>" }) so the Crew
// panel, the pet and the agents list agree. Copied as-is into my-agents; keep both the same.
import { shared, setShared, terminals, agents, hc } from "herdr";

export const DIR = "mods/crew/chars";

export const PALETTES = [
  {id:"theme",name:"Match theme",color:"#8aabbc"},
  { id: "provider", name: "Match provider", color: "#86cfd1" },
  { id: "original", name: "Original", color: "#a3aebe" },
  { id: "claude", name: "Copper", color: "#e1a17e" },
  { id: "codex", name: "Ice", color: "#70e5e7" },
  { id: "violet", name: "Violet", color: "#b59aff" },
  { id: "mint", name: "Mint", color: "#6ce4b4" },
  { id: "rose", name: "Rose", color: "#f58dc0" },
  { id: "gold", name: "Gold", color: "#f1c76c" },
];
const sharedMap = key => {
  const value = shared(key);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};
export function paletteChoice(address) {
  const selected = sharedMap("crew.palettes")[address];
  return PALETTES.some(p => p.id === selected) ? selected : "provider";
}
export function setPalette(address, id) {
  if (!address || !PALETTES.some(p => p.id === id)) return;
  setShared("crew.palettes", { ...sharedMap("crew.palettes"), [address]: id });
}
export function paletteFor(agent) {
  const choice = paletteChoice(agent?.address);
  if (choice === "theme") {
    const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255);
    const norm=c=>{const v=rgb(c),min=Math.min(...v),range=Math.max(...v)-min;return range<.02?[0,0,0]:v.map(n=>(n-min)/range);};
    const target=norm(skin().accent);
    return PALETTES.filter(p=>!["theme","provider","original"].includes(p.id))
      .map(p=>({id:p.id,d:norm(p.color).reduce((n,v,i)=>n+(v-target[i])**2,0)})).sort((a,b)=>a.d-b.d)[0].id;
  }
  if (choice !== "provider") return choice;
  const name = provider(agent).name;
  return /claude/i.test(name) ? "claude" : /codex|openai/i.test(name) ? "codex" : "original";
}
export function renameCompanion(address, text) {
  if (!address) return;
  const name = Array.from(String(text ?? "").replace(/\s+/g, " ").trim()).slice(0, 32).join("");
  const names = { ...sharedMap("crew.names") };
  if (name) names[address] = name; else delete names[address];
  setShared("crew.names", names);
}
// Working robots step between their two poses (<act>-1.png, <act>-2.png) on one clock.
// Not an animated .webp: while an animated image is on screen the window redraws every
// frame (about half a CPU core); this redraws the views showing a robot ~3 times a second.
export const STEP_MS = 300;
let pose = 1, flippedAt = 0, animatedAt = 0;
export const animatedPose = () => { animatedAt = Date.now(); return pose; };
// From a view's init: flip the poses while working robots are drawn, then `step` (by
// default: redraw the whole view; a view can redraw just its retained robots instead).
export function stepRobots(cx, step = (cx) => cx.notify()) {
  cx.timer.every(STEP_MS, (cx) => {
    const now = Date.now();
    if (now - animatedAt > 3 * STEP_MS) return;
    // Several views share the clock: only the first in each step flips it.
    if (now - flippedAt >= STEP_MS - 60) { pose = 3 - pose; flippedAt = now; }
    step(cx);
  });
}
// A working robot's sprite path without its pose (append `-1.png` / `-2.png`), or null
// when it stands still.
export function steppingBase(agent, motion = true, characterId) {
  if (!motion || shared("neon.motion") === false || agent?.status !== "working") return null;
  const id = characterId || characterOf(agent?.address).id;
  const palette = paletteFor(agent);
  return `${palette === "original" ? DIR : `${DIR}/providers/${palette}`}/${id}/working`;
}

export function spriteFor(agent, motion = true, characterId) {
  const id = characterId || characterOf(agent?.address).id;
  const palette = paletteFor(agent);
  const root = palette === "original" ? DIR : `${DIR}/providers/${palette}`;
  const animated = motion && shared("neon.motion") !== false && agent?.status === "working";
  return `${root}/${id}/${actOf(agent?.status)}-${animated ? animatedPose() : 1}.png`;
}
export function stillFor(agent, characterId) {
  const id = characterId || characterOf(agent?.address).id;
  const palette = paletteFor(agent);
  return `${palette === "original" ? DIR : `${DIR}/providers/${palette}`}/${id}/idle-1.png`;
}

export const CHARACTERS = [
  { id: "patch", name: "PATCH", role: "Debugger", color: "#b5d334", personality: "Curious, resourceful repair specialist. Loves a good stack trace.",
    lines: { idle: ["Toolbelt's ready.", "Anything need fixing?", "Polishing my screwdriver."], working: ["Tracing the fault…", "Found a loose wire.", "Patching it up."], attention: ["Need your eyes on this!", "Which wire do I cut?", "Quick question, boss."], success: ["Fixed it!", "Good as new.", "Bug squashed."] } },
  { id: "ghost", name: "GHOST", role: "Security", color: "#a879f2", personality: "Quiet, watchful guardian. Trusts nothing, checks everything.",
    lines: { idle: ["Watching.", "All quiet.", "…"], working: ["Scanning the perimeter.", "Checking every door.", "Following the trail."], attention: ["Something needs your call.", "I won't go further without you.", "Permission?"], success: ["Secured.", "Nothing slipped past.", "Clean."] } },
  { id: "atlas", name: "ATLAS", role: "Architect", color: "#5b84ff", personality: "Patient, methodical builder. Measures twice, commits once.",
    lines: { idle: ["Blueprints filed.", "Ready to build.", "Reviewing the plans."], working: ["Laying the foundation.", "Raising the frame.", "One beam at a time."], attention: ["Need a decision on the design.", "Which way should this go?", "Sign-off needed."], success: ["Structure complete.", "Built to last.", "Done, and it holds."] } },
  { id: "zip", name: "ZIP", role: "Speed", color: "#ff9a3c", personality: "Restless, enthusiastic optimizer. Already halfway there.",
    lines: { idle: ["Bored. Gimme a job!", "Engine's warm.", "Ready, set…"], working: ["Zooom!", "Shaving off milliseconds.", "Full throttle."], attention: ["Pit stop: need you!", "Waiting at the light!", "Your move, quick!"], success: ["Delivered!", "New record!", "Done before you blinked."] } },
  { id: "nova", name: "NOVA", role: "UI Designer", color: "#ff5fc8", personality: "Expressive visual perfectionist. Every pixel matters.",
    lines: { idle: ["Daydreaming in color.", "Mood board ready.", "Humming a tune."], working: ["Nudging pixels.", "Picking the perfect shade.", "Making it pretty."], attention: ["Which looks better?", "Need your taste here!", "Opinion, please?"], success: ["Gorgeous!", "Pixel perfect.", "Ta-da!"] } },
  { id: "hex", name: "HEX", role: "Tester", color: "#3fd3c0", personality: "Meticulous, inquisitive inspector. Finds the edge case.",
    lines: { idle: ["Checklist loaded.", "Magnifier polished.", "Awaiting specimens."], working: ["Inspecting…", "Testing every edge.", "Ticking boxes."], attention: ["Found something odd.", "Need your verdict.", "Should this pass?"], success: ["All checks green.", "Verified.", "Passed inspection."] } },
];

export const byId = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

// Herdr's statuses as the robots act them out.
export const ACT = { working: "working", blocked: "attention", done: "success", idle: "idle" };
export const actOf = (status) => ACT[status] ?? "idle";
// Work has an energetic loop. Waiting, idle and completion keep their own
// readable still poses; attention is conveyed by a restrained native pulse.
export const sprite = (charId, status, motion = true) => `${DIR}/${charId}/${actOf(status)}-${motion && shared("neon.motion") !== false && status === "working" ? animatedPose() : 1}.png`;
export const still = (charId) => `${DIR}/${charId}/idle-1.png`;

// Providers, by the colors people know them by. The robots keep their own colors; the
// provider shows as a badge, the glow under the robot and a stripe in the agents list.
const PROVIDERS = [
  { match: /claude/i, name: "Claude Code", color: "#d97757" },
  { match: /codex|openai/i, name: "Codex", color: "#10a37f" },
  { match: /gemini/i, name: "Gemini", color: "#4f8df9" },
  { match: /copilot/i, name: "Copilot", color: "#9a6cf0" },
  { match: /opencode/i, name: "OpenCode", color: "#e8b730" },
  { match: /cursor/i, name: "Cursor", color: "#c9ced6" },
  { match: /amp/i, name: "Amp", color: "#f2545b" },
  { match: /aider/i, name: "Aider", color: "#14b014" },
  { match: /qwen/i, name: "Qwen", color: "#615ced" },
  { match: /kimi|moonshot/i, name: "Kimi", color: "#2f80ff" },
  { match: /grok/i, name: "Grok", color: "#e5e5e5" },
  { match: /\bpi\b/i, name: "Pi", color: "#f0a43a" },
];
export function provider(agent) {
  const keys = [agent?.program?.key, agent?.app, agent?.program?.name].filter(Boolean).join(" ");
  const hit = PROVIDERS.find((p) => p.match.test(keys));
  return hit ?? { name: agent?.program?.name || agent?.app || "Agent", color: "#8b93a7" };
}

export const cast = () => shared("crew.cast") ?? {};

// The robot a terminal was given when its agent started (herdr-crew labels it herdr.crew=<id>,
// and the agent got that robot's personality): it wins over the panel's own pick.
// terminals() and agents() copy the host's whole lists. One render asks for every agent's character
// (often twice per row), so keep one indexed copy per render (refreshed after 50 ms).
let snap = null, snapAt = 0;
function lookup() {
  const now = Date.now();
  if (!snap || now - snapAt > 50) {
    snap = { terminals: new Map(terminals().map((t) => [t.address, t])), agents: new Map(agents().map((a) => [a.address, a])) };
    snapAt = now;
  }
  return snap;
}

export function labelled(address) {
  const t = lookup().terminals.get(address);
  const labels = t?.labels;
  const v = Array.isArray(labels) ? labels.find((x) => String(x).startsWith("herdr.crew="))?.split("=")[1] : labels?.["herdr.crew"];
  return byId[v] ? v : null;
}

// The character an agent plays: its label, else its stored one, else a stable pick from its address.
export function characterOf(address) {
  const id = labelled(address) ?? cast()[address];
  let character = byId[id];
  if (!character) {
    let h = 0;
    for (const ch of String(address)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    character = CHARACTERS[h % CHARACTERS.length];
  }
  const stored = sharedMap("crew.names")[address];
  const name = typeof stored === "string" && stored.trim() ? stored : character.name;
  const agent = lookup().agents.get(address) ?? { address };
  const palette = PALETTES.find(p => p.id === paletteFor(agent));
  return { ...character, name, originalName: character.name,
    color: palette && palette.id !== "original" ? palette.color : character.color };
}

// Gives each new agent the character used least right now (and not already in its space),
// and forgets agents that are gone. Call from one place (the Crew mod's render).
export function castNew(list) {
  const cur = cast();
  const live = new Set(list.map((a) => a.address));
  let changed = false;
  const next = {};
  for (const [addr, id] of Object.entries(cur)) {
    if (live.has(addr) && byId[id]) next[addr] = id; else changed = true;
  }
  for (const a of list) {
    if (next[a.address] || labelled(a.address)) continue;
    const uses = (id) => Object.values(next).filter((x) => x === id).length;
    const inSpace = new Set(list.filter((b) => b.space === a.space && next[b.address]).map((b) => next[b.address]));
    const pool = CHARACTERS.filter((c) => !inSpace.has(c.id));
    const pick = (pool.length ? pool : CHARACTERS).reduce((best, c) => (uses(c.id) < uses(best.id) ? c : best));
    next[a.address] = pick.id;
    changed = true;
  }
  if (changed) setShared("crew.cast", next);
}

// Picking another robot relabels the terminal too: the agent takes on that personality the
// next time it starts, resumes or clears.
export function recast(address, id) {
  if (!byId[id]) return;
  hc(["label", address, `herdr.crew=${id}`]).catch(() => {});
  setShared("crew.cast", { ...cast(), [address]: id });
}

// What the robot says now: one of its lines for this state, steady per agent.
export function line(agent, ch) {
  const lines = ch.lines[actOf(agent.status)] ?? ch.lines.idle;
  let h = 0;
  for (const c of `${agent.address}:${agent.status}`) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return lines[h % lines.length];
}
