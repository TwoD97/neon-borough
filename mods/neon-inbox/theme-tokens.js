// Canonical copy. tools/sync-theme-tokens.ps1 distributes this file locally
// because Herdr isolates imports to each mod folder.
import { theme } from "herdr";

export const LIGHT_ART = {
  "mods/crew/art/provider-frame-claude.png": "mods/crew/art/provider-frame-claude-light.png",
  "mods/crew/art/provider-frame-codex.png": "mods/crew/art/provider-frame-codex-light.png",
  "mods/crew/art/crew-component.png": "mods/crew/art/crew-component-light.png",
  "mods/pr-hub/art/pr-component.png": "mods/pr-hub/art/pr-component-light.png",
  "mods/my-spaces/art/space-frame.png": "mods/my-spaces/art/space-frame-light.png",
  "mods/my-spaces/art/worktree-frame.png": "mods/my-spaces/art/worktree-frame-light.png"
};

// Material variants retain the original alpha and bevel detail. Warm light
// palettes use copper/plum; cool light palettes use cyan/violet.
export const THEME_ART = {
  "mods/crew/art/group-header.png": "mods/crew/art/group-header",
  "mods/crew/art/hangar-deck.png": "mods/crew/art/hangar-deck",
  "mods/crew/art/control-keycap.png": "mods/crew/art/control-keycap",
  "mods/crew/art/provider-frame-claude.png": "mods/crew/art/provider-frame-claude",
  "mods/crew/art/provider-frame-codex.png": "mods/crew/art/provider-frame-codex",
  "mods/crew/art/crew-component.png": "mods/crew/art/crew-component",
  "mods/crew/art/agent-dock.png": "mods/crew/art/agent-dock",
  "mods/pr-hub/art/pr-component.png": "mods/pr-hub/art/pr-component",
  "mods/my-spaces/art/space-frame.png": "mods/my-spaces/art/space-frame",
  "mods/my-spaces/art/worktree-frame.png": "mods/my-spaces/art/worktree-frame",
  "mods/my-spaces/art/space-emblem.png": "mods/my-spaces/art/space-emblem"
};

function rgb(color) {
  const value = String(color || "").replace(/^#/, "");
  return /^[0-9a-f]{6,8}$/i.test(value) ? [0,2,4].map(i => parseInt(value.slice(i,i+2),16)) : [12,18,28];
}
export function mix(a,b,amount=.5) {
  const x=rgb(a),y=rgb(b),k=Math.max(0,Math.min(1,amount));
  return "#"+x.map((v,i)=>Math.round(v+(y[i]-v)*k).toString(16).padStart(2,"0")).join("");
}
export function luminance(color) {
  const values=rgb(color).map(v=>{const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});
  return values[0]*.2126+values[1]*.7152+values[2]*.0722;
}
export function skin(palette=theme()) {
  const light=luminance(palette.background)>.35;
  const foreground=palette.foreground || (light?"#18232e":"#e6edf7");
  const background=palette.background || "#0b1320";
  const accent=palette.accent || (light?"#006c78":"#60dfd8");
  const surface=palette.surface || mix(background,foreground,.035);
  return {
    ...palette,light,background,foreground,accent,surface,
    canvas:palette.canvas || background,chrome:palette.chrome || surface,
    popover:palette.popover || surface,raised:palette.raised || mix(surface,foreground,.05),
    hover:palette.hover || mix(surface,accent,.09),selected:palette.selected || mix(surface,accent,.14),
    border:palette.border || mix(background,foreground,.27),input:palette.input || mix(background,foreground,.18),
    muted:palette.muted || mix(background,foreground,.7),dim:palette.dim || mix(background,foreground,.58),
    accent_foreground:palette.accent_foreground || (luminance(accent)>.4?"#09202b":"#ffffff"),
    solid:palette.solid || accent,solid_foreground:palette.solid_foreground || (light?"#ffffff":"#071722"),
    working:palette.working || accent,blocked:palette.blocked || (light?"#994b00":"#ffc572"),
    waiting:palette.waiting || (light?"#6941af":"#a98bff"),
    done:palette.done || (light?"#17683b":"#74d6aa"),idle:palette.idle || mix(background,foreground,.55),
    warning:light?"#8a4b00":"#ffc572",danger:light?"#a02442":"#ff658e",
    metal:mix(surface,foreground,light?.14:.10),rail:mix(surface,foreground,light?.20:.17),
    edge:mix(surface,foreground,light?.40:.40),shine:mix(surface,foreground,light?.56:.65),
    secondary:palette.ansi5 || (light?"#7453a1":"#b59aff"),
    cardInk:"#e6edf7",cardMuted:"#a7bdcf",cardDim:"#8da7be",
    cardAccent:mix(accent,"#e6ffff",light?.48:.12),
  };
}
export function art(path,t=skin()) {
  if(!t.light)return path;
  if(THEME_ART[path]) {
    const [r,,b]=rgb(t.accent);
    return `${THEME_ART[path]}-${r>b?"ivory":"pearl"}.png`;
  }
  return LIGHT_ART[path] || path;
}
export function artText(path,t=skin()) {
  return t.light && THEME_ART[path]
    ? {foreground:t.foreground,muted:t.muted,dim:t.dim}
    : t.light && LIGHT_ART[path]
    ? {foreground:"#172635",muted:"#40566b",dim:"#586d7e"}
    : {foreground:t.cardInk,muted:t.cardMuted,dim:t.cardDim};
}
