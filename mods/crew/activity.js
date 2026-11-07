import {skin,mix} from "./theme-tokens.js";
// Workshop instruments reflect live hook activity or the agent report message.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, shared, terminals } from "herdr";
import { reportedActivity } from "./activity-data.js";
import { characterOf } from "./cast.js";


function instrument(id, kind, color, motion, t) {
  const panel = div().relative().w(34).h(24).flex_none().bg(t.raised).border_1().border_color(`${color}55`).rounded(2).overflow_hidden();
  if (kind === "waiting") {
    panel.child(div().size_full().flex().items_center().justify_center().font_bold().text_size(15).text_color(color).child("!")
      .when(motion, el => el.loop("opacity", {from:0.6,to:1,period:2200})));
  } else if (kind === "test") {
    for (let i = 0; i < 6; i++) panel.child(div().id(`${id}-cell-${i}`).absolute().left(4 + (i % 3) * 9).top(4 + Math.floor(i / 3) * 9).size(5).bg(color).opacity(0.65)
      .when(motion, el => el.loop("opacity", { from: 0.18, to: 0.95, period: 900 + i * 170 })));
  } else if (kind === "scan") {
    for (let i = 0; i < 3; i++) panel.child(div().absolute().left(4).top(5 + i * 6).w(24 - i * 4).h(1).bg(`${color}66`));
    panel.child(div().id(`${id}-scanner`).absolute().top(3).bottom(3).left(5).w(2).bg(color)
      .when(motion, el => el.loop("left", { from: 4, to: 28, period: 1700, easing: "ease-in-out" })));
  } else if (kind === "code") {
    for (let i = 0; i < 3; i++) panel.child(div().absolute().left(4 + (i % 2) * 4).top(5 + i * 6).w(17 - i * 3).h(2).bg(`${color}aa`));
    panel.child(div().id(`${id}-cursor`).absolute().left(22).top(16).w(4).h(4).bg(color)
      .when(motion, el => el.loop("opacity", { from: 0.15, to: 1, period: 850 })));
  } else {
    panel.child(div().absolute().left(5).top(11).w(24).h(1).bg(`${color}66`));
    for (let i = 0; i < 3; i++) panel.child(div().id(`${id}-node-${i}`).absolute().left(5 + i * 9).top(8).size(5).rounded(1).bg(color)
      .when(motion, el => el.loop("opacity", { from: 0.25, to: 1, period: 1100 + i * 280 })));
  }
  return panel;
}

export function workshopActivity(view, home, bounds, t) {
  t=skin(t);
  const workers = home.agents.filter(a => a.status === "working").sort((a, b) => b.seq - a.seq);
  const waiting = home.agents.filter(a => a.status === "blocked").sort((a,b) => b.seq-a.seq);
  if (!workers.length && !waiting.length) return [];
  const busy = workers.length > 0, relevant = busy ? workers : waiting;
  const records = terminals();
  const primary = relevant[0], activity = reportedActivity(primary, records);
  const { x, y, w, h } = bounds;
  const motion = typeof view.motionOn==="function"?view.motionOn():view.motion!==false&&shared("neon.motion")!==false;
  const color = busy ? t.working : t.blocked;
  const id = `workshop-${home.space.id}`;
  const width = Math.max(118, Math.min(218, w + 8));
  const cx = Math.round(x + (w - width) / 2);
  const top = Math.max(4, Math.round(y - 77));
  const details = relevant.map(a => `${characterOf(a.address).name} · ${busy ? "working" : "needs you"}\n${reportedActivity(a, records).title}`).join("\n\n");
  const content = v_flex().flex_1().min_w(0).gap(3)
    .child(div().text_size(8).font_bold().text_color(color).child(`${busy ? "WORKING" : "NEEDS YOU"} · ${relevant.length} ${relevant.length === 1 ? "AGENT" : "AGENTS"}`))
    .child(div().w_full().truncate().text_size(10.5).text_color(t.foreground).child(activity.title));
  const console = h_flex().id(id).absolute().left(cx).top(top).w(width).h(45).px(7).gap(7).items_center()
    .rounded(3).bg(t.popover).border_1().border_color(`${color}88`).cursor_pointer()
    .tooltip(`Reported activity\n${details}\n\nSelect to focus ${characterOf(primary.address).name}`)
    .on_click(() => { run("layout.select", { stack: "root", child: "desktop" }); run("agent.focus", { terminal: primary.address }); })
    .on_mouse_down("right", (_event, context) => { context.stop_propagation(); view.profile(primary.address); })
    .child(instrument(id, busy ? activity.kind : "waiting", color, motion, t)).child(content);
  const out = view.activityInRoster ? [] : [console];
  // Slim powered brackets sit at the facade edges instead of obscuring its art.
  for (let i = 0; i < 2; i++) {
    const bx = Math.round(i ? x + w - 3 : x + 2), by = Math.round(y + h * 0.32), bh = Math.round(h * 0.57);
    out.push(div().absolute().left(bx).top(by).w(2).h(bh).bg(`${color}33`));
    out.push(div().id(`${id}-pulse-${i}`).absolute().left(bx).top(by).w(2).h(busy ? Math.max(8, bh * 0.15) : bh).bg(color)
      .when(motion && busy, el => el.loop("top", { from: by + bh - 10, to: by, period: 1900 + i * 300, easing: "linear" }))
      .when(motion && !busy, el => el.loop("opacity", {from:0.35,to:0.65,period:2200})));
    out.push(div().absolute().left(i ? bx - 7 : bx).top(by).w(9).h(2).bg(`${color}aa`));
    out.push(div().absolute().left(i ? bx - 7 : bx).top(by + bh).w(9).h(2).bg(`${color}aa`));
  }
  return out;
}
