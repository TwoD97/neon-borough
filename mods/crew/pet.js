import {skin,art} from "./theme-tokens.js";
import {hangarDeck,lightHangarFace} from "./hangar-skin.js";
import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, focused, layout, run, shared, spaces, settings, window as appWindow } from "herdr";
import { characterOf, provider, spriteFor, line } from "./cast.js";
import { companionGeometry } from "./pet-layout.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// A normal layout block has no floating-window frame and never covers a terminal.
export function petDock(t, profile, view) {
  t=skin(t);
  const all = [...new Map(agents().map(a => [a.address, a])).values()];
  const focus = focused(), space = spaces().find(s => s.active);
  const tabId = focus?.tab ?? space?.tabs.find(tab => tab.active)?.id;
  const inTab = tabId ? all.filter(a => a.tab === tabId) : [];
  const inSpace = all.filter(a => a.space === (focus?.space ?? space?.id));
  const companions = inTab.length ? inTab : inSpace.length ? inSpace : all;
  if (!companions.length) return div().size_full();
  const sidebarWidth = view?.petSize?.width ?? find(layout(), "sidebar")?.size?.px ?? 252;
  const dockHeight = view?.petSize?.height ?? find(layout(), "companion")?.size?.px ?? 126;
  const g = companionGeometry(sidebarWidth,dockHeight,companions.length);
  const artWidth = Math.max(sidebarWidth, dockHeight * 3);
  const {compact,slot} = g;
  const moving = appWindow()?.active !== false && shared("neon.motion") !== false;
  const residents = companions.map(agent => {
    const ch = characterOf(agent.address), pv = provider(agent);
    const status = agent.status === "blocked" ? "Needs you" : agent.status === "done" ? "Complete" : agent.status === "working" ? "Working" : "Standing by";
    const color = agent.status === "blocked" ? t.blocked : agent.status === "working" ? t.accent : agent.status === "done" ? t.done : t.dim;
    const tile = div().id(`companion-${agent.address}`).relative().w(slot).h(g.rowHeight).flex_none().cursor_pointer()
      .tooltip(`${ch.name} · ${pv.name} · ${status}\n${agent.title || agent.tab_name || agent.space_name}\n${line(agent, ch)}\nClick to focus · Right-click for profile`)
      .on_click(() => run("agent.focus", {terminal: agent.address}))
      .on_mouse_down("right", (_e, cx) => {cx.stop_propagation();profile(agent.address);})
      .when(compact, el => el.child(hangarDeck(Math.max(1,slot-2),10,t).absolute().left(1).bottom(2)))
      .child(image(spriteFor(agent, moving)).absolute().left((slot-g.spriteWidth)/2).bottom(compact ? 7 : 22).w(g.spriteWidth).h(g.spriteHeight));
    if (compact) tile.child(div().absolute().top(7).right(3).size(3).bg(color)
      .when(moving && agent.status === "blocked", el => el.loop("opacity", {from:0.55,to:1,period:2200})));
    else {
      tile.child(div().absolute().bottom(11).left(0).right(0).h(12).text_center().text_size(10).font_semibold().text_color(agent.focused ? t.accent : t.light ? t.foreground : ch.color).truncate().child(ch.name));
      tile.child(div().absolute().bottom(0).left(0).right(0).h(11).text_center().text_size(8).text_color(color).truncate().child(status.toUpperCase())
        .when(moving && agent.status === "blocked", el => el.loop("opacity", {from:0.6,to:1,period:2200})));
    }
    return tile;
  });
  const deck = () => hangarDeck(g.available,24,t).absolute().left(0).bottom(23);
  const rows = [];
  for(let start=0;start<residents.length;start+=g.columns) {
    rows.push(div().id(`companion-row-${start}`).relative().w_full().h(g.rowHeight).flex_none()
      .when(!compact, el => el.child(deck()).child(div().absolute().left(0).right(0).bottom(0).h(23).bg(t.surface)))
      .child(h_flex().w_full().h(g.rowHeight).gap(g.gap).justify_center().children(residents.slice(start,start+g.columns))));
  }
  const track = v_flex().w_full().min_w(0).pr(g.scrollbar).gap(g.gap).children(rows);
  const viewport = div().id("companions-scroll").size_full().min_w(0).min_h(0).overflow_y_scrollbar().child(track);
  const stage = div().relative().flex_1().min_w(0).min_h(0).mx(g.padding).overflow_hidden().child(viewport);
  const header = h_flex().relative().bg(t.chrome).h(g.header).flex_none().px(compact ? 2 : 12).gap(6).items_center()
    .child(div().absolute().left(0).right(0).top(0).h(3).bg(t.rail).border_t(1).border_color(t.shine))
    .child(div().absolute().left(12).top(2).w(compact ? 16 : 40).h(1).bg(t.accent))
    .when(compact, el => el.justify_center())
    .when(!compact, el => el.child(div().flex_1().text_size(9).font_semibold().text_color(t.muted).child("COMPANION HANGAR")))
    .child(div().text_size(9).text_color(t.accent)
      .tooltip(g.contentHeight > g.viewport ? `${companions.length} companions · scroll to see all` : `${companions.length} companions`)
      .child(`${companions.length}${g.contentHeight > g.viewport ? " ↓" : ""}`));
  return v_flex().id("companion-dock").relative().size_full().bg(t.background).min_w(0).min_h(0).overflow_hidden()
    .when(Boolean(view),el => el.on_size_change((size,cx) => {
      const zoom=settings().zoom||1, width=size.width/zoom, height=size.height/zoom;
      if(width>0 && height>0 && (Math.abs(width-(view.petSize?.width??0))>1 || Math.abs(height-(view.petSize?.height??0))>1)) {
        view.petSize={width,height};cx.notify();
      }
    }))
    .when(!compact && !t.light, el => el.child(image(art("mods/crew/art/hangar-backdrop.png",t)).absolute()
      .left((sidebarWidth-artWidth)/2).top((dockHeight-artWidth/3)/2).w(artWidth).h(artWidth/3).opacity(0.8)))
    .when(t.light,el=>el.child(lightHangarFace(t,g.header)))
    .child(header).child(stage);
}
