import {frameAsset} from "./card-state.js";
import { skin, art, artText, mix } from "./theme-tokens.js";
import { div } from "gpui-kit";
import { illustratedRail } from "./illustrated-rail.js";

export const GROUP_RAIL = {width:2172,height:724,frame:{x:20,y:268,width:2132,height:186},left:260,right:330,tile:{x:650,width:800}};
const HEADER="mods/crew/art/group-header.png";

// Socket centers measured in the source frame, not guessed from row padding.
export function groupInsets(height=30) {
  const scale=height/GROUP_RAIL.frame.height;
  return {left:170*scale-11,right:185*scale-10};
}

// Preserve the illustrated metal and transparent chamfers. Only the native
// empty middle section repeats; corners and icon sockets never stretch.
export function groupFrame(el,active=false,color=skin().accent,height=30,t=skin()) {
  const ink=artText(HEADER,t);
  return illustratedRail(el,frameAsset(art(HEADER,t),active),GROUP_RAIL,height).text_color(ink.foreground);
}

// These controls sit inside the artwork's fitted sockets. Extra opaque plates
// would hide the generated recess and look especially heavy in Ivory.
export function groupWell(content,width=22,height=20,t=skin()) {
  return div().relative().w(width).h(height).flex_none().flex().items_center().justify_center()
    .text_color(artText(HEADER,t).muted).child(content);
}

// The small View button keeps its existing chamfer shape; a restrained selected
// face relates to the metal rail without a broad saturated copper panel.
export function groupControlPalette(t=skin()) {
  return t.light ? {...t,raised:mix(t.surface,t.chrome,.46),selected:mix(t.surface,t.selected,.24),edge:mix(t.surface,t.border,.64)} : t;
}
