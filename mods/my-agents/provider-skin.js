import {cardState,frameAsset} from "./card-state.js";
import { div, image } from "gpui-kit";
import { skin, art, artText, mix } from "./theme-tokens.js";

export function providerLook(provider,t=skin()) {
  const base = /claude/i.test(provider.name)
    ? {key:"claude",accent:"#e1a17e",frame:"mods/crew/art/provider-frame-claude.png",ratio:1942/809}
    : /codex|openai/i.test(provider.name)
      ? {key:"codex",accent:"#70e5e7",frame:"mods/crew/art/provider-frame-codex.png",ratio:1942/809}
      : {key:"other",accent:provider.color || "#8b93a7",frame:"mods/crew/art/crew-component.png",ratio:3};
  const text=artText(base.frame,t),frame=art(base.frame,t),onLight=frame!==base.frame;
  return {...base,frame,onLight,ink:text.foreground,muted:text.muted,dim:text.dim,accent:onLight?mix(base.accent,"#102030",.57):base.accent};
}

export const providerHeight = (width, compact=false) => compact ? 80 : Math.max(104, width * 809 / 1942);

export function providerGeometry(provider,width,t=skin(),compact=false) {
  const look=providerLook(provider,t), height=providerHeight(width,compact), artWidth=height*look.ratio;
  const original=look.key==="other";
  return { ...look, width,height,artWidth,
    left:artWidth*(original?.25:.31), right:artWidth*.08,
    textLeft:artWidth*(original?.28:.345), textRight:artWidth*.085,
    textTop:height*.17, textBottom:height*.16,
    portraitX:artWidth*(original?.138:.16), portraitY:height*(original?.48:.49),
    portraitHeight:height*.44,
  };
}

// Only the unoccupied middle strip is shortened on a narrow sidebar. Both
// illustrated ends use one uniform scale, keeping the circular socket round.
// There is no painted rectangle or second frame behind the transparent artwork.
export function providerFrame(el,provider,width,t=skin(),state=null,compact=false) {
  const g=providerGeometry(provider,width,t,compact);
  const power=state?cardState(state.status,state.focused,t.light):null;
  const art=()=>image(frameAsset(g.frame,power?.powered??true)).absolute().top(0).w(g.artWidth).h(g.height);
  if(!compact && g.artWidth<=width+.1) return el.relative().min_w(0).child(art().left(0));
  // Repeat only an empty center section when compact cards are wider than their art.
  const centerWidth=Math.max(1,width-g.left-g.right), sourceWidth=g.artWidth*.28;
  const strips=[];
  for(let x=0;x<centerWidth;x+=sourceWidth) strips.push(
    div().absolute().left(x).top(0).w(Math.min(sourceWidth,centerWidth-x)+1).h(g.height).overflow_hidden()
      .child(art().left(-g.artWidth*.42)));
  return el.relative().min_w(0)
    .child(div().absolute().top(0).left(0).w(g.left).h(g.height).overflow_hidden().child(art().left(0)))
    .child(div().absolute().top(0).left(g.left).right(g.right).h(g.height).overflow_hidden().children(strips))
    .child(div().absolute().top(0).right(0).w(g.right).h(g.height).overflow_hidden().child(art().left(-(g.artWidth-g.right))));
}
