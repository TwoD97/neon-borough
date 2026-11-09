// Pure alert decisions. Persist the returned state before delivering notices.
// Only account labels and quota-window metadata are retained; no credentials.
export const ALERT_STATE_KEY="usage-alerts-v1";
const fresh=p=>p?.available===true&&p.authenticated===true&&!p.stale&&!p.error&&typeof p.account==="string"&&p.account.trim();
const identity=p=>p.account.trim().toLowerCase();
export function usageAlerts(snapshot,previous,now=Date.now()) {
  const old=previous?.version===1?previous:{};
  const accounts={...old.accounts};
  const seen=(Array.isArray(old.seen)?old.seen:[]).filter(r=>typeof r?.key==="string"&&Number.isFinite(r.reset)&&r.reset>now&&(r.threshold===90||r.threshold===100)).map(r=>({...r}));
  const alerts=[];
  for(const p of snapshot?.providers??[]) {
    if(!fresh(p))continue;
    const account=identity(p),prior=accounts[p.id];
    if(typeof prior==="string"&&prior!==account)alerts.push({
      key:JSON.stringify(["account",p.id,prior,account,now]),
      message:{title:`${p.name} account changed`,body:`Reported sign-in: ${p.account}. Running chats may still use their previous sign-in.`,level:"success"}
    });
    accounts[p.id]=account;
    for(const w of p.windows??[]) {
      // Missing reset times cannot identify a quota period safely.
      if(!Number.isFinite(w.used)||w.used<90||w.used>100||!Number.isFinite(w.reset)||w.reset<=now)continue;
      const threshold=w.used>=100?100:90;
      const key=JSON.stringify([p.id,account,w.label,w.reset]);
      const record=seen.find(r=>r.key===key);
      if(record&&record.threshold>=threshold)continue;
      if(record)record.threshold=threshold;else seen.push({key,reset:w.reset,threshold});
      alerts.push({key:JSON.stringify(["quota",key,threshold]),message:{
        title:threshold===100?`${p.name} ${w.label} limit reached`:`${p.name} ${w.label} usage is high`,
        body:`${Math.round(w.used*10)/10}% used · ${p.account}. ${threshold===100?"Wait for the window to reset or review your account.":"Review Usage & accounts before the limit is reached."}`,
        level:threshold===100?"error":"warning"
      }});
    }
  }
  return {state:{version:1,accounts,seen:seen.slice(-512)},alerts};
}
