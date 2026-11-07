import { skin, artText, mix } from "./theme-tokens.js";
// The tab bar (clone of the shipped "tabs" mod), plus a PRs button for the pr-hub panel.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";
import { bevel, headerFrame, keycap } from "./controls.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.compact = false;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = skin();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => keycap(div().id(id).size(this.compact ? 26 : 28).flex_none().flex().items_center().justify_center()).text_color(artText("mods/crew/art/control-keycap.png").muted).tooltip({"tab-new":"New terminal or agent",minimize:"Minimize",maximize:"Maximize or restore","close-window":"Close window"}[id] || id).hover(s => s.text_color(id === "close-window" ? skin().danger : t.accent))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = !c.named && /^(tb)?\d+$/.test(c.name) ? program?.name ?? `Terminal ${i + 1}` : c.name;
      return bevel(h_flex().id(`tab-${c.id}`).h(30).min_w(this.compact ? 92 : 120).px(11).gap(8).items_center().flex_none(), c.active).text_size(12)
        .text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.opacity(0.86))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) openOverlay({mod:"neon-rename",kind:"dialog",frame:"none",width:440,height:220,props:{tab:c.id,name}}); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "my-menu", kind: "popup", frame: "none", width: 300, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().flex_1().min_w(0).max_w(this.compact ? 100 : 190).truncate().tooltip(name).child(c.zoomed ? `${name} · Zoom` : name))
        .when(c.status === "working", el => el.child(svg("mods/crew/icons/spinner.svg").size(12).flex_none().text_color(t.working).when(shared("neon.motion") !== false, e => e.spin(1100))))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(5).bg(c.status === "blocked" ? skin().warning : t.done)))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/crew/icons/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    // Files and Changes are always offered here, even when the welcome saved no panels.
    const enabled = [...new Set([...(shared("workspace.panels") ?? []), "files", "changes", "prs"])].filter(id => id !== "crew");
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return bevel(h_flex().id(`panel-${id}`).h(28).px(9).gap(6).flex_none().items_center(), on)
        .text_size(12).text_color(on ? t.accent : t.muted).tooltip(label)
        .hover(s => s.opacity(0.86)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).when(!this.compact, el => el.child(label));
    };
    const bar = h_flex().size_full().min_w(0).px(12).pl(lightsPadding).gap(8).items_center()
      .on_size_change((size, cx) => { const compact = size.width / (settings().zoom || 1) < 650; if (compact !== this.compact) { this.compact = compact; cx.notify(); } })
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(6).overflow_x_scrollbar().children(shown.map(item))
        .child(button("tab-new", svg("mods/crew/icons/plus.svg").size(14), () => openOverlay({ mod: "neon-new-menu", kind: "popup", frame: "none", width: 280, height: 536 }))))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/crew/icons/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/crew/icons/changes.svg")))
      .child(panelButton("prs", "PRs", "mods/crew/icons/merge.svg"))
      .when(w?.buttons, el => el.child(h_flex().id("window-controls").flex_none().h(30).pl(9).gap(4).items_center().border_l(1).border_color(skin().border)
        .child(button("minimize", w.platform === "windows" ? svg("mods/crew/icons/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/my-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/crew/icons/win-close.svg").size(16) : svg("mods/crew/icons/close.svg").size(13), () => run("window.close")))));
    return headerFrame(bar);
  }
}
