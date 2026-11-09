import {View,div,svg} from "gpui-kit";
import {h_flex,v_flex} from "gpui-base";
import {settings,setShared,appHome,readTextFile,writeTextFile,props,closeOverlay} from "herdr";
import {skin} from "./theme-tokens.js";
import {bevel} from "./controls.js";
import {panelSkin} from "./panel-skin.js";
import {requestFrame} from "./request-skin.js";
import {preferences,PREFERENCES,emitSound} from "./notifications.js";
import {notificationCard} from "./card.js";

const CUES = [
  ["success", "Completed", "Agents finish · files saved · PRs merged", "Rising synth transmission"],
  ["warning", "Needs you", "Agent input · approval and secret requests · quota alerts", "Double pulse · waiting for input"],
  ["error", "Something failed", "Failed transfers, saves and merge requests", "Descending digital warning"],
  ["info", "Quiet updates", "Schedules and account changes", "Brief interface chirp"],
];

export default class Alerts extends View {
  init(_p,cx) { this.busy=false;this.error="";this.selected="success";this.handle=cx.focus_handle();this.handle.focus(); }
  close() { closeOverlay(props()?.overlay); }
  button(id,label,click,t,active=false) {
    return bevel(h_flex().id(id).h(30).px(10).items_center().flex_none(),active)
      .text_size(11).text_color(active?t.accent:t.muted).on_mouse_down("left",(_e,cx)=>cx.stop_propagation()).on_click(click).child(label);
  }
  master(cx) {
    if(this.busy)return;
    this.busy=true;this.error="";cx.notify();
    cx.spawn(async cx=>{
      try {
        const path=`${appHome()}/settings.json`, before=await readTextFile(path);
        const value=before?JSON.parse(before):{};
        value.sounds={...value.sounds,enabled:settings()?.sounds?.enabled===false};
        await writeTextFile(path,JSON.stringify(value,null,2)+"\n",before);
      } catch { this.error="Settings changed or could not be saved. Please try again."; }
      this.busy=false;cx.notify();
    });
  }
  toggle(key) { const value=preferences();setShared(PREFERENCES,{...value,[key]:key==="info"?value[key]!==true:value[key]===false}); }
  row(key,title,detail,t) {
    const p=preferences(),on=key==="info"?p[key]===true:p[key]!==false;
    return h_flex().w_full().min_w(0).gap(12).items_center().py(7)
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_size(12).font_semibold().child(title))
        .child(div().text_size(10).text_color(t.muted).whitespace_normal().child(detail)))
      .child(this.button(`alert-${key}`,on?"On":"Off",()=>this.toggle(key),t,on));
  }
  render() {
    const t=skin(),enabled=settings()?.sounds?.enabled!==false;
    const content=v_flex().size_full().min_w(0).min_h(0).bg(t.background).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e,cx)=>{if(e.key==="escape"){cx.stop_propagation();this.close();}})
      .child(h_flex().h(56).flex_none().px(16).gap(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
        .child(svg("mods/neon-status/sound.svg").size(21).text_color(t.accent))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(17).font_semibold().child("Sounds & alerts"))
          .child(div().text_size(10).text_color(t.muted).child("Cyberpunk signals · tuned for your workspace")))
        .child(this.button("alerts-close","×",()=>this.close(),t)))
      .child(div().flex_none().px(14).pt(12).child(requestFrame(v_flex().p(12).gap(5).min_w(0),t)
          .child(h_flex().gap(10).items_center()
            .child(v_flex().flex_1().min_w(0).gap(4)
              .child(div().font_semibold().text_size(13).child("All notification sounds"))
              .child(div().text_size(10).text_color(t.muted).whitespace_normal().child("Master sound switch for Herdr and custom panels.")))
            .child(this.button("alerts-master",this.busy?"Saving…":enabled?"Sound on":"Muted",(_e,cx)=>this.master(cx),t,enabled)))
          .when(Boolean(this.error),el=>el.child(div().text_size(11).text_color(t.danger).whitespace_normal().child(this.error)))))
      .child(v_flex().id("alerts-scroll").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(14).gap(12)
        .child(v_flex().flex_none().gap(7).min_w(0).children(CUES.map(([level,title,detail,motif])=>{
          const color=t[{success:"done",warning:"warning",error:"danger",info:"accent"}[level]];
          return requestFrame(h_flex().flex_none().min_w(0).gap(10).p(10).items_center(),t)
            .child(svg(`mods/neon-toast/art/${level}.svg`).size(18).flex_none().text_color(color))
            .child(v_flex().flex_1().min_w(0).gap(3)
              .child(div().text_size(12).font_semibold().child(title))
              .child(div().text_size(10).text_color(t.muted).whitespace_normal().child(detail))
              .child(div().text_size(9).text_color(t.dim).child(motif)))
            .child(this.button(`preview-${level}`,"Preview",(_e,cx)=>{this.selected=level;emitSound(level,{preview:true});cx.notify();},t,this.selected===level));
        })))
        .child(div().h(76).flex_none().min_w(0).child(notificationCard({level:this.selected,title:`${CUES.find(c=>c[0]===this.selected)[1]} · preview`,body:"Matching signals from agents and your custom panels"},{activate:()=>{},dismiss:()=>{}})))
        .child(v_flex().flex_none().min_w(0).border_t(1).border_color(t.border).pt(6)
          .child(div().text_size(10).text_color(t.accent).font_semibold().child("CUSTOM PANEL ALERTS"))
          .child(this.row("sound","Task sounds","PRs, requests, files and usage alerts.",t))
          .child(this.row("toast","Show notifications","Requests remain in their panels when notifications are hidden.",t))
          .child(this.row("info","Sound for quiet updates","Off by default. Copying paths stays silent.",t))))
      .child(div().flex_none().px(16).py(10).border_t(1).border_color(t.border).text_size(9).text_color(t.dim).whitespace_normal()
        .child(enabled?"Preview respects the master switch. Sounds are spaced to avoid overlapping alerts.":"All sounds are muted, including previews. Visual notifications stay available."));
    return div().size_full().flex().items_center().justify_center().child(div().w_full().h_full().max_w(580).max_h(740).min_w(0).min_h(0).child(panelSkin(content,t)));
  }
}
