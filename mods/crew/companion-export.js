// Runtime data lives outside mods/: publishing a companion snapshot must never
// trigger the mod source watcher. Only the sidebar dock owns this exporter.
import { agents, appHome, readTextFile, writeTextFile } from "herdr";
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
      const list=agents().map(a=>{
        const ch=characterOf(a.address);
        return {address:a.address,crew:ch.id,name:ch.name,palette:paletteFor(a),status:a.status,where:a.space_name||a.tab_name||""};
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
  cx.timer.every(2000,cx=>cx.spawn(async()=>{await write();}));
}
