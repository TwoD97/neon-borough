import { div, svg } from "gpui-kit";
import { skin } from "./theme-tokens.js";

const LAYERS = {
  control: ["face","edge","accent"],
  pane: ["metal","rail","edge","accent","background","shine","dim"],
  request: ["face","edge","rail"],
  badge: ["face","edge","accent","background","rail"],
  profile: ["face","background","metal","rail","edge","shine","accent","secondary"],
  hangar: ["metal","edge","background","rail","accent"],
  dock: ["face","edge","metal","shine","background","rail","accent","secondary"],
};
export function fitting(name, width, height = width, colors = {}) {
  const t = skin(), kind = name.split("-")[0];
  return div().relative().w(width).h(height).flex_none().children(LAYERS[kind].map(role =>
    svg(`mods/crew/art/theme-${name}-${role}.svg`).absolute().top(0).left(0).size_full()
      .text_color(colors[role] ?? (role === "face" ? t.surface : t[role]) ?? t.foreground)));
}
export function panelBackdrop() {
  const t=skin();
  return div().relative().size_full().children(["edge","accent","secondary"].map(role =>
    svg(`mods/crew/art/theme-backdrop-${role}.svg`).absolute().top(0).left(0).size_full().text_color(t[role])));
}
