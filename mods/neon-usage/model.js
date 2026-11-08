export const PROVIDERS=[{id:"codex",name:"Codex"},{id:"claude",name:"Claude Code"}];
const text=value=>typeof value==="string"?value.trim():"";
export function number(value) {
  if(value===null||value===undefined||typeof value==="boolean"||value==="")return null;
  const n=typeof value==="number"?value:typeof value==="string"&&value.trim()?Number(value):NaN;
  return Number.isFinite(n)&&n>=0?n:null;
}
export function timestamp(value) {
  const numeric=number(value);
  if(numeric!==null)return numeric<1e12?numeric*1000:numeric;
  const parsed=typeof value==="string"?Date.parse(value):NaN;
  return Number.isFinite(parsed)?parsed:null;
}
export function quota(value) {
  const n=number(value);
  return n!==null&&n<=100?n:null;
}
export function normalizeSnapshot(value) {
  if(!value||typeof value!=="object"||!Array.isArray(value.providers))throw new Error("The usage helper returned an unexpected response.");
  return {updated:timestamp(value.updated_ms),providers:PROVIDERS.map(base=>{
    const raw=value.providers.find(p=>p?.id===base.id),account=raw?.account;
    return {...base,available:raw?.available===true,updated:timestamp(raw?.updated_ms),stale:raw?.stale===true,authenticated:typeof account?.authenticated==="boolean"?account.authenticated:null,
      account:text(account?.label),plan:text(account?.plan),canSwitch:raw?.can_switch===true,canNative:raw?.can_native_usage===true,
      windows:(Array.isArray(raw?.windows)?raw.windows:[]).slice(0,8).map(w=>({label:text(w?.label)||"Usage window",used:quota(w?.used_percent),reset:timestamp(w?.resets_at)})),
      today:number(raw?.usage?.today_tokens),session:number(raw?.usage?.session_tokens),context:number(raw?.usage?.context_tokens),note:text(raw?.note),
      error:text(raw?.error)||(!raw?"This provider was not included in the snapshot.":"")};
  })};
}
export function tokenLabel(value) {
  value=number(value);
  if(value===null)return "Not reported";
  if(value>=1e9)return `${(value/1e9).toFixed(2)}B`;
  if(value>=1e6)return `${(value/1e6).toFixed(2)}M`;
  if(value>=1e3)return `${(value/1e3).toFixed(1)}K`;
  return String(Math.round(value));
}
export function percentLabel(value) {return value===null?"Not reported":`${Math.round(value*10)/10}% used`;}
export function tokenMetrics(provider) {
  const candidates=provider.id==="claude"?[["CONTEXT",provider.context]]:[["TODAY",provider.today],["SESSION",provider.session],["CONTEXT",provider.context]];
  return candidates.filter(([,value])=>number(value)!==null);
}
export function reportedLabel(updated,stale,now=Date.now()) {
  if(updated===null||updated===undefined)return stale?"Stale report · time unavailable":"Report time not supplied";
  const minutes=Math.max(0,Math.floor((now-updated)/60000));
  const age=minutes<1?"just now":minutes<60?`${minutes}m ago`:minutes<1440?`${Math.floor(minutes/60)}h ago`:`${Math.floor(minutes/1440)}d ago`;
  return `${stale?"Stale · ":""}Reported ${age}`;
}
export function resetLabel(value,now=Date.now()) {
  if(value===null)return "Reset time not reported";
  const minutes=Math.ceil((value-now)/60000);
  if(minutes<=0)return "Reset due · refresh to verify";
  if(minutes<60)return `Resets in ${minutes}m`;
  const hours=Math.floor(minutes/60),rest=minutes%60;
  if(hours<24)return `Resets in ${hours}h${rest?` ${rest}m`:""}`;
  const days=Math.floor(hours/24),tail=hours%24;
  return `Resets in ${days}d${tail?` ${tail}h`:""}`;
}
export function refreshDue(now,last,active,focused,loading) {
  return active&&focused&&!loading&&now-last>=60000;
}
