import {skin} from "./theme-tokens.js";
// The town: one per Spaces page ("each tab its own town"). Every space is a home on a plot,
// built in the style of the robot that lives there; its agents are robots. Working robots
// animate at home, waiting has a gentle amber pulse, completion keeps a steady check,
// and idle robots rest calmly. Assets: Neon Borough pack (town/).
import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, run, shared, setShared, openOverlay, terminals } from "herdr";
import { HOUSES, PROPS, STREET, SKYLINE, ROAD, PROPS2 } from "./town/houses.js";
import { CHARACTERS, byId, characterOf, provider, spriteFor, stillFor, line } from "./cast.js";
import { keyOf, inPage, pages, currentPage } from "./machines.js";
import { reportedActivity } from "./activity-data.js";
import { beginTown, legFor, frameFor, spriteEl } from "./town-actors.js";
import { bevel } from "./controls.js";

const T = "mods/crew/town";
const FX = `${T}/fx`;
const HOME_SIZE = { patch: [468, 368], ghost: [375, 478], atlas: [478, 444], zip: [478, 328], nova: [464, 412], hex: [469, 403] };
const WORD = { blocked: "NEEDS YOU", working: "WORKING", done: "COMPLETE", idle: "HOME", empty: "EMPTY PLOT" };
const RANK = { blocked: 4, working: 3, done: 2, idle: 1 };
const machineOfAgent = (a) => (a.address.includes("/") ? a.address.split("/")[0] : null);
// How much of the sprite's frame the standing robot fills.
const STAND_FILL = 0.62;
const motionFor=view=>typeof view.motionOn==="function"?view.motionOn():view.motion!==false&&shared("neon.motion")!==false;

function hash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// Every house: the generated ones, plus the six robot homes.
export const ALL_HOUSES = [
  ...HOUSES,
  ...CHARACTERS.map((c) => ({ id: `home-${c.id}`, file: `${T}/homes/${c.id}.png`, name: `${c.name}'s ${{ patch: "garage", ghost: "tower", atlas: "foundry", zip: "hub", nova: "studio", hex: "lab" }[c.id]}`, accent: c.color, w: HOME_SIZE[c.id][0], h: HOME_SIZE[c.id][1] })),
];
const houseById = Object.fromEntries(ALL_HOUSES.map((h) => [h.id, h]));

// Each space keeps the house it was given ("town.houses.v2"); a new one gets the house least used,
// and never one already standing in its town.
function housesFor(list) {
  const cur = shared("town.houses.v2") ?? {};
  const next = { ...cur };
  let changed = false;
  const inTown = new Set(list.map((s) => next[s.id]).filter(Boolean));
  for (const s of list) {
    if (houseById[next[s.id]]) continue;
    const uses = (id) => Object.values(next).filter((x) => x === id).length;
    const free = HOUSES.filter((h) => !inTown.has(h.id)).length ? HOUSES.filter((h) => !inTown.has(h.id)) : ALL_HOUSES.filter((h) => !inTown.has(h.id));
    const pool = (free.length ? free : ALL_HOUSES);
    const start = hash(s.id) % pool.length;
    const ordered = [...pool.slice(start), ...pool.slice(0, start)];
    const pick = ordered.reduce((best, h) => (uses(h.id) < uses(best.id) ? h : best), ordered[0]);
    next[s.id] = pick.id;
    inTown.add(pick.id);
    changed = true;
  }
  if (changed) setShared("town.houses.v2", next);
  return next;
}

export function setHouse(spaceId, houseId) {
  if (houseById[houseId]) setShared("town.houses.v2", { ...(shared("town.houses.v2") ?? {}), [spaceId]: houseId });
}

// The spaces of the shown page, and the agents of each.
export function townModel(district = 0) {
  const all = agents();
  const sp = spaces().filter((s) => inPage(keyOf(s.machine)));
  const districts = Math.max(1, Math.ceil(sp.length / 12));
  const d = Math.min(district, districts - 1);
  const shown = sp.slice(d * 12, d * 12 + 12);
  const houses = housesFor(sp);
  const homes = shown.map((s) => {
    const mine = all.filter((a) => a.space === s.id);
    const top = mine.reduce((best, a) => ((RANK[a.status] ?? 0) > (RANK[best] ?? 0) ? a.status : best), null);
    const resident = mine[0] ? characterOf(mine[0].address) : CHARACTERS[hash(s.id) % CHARACTERS.length];
    return { space: s, agents: mine, state: mine.length ? top ?? "idle" : "empty", identity: resident.id, house: houseById[houses[s.id]] ?? ALL_HOUSES[0] };
  });
  return { homes, districts, district: d, page: currentPage() };
}

// The scene, top to bottom: skyline, back row of houses on the far sidewalk, the road, a front
// row (a little bigger, for depth), a strip of foreground. Everything scales with the width W.
export function townAspect(W) {
  if (W <= 850) return 0.62;
  if (W >= 1300) return 0.43;
  // Interpolate height, rather than ratio, so fitting remains monotonic.
  return (527 + (W - 850) * (32 / 450)) / W;
}

function geometry(W, height) {
  const H = Math.round(height || W * townAspect(W));
  const sky = Math.round(H * 0.14), row0 = Math.round(H * 0.28), road = Math.round(H * 0.23), row1 = Math.round(H * 0.28);
  const backLine = sky + row0;            // feet of the back row
  const roadTop = backLine, roadBottom = roadTop + road;
  const frontLine = roadBottom + row1;    // feet of the front row
  const foot = H - frontLine;
  return {
    W, H, sky, row0, row1, road, backLine, roadTop, roadBottom, frontLine,
    street: { y0: roadTop + road * 0.48, y1: roadTop + road * 0.86 },
    door: (row) => (row === 0 ? backLine + road * 0.19 : frontLine + foot * 0.55),
  };
}

// Houses of one row, packed: varied heights, gaps shared out, the gaps filled with props later.
function packRow(homes, rowH, W, depth) {
  if (!homes.length) return { items: [], gaps: [{ x0: 0, x1: W }] };
  const items = homes.map((home) => {
    const hh = rowH * (0.8 + (hash(home.space.id) % 21) / 100) * depth;
    return { home, w: home.house.w * (hh / home.house.h), h: hh };
  });
  const minGap = W * 0.025;
  const total = items.reduce((n, it) => n + it.w, 0);
  const fit = Math.min(1, (W - minGap * (items.length + 1)) / total);
  for (const it of items) { it.w *= fit; it.h *= fit; }
  const free = W - items.reduce((n, it) => n + it.w, 0);
  const gap = free / (items.length + 1);
  let x = gap;
  const gaps = [{ x0: 0, x1: gap }];
  for (const it of items) {
    it.x = x;
    // Roof plaques occupy their own plot, even when the district has six houses.
    it.labelWidth = Math.min(184, it.w + 42, W / (homes.length + .25) - 12);
    x += it.w; gaps.push({ x0: x, x1: x + gap }); x += gap;
  }
  return { items, gaps };
}

const toneOf = (t, status) => status === "blocked" ? t.blocked : status === "working" ? t.working : status === "done" ? t.done : t.dim;
const FX_STATE = { working: "working", blocked: "blocked", done: "done" };

// Two-frame art (screens, sparks, flares): frame 2 fades in and out over frame 1, natively.
function flicker(id, base, motion, period) {
  return div().id(id).relative().size_full()
    .child(image(`${base}-1.png`).absolute().top(0).left(0).size_full())
    .when(motion, el => el.child(image(`${base}-2.png`).absolute().top(0).left(0).size_full()
      .loop("opacity", { from: 0, to: 1, period, easing: "linear" })));
}

// A resident: its sprite on a status pad, a work station while it works, and a bubble when it
// needs you or has finished. Idle residents have none of these and stroll the sidewalk.
function robotEl(view, a, leg, feet, size, t, now, records) {
  const ch = characterOf(a.address), pv = provider(a);
  const motion = motionFor(view), status = a.status, color = toneOf(t, status);
  const h = Math.round(size / STAND_FILL), w = Math.round(h * 157 / 209);
  const moving = motion && now < leg.start + leg.dur;
  const atHome = !moving && status !== "idle";
  const head = Math.round(h * 0.16);
  const act = atHome && status === "working" ? reportedActivity(a, records) : null;
  const box = div().id(`tr-${a.address}`).absolute().w(w).h(h + 14).left(Math.round(leg.x - w / 2)).top(Math.round(feet - h))
    // Declared on every render: a transition only animates changes made after it was in place.
    .transition("left", moving ? { duration: Math.max(100, leg.start + leg.dur - now), easing: "linear" } : { duration: 300, easing: "ease-out" })
    .cursor_pointer()
    .tooltip(`${ch.name} · ${pv.name} · ${a.space_name}\n${status === "blocked" ? "needs you" : status}: ${a.title || a.tab_name || ""}${act ? `\n${act.title}` : ""}\n“${line(a, ch)}”`)
    .on_click(() => { run("layout.select", { stack: "root", child: "desktop" }); run("agent.focus", { terminal: a.address }); })
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); view.profile(a.address); });
  if (atHome && FX_STATE[status]) {
    const pw = Math.round(w * 1.5), ph = Math.round(pw * 80 / 256);
    box.child(image(`${FX}/pad-${FX_STATE[status]}.png`).id(`pad-${a.address}`).absolute().left(Math.round((w - pw) / 2)).top(h - Math.round(ph * 0.6)).w(pw).h(ph)
      .when(motion && status !== "done", el => el.loop("opacity", { from: 0.55, to: 1, period: status === "blocked" ? 900 : 1700 })));
  }
  if (act) {
    const kind = act.source === "model" ? "think" : ["code", "test", "scan"].includes(act.kind) ? act.kind : "run";
    const ss = Math.round(h * 0.8);
    box.child(div().absolute().left(Math.round(w * 0.62)).top(h - ss + Math.round(h * 0.02)).size(ss)
      .child(flicker(`station-${a.address}`, `${FX}/station-${kind}`, motion, kind === "run" ? 500 : 900)));
  }
  box.child(div().absolute().top(0).left(0).w(w).h(h).opacity(status === "idle" ? 0.9 : 1)
    .child(spriteEl(view, `walker:${a.address}`, frameFor(a, leg, now, motion))));
  if (atHome && (status === "blocked" || status === "done")) {
    const bs = Math.round(Math.max(30, size * 0.62));
    box.child(image(`${FX}/bubble-${status === "blocked" ? "alert" : "done"}.png`).id(`bubble-${a.address}`).absolute()
      .left(Math.round((w - bs) / 2)).top(head - bs).size(bs)
      .when(motion && status === "blocked", el => el.loop("top", { from: head - bs - 7, to: head - bs, period: 800, easing: "ease-out" })));
  }
  box.child(div().absolute().bottom(0).left(-10).w(w + 20).flex().justify_center()
    .child(div().px(5).py(1).rounded(3).bg(t.popover).border_1()
      .border_color(`${ch.color}44`).text_size(10).font_bold()
      .text_color(t.light ? t.foreground : ch.color).child(ch.name)));
  return box;
}

// The house's light: a glow behind it in its status color.
function houseGlow(view, home, b) {
  const state = FX_STATE[home.state];
  if (!state) return [];
  const motion = motionFor(view);
  // The halo art is a soft oval in the middle of its canvas: centre it on the house's feet so it
  // spills around the walls and onto the pavement.
  const gw = Math.round(b.w * 2.1), gh = Math.round(gw * 320 / 512);
  return [image(`${FX}/glow-${state}.png`).id(`glow-${home.space.id}`).absolute().left(Math.round(b.x + (b.w - gw) / 2)).top(Math.round(b.y + b.h - gh * 0.58)).w(gw).h(gh)
    .opacity(state === "done" ? 0.5 : 0.8)
    .when(motion && state !== "done", el => el.loop("opacity", { from: 0.45, to: 1, period: state === "blocked" ? 1100 : 2800 }))];
}

// Work in progress on the house: a beacon on the roof, and data rising off it while it works.
function houseActivity(view, home, b) {
  const state = FX_STATE[home.state];
  if (!state) return [];
  const motion = motionFor(view), id = home.space.id, out = [];
  // Light pooling on the pavement in front of the house.
  const pw = Math.round(b.w * 1.25), ph = Math.round(pw * 0.32);
  out.push(image(`${FX}/glow-${state}.png`).id(`pool-${id}`).absolute().left(Math.round(b.x + (b.w - pw) / 2)).top(Math.round(b.y + b.h - ph * 0.5)).w(pw).h(ph)
    .opacity(state === "done" ? 0.6 : 0.9)
    .when(motion && state !== "done", el => el.loop("opacity", { from: 0.6, to: 1, period: state === "blocked" ? 1100 : 2800 })));
  if (state === "done") return out;
  const bs = Math.round(Math.max(22, Math.min(40, b.w * 0.13)));
  out.push(div().absolute().left(Math.round(b.x + b.w * 0.86 - bs / 2)).top(Math.round(b.y + bs * 0.05)).size(bs)
    .child(flicker(`beacon-${id}`, `${FX}/beacon-${home.state}`, motion, home.state === "blocked" ? 700 : 1300)));
  if (home.state === "working" && motion) {
    const ms = Math.max(8, Math.round(b.w * 0.035));
    [0.24, 0.5, 0.76].forEach((fx, i) => {
      const x = Math.round(b.x + b.w * fx), top = Math.round(b.y + b.h * 0.3);
      out.push(div().id(`mote-${id}-${i}`).absolute().left(x).top(top).size(ms)
        .loop("top", { from: top, to: top - Math.round(b.h * 0.5), period: 3200 + i * 700, easing: "linear" })
        .child(image(`${FX}/mote-working.png`).size_full().loop("opacity", { from: 0, to: 1, period: 1600 + i * 350 })));
    });
  }
  return out;
}

function houseEls(view, it, feet, t) {
  const home = it.home, house = home.house;
  const color = home.state === "empty" ? "#6e6699" : house.accent;
  const hw = Math.round(it.w), hh = Math.round(it.h), hx = Math.round(it.x), hy = Math.round(feet - hh);
  const id = home.space.id;
  const tip = `${home.space.name} · ${house.name}\n${home.agents.length ? home.agents.map((a) => `${characterOf(a.address).name}: ${a.status}`).join("\n") : "no agents"}\nRight-click to change the house`;
  const els = [
    // Its light on the pavement: brighter for the space on screen.
    div().absolute().left(hx + Math.round(hw * 0.08)).top(Math.round(feet - 7)).w(Math.round(hw * 0.84)).h(12).rounded(99).bg(`${color}${home.space.active ? "99" : "40"}`),
    div().id(`house-${id}`).absolute().left(hx).top(hy).w(hw).h(hh).cursor_pointer().tooltip(tip)
      .on_click(() => { run("layout.select", { stack: "root", child: "desktop" }); run("space.select", { id }); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "crew", kind: "dialog", width: 720, height: 520, props: { housePicker: id } }); })
      .child(image(house.file).size_full().opacity(home.state === "empty" ? 0.6 : 1)),
  ];
  els.unshift(...houseGlow(view, home, { x: hx, y: hy, w: hw, h: hh }));
  els.push(...houseActivity(view, home, { x: hx, y: hy, w: hw, h: hh }));
  // A fitted address plaque keeps names readable without a floating task bubble.
  const labelWidth=Math.max(46,Math.round(it.labelWidth ?? hw+16));
  const statusColor=home.state==="blocked"?t.blocked:home.state==="working"?t.working:home.state==="done"?t.done:t.dim;
  els.push(bevel(h_flex().id(`house-sign-${id}`).absolute()
    .left(Math.round(hx+(hw-labelWidth)/2)).top(Math.max(3,hy-27)).w(labelWidth).h(23).px(8).gap(5).items_center(),home.space.active).absolute()
    .tooltip(tip)
    .on_click(()=>{run("layout.select",{stack:"root",child:"desktop"});run("space.select",{id});})
    .child(div().size(4).flex_none().bg(statusColor))
    .child(div().flex_1().min_w(0).truncate().text_size(10).font_semibold().text_color(t.foreground).child(home.space.name))
    .child(div().flex_none().text_size(9).text_color(t.dim).child(String(home.agents.length))));
  return els;
}

// A seamless strip, repeated across the width at the given height (images keep their shape).
function tiled(file, aspect, top, h, W, id) {
  const tw = Math.round(h * aspect), out = [];
  // Neighbours overlap by 2 px: image edges are filtered, and a butt joint shows a hairline.
  for (let x = 0, n = 0; x < W; x += tw - 2, n++) out.push(image(file).id(`${id}-${n}`).absolute().left(x).top(Math.round(top)).w(tw).h(Math.round(h)));
  return out;
}

export function renderTown(view, t, W, height) {
  t=skin(t);
  const m = townModel(view.district ?? 0);
  const g = geometry(W,height);
  const seed = hash(m.page?.id ?? "all");
  const motion = motionFor(view);
  const activeWorkers = m.homes.some(home => home.agents.some(a => a.status === "working"));
  const ambientMotion = motion && activeWorkers;
  const half = Math.ceil(m.homes.length / 2);
  const rowBack = packRow(m.homes.slice(0, half), g.row0, W, 1), rowFront = packRow(m.homes.slice(half), g.row1, W, 1.08);
  const kids = [];
  // Sky and skyline.
  kids.push(div().absolute().left(0).top(0).w(W).h(g.roadTop).bg("#120d2a"));
  if (SKYLINE) kids.push(...tiled(SKYLINE, 3, 0, g.backLine * 1.25, W, "sky"));
  else kids.push(image(STREET).absolute().left(0).top(-Math.round(W * 0.2)).w(W).h(Math.round(W * 0.66)).opacity(0.5));
  // Drones drifting over the roofs (native animation, no timer).
  const drone = PROPS.find((x) => x.id === "drone");
  if (drone) for (let k = 0; k < 2; k++) {
    const dw = Math.round(W * (0.035 + k * 0.01)), dh = Math.round(dw * drone.h / drone.w);
    kids.push(image(drone.file).id(`sky-drone-${k}`).absolute().w(dw).h(dh).top(Math.round(g.sky * (0.25 + k * 0.45)))
      .left(k ? W - dw : 0).when(ambientMotion, el => el.loop("left", { from: k ? W - dw : 0, to: k ? 0 : W - dw, period: 22000 + k * 9000, easing: "ease-in-out" }))
      .opacity(0.85 - k * 0.25));
  }
  // The road and both sidewalks.
  if (ROAD) kids.push(...tiled(ROAD, 3, g.roadTop - g.road * 0.18, g.road * 1.36, W, "road"));
  else {
    const ih = Math.round(g.road / 0.16), top = Math.round(g.roadTop + g.road * 0.5 - ih * 0.5);
    kids.push(image(STREET).absolute().left(0).top(top).w(W).h(ih));
  }
  kids.push(div().absolute().left(0).top(Math.round(g.roadBottom + g.road * 0.18)).w(W).h(g.H).bg("#141022"));
  if (STREET) kids.push(image(STREET).absolute().left(0).top(Math.round(g.roadBottom + g.road * 0.18)).w(W).h(Math.round(W * 0.66)).opacity(0.65));
  if (!ROAD) {
    kids.push(div().absolute().left(0).top(Math.round(g.roadTop - 1)).w(W).h(2).bg("#2de2e6aa"));
    kids.push(div().absolute().left(0).top(Math.round(g.roadBottom)).w(W).h(2).bg("#ff2bd6aa"));
  }
  // Props: fill each gap between houses, the same arrangement every time for this town.
  const FLOOR = /puddle|floor-arrow|ground-ad|cables|robot-cat|vent|drone|lamp/;
  const pool = [...PROPS2, ...PROPS].filter((x) => !FLOOR.test(x.id));
  const props = [];
  const fillGaps = (gaps, feet, size, salt) => gaps.forEach((gp, gi) => {
    let x = gp.x0 + size * 0.15, n = 0;
    while (pool.length && x < gp.x1 - size * 0.4 && n < 3) {
      const pr = pool[(seed + salt * 13 + gi * 7 + n * 5) % pool.length];
      const big = /tree|palm|cherry|pole|billboard|sign|lights|booth|car|fountain|cart/.test(pr.id);
      const tiny = /cones|hydrant|bollards|plants|crates/.test(pr.id);
      const s = size * (big ? 1.25 : tiny ? 0.5 : 0.75);
      const k = s / Math.max(pr.w, pr.h), w = pr.w * k, h = pr.h * k;
      if (x + w > gp.x1 + size * 0.1) break;
      props.push({ feet: feet + (n % 2) * 3, el: image(pr.file).absolute().left(Math.round(x)).top(Math.round(feet + (n % 2) * 3 - h)).w(Math.round(w)).h(Math.round(h)) });
      x += w + size * 0.4; n++;
    }
  });
  fillGaps(rowBack.gaps, g.backLine, g.row0 * 0.55, 1);
  fillGaps(rowFront.gaps, g.frontLine, g.row1 * 0.5, 2);
  // The front edge: small details, and a robot cat that strolls back and forth.
  const small = PROPS2.filter((x) => /bollards|hydrant|plants|cones|tarp-crates/.test(x.id));
  for (let n = 0; small.length && n < 5; n++) {
    const pr = small[(seed + n * 3) % small.length], s = g.row1 * 0.2, k = s / Math.max(pr.w, pr.h);
    const x = W * (0.06 + n * 0.21 + ((seed >> n) % 5) / 100), feet = g.H - 3;
    props.push({ feet, el: image(pr.file).absolute().left(Math.round(x)).top(Math.round(feet - pr.h * k)).w(Math.round(pr.w * k)).h(Math.round(pr.h * k)) });
  }
  const cat = PROPS2.find((x) => x.id === "robot-cat");
  if (cat) {
    const s = g.row1 * 0.2, k = s / Math.max(cat.w, cat.h), cw = Math.round(cat.w * k), chh = Math.round(cat.h * k);
    props.push({ feet: g.H - 1, el: image(cat.file).id("cat").absolute().top(g.H - 4 - chh).w(cw).h(chh).left(Math.round(W * 0.1))
      .when(ambientMotion, el => el.loop("left", { from: Math.round(W * 0.06), to: Math.round(W * 0.9), period: 40000, easing: "linear" })) });
  }
  // Lamps along both curbs.
  const lamp = PROPS.find((x) => x.id === "lamp");
  if (lamp) for (let x = W / 10; x < W; x += W / 5) {
    for (const [feet, off] of [[g.roadTop + g.road * 0.06, 0], [g.roadBottom + g.road * 0.16, W / 10]]) {
      const s = g.road * 0.9, k = s / lamp.h;
      props.push({ feet, el: image(lamp.file).absolute().left(Math.round(x + off - (lamp.w * k) / 2)).top(Math.round(feet - s)).w(Math.round(lamp.w * k)).h(Math.round(s)) });
    }
  }
  // Every resident rests at their own house. Only working sprites animate;
  // waiting gets a gentle amber signal and completion stays visible.
  // Working, waiting and finished robots stand at their own door (room for a work station);
  // idle ones stroll their sidewalk.
  const size = Math.max(30, Math.min(70, W * 0.04));
  const now = Date.now(), records = terminals();
  beginTown(view);
  const robots = [];
  for (const [row, packed] of [[0, rowBack], [1, rowFront]]) {
    for (const it of packed.items) {
      const n = it.home.agents.length, step = Math.min(it.w / Math.max(1, n), size * 2.1);
      it.home.agents.forEach((a, k) => {
        const x = it.x + it.w / 2 + (k - (n - 1) / 2) * step - size * 0.35;
        const leg = legFor(view, a, { x, min: W * 0.04, max: W * 0.96, W, motion }, now);
        robots.push({ a, leg, feet: g.door(row) });
      });
    }
  }
  // Environment keeps its depth order. Residents are interactive controls and
  // stay above scenery, so foreground lamps never hide their bodies or labels.
  const layer = [];
  for (const it of rowBack.items) layer.push({ feet: g.backLine, els: houseEls(view, it, g.backLine, t) });
  for (const it of rowFront.items) layer.push({ feet: g.frontLine, els: houseEls(view, it, g.frontLine, t) });
  for (const p of props) layer.push({ feet: p.feet, els: [p.el] });
  layer.sort((x, y) => x.feet - y.feet);
  for (const l of layer) kids.push(...l.els);
  robots.sort((x, y) => x.feet - y.feet);
  for (const r of robots) kids.push(robotEl(view, r.a, r.leg, r.feet, size, t, now, records));
  return { el: div().id("town-map").relative().w(W).h(g.H).flex_none().overflow_hidden().children(kids), model: m };
}

// Who is doing what, under the map.
export function whoList(view, model, t) {
  const rows = model.homes.flatMap((h) => h.agents.map((a) => ({ a, h })));
  rows.sort((x, y) => (RANK[y.a.status] ?? 0) - (RANK[x.a.status] ?? 0));
  return v_flex().w_full().gap(1).children(rows.map(({ a, h }) => {
    const ch = characterOf(a.address), pv = provider(a);
    const word = a.status === "blocked" ? "needs you" : a.status;
    const tone = a.status === "blocked" ? t.blocked : a.status === "working" ? t.working : a.status === "done" ? t.done : t.dim;
    return h_flex().id(`who-${a.address}`).w_full().h(44).px(6).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => { run("layout.select", { stack: "root", child: "desktop" }); run("agent.focus", { terminal: a.address }); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); view.profile(a.address); })
      .child(div().w(3).h(18).rounded(2).bg(pv.color))
      .child(image(stillFor(a)).w(17).h(23))
      .child(div().w(52).flex_none().text_size(11.5).font_bold().text_color(t.light?t.foreground:ch.color).child(ch.name))
      .child(div().w(72).flex_none().text_size(11).text_color(tone).child(word))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(a.title || a.tab_name || ""))
      ;
  }));
}

export { pages };
