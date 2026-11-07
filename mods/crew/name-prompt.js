import { skin, art, artText, mix } from "./theme-tokens.js";
import { div, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { agents, props, closeOverlay } from "herdr";
import { panelSkin } from "./panel-skin.js";
import { bevel } from "./controls.js";
import { characterOf, renameCompanion, stillFor } from "./cast.js";

export function initNamePrompt(view, cx) {
  view.nameAddress = typeof props()?.renameCompanion === "string" ? props().renameCompanion : "";
  const current = view.nameAddress ? characterOf(view.nameAddress).name : "";
  view.nameInput = InputState.new({value:current,placeholder:"Companion name"});
  view.nameFocused = true;
  view.nameHandle = cx.focus_handle();
  view.nameInput.on("change", (_e,cx) => cx.notify());
  view.nameInput.on("focus", (_e,cx) => {view.nameFocused=true;cx.notify();});
  view.nameInput.on("blur", (_e,cx) => {view.nameFocused=false;cx.notify();});
  view.nameInput.on("submit", () => saveName(view));
  if(current) view.nameInput.set_selected_range({start:0,end:current.length});
  view.nameInput.focus();
  cx.timer.after(100, () => view.nameInput.focus());
}

function saveName(view) {
  const value = view.nameInput.value().trim();
  if(!agents().some(a => a.address === view.nameAddress) || [...value].length > 32) return;
  renameCompanion(view.nameAddress,value);
  closeOverlay(props().overlay);
}

export function namePrompt(view,t) {
  t=skin(t);
  const agent = agents().find(a => a.address === view.nameAddress);
  const value = view.nameInput.value().trim(), count = [...value].length;
  const valid = Boolean(agent) && count <= 32;
  const close = () => closeOverlay(props().overlay);
  const button = (id,label,primary,click) => bevel(h_flex().id(id).h(30).px(13).items_center(),primary)
    .text_size(12).text_color(primary ? t.accent : t.muted).hover(s => s.opacity(.85)).on_click(click).child(label);
  return panelSkin(v_flex().id("companion-name").size_full().min_h(0).p(14).gap(10).bg(t.background).text_color(t.foreground)
    .track_focus(view.nameHandle)
    .on_key_down((event,cx) => {if(event.key === "escape"){cx.stop_propagation();close();}})
    .child(h_flex().h(27).flex_none().gap(9).items_center()
      .when(Boolean(agent),el => el.child(image(stillFor(agent)).w(21).h(28).flex_none()))
      .child(div().flex_1().text_size(16).font_semibold().child("Rename companion"))
      .child(div().text_size(10).text_color(t.dim).child("ESC")))
    .child(bevel(h_flex().h(37).w_full().min_w(0).flex_none().p(3).items_center(),view.nameFocused).cursor_text()
      .child(Input.new(view.nameInput).flex_1().min_w(0).h(31).px(8).rounded(0).border(0).bg((view.nameFocused?t.selected:t.raised)).text_size(13).text_color(t.foreground)))
    .child(h_flex().w_full().gap(10).items_center()
      .child(div().flex_1().min_w(0).text_size(11).text_color(valid ? t.muted : t.warning)
        .child(!agent ? "This agent is no longer available." : count > 32 ? "Use 32 characters or fewer." : "Leave blank to restore the original name."))
      .child(div().flex_none().text_size(10).text_color(count > 32 ? t.warning : t.dim).child(`${count}/32`)))
    .child(div().flex_1().min_h(0))
    .child(h_flex().h(30).flex_none().gap(8).items_center().justify_end()
      .child(button("companion-name-cancel","Cancel",false,close))
      .child(button("companion-name-save","Save name",true,()=>saveName(view)).opacity(valid ? 1 : .4))));
}
