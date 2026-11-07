import { skin, artText, mix } from "./theme-tokens.js";
import { bevel } from "./controls.js";
import { providerFrame, providerLook, providerGeometry, providerHeight } from "./provider-skin.js";
import { panelSkin } from "./panel-skin.js";
import { sectionSeparator } from "./separator.js";
import { groupFrame, groupWell, groupControlPalette, groupInsets } from "./group-skin.js";
// Agents (customized) in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left. Grouped is the default: spaces under their
// machine, machines named and ordered as in the Spaces list (shared machines.names / machines.order).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, nextCommand } from "herdr";
import { characterOf, provider, spriteFor, castNew, stepRobots, steppingBase, animatedPose } from "./cast.js";
import { reportedActivity } from "./activity-data.js";
import { LOCAL, keyOf, label as machineLabel, ordered as orderMachines, inPage, currentPage } from "./machines.js";

// A working agent's robot as a retained view: on each pose flip only this image redraws,
// not the whole agents list. Props: { base } (see steppingBase).
class Robot extends View {
  init(props) { this.base = props?.base; }
  update(props) { this.base = props?.base; }
  render() { return image(`${this.base}-${animatedPose()}.png`).size_full(); }
}

// The machine an agent runs on, as a key ("local", or the machine's name from `vps/t7`).
const machineKey = (a) => keyOf(a.address.includes("/") ? a.address.split("/")[0] : null);

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 180;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return !tab.named && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === (shared("agents.sort") ?? "grouped")) ?? SORTS[1];
const FILTERS = [
  { id: "all", label: "All agents", icon: "layers" },
  { id: "working", label: "Working", icon: "spinner" },
  { id: "blocked", label: "Needs you", icon: "alert-triangle" },
  { id: "done", label: "Done", icon: "check" },
];
const filterOf = () => FILTERS.find(f => f.id === shared("agents.filter")) ?? FILTERS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Recognizable provider marks with no baked app tile; other programs retain their own icon.
function icon(p, size, color) {
  if (!p?.icon) return null;
  const identity=String(p.key || p.name || p.icon);
  const mark=/claude/i.test(identity)?"provider-claude":/codex|openai/i.test(identity)?"provider-codex":null;
  if(mark)return svg(`mods/crew/icons/${mark}.svg`).size(size).flex_none().text_color(color);
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) {
      this.menuAt = Math.max(0, SORTS.findIndex(s => s.id === sortOf().id));
      this.menuFocus = cx.focus_handle();
      this.menuFocus.focus();
      return;
    }
    // What's folded (machines, spaces, sections, agents with sub-agents), kept across restarts.
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
    this.robots = new Map();     // address -> { base, entity } (retained Robot views)
    this.wantRobots = new Map(); // address -> base, the working robots the last render drew
    stepRobots(cx, (cx) => this.stepPoses(cx));
    // The same view menu is available to keyboard bindings as my-agents.view.
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "view") this.openView();
        if (command === "profile") {
          const a = agents().find(a => a.focused) || agents().find(a => a.address === focused()?.agent);
          if (a) openOverlay({mod:"crew",kind:"dialog",frame:"none",width:620,height:440,props:{profile:a.address}});
        }
        if (command === "rename") {
          const tab = focused()?.tab;
          if (tab) openOverlay({mod:"neon-rename",kind:"dialog",frame:"none",width:440,height:220,props:{tab}});
        }
      }
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  // An agent's robot: a working one as its retained Robot view (made on the next clock
  // step; until then, and for a robot already drawn in this render, a plain image).
  robot(a, motion = true) {
    const base = steppingBase(a, motion);
    if (base) {
      this.wantRobots.set(a.address, base);
      const r = this.robots.get(a.address);
      if (r && !this.drawnRobots.has(a.address)) { this.drawnRobots.add(a.address); return r.entity; }
    }
    return image(spriteFor(a, motion)).size_full();
  }

  // Each pose flip: redraw only the retained robots, make views for newly working ones
  // (then one full redraw to mount them) and drop the views of robots no longer drawn.
  stepPoses(cx) {
    let added = false;
    for (const [address, base] of this.wantRobots) {
      const r = this.robots.get(address);
      if (!r) { this.robots.set(address, { base, entity: cx.new(Robot, { base }) }); added = true; }
      else { r.base = base; r.entity.set_props({ base, pose: animatedPose() }); }
    }
    for (const [address, r] of this.robots) {
      if (!this.wantRobots.has(address) && !this.drawnRobots.has(address)) { r.entity.release(); this.robots.delete(address); }
    }
    if (added) cx.notify();
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  toggle(id, cx) {
    this.folded.has(id) ? this.folded.delete(id) : this.folded.add(id);
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
    // Native GPUI animates the drawer. One completion callback only suppresses
    // paint after it has closed, including absolute artwork at a zero-height clip.
    this.foldAnimations ??= new Map();
    if (shared("neon.motion") === false || !cx) {
      this.foldAnimations.delete(id);
      return;
    }
    const token = (this.foldToken ?? 0) + 1;
    this.foldToken = token;
    this.foldAnimations.set(id, token);
    cx.timer.after(240, cx => {
      if (this.foldAnimations.get(id) !== token) return;
      this.foldAnimations.delete(id);
      cx.notify();
    });
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  openView() {
    openOverlay({mod: "my-agents", kind: "popup", frame: "none", width: 260, props: {sortMenu: true}});
  }

  chooseView(index) {
    const option = [...SORTS, ...FILTERS][index];
    if (!option) return;
    setShared(index < SORTS.length ? "agents.sort" : "agents.filter", option.id);
    closeOverlay(props().overlay);
  }

  sortMenu(t) {
    const total = SORTS.length + FILTERS.length;
    const optionRow = (option, index, selected, filter = false) => {
      const path = `mods/crew/icons/${option.icon}.svg`;
      const color = filter && option.id !== "all" ? (t[option.id] ?? t.accent) : skin().accent;
      return h_flex().id(`agent-view-${index}`).h(31).px(8).gap(9).items_center().cursor_pointer()
        .border_l(2).border_color(selected ? t.accent : skin().rail)
        .bg(index === this.menuAt ? t.selected : t.background)
        .hover(el => el.bg(t.hover))
        .on_hover((on,cx) => {if(on && this.menuAt !== index) {this.menuAt=index;cx.notify();}})
        .on_click(() => this.chooseView(index))
        .child(svg(path).size(15).flex_none().text_color(selected ? t.accent : color))
        .child(div().flex_1().min_w(0).font_medium().text_color(selected ? skin().foreground : skin().foreground).child(option.label))
        .when(selected,el => el.child(svg("mods/crew/icons/check.svg").size(13).text_color(t.accent)));
    };
    const heading = text => div().px(8).h(24).flex().items_center().text_size(9).font_semibold().text_color(skin().accent).child(text);
    const view = v_flex().id("agent-view-menu").track_focus(this.menuFocus).w_full().p(4).gap(2).bg(t.background).text_size(12)
      .on_key_down((e,cx) => {
        if(e.key === "down") this.menuAt=(this.menuAt+1)%total;
        else if(e.key === "up") this.menuAt=(this.menuAt+total-1)%total;
        else if(e.key === "home") this.menuAt=0;
        else if(e.key === "end") this.menuAt=total-1;
        else if(e.key === "enter" || e.key === "space") this.chooseView(this.menuAt);
        else if(e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();cx.notify();
      })
      .child(heading("SORT"))
      .children(SORTS.map((s,i) => optionRow(s,i,s.id===sortOf().id)))
      .child(div().mx(8).my(4).h(1).bg(t.border))
      .child(heading("STATUS"))
      .children(FILTERS.map((f,i) => optionRow(f,i+SORTS.length,f.id===filterOf().id,true)));
    return panelSkin(view);
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact, nest = 0) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39 + nest)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/crew/icons/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).when(shared("neon.motion") !== false, el => el.spin(900));
    if (a.status === "blocked" && compact) return svg("mods/crew/icons/alert-triangle.svg").size(14).flex_none().text_color(skin().warning);
    if (a.status === "blocked") return div().flex_none().px(6).h(18).bg((skin().warning+"26")).text_size(10.5).font_semibold().text_color(skin().warning).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = skin();
    if (props()?.sortMenu) return this.sortMenu(t);
    this.wantRobots = new Map(); this.drawnRobots = new Set();
    const collapsed = narrow();
    castNew(agents());
    const sort = sortOf();
    const filter = filterOf();
    // Only the machines on the Spaces list's page (all of them on "All").
    let list = agents().filter((a) => inPage(machineKey(a)));
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (filter.id !== "all") list = list.filter(a => this.rank(a) === RANK[filter.id]
      || this.tree(all,a.address).some(s => kidStatus(s.t,this.listed) === filter.id));
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    let rest = list.filter((a) => !a.pinned);
    // Grouped: machines in the order the Spaces list uses, their spaces in list order.
    const keys = byPriority ? [] : orderMachines(rest.map(machineKey));
    const machinesShown = !byPriority && (keys.length > 1 || keys[0] !== LOCAL);
    if (!byPriority) rest = [...rest].sort((x, y) => keys.indexOf(machineKey(x)) - keys.indexOf(machineKey(y)));
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));
    // Rows under a machine header step in a little.
    const nestOf = (a) => 0;
    const foldMotion = shared("neon.motion") !== false;
    const agentWidth = Math.max(158, (find(layout(), "sidebar")?.size?.px ?? 360) - 22);
    const agentHeight = collapsed ? 44 : providerHeight(agentWidth);
    // Artwork and text share a measured card height, including narrow sidebars.
    const artTail = 0;
    const foldBody = (id, entries, open, leading = 7, trailing = 0, stateKey = id) => {
      const fullHeight = entries.length ? leading + trailing + entries.reduce((height, entry) => height + entry.height, 0) + Math.max(0, entries.length - 1) * 7 : 0;
      const inner = v_flex().id(`${id}-content`).relative().top(open ? 0 : -Math.min(10, fullHeight))
        .w_full().h(fullHeight).flex_none().pt(leading).pb(trailing).gap(7).children(entries.map(entry => entry.el))
        .when(!open && (!foldMotion || !this.foldAnimations?.has(stateKey)), el => el.invisible())
        .when(foldMotion, el => el.transition("top", {duration:220,easing:"ease-in-out"}));
      const element = div().id(id).relative().w_full().h(open ? fullHeight : 0).min_h(0).flex_none().overflow_hidden()
        .when(foldMotion, el => el.transition("height", {duration:220,easing:"ease-in-out"})).child(inner);
      return {el:element,height:open ? fullHeight : 0};
    };

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address).filter(s => filter.id === "all" || kidStatus(s.t,this.listed) === filter.id);
      const r = row(a, i, subs);
      if (!subs.length) return {el:r,height:agentHeight};
      const children = subs.map(s => ({el:this.subRow(t,s,shown,byPriority,nestOf(a)),height:26}));
      const body = foldBody(`agent-children-${a.address}`,children,!this.folded.has(a.address),artTail+2,0,a.address);
      return {el:v_flex().id(`agent-family-${a.address}`).w_full().flex_none().child(r).child(body.el),height:agentHeight+body.height};
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.toggle(a.address, cx);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabLabels = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, title(tab, leads.get(tab.id))]));
    const labels = new Map(list.map(a => [a.address, tabLabels.get(a.tab) ?? (a.title || a.program?.name || "")]));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const isPinnedRow = (a) => a.pinned;
    const row = (a, i, subs = []) => {
      // Its robot from the crew, with a stripe in its provider's color.
      const ch = characterOf(a.address), pv = provider(a);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      const shownMachine = machine && !(machinesShown && !isPinnedRow(a)) ? machineLabel(keyOf(machine)) : null;
      if (collapsed) {
        const tone = a.status === "blocked" ? skin().warning : a.status === "working" ? skin().working : a.status === "done" ? skin().done : skin().dim;
        const state = {working:"Working",blocked:"Needs you",done:"Done",idle:"Idle"}[a.status] || a.status;
        return h_flex().id(`ag-${a.address}`).h(44).w_full().flex_none().items_center().justify_center()
          .child(bevel(div().relative().w(32).h(42).flex_none(), a.focused || shown === a.address)
            .tooltip(`${ch.name} · ${pv.name} · ${state}\n${label(a) || a.title || ""}\n${a.space_name || ""}\nRight-click for profile`)
            .hover(s => s.opacity(.85))
            .on_click(() => run("agent.focus", {terminal:a.address}))
            .on_mouse_down("right", (_e,cx) => {cx.stop_propagation();openOverlay({mod:"crew",kind:"dialog",frame:"none",width:620,height:440,props:{profile:a.address}});})
            .child(div().absolute().left(4).top(4).w(24).h(32).child(this.robot(a, foldMotion)))
            .child(div().absolute().right(2).bottom(3).size(5).bg(tone).border_1().border_color(skin().background)
              .when(foldMotion && a.status === "blocked", el => el.loop("opacity",{from:.55,to:1,period:2200}))));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/crew/icons/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      const task = more || name;
      const state = a.status === "blocked" ? "Needs you" : a.status === "working" ? "Working" : a.status === "done" ? "Done" : "Idle";
      const cw = Math.max(158, (find(layout(), "sidebar")?.size?.px ?? 360) - 22);
      const look = providerLook(pv), geometry = providerGeometry(pv,cw);
      const scale = Math.min(1.18,Math.max(1,cw/300));
      const tone = look.onLight ? (a.status === "blocked" ? t.warning : t[a.status] || t.dim) : mix(a.status === "blocked" ? t.warning : t[a.status] || t.dim,"#e6edf7",.35);
      const metadata = [full ? a.space_name : null, shownMachine].filter(Boolean).join(" · ");
      const activity = reportedActivity(a, all, now);
      const showActivity = activity.reported || a.status === "working" || a.status === "blocked";
      return providerFrame(div(), pv, cw)
        .id(`ag-${a.address}`).w_full().h(agentHeight).flex_none().cursor_pointer()
        .tooltip(`${ch.name} · ${pv.name} · ${state}\nConversation: ${task}\nActivity: ${activity.title}\n${metadata}\nRight-click for crew profile`)
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "crew", kind: "dialog", frame: "none", width: 620, height: 480, props: { profile: a.address } }); })
        .child(div().id(`agent-fold-${a.address}`).absolute()
          .left(geometry.portraitX-geometry.portraitHeight*.375).top(geometry.portraitY-geometry.portraitHeight*.5)
          .w(geometry.portraitHeight*.75).h(geometry.portraitHeight)
          .tooltip(subs.length ? "Expand or collapse sub-agents" : `${ch.name} · ${ch.role}`)
          .when(subs.length > 0, el => el.on_click((_e,cx) => {cx.stop_propagation();this.toggle(a.address,cx);cx.notify();}))
          .child(this.robot(a)))
        .child(v_flex().absolute().left(geometry.textLeft).right(geometry.textRight)
          .top(geometry.textTop).bottom(geometry.textBottom).justify_center().gap(3*scale)
          .child(h_flex().h(13*scale).min_w(0).gap(4).items_center()
            .child(div().flex_1().min_w(0).truncate().font_bold().text_size(10.5*scale).text_color(look.onLight?mix(ch.color,"#102030",.57):ch.color).child(ch.name))
            .when(subs.length > 0, el => el.child(fold(a,subs).text_color(look.muted)))
            .when(this.hovered === a.address, el => el.child(pin.text_color(look.muted)))
            .child(div().min_w(0).truncate().text_size(9.5*scale).text_color(tone).tooltip(state)
              .when(a.status === "blocked" && shared("neon.motion") !== false, el => el.loop("opacity",{from:.55,to:1,period:2200}))
              .child(cw<205 ? (a.status==="blocked" ? "Wait" : a.status==="working" ? "Work" : state) : state)))
          .child(h_flex().h(14*scale).min_w(0).gap(3).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(11.5*scale).text_color(idle ? look.muted : look.ink)
              .tooltip(`Conversation: ${task}`).child(task))
            .child(div().id(`rename-chat-${a.address}`).size(13).flex_none().flex().items_center().justify_center().cursor_pointer()
              .text_color(look.accent).hover(el=>el.text_color(look.ink)).tooltip("Rename chat (this tab)")
              .on_mouse_down("left",(_e,cx)=>cx.stop_propagation())
              .on_click((_e,cx)=>{cx.stop_propagation();openOverlay({mod:"neon-rename",kind:"dialog",frame:"none",width:440,height:220,props:{tab:a.tab,name:task}});})
              .child(svg("mods/crew/icons/edit.svg").size(11))))
          .child(div().h(12*scale).min_w(0).truncate().text_size(10.5*scale).text_color(showActivity && activity.reported ? look.accent : look.muted)
            .tooltip(showActivity ? `Activity: ${activity.detail}` : metadata).child(showActivity ? activity.title : metadata))
          .child(h_flex().h(12*scale).min_w(0).gap(4).items_center()
            .when(Boolean(a.program?.icon), el=>el.child(icon(a.program,12*scale,look.accent)))
            .child(div().flex_1().min_w(0).truncate().text_size(10*scale).text_color(look.accent).child(pv.name))
            .when(Boolean(when) && cw>=220, el=>el.child(div().flex_none().text_size(9*scale).text_color(look.dim).child(duration(now-when))))))
        .when(a.focused, el=>el.child(div().absolute().left(geometry.textLeft).right(geometry.textRight).bottom(geometry.height*.16).h(1).bg(look.accent).opacity(.7)));


    };

    // Groups in list order: priority sections, or machines with their spaces under them.
    // Agents of a space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    if (byPriority) {
      for (const a of rest) {
        const r = rankOf(a) || RANK.idle;
        const id = `sec-${r}`;
        if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
        else groups.push({ id, label: SECTION[r], status: SECTION_STATUS[r], members: [a] });
      }
    } else {
      for (const key of keys) {
        const mine = rest.filter((a) => machineKey(a) === key);
        if (machinesShown) groups.push({ id: `mc-${key}`, label: machineLabel(key), status: null, members: mine, machine: key });
        for (const a of mine) {
          const id = `sp-${a.space}`;
          if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
          else groups.push({ id, label: a.space_name || "", status: null, members: [a], under: machinesShown ? key : null });
        }
      }
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      const isMachine = Boolean(g.machine);
      const insets=groupInsets(isMachine ? 32 : 30);
      return groupFrame(h_flex(), open, isMachine ? skin().accent : skin().secondary, isMachine ? 32 : 30)
        .id(g.id)
        .when(agentWidth < 220, el => el.tooltip(`${g.label} · ${g.members.length} agents`))
        .pl(insets.left)
        .pr(insets.right)
        .h(isMachine ? 32 : 30)
        .flex_none()
        .gap(agentWidth < 220 ? 4 : 6)
        .items_center()
        .text_size(11)
        .font_semibold()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          this.toggle(g.id, cx);
          cx.notify();
        })
        .child(groupWell(svg(`mods/crew/icons/${isMachine ? (g.machine === LOCAL ? "monitor" : "server") : "layers"}.svg`).size(isMachine ? 15 : 13).text_color(isMachine ? skin().accent : skin().muted)))
        .child(div().flex_1().min_w(0).truncate().text_color(isMachine ? skin().foreground : (t[g.status] ?? skin().foreground)).child(g.label))
        .when(agentWidth >= 220 && (byPriority || isMachine || !open), (el) => el.child(groupWell(div().text_size(9).text_color(skin().muted).child(String(g.members.length)),20,18)))
        .when(!open && !byPriority && top && top !== "idle", (el) => el.child(groupWell(this.status(t, { status: top }, true),16,18).tooltip(top === "working" ? "Working" : top === "blocked" ? "Needs you" : "Done")))
        .child(groupWell(svg(`mods/crew/icons/chevron-${open ? "down" : "right"}.svg`).size(12).text_color(skin().accent),20,18).ml(14));
    };
    const groupNode = g => {
      const members = g.members.map((a,i) => withKids(a,i));
      const body = foldBody(`agent-group-${g.id}`,members,!this.folded.has(g.id),7,artTail,g.id);
      return {el:v_flex().id(`agent-section-${g.id}`).w_full().flex_none().child(header(g)).child(body.el),height:30+body.height};
    };
    let rows;
    if (collapsed) rows = list.map((a,i) => withKids(a,i).el);
    else {
      rows = [];
      for (let index=0;index<groups.length;index++) {
        const group = groups[index];
        if (!group.machine) {
          rows.push(groupNode(group).el);
          continue;
        }
        // Keep space/card subtrees mounted inside the machine's clipped body.
        // Their calculated layout closes upward beneath the header instead of vanishing.
        const children = [];
        while (groups[index+1]?.under === group.machine) children.push(groupNode(groups[++index]));
        const body = foldBody(`agent-machine-${group.machine}`,children,!this.folded.has(group.id),7,0,group.id);
        rows.push(v_flex().id(`agent-machine-section-${group.machine}`).w_full().flex_none().child(header(group)).child(body.el));
      }
    }

    return v_flex().relative()
      .size_full()
      .min_h(0)
      .bg((skin().light ? skin().chrome : skin().chrome+"60"))
      .border_t(0)
      .border_color(skin().edge)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(40)
            .flex_none()
            .items_center()
            .justify_between()
            .gap(8)
            .child(div().flex_1().min_w(0).truncate().text_size(11).font_semibold().text_color(skin().accent).child(currentPage() ? `AGENTS · ${currentPage().name}` : "AGENTS"))
            .child(
              bevel(h_flex().id("ag-sort").h(26).px(8).gap(5).items_center().flex_none(),filter.id!=="all",groupControlPalette(t))
                .text_size(11)
                .font_semibold().text_color(filter.id!=="all" ? t.accent : skin().muted)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => this.openView())
                .tooltip(`Agent view · ${sort.label} · ${filter.label}\nIncludes matching sub-agents`)
                .child(div().child(filter.id === "all" ? "View" : filter.label))
                .child(svg("mods/crew/icons/chevron-down.svg").size(12)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(v_flex().px(12).gap(8).text_size(12).text_color(t.dim)
          .child(filter.id === "all" ? "No agent status yet. Agents appear when they report their status." : `No ${filter.label.toLowerCase()} agents on this page.`)
          .when(filter.id !== "all", el => el.child(bevel(h_flex().id("agents-clear-filter").h(28).px(10).items_center())
            .text_color(t.accent).on_click(() => setShared("agents.filter","all")).child("Show all agents")))),
      )
      .when(collapsed, el => el.child(h_flex().h(30).flex_none().pr(4).items_center().justify_center()
        .child(div().id("compact-agent-view").w(28).h(22).flex().items_center().justify_center().cursor_pointer()
          .tooltip(`Agents · ${list.length} shown\n${filter.label} · Click for view options`).on_click(() => this.openView())
          .child(svg("mods/crew/robot.svg").size(15).text_color(skin().accent)))))
      .child(v_flex().id("ag-list").flex_1().min_h(0).pl(collapsed ? 0 : 10).pr(collapsed ? 4 : 12).gap(collapsed ? 4 : 7).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      )
      .child(div().absolute().right(0).top(0).bottom(0).w(4).bg(skin().rail))
      .child(div().absolute().right(1).top(0).bottom(0).w(1).bg(skin().shine))
      .child(div().absolute().right(4).top(40).w(1).h(34).bg(skin().accent))
      .child(sectionSeparator());
  }
}
