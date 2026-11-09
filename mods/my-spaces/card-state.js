// State selects baked artwork, never a faded chassis or an overlay light bar.
export function cardState(status, focused=false, light=false) {
  const state=["working","blocked","done"].includes(status)?status:"idle";
  return {state,focused:Boolean(focused),powered:state==="working"||state==="blocked",frameOpacity:1,
    role:state==="blocked"?"warning":state==="working"?"working":state==="done"?"done":"dim"};
}
// Resolve the theme first, then its matching OFF artwork (dark / Ivory / Pearl).
export function frameAsset(themedPath,powered=true) {
  return powered?themedPath:themedPath.replace(/\.png$/, "-off.png");
}
