// Logical pixels, independent of UI zoom. Scene and roster share one viewport.
export function townLayout(width, height, aspect) {
  const available=Math.max(280,(Number(width)||1200)-40);
  const wide=available>=1080;
  const roster=wide?Math.max(280,Math.min(320,available*.24)):available;
  const gap=16;
  const room=wide?available-roster-gap:available;
  const maximum=Math.max(256,room-24);
  const budget=Math.max(260,(Number(height)||800)-226);
  let scene=maximum;
  while(scene>280 && scene*aspect(scene)>budget)scene-=4;
  scene=Math.max(256,Math.floor(scene));
  // A tall window gets more street depth, rather than unused space below it.
  // Houses still scale proportionally inside the scene's layout.
  const naturalHeight=scene*aspect(scene);
  const sceneHeight=Math.round(wide?Math.max(naturalHeight,Math.min(budget,scene*.62)):naturalHeight);
  return {wide,scene,sceneHeight,sceneFrame:scene+24,roster,gap,
    width:wide?scene+24+gap+roster:available,
    height:sceneHeight+24};
}
