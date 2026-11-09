import { fitting } from "./fittings.js";
import { skin, art, artText, mix } from "./theme-tokens.js";
import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, spaces, terminals, props, closeOverlay, openOverlay, run } from "herdr";
import { panelSkin } from "./panel-skin.js";
import { bevel } from "./controls.js";
import { CHARACTERS, PALETTES, characterOf, provider, spriteFor, stillFor, paletteChoice, setPalette, recast } from "./cast.js";
import { withWait } from "./agent-wait.js";
import { STATUS_WORD, waitingActivity } from "./wait-presentation.js";
import { reportedActivity } from "./activity-data.js";

// A fitted identity instrument: no invented percentages or simulated work.
export function profileCard(t, motion) {
  t=skin(t);
  const records = terminals();
  const a = withWait(agents().find(agent => agent.address === props().profile), records);
  const close = () => closeOverlay(props().overlay);
  const action = (id, label, callback, active = false) => bevel(h_flex().id(id).h(30).px(12).gap(6).items_center().flex_none(), active,t)
    .text_size(11).text_color(active ? t.accent : t.muted).hover(s => s.opacity(.85)).on_click(callback).child(label);
  const content = v_flex().id("profile").size_full().min_h(0).bg(t.background).text_color(t.foreground)
    .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } });
  if (!a) return panelSkin(content.p(18).gap(16).child("This agent has ended.").child(action("pf-close", "Close", close)),t);
  const ch = characterOf(a.address), pv = provider(a);
  const space = spaces().find(s => s.id === a.space), tab = space?.tabs?.find(tab => tab.id === a.tab);
  const chat = tab?.named ? tab.name : a.title || a.tab_name || "Untitled chat";
  const tone = t[a.status] || t.dim;
  const state = STATUS_WORD[a.status] || a.status;
  const activity = waitingActivity(a, reportedActivity(a, records));
  const fact = (label, value, color = t.foreground) => h_flex().gap(8).items_center().min_w(0)
    .child(div().w(52).flex_none().text_size(10).text_color(t.dim).child(label))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(color).tooltip(value || "—").child(value || "—"));
  return panelSkin(content
    .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().w(3).h(13).bg(t.accent))
      .child(div().text_size(10).font_bold().text_color(t.muted).child("CREW / PROFILE"))
      .child(div().flex_1()).child(div().text_size(10).text_color(t.light?t.muted:pv.color).child(pv.name))
      .child(action("pf-x", "×", close)))
    .child(v_flex().id("profile-body").flex_1().min_h(0).overflow_y_scrollbar()
    .child(h_flex().h(212).flex_none().gap(14).px(12).py(10)
      .child(div().relative().w(144).h(190).flex_none()
        .child(fitting("profile",144,190,{},t).absolute().top(0).left(0))
        .child(div().absolute().top(13).left(14).right(14).truncate().text_size(9).text_color(t.dim).child(ch.role.toUpperCase()))
        .child(image(spriteFor(a, motion)).absolute().left(32).top(35).w(81).h(108))
        .child(div().absolute().left(14).right(14).bottom(24).truncate().tooltip(ch.name).text_center().text_size(16).font_bold().text_color(t.light?t.foreground:ch.color).child(ch.name))
        .child(div().absolute().left(14).right(14).bottom(10).text_center().text_size(9).text_color(tone).child(state.toUpperCase())))
      .child(v_flex().flex_1().min_w(0).min_h(0).gap(9)
        .child(div().text_size(9).font_bold().text_color(t.dim).child("CHAT"))
        .child(div().max_h(46).overflow_hidden().text_size(14).font_semibold().line_height(1.2).tooltip(chat).child(chat))
        .child(div().h(1).flex_none().bg(t.border))
        .child(fact("Space", space?.name || a.space_name))
        .child(fact("Status", state, tone))
        .child(h_flex().gap(7).items_center().min_w(0)
          .child(div().size(5).flex_none().bg(tone)
            .when(motion && a.status === "working", el => el.loop("opacity", {from:.35,to:1,period:1050}))
            .when(motion && a.status === "blocked", el => el.loop("opacity", {from:.6,to:1,period:2200})))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(tone).tooltip(activity.detail).child(activity.title)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.muted).line_height(1.25).child(ch.personality))))
    .child(h_flex().h(70).flex_none().px(12).gap(12).items_center().border_t(1).border_color(t.border)
      .child(v_flex().w(63).flex_none().gap(3).child(div().text_size(9).font_bold().text_color(t.muted).child("CAST"))
        .child(div().text_size(9).text_color(t.dim).child("Choose a face")))
      .child(h_flex().id("profile-cast").flex_1().min_w(0).gap(5).overflow_x_scrollbar().children(CHARACTERS.map(c =>
        bevel(v_flex().id(`cast-${c.id}`).w(42).h(52).flex_none().items_center().justify_center(), c.id === ch.id,t)
          .tooltip(`${c.name} · ${c.role}`).hover(s => s.opacity(.85)).on_click(() => recast(a.address,c.id))
          .child(image(stillFor(a,c.id)).w(28).h(37))
          .child(div().text_size(7).text_color(c.id === ch.id ? t.accent : t.dim).child(c.name))))))
    .child(v_flex().w_full().flex_none().px(12).py(10).gap(8).border_t(1).border_color(t.border)
      .child(h_flex().w_full().gap(8).items_center()
        .child(div().text_size(9).font_bold().text_color(t.muted).child("PALETTE"))
        .child(div().text_size(10).text_color(t.dim).child("Applies to this companion")))
      .child(h_flex().w_full().min_w(0).gap(5).flex_wrap().children(PALETTES.map(p => {
        const selected = paletteChoice(a.address) === p.id;
        const color = p.id === "theme" ? t.accent : p.id === "provider" ? pv.color : p.id === "original" ? CHARACTERS.find(c => c.id === ch.id,t)?.color || ch.color : p.color;
        return bevel(h_flex().id(`palette-${p.id}`).h(27).px(8).gap(5).flex_none().items_center(),selected,t)
          .tooltip(p.id === "provider" ? `Follow ${pv.name}'s color` : `${p.name} palette`)
          .hover(s => s.opacity(.85)).on_click(() => setPalette(a.address,p.id))
          .child(div().size(7).flex_none().bg(color))
          .child(div().text_size(10).text_color(selected ? t.foreground : t.muted).child(p.name));
      })))))
    .child(h_flex().h(46).flex_none().px(12).gap(7).items_center().border_t(1).border_color(t.border)
      .child(action("pf-rename-companion", "Rename companion", () => openOverlay({mod:"crew",kind:"dialog",frame:"none",width:440,height:250,props:{renameCompanion:a.address}})))
      .child(action("pf-rename", "Rename chat", () => { close(); openOverlay({mod:"neon-rename",kind:"dialog",frame:"none",width:440,height:220,props:{tab:a.tab}}); }))
      .child(div().flex_1()).child(action("pf-close", "Close", close))
      .child(action("pf-go", "Go to agent →", () => {close();run("layout.select",{stack:"root",child:"desktop"});run("agent.focus",{terminal:a.address});}, true))),t);
}
