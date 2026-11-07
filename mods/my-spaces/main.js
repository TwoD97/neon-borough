import { skin, art, artText, luminance } from "./theme-tokens.js";
import { panelSkin } from "./panel-skin.js";
import { bevel } from "./controls.js";
import { spaceFrame, spaceGeometry } from "./space-skin.js";
import { groupFrame, groupWell, groupInsets } from "./group-skin.js";
import { HOUSE_ART } from "./house-art.js";
// Workspace spaces (customized): stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. Machines carry a display name and an
// order of your own (shared with the agents list): drag a header to reorder, right-click
// it to rename, move or fold. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder. Pages: tabs over the list, each showing
// the machines put on it (right-click a machine, or edit the page); the agents list follows.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, closeOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";
import { LOCAL, keyOf, machineOf, label, names, rename, ordered as orderMachines, place as placeMachine, move as moveMachine,
  pages, currentPage, inPage, savePage, newPageId, deletePage, movePage, togglePageMachine } from "./machines.js";
import { ICONS } from "./icons.js";

// A space's icon (Pixelarticons, in icons/pixelart/), chosen in the picker; stored as shared "space.icons".
const ICON_DIR = "mods/my-spaces/icons/pixelart";
const spaceIcons = () => shared("space.icons") ?? {};

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

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 60 : 68);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    const op = props() ?? {};
    if (op.machineMenu || op.rename || op.iconPicker || op.pageMenu || op.pageEdit) return this.initOverlay(cx);
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.dragMachine = null; // a machine header being dragged (its key)
    this.overMachine = null; // the machine it's over
    this.keys = [LOCAL]; // machine keys as listed, in order
    // Folds live in shared state so the machine menu (another copy) can change them.
    if (shared("my-spaces.folded") == null) {
      const old = JSON.parse(localStorage.getItem("machines.folded") ?? "[]");
      if (old.length) this.setFolded(new Set(old.map(keyOf)));
    }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      const folded = this.folded;
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !folded.has(keyOf(JSON.parse(k)[0])) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.unfold(name);
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "my-menu", kind: "popup", frame: "none", width: 300, height: 340, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─", parentName: r.w.name, parentId: r.w.id }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // Folded machines (keys), shared so every copy of this mod sees the same.
  get folded() {
    return new Set(shared("my-spaces.folded") ?? []);
  }

  setFolded(set) {
    setShared("my-spaces.folded", [...set]);
  }

  toggleFold(key) {
    const f = this.folded;
    f.has(key) ? f.delete(key) : f.add(key);
    this.setFolded(f);
  }

  unfold(machine) {
    const f = this.folded;
    if (f.delete(keyOf(machine))) this.setFolded(f);
  }

  // A machine header was let go over `key`: reorder, or (on itself) fold.
  dropMachine(key, toggle) {
    const from = this.dragMachine;
    this.dragMachine = null;
    this.overMachine = null;
    if (from === null) return;
    if (from === key) { if (toggle) this.toggleFold(key); }
    else placeMachine(from, key, this.keys);
  }

  machineMenu(key) {
    openOverlay({ mod: "my-spaces", kind: "popup", frame: "none", width: 270, height: 330 + (pages().length ? 9 + 31 * pages().length : 0), props: { machineMenu: key, keys: this.keys } });
  }

  toggleWorktrees(id) {
    const folded = new Set(shared("my-spaces.worktrees.folded") ?? []);
    folded.has(id) ? folded.delete(id) : folded.add(id);
    setShared("my-spaces.worktrees.folded", [...folded]);
  }

  // A top-anchored track keeps the parent and sibling positions stable when a
  // nested drawer changes height. A short retract avoids the whole stack jumping.
  drawer(id, children, height, open) {
    return div().id(id).relative().min_w(0).h(open ? height : 0).flex_none().overflow_hidden()
      .when(shared("neon.motion") !== false, el => el.transition("height", {duration: 220, easing: "ease-in-out"}))
      .child(v_flex().id(`${id}-track`).absolute().left(0).right(0).top(open ? 0 : -10).h(height).pt(5).gap(5)
        .when(shared("neon.motion") !== false, el => el.transition("top", {duration: 220, easing: "ease-in-out"}))
        .children(children));
  }

  spaceCards(rows, t, compact) {
    if (compact) return { cards: rows.map(r => this.compact(r, t)), height: rows.length * 36 + Math.max(0, rows.length - 1) * 5 };
    const folded = new Set(shared("my-spaces.worktrees.folded") ?? []);
    const cards = [];
    let height = 0;
    for (let i = 0; i < rows.length; i++) {
      const parent = rows[i];
      const kids = [];
      while (rows[i + 1]?.parentId === parent.w.id) kids.push(rows[++i]);
      const open = !folded.has(parent.w.id);
      const childHeight = kids.reduce((h, r) => h + rowHeight(r) + 5, 0);
      const card = this.row({...parent, childCount: kids.length, treeOpen: open}, t);
      cards.push(kids.length ? v_flex().id(`tree-family-${parent.w.id}`).min_w(0).flex_none()
        .child(card).child(this.drawer(`tree-drawer-${parent.w.id}`, kids.map(r => this.row(r, t)), childHeight, open)) : card);
      height += rowHeight(parent) + (kids.length && open ? childHeight : 0);
    }
    return {cards, height: height + Math.max(0, cards.length - 1) * 5};
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])];
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : this.spaceCards(rows, t, collapsed).cards;
    this.keys = orderMachines([LOCAL, ...remote.map(keyOf)]);
    const page = currentPage();
    const keys = this.keys.filter((k) => inPage(k, page));
    if (!keys.length) {
      return [v_flex().id("page-empty").px(8).py(14).gap(8).text_size(12).text_color(t.dim)
        .child(div().child(collapsed ? "…" : `No machines on "${page.name}" yet.`))
        .when(!collapsed, (el) => el.child(div().id("page-empty-edit").text_color(t.muted).cursor_pointer().hover((st) => st.text_color(t.foreground))
          .on_click(() => this.editPage(page.id)).child("Choose machines…")))];
    }
    const foldedSet = this.folded;
    const dragging = this.dragMachine !== null;
    const fromIndex = dragging ? keys.indexOf(this.dragMachine) : -1;
    // A control inside the header must not start a drag or fold the machine.
    const still = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
    const compactHeader = (find(layout(), "sidebar")?.size?.px ?? 268) < 242;
    const insets=groupInsets(30);
    return keys.flatMap((key, ki) => {
      const m = machineOf(key);
      const mine = rows.filter((r) => keyOf(r.w.machine) === key);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = foldedSet.has(key);
      // Folded: how many spaces, and the most urgent thing in them.
      const top = mine.reduce((best, r) => ((RANK[r.w.status] ?? 0) > (RANK[best] ?? 0) ? r.w.status : best), null);
      const head = (collapsed ? h_flex().relative().justify_center() : groupFrame(h_flex(), !folded, connected ? skin().accent : skin().dim)).id(`machine-${key}`).h(collapsed ? 25 : 30).flex_none().pl(collapsed ? 0 : insets.left).pr(collapsed ? 0 : insets.right).gap(compactHeader ? 2 : 7).items_center().text_size(11).text_color(t.muted)
        .when(collapsed, el => el.tooltip(`${label(key)} · ${mine.length} spaces\n${folded ? "Expand" : "Collapse"} · Right-click for machine actions`))
        .when(!collapsed && compactHeader, el => el.tooltip(`${label(key)} · ${mine.length} spaces · ${connected ? "Connected" : "Disconnected"}`))
        .cursor_pointer().hover(s => s.text_color(t.foreground))
        .when(dragging && this.dragMachine === key && this.overMachine !== key, el => el.opacity(0.5))
        .when(dragging && this.overMachine === key && this.dragMachine !== key, el => el.child(
          div().absolute().left(0).right(0).h(2).bg(t.accent)
            .when(fromIndex < ki, line => line.bottom(0))
            .when(fromIndex > ki, line => line.top(0)),
        ))
        .on_mouse_down("left", () => { this.dragMachine = key; this.overMachine = key; })
        .on_mouse_move((_e, cx) => {
          if (this.dragMachine !== null && this.overMachine !== key) { this.overMachine = key; cx.notify(); }
        })
        .on_mouse_up("left", (_e, cx) => { this.dropMachine(key, true); cx.notify(); })
        .on_mouse_down("right", () => this.machineMenu(key))
        .child(groupWell(svg(`mods/crew/icons/${m ? "server" : "monitor"}.svg`).size(collapsed ? 13 : 15).text_color(connected ? skin().accent : skin().muted),collapsed ? 28 : 22,20)
          .when(collapsed, el => el.child(div().absolute().left(7).right(7).bottom(0).h(1).bg(folded ? skin().dim : skin().accent))))
        .when(!collapsed, el => el.child(div().flex_1().min_w(0).truncate().font_semibold().text_color(skin().foreground).child(label(key)))
          .when(mine.length > 0 && !compactHeader, el => el.child(groupWell(div().text_size(9).text_color(skin().muted).tooltip(`${mine.length} spaces`).child(String(mine.length)),20,18)))
          .when(folded && top && top !== "idle", el => el.child(groupWell(top === "working" ? svg("mods/crew/icons/spinner.svg").size(12).text_color(t.working).when(shared("neon.motion") !== false, el => el.spin(900)) : div().size(6).rounded(3).bg(t[top] ?? t.dim),16,18).tooltip(top === "working" ? "Working" : top === "blocked" ? "Needs you" : "Done")))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(still(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted))
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(still(div().id(`machine-add-${key}`).flex_none().px(compactHeader ? 3 : 4).rounded(4)).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .when(!compactHeader, el => el.child(div().w(3).h(10).flex_none().bg(connected ? t.accent : t.dim).tooltip(connected ? "Connected" : "Disconnected")))
          .child(groupWell(svg(`mods/crew/icons/chevron-${folded ? "right" : "down"}.svg`).size(12).text_color(skin().accent),20,18).ml(compactHeader ? 10 : 12)));
      const empty = h_flex().id(`machine-new-${key}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg("mods/crew/icons/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      if (!collapsed && rebuilt) return [head];
      const body = mine.length ? this.spaceCards(mine, t, collapsed) : {cards: [loading(m) ? loadingRow(m) : empty], height: 28};
      return [v_flex().id(`machine-family-${key}`).min_w(0).flex_none().child(head)
        .child(this.drawer(`machine-drawer-${key}`, body.cards, body.height + 5, !folded))];
    });
  }

  // ---- The machine menu and the rename dialog: this mod opened as a popup or dialog.

  initOverlay(cx) {
    const p = props();
    this.at = 0;
    this.handle = cx.focus_handle();
    if (p.iconPicker) {
      this.query = "";
      this.input = InputState.new({ value: "" });
      this.input.on("change", (_e, cx) => { this.query = this.input.value(); cx.notify(); });
      this.input.on("submit", () => { const first = this.matches()[0]; if (first) this.pickIcon(first); });
      this.inputFocused = true;
      this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
      this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
      return;
    }
    if (p.pageEdit) {
      const page = pages().find((x) => x.id === p.pageEdit);
      this.text = page?.name ?? "";
      this.picked = new Set(page?.machines ?? []);
      this.input = InputState.new({ value: this.text, placeholder: "Work, Servers, Customer X…" });
      if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
      this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
      this.input.on("submit", () => this.savePageEdit());
      this.inputFocused = true;
      this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
      this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
      return;
    }
    if (p.rename) {
      this.text = names()[p.rename] ?? "";
      this.input = InputState.new({ value: this.text });
      if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
      this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
      this.input.on("submit", () => this.saveName());
      this.inputFocused = true;
      this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
      this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    } else this.handle.focus();
  }

  saveName() {
    rename(props().rename, this.text);
    closeOverlay(props().overlay);
  }

  // [label, icon, action (null: can't now), divider above]
  menuItems() {
    if (props().pageMenu) {
      const id = props().pageMenu, list = pages(), i = list.findIndex((x) => x.id === id);
      return [
        ["Edit page…", "square-pen", () => this.editPage(id)],
        ["Move left", "chevron-left", i > 0 ? () => movePage(id, -1) : null, true],
        ["Move right", "chevron-right", i >= 0 && i < list.length - 1 ? () => movePage(id, 1) : null],
        ["Delete page", "x", () => deletePage(id), true],
      ];
    }
    const { machineMenu: key, keys = [LOCAL] } = props();
    const list = orderMachines(keys);
    const i = list.indexOf(key);
    const others = list.filter((k) => k !== key);
    const folded = this.folded;
    const real = key === LOCAL ? "This computer" : key;
    const items = [["Rename…", "square-pen", () => openOverlay({ mod: "my-spaces", kind: "dialog", width: 400, height: 230, props: { rename: key } })]];
    if (names()[key]) items.push([`Real name again (${real})`, "x", () => rename(key, "")]);
    items.push(["Move up", "arrow-up", i > 0 ? () => moveMachine(key, -1, keys) : null, true]);
    items.push(["Move down", "arrow-down", i >= 0 && i < list.length - 1 ? () => moveMachine(key, 1, keys) : null]);
    items.push(["New space here", "plus", () => run("space.new", { machine: machineOf(key) ?? "" }), true]);
    if (folded.has(key)) items.push(["Unfold", "chevron-down", () => this.toggleFold(key)]);
    else items.push(["Fold", "chevron-right", () => this.toggleFold(key)]);
    items.push(others.some((k) => !folded.has(k))
      ? ["Fold the other machines", "layers", () => this.setFolded(new Set(others))]
      : ["Unfold all machines", "layers", () => this.setFolded(new Set())]);
    pages().forEach((pg, n) => items.push([`On page ${pg.name}`, pg.machines.includes(key) ? "circle-check" : "square", () => togglePageMachine(pg.id, key), n === 0]));
    return items;
  }

  menuView(t) {
    const items = this.menuItems();
    const choose = (i) => { const it = items[i]; if (!it?.[2]) return; closeOverlay(props().overlay); it[2](); };
    const icon = (name) => (name.startsWith("arrow") ? `mods/my-spaces/${name}.svg` : `mods/workspace-chrome/${name}.svg`);
    const view = v_flex().id("machine-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % items.length;
        else if (e.key === "up") this.at = (this.at + items.length - 1) % items.length;
        else if (e.key === "enter") choose(this.at);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(props().pageMenu ? `Page ${pages().find((x) => x.id === props().pageMenu)?.name ?? ""}` : label(props().machineMenu)))
      .children(items.map((it, i) => v_flex()
        .when(Boolean(it[3]), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`mm-${i}`).h(31).px(8).gap(9).border_l(2).border_color(i === this.at ? t.accent : skin().border).items_center()
          .text_color(it[2] ? t.foreground : t.dim)
          .when(i === this.at && Boolean(it[2]), el => el.bg(t.selected))
          .when(Boolean(it[2]), el => el.hover(s => s.bg(t.hover)).on_click(() => choose(i)))
          .child(svg(icon(it[1])).size(14).flex_none().text_color(it[2] ? t.muted : t.dim))
          .child(div().flex_1().min_w(0).truncate().tooltip(it[0]).child(it[0])))));
    return panelSkin(view);
  }

  // ---- The icon picker (props.iconPicker: a space id).

  matches() {
    const words = (this.query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    return ICONS.filter((n) => words.every((w) => n.includes(w)));
  }

  pickIcon(name) {
    const id = props().iconPicker;
    const all = { ...spaceIcons() };
    if (name) all[id] = name;
    else delete all[id];
    setShared("space.icons", all);
    closeOverlay(props().overlay);
  }

  pickerView(t) {
    const id = props().iconPicker;
    const space = spaces().find((s) => s.id === id);
    const cur = spaceIcons()[id] ?? null;
    const color = (shared("space.colors") ?? {})[id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (t[color] ?? MARK[color]);
    const light = luminance(fill), darkInk = "#142331";
    const badgeInk = (light+.05)/(luminance(darkInk)+.05) >= 1.05/(light+.05) ? darkInk : "#ffffff";
    const all = this.matches();
    const shown = all.slice(0, 300);
    const letter = [...(space?.name ?? "?")][0]?.toUpperCase() ?? "?";
    const tile = (icon) => h_flex().size(22).flex_none().rounded(6).bg(fill).items_center().justify_center().text_size(12).font_bold().text_color(badgeInk)
      .child(icon ? svg(`${ICON_DIR}/${icon}.svg`).size(16).flex_none().text_color(badgeInk) : letter);
    const cell = (name) => div().id(`ic-${name}`).size(34).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .when(name === cur, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover)).tooltip(name)
      .on_click(() => this.pickIcon(name))
      .child(svg(`${ICON_DIR}/${name}.svg`).size(18).flex_none().text_color(t.foreground));
    return v_flex().id("icon-picker").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .w_full().h_full().min_h(0).p(16).gap(10).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().gap(10)
        .child(tile(cur))
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(`Icon for ${space?.name ?? "this space"}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(Input.new(this.input).h(34).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(h_flex().items_center().justify_between().text_size(11).text_color(t.dim)
        .child(div().child(this.query ? `${all.length} of ${ICONS.length} icons${all.length > shown.length ? `, the first ${shown.length} shown` : ""}` : `${ICONS.length} icons: type to search, Enter takes the first`))
        .when(Boolean(cur), (el) => el.child(div().id("icon-clear").cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => this.pickIcon(null)).child("Use the letter again"))))
      .child(div().id("icon-grid").flex_1().min_h(0).overflow_y_scrollbar().child(h_flex().flex_wrap().gap(2).children(shown.map(cell))))
      .child(div().text_size(10.5).text_color(t.dim).child("Pixelarticons by Gerrit Halfmann, MIT"));
  }

  // ---- Pages.

  editPage(id) {
    openOverlay({ mod: "my-spaces", kind: "dialog", width: 420, height: 250 + 34 * (this.keys?.length ?? 1), props: { pageEdit: id, keys: this.keys ?? [LOCAL] } });
  }

  newPage() {
    const id = newPageId();
    this.editPage(id);
  }

  savePageEdit() {
    const id = props().pageEdit, name = (this.text ?? "").trim();
    if (!name) return;
    savePage({ id, name, machines: [...this.picked] });
    setShared("machines.page", id);
    closeOverlay(props().overlay);
  }

  // Shows a page; if the space on screen isn't on it, goes to the one used there last.
  switchPage(id) {
    if ((shared("machines.page") ?? null) === id) return;
    setShared("machines.page", id);
    const page = pages().find((x) => x.id === id) ?? null;
    const fits = (sp) => inPage(keyOf(sp.machine), page);
    const sp = spaces(), on = sp.find((x) => x.active);
    if (on && fits(on)) return;
    const last = (shared("machines.pageSpace") ?? {})[id ?? "all"];
    const target = sp.find((x) => x.id === last && fits(x)) ?? sp.find(fits);
    if (target) run("space.select", { id: target.id });
  }

  // Remembers the space in use per page.
  notePageSpace() {
    const on = spaces().find((x) => x.active);
    const key = shared("machines.page") ?? "all";
    if (!on || !inPage(keyOf(on.machine))) return;
    const seen = shared("machines.pageSpace") ?? {};
    if (seen[key] !== on.id) setShared("machines.pageSpace", { ...seen, [key]: on.id });
  }

  pageBar(t) {
    const list = pages(), cur = currentPage();
    if (!list.length) return null;
    const count = (pg) => spaces().filter((x) => inPage(keyOf(x.machine), pg)).length;
    const chip = (id, name, pg) => {
      const on = (cur?.id ?? null) === id;
      return h_flex().id(`page-${id ?? "all"}`).h(24).px(9).gap(5).flex_none().items_center().rounded(6).text_size(12)
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).border_1().border_color(on ? t.input : t.chrome)
        .cursor_pointer().hover((st) => st.bg(t.hover))
        .on_click(() => this.switchPage(id))
        .when(Boolean(id), (el) => el.on_mouse_down("right", () => openOverlay({ mod: "my-spaces", kind: "popup", frame: "none", width: 250, height: 214, props: { pageMenu: id } })))
        .child(div().max_w(120).truncate().child(name))
        .child(div().text_size(10.5).text_color(t.dim).child(String(count(pg))));
    };
    return h_flex().id("pages").flex_none().flex_wrap().px(10).pb(6).gap(4).items_center()
      .child(chip(null, "All", null))
      .children(list.map((pg) => chip(pg.id, pg.name, pg)))
      .child(div().id("page-new").size(24).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
        .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("New page").on_click(() => this.newPage())
        .child(svg("mods/crew/icons/plus.svg").size(12)));
  }

  pageEditView(t) {
    const id = props().pageEdit, keys = props().keys ?? [LOCAL];
    const exists = pages().some((x) => x.id === id);
    const button = (bid, text, kind, action) => h_flex().id(bid).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(kind === "primary" ? t.solid : t.input).bg(kind === "primary" ? t.solid : t.raised)
      .text_color(kind === "primary" ? t.solid_foreground : kind === "danger" ? t.ansi1 : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((st) => st.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("page-edit").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(exists ? "Edit page" : "New page"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child("Machines on this page (a machine can be on several)"))
      .child(v_flex().gap(2).children(keys.map((k) => {
        const on = this.picked.has(k);
        return h_flex().id(`pe-${k}`).h(32).px(8).gap(9).items_center().rounded(7).cursor_pointer().hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => { on ? this.picked.delete(k) : this.picked.add(k); cx.notify(); })
          .child(h_flex().size(16).flex_none().items_center().justify_center().rounded(4).border_1().border_color(on ? t.accent : t.input).when(on, (el) => el.bg(t.accent).child(svg("mods/crew/icons/check.svg").size(11).text_color(t.background))))
          .child(svg(`mods/workspace-chrome/${k === LOCAL ? "monitor" : "server"}.svg`).size(13).flex_none().text_color(t.muted))
          .child(div().flex_1().truncate().child(label(k)))
          .when(label(k) !== (k === LOCAL ? "This computer" : k), (el) => el.child(div().text_size(11).text_color(t.dim).child(k === LOCAL ? "This computer" : k)));
      })))
      .child(h_flex().pt(18).gap(8).items_center()
        .when(exists, (el) => el.child(button("pe-delete", "Delete page", "danger", () => { deletePage(id); closeOverlay(props().overlay); })))
        .child(div().flex_1())
        .child(button("pe-cancel", "Cancel", "plain", () => closeOverlay(props().overlay)))
        .child(button("pe-save", exists ? "Save" : "Add page", "primary", () => this.savePageEdit())));
  }

  renameView(t) {
    const key = props().rename;
    const real = key === LOCAL ? "This computer" : key;
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("rename-machine").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Rename machine"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(`Shown instead of "${real}"`))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(6).text_size(11.5).text_color(t.dim).child("Only the name on screen changes; ssh and hc keep the real one. Empty: the real name again."))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("rn-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("rn-save", "Save", true, () => this.saveName())));
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_start()
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .child(svg("mods/crew/icons/branch.svg").size(11).flex_none())
      .child(div().flex_1().min_w(0).truncate().tooltip(where || raw).child(where || raw))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree, parentName, childCount = 0, treeOpen = true }, t) {
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (t[color] ?? MARK[color]);
    const light = luminance(fill), darkInk = "#142331";
    const badgeInk = (light+.05)/(luminance(darkInk)+.05) >= 1.05/(light+.05) ? darkInk : "#ffffff";
    const icon = spaceIcons()[w.id];
    const width=Math.max(132,(find(layout(), "sidebar")?.size?.px ?? 268)-22-(tree?26:0));
    const frame=spaceGeometry(width,Boolean(tree));
    const ink={...t,...frame.ink};
    const card = spaceFrame(v_flex().id(`space-${w.id}`).h(rowHeight({ tree })).flex_1().min_w(0).justify_center(), on, t.accent, width, Boolean(tree))
      .tooltip(`${w.name}\n${tree ? `Worktree of ${parentName}\n` : ""}${g ? [g.name,g.branch].filter(Boolean).join(" · ") : w.folder || "Workspace"}\nRight-click for space actions · Drag to reorder`)
      .when(!on, (el) => el.hover((st) => st.opacity(0.88)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        // A machine header dragged over this row lands on this row's machine.
        if (this.dragMachine !== null) {
          const k = keyOf(w.machine);
          if (this.overMachine !== k) { this.overMachine = k; cx.notify(); }
          return;
        }
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        if (this.dragMachine !== null) { this.dropMachine(keyOf(w.machine), false); cx.notify(); return; }
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(div().absolute().left(frame.socketX-frame.height*.33).top(frame.socketY-frame.height*.33).child(this.portrait(w, fill, frame.height*0.66, tree, true)))
      .child(h_flex().pl(frame.textLeft).pr(frame.textRight).items_center().min_w(0)
        .child(v_flex().flex_1().min_w(0).gap(4).line_height(1.1)
          .child(h_flex().min_w(0).gap(6).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(tree ? 12 : 13).font_semibold().text_color(ink.foreground).child(w.name))
            .when(width>=220 && !childCount,el=>el.child(h_flex().flex_none().gap(3).items_center().text_size(9).text_color(ink.dim)
              .tooltip(`${w.tabs?.length ?? 0} tabs`)
              .child(svg("mods/crew/icons/layers.svg").size(10))
              .child(String(w.tabs?.length ?? 0))))
            .when(childCount > 0, el => el.child(h_flex().id(`tree-toggle-${w.id}`).h(22).w(20).items_center().justify_center().flex_none().cursor_pointer().hover(st=>st.opacity(.65))
              .text_size(9).text_color(skin().accent).tooltip(`${treeOpen ? "Collapse" : "Expand"} ${childCount} worktree${childCount === 1 ? "" : "s"}`)
              .on_mouse_down("left", (_e,cx) => cx.stop_propagation())
              .on_mouse_up("left", (_e,cx) => cx.stop_propagation())
              .on_click((_e,cx) => {cx.stop_propagation();this.toggleWorktrees(w.id);cx.notify();})
              .child(svg(`mods/crew/icons/chevron-${treeOpen ? "down" : "right"}.svg`).size(13)))))
          .child(g ? this.gitTail(g, tree, w.name, ink) : div().truncate().text_size(10.5).text_color(ink.dim).child(w.folder || "Workspace"))));
    if (!tree) return h_flex().h(rowHeight({tree})).flex_none().min_w(0).child(card);
    // The connector occupies its own gutter; it never covers the child chassis or text.
    const rail = on ? skin().accent : skin().edge;
    return h_flex().relative().h(rowHeight({tree})).flex_none().min_w(0).pl(26)
      .child(div().absolute().left(11).top(-5).w(1).h(tree === "└─" ? 35 : 65).bg(rail))
      .child(div().absolute().left(11).top(30).w(15).h(1).bg(rail))
      .child(div().absolute().left(10).top(29).size(3).bg(on ? t.accent : t.edge))
      .child(card);
  }

  portrait(w, color, size, tree = false, socket = false) {
    const selected = spaceIcons()[w.id];
    const house = HOUSE_ART[(shared("town.houses.v2") ?? {})[w.id]];
    const emblem = div().relative().size(size).flex_none()
      .when(!socket,el=>el.child(image(art("mods/my-spaces/art/space-emblem.png")).absolute().top(0).left(0).size(size)));
    if (selected || tree) {
      emblem.child(svg(tree ? "mods/my-spaces/art/worktree-mark.svg" : `${ICON_DIR}/${selected}.svg`).absolute().top(size*(tree ? .18 : .23)).left(size*(tree ? .18 : .23)).size(size*(tree ? .64 : .54)).text_color(tree?skin().secondary:color));
    } else if (house) {
      const scale = size*0.7/Math.max(house.w,house.h);
      const w = house.w*scale, h = house.h*scale;
      emblem.child(image(house.file).absolute().left((size-w)/2).top((size-h)/2).w(w).h(h));
    } else {
      emblem.child(div().absolute().top(0).left(0).size(size).flex().items_center().justify_center().text_size(size*0.38).font_bold().text_color(color).child([...w.name][0]?.toUpperCase() || "?"));
    }
    return emblem;
  }

  compact({ w, i }, t) {
    return h_flex().relative().id(`space-${w.id}`).h(36).flex_none().justify_center().items_center()
      .tooltip(`${i+1} · ${w.name}`)
      .when(w.active, el => el.child(div().absolute().left(1).top(7).bottom(7).w(2).bg(t.accent)))
      .hover(st => st.opacity(0.8)).on_click(() => run("space.select",{id:w.id}))
      .on_mouse_down("right", () => this.menu(w))
      .child(this.portrait(w,t.accent,30));
  }

  render() {
    const t = skin();
    const p = props() ?? {};
    if (p.machineMenu || p.pageMenu) return this.menuView(t);
    if (p.pageEdit) return this.pageEditView(t);
    if (p.rename) return this.renameView(t);
    if (p.iconPicker) return this.pickerView(t);
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    this.notePageSpace();
    return v_flex().relative().size_full().min_h(0).overflow_hidden().bg(t.light?t.chrome:t.chrome+"60").text_size(13)
      .child(h_flex().h(40).flex_none().pl(collapsed ? 6 : 14).pr(collapsed ? 6 : 12).gap(4).items_center().justify_between().text_size(11).text_color(t.muted)
        .when(!collapsed, el => el.child(div().font_semibold().text_color(t.accent).child("SPACES")))
        .when(!collapsed, el => el.child(div().flex_1()).child(bevel(div().id("page-add").size(26).flex_none().flex().items_center().justify_center())
          .hover(s => s.opacity(0.85).text_color(t.foreground)).tooltip("New page: a tab with the machines you choose")
          .on_click(() => this.newPage()).child(svg("mods/crew/icons/layers.svg").size(13))))
        .when(!collapsed, el => el.child(bevel(div().id("crew-open").size(26).flex_none().flex().items_center().justify_center())
          .hover(s => s.opacity(0.85).text_color(t.foreground)).tooltip("Open Crew town")
          .on_click(() => run("layout.select", { stack: "root", child: "crew-screen" }))
          .child(svg("mods/crew/robot.svg").size(15))))
        .child(bevel(div().id("space-new").size(26).flex_none().flex().items_center().justify_center()).hover(s => s.opacity(0.85).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/crew/icons/plus.svg").size(14))))
      .when(!collapsed && pages().length > 0, el => el.child(this.pageBar(t)))
      .child(v_flex().flex_1().min_h(0).pl(collapsed ? 0 : 10).pr(collapsed ? 4 : 12).pb(10).gap(5).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; this.dragMachine = null; this.overMachine = null; cx.notify(); })
        .children(this.grouped(t, collapsed)))
      .child(div().absolute().right(0).top(0).bottom(0).w(4).bg(skin().border))
      .child(div().absolute().right(1).top(0).bottom(0).w(1).bg(skin().edge))
      .child(div().absolute().right(4).top(40).w(1).h(34).bg(skin().accent));
  }
}
