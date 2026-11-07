import { skin, art, artText, mix } from "./theme-tokens.js";
// A text prompt. Enter saves, Esc cancels.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";
import { bevel } from "./controls.js";

export default class Prompt extends View {
  init(_props, cx) {
    this.text = props()?.value ?? "";
    this.input = InputState.new({ value: this.text });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.submit());
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submit() {
    const p = props();
    closeOverlay(p.overlay);
    run(p.command.name, { ...(p.command.args ?? {}), name: this.text });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = skin();
    const p = props() ?? {};
    const button = (id, text, primary, action) => bevel(h_flex().id(id).h(32).px(15).items_center(), primary)
      .text_color(primary ? t.accent : t.muted).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.text_color(t.foreground)).on_click(action).child(text);
    return v_flex().id("prompt").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .relative().w_full().min_w(0).min_h(0).p(18).rounded(8).overflow_hidden()
      .border_1().border_color(t.edge).bg(t.popover).text_color(t.foreground)
      .child(div().absolute().left(16).right(16).top(0).h(2).bg(t.rail))
      .child(div().absolute().left(20).top(0).w(46).h(2).bg(t.accent))
      .child(div().absolute().left(0).top(22).bottom(22).w(2).bg(t.edge))
      .child(div().absolute().right(20).bottom(1).w(28).h(1).bg(t.secondary))
      .child(h_flex().min_w(0).gap(10).items_center()
        .child(svg("mods/neon-prompt/art/input.svg").size(18).flex_none().text_color(t.accent))
        .child(div().flex_1().min_w(0).whitespace_normal().text_size(16).line_height(1.25).font_semibold().child((p.title ?? "").replace(/^./, (c) => c.toUpperCase())))
        .child(div().text_size(10).text_color(t.dim).child("ESC")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.muted).child("Name"))
      .child(bevel(h_flex().h(40).w_full().min_w(0).flex_none().p(4).items_center(), this.inputFocused)
        .cursor_text().child(Input.new(this.input).w_full().min_w(0).h(32).px(9).rounded(0).border(0)
          .bg(this.inputFocused ? t.selected : t.raised).text_size(13.5).text_color(t.foreground)))
      .when(Boolean(p.hint), el => el.child(div().pt(8).min_w(0).whitespace_normal().text_size(12).line_height(1.4).text_color(t.muted).child(p.hint)))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("pm-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("pm-save", "Save", true, () => this.submit())));
  }
}
