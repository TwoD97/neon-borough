// Town residents in motion. Idle robots stroll their sidewalk; a robot that gets work walks
// home first, then works at its door. Each sprite is a small retained view: the 140 ms clock
// swaps its frame without rebuilding the town, and the town re-renders only when a walk
// starts (the walk itself is a native `left` transition).
import { View, image } from "gpui-kit";
import { DIR, characterOf, paletteFor } from "./cast.js";

const WALK_MS = 140;
const SPEED = 0.045;        // share of the town width walked per second
const HOME_SPEED = 0.11;    // hurrying home for work

class Sprite extends View {
  init(props) { this.src = props?.src; }
  update(props) { this.src = props?.src; }
  render() { return image(this.src).size_full(); }
}

function rootOf(a) {
  const palette = paletteFor(a);
  return `${palette === "original" ? DIR : `${DIR}/providers/${palette}`}/${characterOf(a.address).id}`;
}

// A small seeded random per robot, so two robots never move in lockstep.
function rand(leg) {
  leg.seed = (leg.seed * 1103515245 + 12345) >>> 0;
  return (leg.seed >>> 8) / 16777216;
}

function seedOf(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function townState(view) {
  view.town ??= { sprites: new Map(), want: new Map(), drawn: new Set(), legs: new Map(), homes: new Map() };
  return view.town;
}

// Called at the start of each town render.
export function beginTown(view) {
  const s = townState(view);
  s.want = new Map(); s.drawn = new Set();
  return s;
}

function walking(leg, now) { return leg && now < leg.start + leg.dur; }

// Where a robot is (or is heading) and how it gets there, for this render.
//   home: { x, min, max, W, status, motion }
export function legFor(view, a, home, now) {
  const s = townState(view);
  s.homes.set(a.address, { ...home, agent: a });
  let leg = s.legs.get(a.address);
  if (!leg) {
    leg = { x: home.x, from: home.x, start: 0, dur: 0, dir: "right", seed: seedOf(a.address), until: 0 };
    leg.until = now + 1200 + rand(leg) * 4000;
    s.legs.set(a.address, leg);
  }
  if (!home.motion) { leg.x = home.x; leg.dur = 0; }
  leg.x = Math.min(home.max, Math.max(home.min, leg.x));
  return leg;
}

// Plans walks. True when a walk started, so the town must re-render to move the robot.
function plan(s, now) {
  let moved = false;
  for (const [address, leg] of s.legs) {
    const home = s.homes.get(address);
    if (!home) { s.legs.delete(address); continue; }
    if (!home.motion || walking(leg, now)) continue;
    const go = (to, speed, rest) => {
      const dx = to - leg.x;
      if (Math.abs(dx) < 3) return false;
      leg.from = leg.x; leg.x = to; leg.start = now;
      leg.dur = Math.round(Math.abs(dx) / (home.W * speed) * 1000);
      leg.dir = dx < 0 ? "left" : "right";
      leg.until = now + leg.dur + rest;
      return true;
    };
    if (home.agent.status !== "idle") { moved = go(home.x, HOME_SPEED, 0) || moved; continue; }
    if (now < leg.until) continue;
    const reach = home.W * (0.1 + rand(leg) * 0.3);
    let to = leg.x + (rand(leg) < 0.5 ? -reach : reach);
    if (to < home.min || to > home.max) to = leg.x - (to - leg.x);
    to = Math.min(home.max, Math.max(home.min, to));
    if (go(to, SPEED, 2500 + rand(leg) * 7000)) moved = true;
    else leg.until = now + 2000;
  }
  return moved;
}

// The frame a robot shows now: walk cycle while moving, else its status pose.
export function frameFor(a, leg, now, motion) {
  const root = rootOf(a);
  if (motion && walking(leg, now)) return `${root}/walk-${leg.dir}-${1 + Math.floor(now / WALK_MS) % 4}.png`;
  if (!motion) return `${root}/${{ working: "working", blocked: "attention", done: "success" }[a.status] ?? "idle"}-1.png`;
  if (a.status === "working") return `${root}/working-${1 + Math.floor(now / 300) % 2}.png`;
  if (a.status === "blocked") return `${root}/attention-${1 + Math.floor(now / 450) % 2}.png`;
  if (a.status === "done") return `${root}/success-${1 + Math.floor(now / 700) % 2}.png`;
  // Idle: mostly still, with a blink now and then.
  return `${root}/idle-${Math.floor(now / 250) % 14 === 0 ? 2 : 1}.png`;
}

// The sprite element for `key`: its retained view once the clock made one, else a plain image.
export function spriteEl(view, key, src) {
  const s = townState(view);
  s.want.set(key, src);
  const sp = s.sprites.get(key);
  if (sp && !s.drawn.has(key)) { s.drawn.add(key); return sp.entity; }
  return image(src).size_full();
}

// The town clock. `frames(key)` gives each wanted sprite's current frame.
export function townTick(view, cx, frames) {
  const s = townState(view), now = Date.now();
  let added = false;
  for (const key of s.want.keys()) {
    const src = frames(key, now) ?? s.want.get(key);
    const sp = s.sprites.get(key);
    if (!sp) { s.sprites.set(key, { src, entity: cx.new(Sprite, { src }) }); added = true; }
    else if (sp.src !== src) { sp.src = src; sp.entity.set_props({ src }); }
  }
  for (const [key, sp] of s.sprites) {
    if (!s.want.has(key)) { sp.entity.release(); s.sprites.delete(key); }
  }
  if (plan(s, now) || added) cx.notify();
}

// Frame source for the keys the town uses: "walker:<address>" and "still:<address>".
export function townFrames(view, motion) {
  const s = townState(view);
  return (key, now) => {
    const at = key.indexOf(":"), kind = key.slice(0, at), address = key.slice(at + 1);
    const home = s.homes.get(address), a = home?.agent;
    if (!a) return null;
    return frameFor(a, kind === "walker" ? s.legs.get(address) : null, now, motion);
  };
}
