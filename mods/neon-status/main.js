import { skin } from "./theme-tokens.js";
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, run, window, keys, settings, shared, terminals } from "herdr";
import { withWait } from "./agent-wait.js";
import { waitingText } from "./wait-presentation.js";
import { bevel } from "./controls.js";

export default class WorkspaceStatus extends View {
  init(_props, cx) { this.width = 220; cx.timer.every(30000, cx => cx.notify()); }
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
    const records = terminals();
    const list = agents().map(a => withWait(a, records));
    const waiting = list.filter(a => a.status === "waiting");
    const needs = list.filter(a => a.status === "blocked").length;
    const working = list.filter(a => a.status === "working").length;
    const usage = shared("usage.snapshot");
    const reported = Array.isArray(usage?.providers) ? usage.providers.flatMap(p => {
      const quota = Array.isArray(p.windows) ? p.windows.find(w => typeof w.used === "number" && Number.isFinite(w.used) && (!w.reset || w.reset > Date.now())) : null;
      return quota ? [{label:`${p.id === "claude" ? "Claude" : "Codex"} ${Math.round(quota.used)}%`, detail:`${p.name}: ${quota.used}% used · ${quota.label}`}]:[];
    }) : [];
    const usageHint = ["Usage & accounts · Codex and Claude Code", ...reported.map(p=>p.detail), usage?.updated ? `Last checked ${new Date(usage.updated).toLocaleString()}` : "Open to check your usage"].join("\n");
    const width=this.width, tiny=width<280, narrow=width<420, compact=width<720;
    const summary=`${list.length} agents · ${working} working · ${waiting.length} waiting · ${needs} need you`;
    const chip = (icon, text, color=t.muted) => bevel(h_flex().h(24).px(compact?4:8).gap(4).items_center().min_w(0),false,t)
      .cursor_default().text_color(color)
      .child(svg(`mods/crew/icons/${icon}.svg`).size(12).flex_none())
      .when(text!==null,el=>el.child(div().min_w(0).truncate().child(text)));
    const machine = space?.machine ?? "This computer";
    const metrics=h_flex().min_w(0).gap(4).items_center().tooltip(summary)
      .when(width>=340,el=>el.child(chip(space?.machine ? "server" : "monitor",narrow?null:machine)
        .max_w(compact?96:128).tooltip(`Machine: ${machine}`)))
      .when(Boolean(space?.branch) && width>=1200,el=>el.child(chip("branch",space.branch).max_w(144).tooltip(space.branch)))
      .when(!tiny || (!waiting.length && !needs),el=>el.child(chip("layers",compact?String(list.length):`${list.length} agents`).flex_none().tooltip(summary)))
      .when(working>0 && width>=1040,el=>el.child(h_flex().gap(4).flex_none().items_center().text_color(t.working)
        .child(div().w(4).h(8).bg(t.working)).child(`${working} working`)))
      .when(waiting.length>0,el=>el.child(chip("clock",compact?String(waiting.length):`${waiting.length} waiting`,t.waiting).flex_none()
        .tooltip(waiting.map(a=>`${a.title || a.tab_name || a.address}: ${waitingText(a)}`).join("\n"))))
      .when(needs>0,el=>el.child(chip("alert-triangle",compact?String(needs):`${needs} need you`,t.warning).flex_none()
        .tooltip(`${needs} agents need you`)));
    const muted=settings()?.sounds?.enabled===false;
    const controls=h_flex().flex_none().gap(4).items_center()
      .child(bevel(h_flex().id("sound-alerts").size(24).items_center().justify_center(),false,t).text_color(muted?t.muted:t.accent)
        .tooltip(muted?"Sounds & alerts · muted":"Sounds & alerts")
        .on_click(()=>run("mod.open",{name:"neon-alerts"}))
        .child(svg("mods/neon-status/sound.svg").size(16)))
      .child(bevel(h_flex().id("usage-accounts").flex_none().h(24).px(compact?4:8).max_w(200).gap(4).items_center(),false,t).text_color(t.accent)
        .tooltip(usageHint).hover(s=>s.text_color(t.foreground))
        .on_click(()=>run("mod.open",{name:"neon-usage"}))
        .child(svg("mods/neon-status/usage.svg").size(16).flex_none())
        .when(!compact,el=>el.child(div().min_w(0).truncate().child(width>=1040 && reported.length?reported.map(p=>p.label).join(" · "):"Usage"))))
      .child(bevel(h_flex().id("palette").flex_none().h(24).px(compact?4:8).max_w(200).gap(4).items_center(),false,t).text_color(t.accent)
        .tooltip(this.hint(t)).hover(s=>s.text_color(t.foreground)).on_click(()=>run("app.palette"))
        .child(svg("mods/neon-chrome/search.svg").size(16).flex_none())
        .when(!compact,el=>el.child(div().min_w(0).truncate().child(width>=1200?this.hint(t):"Commands"))));
    const bucket=w=>w<280?0:w<340?1:w<420?2:w<720?3:w<1040?4:w<1200?5:6;
    const bar=h_flex().size_full().min_w(0).px(8).gap(8).items_center().text_size(12).text_color(t.muted)
      .on_size_change((size,cx)=>{const next=Math.round(size.width/(settings().zoom || 1)),changed=bucket(next)!==bucket(this.width);this.width=next;if(changed)cx.notify();})
      .child(metrics).child(div().flex_1().min_w(0)).child(controls);
    return div().relative().size_full().min_w(0).bg(t.chrome)
      .child(div().absolute().top(0).left(0).right(0).h(2).bg(t.metal))
      .child(div().absolute().bottom(0).left(0).right(0).h(1).bg(t.shine))
      .child(div().absolute().top(0).left(14).w(30).h(1).bg(t.accent))
      .child(div().absolute().top(0).right(14).w(24).h(1).bg(t.secondary))
      .child(svg("mods/neon-pane/header-vents.svg").text_color(t.edge).absolute().bottom(0).left("58%").w(54).h(4))
      .child(bar);
  }
}
