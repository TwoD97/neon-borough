import {cardState,frameAsset} from "./card-state.js";
import {providerFrame,providerGeometry} from "./provider-skin.js";
import {skin,art,artText,mix} from "./theme-tokens.js";
import {townLayout} from "./town-layout.js";
import {reportedActivity} from "./activity-data.js";
import { bevel } from "./controls.js";
import { panelSkin } from "./panel-skin.js";
import { petDock } from "./pet.js";
import { profileCard } from "./profile.js";
import { initNamePrompt, namePrompt } from "./name-prompt.js";
import { startCompanionExport } from "./companion-export.js";
// Crew: every agent is an original AI-generated robot (see ART.md), with a name, a role, a personality
// and lines it says. The robots stand in their space's room and act out the agent's status
// (idle, working, needs you, done); the glow under each one and its badge are the provider's
// color. Three ways to show it, by props:
//   (none)            the crew, room by room, grouped by machine (the Crew panel or a tab)
//   { pet: true }     a small floating robot for the agent you're working with
//   { profile: addr } an agent's profile card (a dialog): who plays it, and recasting it
// The Spaces page (my-spaces) filters the rooms like it filters the lists.
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, focused, run, theme, props, openOverlay, closeOverlay, layout, window as appWindow, setShared, shared, settings, terminals } from "herdr";
import { renderTown, townAspect, whoList, townModel, ALL_HOUSES, setHouse } from "./town.js";
import { spriteEl, frameFor, townTick, townFrames } from "./town-actors.js";
import { CHARACTERS, characterOf, provider, spriteFor, still, castNew, recast, line, actOf, stepRobots } from "./cast.js";
import { keyOf, label as machineLabel, ordered as orderMachines, inPage, currentPage, pages } from "./machines.js";

const STATUS_WORD = { working: "working", blocked: "needs you", done: "done", idle: "idle" };
const machineOfAgent = (a) => (a.address.includes("/") ? a.address.split("/")[0] : null);

function openProfile(address) {
  openOverlay({ mod: "crew", kind: "dialog", frame: "none", width: 620, height: 480, props: { profile: address } });
}

export default class Crew extends View {
  init(_props, cx) {
    if (props()?.renameCompanion) { initNamePrompt(this, cx); return; }
    this.hover = null;
    if (props()?.pet) startCompanionExport(cx);
    // One pet at a time: a new pet window closes any older one.
    if (props()?.petWindow) {
      const prev = shared("crew.petWindow");
      if (prev && prev !== props().overlay) closeOverlay(prev);
      setShared("crew.petWindow", props().overlay);
    }
    if (props()?.pet) {
      const previous = shared("crew.petWindow");
      if (previous) { closeOverlay(previous); setShared("crew.petWindow", null); }
      return;
    }
    this.mode = props()?.cards ? "crew" : "town";
    this.district = 0;
    this.width = 0;
    this.height = 0;
    this.filter = "all";
    this.motion = true;
    // Working robots step on a shared 300 ms clock; idle residents need no redraw.
    stepRobots(cx);
    // The town's own clock: sprite frames and walks, only while the town is on screen.
    cx.timer.every(140, (cx) => { if (this.townShown()) townTick(this, cx, townFrames(this, this.motionOn())); });
  }

  profile(address) { openProfile(address); }

  motionOn() { return appWindow()?.active !== false && this.motion !== false && shared("neon.motion") !== false; }

  townShown() {
    const p = props() ?? {};
    if (p.pet || p.profile || this.mode !== "town" || appWindow()?.active === false) return false;
    if (p.tab) return true;
    if (p.full) return layout()?.active === "crew-screen" && this.motion;
    const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).reduce((f, c) => f ?? find(c, id), null));
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    return false;
  }

  townGeometry() {
    const zoom=settings().zoom||1;
    return townLayout(this.width/zoom,this.height/zoom,townAspect);
  }

  mapWidth() { return this.townGeometry().scene; }

  control(id, label, action, t, active = false) {
    return bevel(h_flex().id(id).h(30).px(10).gap(6).flex_none().items_center(), active)
      .text_size(11).text_color(active ? t.accent : t.muted).hover(s => s.opacity(0.85).text_color(t.foreground))
      .on_click(action).child(label);
  }

  header(t) {
    const full = props()?.full || props()?.tab;
    return h_flex().h(full ? 64 : 48).flex_none().px(full ? 24 : 12).gap(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(svg("mods/crew/robot.svg").size(22).text_color(t.accent))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().font_bold().text_size(full ? 18 : 14).child(full ? "NEON BOROUGH" : "Crew"))
        .when(full, el => el.child(div().text_size(10).text_color(t.dim).child("YOUR AGENTS. ONE LIVING CITY."))))
      .when(full, el => el.child(this.control("mode-town", "Town", (_e,cx) => {this.mode="town";if(props()?.full) run("layout.select",{stack:"root",child:"crew-screen"});cx.notify();},t,this.mode==="town"))
        .child(this.control("mode-crew", "Cards", (_e,cx) => {this.mode="crew";if(props()?.full) run("layout.select",{stack:"root",child:"crew-cards"});cx.notify();},t,this.mode==="crew")))
      .child(this.control("crew-expand", full ? "Back to workspace" : "Open town", () => run("layout.select", {stack:"root",child:full ? "desktop" : "crew-screen"}),t))
      .when(full && appWindow()?.buttons, el => el.child(this.control("crew-min", "−",()=>run("window.minimize"),t)).child(this.control("crew-max", "□",()=>run("window.maximize"),t)));
  }

  townView(t) {
    castNew(agents());
    const g=this.townGeometry();
    // Detailed activity belongs in the roster; buildings retain live status FX.
    this.activityInRoster=true;
    const {el,model}=renderTown(this,t,g.scene,g.sceneHeight);
    const rank={blocked:0,working:1,done:2,idle:3};
    const list=model.homes.flatMap(home=>home.agents).sort((a,b)=>(rank[a.status]??4)-(rank[b.status]??4));
    const records=terminals();
    const count=status=>list.filter(a=>a.status===status).length;
    const meter=(label,value,color)=>h_flex().gap(5).items_center().flex_none()
      .child(div().size(4).bg(color)).child(div().text_size(10).text_color(t.muted).child(`${value} ${label}`));
    const resident=a=>{
      const ch=characterOf(a.address),pv=provider(a),activity=reportedActivity(a,records);
      const cw=g.wide?g.roster-4:residentWidth,look=providerGeometry(pv,cw,t);
      const stateColor=a.status==="working"?t.working:a.status==="blocked"?t.blocked:a.status==="done"?t.done:t.dim;
      const tone=look.onLight?stateColor:mix(stateColor,"#e6edf7",.35);
      return providerFrame(div(),pv,cw,t,a).id(`town-resident-${a.address}`).w(cw).h(look.height).flex_none().cursor_pointer()
        .tooltip(`${ch.name} · ${pv.name} · ${a.space_name||"Workspace"}\n${a.title||a.tab_name||ch.role}\n${activity.detail||activity.title}\nSelect to focus · Right-click for profile`)
        .on_click(()=>{run("layout.select",{stack:"root",child:"desktop"});run("agent.focus",{terminal:a.address});})
        .on_mouse_down("right",(_e,cx)=>{cx.stop_propagation();this.profile(a.address);})
        .child(div().absolute()
          .left(look.portraitX-look.portraitHeight*.375).top(look.portraitY-look.portraitHeight*.5)
          .w(look.portraitHeight*.75).h(look.portraitHeight)
          .child(spriteEl(this,`still:${a.address}`,frameFor(a,null,Date.now(),this.motionOn()))))
        .child(v_flex().absolute().left(look.textLeft).right(look.textRight).top(look.textTop).bottom(look.textBottom).justify_center().gap(3)
          .child(h_flex().h(13).min_w(0).gap(4).items_center()
            .child(div().flex_1().min_w(0).truncate().font_bold().text_size(11).text_color(look.onLight?mix(ch.color,"#102030",.57):ch.color).child(ch.name))
            .child(div().size(3).flex_none().bg(tone).when(this.motionOn()&&a.status==="blocked",el=>el.loop("opacity",{from:.55,to:1,period:2200})))
            .child(div().text_size(9).text_color(tone).child(STATUS_WORD[a.status]||a.status)))
          .child(div().h(14).min_w(0).truncate().text_size(11).text_color(look.ink).child(a.title||a.tab_name||ch.role))
          .child(div().h(12).min_w(0).truncate().text_size(10).text_color(activity.reported?look.accent:look.muted).child(activity.title))
          .child(div().h(12).min_w(0).truncate().text_size(9).text_color(look.dim).child(`${a.space_name||"Workspace"} · ${pv.name}`)))
        .when(a.focused,el=>el.child(div().absolute().left(look.textLeft).right(look.textRight).bottom(look.height*.16).h(1).bg(look.accent).opacity(.7)));
    };
    const page=currentPage()?.name||"All districts";
    const toolbar=h_flex().w_full().min_w(0).flex_none().px(20).py(10).gap(8).flex_wrap().items_center()
      .child(div().text_size(10).font_bold().text_color(t.dim).child("DISTRICT"))
      .children([{id:null,name:"All"},...pages()].map(p=>this.control(`town-${p.id}`,p.name,()=>{this.district=0;setShared("machines.page",p.id);},t,p.id===(currentPage()?.id??null))))
      .when(model.districts>1,node=>node.children(Array.from({length:model.districts},(_,i)=>this.control(`district-${i}`,`${i+1}`,(_e,cx)=>{this.district=i;cx.notify();},t,i===model.district))))
      .child(div().flex_1())
      .child(this.control("town-motion",this.motionOn()?"Motion on":"Motion off",(_e,cx)=>{
        if(shared("neon.motion")===false){setShared("neon.motion",true);this.motion=true;}else this.motion=!this.motion;
        cx.notify();
      },t,this.motionOn()));
    const rosterColumns=g.wide?1:Math.max(1,Math.min(3,Math.floor((g.width+8)/300)));
    const residentWidth=Math.floor((g.width-8*(rosterColumns-1))/rosterColumns);
    const residentList=(g.wide?v_flex():h_flex().flex_wrap()).id("town-residents").w_full().min_w(0).min_h(0).gap(8)
      .when(g.wide,e=>e.flex_1().overflow_y_scrollbar().pr(4))
      .children(list.map(a=>resident(a).when(!g.wide,e=>e.w(residentWidth))))
      .when(!list.length,e=>e.child(div().p(14).text_size(12).text_color(t.muted).child("Start an agent in this district to welcome its first resident.")));
    const roster=v_flex().w(g.wide?g.roster:g.width).min_w(0).flex_none().gap(9)
      .when(g.wide,e=>e.h(g.height))
      .child(h_flex().h(30).flex_none().px(2).gap(8).items_center()
        .child(div().w(3).h(11).bg(t.accent))
        .child(div().flex_1().text_size(11).font_semibold().text_color(t.foreground).child("RESIDENTS"))
        .child(div().text_size(10).text_color(t.dim).child(`${list.length}`)))
      .child(residentList);
    const scene=v_flex().w(g.sceneFrame).flex_none().gap(8)
      .child(div().w(g.sceneFrame).h(g.height).flex_none().child(panelSkin(el)))
      .child(h_flex().w_full().px(6).gap(8).flex_wrap().items_center().text_size(10).text_color(t.dim)
        .child(div().child("Select a building or resident to return to work"))
        .child(div().flex_1()).child(div().child("Right-click to customise")));
    const composition=(g.wide?h_flex():v_flex()).w(g.width).flex_none().gap(g.gap).items_start().child(scene).child(roster);
    return v_flex().size_full().min_h(0).child(this.header(t)).child(toolbar)
      .child(v_flex().id("town-stage-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(20).pb(20).gap(10).items_center()
        .child(h_flex().w(g.width).min_h(28).flex_none().gap(12).flex_wrap().items_center()
          .child(div().flex_1().min_w(80).truncate().text_size(12).font_semibold().text_color(t.foreground).child(`${page} · ${model.homes.length} spaces`))
          .child(meter("working",count("working"),t.working))
          .child(meter("need you",count("blocked"),t.blocked))
          .child(meter("idle",count("idle"),t.dim)))
        .child(composition));
  }

  cardsView(t) {
    const list=agents().filter(a=>inPage(keyOf(machineOfAgent(a))));
    castNew(agents());
    const available=this.width / (settings().zoom || 1)-48;
    const columns=Math.max(1,Math.min(3,Math.floor((available+18)/378)));
    const width=Math.max(240,Math.min(500,(available-18*(columns-1))/columns));
    const cardHeight=Math.round(width*2/3);
    return v_flex().size_full().child(this.header(t))
      .child(v_flex().id("crew-cards").flex_1().min_h(0).overflow_y_scrollbar().p(24).gap(18)
        .child(div().text_size(24).font_bold().child("Meet your night shift."))
        .child(div().text_size(12).text_color(t.muted).child("Each resident has a role, a personality, and a job in progress. Select a card to return to their terminal."))
        .child(h_flex().flex_wrap().justify_center().gap(18).children(list.map(a=>{
          const ch=characterOf(a.address),pv=provider(a),tone=a.status==="blocked"?t.blocked:a.status==="working"?t.working:a.status==="done"?t.done:t.muted;
          return div().id(`identity-${a.address}`).relative().w(width).h(cardHeight).flex_none().rounded(12).overflow_hidden()
            .bg(t.background).border_1().border_color(a.focused?ch.color:t.border).cursor_pointer().hover(st=>st.border_color(ch.color))
            .tooltip(`${ch.personality}\nRight-click to change character`)
            .on_click(()=>{run("layout.select",{stack:"root",child:"desktop"});run("agent.focus",{terminal:a.address});})
            .on_mouse_down("right",(_e,cx)=>{cx.stop_propagation();this.profile(a.address);})
            .child(image(art("mods/crew/art/agent-dock.png",t)).absolute().top(0).left(0).w(width).h(cardHeight))
            .child(div().absolute().top(18).left(18).px(8).py(4).rounded(4).bg(t.surface).text_size(10).text_color(tone).child((STATUS_WORD[a.status]||"idle").toUpperCase()))
            .child(div().absolute().top(18).right(18).text_size(10).text_color(ch.color).child(ch.role.toUpperCase()))
            .child(div().absolute().top(cardHeight*0.62).left(width/2-42).w(84).h(8).rounded(99).bg(tone+"55")
              .when(this.motionOn() && a.status === "working",el=>el.loop("opacity",{from:0.35,to:0.85,period:1200}))
              .when(this.motionOn() && a.status === "blocked",el=>el.loop("opacity",{from:0.55,to:0.85,period:2200})))
            .child(image(spriteFor(a,this.motionOn())).absolute().top(cardHeight*0.12).left(width/2-cardHeight*0.165).w(cardHeight*0.33).h(cardHeight*0.44))
            .child(v_flex().absolute().top(cardHeight*0.69).left(20).right(20).gap(3)
              .child(h_flex().items_center().gap(8).child(div().text_size(20).font_bold().text_color(artText("mods/crew/art/agent-dock.png",t).foreground).child(ch.name)).child(div().flex_1()).child(div().text_size(10).text_color(pv.color).child(pv.name)))
              .child(div().truncate().text_size(12).text_color(artText("mods/crew/art/agent-dock.png",t).foreground).child(a.title||a.tab_name||ch.role))
              .child(div().truncate().text_size(11).text_color(artText("mods/crew/art/agent-dock.png",t).muted).child(a.space_name||"Workspace"))
              );
        })))
        .when(!list.length,el=>el.child(div().p(24).text_color(t.muted).child("Start an agent to welcome your first resident."))));
  }

  // Compact, actionable roster for the side panel.
  rosterView(t) {
    const rank = { blocked: 0, working: 1, done: 2, idle: 3 };
    const list = agents().filter((a) => inPage(keyOf(machineOfAgent(a))) && (this.filter === "all" || a.status === this.filter))
      .sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4));
    castNew(agents());
    const cw=Math.max(240,this.width/(settings().zoom||1)-20), rh=cw/3, scale=Math.max(1,Math.min(1.45,cw/360));
    return v_flex().size_full().child(this.header(t))
      .child(h_flex().p(8).gap(4).flex_wrap().children([['all','All'],['working','Working'],['blocked','Needs you'],['done','Done']].map(([id,name])=>this.control(`filter-${id}`,name,(_e,cx)=>{this.filter=id;cx.notify();},t,this.filter===id))))
      .child(h_flex().h(30).px(12).gap(8).items_center().text_size(10).font_bold().text_color(t.dim)
        .child(div().flex_1().child("CREW MANIFEST")).child(div().child(`${list.length} RESIDENTS`)))
      .child(v_flex().id("crew-roster").flex_1().min_h(0).overflow_y_scrollbar().px(10).pb(12).gap(8)
        .when(!list.length, (el) => el.child(div().p(16).text_size(12).text_color(t.muted).child(this.filter === "all" ? "Your crew will appear here when agents start." : "No agents with this status.")))
        .children(list.map((a) => {
          const ch = characterOf(a.address), pv = provider(a);
          const tone = a.status === "blocked" ? t.blocked : a.status === "working" ? t.working : a.status === "done" ? t.done : t.dim;
          return div().id(`roster-${a.address}`).relative().w_full().h(rh*0.88).flex_none().cursor_pointer()
            .tooltip(`${ch.name} · ${pv.name} · ${a.space_name || ""}\n${a.title || a.tab_name || ""}\nClick to focus · Right-click for profile`)
            .on_click(() => { run("layout.select", { stack: "root", child: "desktop" }); run("agent.focus", { terminal: a.address }); })
            .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.profile(a.address); })
            .child(image(frameAsset(art("mods/crew/art/crew-component.png",t),cardState(a.status).powered)).absolute().top(-rh*0.04).left(0).w(cw).h(rh))
            .when(!t.light&&cardState(a.status).powered,el=>el.child(image("mods/crew/art/card-inlay-agent.svg").absolute().top(-rh*0.04).left(0).w(cw).h(rh)))
            .child(image(spriteFor(a,this.motionOn())).absolute().top(rh*0.20).left(cw*0.074).w(rh*0.39).h(rh*0.52))
            .child(v_flex().absolute().left(cw*0.26).right(cw*0.055).top(rh*0.16).bottom(rh*0.12).justify_center().gap(3*scale).line_height(1.1)
              .child(h_flex().items_center().gap(6*scale)
                .child(div().font_bold().text_size(12*scale).text_color(t.light?t.foreground:ch.color).child(ch.name))
                .child(div().flex_1())
                .child(div().text_size(10*scale).text_color(tone).child(STATUS_WORD[a.status]??a.status)
                  .when(this.motionOn() && a.status === "blocked", el => el.loop("opacity", {from:0.6,to:1,period:2200}))))
              .child(div().truncate().text_size(11*scale).text_color(artText("mods/crew/art/crew-component.png",t).foreground).child(a.title||a.tab_name||ch.role))
              .child(div().truncate().text_size(10*scale).text_color(artText("mods/crew/art/crew-component.png",t).muted).child(a.space_name||pv.name)));
        })));
  }

  // ---- One robot standing in a room.
  robot(a, t, size = 1) {
    const ch = characterOf(a.address), pv = provider(a), act = actOf(a.status);
    const w = Math.round(82 * size), h = Math.round(109 * size);
    const needs = a.status === "blocked", done = a.status === "done";
    const bubbleColor = needs ? t.blocked : done ? t.done : act === "working" ? ch.color : t.dim;
    return v_flex().id(`bot-${a.address}`).w(Math.round(122 * size)).flex_none().items_center().gap(3).py(6).rounded(10).cursor_pointer()
      .when(a.focused, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .tooltip(`${ch.name} · ${ch.role}\n${ch.personality}\n${pv.name} · ${STATUS_WORD[a.status] ?? a.status}\n${a.title || a.tab_name || ""}`)
      .on_click(() => { run("layout.select", { stack: "root", child: "desktop" }); run("agent.focus", { terminal: a.address }); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openProfile(a.address); })
      // What it says: louder when it needs you or just finished.
      .child(div().max_w(Math.round(118 * size)).px(7).py(3).rounded(8).border_1().border_color(bubbleColor).bg(t.raised)
        .text_size(10.5).text_color(needs || done ? bubbleColor : t.foreground).truncate()
        .when(needs && this.motionOn(), (el) => el.loop("opacity", { from: 0.65, to: 1, period: 2200 }))
        .child(line(a, ch)))
      .child(div().relative().w(w + 10).h(h + 6).flex_none()
        // The provider's glow on the floor under its feet.
        .child(div().absolute().bottom(0).left(Math.round(w * 0.12)).w(Math.round(w * 0.86)).h(Math.round(12 * size)).rounded(99).bg(`${pv.color}66`))
        .child(div().absolute().bottom(3).left(Math.round(w * 0.25)).w(Math.round(w * 0.6)).h(Math.round(6 * size)).rounded(99).bg(`${pv.color}aa`))
        .child(image(spriteFor(a, this.motionOn())).absolute().top(0).left(5).w(w).h(h)))
      .child(div().text_size(11.5).font_bold().text_color(t.light?t.foreground:ch.color).child(ch.name))
      .child(div().max_w(Math.round(114 * size)).truncate().text_size(10.5).text_color(t.dim).child(a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : a.title || ch.role))
      .child(h_flex().h(17).px(6).gap(4).items_center().rounded(5).bg(`${pv.color}2a`).border_1().border_color(`${pv.color}80`)
        .child(div().size(6).rounded(3).bg(pv.color))
        .child(div().text_size(10).text_color(pv.color).child(pv.name)));
  }

  // ---- A space's room.
  room(space, list, t) {
    const working = list.filter((a) => a.status === "working").length;
    const needs = list.filter((a) => a.status === "blocked").length;
    return v_flex().id(`room-${space.id}`).flex_none().min_w(150).max_w_full().rounded(12).bg(t.surface).border_1().border_color(needs ? t.blocked : space.active ? t.border : t.border).overflow_hidden()
      .child(h_flex().id(`room-head-${space.id}`).h(32).px(12).gap(8).items_center().border_b(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => run("space.select", { id: space.id }))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(space.name))
        .when(working > 0, (el) => el.child(div().text_size(11).text_color(t.working).child(`${working} working`)))
        .when(needs > 0, (el) => el.child(div().text_size(11).text_color(t.blocked).child(`${needs} need you`)))
        .child(div().text_size(11).text_color(t.dim).child(`${list.length} ${list.length === 1 ? "agent" : "agents"}`)))
      .child(h_flex().flex_wrap().gap(4).p(8).bg(t.raised).children(list.map((a) => this.robot(a, t))));
  }

  crewView(t) {
    const all = agents();
    castNew(all);
    const list = all.filter((a) => inPage(keyOf(machineOfAgent(a))));
    const sp = spaces();
    const working = list.filter((a) => a.status === "working").length, needs = list.filter((a) => a.status === "blocked").length;
    const keys = orderMachines(list.map((a) => keyOf(machineOfAgent(a))));
    const header = this.header(t);
    if (!list.length) {
      return v_flex().size_full().child(header)
        .child(v_flex().flex_1().items_center().justify_center().gap(14).px(20)
          .child(h_flex().gap(2).p(10).rounded(12).bg(t.surface).children(CHARACTERS.map((c) => image(still(c.id)).w(46).h(61).opacity(0.75))))
          .child(div().font_medium().child("The crew is waiting"))
          .child(div().text_center().text_size(12).text_color(t.dim).child("Start an agent (+ in the tab bar) and a robot takes the job.")));
    }
    const groups = keys.flatMap((key) => {
      const mine = sp.filter((s) => keyOf(s.machine) === key)
        .map((s) => [s, list.filter((a) => a.space === s.id)]).filter(([, l]) => l.length);
      if (!mine.length) return [];
      return [div().pt(8).pb(2).px(2).text_size(11.5).font_medium().text_color(t.dim).child(machineLabel(key)),
        h_flex().w_full().flex_wrap().items_start().gap(8).children(mine.map(([s, l]) => this.room(s, l, t)))];
    });
    return v_flex().size_full().child(header)
      .child(v_flex().id("crew-rooms").flex_1().min_h(0).overflow_y_scrollbar().px(10).pb(12).gap(8).children(groups));
  }

  // ---- The pet: the agent you're in (else one that needs you), small, in a corner.
  petView(t) {
    const all = agents();
    const a = all.find((x) => x.focused) ?? all.find((x) => x.address === focused()?.terminal) ?? all.find((x) => x.status === "blocked");
    if (!a) return div().size_full();
    const ch = characterOf(a.address), pv = provider(a);
    const loud = a.status === "blocked" || a.status === "done";
    const bubble = a.status === "blocked" ? t.blocked : t.done;
    // Just the robot: no card, no background. A speech bubble only when it has something to say.
    return v_flex().id("pet").size_full().items_center().justify_end()
      .tooltip(`${ch.name} · ${ch.role} · ${pv.name}
${line(a, ch)}`)
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openProfile(a.address); })
      .when(loud, (el) => el.child(div().px(8).py(3).mb(2).rounded(10).bg(bubble).text_size(11).font_bold().text_color(t.solid_foreground)
        .when(a.status === "blocked" && this.motionOn(), (b) => b.loop("opacity", { from: 0.65, to: 1, period: 2200 })).child(line(a, ch))))
      .child(div().relative().w(96).h(118).flex_none()
        .child(div().absolute().bottom(2).left(24).w(48).h(7).rounded(99).bg(`${pv.color}77`))
        .child(image(spriteFor(a, this.motionOn())).absolute().top(0).left(4).w(88).h(117)));
  }

  // ---- Choosing a space's house.
  housePickerView(t) {
    const id = props().housePicker, close = () => closeOverlay(props().overlay);
    const space = spaces().find((s) => s.id === id);
    const cur = (shared("town.houses.v2") ?? {})[id];
    return v_flex().id("house-picker").size_full().bg(t.surface).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(h_flex().h(46).flex_none().px(16).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(14).font_semibold().child(`A house for ${space?.name ?? "this space"}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().id("house-grid").flex_1().min_h(0).overflow_y_scrollbar().p(12)
        .child(h_flex().flex_wrap().gap(8).children(ALL_HOUSES.map((h) => {
          const on = h.id === cur, k = Math.min(108 / h.w, 88 / h.h);
          return v_flex().id(`hp-${h.id}`).w(124).h(122).items_center().justify_end().gap(4).pb(6).rounded(10).cursor_pointer()
            .bg(on ? t.selected : t.raised).border_1().border_color(on ? t.accent : t.border).hover((st) => st.border_color(h.accent))
            .on_click(() => { setHouse(id, h.id); close(); })
            .child(image(h.file).w(Math.round(h.w * k)).h(Math.round(h.h * k)))
            .child(div().max_w(116).truncate().text_size(10.5).text_color(on ? t.accent : t.dim).child(h.name));
        }))));
  }

  // The profile shares the native frame and bevel controls with the workspace.
  profileView(t) { return profileCard(t, this.motionOn()); }

  render() {
    const p = props() ?? {};
    // Root stacks stay mounted. Do not build the hidden city/cards, decode its
    // art, or assign residents just because another surface changed theme.
    if (p.full && layout()?.active !== (p.cards ? "crew-cards" : "crew-screen")) return div().size_full();
    const t = skin();
    if (p.renameCompanion) return namePrompt(this, t);
    if (p.profile) return this.profileView(t);
    if (p.housePicker) return this.housePickerView(t);
    if (p.pet) return petDock(t, openProfile, this);
    if (p.petWindow) return this.petView(t);
    const view = v_flex().id("crew-root").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 4 || Math.abs(size.height - this.height) > 4) { this.width = size.width; this.height = size.height; cx.notify(); } })
      .on_key_down((e,cx) => { if (p.full && e.key === "escape") { run("layout.select",{stack:"root",child:"desktop"});cx.stop_propagation(); } })
      // Measure the active surface first; a fallback-size world would be built
      // and discarded immediately by the first size notification.
      .when(this.width > 0 && this.height > 0, el=>el.child((p.full || p.tab) ? (this.mode === "town" ? this.townView(t) : this.cardsView(t)) : this.rosterView(t)));
    return p.full || p.tab ? view : panelSkin(view);
  }
}
