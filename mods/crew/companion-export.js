// Runtime data lives outside mods/: publishing a companion snapshot must never
// trigger the mod source watcher. Only the sidebar dock owns this exporter.
import { agents, appHome, exec, home, readTextFile, terminals, writeTextFile } from "herdr";
import { reportedActivity } from "./activity-data.js";
import { withWait } from "./agent-wait.js";
import { characterOf, paletteFor } from "./cast.js";

let started=false;
export function startCompanionExport(cx) {
  if(started)return;
  started=true;
  const path=`${appHome()}/data/crew/companions.json`;
  let last="",written,published=0,inFlight=false;
  const write=async()=>{
    if(inFlight)return;
    inFlight=true;
    try {
      const records=terminals();
      const list=agents().map(a=>withWait(a,records)).map(a=>{
        const ch=characterOf(a.address);
        // Which work station the desktop robot stands at (the town's station art).
        const act=a.status==="working"?reportedActivity(a,records):null;
        const kind=!act?"":act.source==="model"?"think":["code","test","scan"].includes(act.kind)?act.kind:"run";
        return {address:a.address,crew:ch.id,name:ch.name,palette:paletteFor(a),status:a.status,kind,waitFor:a.wait?.for||"",where:a.space_name||a.tab_name||""};
      });
      const body=JSON.stringify(list), now=Date.now();
      if(body===last && now-published<10000)return;
      if(written===undefined)written=await readTextFile(path);
      const text=JSON.stringify({updated:now,agents:list});
      await writeTextFile(path,text,written);
      written=text;last=body;published=now;
    }catch{written=undefined;}
    finally{inFlight=false;}
  };
  cx.spawn(async()=>{await write();});
  cx.spawn(async()=>{await startCompanions();});
  cx.timer.every(2000,cx=>cx.spawn(async()=>{await write();}));
}

// Desktop companions (Windows): start them with herdr unless "Start with herdr" is off in their
// right-click menu. `start` detaches them; the script exits at once if a copy already runs.
async function startCompanions() {
  if (!/^[A-Za-z]:/.test(home())) return;
  try {
    const cfg = JSON.parse(await readTextFile(`${home()}/.herdr/companions.json`) || "{}");
    if (cfg.with_herdr === false) return;
  } catch {}
  const script = `${appHome()}/mods/crew/companions.pyw`.replace(/\//g, "\\");
  try { await exec("cmd", ["/c", "start", "", "pythonw", script]); } catch {}
}
