import { layout, shared, setShared, run } from "herdr";
import { skin } from "./theme-tokens.js";
import { findNode, projectPaint } from "./layout-paint.js";

export function observePaint(view,cx,light=skin().light) {
  const name=String(shared("layout") || "custom"), key=`neon.theme-paint.v1.${name}`;
  const stamp=`${name}:${light}`;
  // Native animation/data renders are frequent. An unchanged mode has no
  // timer, layout read, shared write or layout write.
  if(view.paintObserved===stamp)return;
  view.paintObserved=stamp;
  if(view.paintPending)return;
  const previous=shared(key);
  if(previous?.light===light || (!light&&!previous))return;
  if(findNode(layout(),"brand")?.content?.mod!=="neon-chrome")return;
  view.paintPending=true;
  cx.timer.after(180,()=>{
    try {
      // Read the latest mode/tree after the settings transaction settles. Rapid
      // light/dark choices coalesce into this one callback rather than reloads.
      const currentName=String(shared("layout") || "custom");
      const currentKey=`neon.theme-paint.v1.${currentName}`;
      const nowLight=skin().light,state=shared(currentKey);
      view.paintObserved=`${currentName}:${nowLight}`;
      if(state?.light===nowLight || (!nowLight&&!state))return;
      const current=layout();
      if(findNode(current,"brand")?.content?.mod!=="neon-chrome")return;
      const update=projectPaint(current,nowLight,state);
      // The in-memory guard remains set during synchronous rerender callbacks;
      // persisted state also prevents repeating a transition after mod reload.
      setShared(currentKey,update.state);
      if(update.changed)run("layout.set",{layout:update.next});
    } finally { view.paintPending=false; }
  });
}
