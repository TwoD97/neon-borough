import {View,div,svg} from "gpui-kit";
import {v_flex,h_flex} from "gpui-base";
import {appHome,exec,run,props,closeOverlay,window as appWindow,settings,setShared,spaces,home} from "herdr";
import {skin} from "./theme-tokens.js";
import {bevel} from "./controls.js";
import {panelSkin} from "./panel-skin.js";
import {requestFrame} from "./request-skin.js";
import {PROVIDERS,normalizeSnapshot,tokenLabel,tokenMetrics,percentLabel,resetLabel,reportedLabel,refreshDue} from "./model.js";
import {notify} from "./notifications.js";
import {ALERT_STATE_KEY,usageAlerts} from "./usage-alerts.js";

export default class Usage extends View {
  init(_props,cx) {
    this.handle=cx.focus_handle();this.handle.focus();
    this.snapshot=null;this.error="";this.loading=false;this.lastAttempt=0;this.width=720;this.now=Date.now();
    this.refresh(cx);
    cx.timer.every(60000,cx=>{
      if(refreshDue(Date.now(),this.lastAttempt,appWindow()?.active!==false,this.handle.is_focused(),this.loading))this.refresh(cx);
    });
  }
  helper(){return `${appHome()}/mods/neon-usage/usage-monitor.py`;}
  close(){closeOverlay(props()?.overlay);}
  refresh(cx,manual=false) {
    if(this.loading)return;
    this.loading=true;this.error="";this.lastAttempt=Date.now();
    cx.spawn(async cx=>{
      try{
        const result=await exec("python",[this.helper(),"snapshot"]);
        if(result.code!==0)throw new Error(`Usage helper failed${typeof result.code==="number"?` (exit ${result.code})`:""}. Try Refresh.`);
        let data;try{data=JSON.parse(result.stdout);}catch{throw new Error("The usage helper returned unreadable data. Try Refresh.");}
        this.snapshot=normalizeSnapshot(data);
        setShared("usage.snapshot",this.snapshot);
        this.announceUsage();
      }catch(error){
        this.error=String(error?.message||"Could not load usage.");
        if(manual)notify({title:"Usage refresh failed",body:this.error,level:"error"},{key:"usage-refresh-failed",category:"usage",dedupeMs:60000});
      }
      this.loading=false;this.now=Date.now();cx.notify();
    });
    cx.notify();
  }
  announceUsage() {
    let previous;
    try{previous=JSON.parse(localStorage.getItem(ALERT_STATE_KEY)||"null");}catch{previous=null;}
    const {state,alerts}=usageAlerts(this.snapshot,previous);
    // Save before delivery so repeated opens and refreshes cannot replay alerts.
    localStorage.setItem(ALERT_STATE_KEY,JSON.stringify(state));
    for(const alert of alerts)notify(alert.message,{key:alert.key,category:"usage"});
  }
  launch(provider,command) {
    const record=this.snapshot?.providers.find(p=>p.id===provider);
    if(!record||!(command==="switch"?record.canSwitch:command==="native-usage"&&record.canNative))return;
    this.close();
    const local=spaces().find(s=>!s.machine);
    const args={name:`${provider==="codex"?"Codex":"Claude"} account`,folder:home(),argv:["python",this.helper(),command,provider]};
    if(local)run("tab.new",{...args,space:local.id});
    else run("space.new",args);
  }
  button(id,label,action,t,active=false,enabled=true) {
    return bevel(h_flex().id(id).h(30).px(11).gap(6).items_center().flex_none(),active,t)
      .text_size(11).text_color(enabled?(active?t.accent:t.muted):t.dim).opacity(enabled?1:.5)
      .when(enabled,el=>el.hover(s=>s.text_color(t.foreground)).on_click(action)).child(label);
  }
  windowCard(w,index,t,provider) {
    const color=w.used!==null&&w.used>=90?t.danger:w.used!==null&&w.used>=75?t.warning:t.accent;
    return v_flex().id(`usage-window-${provider}-${index}`).w_full().min_w(0).gap(6)
      .child(h_flex().gap(8).items_center().min_w(0)
        .child(div().flex_1().min_w(0).truncate().text_size(11).font_semibold().text_color(t.foreground).child(w.label))
        .child(div().flex_none().text_size(10).text_color(w.used===null?t.dim:color).child(percentLabel(w.used))))
      .child(div().relative().w_full().h(7).bg(t.raised).border_1().border_color(t.border)
        .when(w.used!==null&&w.used>0,el=>el.child(div().absolute().left(0).top(0).bottom(0).w(`${w.used}%`).bg(color))))
      .child(div().text_size(9).text_color(t.dim).tooltip(w.reset===null?"Reset time was not supplied":new Date(w.reset).toLocaleString()).child(resetLabel(w.reset,this.now)));
  }
  providerCard(p,t) {
    const accent=p.id==="claude"?t.secondary:t.accent;
    const metrics=tokenMetrics(p);
    const state=p.pending?"Checking…":!p.available?"Unavailable":p.authenticated===true?"Signed in":p.authenticated===false?"Not signed in":"Account unconfirmed";
    return requestFrame(v_flex().id(`usage-${p.id}`).flex_1().min_w(0).p(14).gap(13),t)
      .child(h_flex().gap(9).items_center()
        .child(bevel(h_flex().size(29).flex_none().items_center().justify_center(),false,t)
          .child(svg(`mods/crew/icons/provider-${p.id}.svg`).size(16).text_color(accent)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().font_semibold().text_size(15).text_color(t.foreground).child(p.name))
          .child(div().text_size(9).text_color(p.authenticated===true?t.done:t.dim).child(state))))
      .child(v_flex().w_full().min_w(0).gap(4).pl(8).border_l(2).border_color(accent)
        .child(div().w_full().min_w(0).truncate().tooltip(p.account||"Account not reported").text_size(12).text_color(t.foreground).child(p.account||(p.pending?"Checking account…":"Account not reported")))
        .child(div().text_size(10).text_color(t.muted).child(p.plan||(p.pending?"Checking plan…":"Plan not reported"))))
      .child(div().w_full().h(1).bg(t.border))
      .child(v_flex().w_full().min_w(0).gap(13)
        .children(p.windows.map((w,i)=>this.windowCard(w,i,t,p.id)))
        .when(!p.windows.length,el=>el.child(v_flex().min_h(68).justify_center().gap(5)
          .child(div().text_size(12).text_color(t.muted).child(p.pending?"Loading usage windows…":"Usage limits not reported"))
          .child(div().text_size(10).text_color(t.dim).child("No quota estimate is shown.")))))
      .when(metrics.length>0,el=>el.child(h_flex().gap(12).items_start().border_t(1).border_color(t.border).pt(10)
        .children(metrics.map(([label,value])=>v_flex().flex_1().min_w(0).gap(4)
          .child(div().text_size(9).text_color(t.dim).child(`${label} TOKENS`))
          .child(div().text_size(15).font_semibold().text_color(t.foreground).tooltip(`${Math.round(value)} tokens`).child(tokenLabel(value)))))))
      .when(!p.pending,el=>el.child(div().text_size(9).text_color(p.stale?t.warning:t.dim)
        .tooltip(p.updated?new Date(p.updated).toLocaleString():"Provider report time was not supplied")
        .child(reportedLabel(p.updated,p.stale,this.now))))
      .when(Boolean(p.error),el=>el.child(div().w_full().whitespace_normal().text_size(11).line_height(1.3).text_color(t.warning).child(p.error)))
      .when(Boolean(p.note),el=>el.child(div().w_full().whitespace_normal().text_size(10).line_height(1.3).text_color(t.muted).child(p.note)))
      .child(div().flex_1())
      .child(h_flex().w_full().gap(6).flex_wrap()
        .child(this.button(`switch-${p.id}`,p.authenticated===false?"Sign in":"Switch account",()=>this.launch(p.id,"switch"),t,true,p.canSwitch))
        .when(p.canNative,el=>el.child(this.button(`native-${p.id}`,"Open native usage",()=>this.launch(p.id,"native-usage"),t))))
      .child(div().whitespace_normal().text_size(9).text_color(t.dim).child(p.canSwitch?"Opens native sign-in in a terminal tab. Existing sessions may need to be resumed.":"Account switching is unavailable."));
  }
  render() {
    const t=skin(),wide=this.width>=620;
    const providers=this.snapshot?.providers??PROVIDERS.map(p=>({...p,pending:this.loading,available:false,authenticated:null,account:"",plan:"",windows:[],today:null,session:null,context:null,canSwitch:false,note:"",error:this.loading?"":"Refresh to load usage."}));
    const content=v_flex().id("usage-monitor").size_full().min_w(0).min_h(0).bg(t.background).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e,cx)=>{if(e.key==="escape"){cx.stop_propagation();this.close();}})
      .on_mouse_down("left",()=>this.handle.focus())
      .on_size_change((size,cx)=>{const width=size.width/(settings().zoom||1);if(width>0&&Math.abs(width-this.width)>2){this.width=width;cx.notify();}})
      .child(h_flex().h(54).flex_none().px(14).gap(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
        .child(svg("mods/my-menu/icons/settings.svg").size(18).text_color(t.accent))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_size(16).font_semibold().child("Usage & accounts"))
          .child(div().text_size(10).text_color(t.dim).child("This computer")))
        .child(this.button("usage-refresh",this.loading?"Refreshing…":"Refresh",(_e,cx)=>this.refresh(cx,true),t,false,!this.loading))
        .child(this.button("usage-close","×",()=>this.close(),t)))
      .child(v_flex().id("usage-scroll").flex_1().min_h(0).overflow_y_scrollbar().p(wide?14:10).gap(10)
        .when(Boolean(this.error),el=>el.child(div().p(10).border_l(2).border_color(t.warning).bg(t.raised).whitespace_normal().text_size(12).text_color(t.warning).child(this.error)))
        .when(Boolean(this.error&&this.snapshot),el=>el.child(div().text_size(10).text_color(t.dim).child("Showing the last successful snapshot below.")))
        .child((wide?h_flex():v_flex()).w_full().min_w(0).gap(12).items_stretch().children(providers.map(p=>this.providerCard(p,t).when(!wide,el=>el.flex_none())))))
      .child(h_flex().min_h(34).flex_none().px(14).py(7).gap(10).flex_wrap().items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().min_w(0).text_size(9).text_color(t.dim).child(this.snapshot?.updated?`Updated ${new Date(this.snapshot.updated).toLocaleTimeString()}`:"No snapshot yet"))
        .child(div().text_size(9).text_color(t.dim).child("Auto refresh · 60s while focused")));
    return div().size_full().flex().items_center().justify_center()
      .child(div().w_full().h_full().max_w(760).max_h(650).min_w(0).min_h(0).child(panelSkin(content,t)));
  }
}
