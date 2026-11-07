import { skin, art, artText, mix } from "./theme-tokens.js";
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, spaces, agents, theme, run, closeOverlay } from "herdr";
import { panelSkin } from "./panel-skin.js";
import { bevel } from "./controls.js";

export default class RenameChat extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.tabId = typeof p.tab === "string" ? p.tab : p.id;
    const tab = this.target();
    const current = p.name ?? (tab?.named ? tab.name : agents().find(a => a.tab === this.tabId)?.title || tab?.name || "");
    this.input = InputState.new({ value: String(current), placeholder: "Chat name" });
    this.handle = cx.focus_handle();
    this.focused = true;
    this.input.on("change", (_e, cx) => cx.notify());
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    this.input.on("submit", () => this.save());
    if (current) this.input.set_selected_range({ start: 0, end: String(current).length });
    this.input.focus();
    cx.timer.after(100, () => this.input.focus());
  }

  target() {
    if (!this.tabId) return null;
    return spaces().flatMap(s => s.tabs ?? []).find(tab => tab.id === this.tabId) ?? null;
  }

  cancel() { closeOverlay(props()?.overlay); }

  save() {
    if (!this.target()) return;
    // An explicit empty name restores Herdr's automatic tab naming.
    run("tab.rename", { id: this.tabId, name: this.input.value().trim() });
    this.cancel();
  }

  render() {
    const t = skin(), available = Boolean(this.target());
    const button = (id, label, primary, action) => bevel(h_flex().id(id).h(30).px(14).gap(6).items_center(), primary)
      .text_size(12).text_color(primary ? t.accent : t.muted)
      .hover(s => s.text_color(t.foreground)).on_click(action).child(label);
    const field = bevel(h_flex().h(36).w_full().flex_none().p(3).items_center(), this.focused)
      .cursor_text().child(Input.new(this.input).w_full().h(30).px(9).rounded(0).border(0)
        .bg((this.focused?t.selected:t.raised)).text_size(13).text_color(t.foreground));
    const content = v_flex().id("rename-chat").size_full().min_w(0).min_h(0).p(14).gap(10).bg(t.background)
      .track_focus(this.handle)
      .on_key_down((event, cx) => {
        if (event.key === "escape") { cx.stop_propagation(); this.cancel(); }
      })
      .child(h_flex().h(24).flex_none().gap(9).items_center()
        .child(svg("mods/neon-rename/rename.svg").size(18).text_color(t.accent))
        .child(div().flex_1().text_size(16).font_semibold().text_color(t.foreground).child("Rename chat"))
        .child(div().text_size(10).text_color(t.dim).child("ESC")))
      .child(field)
      .child(div().text_size(11).text_color(available ? t.muted : t.warning)
        .child(available ? "Leave blank to use the automatic name." : "This chat is no longer available."))
      .child(div().flex_1().min_h(0))
      .child(h_flex().h(30).flex_none().gap(8).items_center().justify_end()
        .child(button("rename-cancel", "Cancel", false, () => this.cancel()))
        .child(button("rename-save", "Save name", true, () => this.save()).opacity(available ? 1 : 0.4)));
    return panelSkin(content);
  }
}
