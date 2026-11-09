import { Toggle } from "gpui-base";
import { div } from "gpui-kit";
import { shared, setShared } from "herdr";
import { bevel } from "./controls.js";
import { skin } from "./theme-tokens.js";

export const compactCards = () => shared("sidebar.card-density") === "compact";
// Both headers use the same persistent setting; the narrow icon rail is independent.
export function densityToggle(id) {
  const compact=compactCards(), t=skin();
  const button = bevel(Toggle.new(id).pressed(compact).accessibility_label("Compact cards for Spaces and Agents").size(26).flex_none().flex().items_center().justify_center(),compact)
    .text_color(compact?t.accent:t.muted).hover(s=>s.text_color(t.foreground))
    .on_change((value,cx)=>{setShared("sidebar.card-density",value?"compact":"comfortable");cx.notify();})
    .child(div().relative().w(14).h(14).children((compact?[1,5,9,13]:[2,7,12]).map(y=>
      div().absolute().left(0).top(y).w(14).h(1).bg(compact?t.accent:t.muted))));
  return div().size(26).flex_none()
    .tooltip(`${compact?"Compact":"Comfortable"} cards · Switch to ${compact?"comfortable":"compact"} (Spaces + Agents)`)
    .child(button);
}
