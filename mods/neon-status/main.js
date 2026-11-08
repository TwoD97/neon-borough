import { skin, artText, mix } from "./theme-tokens.js";
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, settings, shared } from "herdr";
import { bevel } from "./controls.js";

export default class WorkspaceStatus extends View {
  init() { this.compact = false; this.narrow = false; }
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = skin();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const working = list.filter(a => a.status === "working").length;
    const usage = shared("usage.snapshot");
    const reported = Array.isArray(usage?.providers) ? usage.providers.flatMap(p => {
      const quota = Array.isArray(p.windows) ? p.windows.find(w => typeof w.used === "number" && Number.isFinite(w.used) && (!w.reset || w.reset > Date.now())) : null;
      return quota ? [{label:`${p.id === "claude" ? "Claude" : "Codex"} ${Math.round(quota.used)}%`, detail:`${p.name}: ${quota.used}% used · ${quota.label}`}]:[];
    }) : [];
    const usageHint = ["Usage & accounts · Codex and Claude Code", ...reported.map(p=>p.detail), usage?.updated ? `Last checked ${new Date(usage.updated).toLocaleString()}` : "Open to check your usage"].join("\n");
    const chip = (icon, text, color = t.muted) => bevel(h_flex().h(20).px(8).gap(5).items_center().min_w(0)).cursor_default().text_color(color)
      .child(svg(`mods/crew/icons/${icon}.svg`).size(11).flex_none())
      .child(div().min_w(0).truncate().child(text));
    const machine = space?.machine ?? "This computer";
    const bar = h_flex().size_full().min_w(0).px(12).gap(6).items_center().text_size(10).text_color(t.muted)
      .on_size_change((size, cx) => { const width = size.width / (settings().zoom || 1), compact = width < 640, narrow = width < 420; if (compact !== this.compact || narrow !== this.narrow) { this.compact = compact; this.narrow = narrow; cx.notify(); } })
      .child(chip(space?.machine ? "server" : "monitor", machine).max_w(this.narrow ? 80 : this.compact ? 110 : 200).tooltip(`Machine: ${machine}`))
      .when(Boolean(space?.branch) && !this.compact, el => el.child(chip("branch", space.branch).max_w(180).tooltip(space.branch)))
      .child(chip("layers", this.narrow ? String(list.length) : `${list.length} agents`).flex_none().tooltip(`${list.length} agents · ${working} working · ${needs} need you`))
      .when(working > 0 && !this.narrow, el => el.child(h_flex().gap(4).flex_none().items_center().text_color(t.accent)
        .child(div().w(2).h(8).bg(t.accent)).child(`${working} working`)))
      .when(needs > 0, el => el.child(h_flex().gap(4).flex_none().items_center().text_color(skin().warning)
        .child(div().size(4).bg(skin().warning)).tooltip(`${needs} agents need you`).child(this.narrow ? String(needs) : `${needs} ${this.compact ? "waiting" : "need you"}`)))
      .child(div().flex_1().min_w(0))
      .child(bevel(h_flex().id("usage-accounts").flex_none().h(20).px(this.narrow ? 6 : 8).gap(5).items_center()).text_color(t.accent)
        .tooltip(usageHint).hover(s => s.text_color(t.foreground))
        .on_click(() => run("mod.open", {name:"neon-usage"}))
        .child(svg("mods/neon-status/usage.svg").size(12).flex_none())
        .when(!this.narrow, el => el.child(!this.compact && reported.length ? reported.map(p=>p.label).join(" · ") : "Usage & accounts")))
      .child(bevel(div().id("palette").flex_none().h(20).px(8).flex().items_center(),true).text_color(t.accent)
        .tooltip(this.hint(t)).hover(s => s.text_color(t.foreground)).on_click(() => run("app.palette"))
        .child(this.compact ? "Commands" : this.hint(t)));
    return div().relative().size_full().min_w(0).bg(skin().chrome)
      .child(div().absolute().top(0).left(0).right(0).h(2).bg(skin().metal))
      .child(div().absolute().bottom(0).left(0).right(0).h(1).bg(skin().shine))
      .child(div().absolute().top(0).left(14).w(30).h(1).bg(skin().accent))
      .child(div().absolute().top(0).right(14).w(24).h(1).bg(skin().secondary))
      .child(svg("mods/neon-pane/header-vents.svg").text_color(t.edge).absolute().bottom(0).left("58%").w(54).h(4))
      .child(bar);
  }
}
