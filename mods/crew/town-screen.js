// The town screen (Neon Borough, full window): one town per page or machine, picked in the tabs.
// The scene fills the window; a town with many spaces grows sideways and scrolls instead of
// shrinking its houses. Residents are an optional drawer on the right.
import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, shared, setShared, settings, terminals, agents } from "herdr";
import { bevel } from "./controls.js";
import { panelSkin } from "./panel-skin.js";
import { providerFrame, providerGeometry } from "./provider-skin.js";
import { mix } from "./theme-tokens.js";
import { STATUS_WORD, waitingActivity } from "./wait-presentation.js";
import { reportedActivity } from "./activity-data.js";
import { renderTown, towns, currentTown, setTown, townModel, townWidthFor, PIXEL_FONT } from "./town.js";
import { spriteEl, frameFor } from "./town-actors.js";
import { characterOf, provider, castNew } from "./cast.js";

const PAD = 24, GAP = 16, TOOLBAR = 60, HEADER = 64, FRAME = 24, DRAWER = 320;
const RANK = { blocked: 0, working: 1, waiting: 2, done: 3, idle: 4 };

function tab(id, label, count, active, t, onClick) {
  return bevel(h_flex().id(id).h(34).px(14).gap(8).flex_none().items_center().cursor_pointer(), active)
    .hover((s) => s.text_color(t.foreground))
    .on_click(onClick)
    .child(div().text_size(13).font_semibold().text_color(active ? t.foreground : t.muted).child(label))
    .when(count != null, (el) => el.child(div().text_size(11).text_color(active ? t.accent : t.dim).child(String(count))));
}

function meter(label, value, color, t) {
  return h_flex().h(34).px(10).gap(7).flex_none().items_center().opacity(value ? 1 : 0.45)
    .child(div().size(8).rounded(2).bg(color))
    .child(div().text_size(12).font_semibold().text_color(t.foreground).child(String(value)))
    .child(div().text_size(12).text_color(t.muted).child(label));
}

function resident(view, a, records, cw, t) {
  const ch = characterOf(a.address), pv = provider(a), activity = waitingActivity(a, reportedActivity(a, records));
  const look = providerGeometry(pv, cw, t);
  const stateColor = t[a.status] || t.dim;
  const tone = look.onLight ? stateColor : mix(stateColor, "#e6edf7", 0.35);
  return providerFrame(div(), pv, cw, t, a).id(`town-resident-${a.address}`).w(cw).h(look.height).flex_none().cursor_pointer()
    .tooltip(`${ch.name} · ${pv.name} · ${a.space_name || "Workspace"}\n${a.title || a.tab_name || ch.role}\n${activity.detail || activity.title}\nSelect to focus · Right-click for profile`)
    .on_click(() => { run("layout.select", { stack: "root", child: "desktop" }); run("agent.focus", { terminal: a.address }); })
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); view.profile(a.address); })
    .child(div().absolute()
      .left(look.portraitX - look.portraitHeight * 0.375).top(look.portraitY - look.portraitHeight * 0.5)
      .w(look.portraitHeight * 0.75).h(look.portraitHeight)
      .child(spriteEl(view, `still:${a.address}`, frameFor(a, null, Date.now(), view.motionOn()))))
    .child(v_flex().absolute().left(look.textLeft).right(look.textRight).top(look.textTop).bottom(look.textBottom).justify_center().gap(4)
      .child(h_flex().min_w(0).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().font_bold().text_size(12).text_color(look.onLight ? mix(ch.color, "#102030", 0.57) : ch.color).child(ch.name))
        .child(div().text_size(10.5).text_color(tone).child(STATUS_WORD[a.status] || a.status)))
      .child(div().min_w(0).truncate().text_size(12).text_color(look.ink).child(a.title || a.tab_name || ch.role))
      .when(activity.reported || a.status === "waiting", (el) => el.child(div().min_w(0).truncate().text_size(11)
        .text_color(a.status === "waiting" ? t.waiting : look.accent).child(activity.title))));
}

export function townScreen(view, t) {
  castNew(agents());
  const zoom = settings().zoom || 1;
  const W = view.width / zoom, H = view.height / zoom;
  const all = towns(), town = currentTown();
  view.shownTown = town;
  const showResidents = shared("town.residents") === true;
  // The stage: what is left of the window under the header and the toolbar.
  const stageW = Math.max(320, W - PAD * 2);
  const stageH = Math.max(280, H - HEADER - TOOLBAR - PAD);
  const viewW = showResidents ? stageW - DRAWER - GAP : stageW;
  const innerW = viewW - FRAME, innerH = stageH - FRAME;
  // Enough width that every house keeps a readable size; wider towns scroll.
  const sceneW = townWidthFor(townModel(town).homes.length, innerW);
  const { el, model } = renderTown(view, t, sceneW, innerH);
  const list = model.homes.flatMap((h) => h.agents).sort((a, b) => (RANK[a.status] ?? 5) - (RANK[b.status] ?? 5));
  const count = (s) => list.filter((a) => a.status === s).length;
  const records = terminals();

  const toolbar = h_flex().h(TOOLBAR).flex_none().px(PAD).gap(10).items_center()
    .children(all.map((tw) => tab(`town-tab-${tw.id}`, tw.name, null, tw.id === town.id, t, (_e, cx) => { setTown(tw.id); cx.notify(); })))
    .child(div().flex_1())
    .child(meter("working", count("working"), t.working, t))
    .child(meter("waiting", count("waiting"), t.waiting, t))
    .child(meter("need you", count("blocked"), t.blocked, t))
    .child(meter("idle", count("idle") + count("done"), t.dim, t))
    .child(div().w(1).h(22).mx(6).bg(t.border))
    .child(tab("town-residents", "Residents", list.length, showResidents, t, (_e, cx) => { setShared("town.residents", !showResidents); cx.notify(); }))
    .child(tab("town-motion", view.motionOn() ? "Motion on" : "Motion off", null, view.motionOn(), t, (_e, cx) => {
      if (shared("neon.motion") === false) { setShared("neon.motion", true); view.motion = true; } else view.motion = !view.motion;
      cx.notify();
    }));

  // The town's name over its sky, like a district sign.
  // The town gate: neon arch art with the town's name on its plate (plate: 17-83% wide, 30-62% high).
  const GW = 420, GH = Math.round(GW * 260 / 900);
  // Only when the town is too crowded for its monument in the plaza.
  const sign = div().absolute().top(FRAME / 2 + 12).left(FRAME / 2 + 16).w(GW).h(GH)
    .tooltip(`${town.name} · ${model.homes.length} ${model.homes.length === 1 ? "space" : "spaces"}`)
    .child(image("mods/crew/town/gen/town-gate.png").absolute().top(0).left(0).w(GW).h(GH))
    .child(div().absolute().left(Math.round(GW * 0.18)).w(Math.round(GW * 0.64)).top(Math.round(GH * 0.3)).h(Math.round(GH * 0.32))
      .flex().items_center().justify_center()
      .child(div().max_w(Math.round(GW * 0.6)).truncate().when(!!PIXEL_FONT(), (e) => e.font_family(PIXEL_FONT())).text_size(20).font_weight(600).text_color("#e8fbff").child(town.name.toUpperCase())));

  const scene = sceneW > innerW
    ? div().id("town-pan").w(innerW).h(innerH).overflow_x_scrollbar().child(el)
    : el;
  const stage = div().relative().w(viewW).h(stageH).flex_none()
    .child(panelSkin(scene))
    .when(!model.monument, (e) => e.child(sign))
    .when(!model.homes.length, (e) => e.child(div().absolute().top(0).left(0).size_full().flex().items_center().justify_center()
      .child(div().px(18).py(12).rounded(4).bg(`${t.popover}ee`).text_size(13).text_color(t.muted).child("No spaces in this town yet. Open a space on this machine to build its first house."))));

  const drawerW = DRAWER - 6;
  const drawer = v_flex().id("town-residents-list").w(DRAWER).h(stageH).flex_none().gap(10).overflow_y_scrollbar().pr(6)
    .children(list.map((a) => resident(view, a, records, drawerW, t)))
    .when(!list.length, (e) => e.child(div().p(14).text_size(12).text_color(t.muted).child("No agents in this town.")));

  return v_flex().size_full().min_h(0).child(view.header(t)).child(toolbar)
    .child(h_flex().flex_1().min_h(0).px(PAD).pb(PAD).gap(GAP).items_start()
      .child(stage)
      .when(showResidents, (e) => e.child(drawer)));
}
